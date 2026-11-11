// Validación contra los JSON Schemas de packages/contracts (fuente única de
// verdad, generados desde src/index.ts). No se copian: se importan.

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";

import createJobRequestSchema from "@probador/contracts/schemas/create_job_request.schema.json" with {
  type: "json",
};
import jobCallbackSchema from "@probador/contracts/schemas/job_callback.schema.json" with {
  type: "json",
};
import jobDispatchSchema from "@probador/contracts/schemas/job_dispatch.schema.json" with {
  type: "json",
};

export type {
  CreateJobRequest,
  DrapeJobInput,
  GarmentJobInput,
  Job,
  JobCallback,
  JobDispatch,
  JobError,
  JobType,
  SignedUpload,
} from "@probador/contracts";
export { CONTRACTS_VERSION, JOB_TYPES } from "@probador/contracts";

import type { CreateJobRequest, JobCallback, JobDispatch, JobType } from "@probador/contracts";

// ajv-formats es CommonJS: según el cargador, el plugin llega como default o como default.default.
type FormatsPlugin = (ajv: Ajv) => Ajv;
const addFormats: FormatsPlugin = (addFormatsModule as unknown as { default?: FormatsPlugin }).default ??
  (addFormatsModule as unknown as FormatsPlugin);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(createJobRequestSchema);
ajv.addSchema(jobCallbackSchema);
ajv.addSchema(jobDispatchSchema);

function compiled(id: string): ValidateFunction {
  const fn = ajv.getSchema(id);
  if (!fn) throw new Error(`schema ${id} not found`);
  return fn;
}

const CALLBACK_ID = (jobCallbackSchema as { $id: string }).$id;

const validators = {
  createJobRequest: compiled((createJobRequestSchema as { $id: string }).$id),
  jobCallback: compiled(CALLBACK_ID),
  jobDispatch: compiled((jobDispatchSchema as { $id: string }).$id),
  output: {
    avatar: compiled(`${CALLBACK_ID}#/definitions/AvatarJobOutput`),
    garment: compiled(`${CALLBACK_ID}#/definitions/GarmentJobOutput`),
    drape: compiled(`${CALLBACK_ID}#/definitions/DrapeJobOutput`),
    color: compiled(`${CALLBACK_ID}#/definitions/ColorJobOutput`),
  } satisfies Record<JobType, ValidateFunction>,
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Array<{ path: string; message: string }> };

function result<T>(fn: ValidateFunction, data: unknown): ValidationResult<T> {
  if (fn(data)) return { ok: true, value: data as T };
  return {
    ok: false,
    errors: (fn.errors ?? []).slice(0, 20).map((e: ErrorObject) => ({
      path: e.instancePath || "/",
      message: e.message ?? "invalid",
    })),
  };
}

export const validate = {
  createJobRequest: (d: unknown) => result<CreateJobRequest>(validators.createJobRequest, d),
  jobCallback: (d: unknown) => result<JobCallback>(validators.jobCallback, d),
  jobDispatch: (d: unknown) => result<JobDispatch>(validators.jobDispatch, d),
  output: (type: JobType, d: unknown) => result<unknown>(validators.output[type], d),
};
