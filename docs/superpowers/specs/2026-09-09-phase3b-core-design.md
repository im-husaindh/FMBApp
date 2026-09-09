# FMBRequestThali — Phase 3b-core: Leave/No-Service + Admin Operational Dashboard Design

Source spec: `FMBRequestThali Web App — Complete Development Prompt.md`. This document scopes **Phase 3b-core only** — the leave/no-service data model, wiring it into Phase 3a's existing submission path, and the admin operational dashboard (today/tomorrow counts + portion summary). Builds on Phase 1 (auth/RBAC), Phase 2 (menus), and Phase 3a (`thali_requests`, dual cutoff enforcement, `lib/time/cutoff.ts`, `lib/settings`).

## Why this shape

§57 states the app's primary purpose is answering "how much food needs to be prepared for tomorrow" accurately. A leave or global no-service day that isn't correctly excluded from that count — or that lets a user submit a request anyway — breaks the one promise the app exists to keep (§20: "no user should accidentally be counted"). That's why leave/holiday enforcement is wired into Phase 3a's submission path in this same phase, rather than being a purely-additive admin feature bolted on later: the dashboard this phase builds is only trustworthy if the data feeding it can't drift from what users actually see.

**Aggregation lives in application code, not SQL**, per the brainstormed decision: a single pure, unit-tested TS function (`lib/reports/daily-summary.ts`) computes counts and portion totals from rows fetched by an async Server Component — satisfying §17's "never calculate critical totals only on the client" (a Server Component runs server-side) without introducing a Postgres view/function whose only consumer, right now, is this one page. A later phase's kitchen-view/reports page reuses the same TS function instead of a second SQL object — YAGNI until a second consumer actually exists.

