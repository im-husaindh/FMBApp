export type ThaliRequestRow = {
  userId: string;
  wantsThali: boolean;
  gravyPortionId: string | null;
  ricePortionId: string | null;
  rotiQuantity: number | null;
};

export type PortionOptionRow = { id: string; label: string };

export type DailySummary = {
  totalUsers: number;
  thaliCount: number;
  noThaliCount: number;
  noResponseCount: number;
  onLeaveCount: number;
  gravyBreakdown: { label: string; count: number }[];
  riceBreakdown: { label: string; count: number }[];
  rotiBreakdown: { quantity: number; count: number }[];
  totalRotis: number;
};

/**
 * A leave day takes precedence over any thali_requests row for that user/date —
 * checked first below — because the RLS/action enforcement (Task 3) only blocks
 * NEW writes; a leave added after a user already submitted a request does not
 * retroactively delete that row, so this function must not trust the row's
 * presence blindly.
 */
export function computeDailySummary(
  activeUserIds: string[],
  requests: ThaliRequestRow[],
  onLeaveUserIds: string[],
  gravyOptions: PortionOptionRow[],
  riceOptions: PortionOptionRow[]
): DailySummary {
  const onLeaveSet = new Set(onLeaveUserIds);
  const requestsByUser = new Map(requests.map((r) => [r.userId, r]));

  let thaliCount = 0;
  let noThaliCount = 0;
  let noResponseCount = 0;
  let onLeaveCount = 0;

  const gravyCounts = new Map<string, number>();
  const riceCounts = new Map<string, number>();
  const rotiCounts = new Map<number, number>();
  let totalRotis = 0;

  for (const userId of activeUserIds) {
    if (onLeaveSet.has(userId)) {
      onLeaveCount++;
      continue;
    }
    const request = requestsByUser.get(userId);
    if (!request) {
      noResponseCount++;
      continue;
    }
    if (!request.wantsThali) {
      noThaliCount++;
      continue;
    }
    thaliCount++;
    if (request.gravyPortionId) {
      gravyCounts.set(request.gravyPortionId, (gravyCounts.get(request.gravyPortionId) ?? 0) + 1);
    }
    if (request.ricePortionId) {
      riceCounts.set(request.ricePortionId, (riceCounts.get(request.ricePortionId) ?? 0) + 1);
    }
    if (request.rotiQuantity !== null) {
      rotiCounts.set(request.rotiQuantity, (rotiCounts.get(request.rotiQuantity) ?? 0) + 1);
      totalRotis += request.rotiQuantity;
    }
  }

  const gravyBreakdown = gravyOptions.map((opt) => ({ label: opt.label, count: gravyCounts.get(opt.id) ?? 0 }));
  const riceBreakdown = riceOptions.map((opt) => ({ label: opt.label, count: riceCounts.get(opt.id) ?? 0 }));
  const rotiBreakdown = Array.from(rotiCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([quantity, count]) => ({ quantity, count }));

  return {
    totalUsers: activeUserIds.length,
    thaliCount,
    noThaliCount,
    noResponseCount,
    onLeaveCount,
    gravyBreakdown,
    riceBreakdown,
    rotiBreakdown,
    totalRotis,
  };
}
