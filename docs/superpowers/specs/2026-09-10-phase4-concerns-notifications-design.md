# FMBRequestThali — Phase 4: Concern System + Notifications Design

Source spec: `FMBRequestThali Web App — Complete Development Prompt.md` §21 (Concern Submission), §22 (Concern Tracking), §23 (Notifications), §26 (Database Architecture), §28 (Security/RLS). Builds on Phase 1 (auth/RBAC), Phase 2 (menus), Phase 3a (thali requests), Phase 3b (leave/holidays, admin dashboard, detailed request view, user search) — all merged on `master`.

## Why this shape

§22 lists both a single `admin_response` field on `concerns` and a separate `concern_updates` table for what is, on inspection, the same purpose: recording how an admin responds to a concern. A single field can only ever hold the latest reply — it can't represent "Reviewing → an admin left a note → Resolved" as a sequence, and it would be silently overwritten by a second reply. This design drops `admin_response` and keeps only `concern_updates`, a real timeline: every status change and every admin message becomes one row, timestamped and attributed. That table is what the submitting user sees as their concern's history.

This is a different thing from `audit_logs` (already created in Phase 1's migration `0005_audit_logs.sql`, still unwritten-to by anything in the codebase). `concern_updates` is the user-facing conversation; `audit_logs` would be the super-admin-only internal record of *which admin* did *what*, across every administrative action in the app (menu approvals, leave entries, role changes — not just concerns). This phase does not write to `audit_logs` at all — that gap is real, bigger than originally scoped, and deliberately left for Phase 6 (Reports + Audit Logging) rather than partially addressed here.

For notifications, §23 requires the architecture not be "tightly coupled to a particular notification provider," since WhatsApp/SMS/email/push are named as future integrations. The smallest shape that satisfies this without building speculative infrastructure: one `notifications` table plus a single helper, `notify(recipientId, type, payload)`, in `lib/notifications.ts`. Its body today is a single DB insert — in-app delivery only. Nothing that calls `notify()` needs to know that; when a later phase adds a second delivery channel, `notify()`'s internals change once and every call site is untouched. This is the same "aggregation lives in one pure/simple function, not scattered" pattern this app has used repeatedly (`daily-summary.ts`, `request-status.ts`).

Only 2 of the spec's 7 "possible notifications" belong to this phase's own subsystem (concern response received, concern resolved). The other 5 (menu published/changed/approved, thali reminder, deadline approaching) are events already produced by Phase 2/3a code that this phase does not touch — wiring them in means either modifying already-shipped, already-reviewed menu-approval Server Actions (out of scope creep) or inventing a scheduled/cron mechanism for "deadline approaching" that doesn't exist anywhere in this app yet (a separate architectural decision, not a one-line addition). Both are deliberately deferred: once `notify()` exists and is proven by this phase's 2 real triggers, adding the other 5 is a single call each, dropped into existing code with no new architecture.

## Scope

**In Phase 4:**
- Tables: `concerns`, `concern_updates`, `notifications`
- RLS: users read/create only their own concerns, read their own `concern_updates` and `notifications`; admin/super_admin read and update any concern (shared queue — no per-admin assignment) and insert `concern_updates`; nobody has a client-facing insert policy on `notifications` (server-only, via `notify()`)
- `lib/notifications.ts` — `notify(recipientId: string, type: NotificationType, payload: Record<string, unknown>): Promise<void>`
- `/concerns` — user: "Raise Food Concern" form + list of their own concerns
- `/concerns/[id]` — user: one concern's full timeline
- `/admin/concerns` — admin/super_admin: searchable/filterable concern queue
- `/admin/concerns/[id]` — admin/super_admin: view thread, post a reply and/or change status
- Bell icon (shared header component) + `/notifications` — list, marks unread rows read on view
- Seed data: a handful of concerns across statuses/categories, with a couple of seeded `concern_updates`/`notifications` rows

**Explicitly not in Phase 4:**
- Image attachment upload UI or a storage bucket — `concerns.attachment_url` is a nullable column, unused by any form. No Supabase Storage bucket is created.
- `assigned_to` — no column, no per-admin assignment/claim workflow. Every admin/super_admin sees the same queue, matching the existing shared-queue pattern (`user_leaves`, `service_holidays`, menu approvals).
- The other 5 notification triggers (menu/reminder-related) — `notify()` exists and is proven by this phase's 2 triggers; wiring the rest into Phase 2/3a code is a small, separate follow-up.
- Any write to `audit_logs` — remains exactly as unwritten-to as it is today. Phase 6's scope.
- WhatsApp/SMS/email/push delivery of any kind.
- Live/realtime bell updates — the unread count is computed server-side on each page load/navigation, matching every other piece of data in this app (no client-side Supabase Realtime subscription exists anywhere yet, and this phase does not introduce one).
- A composer for the user to reply into their own concern thread — §21's "keep the form simple" framing means one submission, then admin replies; no back-and-forth composer in this phase.

## Database schema

```sql
create table public.concerns (
  id uuid primary key default gen_random_uuid(),
  concern_number bigint generated always as identity,
  user_id uuid not null references public.profiles(id),
  concern_date date not null,
  category text not null check (category in ('taste','quality','quantity','packaging','missing_item','menu','other')),
  message text not null,
  attachment_url text,
  status text not null default 'open' check (status in ('open','reviewing','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index concerns_user_id_idx on public.concerns(user_id);
create index concerns_status_idx on public.concerns(status);
create unique index concerns_concern_number_idx on public.concerns(concern_number);

create table public.concern_updates (
  id uuid primary key default gen_random_uuid(),
  concern_id uuid not null references public.concerns(id),
  new_status text check (new_status in ('open','reviewing','resolved','closed')),
  message text,
  changed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint concern_updates_has_content check (new_status is not null or message is not null)
);
create index concern_updates_concern_id_idx on public.concern_updates(concern_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id),
  type text not null check (type in ('concern_response','concern_resolved')),
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_unread_idx on public.notifications(recipient_id) where read_at is null;
```

`concern_number` is a single running identity sequence (not per-user), giving every concern a stable, human-readable, ever-increasing number ("Concern #47") — matching how the spec's own mockups refer to concerns by number, not by UUID. `concern_updates_has_content` prevents an update row carrying neither a status change nor a message — a no-op row that would otherwise be a silent logging bug. The `type` enum on `notifications` intentionally lists only the 2 values this phase produces; adding the other 5 later is a one-line enum extension plus a migration, not a redesign.

## Wiring: concern status changes and notifications

`/admin/concerns/[id]`'s reply Server Action does three things in one request, in this order:
1. Insert into `concern_updates` (the new status and/or message, `changed_by` = the acting admin's id).
2. If `new_status = 'resolved'`, update `concerns.resolved_at = now()` and `concerns.status = 'resolved'`; otherwise update `concerns.status` to whatever `new_status` was posted (or leave it unchanged if this update is a message-only reply with no status change) and touch `updated_at`.
3. Call `notify(concern.user_id, type, payload)` — `type = 'concern_resolved'` if the new status is `resolved`, otherwise `type = 'concern_response'`. `payload` carries `{ concernId, concernNumber }`, enough for the notification list to link back to `/concerns/[id]`.

`notify()` itself is a single insert into `notifications`, run with the server-privileged Supabase client (same client every Server Action already uses) — never reachable from a browser-originated request, since there is no client-facing insert policy on that table.

## RLS

```sql
alter table public.concerns enable row level security;
alter table public.concern_updates enable row level security;
alter table public.notifications enable row level security;

create policy concerns_select_own_or_admin on public.concerns
  for select using (user_id = auth.uid() or public.is_admin());

create policy concerns_insert_own on public.concerns
  for insert with check (user_id = auth.uid());

create policy concerns_update_admin on public.concerns
  for update using (public.is_admin()) with check (public.is_admin());

create policy concern_updates_select_own_or_admin on public.concern_updates
  for select using (
    public.is_admin()
    or exists (select 1 from public.concerns c where c.id = concern_id and c.user_id = auth.uid())
  );

create policy concern_updates_insert_admin on public.concern_updates
  for insert with check (public.is_admin());

create policy notifications_select_own on public.notifications
  for select using (recipient_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- Deliberately no insert policy on notifications for any role — rows are
-- written only via notify() running with the server client, matching
-- audit_logs' precedent of "no direct client insert grant."
```

`concerns_select_own_or_admin` mirrors the `is_admin() OR own-row` pattern already used for `user_leaves_select` — a user needs to read their own concern via the same predicate an admin's broader read uses. `notifications_update_own` is scoped to the recipient only, and is used solely for setting `read_at` — never for changing `type`/`payload` (enforced by the Server Action only ever writing `read_at`, not by a column-level grant restriction, matching this app's established preference for RLS-plus-Server-Action dual enforcement over column-level Postgres grants where the access pattern is simple).

## Routes and UI

- **`/concerns`** (`requireRole(['user','admin','super_admin'])` — anyone can raise a concern): a prominent "Raise Food Concern" button opening the submission form (concern date, defaulting to today; category `<select>` with the 7 spec values; message `<textarea>`; no attachment input). Below it, a list of the current user's own concerns — number, date, category, status badge (icon+text+color, matching every other status display in this app). Submitting shows "✅ Concern Submitted — Your concern has been sent to the administration." per §21's exact copy.
- **`/concerns/[id]`**: the submitter's view of one concern (redirects to `/concerns` with a not-found message if the id doesn't belong to them and they aren't an admin) — original message, then the `concern_updates` timeline in chronological order.
- **`/admin/concerns`** (`requireRole(['admin','super_admin'])`): reuses `/admin/requests`' searchParams+filter+search convention — filter by status (`all|open|reviewing|resolved|closed`), search by user name/user_code/concern number (two-query-no-embed: `concerns` and `profiles` queried separately, joined in application code, exactly as `user_leaves`+`profiles` already are).
- **`/admin/concerns/[id]`**: full thread plus a reply form (message textarea, optional status-change `<select>`) that runs the three-step Server Action described above.
- **Bell icon**: a small shared component in the app's header area, showing an unread `notifications` count for the signed-in user (one `count`-only query, computed fresh per page load). Links to `/notifications`.
- **`/notifications`**: lists the signed-in user's notifications newest-first; loading this page sets `read_at = now()` on every currently-unread row belonging to that user (simplest correct behavior given the reload-based, non-realtime approach already agreed — "opening the list is what marks it read," no separate bulk-action button needed).

## Error handling

- Concern submission failure: red banner, "Could not submit your concern. Please try again." — same convention as every prior form in this app.
- Admin reply/status-change failure on `/admin/concerns/[id]`: same red-banner convention.
- A concern id that doesn't resolve for the requesting user (not theirs, not an admin): redirect to `/concerns` (or `/admin/concerns` for an admin hitting a bad id) with a "Concern not found." message — matches `/admin/users/[id]`'s existing not-found precedent.

## Testing

- Unit tests: zod schema validation for the concern-submission form (category enum, message non-empty, date format) and the admin reply form (status enum when present).
- Integration tests (live-Supabase, existing `describe.skipIf` pattern): a user cannot read another user's `concerns` or `concern_updates` rows; a user cannot insert into `concern_updates` (admin-only); an admin can read and update any concern; `notify()` inserts a row that only its recipient can read (a second user's client cannot see it); a user cannot mark someone else's notification read (`notifications_update_own` blocks a mismatched `recipient_id`).

## Seed data

Extend the existing seed pattern with a new script: several concerns spread across statuses (open/reviewing/resolved/closed) and categories, attributed to a mix of seeded users, with 1-2 `concern_updates` rows on the non-open ones (so `/admin/concerns/[id]` and `/concerns/[id]` have real timelines to render) and matching `notifications` rows for the resolved/responded-to ones (so `/notifications` and the bell count have real data on first look).
