import { z } from 'zod'

export const CogsEntryInsertSchema = z
  .object({
    asin: z
      .string()
      .min(1)
      .max(20)
      .regex(/^[A-Z0-9]+$/, 'ASIN must be uppercase alphanumeric'),
    pricing_model: z.enum(['per_unit', 'pallet']).default('per_unit'),
    unit_cost_cad: z.number().positive().nullable().optional(),
    quantity: z.number().int().positive().default(1),
    purchased_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'purchased_at must be YYYY-MM-DD'),
    vendor: z.string().max(200).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    source: z.enum(['manual', 'sellerboard_import', 'receipt_ocr']).default('manual'),
    created_by: z.string().max(100).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.pricing_model === 'per_unit' && !data.unit_cost_cad) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unit_cost_cad'],
        message: 'unit_cost_cad is required for per_unit entries',
      })
    }
    if (data.pricing_model === 'pallet' && data.unit_cost_cad != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unit_cost_cad'],
        message: 'pallet entries must have unit_cost_cad = null',
      })
    }
  })

export const CogsQuerySchema = z.object({
  asin: z.string().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  vendor: z.string().optional(),
  source: z.enum(['manual', 'sellerboard_import', 'receipt_ocr']).optional(),
  pricing_model: z.enum(['per_unit', 'pallet']).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
})

export type CogsEntryInsertInput = z.infer<typeof CogsEntryInsertSchema>
export type CogsQueryInput = z.infer<typeof CogsQuerySchema>
