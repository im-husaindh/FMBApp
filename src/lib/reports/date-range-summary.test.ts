import { describe, it, expect } from 'vitest';
import { computeDateRangeSummary } from './date-range-summary';
import type { DailySummary } from './daily-summary';

function makeDay(overrides: Partial<DailySummary>): DailySummary {
  return {
    totalUsers: 10,
    thaliCount: 0,
    noThaliCount: 0,
    noResponseCount: 0,
    onLeaveCount: 0,
    gravyBreakdown: [],
    riceBreakdown: [],
    rotiBreakdown: [],
    totalRotis: 0,
    ...overrides,
  };
}

describe('computeDateRangeSummary', () => {
  it('returns all-zero totals and a zero average for an empty array', () => {
    const summary = computeDateRangeSummary([]);
    expect(summary.totalDays).toBe(0);
    expect(summary.totalThalis).toBe(0);
    expect(summary.averageDailyThalis).toBe(0);
    expect(summary.gravyBreakdown).toEqual([]);
  });

  it('a single day\'s average equals that day\'s thali count', () => {
    const summary = computeDateRangeSummary([makeDay({ thaliCount: 7 })]);
    expect(summary.totalDays).toBe(1);
    expect(summary.totalThalis).toBe(7);
    expect(summary.averageDailyThalis).toBe(7);
  });

  it('sums counts across multiple days and averages correctly', () => {
    const summary = computeDateRangeSummary([
      makeDay({ thaliCount: 4, noThaliCount: 1, noResponseCount: 2, onLeaveCount: 1, totalRotis: 8 }),
      makeDay({ thaliCount: 6, noThaliCount: 0, noResponseCount: 1, onLeaveCount: 2, totalRotis: 12 }),
    ]);
    expect(summary.totalDays).toBe(2);
    expect(summary.totalThalis).toBe(10);
    expect(summary.averageDailyThalis).toBe(5);
    expect(summary.totalNoThali).toBe(1);
    expect(summary.totalNoResponse).toBe(3);
    expect(summary.totalOnLeave).toBe(3);
    expect(summary.totalRotis).toBe(20);
  });

  it('sums portion breakdowns by label/quantity across days', () => {
    const summary = computeDateRangeSummary([
      makeDay({
        gravyBreakdown: [{ label: 'Small', count: 2 }, { label: 'Regular', count: 3 }],
        riceBreakdown: [{ label: 'No Rice', count: 1 }],
        rotiBreakdown: [{ quantity: 2, count: 2 }],
      }),
      makeDay({
        gravyBreakdown: [{ label: 'Small', count: 1 }, { label: 'Regular', count: 0 }],
        riceBreakdown: [{ label: 'No Rice', count: 2 }],
        rotiBreakdown: [{ quantity: 2, count: 1 }, { quantity: 3, count: 1 }],
      }),
    ]);
    expect(summary.gravyBreakdown).toEqual([
      { label: 'Small', count: 3 },
      { label: 'Regular', count: 3 },
    ]);
    expect(summary.riceBreakdown).toEqual([{ label: 'No Rice', count: 3 }]);
    expect(summary.rotiBreakdown).toEqual([
      { quantity: 2, count: 3 },
      { quantity: 3, count: 1 },
    ]);
  });
});
