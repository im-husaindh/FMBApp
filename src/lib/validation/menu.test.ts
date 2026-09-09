import { describe, it, expect } from 'vitest';
import { menuVersionCreateSchema, rejectMenuVersionSchema } from './menu';

describe('menuVersionCreateSchema', () => {
  it('accepts a valid menu with at least one item', () => {
    const result = menuVersionCreateSchema.safeParse({
      serviceDate: '2026-09-10',
      title: 'Wednesday Special',
      items: [{ itemName: 'Dal Fry', category: 'dal', displayOrder: 0 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a menu with zero items', () => {
    const result = menuVersionCreateSchema.safeParse({
      serviceDate: '2026-09-10',
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid category', () => {
    const result = menuVersionCreateSchema.safeParse({
      serviceDate: '2026-09-10',
      items: [{ itemName: 'X', category: 'dessert', displayOrder: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('rejectMenuVersionSchema', () => {
  it('rejects an empty reason', () => {
    const result = rejectMenuVersionSchema.safeParse({
      versionId: '00000000-0000-0000-0000-000000000000',
      reason: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a non-empty reason', () => {
    const result = rejectMenuVersionSchema.safeParse({
      versionId: '00000000-0000-0000-0000-000000000000',
      reason: 'Please add a sweet item.',
    });
    expect(result.success).toBe(true);
  });
});
