# FMBRequestThali — Phase 2: Menu Workflow Design

Source spec: `FMBRequestThali Web App — Complete Development Prompt.md`. This document scopes **Phase 2 only** — menu data model and the create/submit/approve/reject workflow, for admin and super-admin roles. Builds directly on Phase 1's foundation (auth, RBAC, RLS helpers, `audit_logs`, `lib/auth`, `lib/validation`, `lib/supabase`).

## Why this shape

§13 of the source spec sketches a single flat `menus` table with a `status` column, but §26 (the authoritative database-architecture section) splits menu/service-date info, revisions+approval state, and items into three separate tables. Only the three-table split satisfies §15's core rule: **while a new revision is pending approval, users must keep seeing the previously approved version** — a single mutable row can't hold "the version everyone sees" and "the version being reviewed" at the same time. This design follows §26.

## Scope

**In Phase 2:**
- Tables: `menus`, `menu_versions`, `menu_items`
- Full draft → pending_approval → approved/rejected/superseded workflow
- RLS: public-approved-read, admin-draft-write, super-admin-only approval (via `SECURITY DEFINER` RPC, never a raw client UPDATE)
- First real writers to Phase 1's `audit_logs` table (menu created/submitted/approved/rejected)
- Admin UI: `/admin/menu` (list), `/admin/menu/new` (create draft), `/admin/menu/[id]` (edit + submit for approval)
- Super-admin UI: `/super-admin/approvals` (queue, item-level diff, approve/reject with required rejection reason)
- Seed data: menus for previous 3 days, today, next 7 days; one pending-approval version; one rejected version (per source spec §51)

