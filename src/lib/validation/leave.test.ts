import { describe, it, expect } from 'vitest';
import { leaveCreateSchema, serviceHolidayCreateSchema } from './leave';

describe('leaveCreateSchema', () => {
  it('accepts a valid leave range with a reason', () => {
    const result = leaveCreateSchema.safeParse({
      userId: 'some-user-id',
      fromDate: '2026-09-10',
      toDate: '2026-09-12',
      reason: 'Family event',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a leave range with no reason field at all (FormData.get() returns null)', () => {
    const result = leaveCreateSchema.safeParse({
      userId: 'some-user-id',
      fromDate: '2026-09-10',
      toDate: '2026-09-12',
      reason: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a toDate before fromDate', () => {
    const result = leaveCreateSchema.safeParse({
      userId: 'some-user-id',
      fromDate: '2026-09-12',
      toDate: '2026-09-10',
      reason: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty userId', () => {
    const result = leaveCreateSchema.safeParse({
      userId: '',
      fromDate: '2026-09-10',
      toDate: '2026-09-12',
      reason: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('serviceHolidayCreateSchema', () => {
  it('accepts a valid date and reason', () => {
    const result = serviceHolidayCreateSchema.safeParse({
      serviceDate: '2026-09-20',
      reason: 'Community Event',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty reason', () => {
    const result = serviceHolidayCreateSchema.safeParse({
      serviceDate: '2026-09-20',
      reason: '   ',
    });
    expect(result.success).toBe(false);
  });
});
