import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone, addDays } from '@/lib/time/cutoff';
import { computeDailySummary, type ThaliRequestRow } from '@/lib/reports/daily-summary';

export default async function AdminPage() {
  const profile = await requireRole(['admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const tomorrow = addDays(today, 1);

  const errorState = (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Admin Dashboard</h1>
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load tomorrow&apos;s summary. Please try again.
      </p>
    </main>
  );

  const { data: holidayRows, error: holidayError } = await supabase
    .from('service_holidays')
    .select('reason')
    .eq('service_date', tomorrow);
  if (holidayError) {
    return errorState;
  }
  const isHoliday = (holidayRows?.length ?? 0) > 0;
  const holidayReason = holidayRows?.[0]?.reason ?? null;

  if (isHoliday) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="mt-2 text-lg text-gray-600">Tomorrow — {tomorrow}</p>
        <div className="mt-6 rounded-xl border border-gray-200 p-6">
          <p className="text-xl font-semibold">No Thali Service Tomorrow</p>
          <p className="mt-2 text-lg text-gray-600">{holidayReason}</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/admin/menu" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
            Manage Menus
          </Link>
          <Link href="/admin/leave" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
            Manage Leave
          </Link>
          <Link href="/admin/requests" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
            Detailed Requests
          </Link>
          <Link href="/admin/users/search" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
            Search Users
          </Link>
        </div>
      </main>
    );
  }

  const { data: activeUsers, error: activeUsersError } = await supabase.from('profiles').select('id').eq('active', true);
  if (activeUsersError) {
    return errorState;
  }
  const activeUserIds = (activeUsers ?? []).map((u) => u.id);

  const { data: requestRows, error: requestRowsError } = activeUserIds.length
    ? await supabase
        .from('thali_requests')
        .select('user_id, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
        .eq('service_date', tomorrow)
        .in('user_id', activeUserIds)
    : { data: [] as { user_id: string; wants_thali: boolean; gravy_portion_id: string | null; rice_portion_id: string | null; roti_quantity: number | null }[], error: null };
  if (requestRowsError) {
    return errorState;
  }

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
        .lte('from_date', tomorrow)
        .gte('to_date', tomorrow)
        .in('user_id', activeUserIds)
    : { data: [] as { user_id: string }[], error: null };
  if (leaveRowsError) {
    return errorState;
  }
  const onLeaveUserIds = (leaveRows ?? []).map((l) => l.user_id);

  const { data: gravyOptions, error: gravyOptionsError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'gravy')
    .eq('active', true)
    .order('sort_order');
  if (gravyOptionsError) {
    return errorState;
  }
  const { data: riceOptions, error: riceOptionsError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'rice')
    .eq('active', true)
    .order('sort_order');
  if (riceOptionsError) {
    return errorState;
  }

  const summary = computeDailySummary(activeUserIds, requests, onLeaveUserIds, gravyOptions ?? [], riceOptions ?? []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Admin Dashboard</h1>
      <p className="mt-2 text-lg text-gray-600">
        Signed in as {profile.fullName} ({profile.role})
      </p>
      <h2 className="mt-6 text-2xl font-bold">Tomorrow — {tomorrow}</h2>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-600">TOTAL USERS</p>
          <p className="text-3xl font-bold">{summary.totalUsers}</p>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-700">THALI REQUIRED</p>
          <p className="text-3xl font-bold text-green-700">{summary.thaliCount}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-600">NO THALI</p>
          <p className="text-3xl font-bold">{summary.noThaliCount}</p>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm font-semibold text-yellow-800">NO RESPONSE</p>
          <p className="text-3xl font-bold text-yellow-800">{summary.noResponseCount}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-600">ON LEAVE</p>
          <p className="text-3xl font-bold">{summary.onLeaveCount}</p>
        </div>
      </div>

      <h3 className="mt-6 text-xl font-bold">Portions</h3>
      <div className="mt-2 space-y-3">
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="font-semibold">Gravy</p>
          <p className="text-lg">
            {summary.gravyBreakdown.map((b) => `${b.label} ${b.count}`).join(' | ')}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="font-semibold">Rice</p>
          <p className="text-lg">{summary.riceBreakdown.map((b) => `${b.label} ${b.count}`).join(' | ')}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="font-semibold">Roti</p>
          <p className="text-lg">
            {summary.rotiBreakdown.map((b) => `${b.quantity} × ${b.count}`).join(' | ')}
          </p>
          <p className="mt-1 text-lg font-semibold">Total: {summary.totalRotis}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/admin/menu" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
          Manage Menus
        </Link>
        <Link href="/admin/leave" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
          Manage Leave
        </Link>
        <Link href="/admin/requests" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
          Detailed Requests
        </Link>
        <Link href="/admin/users/search" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
          Search Users
        </Link>
      </div>
    </main>
  );
}
