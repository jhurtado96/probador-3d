// Validación de la exportación de datos, DataExport (export-data).

import type { DataExport } from "@probador/contracts";
import dataExportSchema from "@probador/contracts/schemas/data_export.schema.json" with {
  type: "json",
};
import { addSchema, compiled, result } from "./contracts.ts";

const dataExport = compiled(addSchema(dataExportSchema));

export const validate = {
  dataExport: (d: unknown) => result<DataExport>(dataExport, d),
};
