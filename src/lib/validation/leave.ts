import { z } from 'zod';

export const leaveCreateSchema = z
  .object({
    userId: z.string().trim().min(1, 'Select a user'),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
    reason: z.string().trim().nullable().optional(),
  })
  .refine((data) => data.toDate >= data.fromDate, {
    message: 'End date must be on or after the start date',
    path: ['toDate'],
  });
export type LeaveCreateInput = z.infer<typeof leaveCreateSchema>;

export const serviceHolidayCreateSchema = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  reason: z.string().trim().min(1, 'A reason is required'),
});
export type ServiceHolidayCreateInput = z.infer<typeof serviceHolidayCreateSchema>;
