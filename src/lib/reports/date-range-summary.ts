import type { DailySummary } from './daily-summary';

export type DateRangeSummary = {
  totalDays: number;
  totalThalis: number;
  averageDailyThalis: number;
  totalNoThali: number;
  totalNoResponse: number;
  totalOnLeave: number;
  gravyBreakdown: { label: string; count: number }[];
  riceBreakdown: { label: string; count: number }[];
  rotiBreakdown: { quantity: number; count: number }[];
  totalRotis: number;
};

/**
 * Sums a set of already-computed per-date DailySummary objects into a range
 * total. Does no date arithmetic, leave lookups, or per-user classification
 * itself — each DailySummary is produced by calling computeDailySummary
 * once per date, so the leave-overrides-a-stale-request precedence stays
 * in the one place it's already implemented and tested.
 */
export function computeDateRangeSummary(dailySummaries: DailySummary[]): DateRangeSummary {
  const totalDays = dailySummaries.length;

  let totalThalis = 0;
  let totalNoThali = 0;
  let totalNoResponse = 0;
  let totalOnLeave = 0;
  let totalRotis = 0;

  const gravyCounts = new Map<string, number>();
  const riceCounts = new Map<string, number>();
  const rotiCounts = new Map<number, number>();
  const gravyOrder: string[] = [];
  const riceOrder: string[] = [];

  for (const day of dailySummaries) {
    totalThalis += day.thaliCount;
    totalNoThali += day.noThaliCount;
    totalNoResponse += day.noResponseCount;
    totalOnLeave += day.onLeaveCount;
    totalRotis += day.totalRotis;

    for (const { label, count } of day.gravyBreakdown) {
      if (!gravyCounts.has(label)) gravyOrder.push(label);
      gravyCounts.set(label, (gravyCounts.get(label) ?? 0) + count);
    }
    for (const { label, count } of day.riceBreakdown) {
      if (!riceCounts.has(label)) riceOrder.push(label);
      riceCounts.set(label, (riceCounts.get(label) ?? 0) + count);
    }
    for (const { quantity, count } of day.rotiBreakdown) {
      rotiCounts.set(quantity, (rotiCounts.get(quantity) ?? 0) + count);
    }
  }

  const gravyBreakdown = gravyOrder.map((label) => ({ label, count: gravyCounts.get(label) ?? 0 }));
  const riceBreakdown = riceOrder.map((label) => ({ label, count: riceCounts.get(label) ?? 0 }));
  const rotiBreakdown = Array.from(rotiCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([quantity, count]) => ({ quantity, count }));

  return {
    totalDays,
    totalThalis,
    averageDailyThalis: totalDays > 0 ? totalThalis / totalDays : 0,
    totalNoThali,
    totalNoResponse,
    totalOnLeave,
    gravyBreakdown,
    riceBreakdown,
    rotiBreakdown,
    totalRotis,
  };
}