**Explicitly not in Phase 2** (Phase 3, alongside the user dashboard): any user-facing menu calendar/display, thali_requests, the 6PM cutoff wired into a real request flow (Phase 1's `lib/time` helpers exist and are unit-tested but still unused by any route), leave/no-service system, concerns, notifications, reports.

## Database schema

```sql
create table menus (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  current_approved_version_id uuid, -- FK added after menu_versions exists (circular ref)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type menu_version_status as enum (
  'draft', 'pending_approval', 'approved', 'rejected', 'superseded'
);

create table menu_versions (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references menus(id) on delete cascade,
  version_number int not null,
  title text,
  notes text,
  status menu_version_status not null default 'draft',
  created_by uuid not null references profiles(id),
  submitted_by uuid references profiles(id),
  submitted_at timestamptz,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  rejected_by uuid references profiles(id),
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_id, version_number)
);

alter table menus add constraint menus_current_approved_version_fk
  foreign key (current_approved_version_id) references menu_versions(id);

-- At most one active (draft/pending_approval) version per menu at a time.
create unique index menu_versions_one_active_per_menu
  on menu_versions (menu_id)
  where status in ('draft', 'pending_approval');

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  menu_version_id uuid not null references menu_versions(id) on delete cascade,
  item_name text not null,
  category text not null check (category in
    ('gravy', 'dal', 'rice', 'roti', 'vegetable', 'salad', 'sweet', 'other')),
  description text,
  display_order int not null default 0
);
```

Indexes: `menus(service_date)` (already unique, indexed), `menu_versions(menu_id, status)`, `menu_items(menu_version_id)`.

`rejection_reason` is required by application-level validation (zod), not a DB constraint, when transitioning to `rejected` — matches the pattern of keeping business rules centralized in `lib/validation` rather than scattered.

## Workflow

1. **Create**: admin picks a service date. If no `menus` row exists for that date, create it. Create a `menu_versions` row (`status = 'draft'`, `version_number` = next in sequence for that menu, `created_by` = acting admin). Add `menu_items`.
2. **Submit for approval**: admin action transitions the draft to `pending_approval` (`submitted_by`, `submitted_at` set). Enforced: only the version's own `draft`/`rejected` status can transition here.
3. **Approve** (super_admin only, via RPC `approve_menu_version(version_id, reason?)`, `SECURITY DEFINER`):
   - Verify caller is super_admin (defense in depth — RLS also blocks this, but the RPC re-checks).
   - Verify target version is `pending_approval`.
   - If `menus.current_approved_version_id` is set, mark that old version `superseded`.
   - Mark target version `approved`, set `approved_by`/`approved_at`.
   - Update `menus.current_approved_version_id` to the target version.
   - Insert an `audit_logs` row (`action = 'menu_approved'`).
   - All of the above in one transaction (the function body).
4. **Reject** (super_admin only, via RPC `reject_menu_version(version_id, reason)`, `SECURITY DEFINER`):
   - Verify caller is super_admin, target is `pending_approval`, reason is non-empty.
   - Mark `rejected`, set `rejected_by`/`rejected_at`/`rejection_reason`.
   - Insert an `audit_logs` row (`action = 'menu_rejected'`).
5. **Edit after rejection**: admin edits the same `rejected` version's title/notes/items in place (no new version row — it was never live, nothing to preserve), then re-submits (`rejected` → `pending_approval`, steps back to 2).
6. **Edit an already-approved menu**: never mutates the approved row. Creates a brand-new `menu_versions` row (`draft`, next `version_number`) for the same `menu_id`. The old approved version stays `approved` and `menus.current_approved_version_id` keeps pointing at it until the new version clears the approval RPC — this is the entire mechanism satisfying §15.

## RLS

- `menus`: select for any authenticated user (just date + pointer, no sensitive content). Insert/update only via admin+ server actions (not a broad policy — admins insert through a server action that also creates the first draft version in the same transaction).
- `menu_versions`: select where `status = 'approved'` (any authenticated user) OR `is_admin()` (admins/super-admins see their own draft/pending/rejected work too). Insert/update (for `draft`/`rejected` status only, enforced in the policy's `with check`) restricted to admin+. **No client-side policy ever allows setting `status = 'approved'`** — that column transition only happens inside the `SECURITY DEFINER` RPCs above, closing §49's "admin cannot approve own menu through unauthorized APIs."
- `menu_items`: select/write mirrors the parent `menu_versions` row's visibility (a user can read items belonging to any version they can read the parent for).
- `approve_menu_version` / `reject_menu_version` RPCs: `SECURITY DEFINER`, but each starts with an explicit `is_super_admin()` check and raises an exception otherwise — RLS on the underlying tables is the backstop, the RPC's own check is the primary gate (matches the profiles role-lock pattern from Phase 1).

## Audit logging

Both RPCs insert into `audit_logs` (`actor_id`, `action`, `entity_type = 'menu_version'`, `entity_id`, `previous_state`, `new_state`). This is the first phase where audit rows actually get written — Phase 1 built the table with zero client write grants specifically so that only `SECURITY DEFINER` functions like these could ever populate it.

## UI

- `/admin/menu`: list of menus by date, each showing its current status (approved / pending / draft / rejected / no menu yet).
- `/admin/menu/new`: pick a date, add items by category, save as draft.
- `/admin/menu/[id]`: edit a menu's active version (draft or rejected-being-resubmitted), "Submit for Approval" button. If the menu has an approved version and an admin starts editing, this is where the "new draft version" gets created transparently (admin doesn't need to think about version numbers).
- `/super-admin/approvals`: queue of `pending_approval` versions. Each row expands to a diff: for each category, items only in the old approved version (removed), only in the new version (added), or present in both with different text (changed) — matching §15's example presentation. Approve / Reject buttons; Reject requires a reason (client + server validated via zod).

## Error handling

- Submitting a version that isn't in `draft`/`rejected` status: reject with a clear message, don't silently no-op.
- Approving/rejecting a version that isn't `pending_approval` (e.g., a race where two super-admins act on the same item): the RPC's own status check catches this and raises an error surfaced to the UI as "This menu was already reviewed."
- Rejecting without a reason: blocked client-side (zod) and server-side (RPC parameter check) — never a silent empty-reason rejection.

## Testing

- Unit tests: zod schemas for menu-version create/submit/reject-reason.
- RLS/RPC integration tests (same `describe.skipIf` pattern as Phase 1's `rls.integration.test.ts`, since they need a live Supabase instance): an admin cannot call `approve_menu_version` directly (permission denied), a super_admin can approve a pending version and `menus.current_approved_version_id` updates correctly, the old approved version becomes `superseded`, a rejected version requires a reason.

## Seed data

Extend the seeding pattern from Phase 1 (a script using the seeded admin/super-admin accounts, or direct SQL in `supabase/seed.sql` if it's simpler without needing auth context): menus for the previous 3 days, today, and the next 7 days, each with an `approved` version and realistic items across categories. One additional menu with a `pending_approval` version (to populate the approval queue) and one with a `rejected` version + reason (per source spec §51's seed-data list).
