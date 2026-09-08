import { describe, it, expect } from 'vitest';
import { cutoffInstant, isBeforeCutoff } from './cutoff';

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
