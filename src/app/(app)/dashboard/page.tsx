import { requireRole } from '@/lib/auth';

export default async function DashboardPage() {
  const profile = await requireRole(['user', 'admin', 'super_admin']);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Welcome, {profile.fullName}</h1>
      <p className="mt-2 text-lg text-gray-600">Role: {profile.role}</p>
    </main>
  );
}
