// Test de extremo a extremo contra el stack local (supabase start + functions serve).
//
// Comprueba lo que pgTAP no puede: que los FICHEROS desaparecen de Storage.
//   · create-job valida, exige consentimiento y entrega la URL firmada de subida.
//   · El job se despacha a un worker falso (este test) con un aviso sin datos
//     personales (JobDispatchNotice); el worker pide el JobDispatch completo a
//     job-dispatch, que lo entrega una sola vez por intento (A3, B4).
//   · job-callback rechaza firmas malas y, al terminar el job (bien o mal),
//     borra la foto de raw-uploads.
//   · maintenance barre las fotos de más de 60 minutos.
//   · Storage rechaza subidas que ningún job activo espera (M2, B5).
//   · jobs.input y jobs.output terminan sin datos personales (A1).
//   · export-data (D7) devuelve un DataExport válido, con URLs firmadas que
//     descargan los ficheros, sin rutas internas y sin datos de otro usuario;
//     aplica la cuota diaria.
//   · delete-account deja Storage vacío y borra el usuario y sus filas, pero
//     deja sus consentimientos archivados y seudonimizados (D6).
//
// Uso: ver supabase/README.md («Tests»); se ejecuta con --config functions/deno.json
// (mismo mapa de imports que las funciones). Variables:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL,
//   PROBADOR_CALLBACK_SECRET, PROBADOR_DISPATCH_SECRET, MAINTENANCE_SECRET (los
//   mismos que usa functions serve, que NO debe tener PROBADOR_ALLOW_FAKE_WORKERS)
//   FAKE_WORKER_PORT (8787; WORKER_DISPATCH_URL de las funciones debe apuntar aquí)

import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { signedHeaders, verifyRequest } from "../../functions/_shared/hmac.ts";
import { CONTRACTS_VERSION, type DataExport, type JobDispatch, type JobDispatchNotice } from "@probador/contracts";
import { validate as validateDispatch } from "../../functions/_shared/validate_dispatch.ts";
import { validate as validateExport } from "../../functions/_shared/validate_export.ts";

