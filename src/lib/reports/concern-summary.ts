import { CONCERN_CATEGORIES, CONCERN_STATUSES } from '@/lib/concerns/constants';

export type ConcernRow = { category: string; status: string };

export type ConcernSummary = {
  totalConcerns: number;
  byCategory: { category: string; count: number }[];
  byStatus: { status: string; count: number }[];
};

export function computeConcernSummary(concerns: ConcernRow[]): ConcernSummary {
  const categoryCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();

  for (const c of concerns) {
    categoryCounts.set(c.category, (categoryCounts.get(c.category) ?? 0) + 1);
    statusCounts.set(c.status, (statusCounts.get(c.status) ?? 0) + 1);
  }

  const byCategory = CONCERN_CATEGORIES.map((cat) => ({
    category: cat.label,
    count: categoryCounts.get(cat.value) ?? 0,
  }));
  const byStatus = CONCERN_STATUSES.map((st) => ({
    status: st.label,
    count: statusCounts.get(st.value) ?? 0,
  }));

  return {
    totalConcerns: concerns.length,
    byCategory,
    byStatus,
  };
}
