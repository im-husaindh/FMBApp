import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { CONCERN_CATEGORIES } from '@/lib/concerns/constants';
import { ConcernStatusBadge } from '@/components/concerns/status-badge';

export default async function ConcernDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: concern, error: concernError } = await supabase
    .from('concerns')
    .select('id, concern_number, concern_date, category, message, status')
    .eq('id', id)
    .eq('user_id', profile.id)
    .maybeSingle();

  if (concernError || !concern) {
    redirect('/concerns?error=not_found');
  }

  const { data: updates } = await supabase
    .from('concern_updates')
    .select('id, new_status, message, changed_by, created_at')
    .eq('concern_id', id)
    .order('created_at', { ascending: true });

  const changedByIds = [...new Set((updates ?? []).map((u) => u.changed_by))];
  const { data: admins } = changedByIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', changedByIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((admins ?? []).map((a) => [a.id, a.full_name]));

  const categoryLabel = CONCERN_CATEGORIES.find((c) => c.value === concern.category)?.label ?? concern.category;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/concerns" className="text-lg text-blue-600 underline">
        ← Back to Your Concerns
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Concern #{concern.concern_number}</h1>
        <ConcernStatusBadge status={concern.status} />
      </div>
      <p className="mt-2 text-lg text-gray-600">
        {categoryLabel} — {concern.concern_date}
      </p>
      <p className="mt-4 text-lg">{concern.message}</p>

      <h2 className="mt-8 text-xl font-bold">Updates</h2>
      {(updates ?? []).length === 0 && (
        <p className="mt-2 text-lg text-gray-600">No updates yet — an administrator will review this soon.</p>
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
    </main>
  );
}
