# FMBRequestThali — Phase 3a: Core Thali Request Flow Design

Source spec: `FMBRequestThali Web App — Complete Development Prompt.md`. This document scopes **Phase 3a only** — the user-facing thali request flow: the real user dashboard, portion selection, the 6PM cutoff actually enforced end-to-end, and the menu calendar. Builds directly on Phase 1 (auth, RBAC, `lib/auth`, `lib/time/cutoff.ts`, `lib/settings`, `portion_options`, `app_settings`) and Phase 2 (`menus`/`menu_versions`/`menu_items`, `current_approved_version_id`).

## Why this shape

§57 states the app's primary purpose is answering "how much food needs to be prepared for tomorrow" accurately. Every table and rule in this phase exists to make that number trustworthy: one row per user per service date (§26 unique constraint), portions that can't exist without `wants_thali = true` and can't survive if it's `false` (§49), and a cutoff that's provably unbypassable from the client (§11, §29, §49). Phase 1 already anticipated the portion model — `portion_options` (gravy/rice as labeled rows) and `app_settings.roti_min_qty`/`roti_max_qty` exist and are seeded — so this phase wires new UI and one new table to existing infrastructure rather than inventing a new configuration layer.

## Scope

**In Phase 3a:**
- Table: `thali_requests`
- Cutoff enforced in both the Server Action (fast client feedback) and RLS (unbypassable defense-in-depth) — mirrors Phase 2's "RPC does the real check, RLS backstops it" pattern
- User dashboard (`/dashboard`, replacing Phase 1's placeholder): Tomorrow's Thali card, Yes/No, portion selection, Confirm/Change Selection, "No Thali" confirmation dialog
- Menu calendar on the same page: previous 3 days, today, next 7 days, tap a day for full menu
- Seed data: thali requests across the seeded date range and 15 seeded users, in varied states (requested / no-thali / no-response)

**Explicitly not in Phase 3a** (later sub-phases per the agreed split):
- `thali_request_history` — deferred. `thali_requests.updated_at` is sufficient to know a request changed; a full field-level history table has no consumer until a reporting/dispute-resolution need actually exists (YAGNI). `audit_logs` is not reused for this — that table's own design (Phase 1) scopes it to *administrative* actions, and routine user self-edits would blur that boundary and bloat a table meant for accountability review.
- Admin-facing reads of `thali_requests` (dashboard counts, portion summaries, user search, detailed request view) — Phase 3b. No RLS policy in this phase grants any role other than the owning user read/write access to `thali_requests`; 3b adds its own admin-read policy when it needs one, keeping each phase's migration self-explanatory.
- `user_leaves` / `service_holidays` — Phase 3b. Phase 3a's cutoff/portion logic doesn't need to know about leave or no-service days yet; those tables don't exist, so no date in this phase's seed data has that status.
- Concerns, notifications, reports, kitchen view, search — Phases 3c/3d.

## Database schema

```sql
create table thali_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  service_date date not null,
  wants_thali boolean not null,
  gravy_portion_id uuid references portion_options(id),
  rice_portion_id uuid references portion_options(id),
  roti_quantity int,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  source text not null default 'web',
  created_at timestamptz not null default now(),
  unique (user_id, service_date),
  constraint thali_requests_portions_match_wants check (
    (wants_thali = true
      and gravy_portion_id is not null
      and rice_portion_id is not null
      and roti_quantity is not null)
    or
    (wants_thali = false
      and gravy_portion_id is null
      and rice_portion_id is null
      and roti_quantity is null)
  )
);

create index thali_requests_service_date_idx on thali_requests(service_date);
create index thali_requests_user_id_idx on thali_requests(user_id);
```

`roti_quantity`'s min/max bounds (`app_settings.roti_min_qty`/`roti_max_qty`) are enforced by the Server Action's zod schema, not a static CHECK constraint — the bounds are super-admin-configurable at runtime (§9), so a CHECK constraint would need to be redefined every time they change. The presence/absence relationship above (portions exist iff `wants_thali`) is static and universal, so it belongs in the DB.

`locked_at` is part of the schema (matches §26's recommended fields) but Phase 3a never writes it — whether a request is locked is always computed live from `is_before_cutoff()`, never trusted from a stored flag (a stale `locked_at` would be a worse bug than not having one). The column exists now so a future phase can populate it for point-in-time snapshots (§37) without a migration.

### SQL cutoff function

RLS policies need a SQL-evaluable version of `lib/time/cutoff.ts`'s logic — a Postgres function, not a second hand-written implementation, mirroring the same algorithm (previous day + configured cutoff time, interpreted in the configured timezone, compared against `now()`):

```sql
create or replace function public.is_before_request_cutoff(p_service_date date)
returns boolean
language sql
stable
as $$
  select now() < (
    ((p_service_date - interval '1 day')::date::text || ' ' ||
     (select value #>> '{}' from app_settings where key = 'cutoff_time'))::timestamp
    at time zone (select value #>> '{}' from app_settings where key = 'timezone')
  )
$$;
```

**Risk flagged, not resolved here:** this function and `lib/time/cutoff.ts` must stay in agreement — two implementations of one business rule. The testing section below adds an integration test that asserts they agree at representative instants (just before/at/after cutoff) precisely so drift is caught, not because duplication was avoided.

## Server-side flow

`submitThaliRequestAction(formData)`:
1. `requireRole(['user', 'admin', 'super_admin'])` — any authenticated active profile.
2. Parse via a new `thaliRequestSchema` (zod) — `serviceDate`, `wantsThali`, and conditionally `gravyPortionId`/`ricePortionId`/`rotiQuantity` (validated against the current `roti_min_qty`/`roti_max_qty` fetched via `getSettings`).
3. Call `isBeforeCutoff(serviceDate, timezone, cutoffTime)` (existing helper) — if false, redirect with a clear "selection closed" error instead of attempting the write. This is the fast path; it saves a round trip but is never the only gate.
4. Upsert into `thali_requests` on `(user_id, service_date)` — insert if absent, update if present. The RLS policy's `with check` re-verifies the cutoff and the portions-match-`wants_thali` invariant at the database layer regardless of what the Server Action already checked, closing §49's "cutoff cannot be bypassed using direct API request."
5. Return the saved row so the UI can render the authoritative confirmed state — never assume success before the server responds (§41).

## RLS

- `thali_requests`: 
  - `select`: `user_id = auth.uid()` only.
  - `insert`: `with check (user_id = auth.uid() and is_before_request_cutoff(service_date))`.
  - `update`: `using (user_id = auth.uid()) with check (user_id = auth.uid() and is_before_request_cutoff(service_date))` — an update attempted after cutoff has zero matching rows under `with check` and fails, it doesn't silently no-op (Server Action treats an empty/error result as "selection closed," matching §11's required messaging).
  - No `delete` policy — nothing in the spec deletes a request; "No Thali" is a value of `wants_thali`, not a row removal.
- `portion_options`: already public-read from Phase 1 — no change needed, this phase just consumes it.

## UI

- `/dashboard` (replaces the Phase 1 placeholder): 
  - **Tomorrow's Thali** card at the top — service date, the approved menu's items for that date (reading `menus`/`menu_versions`/`menu_items` exactly as Phase 2's admin pages already query them, filtered to `current_approved_version_id`), then the two large Yes/No buttons (§8).
  - Selecting **Yes** reveals portion selection (gravy/rice as button groups sourced from `portion_options`, roti as a `[-] N [+]` stepper bounded by the configured min/max) and a **Confirm Thali** button.
  - Selecting **No** shows a confirmation dialog ("No thali for <date>? [Yes, confirm] [Go back]") per §32 before saving — prevents an accidental mis-tap from silently recording no-thali.
  - After saving: a clear confirmed state (§10) showing the saved selection and a **Change Selection** button, available until cutoff. After cutoff: a locked state (§11) showing exactly one of the three required-distinct outcomes — Thali requested (with the saved portions), No Thali Requested, or No Response Submitted Before Cutoff — computed from whether a row exists at all, not merged into one ambiguous state.
  - **Menu calendar** section below: previous 3 days, today, next 7 days, horizontally scrollable cards on mobile (§12), each visually distinguishing past/today/tomorrow/future via icon+text+color together, never color alone (§30). Tapping a day opens its full menu. A date with no approved menu shows the same empty-state copy Phase 2 already established ("No menu has been published for this date yet.").

## Error handling

- Submitting after cutoff (fast-path check in the Server Action, or the RLS `with check` catching a race where cutoff passed between page load and submit): "Selection time has closed. Your previous saved selection has been kept." (§29) — never silently discard the attempt without explanation.
- Save failure for any other reason: "Your selection was not saved. Please try again." (§41) — never show a success state before the server confirms.
- Duplicate-submit protection: disable the Confirm button during the save request (button text transitions Confirm → Saving... → Confirmed, §40).

## Testing

- Unit tests: `thaliRequestSchema` (wants_thali=true requires all three portion fields within configured roti bounds; wants_thali=false rejects any portion field being present).
- Integration test (new, live-Supabase, same `describe.skipIf` pattern as Phases 1/2): 
  - `is_before_request_cutoff()` (SQL) agrees with `isBeforeCutoff()` (TS) at three instants: well before, well after, and as close to the exact boundary as a test can reliably assert.
  - A user can submit before cutoff; a second submit for the same date updates the same row (no duplicate); `unique(user_id, service_date)` holds.
  - A user cannot submit or modify after cutoff (simulated via a `service_date` whose cutoff has already passed relative to `now()`).
  - A user cannot read another user's `thali_requests` row.

## Seed data

Extend `scripts/seed-menus.ts`'s pattern with a new `scripts/seed-thali-requests.ts` (or extend the existing script — decide at implementation time based on which reads cleaner): for the same date range Phase 2 already seeds menus across, assign each of the ~15 seeded users a request state — most days: a mix of "requested" (varied portions) and "no thali"; leave at least one user with no row at all on at least one date (no-response); keep this varied enough that the admin dashboard Phase 3b builds next has real, distinguishable counts to display.
