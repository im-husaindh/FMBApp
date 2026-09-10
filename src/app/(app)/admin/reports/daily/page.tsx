import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone, addDays } from '@/lib/time/cutoff';
import { computeDailySummary, type ThaliRequestRow } from '@/lib/reports/daily-summary';

export default async function DailyThaliReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { date: dateParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const errorState = (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Daily Thali Report</h1>
      <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load this report. Please try again.
      </p>
    </main>
  );

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const tomorrow = addDays(today, 1);
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : tomorrow;

  const { data: activeUsers, error: activeUsersError } = await supabase
    .from('profiles')
    .select('id')
    .eq('active', true);
  if (activeUsersError) return errorState;
  const activeUserIds = (activeUsers ?? []).map((u) => u.id);

  const { data: requestRows, error: requestRowsError } = activeUserIds.length
    ? await supabase
        .from('thali_requests')
        .select('user_id, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
        .eq('service_date', date)
        .in('user_id', activeUserIds)
    : {
        data: [] as {
          user_id: string;
          wants_thali: boolean;
          gravy_portion_id: string | null;
          rice_portion_id: string | null;
          roti_quantity: number | null;
        }[],
        error: null,
      };
  if (requestRowsError) return errorState;

  const requests: ThaliRequestRow[] = (requestRows ?? []).map((r) => ({
    userId: r.user_id,
    wantsThali: r.wants_thali,
    gravyPortionId: r.gravy_portion_id,
    ricePortionId: r.rice_portion_id,
    rotiQuantity: r.roti_quantity,
  }));

  const { data: leaveRows, error: leaveRowsError } = activeUserIds.length
    ? await supabase
        .from('user_leaves')
        .select('user_id')
        .lte('from_date', date)
        .gte('to_date', date)
        .in('user_id', activeUserIds)
    : { data: [] as { user_id: string }[], error: null };
  if (leaveRowsError) return errorState;
  const onLeaveUserIds = (leaveRows ?? []).map((l) => l.user_id);

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

  const summary = computeDailySummary(activeUserIds, requests, onLeaveUserIds, gravyOptions ?? [], riceOptions ?? []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/reports" className="text-lg text-blue-600 underline">
        ← Back to Reports
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Daily Thali Report</h1>

      <form method="get" className="mt-6 flex items-end gap-3 rounded-xl border border-gray-200 p-4">
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
        <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
          View
        </button>
      </form>

      <table className="mt-6 w-full text-left">
        <tbody className="text-lg">
          <tr className="border-b border-gray-100">
            <th scope="row" className="py-2 text-left font-semibold">Date</th>
            <td className="py-2">{date}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <th scope="row" className="py-2 text-left font-semibold">Total Active Users</th>
            <td className="py-2">{summary.totalUsers}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <th scope="row" className="py-2 text-left font-semibold">Thali Requested</th>
            <td className="py-2">{summary.thaliCount}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <th scope="row" className="py-2 text-left font-semibold">No Thali</th>
            <td className="py-2">{summary.noThaliCount}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <th scope="row" className="py-2 text-left font-semibold">No Response</th>
            <td className="py-2">{summary.noResponseCount}</td>
          </tr>
          <tr>
            <th scope="row" className="py-2 text-left font-semibold">Leave</th>
            <td className="py-2">{summary.onLeaveCount}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-6 text-xl font-bold">Gravy</h2>
      <table className="mt-2 w-full text-left">
        <tbody className="text-lg">
          {summary.gravyBreakdown.map((b) => (
            <tr key={b.label} className="border-b border-gray-100">
              <th scope="row" className="py-2 text-left font-normal">{b.label}</th>
              <td className="py-2">{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-6 text-xl font-bold">Rice</h2>
      <table className="mt-2 w-full text-left">
        <tbody className="text-lg">
          {summary.riceBreakdown.map((b) => (
            <tr key={b.label} className="border-b border-gray-100">
              <th scope="row" className="py-2 text-left font-normal">{b.label}</th>
              <td className="py-2">{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-6 text-xl font-bold">Roti</h2>
      <table className="mt-2 w-full text-left">
        <tbody className="text-lg">
          {summary.rotiBreakdown.map((b) => (
            <tr key={b.quantity} className="border-b border-gray-100">
              <th scope="row" className="py-2 text-left font-normal">{b.quantity}</th>
              <td className="py-2">{b.count}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-2 text-left font-semibold">Total Roti</th>
            <td className="py-2 font-semibold">{summary.totalRotis}</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}
