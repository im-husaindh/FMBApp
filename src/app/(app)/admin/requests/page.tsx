import { BackButton } from '@/components/ui/back-button';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone, addDays } from '@/lib/time/cutoff';
import type { ThaliRequestRow } from '@/lib/reports/daily-summary';
import {
  buildRequestListRows,
  filterRequestListRows,
  type ProfileRow,
  type RequestListFilter,
  type RequestListRow,
} from '@/lib/reports/request-list';
import type { RequestStatus } from '@/lib/reports/request-status';

const STATUS_BADGE: Record<RequestStatus, { icon: string; label: string; classes: string }> = {
  thali: { icon: '✓', label: 'Thali', classes: 'bg-green-50 text-green-700 border-green-200' },
  no_thali: { icon: '✕', label: 'No Thali', classes: 'bg-gray-50 text-gray-700 border-gray-200' },
  no_response: { icon: '?', label: 'No Response', classes: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  on_leave: { icon: '⏸', label: 'On Leave', classes: 'bg-blue-50 text-blue-700 border-blue-200' },
};

function StatusBadge({ status }: { status: RequestStatus }) {
  const badge = STATUS_BADGE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold ${badge.classes}`}>
      <span aria-hidden="true">{badge.icon}</span>
      {badge.label}
    </span>
  );
}

function thaliCell(row: RequestListRow): string {
  if (row.status === 'thali') return 'Yes';
  if (row.status === 'no_thali') return 'No';
  return '—';
}

export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; filter?: string; search?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { date: dateParam, filter: filterParam, search: searchParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const errorState = (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <BackButton />
      <h1 className="text-3xl font-bold">Detailed Requests</h1>
      <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load requests. Please try again.
      </p>
    </main>
  );

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const tomorrow = addDays(today, 1);
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : tomorrow;
  const filter = (filterParam ?? 'all') as RequestListFilter;
  const search = searchParam ?? '';

  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, user_code, mobile, email')
    .eq('active', true)
    .order('full_name');
  if (profileError) return errorState;

  const profiles: ProfileRow[] = (profileRows ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    userCode: p.user_code,
    mobile: p.mobile,
    email: p.email,
  }));
  const profileIds = profiles.map((p) => p.id);

  const { data: requestRows, error: requestError } = profileIds.length
    ? await supabase
        .from('thali_requests')
        .select('user_id, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
        .eq('service_date', date)
        .in('user_id', profileIds)
    : { data: [] as { user_id: string; wants_thali: boolean; gravy_portion_id: string | null; rice_portion_id: string | null; roti_quantity: number | null }[], error: null };
  if (requestError) return errorState;

  const requests: ThaliRequestRow[] = (requestRows ?? []).map((r) => ({
    userId: r.user_id,
    wantsThali: r.wants_thali,
    gravyPortionId: r.gravy_portion_id,
    ricePortionId: r.rice_portion_id,
    rotiQuantity: r.roti_quantity,
  }));

  const { data: leaveRows, error: leaveError } = profileIds.length
    ? await supabase
        .from('user_leaves')
        .select('user_id')
        .lte('from_date', date)
        .gte('to_date', date)
        .in('user_id', profileIds)
    : { data: [] as { user_id: string }[], error: null };
  if (leaveError) return errorState;
  const onLeaveUserIds = (leaveRows ?? []).map((l) => l.user_id);

  const { data: gravyOptions, error: gravyError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'gravy')
    .eq('active', true)
    .order('sort_order');
  if (gravyError) return errorState;
  const { data: riceOptions, error: riceError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'rice')
    .eq('active', true)
    .order('sort_order');
  if (riceError) return errorState;

  const allRows = buildRequestListRows(profiles, requests, onLeaveUserIds, gravyOptions ?? [], riceOptions ?? []);
  const rows = filterRequestListRows(allRows, filter, search);

  const filterOptions: { value: RequestListFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'thali', label: 'Thali' },
    { value: 'no_thali', label: 'No Thali' },
    { value: 'no_response', label: 'No Response' },
    { value: 'on_leave', label: 'On Leave' },
    ...(gravyOptions ?? []).map((o) => ({ value: `gravy:${o.id}` as RequestListFilter, label: `Gravy: ${o.label}` })),
    ...(riceOptions ?? []).map((o) => ({ value: `rice:${o.id}` as RequestListFilter, label: `Rice: ${o.label}` })),
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <BackButton />
      <h1 className="text-3xl font-bold">Detailed Requests</h1>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
        <div>
          <label className="text-sm font-semibold" htmlFor="date">
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={date}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor="filter">
            Filter
          </label>
          <select
            id="filter"
            name="filter"
            defaultValue={filter}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            {filterOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-sm font-semibold" htmlFor="search">
            Search
          </label>
          <input
            id="search"
            name="search"
            type="text"
            defaultValue={search}
            placeholder="Name, member ID, mobile, or email"
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
          Apply
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="mt-6 text-lg text-gray-600">No thali requests found.</p>
      ) : (
        <>
          <table className="mt-6 hidden w-full text-left md:table">
            <thead>
              <tr className="border-b border-gray-200 text-sm font-semibold text-gray-600">
                <th className="py-2">User</th>
                <th className="py-2">Thali</th>
                <th className="py-2">Gravy</th>
                <th className="py-2">Rice</th>
                <th className="py-2">Roti</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId} className="border-b border-gray-100 text-lg">
                  <td className="py-3">
                    <span className="font-semibold">{row.fullName}</span>{' '}
                    <span className="text-gray-500">({row.userCode})</span>
                  </td>
                  <td className="py-3">{thaliCell(row)}</td>
                  <td className="py-3">{row.gravyLabel ?? '—'}</td>
                  <td className="py-3">{row.riceLabel ?? '—'}</td>
                  <td className="py-3">{row.rotiQuantity ?? '—'}</td>
                  <td className="py-3">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 space-y-3 md:hidden">
            {rows.map((row) => (
              <div key={row.userId} className="rounded-lg border border-gray-200 p-4 text-lg">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {row.fullName} <span className="text-gray-500">({row.userCode})</span>
                  </span>
                  <StatusBadge status={row.status} />
                </div>
                <div className="mt-2 text-base text-gray-700">
                  Thali: {thaliCell(row)} · Gravy: {row.gravyLabel ?? '—'} · Rice: {row.riceLabel ?? '—'} · Roti:{' '}
                  {row.rotiQuantity ?? '—'}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-6 flex gap-3">
        <Link href="/admin" className="text-lg text-blue-600 underline">
          Back to Dashboard
        </Link>
      </div>
    </main>
  );
}
