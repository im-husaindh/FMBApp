import { z } from 'zod';

export const MENU_ITEM_CATEGORIES = [
  'gravy', 'dal', 'rice', 'roti', 'vegetable', 'salad', 'sweet', 'other',
] as const;

export const menuItemSchema = z.object({
  itemName: z.string().trim().min(1, 'Item name is required'),
  category: z.enum(MENU_ITEM_CATEGORIES),
  description: z.string().trim().optional().or(z.literal('')),
  displayOrder: z.number().int().min(0).default(0),
});
export type MenuItemInput = z.infer<typeof menuItemSchema>;

export const menuVersionCreateSchema = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  title: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().optional().or(z.literal('')),
  items: z.array(menuItemSchema).min(1, 'Add at least one item'),
});
export type MenuVersionCreateInput = z.infer<typeof menuVersionCreateSchema>;

export const rejectMenuVersionSchema = z.object({
  versionId: z.string().uuid(),
  reason: z.string().trim().min(1, 'A rejection reason is required'),
});
export type RejectMenuVersionInput = z.infer<typeof rejectMenuVersionSchema>;
