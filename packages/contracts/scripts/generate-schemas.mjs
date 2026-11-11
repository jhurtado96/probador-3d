// Genera schemas/*.schema.json desde src/index.ts y valida los ejemplos.
// Con --check no escribe: falla si lo generado difiere de lo que hay en disco.
import { createGenerator } from "ts-json-schema-generator";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "schemas");
const check = process.argv.includes("--check");

const TYPES = [
  "Profile",
  "Consent",
  "UserFitPreferences",
  "DrapeCache",
  "CreateJobResponse",
  "ApiErrorBody",
  "BodyMeasurements",
  "Avatar",
  "ColorProfile",
  "Garment",
  "FitResult",
  "Outfit",
  "StoreProduct",
  "Job",
  "CreateJobRequest",
  "JobDispatch",
  "JobDispatchNotice",
  "JobDispatchFetch",
  "JobCallback",
  "ConsentText",
  "DataExport",
];

const generator = createGenerator({
  path: join(root, "src/index.ts"),
  tsconfig: join(root, "tsconfig.json"),
  expose: "export",
  topRef: false,
  additionalProperties: false,
  skipTypeCheck: false,
});

const toSnake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

mkdirSync(outDir, { recursive: true });
let stale = 0;
const validators = {};
for (const type of TYPES) {
  const schema = generator.createSchema(type);
  schema.$id = `https://probador.app/schemas/${toSnake(type)}.schema.json`;
  schema.title = type;
  validators[type] = ajv.compile(schema);
  const file = join(outDir, `${toSnake(type)}.schema.json`);
  const text = JSON.stringify(schema, null, 2) + "\n";
  if (check) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
      console.error(`desactualizado: ${file}`);
      stale++;
    }
  } else {
    writeFileSync(file, text);
    console.log(`escrito ${file}`);
  }
}

// Ejemplos: examples/<Tipo>.<nombre>.json debe validar contra <Tipo>.
let bad = 0;
const exDir = join(root, "examples");
for (const f of existsSync(exDir) ? readdirSync(exDir) : []) {
  if (!f.endsWith(".json")) continue;
  const type = f.split(".")[0];
  const validate = validators[type];
  if (!validate) {
    console.error(`ejemplo sin tipo conocido: ${f}`);
    bad++;
    continue;
  }
  if (validate(JSON.parse(readFileSync(join(exDir, f), "utf8")))) {
    console.log(`ok ${f}`);
  } else {
    console.error(`ejemplo inválido ${f}:`, JSON.stringify(validate.errors, null, 2));
    bad++;
  }
}

if (stale || bad) {
  if (stale) console.error("Ejecuta `npm run schemas` y vuelve a comprobar.");
  process.exit(1);
}

// Vector de prueba de la firma: lo comparten los tests de workers y de Supabase.
{
  const { createHmac } = await import("node:crypto");
  const v = JSON.parse(readFileSync(join(root, "fixtures", "signature-vector.json"), "utf8"));
  const expected = "sha256=" + createHmac("sha256", v.secret).update(`${v.timestamp}.${v.body}`, "utf8").digest("hex");
  if (expected !== v.signature) {
    console.error("fixtures/signature-vector.json: la firma no corresponde al secreto, timestamp y cuerpo");
    process.exit(1);
  }
  console.log("ok fixtures/signature-vector.json");
}
