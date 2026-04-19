import { z } from 'zod'

export const CreateListSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(80, 'name must be 80 characters or fewer'),
})

export const AddItemsSchema = z.object({
  isbns: z.array(z.string()).max(200, 'max 200 ISBNs per request'),
})
