// Empaqueta cada Edge Function para desplegarla sin depender de rutas fuera de
// supabase/ (revisión M3: las funciones importan packages/contracts, que está
// fuera de supabase/functions).
//
//   deno run --allow-read --allow-write --allow-run --allow-env supabase/scripts/bundle_functions.ts [función…]
//
// Para cada función deja en supabase/.deploy/<función>/ (ignorado por git):
//   index.js                       código de la función, _shared/ y las constantes de
//                                  packages/contracts/src, en un solo módulo (deno bundle,
//                                  sin minificar); los paquetes npm quedan como imports
//   deno.json                      mapa de imports del despliegue: los npm: fijados de
//                                  functions/deno.json y los schemas en ./contracts/schemas/
//   contracts/schemas/*.json       solo los JSON Schemas que importa la función, sin espacios
//
// Esos ficheros son los que se suben (MCP deploy_edge_function con entrypoint
// index.js e import_map deno.json, o `supabase functions deploy` desde esa carpeta).
// El desarrollo local no cambia: functions/deno.json sigue apuntando a ../../packages/contracts.

const root = new URL("../", import.meta.url).pathname; // supabase/
const functionsDir = `${root}functions`;
const contractsSchemas = `${root}../packages/contracts/schemas`;
const outRoot = `${root}.deploy`;

const FUNCTIONS = ["create-job", "job-callback", "job-dispatch", "delete-account", "export-data", "maintenance"];
const SCHEMA_PREFIX = "@probador/contracts/schemas/";

const devMap = JSON.parse(await Deno.readTextFile(`${functionsDir}/deno.json`)) as { imports: Record<string, string> };
const npmImports = Object.fromEntries(
  Object.entries(devMap.imports).filter(([k, v]) => v.startsWith("npm:") && k !== "postgres"),
);

const selected = Deno.args.length ? Deno.args : FUNCTIONS;
for (const name of selected) {
  if (!FUNCTIONS.includes(name)) throw new Error(`unknown function ${name}`);
  const out = `${outRoot}/${name}`;
  await Deno.remove(out, { recursive: true }).catch(() => {});
  await Deno.mkdir(`${out}/contracts/schemas`, { recursive: true });

  const externals = [...Object.keys(npmImports), "npm:*", `${SCHEMA_PREFIX}*`].flatMap((e) => ["--external", e]);
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--config",
      `${functionsDir}/deno.json`,
      "--platform",
      "deno",
      ...externals,
      "-o",
      `${out}/index.js`,
      `${functionsDir}/${name}/index.ts`,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!(await cmd.output()).success) throw new Error(`deno bundle failed for ${name}`);

  const code = await Deno.readTextFile(`${out}/index.js`);
  const schemas = [...new Set([...code.matchAll(/"@probador\/contracts\/schemas\/([\w.]+\.json)"/g)].map((m) => m[1]))];
  for (const file of schemas) {
    const json = JSON.parse(await Deno.readTextFile(`${contractsSchemas}/${file}`));
    await Deno.writeTextFile(`${out}/contracts/schemas/${file}`, JSON.stringify(json));
  }
  const imports: Record<string, string> = { ...npmImports };
  if (schemas.length) imports[SCHEMA_PREFIX] = "./contracts/schemas/";
  await Deno.writeTextFile(`${out}/deno.json`, JSON.stringify({ imports }, null, 2) + "\n");

  // Ningún import relativo ni de packages/ debe quedar fuera del paquete.
  const leftovers = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
    .filter((s) => !(s in imports) && !s.startsWith(SCHEMA_PREFIX) && !s.startsWith("npm:") && !s.startsWith("node:"));
  if (leftovers.length) throw new Error(`${name}: unresolved imports in bundle: ${leftovers.join(", ")}`);

  const size = (await Deno.stat(`${out}/index.js`)).size;
  console.log(`${name}: index.js ${size} B, schemas: ${schemas.join(", ") || "-"}`);
}
