import { BackButton } from '@/components/ui/back-button';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const ENTITY_TYPES = ['menu_version', 'profile', 'user_leave', 'service_holiday', 'concern'];
const ACTIONS = [
  'menu_created',
  'menu_edited',
  'menu_submitted',
  'menu_approved',
  'menu_rejected',
  'user_created',
  'user_edited',
  'user_activated',
  'user_deactivated',
  'role_changed',
  'leave_created',
  'service_holiday_created',
  'concern_status_changed',
];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ entityType?: string; action?: string; from?: string; to?: string }>;
}) {
  await requireRole(['super_admin']);
  const { entityType, action, from: fromParam, to: toParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : null;
  const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : null;
  const hasFilter = Boolean(entityType || action || from || to);

  const errorState = (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <BackButton />
      <Link href="/super-admin" className="text-lg text-blue-600 underline">
        ← Back to Super Admin
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Audit Log</h1>
      <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load the audit log. Please try again.
      </p>
    </main>
  );

  let query = supabase
    .from('audit_logs')
    .select('id, actor_id, action, entity_type, entity_id, previous_state, new_state, created_at')
    .order('created_at', { ascending: false });

  if (entityType) query = query.eq('entity_type', entityType);
  if (action) query = query.eq('action', action);
  if (from) query = query.gte('created_at', `${from}T00:00:00`);
  if (to) query = query.lte('created_at', `${to}T23:59:59`);
  if (!hasFilter) query = query.limit(200);

  const { data: logRows, error } = await query;
  if (error) return errorState;

  const actorIds = Array.from(new Set((logRows ?? []).map((r) => r.actor_id).filter((id): id is string => Boolean(id))));
  const { data: actors, error: actorsError } =
    actorIds.length > 0
      ? await supabase.from('profiles').select('id, full_name, user_code').in('id', actorIds)
      : { data: [] as { id: string; full_name: string; user_code: string }[], error: null };
  if (actorsError) return errorState;

  const actorMap = new Map((actors ?? []).map((a) => [a.id, a]));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <BackButton />
      <Link href="/super-admin" className="text-lg text-blue-600 underline">
        ← Back to Super Admin
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Audit Log</h1>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
        <div>
          <label className="text-sm font-semibold" htmlFor="entityType">
            Entity type
          </label>
          <select
            id="entityType"
            name="entityType"
            defaultValue={entityType ?? ''}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor="action">
            Action
          </label>
          <select
            id="action"
            name="action"
            defaultValue={action ?? ''}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            <option value="">All</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor="from">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from ?? ''}
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
            defaultValue={to ?? ''}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
          Filter
        </button>
      </form>

      {!logRows || logRows.length === 0 ? (
        <p className="mt-6 text-lg text-gray-600">No matching audit records for this filter.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-300 text-sm font-semibold">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Entity</th>
                <th className="py-2">Details</th>
              </tr>
            </thead>
            <tbody className="text-lg">
              {logRows.map((row) => {
                const actor = row.actor_id ? actorMap.get(row.actor_id) : undefined;
                return (
                  <tr key={row.id} className="border-b border-gray-100 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-4">
                      {actor ? `${actor.full_name} (${actor.user_code})` : (row.actor_id ?? '—')}
                    </td>
                    <td className="py-2 pr-4">{row.action}</td>
                    <td className="py-2 pr-4">
                      {row.entity_type} / {row.entity_id}
                    </td>
                    <td className="py-2">
                      <details>
                        <summary className="cursor-pointer text-blue-600">view</summary>
                        <pre className="mt-2 max-w-md overflow-x-auto rounded bg-gray-50 p-2 text-sm">
{JSON.stringify({ previous: row.previous_state ?? null, new: row.new_state ?? null }, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
