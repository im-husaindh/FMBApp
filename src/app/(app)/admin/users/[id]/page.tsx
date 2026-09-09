import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone, addDays } from '@/lib/time/cutoff';
import { classifyRequestStatus, type RequestStatus } from '@/lib/reports/request-status';

const STATUS_LABEL: Record<RequestStatus, string> = {
  thali: '✓ Thali',
  no_thali: '✕ No Thali',
  no_response: '? No Response',
  on_leave: '⏸ On Leave',
};

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(['admin', 'super_admin']);
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: user, error: userError } = await supabase
    .from('profiles')
    .select('id, full_name, user_code, mobile, email, role, active')
    .eq('id', id)
    .maybeSingle();

  if (userError || !user) {
    redirect('/admin/users/search?error=not_found');
  }

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const tomorrow = addDays(today, 1);

  const { data: leaveRows } = await supabase
    .from('user_leaves')
    .select('from_date, to_date')
    .eq('user_id', id)
    .gte('to_date', today);
  const isOnLeave = (date: string) => (leaveRows ?? []).some((l) => l.from_date <= date && date <= l.to_date);

  const { data: recentRequests } = await supabase
    .from('thali_requests')
    .select('service_date, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
    .eq('user_id', id)
    .order('service_date', { ascending: false })
    .limit(14);

  const requestByDate = new Map((recentRequests ?? []).map((r) => [r.service_date, r]));
  const gravyRiceIds = [
    ...new Set(
      (recentRequests ?? []).flatMap((r) => [r.gravy_portion_id, r.rice_portion_id]).filter((v): v is string => !!v)
    ),
  ];
  const { data: portionOptions } = gravyRiceIds.length
    ? await supabase.from('portion_options').select('id, label').in('id', gravyRiceIds)
    : { data: [] as { id: string; label: string }[] };
  const labelById = new Map((portionOptions ?? []).map((o) => [o.id, o.label]));

  const todayRequest = requestByDate.get(today);
  const tomorrowRequest = requestByDate.get(tomorrow);
  const todayStatus = classifyRequestStatus(isOnLeave(today), todayRequest ? { wantsThali: todayRequest.wants_thali } : undefined);
  const tomorrowStatus = classifyRequestStatus(
    isOnLeave(tomorrow),
    tomorrowRequest ? { wantsThali: tomorrowRequest.wants_thali } : undefined
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/users/search" className="text-lg text-blue-600 underline">
        ← Back to Search
      </Link>

      <h1 className="mt-4 text-3xl font-bold">{user.full_name}</h1>
      <p className="text-lg text-gray-600">
        {user.user_code} · {user.role} · {user.active ? 'Active' : 'Inactive'}
      </p>
      {user.mobile && <p className="text-lg text-gray-600">{user.mobile}</p>}
      {user.email && <p className="text-lg text-gray-600">{user.email}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-600">TODAY — {today}</p>
          <p className="text-xl font-semibold">{STATUS_LABEL[todayStatus]}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-600">TOMORROW — {tomorrow}</p>
          <p className="text-xl font-semibold">{STATUS_LABEL[tomorrowStatus]}</p>
          {tomorrowStatus === 'thali' && tomorrowRequest && (
            <p className="mt-1 text-base text-gray-700">
              {labelById.get(tomorrowRequest.gravy_portion_id ?? '') ?? '—'} ·{' '}
              {labelById.get(tomorrowRequest.rice_portion_id ?? '') ?? '—'} · Roti {tomorrowRequest.roti_quantity ?? '—'}
            </p>
          )}
        </div>
      </div>

      <h2 className="mt-8 text-2xl font-bold">Recent History</h2>
      <div className="mt-2 space-y-2">
        {(recentRequests ?? []).length === 0 && <p className="text-lg text-gray-600">No requests recorded yet.</p>}
        {(recentRequests ?? []).map((r) => (
          <div key={r.service_date} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
            <span className="font-semibold">{r.service_date}</span> —{' '}
            {r.wants_thali
              ? `Thali (${labelById.get(r.gravy_portion_id ?? '') ?? '—'}, ${labelById.get(r.rice_portion_id ?? '') ?? '—'}, Roti ${r.roti_quantity ?? '—'})`
              : 'No Thali'}
          </div>
        ))}
      </div>
    </main>
  );
}
