import { describe, it, expect } from 'vitest';
import { concernCreateSchema, concernReplySchema } from './concern';

describe('concernCreateSchema', () => {
  it('accepts a valid concern', () => {
    const result = concernCreateSchema.safeParse({
      concernDate: '2026-09-10',
      category: 'taste',
      message: 'The gravy was too salty today.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown category', () => {
    const result = concernCreateSchema.safeParse({
      concernDate: '2026-09-10',
      category: 'not_a_category',
      message: 'Something',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty message', () => {
    const result = concernCreateSchema.safeParse({
      concernDate: '2026-09-10',
      category: 'taste',
      message: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid date', () => {
    const result = concernCreateSchema.safeParse({
      concernDate: '10-09-2026',
      category: 'taste',
      message: 'Something',
    });
    expect(result.success).toBe(false);
  });
});

describe('concernReplySchema', () => {
  it('accepts a status with no message (FormData.get() returns null for an empty textarea is not this case, but an absent field is)', () => {
    const result = concernReplySchema.safeParse({ newStatus: 'reviewing', message: null });
    expect(result.success).toBe(true);
  });

  it('accepts a status with a message', () => {
    const result = concernReplySchema.safeParse({ newStatus: 'resolved', message: 'Fixed for tomorrow.' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = concernReplySchema.safeParse({ newStatus: 'archived', message: null });
    expect(result.success).toBe(false);
  });
});
