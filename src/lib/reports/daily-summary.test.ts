import { describe, it, expect } from 'vitest';
import { computeDailySummary } from './daily-summary';

describe('computeDailySummary', () => {
  const gravyOptions = [
    { id: 'g1', label: 'Small' },
    { id: 'g2', label: 'Regular' },
  ];
  const riceOptions = [
    { id: 'r1', label: 'No Rice' },
    { id: 'r2', label: 'Small' },
  ];

  it('counts a user with a thali request into the portion breakdowns', () => {
    const summary = computeDailySummary(
      ['u1'],
      [{ userId: 'u1', wantsThali: true, gravyPortionId: 'g1', ricePortionId: 'r1', rotiQuantity: 2 }],
      [],
      gravyOptions,
      riceOptions
    );
    expect(summary.thaliCount).toBe(1);
    expect(summary.gravyBreakdown).toEqual([
      { label: 'Small', count: 1 },
      { label: 'Regular', count: 0 },
    ]);
    expect(summary.totalRotis).toBe(2);
  });

  it('counts a user with wants_thali=false as no-thali', () => {
    const summary = computeDailySummary(
      ['u1'],
      [{ userId: 'u1', wantsThali: false, gravyPortionId: null, ricePortionId: null, rotiQuantity: null }],
      [],
      gravyOptions,
      riceOptions
    );
    expect(summary.noThaliCount).toBe(1);
    expect(summary.thaliCount).toBe(0);
  });

  it('counts a user with no request row and not on leave as no-response', () => {
    const summary = computeDailySummary(['u1'], [], [], gravyOptions, riceOptions);
    expect(summary.noResponseCount).toBe(1);
  });

  it('counts a user on leave as on-leave, even if they have a stale thali request row', () => {
    const summary = computeDailySummary(
      ['u1'],
      [{ userId: 'u1', wantsThali: true, gravyPortionId: 'g1', ricePortionId: 'r1', rotiQuantity: 2 }],
      ['u1'],
      gravyOptions,
      riceOptions
    );
    expect(summary.onLeaveCount).toBe(1);
    expect(summary.thaliCount).toBe(0);
    expect(summary.gravyBreakdown).toEqual([
      { label: 'Small', count: 0 },
      { label: 'Regular', count: 0 },
    ]);
  });

  it('produces a roti breakdown sorted by quantity', () => {
    const summary = computeDailySummary(
      ['u1', 'u2'],
      [
        { userId: 'u1', wantsThali: true, gravyPortionId: 'g1', ricePortionId: 'r1', rotiQuantity: 3 },
        { userId: 'u2', wantsThali: true, gravyPortionId: 'g1', ricePortionId: 'r1', rotiQuantity: 1 },
      ],
      [],
      gravyOptions,
      riceOptions
    );
    expect(summary.rotiBreakdown).toEqual([
      { quantity: 1, count: 1 },
      { quantity: 3, count: 1 },
    ]);
    expect(summary.totalRotis).toBe(4);
  });
});
