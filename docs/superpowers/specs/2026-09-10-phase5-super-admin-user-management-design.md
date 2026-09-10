# FMBRequestThali — Phase 5: Super-Admin User Management Design

Source spec: `FMBRequestThali Web App — Complete Development Prompt.md` §24 (Super Admin User Management, ~line 908). Builds on Phase 1 (auth/RBAC, `profiles` table and its RLS/trigger), Phase 3b-detail (`/admin/users/[id]` read-only history view), and everything before it — all merged on `master`.

## Why this shape

The one genuinely new capability this phase adds is creating a user account. Every account that exists today was created exclusively by `scripts/seed-users.ts`, a standalone script using the Supabase service-role key — a key never used anywhere in `src/` at runtime. Everything else the spec asks for (editing an existing user's role/contact info, viewing their history) already has a working path through machinery earlier phases built: `profiles_update_super_admin` RLS has existed since Phase 1's migration `0002_profiles_rls.sql` but has never had a UI consumer — this phase is its first real caller.

For account creation, the approved approach is a **Server Action** (`inviteUserAction`), not a literal Next.js Route Handler — functionally identical from a security standpoint (the service-role key stays server-side, in one file, never sent to the browser, only reachable via a super-admin-gated form submission), but it matches the one mutation pattern every other write in this app already uses instead of introducing a second one. The action calls `auth.admin.inviteUserByEmail()` (creates the auth user, emails a magic link so the new user sets their own password) and, if a non-default role was chosen, immediately sets it with the same service-role client — mirroring exactly what `scripts/seed-users.ts` already does successfully, moved from an offline script into the app behind a real permission check.

Editing an *existing* user never touches the service-role client — role/active/contact-info changes go through the caller's own super-admin session, exactly like every other admin write in this app (menu approvals, leave entries, service holidays).

A self-lockout risk surfaced during design: nothing before this phase has ever built a UI for changing role/active, so it's never come up that a super_admin could accidentally demote or deactivate themselves with no other super_admin able to undo it. This is closed in two places — the UI disables the controls on a super_admin's own row, and the stronger backstop is a small migration extending Phase 1's existing `profiles_prevent_role_active_change` trigger to reject a role/active change where the target row is the acting user's own, even if they are a genuinely active super_admin. This is the same dual-enforcement pattern already used for cutoff and leave/holiday enforcement, applied to a new risk.

## Scope

**In Phase 5:**
- Migration: extend the Phase 1 `profiles_prevent_role_active_change` trigger to also block a super_admin from changing role/active on their own row.
- `src/lib/validation/user-admin.ts` — zod schemas for the invite and edit forms.
- `src/app/(app)/super-admin/users/actions.ts` — `inviteUserAction`, `updateUserAction`, `sendPasswordResetAction`.
- `src/app/(app)/super-admin/users/page.tsx` — list of all profiles + "Add User" form.
- `src/app/(app)/super-admin/users/[id]/page.tsx` — edit an existing user's contact info/role/active, trigger a password-reset email, link to `/admin/users/[id]` for history.
- Nav link from `/super-admin` to `/super-admin/users`.

**Explicitly not in Phase 5:**
- Self-signup, invite-approval workflows.
- Deleting a profile — never; `active = false` is the only "removal" mechanism, per the spec's explicit requirement that historical operational records must remain available for reports.
- Bulk actions, CSV import, pagination on the users list — community-scale, same precedent as `/admin/leave` and `/super-admin/service-holidays`'s plain lists.
- Any change to the already-shipped, already-reviewed `/admin/users/[id]` — this phase only links to it, never modifies it.
- A "my own profile" self-edit page — out of scope; this phase is a super_admin managing *other* users.
- Seed data — the existing seeded users from Phase 1 already exercise every list/edit/history path this phase adds.

## Database schema

No new tables or columns. `profiles` already has every column this phase's list/edit UI needs (`id, user_code, full_name, mobile, email, role, active, created_at, updated_at`).

One migration, a back-edit into Phase 1's trigger function:

```sql
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

The self-check runs first and applies to everyone, including an active super_admin — closing the lockout risk at the one place every write path (this phase's `updateUserAction`, any future tooling, even a direct API call authenticated as that super_admin) must go through. This trigger fires on every `profiles` update regardless of RLS, so it is the unbypassable backstop; `updateUserAction`'s own same-id check is the fast-path UX rejection, matching this app's established dual-enforcement pattern.

## The invite flow

`inviteUserAction(formData)`:
1. `requireRole(['super_admin'])` on the caller's own session — authorization is always checked via the ordinary client first, never the service-role one.
2. Validate `fullName`, `email`, `userCode`, `role` (defaults `'user'`) via zod.
3. A service-role client — constructed from `SUPABASE_SERVICE_ROLE_KEY`, read only inside `actions.ts`, never sent to the browser — calls `auth.admin.inviteUserByEmail(email, { data: { full_name: fullName, user_code: userCode }, redirectTo: '${NEXT_PUBLIC_SITE_URL}/auth/callback' })`. This creates the auth user and, via the existing `handle_new_user` trigger (Phase 1, migration `0001_profiles.sql`), the profile row — role starts as `'user'`.
4. If a non-`'user'` role was selected, immediately follow with `serviceClient.from('profiles').update({ role }).eq('id', newUserId)` — the exact pattern `scripts/seed-users.ts` already uses successfully today; this call happens before the new user has ever authenticated, so the self-lockout trigger addition above never applies to it (`auth.uid()` under a service-role request is never equal to the brand-new user's id).
5. Redirect to `/super-admin/users?invited=1` on success, or back with a specific error: a duplicate email/member ID (surfaced by the DB's existing unique constraints as a `23505` error, matching the handling pattern already used in `/super-admin/service-holidays`), or an invite-send failure from Supabase Auth.

## `/super-admin/users` and `/super-admin/users/[id]`

- **`/super-admin/users`** (`requireRole(['super_admin'])`): one query for all profiles (`id, full_name, user_code, mobile, email, role, active, created_at`), ordered by `created_at desc`. The "Add User" form (full name, email, member ID, role select) sits at the top, submitting to `inviteUserAction`. Below it, every user in a table (desktop) / stacked cards (mobile, matching the responsive pattern already established in `/admin/requests`), each row linking to `/super-admin/users/[id]`.
- **`/super-admin/users/[id]`** (`requireRole(['super_admin'])`): fetches the target profile (redirects to `/super-admin/users` with a not-found message if it doesn't resolve). An edit form (name/mobile/email/role/active) pre-filled with the current values, submitted via `updateUserAction`. A separate "Send Password Reset Email" button wired to `sendPasswordResetAction`, which reuses `resetPasswordForEmail` — the exact mechanism `/forgot-password` already uses, no new password machinery. A link to `/admin/users/[id]` for the read-only operational history view (today/tomorrow thali status, 14-day request history) already built in Phase 3b-detail.

If the viewed `id` equals the caller's own id, the role and active controls are rendered disabled in the UI (contact-info fields remain editable). `updateUserAction` also rejects a self role/active change server-side, before the database would even be touched — a fast, clear rejection rather than surfacing the trigger's raw exception; the trigger itself remains the true, unbypassable backstop.

## Error handling

- Duplicate email or member ID on invite: "A user with that email or member ID already exists."
- Invite send failure: "Could not send the invite. Please try again."
- A self role/active change attempt (should be prevented by the disabled UI, but checked regardless): "You cannot change your own role or active status."
- An unknown user id at `/super-admin/users/[id]`: redirect to `/super-admin/users` with a not-found message.
- Any other update failure (network/DB error on `updateUserAction`): "Could not save these changes. Please try again."

## Testing

- Unit tests: zod schemas for the invite form (required fields, email format, role enum) and the edit form (same shape, all fields effectively optional-but-present since it's a pre-filled edit, matching this app's established `.nullable().optional()` handling for any field a form might submit empty).
- Integration tests (live-Supabase, existing `describe.skipIf` pattern): a super_admin can update another user's role and active status; a super_admin attempting to change their *own* role or active status is rejected by the database (proves the trigger addition, not just `updateUserAction`'s own check); a non-super_admin — including a plain admin — cannot update any profile's role or active status (this already follows from existing RLS/trigger behavior from Phase 1, but this phase adds an explicit test covering the specific new edit path).

## Seed data

None needed — Phase 1's existing seeded users (`SA001`, `AD001`, `AD002`, `US001`-`US015`) already exercise every list/edit/history path this phase adds.
