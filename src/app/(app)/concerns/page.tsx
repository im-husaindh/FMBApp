import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone } from '@/lib/time/cutoff';
import { createConcernAction } from './actions';
import { CONCERN_CATEGORIES } from '@/lib/concerns/constants';
import { ConcernStatusBadge } from '@/components/concerns/status-badge';

export default async function ConcernsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const { error, submitted } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);

  const { data: concerns, error: listError } = await supabase
    .from('concerns')
    .select('id, concern_number, concern_date, category, status, created_at')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false });

  const errorMessage =
    error === 'invalid'
      ? 'Please check the form and try again.'
      : error === 'save_failed'
        ? 'Could not submit your concern. Please try again.'
        : null;

  const categoryLabel = (value: string) => CONCERN_CATEGORIES.find((c) => c.value === value)?.label ?? value;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Food Concerns</h1>

      {submitted === '1' && (
        <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-lg text-green-700">
          ✅ Concern Submitted — Your concern has been sent to the administration.
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <h2 className="mt-6 text-2xl font-bold">Raise Food Concern</h2>
      <form action={createConcernAction} className="mt-4 space-y-4 rounded-xl border border-gray-200 p-6">
        <div>
          <label className="text-lg font-semibold" htmlFor="concernDate">
            Date
          </label>
          <input
            id="concernDate"
            name="concernDate"
            type="date"
            defaultValue={today}
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="category">
            Category
          </label>
          <select
            id="category"
            name="category"
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            {CONCERN_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="message">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            required
            rows={4}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-lg"
          />
        </div>
        <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
          Submit Concern
        </button>
      </form>

      <h2 className="mt-8 text-2xl font-bold">Your Concerns</h2>
      {listError && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not load your concerns. Please try again.
        </p>
      )}
      {!listError && (concerns ?? []).length === 0 && (
        <p className="mt-4 text-lg text-gray-600">You haven&apos;t raised any concerns yet.</p>
      )}
      <div className="mt-4 space-y-3">
        {(concerns ?? []).map((c) => (
          <Link
            key={c.id}
            href={`/concerns/${c.id}`}
            className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                #{c.concern_number} — {categoryLabel(c.category)}
              </span>
              <ConcernStatusBadge status={c.status} />
            </div>
            <p className="mt-1 text-base text-gray-600">{c.concern_date}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
