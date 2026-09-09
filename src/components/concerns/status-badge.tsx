import { CONCERN_STATUSES } from '@/lib/concerns/constants';

export function ConcernStatusBadge({ status }: { status: string }) {
  const badge = CONCERN_STATUSES.find((s) => s.value === status) ?? CONCERN_STATUSES[0];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold ${badge.classes}`}>
      <span aria-hidden="true">{badge.icon}</span>
      {badge.label}
    </span>
  );
}
