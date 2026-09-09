import { z } from 'zod';

export const concernCreateSchema = z.object({
  concernDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  category: z.enum(['taste', 'quality', 'quantity', 'packaging', 'missing_item', 'menu', 'other']),
  message: z.string().trim().min(1, 'Please describe your concern'),
});
export type ConcernCreateInput = z.infer<typeof concernCreateSchema>;

export const concernReplySchema = z.object({
  newStatus: z.enum(['open', 'reviewing', 'resolved', 'closed']),
  message: z.string().trim().nullable().optional(),
});
export type ConcernReplyInput = z.infer<typeof concernReplySchema>;
