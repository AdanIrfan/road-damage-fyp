import { z } from "zod";
import { HttpError } from "./httpError.js";

/**
 * Validates request input (body, params or query) with a zod schema.
 * Throws 400 VALIDATION_ERROR with per-field messages if it does not match.
 */
export function parseInput<Schema extends z.ZodType>(schema: Schema, data: unknown): z.output<Schema> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const flattened = z.flattenError(result.error);
    throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", {
      details: { fields: flattened.fieldErrors, formErrors: flattened.formErrors },
    });
  }
  return result.data;
}
