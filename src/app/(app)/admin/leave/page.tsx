import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLeaveAction } from './actions';

export default async function AdminLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { error } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: leaves } = await supabase
    .from('user_leaves')
    .select('id, user_id, from_date, to_date, reason')
    .order('from_date', { ascending: false })
    .limit(30);

  const userIds = [...new Set((leaves ?? []).map((l) => l.user_id))];
  const { data: users } = userIds.length
    ? await supabase.from('profiles').select('id, full_name, user_code').in('id', userIds)
    : { data: [] as { id: string; full_name: string; user_code: string }[] };
  const usersById = new Map((users ?? []).map((u) => [u.id, u]));

  const errorMessage =
    error === 'user_not_found'
      ? 'No user found with that member ID.'
      : error === 'overlap'
        ? 'This user already has a leave period covering part of these dates.'
        : error === 'invalid'
          ? 'Check the dates and try again.'
          : error === 'save_failed'
            ? 'Could not save the leave entry. Please try again.'
            : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Manage Leave</h1>
      {errorMessage && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <form action={createLeaveAction} className="mt-6 space-y-4 rounded-xl border border-gray-200 p-6">
        <div>
          <label className="text-lg font-semibold" htmlFor="userCode">
            Member ID
          </label>
          <input
            id="userCode"
            name="userCode"
            type="text"
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-lg font-semibold" htmlFor="fromDate">
              From
            </label>
            <input
              id="fromDate"
              name="fromDate"
              type="date"
              required
              className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
            />
          </div>
          <div className="flex-1">
            <label className="text-lg font-semibold" htmlFor="toDate">
              To
            </label>
            <input
              id="toDate"
              name="toDate"
              type="date"
              required
              className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
            />
          </div>
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="reason">
            Reason (optional)
          </label>
          <input
            id="reason"
            name="reason"
            type="text"
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
          Add Leave
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {(leaves ?? []).length === 0 && <p className="text-lg text-gray-600">No leave entries yet.</p>}
        {(leaves ?? []).map((leave) => {
          const user = usersById.get(leave.user_id);
          return (
            <div key={leave.id} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
              <span className="font-semibold">{user?.full_name}</span> ({user?.user_code}): {leave.from_date} –{' '}
              {leave.to_date}
              {leave.reason && <span className="text-gray-600"> — {leave.reason}</span>}
            </div>
          );
        })}
      </div>
    </main>
  );
}