**`user_leaves` overlap prevention is an application-level check, not a DB exclusion constraint.** A GiST exclusion constraint (`exclude using gist (...)`) is the textbook-correct mechanism, but it requires the `btree_gist` extension and meaningfully more migration complexity for a table admins write to infrequently and non-concurrently (matches Phase 2's precedent of accepting an app-level check for a similarly low-traffic, low-concurrency admin action). Marked as a deliberate simplification below, not silently skipped.

## Scope

**In Phase 3b-core:**
- Tables: `user_leaves`, `service_holidays`
- RLS: `user_leaves` — admin+super_admin manage; `service_holidays` — super_admin only to write, any authenticated user to read (needed so a user's own dashboard can detect a holiday)
- Two new SQL helper functions (`is_on_leave`, `is_service_holiday`), mirroring Phase 3a's `is_before_request_cutoff` pattern
- **Back-edit to Phase 3a:** `thali_requests` gains two new *restrictive* RLS policies (additive migration, `submitThaliRequestAction` unchanged in file location but gains two checks) blocking a write on a leave day or holiday date; `/dashboard` shows a dedicated "on leave" / "no service" state instead of `ThaliRequestCard` when applicable
- Admin UI: `/admin` (replacing the Phase 1 placeholder) — today/tomorrow summary cards, portion breakdown, holiday short-circuit state
- `/admin/leave` — admin+: list + create a leave entry (looked up by typed `user_code`/name match, not the full search UI — that's 3b-detail's scope)
- `/super-admin/service-holidays` — super_admin only: list + create global no-service dates
- Seed data: a few leave entries and one service holiday, per source spec §51

**Explicitly not in Phase 3b-core** (deferred to 3b-detail or later):
- The filterable detailed-request table/cards, user search UI (3b-detail)
- Concerns, notifications, reports, kitchen view (3c/3d)
- Any settings UI for configuring who besides admin/super_admin can manage leave — role assignment stays exactly as fixed as everywhere else in the app so far

## Database schema

```sql
create table user_leaves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  reason text,
  entered_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index user_leaves_user_id_idx on user_leaves(user_id);
create index user_leaves_date_range_idx on user_leaves(from_date, to_date);

create table service_holidays (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  reason text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
```

Overlap prevention for `user_leaves` happens in the create Server Action: query for any existing leave row for the same `user_id` where `from_date <= new.to_date and to_date >= new.from_date`, reject with a clear message if found. **Deliberate simplification, ceiling and upgrade path:** this is a check-then-insert race under concurrent admin edits for the *same* user — negligible risk given leave entries are created by admins one at a time, not a high-frequency path; upgrade to a `btree_gist` exclusion constraint if concurrent leave-entry creation ever becomes real.

### SQL helper functions

```sql
create or replace function public.is_on_leave(p_user_id uuid, p_service_date date)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_leaves
    where user_id = p_user_id and p_service_date between from_date and to_date
  )
$$;

create or replace function public.is_service_holiday(p_service_date date)
returns boolean language sql stable as $$
  select exists (select 1 from public.service_holidays where service_date = p_service_date)
$$;
```

## Wiring into Phase 3a (the one back-edit)

- **RLS (additive, new migration, does not touch Phase 3a's existing `thali_requests` policies):**
  ```sql
  create policy thali_requests_insert_not_leave_or_holiday on thali_requests
    as restrictive for insert
    with check (not is_on_leave(user_id, service_date) and not is_service_holiday(service_date));

  create policy thali_requests_update_not_leave_or_holiday on thali_requests
    as restrictive for update
    with check (not is_on_leave(user_id, service_date) and not is_service_holiday(service_date));
  ```
  Restrictive policies AND with the existing permissive ones rather than replacing them — this is why Phase 3a's own migrations are never touched.
- **`submitThaliRequestAction`** (`src/app/(app)/dashboard/actions.ts`, existing file): after the cutoff check and before the DB write, query `is_on_leave`/`is_service_holiday` (or the equivalent table lookups) and redirect with a specific error if either is true — same fast-path-then-DB-backstop pattern already used for cutoff.
- **`/dashboard`** (`src/app/(app)/dashboard/page.tsx`, existing file): before rendering `<ThaliRequestCard>`, check the same two conditions for `tomorrow`. If either is true, render a small dedicated info card instead ("You're on leave tomorrow" / "No Thali Service tomorrow — `<reason>`") — not a new internal step inside `ThaliRequestCard` (keeps that component's existing 5-state machine untouched and single-responsibility).

## Admin dashboard (`/admin`)

Replaces the Phase 1 placeholder. Server Component fetches: `thali_requests` for tomorrow (with portion joins, same two-query-no-embed pattern Phase 3a already established for `menus`/`menu_versions`), `user_leaves` overlapping tomorrow, `is_service_holiday(tomorrow)`, total active user count (`profiles` where `active = true` and `role = 'user'` — admins/super-admins don't order thali for themselves in this count, matching §16's "TOTAL USERS" framing as the community being served).

If tomorrow is a service holiday: render a single "No Thali Service tomorrow — `<reason>`" state, skip the summary cards and portion breakdown entirely (§20: "no user should accidentally be counted").

Otherwise, `lib/reports/daily-summary.ts` (new, pure function, unit-tested) takes the raw rows and total user count and returns `{ thaliCount, noThaliCount, noResponseCount, onLeaveCount, gravyBreakdown, riceBreakdown, rotiBreakdown, totalRotis }`. A user counted as "on leave" is excluded from "no response" even if they never submitted anything; a user with a `thali_requests` row is never double-counted against "on leave" (leave takes precedence, matching the RLS/action enforcement above — a leave user structurally cannot have a *current* row for that date, but the summary function doesn't rely on that invariant blindly: it explicitly checks leave first, in case of pre-existing seed data).

## `/admin/leave` and `/super-admin/service-holidays`

- `/admin/leave`: `requireRole(['admin','super_admin'])`. A form to create a leave entry — a plain text input matched against `profiles.user_code`/`full_name` (simple `ilike` query, not the full search UI), from/to date pickers, optional reason. Below it, a list of upcoming/current leave entries.
- `/super-admin/service-holidays`: `requireRole(['super_admin'])`. A form to add a global no-service date + reason, and a list of upcoming ones.

Both follow the established `searchParams: Promise<{ error?: string }>` + red banner pattern from every prior admin/super-admin page in this codebase.

## Error handling

- Leave creation with an overlapping range for the same user: reject with "This user already has a leave period covering part of these dates." (client + server checked via the query described above).
- `to_date < from_date`: rejected by the DB CHECK constraint and by zod client-side.
- A user attempting to submit while on leave or during a service holiday (race between page load and submit, or a direct API call): "You're on leave for this date." / "Thali service is unavailable on this date." — same non-silent-failure principle as Phase 3a's cutoff messaging (§29, §49).

## Testing

- Unit tests: `lib/reports/daily-summary.ts` (counts/portion totals against a handful of hand-constructed row sets, including a user with both a leave row and a stale `thali_requests` row, and a user with no row at all counted as "no response").
- Unit tests: leave-overlap detection logic (extracted as a small pure function so it's testable without a DB).
- Integration test (live-Supabase, same `describe.skipIf` pattern as Phase 1-3a): a user on leave cannot submit a `thali_requests` row for a leave date (RLS rejects); a user cannot submit for a `service_holidays` date; `is_on_leave`/`is_service_holiday` SQL functions agree with directly querying the tables for a constructed scenario.

## Seed data

Extend the existing seed pattern: 2-3 `user_leaves` entries for different seeded users covering a mix of past/current/future date ranges (per source spec §51's "leave entries"), and one `service_holidays` row for a near-future date (per §51's "one service holiday").
