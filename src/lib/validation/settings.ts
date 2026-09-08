import { z } from 'zod';

export const appSettingUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});
export type AppSettingUpdateInput = z.infer<typeof appSettingUpdateSchema>;
