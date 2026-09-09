import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceHolidayAction } from './actions';

export default async function ServiceHolidaysPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole(['super_admin']);
  const { error } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: holidays } = await supabase
    .from('service_holidays')
    .select('id, service_date, reason')
    .order('service_date', { ascending: false })
    .limit(30);

  const errorMessage =
    error === 'duplicate'
      ? 'A no-service date already exists for that day.'
      : error === 'invalid'
        ? 'Enter a valid date and reason.'
        : error === 'save_failed'
          ? 'Could not save. Please try again.'
          : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">No-Service Dates</h1>
      {errorMessage && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <form
        action={createServiceHolidayAction}
        className="mt-6 space-y-4 rounded-xl border border-gray-200 p-6"
      >
        <div>
          <label className="text-lg font-semibold" htmlFor="serviceDate">
            Date
          </label>
          <input
            id="serviceDate"
            name="serviceDate"
            type="date"
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="reason">
            Reason
          </label>
          <input
            id="reason"
            name="reason"
            type="text"
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
          Add No-Service Date
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {(holidays ?? []).length === 0 && <p className="text-lg text-gray-600">No no-service dates scheduled.</p>}
        {(holidays ?? []).map((h) => (
          <div key={h.id} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
            <span className="font-semibold">{h.service_date}</span> — {h.reason}
          </div>
        ))}
      </div>
    </main>
  );
}
