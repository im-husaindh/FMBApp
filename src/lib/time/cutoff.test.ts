import { describe, it, expect } from 'vitest';
import { cutoffInstant, isBeforeCutoff, todayInTimezone, serviceDateRange, addDays } from './cutoff';

describe('cutoffInstant', () => {
  it('computes 6pm IST on the previous day as the correct UTC instant', () => {
    // Service date Wed 2026-09-09 -> cutoff Tue 2026-09-08 18:00 IST (+05:30) = 12:30 UTC
    const instant = cutoffInstant('2026-09-09', 'Asia/Kolkata', '18:00');
    expect(instant.toISOString()).toBe('2026-09-08T12:30:00.000Z');
  });
});

describe('isBeforeCutoff', () => {
  it('returns true just before cutoff', () => {
    const justBefore = new Date('2026-09-08T12:29:59.000Z');
    expect(isBeforeCutoff('2026-09-09', 'Asia/Kolkata', '18:00', justBefore)).toBe(true);
  });

  it('returns false exactly at and after cutoff', () => {
    const atCutoff = new Date('2026-09-08T12:30:00.000Z');
    expect(isBeforeCutoff('2026-09-09', 'Asia/Kolkata', '18:00', atCutoff)).toBe(false);
    const after = new Date('2026-09-08T13:00:00.000Z');
    expect(isBeforeCutoff('2026-09-09', 'Asia/Kolkata', '18:00', after)).toBe(false);
  });

  it('is independent of the host machine timezone', () => {
    // No Date/Intl call in the implementation may read the host's local timezone.
    // Pick an instant where Kolkata and New York genuinely disagree: Kolkata's
    // cutoff (2026-09-08T12:30:00Z) has already passed, but New York's cutoff
    // (EDT, 2026-09-08T22:00:00Z) has not.
    const probe = new Date('2026-09-08T13:00:00.000Z');
    expect(isBeforeCutoff('2026-09-09', 'Asia/Kolkata', '18:00', probe)).toBe(false);
    expect(isBeforeCutoff('2026-09-09', 'America/New_York', '18:00', probe)).toBe(true);
  });
});

describe('todayInTimezone', () => {
  it('returns the next calendar day in IST when UTC is still on the previous day', () => {
    // 2026-09-09T20:00:00Z = 2026-09-10 01:30 IST
    expect(todayInTimezone('Asia/Kolkata', new Date('2026-09-09T20:00:00Z'))).toBe('2026-09-10');
  });

  it('returns the same calendar day in IST for a UTC morning instant', () => {
    // 2026-09-09T10:00:00Z = 2026-09-09 15:30 IST
    expect(todayInTimezone('Asia/Kolkata', new Date('2026-09-09T10:00:00Z'))).toBe('2026-09-09');
  });
});

describe('serviceDateRange', () => {
  it('returns an inclusive range spanning daysBefore through daysAfter today', () => {
    const result = serviceDateRange('Asia/Kolkata', 3, 7, new Date('2026-09-09T10:00:00Z'));
    expect(result).toHaveLength(11);
    expect(result[0]).toBe('2026-09-06');
    expect(result[3]).toBe('2026-09-09');
    expect(result[10]).toBe('2026-09-16');
  });
});

describe('addDays', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('subtracts days with a negative value', () => {
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });
});
