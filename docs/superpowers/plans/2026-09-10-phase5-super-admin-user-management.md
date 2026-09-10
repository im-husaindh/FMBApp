# FMBRequestThali — Phase 5: Super-Admin User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super_admin create new user accounts (by email invite), edit any existing user's contact info/role/active status, trigger a password-reset email, and jump to that user's operational history — while making it structurally impossible for a super_admin to lock themselves out by changing their own role or active status.

**Architecture:** One migration extends Phase 1's existing `profiles_prevent_role_active_change` trigger with a self-change check. Account creation is a Server Action that is the first file under `src/` to construct a Supabase service-role client at runtime (scoped to that one file, never used for authorization) calling `auth.admin.inviteUserByEmail()`, mirroring `scripts/seed-users.ts`'s already-proven account-creation pattern. Editing an existing user goes through the caller's own super-admin session and the RLS policy that's existed since Phase 1 but has had no consumer until now.

**Tech Stack:** Next.js Server Components + Server Actions, Supabase (Postgres + RLS + Auth Admin API), zod, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-phase5-super-admin-user-management-design.md` (and source `FMBRequestThali Web App — Complete Development Prompt.md` §24)

## Global Constraints

- Strict TypeScript, no `any`.
- Every zod field backed by a `FormData`-optional value must use `.nullable().optional()`, never `.optional().or(z.literal(''))` — `FormData.get()` returns `null`, not `undefined`, for an absent field. This exact mismatch has broken form submission twice already in this project's history.
- The service-role Supabase client (`createClient` from `@supabase/supabase-js`, constructed from `SUPABASE_SERVICE_ROLE_KEY`) is constructed in exactly ONE file (`src/app/(app)/super-admin/users/actions.ts`) and used for exactly one purpose: creating a new auth user via `auth.admin.inviteUserByEmail()` and setting its initial role. It is never exported, never imported anywhere else, and never used to make an authorization decision — `requireRole(['super_admin'])` on the caller's own ordinary session always runs first, before the service-role client is even constructed.
- Editing an EXISTING user (role, active, contact info) never touches the service-role client — it uses the caller's own session via `createServerSupabaseClient()`, going through the `profiles_update_super_admin` RLS policy that has existed since Phase 1's migration `0002_profiles_rls.sql`.
- The self-lockout trigger addition (Task 1) must be verified with a live negative-control test: an ACTIVE super_admin's own role/active update must be REJECTED by the database, not just by application code. Task 6's integration test is where this is proven.
- Large touch targets (`h-12`/`h-14`), icon+text+color together for status (this phase's status display is a plain "Active"/"Inactive" label — matches the existing precedent of every other list page in this app not needing a colored badge for a two-state boolean shown as plain text, e.g. `/admin/leave`'s list).
- Migration numbering continues from Phase 4's last migration: next is `0020`.
- Never permanently delete a profile row — `active = false` is the only removal mechanism (already the only path this schema allows; no task in this plan adds a delete capability).

---

## File Structure

- `supabase/migrations/0020_profiles_prevent_self_role_active_change.sql` — extends the Phase 1 trigger
- `src/lib/validation/user-admin.ts` — `inviteUserSchema`, `updateUserSchema`
- `src/app/(app)/super-admin/users/actions.ts` — `inviteUserAction` (the one file with the service-role client)
- `src/app/(app)/super-admin/users/page.tsx` — user list + "Add User" form
- `src/app/(app)/super-admin/users/[id]/actions.ts` — `updateUserAction`, `sendPasswordResetAction`
- `src/app/(app)/super-admin/users/[id]/page.tsx` — edit form + password-reset button + link to history
- `src/app/(app)/super-admin/page.tsx` — modify: add a "Manage Users" nav link
- `src/lib/supabase/user-admin-rls.integration.test.ts` — new integration test

---

### Task 1: Migration — self-lockout trigger

**Files:**
- Create: `supabase/migrations/0020_profiles_prevent_self_role_active_change.sql`

**Interfaces:**
- Consumes: `profiles_prevent_role_active_change()` (Phase 1, migration `0001_profiles.sql`) — this task replaces its body entirely
- Produces: the same-named function, now also rejecting a self role/active change

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0020_profiles_prevent_self_role_active_change.sql`:

