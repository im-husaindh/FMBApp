import { z } from 'zod';

export function thaliRequestSchema(rotiMin: number, rotiMax: number) {
  return z
    .object({
      serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
      wantsThali: z.enum(['true', 'false']).transform((v) => v === 'true'),
      // .nullable() is required, not just .optional(): FormData.get() returns null
      // (never undefined) for a field the form never included — the "No Thali" form
      // in Task 6 omits these three fields entirely. This is the same class of bug
      // Phase 2 hit twice (a field validated as optional-or-empty-string rejected the
      // `null` FormData.get() actually returns) — fixed here at the schema level so
      // every caller gets it right automatically, instead of requiring every Server
      // Action to remember to coalesce `?? ''` before calling this schema.
      gravyPortionId: z.string().trim().nullable().optional(),
      ricePortionId: z.string().trim().nullable().optional(),
      rotiQuantity: z.string().trim().nullable().optional(),
    })
    .transform((data) => ({
      serviceDate: data.serviceDate,
      wantsThali: data.wantsThali,
      gravyPortionId: data.gravyPortionId || undefined,
      ricePortionId: data.ricePortionId || undefined,
      rotiQuantity: data.rotiQuantity ? Number(data.rotiQuantity) : undefined,
    }))
    .refine(
      (data) =>
        data.wantsThali
          ? !!data.gravyPortionId &&
            !!data.ricePortionId &&
            data.rotiQuantity !== undefined &&
            Number.isInteger(data.rotiQuantity) &&
            data.rotiQuantity >= rotiMin &&
            data.rotiQuantity <= rotiMax
          : !data.gravyPortionId && !data.ricePortionId && data.rotiQuantity === undefined,
      { message: 'Select all portions to confirm a thali, or leave them blank for no thali' }
    );
}

export type ThaliRequestInput = z.infer<ReturnType<typeof thaliRequestSchema>>;
