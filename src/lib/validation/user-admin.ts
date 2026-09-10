import { z } from 'zod';

export const inviteUserSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required'),
  email: z.string().trim().email('Enter a valid email address'),
  userCode: z.string().trim().min(1, 'Member ID is required'),
  role: z.enum(['user', 'admin', 'super_admin']),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required'),
  mobile: z.string().trim().nullable().optional(),
  email: z.string().trim().email('Enter a valid email address'),
  role: z.enum(['user', 'admin', 'super_admin']),
  active: z.enum(['true', 'false']).transform((v) => v === 'true'),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
