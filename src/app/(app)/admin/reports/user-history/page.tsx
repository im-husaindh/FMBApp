import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone } from '@/lib/time/cutoff';
import { classifyRequestStatus, type RequestStatus } from '@/lib/reports/request-status';

const STATUS_LABEL: Record<RequestStatus, string> = {
  thali: '✓ Thali',
  no_thali: '✕ No Thali',
  no_response: '? No Response',
  on_leave: '⏸ On Leave',
};

export default async function UserHistoryReportPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; userId?: string; from?: string; to?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { q, userId, from: fromParam, to: toParam } = await searchParams;
  const query = (q ?? '').trim();
  const supabase = await createServerSupabaseClient();

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : today;
  const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : today;

  let searchResults: { id: string; full_name: string; user_code: string }[] = [];
  let searchError = false;
  if (query) {
    const sanitized = query.replace(/[,()]/g, '');
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, user_code')
      .eq('active', true)
      .or(
        `full_name.ilike.%${sanitized}%,user_code.ilike.%${sanitized}%,mobile.ilike.%${sanitized}%,email.ilike.%${sanitized}%`
      )
      .order('full_name')
      .limit(25);
    if (error) searchError = true;
    else searchResults = data ?? [];
  }

  let selectedUser: { id: string; full_name: string; user_code: string } | null = null;
  let historyRows: { service_date: string; wants_thali: boolean }[] = [];
  let historyError = false;
  let isOnLeave: (date: string) => boolean = () => false;

  if (userId) {
    const { data: userRow, error: userError } = await supabase
      .from('profiles')
      .select('id, full_name, user_code')
      .eq('id', userId)
      .maybeSingle();

    if (userError) {
      historyError = true;
    } else if (userRow) {
      selectedUser = userRow;

      const { data: leaveRows, error: leaveError } = await supabase
        .from('user_leaves')
        .select('from_date, to_date')
        .eq('user_id', userId)
        .lte('from_date', to)
        .gte('to_date', from);

      if (leaveError) {
        historyError = true;
      } else {
        isOnLeave = (date: string) => (leaveRows ?? []).some((l) => l.from_date <= date && date <= l.to_date);

        const { data: requestRows, error: requestError } = await supabase
          .from('thali_requests')
          .select('service_date, wants_thali')
          .eq('user_id', userId)
          .gte('service_date', from)
          .lte('service_date', to)
          .order('service_date', { ascending: false });

        if (requestError) {
          historyError = true;
        } else {
          historyRows = requestRows ?? [];
        }
      }
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/reports" className="text-lg text-blue-600 underline">
        ← Back to Reports
      </Link>
      <h1 className="mt-4 text-3xl font-bold">User History Report</h1>

      <form method="get" className="mt-6 flex gap-3">
        <input
          name="q"
          type="text"
          defaultValue={query}
          placeholder="Name, member ID, mobile, or email"
          className="h-12 flex-1 rounded-lg border border-gray-300 px-3 text-lg"
        />
        <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
          Search
        </button>
      </form>

      {searchError && (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not run this search. Please try again.
        </p>
      )}
      {!searchError && query && searchResults.length === 0 && (
        <p className="mt-6 text-lg text-gray-600">No results found for this user search.</p>
      )}

      {!selectedUser && searchResults.length > 0 && (
        <div className="mt-6 space-y-3">
          {searchResults.map((user) => (
            <Link
              key={user.id}
              href={`/admin/reports/user-history?userId=${user.id}`}
              className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
            >
              <span className="font-semibold">{user.full_name}</span>{' '}
              <span className="text-gray-500">({user.user_code})</span>
            </Link>
          ))}
        </div>
      )}

      {historyError && (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not load this user&apos;s history. Please try again.
        </p>
      )}

      {selectedUser && !historyError && (
        <>
          <h2 className="mt-8 text-xl font-bold">
            {selectedUser.full_name} <span className="text-gray-500">({selectedUser.user_code})</span>
          </h2>

          <form method="get" className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
            <input type="hidden" name="userId" value={selectedUser.id} />
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

          {historyRows.length === 0 ? (
            <p className="mt-6 text-lg text-gray-600">No data found for this period.</p>
          ) : (
            <div className="mt-6 space-y-2">
              {historyRows.map((r) => {
                const status = classifyRequestStatus(isOnLeave(r.service_date), { wantsThali: r.wants_thali });
                return (
                  <div key={r.service_date} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
                    <span className="font-semibold">{r.service_date}</span> — {STATUS_LABEL[status]}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}
