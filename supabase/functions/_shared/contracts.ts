// Tipos y constantes de packages/contracts (fuente única de verdad) y el
// validador Ajv común. Los JSON Schemas no se copian: se importan, cada uno en
// su módulo `validate_*.ts`, para que cada Edge Function cargue (y despliegue)
// solo los que usa:
//   validate_create_job.ts  CreateJobRequest                  (create-job)
//   validate_dispatch.ts    JobDispatch, Notice y Fetch       (create-job, job-dispatch, maintenance)
//   validate_callback.ts    JobCallback y salidas por tipo    (job-callback)
//   validate_export.ts      DataExport                        (export-data)

import { Ajv, type AnySchema, type ErrorObject, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";

export type {
  ApiErrorBody,
  ApiErrorCode,
  CreateJobRequest,
  CreateJobResponse,
  DataExport,
  DataExportGarmentEmbedding,
  DataExportJob,
  DataExportJobInput,
  DrapeJobContext,
  DrapeJobInput,
  GarmentJobInput,
  Job,
  JobCallback,
  JobDispatch,
  JobDispatchFetch,
  JobDispatchNotice,
  JobError,
  JobResult,
  JobType,
  SignedUpload,
  UploadTicket,
} from "@probador/contracts";
export {
  CONTRACTS_VERSION,
  DATA_EXPORT_FORMAT,
  DATA_EXPORT_SIGNED_URL_TTL_SECONDS,
  GARMENT_EMBEDDING_DIMENSIONS,
  JOB_RETENTION_DAYS,
  JOB_TYPES,
} from "@probador/contracts";

// ajv-formats es CommonJS: según el cargador, el plugin llega como default o como default.default.
type FormatsPlugin = (ajv: Ajv) => Ajv;
const addFormats: FormatsPlugin = (addFormatsModule as unknown as { default?: FormatsPlugin }).default ??
  (addFormatsModule as unknown as FormatsPlugin);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

/** Registra un JSON Schema del contrato (una vez por módulo) y devuelve su `$id`. */
export function addSchema(schema: unknown): string {
  const id = (schema as { $id: string }).$id;
  if (!ajv.getSchema(id)) ajv.addSchema(schema as AnySchema);
  return id;
}

/** Validador compilado de un schema registrado (o de una de sus `#/definitions/...`). */
export function compiled(id: string): ValidateFunction {
  const fn = ajv.getSchema(id);
  if (!fn) throw new Error(`schema ${id} not found`);
  return fn;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Array<{ path: string; message: string }> };

export function result<T>(fn: ValidateFunction, data: unknown): ValidationResult<T> {
  if (fn(data)) return { ok: true, value: data as T };
  return {
    ok: false,
    errors: (fn.errors ?? []).slice(0, 20).map((e: ErrorObject) => ({
      path: e.instancePath || "/",
      message: e.message ?? "invalid",
    })),
  };
}
