import { z } from 'zod';

export const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  mobile: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{7,15}$/)
    .optional()
    .or(z.literal('')),
  email: z.string().trim().email().optional().or(z.literal('')),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
