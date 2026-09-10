import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { updateUserAction, sendPasswordResetAction } from './actions';

export default async function SuperAdminUserEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; reset_sent?: string }>;
}) {
  const profile = await requireRole(['super_admin']);
  const { id } = await params;
  const { error, saved, reset_sent } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: user, error: userError } = await supabase
    .from('profiles')
    .select('id, full_name, user_code, mobile, email, role, active')
    .eq('id', id)
    .maybeSingle();

  if (userError || !user) {
    redirect('/super-admin/users?error=not_found');
  }

  const isSelf = user.id === profile.id;

  const errorMessage =
    error === 'invalid'
      ? 'Please check the form and try again.'
      : error === 'self_lock'
        ? 'You cannot change your own role or active status.'
        : error === 'save_failed'
          ? 'Could not save these changes. Please try again.'
          : error === 'reset_failed'
            ? 'Could not send the password reset email. Please try again.'
            : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/super-admin/users" className="text-lg text-blue-600 underline">
        ← Back to Users
      </Link>

      <h1 className="mt-4 text-3xl font-bold">{user.full_name}</h1>
      <p className="text-lg text-gray-600">{user.user_code}</p>

      {saved === '1' && (
        <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-lg text-green-700">Changes saved.</p>
      )}
      {reset_sent === '1' && (
        <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-lg text-green-700">
          Password reset email sent.
        </p>
      )}
      {errorMessage && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <form action={updateUserAction} className="mt-6 space-y-4 rounded-xl border border-gray-200 p-6">
        <input type="hidden" name="userId" value={user.id} />

        <div>
          <label className="text-lg font-semibold" htmlFor="fullName">
            Full Name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            defaultValue={user.full_name}
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>

        <div>
          <label className="text-lg font-semibold" htmlFor="mobile">
            Mobile
          </label>
          <input
            id="mobile"
            name="mobile"
            type="text"
            defaultValue={user.mobile ?? ''}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>

        <div>
          <label className="text-lg font-semibold" htmlFor="email">
            Email
          </label>
          <p className="mt-1 flex h-12 items-center text-lg text-gray-500">{user.email}</p>
          <input type="hidden" name="email" value={user.email ?? ''} />
        </div>

        <div>
          <label className="text-lg font-semibold" htmlFor="role">
            Role
          </label>
          {isSelf ? (
            <>
              <p className="mt-1 flex h-12 items-center text-lg text-gray-500">
                {user.role} (cannot change your own role)
              </p>
              <input type="hidden" name="role" value={user.role} />
            </>
          ) : (
            <select
              id="role"
              name="role"
              defaultValue={user.role}
              className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          )}
        </div>

        <div>
          <label className="text-lg font-semibold" htmlFor="active">
            Status
          </label>
          {isSelf ? (
            <>
              <p className="mt-1 flex h-12 items-center text-lg text-gray-500">
                {user.active ? 'Active' : 'Inactive'} (cannot change your own status)
              </p>
              <input type="hidden" name="active" value={String(user.active)} />
            </>
          ) : (
            <select
              id="active"
              name="active"
              defaultValue={String(user.active)}
              className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          )}
        </div>

        <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
          Save Changes
        </button>
      </form>

      <form action={sendPasswordResetAction} className="mt-4">
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="email" value={user.email ?? ''} />
        <button
          type="submit"
          className="h-12 w-full rounded-lg border border-blue-600 text-lg font-semibold text-blue-600"
        >
          Send Password Reset Email
        </button>
      </form>

      <div className="mt-6">
        <Link href={`/admin/users/${user.id}`} className="text-lg text-blue-600 underline">
          View Request History →
        </Link>
      </div>
    </main>
  );
}
