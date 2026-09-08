import { requireRole } from '@/lib/auth';

export default async function AdminPage() {
  const profile = await requireRole(['admin', 'super_admin']);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Admin Area</h1>
      <p className="mt-2 text-lg text-gray-600">
        Signed in as {profile.fullName} ({profile.role})
      </p>
    </main>
  );
}