const env = (k: string, d?: string) => {
  const v = Deno.env.get(k) ?? d;
  if (!v) throw new Error(`set ${k}`);
  return v;
};
const URL_ = env("SUPABASE_URL", "http://127.0.0.1:54321");
const ANON = env("SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");
const DB_URL = env("SUPABASE_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
const CALLBACK_SECRET = env("PROBADOR_CALLBACK_SECRET");
const DISPATCH_SECRET = env("PROBADOR_DISPATCH_SECRET");
const MAINTENANCE_SECRET = env("MAINTENANCE_SECRET");
const WORKER_PORT = Number(env("FAKE_WORKER_PORT", "8787"));

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const sql = postgres(DB_URL, { max: 1 });

// delete-account exige el secreto del seudónimo de consentimientos en Vault (D6).
// Si el stack local no lo tiene, se crea uno para el test y se borra al final.
const CONSENT_SECRET_NAME = "consent_pseudonym_secret";
const createdConsentSecret = (await sql`
  select vault.create_secret(${"e2e-" + crypto.randomUUID() + crypto.randomUUID()}, ${CONSENT_SECRET_NAME})
   where not exists (select 1 from vault.secrets where name = ${CONSENT_SECRET_NAME})`).length > 0;

/** HMAC-SHA256(secreto de Vault, "email:" + email normalizado) en hex (M1). */
const emailHash = async (email: string) =>
  (await sql`select encode(extensions.hmac(${
    "email:" + email.trim().toLowerCase()
  }, decrypted_secret, 'sha256'), 'hex') as h
               from vault.decrypted_secrets where name = ${CONSENT_SECRET_NAME}`)[0].h as string;

/** HMAC-SHA256(secreto de Vault, user_id) en hex, calculado por Postgres. */
const consentHash = async (userId: string) =>
  (await sql`select encode(extensions.hmac(${userId}, decrypted_secret, 'sha256'), 'hex') as h
               from vault.decrypted_secrets where name = ${CONSENT_SECRET_NAME}`)[0].h as string;

// Worker falso: verifica la firma del aviso de despacho y guarda cada JobDispatchNotice (A3: es lo único que
// pasaría por la cola del proveedor de GPU).
const notices = new Map<string, JobDispatchNotice>();
const worker = Deno.serve({ port: WORKER_PORT, hostname: "0.0.0.0", onListen: () => {} }, async (req) => {
  const raw = await req.text();
  if (!(await verifyRequest(DISPATCH_SECRET, raw, req.headers))) return new Response(null, { status: 401 });
  const n = JSON.parse(raw) as JobDispatchNotice;
  notices.set(n.job_id, n);
  return new Response(null, { status: 202 });
});

async function waitForNotice(jobId: string): Promise<JobDispatchNotice> {
  for (let i = 0; i < 50; i++) {
    const n = notices.get(jobId);
    if (n) return n;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`job ${jobId} was never dispatched`);
}

/** Lo que hace el contenedor del worker: pedir el JobDispatch completo a job-dispatch con una petición firmada. */
async function fetchDispatch(notice: JobDispatchNotice, secret = CALLBACK_SECRET) {
  const raw = JSON.stringify({ job_id: notice.job_id, attempt: notice.attempt });
  const res = await fetch(`${URL_}/functions/v1/job-dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await signedHeaders(secret, raw)) },
    body: raw,
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function waitForDispatch(jobId: string): Promise<JobDispatch> {
  const fetched = await fetchDispatch(await waitForNotice(jobId));
  assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
  return fetched.body as JobDispatch;
}

async function callFn(name: string, token: string | null, body: unknown, method = "POST") {
  const res = await fetch(`${URL_}/functions/v1/${name}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/** sign: "ok" firma bien; "forged" firma con otro secreto; "old" es una firma válida de hace 10 minutos (reenvío). */
async function callback(payload: unknown, sign: "ok" | "forged" | "old" = "ok") {
  const raw = JSON.stringify(payload);
  const headers = sign === "forged"
    ? await signedHeaders("otro-secreto", raw)
    : await signedHeaders(CALLBACK_SECRET, raw, Date.now() - (sign === "old" ? 600_000 : 0));
  const res = await fetch(`${URL_}/functions/v1/job-callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: raw,
  });
  return { status: res.status, body: await res.json() };
}

const rawObjects = async (userId: string) =>
  (await sql`select name, created_at from storage.objects
             where bucket_id = 'raw-uploads' and name like ${userId + "/%"} order by name`).map((r) => r.name);

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);
const PNG = new Uint8Array([137, 80, 78, 71]);

Deno.test({
  name: "e2e: el ciclo de vida de una foto termina siempre en su borrado",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const email = `e2e-${crypto.randomUUID()}@test.local`;
    const password = crypto.randomUUID();
    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(cErr);
    const uid = created.user!.id;
    const user = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: session, error: sErr } = await user.auth.signInWithPassword({ email, password });
    assert.ifError(sErr);
    const token = session.session!.access_token;
    let otherId = "";

    // M1: la app solo envía el tratamiento; versión y fecha las pone el servidor.
    const backdated = await user.from("consents").insert({ purpose: "body_scan", granted_at: "2020-01-01T00:00:00Z" });
    assert.ok(backdated.error, "la app no puede fijar la fecha del consentimiento");
    const { data: consent, error: consErr } = await user.from("consents")
      .insert({ purpose: "body_scan" }).select("id, text_version, granted_at").single();
    assert.ifError(consErr);
    const { data: currentText } = await user.from("consent_texts").select("version, sha256")
      .eq("purpose", "body_scan").order("published_at", { ascending: false }).limit(1).single();
    assert.equal(consent!.text_version, currentText!.version, "versión vigente de consent_texts");
    assert.ok(Math.abs(Date.parse(consent!.granted_at) - Date.now()) < 60_000, "fecha del servidor");

    const avatarRequest = (name: string) => ({
      type: "avatar",
      input: { photo_path: `raw-uploads/${uid}/${name}.jpg`, height_cm: 172, consent_id: consent!.id },
    });

    await t.step("create-job rechaza cuerpos fuera de contrato, rutas ajenas y falta de consentimiento", async () => {
      const bad = await callFn("create-job", token, { type: "avatar", input: { height_cm: 172 } });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error.code, "invalid_input");

      const other = await callFn("create-job", token, {
        type: "avatar",
        input: { photo_path: `raw-uploads/${crypto.randomUUID()}/x.jpg`, height_cm: 172, consent_id: consent!.id },
      });
      assert.equal(other.status, 400);

      const noConsent = await callFn("create-job", token, {
        type: "color",
        input: { selfie_path: `raw-uploads/${uid}/s.jpg`, white_reference: "paper", consent_id: consent!.id },
      });
      assert.equal(noConsent.status, 403);
      assert.equal(noConsent.body.error.code, "consent_missing");

      const anon = await callFn("create-job", null, avatarRequest("x"));
      assert.equal(anon.status, 401);
    });

    let jobId = "";
    await t.step("job avatar: subida firmada, despacho, callback y BORRADO de la foto", async () => {
      const created = await callFn("create-job", token, avatarRequest("cuerpo"));
      assert.equal(created.status, 201, JSON.stringify(created.body));
      jobId = created.body.job.id;
      assert.equal(created.body.job.status, "queued");
      assert.equal(created.body.uploads.length, 1);
      const ticket = created.body.uploads[0];
      assert.equal(ticket.path, `raw-uploads/${uid}/cuerpo.jpg`);

      const up = await user.storage.from("raw-uploads").uploadToSignedUrl(`${uid}/cuerpo.jpg`, ticket.token, JPEG, {
        contentType: "image/jpeg",
      });
      assert.ifError(up.error);
      assert.deepEqual(await rawObjects(uid), [`${uid}/cuerpo.jpg`]);

      // La app no puede leer su propia foto en raw-uploads (solo el worker con URL firmada).
      const peek = await user.storage.from("raw-uploads").download(`${uid}/cuerpo.jpg`);
      assert.ok(peek.error, "la app no debería poder descargar raw-uploads");

      const marked = await callFn("create-job/uploaded", token, { job_id: jobId });
      assert.equal(marked.status, 200);

      // A3: el aviso que llega al proveedor de GPU solo lleva identificadores.
      const notice = await waitForNotice(jobId);
      assert.deepEqual(Object.keys(notice).sort(), ["attempt", "contracts_version", "dispatch_url", "job_id", "type"]);
      assert.ok(validateDispatch.jobDispatchNotice(notice).ok);
      assert.ok(!JSON.stringify(notice).includes(uid), "el aviso no lleva el user_id");
      const forgedFetch = await fetchDispatch(notice, "otro-secreto");
      assert.equal(forgedFetch.status, 401, "job-dispatch exige la firma del worker");
      const fetched = await fetchDispatch(notice);
      assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
      assert.equal(fetched.headers.get("cache-control"), "no-store");
      const d = fetched.body as JobDispatch;
      const replay = await fetchDispatch(notice);
      assert.equal(replay.status, 409, "B4: el despacho se entrega una sola vez por intento");
      assert.equal(d.attempt, 1);
      assert.equal(d.type, "avatar");
      assert.equal(d.user_id, uid, "el dispatch lleva el dueño del job");
      assert.ok(d.contracts_version);
      const inputUrl = d.input_urls[`raw-uploads/${uid}/cuerpo.jpg`];
      assert.ok(inputUrl, "falta la URL firmada de la foto");
      const dl = await fetch(inputUrl);
      assert.equal(dl.status, 200);
      assert.deepEqual(new Uint8Array(await dl.arrayBuffer()), JPEG);

      const glb = d.output_uploads.find((o) => o.name === "glb")!;
      const put = await fetch(glb.upload_url, {
        method: "PUT",
        headers: { "content-type": "model/gltf-binary" },
        body: GLB,
      });
      assert.equal(put.status, 200, await put.text());
      assert.equal(glb.content_type, "model/gltf-binary");
      const putAgain = await fetch(glb.upload_url, {
        method: "PUT",
        headers: { "content-type": "model/gltf-binary" },
        body: GLB,
      });
      await putAgain.body?.cancel();
      assert.notEqual(putAgain.status, 200, "la URL de subida solo admite una subida (sin sobrescribir)");

      const now = new Date().toISOString();
      const output = {
        avatar: {
          id: crypto.randomUUID(),
          user_id: uid,
          body_model: "mhr",
          model_version: "mhr-1.0/avatar-test",
          shape: { params: new Array(45).fill(0) },
          measurements: {
            height_cm: 172,
            chest_cm: 96,
            waist_cm: 80,
            hip_cm: 98,
            shoulder_width_cm: 44,
            arm_length_cm: 60,
            inseam_cm: 80,
          },
          measurements_source: "photo",
          glb_url: `storage://${glb.path}`,
          pose: "a_pose",
          shape_hash: "shape-test",
          confidence: 0.8,
          created_at: now,
          updated_at: now,
        },
      };

      const success = { job_id: jobId, attempt: 1, status: "succeeded", output, worker_version: "t" };
      const forged = await callback(success, "forged");
      assert.equal(forged.status, 401, "firma inválida aceptada");
      const replayed = await callback(success, "old");
      assert.equal(replayed.status, 401, "firma válida pero antigua (reenvío) aceptada");
      const fake = await callback({ ...success, fake: true });
      assert.equal(fake.status, 422, "callback de worker fake aceptado sin PROBADOR_ALLOW_FAKE_WORKERS");
      assert.equal(fake.body.error.code, "fake_not_allowed");
      assert.deepEqual(await rawObjects(uid), [`${uid}/cuerpo.jpg`], "un callback rechazado no debe borrar nada");

      const invalid = await callback({
        job_id: jobId,
        attempt: 1,
        status: "succeeded",
        output: { avatar: {} },
        worker_version: "t",
      });
      assert.equal(invalid.status, 400, "una salida fuera de contrato se rechaza");

      const running = await callback({
        job_id: jobId,
        attempt: 1,
        status: "running",
        progress: 0.5,
        stage: "fitting",
        worker_version: "t",
      });
      assert.equal(running.status, 200);
      assert.equal(running.body.result, "applied");

      const stale = await callback({
        job_id: jobId,
        attempt: 7,
        status: "running",
        progress: 0.9,
        worker_version: "t",
      });
      assert.equal(stale.status, 409);

      const done = await callback({
        job_id: jobId,
        attempt: 1,
        status: "succeeded",
        output,
        worker_version: "avatar-test",
      });
      assert.equal(done.status, 200, JSON.stringify(done.body));
      assert.equal(done.body.result, "applied");

      // La foto ya no existe: ni la fila de storage.objects ni el fichero.
      assert.deepEqual(await rawObjects(uid), []);
      const gone = await admin.storage.from("raw-uploads").download(`${uid}/cuerpo.jpg`);
      assert.ok(gone.error, "el fichero sigue descargable");

      const { data: job } = await user.from("jobs").select("*").eq("id", jobId).single();
      assert.equal(job!.status, "succeeded");
      assert.ok(job!.input_deleted_at, "la API anota el borrado en jobs.input_deleted_at");
      // A1: jobs no guarda copias: ni medidas ni forma en output, ni altura ni ruta de la foto en input.
      assert.deepEqual(job!.output, { avatar_id: output.avatar.id });
      assert.deepEqual(job!.input, { consent_id: consent!.id });
      assert.equal(job!.fake, false);
      const { data: avatars } = await user.from("avatars").select("glb_path");
      assert.deepEqual(avatars, [{ glb_path: glb.path }]);
      const signed = await user.storage.from("assets").createSignedUrl(glb.path.slice("assets/".length), 60);
      assert.ifError(signed.error);

      const again = await callback({ job_id: jobId, attempt: 1, status: "succeeded", output, worker_version: "t" });
      assert.equal(again.body.result, "already_terminal");
    });

    await t.step("job avatar fallido: la foto también se borra", async () => {
      const created = await callFn("create-job", token, avatarRequest("mala"));
      assert.equal(created.status, 201);
      const id = created.body.job.id;
      const up = await user.storage.from("raw-uploads").uploadToSignedUrl(
        `${uid}/mala.jpg`,
        created.body.uploads[0].token,
        JPEG,
        { contentType: "image/jpeg" },
      );
      assert.ifError(up.error);
      await callFn("create-job/uploaded", token, { job_id: id });
      const d = await waitForDispatch(id);
      const failed = await callback({
        job_id: id,
        attempt: 1,
        status: "failed",
        worker_version: "t",
        error: { code: "pose_invalid", message: "arms touching body", retryable: false },
      });
      assert.equal(failed.status, 200, JSON.stringify(failed.body));
      assert.deepEqual(await rawObjects(uid), []);
      const { data: job } = await user.from("jobs").select("status, error, input, output").eq("id", id).single();
      assert.equal(job!.status, "failed");
      assert.equal(job!.error.code, "pose_invalid");
      assert.deepEqual(job!.input, { consent_id: consent!.id }, "A1: la entrada del job fallido se reduce a ids");
      assert.equal(job!.output, null);

      // M2: la URL de subida del worker ya no sirve cuando el job terminó.
      const late = await fetch(d.output_uploads[0].upload_url, {
        method: "PUT",
        headers: { "content-type": "model/gltf-binary" },
        body: GLB,
      });
      await late.body?.cancel();
      assert.notEqual(late.status, 200, "una subida tardía del worker no debe crear ficheros");
      // B5: la URL de subida de la foto tampoco vuelve a servir aunque la foto ya se borró.
      const again = await user.storage.from("raw-uploads").uploadToSignedUrl(
        `${uid}/mala.jpg`,
        created.body.uploads[0].token,
        JPEG,
        { contentType: "image/jpeg" },
      );
      assert.ok(again.error, "la URL de subida de la foto volvió a servir tras cerrar el job");
      assert.deepEqual(await rawObjects(uid), []);
    });

    await t.step("barrido: las fotos de más de 60 min se borran aunque su job no haya terminado", async () => {
      // M2: ni siquiera la clave de servicio sube a raw-uploads algo que ningún job en cola espera.
      const stray = await admin.storage.from("raw-uploads").upload(`${uid}/suelta.jpg`, JPEG, {
        contentType: "image/jpeg",
      });
      assert.ok(stray.error, "Storage aceptó una foto que ningún job espera");
      // Dos jobs con su foto subida que no se marcan como subidos (se quedan en cola).
      for (const n of ["vieja", "nueva"]) {
        const c = await callFn("create-job", token, avatarRequest(n));
        assert.equal(c.status, 201, JSON.stringify(c.body));
        const r = await user.storage.from("raw-uploads").uploadToSignedUrl(
          `${uid}/${n}.jpg`,
          c.body.uploads[0].token,
          JPEG,
          { contentType: "image/jpeg" },
        );
        assert.ifError(r.error);
      }
      await sql`update storage.objects set created_at = now() - interval '61 minutes'
                 where bucket_id = 'raw-uploads' and name = ${uid + "/vieja.jpg"}`;
      const denied = await fetch(`${URL_}/functions/v1/maintenance`, {
        method: "POST",
        headers: { "x-maintenance-secret": "nope" },
        body: '{"tasks":["sweep_raw_uploads"]}',
      });
      assert.equal(denied.status, 401);
      await denied.body?.cancel();
      const res = await fetch(`${URL_}/functions/v1/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-maintenance-secret": MAINTENANCE_SECRET },
        body: JSON.stringify({ tasks: ["sweep_raw_uploads"] }),
      });
      const report = await res.json();
      assert.equal(res.status, 200);
      assert.ok(report.sweep_raw_uploads.removed >= 1);
      assert.deepEqual(await rawObjects(uid), [`${uid}/nueva.jpg`]);
      const gone = await admin.storage.from("raw-uploads").download(`${uid}/vieja.jpg`);
      assert.ok(gone.error, "el fichero barrido sigue descargable");
    });

    await t.step("export-data: DataExport válido, ficheros descargables y solo datos propios", async () => {
      // Otro usuario con datos propios: nada suyo puede aparecer en la exportación.
      const otherEmail = `e2e-other-${crypto.randomUUID()}@test.local`;
      const { data: other, error: oErr } = await admin.auth.admin.createUser({
        email: otherEmail,
        password,
        email_confirm: true,
      });
      assert.ifError(oErr);
      otherId = other.user!.id;
      const otherClient = createClient(URL_, ANON, { auth: { persistSession: false } });
      assert.ifError((await otherClient.auth.signInWithPassword({ email: otherEmail, password })).error);
      const { data: otherConsent } = await otherClient.from("consents")
        .insert({ purpose: "personalization" }).select("id").single();
      const { data: otherGarment } = await otherClient.from("garments").insert({ name: "ajena" }).select("id").single();
      assert.ok(otherConsent && otherGarment);

      // Más datos propios: prenda, preferencias y outfit con miniatura en Storage.
      const { data: garment, error: gErr } = await user.from("garments")
        .insert({ name: "camisa", size_label: "M" }).select("id").single();
      assert.ifError(gErr);
      assert.ifError((await user.from("user_fit_preferences").insert({ default_fit: "relaxed" })).error);
      const preview = await user.storage.from("assets").upload(`${uid}/outfits/p.png`, PNG, {
        contentType: "image/png",
      });
      assert.ifError(preview.error);
      assert.ifError(
        (await user.from("outfits").insert({
          items: [{ garment_id: garment!.id, size_label: "M", layer: 0 }],
          preview_path: `assets/${uid}/outfits/p.png`,
        })).error,
      );

      const anon = await callFn("export-data", null, null, "GET");
      assert.equal(anon.status, 401);
      const wrongMethod = await callFn("export-data", token, {}, "POST");
      assert.equal(wrongMethod.status, 405);
      assert.equal(wrongMethod.body.error.code, "method_not_allowed");

      const res = await callFn("export-data", token, null, "GET");
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.match(res.headers.get("content-disposition") ?? "", /attachment/);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const checked = validateExport.dataExport(res.body);
      assert.ok(checked.ok, JSON.stringify(!checked.ok && checked.errors));
      const exp = res.body as DataExport;

      assert.equal(exp.contracts_version, CONTRACTS_VERSION);
      assert.equal(exp.original_photos_retained, false);
      assert.ok(exp.notes.some((n) => n.includes("fotos originales")));
      assert.equal(
        new Date(exp.signed_urls_expire_at).getTime() - new Date(exp.exported_at).getTime(),
        3600 * 1000,
        "las URLs firmadas duran 1 h",
      );
      assert.equal(exp.account.id, uid);
      assert.equal(exp.account.email, email);
      assert.equal(exp.profile?.id, uid);
      assert.deepEqual(exp.consents.map((c) => c.id), [consent!.id]);
      assert.equal(exp.avatars.length, 1);
      assert.equal(exp.avatars[0].measurements.height_cm, 172);
      assert.deepEqual(exp.garments.map((g) => g.id), [garment!.id]);
      assert.equal(exp.user_fit_preferences?.default_fit, "relaxed");
      assert.equal(exp.outfits.length, 1);
      assert.equal(exp.jobs.length, 4);
      assert.deepEqual(exp.garment_embeddings, []);

      // Solo datos propios: todos los user_id son el suyo y nada del otro usuario aparece.
      const sections = [exp.consents, exp.avatars, exp.color_profiles, exp.garments, exp.fit_results, exp.outfits];
      for (const rows of [...sections, exp.drape_cache]) {
        for (const r of rows as Array<{ user_id: string | null }>) assert.equal(r.user_id, uid);
      }
      const text = JSON.stringify(exp);
      for (const foreign of [otherId, otherConsent!.id, otherGarment!.id]) {
        assert.ok(!text.includes(foreign), "la exportación contiene datos de otro usuario");
      }

      // Sin rutas internas: ni fotos ni referencias storage://. Los jobs se exportan con lo que queda (A1).
      assert.ok(!text.includes("raw-uploads"), "la exportación lleva rutas de raw-uploads");
      assert.ok(!text.includes("storage://"), "la exportación lleva referencias storage://");
      assert.ok(!/"[a-z_]+_paths?"\s*:/.test(text), "la exportación lleva columnas *_path");
      for (const j of exp.jobs) {
        assert.equal((j.input as Record<string, unknown>).photo_path, undefined);
        if (j.status === "succeeded") assert.deepEqual(j.output, { avatar_id: exp.avatars[0].id });
        else assert.equal(j.output, null);
        if (j.status !== "queued") assert.deepEqual(j.input, { consent_id: consent!.id });
      }

      // Las URLs firmadas descargan los ficheros.
      const glb = await fetch(exp.avatars[0].glb_url!);
      assert.equal(glb.status, 200);
      assert.deepEqual(new Uint8Array(await glb.arrayBuffer()), GLB);
      const png = await fetch(exp.outfits[0].preview_url!);
      assert.equal(png.status, 200);
      assert.deepEqual(new Uint8Array(await png.arrayBuffer()), PNG);

      // Cuota: 5 exportaciones por 24 h (ya lleva 1).
      await sql`insert into public.data_export_requests (user_id) select ${uid}::uuid from generate_series(1, 4)`;
      const limited = await callFn("export-data", token, null, "GET");
      assert.equal(limited.status, 429);
      assert.equal(limited.body.error.code, "quota_exceeded");
    });

    await t.step("delete-account: Storage vacío, usuario y filas borrados", async () => {
      const before = await sql`select count(*)::int as n from storage.objects where name like ${uid + "/%"}`;
      assert.ok(before[0].n >= 3, "debería haber foto nueva, GLB del avatar y miniatura");

      const noConfirm = await callFn("delete-account", token, {}, "DELETE");
      assert.equal(noConfirm.status, 400);

      const del = await callFn("delete-account", token, { confirm: "DELETE" }, "DELETE");
      assert.equal(del.status, 200, JSON.stringify(del.body));
      assert.equal(del.body.storage_objects_deleted, before[0].n);

      const after = await sql`select count(*)::int as n from storage.objects where name like ${uid + "/%"}`;
      assert.equal(after[0].n, 0);
      const rows = await sql`
        select (select count(*) from public.profiles where id = ${uid})
             + (select count(*) from public.consents where user_id = ${uid})
             + (select count(*) from public.avatars where user_id = ${uid})
             + (select count(*) from public.jobs where user_id = ${uid})
             + (select count(*) from public.data_export_requests where user_id = ${uid}) as n`;
      assert.equal(Number(rows[0].n), 0);
      const { data: u } = await admin.auth.admin.getUserById(uid);
      assert.equal(u.user, null);
    });

    await t.step("delete-account: el consentimiento queda archivado, seudonimizado y bloqueado (D6)", async () => {
      const hash = await consentHash(uid);
      const archived = await sql`select * from public.consent_records_archive where user_hash = ${hash}`;
      assert.equal(archived.length, 1, "falta el registro archivado del consentimiento");
      const a = archived[0];
      assert.deepEqual(Object.keys(a).sort(), [
        "archived_at",
        "email_hash",
        "granted_at",
        "purpose",
        "text_version",
        "user_hash",
        "withdrawn_at",
      ]);
      assert.equal(a.purpose, "body_scan");
      assert.equal(a.text_version, consent!.text_version);
      assert.equal(a.email_hash, await emailHash(email), "M1: el registro se encuentra por el email de quien reclama");
      assert.ok(!JSON.stringify(a).includes(email), "el archivo contiene el email en claro");
      assert.ok(a.withdrawn_at, "el vigente se archiva con la fecha de la baja como retirada");
      assert.ok(!JSON.stringify(a).includes(uid), "el archivo contiene el user_id en claro");

      // Bloqueado: la API no lo sirve a usuarios; solo service_role lo lee.
      const { data: anonRead, error: anonErr } = await createClient(URL_, ANON, { auth: { persistSession: false } })
        .from("consent_records_archive").select("*");
      assert.ok(anonErr || (anonRead ?? []).length === 0, "anon puede leer el archivo");
      const { data: svcRead, error: svcErr } = await admin.from("consent_records_archive").select("user_hash")
        .eq("user_hash", hash);
      assert.ifError(svcErr);
      assert.equal(svcRead!.length, 1);
    });

    // Limpieza: el otro usuario y los registros archivados que deja el test.
    if (otherId) {
      const hashes = [await consentHash(uid), await consentHash(otherId)];
      assert.ifError((await admin.auth.admin.deleteUser(otherId)).error);
      await sql`delete from public.consent_records_archive where user_hash in ${sql(hashes)}`;
    }
    if (createdConsentSecret) await sql`delete from vault.secrets where name = ${CONSENT_SECRET_NAME}`;

    await worker.shutdown();
    await sql.end();
  },
});
