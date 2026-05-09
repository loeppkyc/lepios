import { z } from 'zod'

export const PalletInvoiceInsertSchema = z.object({
  invoice_month: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'invoice_month must be YYYY-MM-DD (first of month)'),
  vendor: z
    .string()
    .min(1, 'vendor is required')
    .max(200)
    .transform((v) => v.trim()),
  pallets_count: z.number().int().positive('pallets_count must be a positive integer'),
  total_cost_incl_gst: z.number().positive('total_cost_incl_gst must be positive'),
  gst_amount: z.number().min(0, 'gst_amount must be >= 0'),
  notes: z.string().max(1000).nullable().optional(),
})

export type PalletInvoiceInsertInput = z.infer<typeof PalletInvoiceInsertSchema>

export const PalletIntakeSchema = z.object({
  source: z
    .string()
    .min(1, 'Source is required')
    .max(300)
    .transform((v) => v.trim()),
  intake_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'intake_date must be YYYY-MM-DD'),
  est_cost_cad: z.number().positive('Estimated cost must be positive').nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
})

export type PalletIntakeInput = z.infer<typeof PalletIntakeSchema>
