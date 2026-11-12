// Validación de CreateJobRequest (create-job).

import type { CreateJobRequest } from "@probador/contracts";
import createJobRequestSchema from "@probador/contracts/schemas/create_job_request.schema.json" with {
  type: "json",
};
import { addSchema, compiled, result } from "./contracts.ts";

const createJobRequest = compiled(addSchema(createJobRequestSchema));

export const validate = {
  createJobRequest: (d: unknown) => result<CreateJobRequest>(createJobRequest, d),
};