```sql
-- Extends the Phase 1 trigger (0001_profiles.sql) to also reject a role or
-- active-status change where the target row is the acting user's own —
-- even if they are a genuinely active super_admin. Without this, a super_admin
-- could accidentally demote or deactivate themselves with no other
-- super_admin able to undo it, since Phase 5 is the first UI to ever expose
-- this write path.
create or replace function public.profiles_prevent_role_active_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active) then
    if new.id = auth.uid() then
      raise exception 'You cannot change your own role or active status';
    end if;
    if not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin' and p.active = true
    ) then
      raise exception 'Only an active super_admin may change role or active status';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

Expected: all migrations `0001`-`0020` apply with no errors.

Confirm the function body was actually replaced (the new self-check text is present):

```bash
npx supabase db query "select prosrc from pg_proc where proname = 'profiles_prevent_role_active_change'"
```

Expected: the returned `prosrc` text contains `You cannot change your own role or active status`.

This migration only proves the function *compiles and replaces correctly* here — the actual behavioral proof (that a real authenticated super_admin session is rejected when targeting their own row) requires a live authenticated client and is covered by Task 6's integration test, not this task's verification.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0020_profiles_prevent_self_role_active_change.sql
git commit -m "feat(db): prevent a super_admin from changing their own role or active status"
```

---

### Task 2: `lib/validation/user-admin.ts` — zod schemas

**Files:**
- Create: `src/lib/validation/user-admin.ts`
- Test: `src/lib/validation/user-admin.test.ts`

**Interfaces:**
- Produces: `inviteUserSchema`, `InviteUserInput`, `updateUserSchema`, `UpdateUserInput` — Task 3's `inviteUserAction` and Task 4's `updateUserAction` parse `FormData` through these.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/validation/user-admin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { inviteUserSchema, updateUserSchema } from './user-admin';

