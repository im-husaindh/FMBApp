import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { inviteUserAction } from './actions';

export default async function SuperAdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invited?: string }>;
}) {
  await requireRole(['super_admin']);
  const { error, invited } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const errorState = (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">Manage Users</h1>
      <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load users. Please try again.
      </p>
    </main>
  );

  const { data: profileRows, error: listError } = await supabase
    .from('profiles')
    .select('id, full_name, user_code, mobile, email, role, active, created_at')
    .order('created_at', { ascending: false });
  if (listError) return errorState;

  const errorMessage =
    error === 'invalid'
      ? 'Please check the form and try again.'
      : error === 'invite_failed'
        ? 'Could not send the invite. This email or member ID may already be in use.'
        : error === 'role_failed'
          ? 'The user was invited but their role could not be set. Edit them from the list below to fix this.'
          : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">Manage Users</h1>

      {invited === '1' && (
        <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-lg text-green-700">
          User invited — they&apos;ll receive an email to set their password.
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <h2 className="mt-6 text-2xl font-bold">Add User</h2>
      <form action={inviteUserAction} className="mt-4 space-y-4 rounded-xl border border-gray-200 p-6">
        <div>
          <label className="text-lg font-semibold" htmlFor="fullName">
            Full Name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="userCode">
            Member ID
          </label>
          <input
            id="userCode"
            name="userCode"
            type="text"
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="role">
            Role
          </label>
          <select
            id="role"
            name="role"
            defaultValue="user"
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </div>
        <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
          Send Invite
        </button>
      </form>

      <h2 className="mt-8 text-2xl font-bold">All Users</h2>

      <table className="mt-4 hidden w-full text-left md:table">
        <thead>
          <tr className="border-b border-gray-200 text-sm font-semibold text-gray-600">
            <th className="py-2">Name</th>
            <th className="py-2">Member ID</th>
            <th className="py-2">Mobile</th>
            <th className="py-2">Email</th>
            <th className="py-2">Role</th>
            <th className="py-2">Status</th>
            <th className="py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {(profileRows ?? []).map((p) => (
            <tr key={p.id} className="border-b border-gray-100 text-lg">
              <td className="py-3">
                <Link href={`/super-admin/users/${p.id}`} className="text-blue-600 underline">
                  {p.full_name}
                </Link>
              </td>
              <td className="py-3">{p.user_code}</td>
              <td className="py-3">{p.mobile ?? '—'}</td>
              <td className="py-3">{p.email ?? '—'}</td>
              <td className="py-3">{p.role}</td>
              <td className="py-3">{p.active ? 'Active' : 'Inactive'}</td>
              <td className="py-3">{new Date(p.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 space-y-3 md:hidden">
        {(profileRows ?? []).map((p) => (
          <Link
            key={p.id}
            href={`/super-admin/users/${p.id}`}
            className="block rounded-lg border border-gray-200 p-4 text-lg hover:bg-gray-50"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">{p.full_name}</span>
              <span>{p.active ? 'Active' : 'Inactive'}</span>
            </div>
            <p className="mt-1 text-base text-gray-600">
              {p.user_code} · {p.role}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
