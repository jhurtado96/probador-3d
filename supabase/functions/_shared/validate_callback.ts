// Validación de JobCallback y de la salida de cada tipo de job (job-callback).

import type { JobCallback, JobType } from "@probador/contracts";
import type { ValidateFunction } from "ajv";
import jobCallbackSchema from "@probador/contracts/schemas/job_callback.schema.json" with {
  type: "json",
};
import { addSchema, compiled, result } from "./contracts.ts";

const CALLBACK_ID = addSchema(jobCallbackSchema);
const jobCallback = compiled(CALLBACK_ID);
const output = {
  avatar: compiled(`${CALLBACK_ID}#/definitions/AvatarJobOutput`),
  garment: compiled(`${CALLBACK_ID}#/definitions/GarmentJobOutput`),
  drape: compiled(`${CALLBACK_ID}#/definitions/DrapeJobOutput`),
  color: compiled(`${CALLBACK_ID}#/definitions/ColorJobOutput`),
} satisfies Record<JobType, ValidateFunction>;

export const validate = {
  jobCallback: (d: unknown) => result<JobCallback>(jobCallback, d),
  output: (type: JobType, d: unknown) => result<unknown>(output[type], d),
};
