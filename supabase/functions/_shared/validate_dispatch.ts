// Validación del despacho al worker: JobDispatch, JobDispatchNotice y JobDispatchFetch
// (create-job y maintenance vía _shared/dispatch.ts; job-dispatch).

import type { JobDispatch, JobDispatchFetch, JobDispatchNotice } from "@probador/contracts";
import jobDispatchSchema from "@probador/contracts/schemas/job_dispatch.schema.json" with {
  type: "json",
};
import jobDispatchNoticeSchema from "@probador/contracts/schemas/job_dispatch_notice.schema.json" with {
  type: "json",
};
import jobDispatchFetchSchema from "@probador/contracts/schemas/job_dispatch_fetch.schema.json" with {
  type: "json",
};
import { addSchema, compiled, result } from "./contracts.ts";

const jobDispatch = compiled(addSchema(jobDispatchSchema));
const jobDispatchNotice = compiled(addSchema(jobDispatchNoticeSchema));
const jobDispatchFetch = compiled(addSchema(jobDispatchFetchSchema));

export const validate = {
  jobDispatch: (d: unknown) => result<JobDispatch>(jobDispatch, d),
  jobDispatchNotice: (d: unknown) => result<JobDispatchNotice>(jobDispatchNotice, d),
  jobDispatchFetch: (d: unknown) => result<JobDispatchFetch>(jobDispatchFetch, d),
};
