import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone, addDays } from '@/lib/time/cutoff';
import { computeDailySummary, type ThaliRequestRow } from '@/lib/reports/daily-summary';
import { computeDateRangeSummary } from '@/lib/reports/date-range-summary';

const MAX_RANGE_DAYS = 90;

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export default async function DateRangeReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { from: fromParam, to: toParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const defaultFrom = addDays(today, -6);

  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : defaultFrom;
  const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : today;

  const form = (
    <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
      <div>
        <label className="text-sm font-semibold" htmlFor="from">
          From
        </label>
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={from}
          className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
        />
      </div>
      <div>
        <label className="text-sm font-semibold" htmlFor="to">
          To
        </label>
        <input
          id="to"
          name="to"
          type="date"
          defaultValue={to}
          className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
        />
      </div>
      <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
        View
      </button>
    </form>
  );

  const header = (
    <>
      <Link href="/admin/reports" className="text-lg text-blue-600 underline">
        ← Back to Reports
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Date Range Report</h1>
      {form}
    </>
  );

  if (from > to) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        {header}
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          The start date must be on or before the end date.
        </p>
      </main>
    );
  }

  const dates = datesBetween(from, to);
  if (dates.length > MAX_RANGE_DAYS) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        {header}
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Please choose a range of {MAX_RANGE_DAYS} days or fewer.
        </p>
      </main>
    );
  }

  const errorState = (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {header}
      <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load this report. Please try again.
      </p>
    </main>
  );

  const { data: activeUsers, error: activeUsersError } = await supabase
    .from('profiles')
    .select('id')
    .eq('active', true);
  if (activeUsersError) return errorState;
  const activeUserIds = (activeUsers ?? []).map((u) => u.id);

  const { data: requestRows, error: requestRowsError } = activeUserIds.length
    ? await supabase
        .from('thali_requests')
        .select('user_id, service_date, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
        .gte('service_date', from)
        .lte('service_date', to)
        .in('user_id', activeUserIds)
    : {
        data: [] as {
          user_id: string;
          service_date: string;
          wants_thali: boolean;
          gravy_portion_id: string | null;
          rice_portion_id: string | null;
          roti_quantity: number | null;
        }[],
        error: null,
      };
  if (requestRowsError) return errorState;

  const { data: leaveRows, error: leaveRowsError } = activeUserIds.length
    ? await supabase
        .from('user_leaves')
        .select('user_id, from_date, to_date')
        .lte('from_date', to)
        .gte('to_date', from)
        .in('user_id', activeUserIds)
    : { data: [] as { user_id: string; from_date: string; to_date: string }[], error: null };
  if (leaveRowsError) return errorState;

  const { data: gravyOptions, error: gravyOptionsError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'gravy')
    .eq('active', true)
    .order('sort_order');
  if (gravyOptionsError) return errorState;
  const { data: riceOptions, error: riceOptionsError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'rice')
    .eq('active', true)
    .order('sort_order');
  if (riceOptionsError) return errorState;

  const requestsByDate = new Map<string, ThaliRequestRow[]>();
  for (const r of requestRows ?? []) {
    const row: ThaliRequestRow = {
      userId: r.user_id,
      wantsThali: r.wants_thali,
      gravyPortionId: r.gravy_portion_id,
      ricePortionId: r.rice_portion_id,
      rotiQuantity: r.roti_quantity,
    };
    const list = requestsByDate.get(r.service_date) ?? [];
    list.push(row);
    requestsByDate.set(r.service_date, list);
  }

  const dailySummaries = dates.map((date) => {
    const onLeaveUserIds = (leaveRows ?? [])
      .filter((l) => l.from_date <= date && date <= l.to_date)
      .map((l) => l.user_id);
    return computeDailySummary(
      activeUserIds,
      requestsByDate.get(date) ?? [],
      onLeaveUserIds,
      gravyOptions ?? [],
      riceOptions ?? []
    );
  });

  const summary = computeDateRangeSummary(dailySummaries);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {header}

      {activeUserIds.length === 0 ? (
        <p className="mt-6 text-lg text-gray-600">No data found for this period.</p>
      ) : (
        <>
          <table className="mt-6 w-full text-left">
            <tbody className="text-lg">
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Total Days</td>
                <td className="py-2">{summary.totalDays}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Total Thalis</td>
                <td className="py-2">{summary.totalThalis}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Average Daily Thalis</td>
                <td className="py-2">{summary.averageDailyThalis.toFixed(1)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">No Thali</td>
                <td className="py-2">{summary.totalNoThali}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">No Response</td>
                <td className="py-2">{summary.totalNoResponse}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Leave</td>
                <td className="py-2">{summary.totalOnLeave}</td>
              </tr>
              <tr>
                <td className="py-2 font-semibold">Total Roti</td>
                <td className="py-2">{summary.totalRotis}</td>
              </tr>
            </tbody>
          </table>

          <h2 className="mt-6 text-xl font-bold">Gravy Distribution</h2>
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.gravyBreakdown.map((b) => (
                <tr key={b.label} className="border-b border-gray-100">
                  <td className="py-2">{b.label}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="mt-6 text-xl font-bold">Rice Distribution</h2>
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.riceBreakdown.map((b) => (
                <tr key={b.label} className="border-b border-gray-100">
                  <td className="py-2">{b.label}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="mt-6 text-xl font-bold">Roti Distribution</h2>
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.rotiBreakdown.map((b) => (
                <tr key={b.quantity} className="border-b border-gray-100">
                  <td className="py-2">{b.quantity}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
