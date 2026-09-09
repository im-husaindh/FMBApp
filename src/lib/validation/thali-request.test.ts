import { describe, it, expect } from 'vitest';
import { thaliRequestSchema } from './thali-request';

describe('thaliRequestSchema', () => {
  const schema = thaliRequestSchema(0, 6);

  it('accepts wants_thali=false with no portions', () => {
    const result = schema.safeParse({ serviceDate: '2026-09-10', wantsThali: 'false' });
    expect(result.success).toBe(true);
  });

  it('accepts wants_thali=true with all portions within the configured roti range', () => {
    const result = schema.safeParse({
      serviceDate: '2026-09-10',
      wantsThali: 'true',
      gravyPortionId: 'gravy-1',
      ricePortionId: 'rice-1',
      rotiQuantity: '3',
    });
    expect(result.success).toBe(true);
  });

  it('rejects wants_thali=true missing a portion', () => {
    const result = schema.safeParse({
      serviceDate: '2026-09-10',
      wantsThali: 'true',
      gravyPortionId: 'gravy-1',
      rotiQuantity: '3',
    });
    expect(result.success).toBe(false);
  });

  it('rejects wants_thali=false with a portion present', () => {
    const result = schema.safeParse({
      serviceDate: '2026-09-10',
      wantsThali: 'false',
      gravyPortionId: 'gravy-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a roti quantity outside the configured range', () => {
    const result = schema.safeParse({
      serviceDate: '2026-09-10',
      wantsThali: 'true',
      gravyPortionId: 'gravy-1',
      ricePortionId: 'rice-1',
      rotiQuantity: '9',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid service date format', () => {
    const result = schema.safeParse({ serviceDate: '10-09-2026', wantsThali: 'false' });
    expect(result.success).toBe(false);
  });

  it('accepts wants_thali=false when portion fields are null, matching real FormData.get() behavior', () => {
    // FormData.get() returns null (not undefined) for a field that was never in the form —
    // exactly what happens when the "No Thali" form omits the portion inputs entirely.
    const result = schema.safeParse({
      serviceDate: '2026-09-10',
      wantsThali: 'false',
      gravyPortionId: null,
      ricePortionId: null,
      rotiQuantity: null,
    });
    expect(result.success).toBe(true);
  });
});
