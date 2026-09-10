import Link from 'next/link';
import { requireRole } from '@/lib/auth';

export default async function AdminReportsPage() {
  await requireRole(['admin', 'super_admin']);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Reports</h1>
      <div className="mt-6 space-y-3">
        <Link
          href="/admin/reports/daily"
          className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
        >
          Daily Thali Report
        </Link>
        <Link
          href="/admin/reports/range"
          className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
        >
          Date Range Report
        </Link>
        <Link
          href="/admin/reports/user-history"
          className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
        >
          User History Report
        </Link>
        <Link
          href="/admin/reports/concerns"
          className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
        >
          Concern Report
        </Link>
      </div>
      <div className="mt-6">
        <Link href="/admin" className="text-lg text-blue-600 underline">
          ← Back to Dashboard
        </Link>
      </div>
    </main>
  );
}
