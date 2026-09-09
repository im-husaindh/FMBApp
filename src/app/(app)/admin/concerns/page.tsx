import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { CONCERN_CATEGORIES, CONCERN_STATUSES } from '@/lib/concerns/constants';
import { ConcernStatusBadge } from '@/components/concerns/status-badge';

export default async function AdminConcernsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { status: statusParam, search: searchParam } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const status = statusParam ?? 'all';
  const search = (searchParam ?? '').trim().toLowerCase();

  const errorState = (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">Concerns</h1>
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load concerns. Please try again.
      </p>
    </main>
  );

  const concernsQuery = supabase
    .from('concerns')
    .select('id, concern_number, user_id, concern_date, category, status, created_at')
    .order('created_at', { ascending: false });
  const { data: concernRows, error: concernsError } =
    status === 'all' ? await concernsQuery : await concernsQuery.eq('status', status);
  if (concernsError) return errorState;

  const userIds = [...new Set((concernRows ?? []).map((c) => c.user_id))];
  const { data: userRows, error: usersError } = userIds.length
    ? await supabase.from('profiles').select('id, full_name, user_code').in('id', userIds)
    : { data: [] as { id: string; full_name: string; user_code: string }[], error: null };
  if (usersError) return errorState;
  const userById = new Map((userRows ?? []).map((u) => [u.id, u]));

  const categoryLabel = (value: string) => CONCERN_CATEGORIES.find((c) => c.value === value)?.label ?? value;

  const rows = (concernRows ?? []).filter((c) => {
    if (!search) return true;
    const user = userById.get(c.user_id);
    const numberMatch = String(c.concern_number).includes(search.replace('#', ''));
    const nameMatch = user?.full_name.toLowerCase().includes(search) ?? false;
    const codeMatch = user?.user_code.toLowerCase().includes(search) ?? false;
    return numberMatch || nameMatch || codeMatch;
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">Concerns</h1>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
        <div>
          <label className="text-sm font-semibold" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            <option value="all">All</option>
            {CONCERN_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-sm font-semibold" htmlFor="search">
            Search
          </label>
          <input
            id="search"
            name="search"
            type="text"
            defaultValue={searchParam ?? ''}
            placeholder="Concern #, name, or member ID"
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
          Apply
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="mt-6 text-lg text-gray-600">No concerns found.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((c) => {
            const user = userById.get(c.user_id);
            return (
              <Link
                key={c.id}
                href={`/admin/concerns/${c.id}`}
                className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    #{c.concern_number} — {user?.full_name} ({user?.user_code})
                  </span>
                  <ConcernStatusBadge status={c.status} />
                </div>
                <p className="mt-1 text-base text-gray-600">
                  {categoryLabel(c.category)} — {c.concern_date}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        <Link href="/admin" className="text-lg text-blue-600 underline">
          Back to Dashboard
        </Link>
      </div>
    </main>
  );
}
