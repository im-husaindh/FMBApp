import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { computeConcernSummary } from '@/lib/reports/concern-summary';

export default async function ConcernReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { from: fromParam, to: toParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : null;
  const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : null;

  const errorState = (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/reports" className="text-lg text-blue-600 underline">
        ← Back to Reports
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Concern Report</h1>
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load this report. Please try again.
      </p>
    </main>
  );

  let concernQuery = supabase.from('concerns').select('category, status');
  if (from) concernQuery = concernQuery.gte('concern_date', from);
  if (to) concernQuery = concernQuery.lte('concern_date', to);

  const { data: concernRows, error } = await concernQuery;
  if (error) return errorState;

  const summary = computeConcernSummary(concernRows ?? []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/reports" className="text-lg text-blue-600 underline">
        ← Back to Reports
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Concern Report</h1>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
        <div>
          <label className="text-sm font-semibold" htmlFor="from">
            From (optional)
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
            To (optional)
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
          View
        </button>
      </form>

      {summary.totalConcerns === 0 ? (
        <p className="mt-6 text-lg text-gray-600">No data found for this period.</p>
      ) : (
        <>
          <p className="mt-6 text-lg">
            Total Concerns: <span className="font-semibold">{summary.totalConcerns}</span>
          </p>

          <h2 className="mt-6 text-xl font-bold">By Category</h2>
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.byCategory.map((b) => (
                <tr key={b.category} className="border-b border-gray-100">
                  <td className="py-2">{b.category}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="mt-6 text-xl font-bold">By Status</h2>
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.byStatus.map((b) => (
                <tr key={b.status} className="border-b border-gray-100">
                  <td className="py-2">{b.status}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
