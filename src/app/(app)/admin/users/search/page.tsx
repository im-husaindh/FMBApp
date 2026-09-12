import { BackButton } from '@/components/ui/back-button';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function AdminUserSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { q, error } = await searchParams;
  const query = (q ?? '').trim();
  const supabase = await createServerSupabaseClient();

  let results: { id: string; full_name: string; user_code: string; mobile: string | null; email: string | null }[] = [];
  let loadError = false;

  if (query) {
    // PostgREST's .or() filter string treats "," and "()" as syntax — strip them
    // so a search term containing one can't break or redirect the filter.
    const sanitized = query.replace(/[,()]/g, '');
    const { data, error: searchError } = await supabase
      .from('profiles')
      .select('id, full_name, user_code, mobile, email')
      .eq('active', true)
      .or(
        `full_name.ilike.%${sanitized}%,user_code.ilike.%${sanitized}%,mobile.ilike.%${sanitized}%,email.ilike.%${sanitized}%`
      )
      .order('full_name')
      .limit(25);
    if (searchError) {
      loadError = true;
    } else {
      results = data ?? [];
    }
  }

  const errorMessage = error === 'not_found' ? 'User not found.' : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <BackButton />
      <h1 className="text-3xl font-bold">Search Users</h1>
      {errorMessage && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

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

      {loadError && (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not run this search. Please try again.
        </p>
      )}

      {!loadError && query && results.length === 0 && (
        <p className="mt-6 text-lg text-gray-600">No results found for this user search.</p>
      )}

      <div className="mt-6 space-y-3">
        {results.map((user) => (
          <Link
            key={user.id}
            href={`/admin/users/${user.id}`}
            className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
          >
            <span className="font-semibold">{user.full_name}</span>{' '}
            <span className="text-gray-500">({user.user_code})</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
