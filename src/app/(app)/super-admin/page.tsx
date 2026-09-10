import Link from 'next/link';
import { requireRole } from '@/lib/auth';

export default async function SuperAdminPage() {
  const profile = await requireRole(['super_admin']);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Super Admin Area</h1>
      <p className="mt-2 text-lg text-gray-600">
        Signed in as {profile.fullName} ({profile.role})
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/super-admin/approvals"
          className="inline-block rounded-lg bg-blue-600 px-4 py-3 text-lg text-white"
        >
          Menu Approvals
        </Link>
        <Link
          href="/super-admin/service-holidays"
          className="inline-block rounded-lg bg-blue-600 px-4 py-3 text-lg text-white"
        >
          No-Service Dates
        </Link>
        <Link
          href="/super-admin/users"
          className="inline-block rounded-lg bg-blue-600 px-4 py-3 text-lg text-white"
        >
          Manage Users
        </Link>
        <Link
          href="/super-admin/audit"
          className="inline-block rounded-lg bg-blue-600 px-4 py-3 text-lg text-white"
        >
          Audit Log
        </Link>
      </div>
    </main>
  );
}