describe('inviteUserSchema', () => {
  it('accepts a valid invite', () => {
    const result = inviteUserSchema.safeParse({
      fullName: 'Priya Nair',
      email: 'priya@example.com',
      userCode: 'US020',
      role: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = inviteUserSchema.safeParse({
      fullName: 'Priya Nair',
      email: 'not-an-email',
      userCode: 'US020',
      role: 'user',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown role', () => {
    const result = inviteUserSchema.safeParse({
      fullName: 'Priya Nair',
      email: 'priya@example.com',
      userCode: 'US020',
      role: 'owner',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty member ID', () => {
    const result = inviteUserSchema.safeParse({
      fullName: 'Priya Nair',
      email: 'priya@example.com',
      userCode: '',
      role: 'user',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateUserSchema', () => {
  it('accepts a valid edit with a mobile number', () => {
    const result = updateUserSchema.safeParse({
      fullName: 'Priya Nair',
      mobile: '9990001111',
      email: 'priya@example.com',
      role: 'admin',
      active: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active).toBe(true);
    }
  });

  it('accepts a null mobile (FormData.get() returns null for an empty field)', () => {
    const result = updateUserSchema.safeParse({
      fullName: 'Priya Nair',
      mobile: null,
      email: 'priya@example.com',
      role: 'user',
      active: 'false',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active).toBe(false);
    }
  });

  it('rejects an unknown role', () => {
    const result = updateUserSchema.safeParse({
      fullName: 'Priya Nair',
      mobile: null,
      email: 'priya@example.com',
      role: 'owner',
      active: 'true',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid active value', () => {
    const result = updateUserSchema.safeParse({
      fullName: 'Priya Nair',
      mobile: null,
      email: 'priya@example.com',
      role: 'user',
      active: 'yes',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/validation/user-admin.test.ts
```

Expected: FAIL — `./user-admin` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/validation/user-admin.ts`:

```ts
import { z } from 'zod';

export const inviteUserSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required'),
  email: z.string().trim().email('Enter a valid email address'),
  userCode: z.string().trim().min(1, 'Member ID is required'),
  role: z.enum(['user', 'admin', 'super_admin']),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required'),
  mobile: z.string().trim().nullable().optional(),
  email: z.string().trim().email('Enter a valid email address'),
  role: z.enum(['user', 'admin', 'super_admin']),
  active: z.enum(['true', 'false']).transform((v) => v === 'true'),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
```

Note: `mobile` uses `.nullable().optional()` because the edit form's mobile input can be submitted empty — `FormData.get('mobile')` returns `null` in that case, not `undefined`. `email` stays required (not nullable) because every account in this app has an email (created via signup or invite) — unlike `mobile`, there's no real state where an existing user genuinely has no email. `active` is a `<select>` (not a checkbox) submitting the literal string `"true"`/`"false"`, transformed to a real boolean — a checkbox's `FormData` semantics (present only when checked) would make "explicitly set to false" indistinguishable from "field omitted," which a `<select>` avoids entirely.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/validation/user-admin.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/user-admin.ts src/lib/validation/user-admin.test.ts
git commit -m "feat: add invite/edit user validation schemas"
```

---

### Task 3: `/super-admin/users` — invite action + user list

**Files:**
- Create: `src/app/(app)/super-admin/users/actions.ts`
- Create: `src/app/(app)/super-admin/users/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `inviteUserSchema` (Task 2)
- Produces: `inviteUserAction(formData: FormData)`

- [ ] **Step 1: Implement the invite action**

Create `src/app/(app)/super-admin/users/actions.ts`:

```ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { inviteUserSchema } from '@/lib/validation/user-admin';

export async function inviteUserAction(formData: FormData) {
  // Authorization always runs on the caller's own ordinary session first —
  // the service-role client constructed below is never used for this check.
  await requireRole(['super_admin']);

  const parsed = inviteUserSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    userCode: formData.get('userCode'),
    role: formData.get('role'),
  });

  if (!parsed.success) {
    redirect('/super-admin/users?error=invalid');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    redirect('/super-admin/users?error=invite_failed');
  }

  // The only place in src/ that constructs a service-role client, and the
  // only thing it's used for: creating a new auth user (mirrors the exact
  // pattern scripts/seed-users.ts already uses successfully). Never
  // exported, never imported elsewhere, never used for an auth decision.
  const serviceClient = createClient(url, serviceKey);

  const { data: invited, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(
    parsed.data.email,
    {
      data: { full_name: parsed.data.fullName, user_code: parsed.data.userCode },
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    }
  );

  if (inviteError || !invited.user) {
    redirect('/super-admin/users?error=invite_failed');
  }

  if (parsed.data.role !== 'user') {
    const { error: roleError } = await serviceClient
      .from('profiles')
      .update({ role: parsed.data.role })
      .eq('id', invited.user.id);
    if (roleError) {
      redirect('/super-admin/users?error=role_failed');
    }
  }

  redirect('/super-admin/users?invited=1');
}
```

Note: this task deliberately does not try to distinguish a "duplicate email/member ID" error from any other invite failure with a specific error code — the exact shape of GoTrue's error for that case isn't something this plan can verify without a live call. Use one generic `invite_failed` message. During this task's manual verification step, actually attempt to invite a duplicate email and observe what happens — if it's clearly a "this email is already registered" style message from Supabase's own error, it's fine to surface as-is; do not guess at an error code to match against.

- [ ] **Step 2: Implement the page**

Create `src/app/(app)/super-admin/users/page.tsx`:

```tsx
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
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
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
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
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
```

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

- [ ] **Step 4: Manual verification (requires a running dev server, a seeded database, and Supabase's local Mailpit for viewing sent emails at http://127.0.0.1:54324)**

Sign in as `superadmin@fmb.test`, visit `/super-admin/users`, confirm the full seeded user list renders. Submit the Add User form with a brand-new email/member ID and role `user`. Confirm the redirect shows "User invited," the new row appears in the list, and an invite email appears in Mailpit. Then try submitting with the *same* email again and observe what error actually comes back — confirm the page shows a reasonable message, not a raw stack trace or unhandled error.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/super-admin/users/actions.ts" "src/app/(app)/super-admin/users/page.tsx"
git commit -m "feat: add super-admin user invite action and list at /super-admin/users"
```

---

### Task 4: `/super-admin/users/[id]` — edit, password reset, history link

**Files:**
- Create: `src/app/(app)/super-admin/users/[id]/actions.ts`
- Create: `src/app/(app)/super-admin/users/[id]/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `updateUserSchema` (Task 2)
- Produces: `updateUserAction(formData: FormData)`, `sendPasswordResetAction(formData: FormData)`

- [ ] **Step 1: Implement the actions**

Create `src/app/(app)/super-admin/users/[id]/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { updateUserSchema } from '@/lib/validation/user-admin';

export async function updateUserAction(formData: FormData) {
  const profile = await requireRole(['super_admin']);
  const supabase = await createServerSupabaseClient();

  const targetId = formData.get('userId') as string;

  const parsed = updateUserSchema.safeParse({
    fullName: formData.get('fullName'),
    mobile: formData.get('mobile'),
    email: formData.get('email'),
    role: formData.get('role'),
    active: formData.get('active'),
  });

  if (!parsed.success) {
    redirect(`/super-admin/users/${targetId}?error=invalid`);
  }

  // Contact-info edits on a super_admin's own row are fine — only a role or
  // active-status CHANGE on their own row is rejected. The edit page's own
  // UI never lets a self-viewer submit a changed role/active value (see
  // Task 4 Step 2), so this only fires if that's somehow bypassed.
  if (targetId === profile.id) {
    const { data: current } = await supabase
      .from('profiles')
      .select('role, active')
      .eq('id', targetId)
      .maybeSingle();
    if (current && (current.role !== parsed.data.role || current.active !== parsed.data.active)) {
      redirect(`/super-admin/users/${targetId}?error=self_lock`);
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: parsed.data.fullName,
      mobile: parsed.data.mobile || null,
      email: parsed.data.email,
      role: parsed.data.role,
      active: parsed.data.active,
    })
    .eq('id', targetId);

  if (error) {
    redirect(`/super-admin/users/${targetId}?error=save_failed`);
  }

  redirect(`/super-admin/users/${targetId}?saved=1`);
}

export async function sendPasswordResetAction(formData: FormData) {
  await requireRole(['super_admin']);
  const supabase = await createServerSupabaseClient();

  const targetId = formData.get('userId') as string;
  const targetEmail = formData.get('email') as string;

  // Same non-privileged mechanism /forgot-password already uses — always
  // succeeds from the caller's perspective, matching that page's own
  // "don't reveal whether the email exists" behavior.
  await supabase.auth.resetPasswordForEmail(targetEmail, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  });

  redirect(`/super-admin/users/${targetId}?reset_sent=1`);
}
```

- [ ] **Step 2: Implement the page**

Create `src/app/(app)/super-admin/users/[id]/page.tsx`:

```tsx
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
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={user.email ?? ''}
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
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
```

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

- [ ] **Step 4: Manual verification (requires a running dev server and a seeded database)**

Sign in as `superadmin@fmb.test`, open a *different* user's edit page from the list, change their role and status, save, confirm "Changes saved" and the new values persist. Then visit your OWN edit page (`/super-admin/users/<your-own-id>`) and confirm the role/status controls render as plain disabled-looking text, not editable selects, and that saving a contact-info-only change (e.g. mobile number) on your own row still succeeds. Click "Send Password Reset Email" for another user and confirm the email appears in Mailpit (http://127.0.0.1:54324). Click "View Request History" and confirm it lands on the existing `/admin/users/[id]` page.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/super-admin/users/[id]"
git commit -m "feat: add super-admin user edit, password reset, and history link at /super-admin/users/[id]"
```

---

### Task 5: Nav link from `/super-admin`

**Files:**
- Modify: `src/app/(app)/super-admin/page.tsx`

**Interfaces:**
- Consumes: none new — this task only adds a `<Link>` to an existing page.

- [ ] **Step 1: Add the nav link**

In `src/app/(app)/super-admin/page.tsx`, the existing `<div className="mt-4 flex flex-wrap gap-3">` block has two links ("Menu Approvals", "No-Service Dates"). Add a third, in the same style, right after "No-Service Dates":

```tsx
<Link
  href="/super-admin/users"
  className="inline-block rounded-lg bg-blue-600 px-4 py-3 text-lg text-white"
>
  Manage Users
</Link>
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/super-admin/page.tsx"
git commit -m "feat: add Manage Users nav link to /super-admin"
```

---

### Task 6: Integration tests — self-lockout and role-change RLS

**Files:**
- Create: `src/lib/supabase/user-admin-rls.integration.test.ts`

**Interfaces:**
- Consumes: the `profiles_prevent_role_active_change` trigger (Task 1), `profiles_update_super_admin`/`profiles_select` RLS (Phase 1, already in place)

- [ ] **Step 1: Write the tests**

Create `src/lib/supabase/user-admin-rls.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !url || !anonKey || !serviceKey;

describe.skipIf(skip)('Super-admin user management RLS', () => {
  it('a super_admin can change another user\'s role and active status', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: target } = await serviceClient.from('profiles').select('id, role, active').eq('user_code', 'US001').single();
    const originalRole = target!.role;
    const originalActive = target!.active;

    const superAdminClient = createClient(url!, anonKey!);
    await superAdminClient.auth.signInWithPassword({ email: 'superadmin@fmb.test', password: 'DevPass123!' });

    const newRole = originalRole === 'admin' ? 'user' : 'admin';
    const { data: updated, error } = await superAdminClient
      .from('profiles')
      .update({ role: newRole, active: originalActive })
      .eq('id', target!.id)
      .select('role')
      .single();

    expect(error).toBeNull();
    expect(updated!.role).toBe(newRole);

    // Revert, so this test doesn't leave permanent residue on a shared seeded user.
    await serviceClient.from('profiles').update({ role: originalRole }).eq('id', target!.id);
  });

  it('an active super_admin CANNOT change their own role or active status', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: self } = await serviceClient.from('profiles').select('id, role, active').eq('user_code', 'SA001').single();

    const superAdminClient = createClient(url!, anonKey!);
    await superAdminClient.auth.signInWithPassword({ email: 'superadmin@fmb.test', password: 'DevPass123!' });

    const { error } = await superAdminClient
      .from('profiles')
      .update({ role: 'user' })
      .eq('id', self!.id);

    expect(error).not.toBeNull();

    // Confirm the role genuinely did not change.
    const { data: after } = await serviceClient.from('profiles').select('role').eq('id', self!.id).single();
    expect(after!.role).toBe(self!.role);
  });

  it('a plain admin (not super_admin) cannot change any user\'s role or active status', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: target } = await serviceClient.from('profiles').select('id, role').eq('user_code', 'US002').single();
    const originalRole = target!.role;

    const adminClient = createClient(url!, anonKey!);
    await adminClient.auth.signInWithPassword({ email: 'admin1@fmb.test', password: 'DevPass123!' });

    const { error } = await adminClient
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', target!.id);

    expect(error).not.toBeNull();

    const { data: after } = await serviceClient.from('profiles').select('role').eq('id', target!.id).single();
    expect(after!.role).toBe(originalRole);
  });
});
```

- [ ] **Step 2: Run the tests (requires local Supabase running and seeded users)**

```bash
npx vitest run src/lib/supabase/user-admin-rls.integration.test.ts
```

Expected: PASS (3 tests), genuinely executed (not skipped) when `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are exported in the running shell.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/user-admin-rls.integration.test.ts
git commit -m "test: add integration tests for super-admin user edit RLS and the self-lockout trigger"
```

---

## Self-Review Notes

- **Spec coverage:** the invite flow (service-role client, one file) → Task 3. Edit/activate/deactivate/change-role → Task 4. Password reset → Task 4 (`sendPasswordResetAction`). "View user history" → Task 4's link to the existing `/admin/users/[id]`. "Never permanently delete" → no task adds a delete path; `active = false` is the only state change. Self-lockout guard → Task 1 (DB) + Task 4 (UI/action) + Task 6 (proof). Nav discoverability → Task 5.
- **Type consistency:** `InviteUserInput`/`UpdateUserInput` (Task 2) are imported by name, unchanged, by Tasks 3 and 4 — no page redefines its own copy of these schemas.
- **No placeholders:** every step has runnable code; Task 3's note about not guessing at Supabase's exact invite-duplicate error code is an explicit, honest scope boundary, not a deferred "handle edge cases" placeholder — the code path itself is complete and handles every error as one generic case.
