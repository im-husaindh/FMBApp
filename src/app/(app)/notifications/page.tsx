import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const NOTIFICATION_COPY: Record<string, string> = {
  concern_response: 'Your concern received a response.',
  concern_resolved: 'Your concern was resolved.',
};

export default async function NotificationsPage() {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const { data: notifications, error } = await supabase
    .from('notifications')
    .select('id, type, payload, read_at, created_at')
    .eq('recipient_id', profile.id)
    .order('created_at', { ascending: false });

  if (!error) {
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', profile.id)
      .is('read_at', null);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Notifications</h1>

      {error && (
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not load your notifications. Please try again.
        </p>
      )}
      {!error && (notifications ?? []).length === 0 && (
        <p className="mt-6 text-lg text-gray-600">You have no notifications yet.</p>
      )}

      <div className="mt-4 space-y-3">
        {(notifications ?? []).map((n) => {
          const payload = n.payload as { concernId?: string };
          return (
            <div key={n.id} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
              <p>{NOTIFICATION_COPY[n.type] ?? n.type}</p>
              {payload.concernId && (
                <a href={`/concerns/${payload.concernId}`} className="text-base text-blue-600 underline">
                  View concern
                </a>
              )}
              <p className="mt-1 text-base text-gray-500">{new Date(n.created_at).toLocaleString()}</p>
            </div>
          );
        })}
      </div>
    </main>
  );
}
