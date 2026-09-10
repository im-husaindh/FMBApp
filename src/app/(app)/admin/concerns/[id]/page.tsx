import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { CONCERN_CATEGORIES, CONCERN_STATUSES } from '@/lib/concerns/constants';
import { ConcernStatusBadge } from '@/components/concerns/status-badge';
import { replyToConcernAction } from './actions';

export default async function AdminConcernDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: concern, error: concernError } = await supabase
    .from('concerns')
    .select('id, concern_number, user_id, concern_date, category, message, status')
    .eq('id', id)
    .maybeSingle();

  if (concernError || !concern) {
    redirect('/admin/concerns?error=not_found');
  }

  const { data: user, error: userError } = await supabase
    .from('profiles')
    .select('full_name, user_code')
    .eq('id', concern.user_id)
    .maybeSingle();

  const { data: updates, error: updatesError } = await supabase
    .from('concern_updates')
    .select('id, new_status, message, changed_by, created_at')
    .eq('concern_id', id)
    .order('created_at', { ascending: true });

  const changedByIds = [...new Set((updates ?? []).map((u) => u.changed_by))];
  const { data: admins, error: adminsError } = changedByIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', changedByIds)
    : { data: [] as { id: string; full_name: string }[], error: null };
  const nameById = new Map((admins ?? []).map((a) => [a.id, a.full_name]));

  const categoryLabel = CONCERN_CATEGORIES.find((c) => c.value === concern.category)?.label ?? concern.category;
  const errorMessage =
    error === 'invalid'
      ? 'Please check the form and try again.'
      : error === 'save_failed'
        ? 'Could not save your reply. Please try again.'
        : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/concerns" className="text-lg text-blue-600 underline">
        ← Back to Concerns
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Concern #{concern.concern_number}</h1>
        <ConcernStatusBadge status={concern.status} />
      </div>
      {userError ? (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not load member details.
        </p>
      ) : (
        <p className="mt-2 text-lg text-gray-600">
          {user?.full_name} ({user?.user_code}) — {categoryLabel} — {concern.concern_date}
        </p>
      )}
      <p className="mt-4 text-lg">{concern.message}</p>

      {errorMessage && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <h2 className="mt-8 text-xl font-bold">Updates</h2>
      {(updatesError || adminsError) && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not load the full update history. Please refresh and try again.
        </p>
      )}
      <div className="mt-2 space-y-3">
        {(updates ?? []).map((u) => (
          <div key={u.id} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
            <p className="text-base text-gray-500">
              {nameById.get(u.changed_by) ?? 'Administrator'} — {new Date(u.created_at).toLocaleString()}
            </p>
            {u.new_status && (
              <p className="mt-1">
                Status changed to <ConcernStatusBadge status={u.new_status} />
              </p>
            )}
            {u.message && <p className="mt-1">{u.message}</p>}
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-xl font-bold">Reply</h2>
      <form action={replyToConcernAction} className="mt-4 space-y-4 rounded-xl border border-gray-200 p-6">
        <input type="hidden" name="concernId" value={concern.id} />
        <div>
          <label className="text-lg font-semibold" htmlFor="newStatus">
            Status
          </label>
          <select
            id="newStatus"
            name="newStatus"
            defaultValue={concern.status}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            {CONCERN_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="message">
            Message (optional)
          </label>
          <textarea
            id="message"
            name="message"
            rows={4}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-lg"
          />
        </div>
        <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
          Post Reply
        </button>
      </form>
    </main>
  );
}
