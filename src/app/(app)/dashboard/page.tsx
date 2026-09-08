import { requireRole } from '@/lib/auth';
import { logoutAction } from './actions';

export default async function DashboardPage() {
  const profile = await requireRole(['user', 'admin', 'super_admin']);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Welcome, {profile.fullName}</h1>
      <p className="mt-2 text-lg text-gray-600">Role: {profile.role}</p>
      <form action={logoutAction}>
        <button type="submit" className="mt-6 text-lg text-blue-600 underline">
          Log Out
        </button>
      </form>
    </main>
  );
}
