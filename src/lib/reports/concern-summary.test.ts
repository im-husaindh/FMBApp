import { describe, it, expect } from 'vitest';
import { computeConcernSummary } from './concern-summary';

describe('computeConcernSummary', () => {
  it('returns zero totals and every category/status at 0 for an empty array', () => {
    const summary = computeConcernSummary([]);
    expect(summary.totalConcerns).toBe(0);
    expect(summary.byCategory.every((c) => c.count === 0)).toBe(true);
    expect(summary.byStatus.every((s) => s.count === 0)).toBe(true);
    expect(summary.byCategory).toHaveLength(7);
    expect(summary.byStatus).toHaveLength(4);
  });

  it('counts by category and by status, including zero-count entries', () => {
    const summary = computeConcernSummary([
      { category: 'taste', status: 'open' },
      { category: 'taste', status: 'resolved' },
      { category: 'quantity', status: 'open' },
    ]);
    expect(summary.totalConcerns).toBe(3);

    const taste = summary.byCategory.find((c) => c.category === 'Taste');
    expect(taste?.count).toBe(2);
    const quantity = summary.byCategory.find((c) => c.category === 'Quantity');
    expect(quantity?.count).toBe(1);
    const packaging = summary.byCategory.find((c) => c.category === 'Packaging');
    expect(packaging?.count).toBe(0);

    const open = summary.byStatus.find((s) => s.status === 'Open');
    expect(open?.count).toBe(2);
    const resolved = summary.byStatus.find((s) => s.status === 'Resolved');
    expect(resolved?.count).toBe(1);
    const closed = summary.byStatus.find((s) => s.status === 'Closed');
    expect(closed?.count).toBe(0);
  });
});
