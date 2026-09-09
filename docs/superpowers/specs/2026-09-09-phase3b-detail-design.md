# FMBRequestThali — Phase 3b-detail: Detailed Request View + User Search Design

Source spec: `FMBRequestThali Web App — Complete Development Prompt.md`. This document scopes **Phase 3b-detail only** — the admin-facing filterable request table and user search/detail pages. Builds directly on Phase 3b-core (`thali_requests`, `user_leaves`, `service_holidays`, `computeDailySummary`, the admin dashboard) and everything before it. Entirely read-only: no new tables, no RLS changes, no back-edits into any write path.

## Why this shape

§53 requires business rules to live in one centralized place, not scattered across components. Phase 3b-core's `computeDailySummary` already encodes the one rule that matters most in this app — a leave day overrides even a stale `thali_requests` row, checked before anything else — but it encodes it inline, for aggregate counting only. This phase needs the *identical* precedence for INDIVIDUAL users (one row per user in a table, one status on a profile page), and duplicating that branching here would be exactly the violation §53 warns against. So this phase starts by extracting the per-user classification into its own pure function, then makes `computeDailySummary` call it — a refactor of already-shipped, already-tested code, done because this phase's very first requirement needs the same logic Phase 3b-core already has, not scattered a second time.

**Search is a plain form submission, not live-as-you-type**, per the brainstormed decision — this app has no client-side data-fetching pattern anywhere yet (every interactive page is a Server Component + plain forms, `ThaliRequestCard`'s local state notwithstanding, which never fetches), and introducing one for an admin search tool serving a small community isn't justified. A GET form whose submission reloads the page with `?search=...` in the URL is simpler, server-rendered, and fast enough at this scale.

## Scope

**In Phase 3b-detail:**
- `src/lib/reports/request-status.ts` — new pure function `classifyRequestStatus`, extracted from `computeDailySummary`'s inline logic
- `src/lib/reports/daily-summary.ts` — refactored to call it (behavior-preserving; existing tests must still pass unchanged)
- `/admin/requests` — filterable/searchable table (desktop) / stacked cards (mobile) of a given date's requests, defaulting to tomorrow
- `/admin/users/search` — plain-form user search by name/user_code/mobile/email (partial match)
- `/admin/users/[id]` — a searched user's summary: today's/tomorrow's status, portion selection, recent (14-day) request history
- Navigation links from `/admin` to both new pages

**Explicitly not in Phase 3b-detail:**
- Any new table, RLS policy, or write path — this phase never inserts/updates/deletes anything
- Concerns, notifications, reports, kitchen view (Phases 3c/3d)
- Live/debounced search (explicit brainstormed decision — plain form only)
- Pagination beyond the 14-day history window (community-scale data, not needed yet)

## Shared classification function

```ts
// src/lib/reports/request-status.ts
export type RequestStatus = 'thali' | 'no_thali' | 'no_response' | 'on_leave';

export function classifyRequestStatus(
  isOnLeave: boolean,
  request: { wantsThali: boolean } | undefined
): RequestStatus {
  if (isOnLeave) return 'on_leave';
  if (!request) return 'no_response';
  return request.wantsThali ? 'thali' : 'no_thali';
}
```

`daily-summary.ts`'s loop changes from its current inline `if (onLeaveSet.has(userId)) {...} if (!request) {...} if (!request.wantsThali) {...}` chain to calling `classifyRequestStatus(onLeaveSet.has(userId), request)` once and switching on the result — same four branches, same order, same behavior, one shared source of truth. The existing 5 unit tests in `daily-summary.test.ts` assert on `DailySummary`'s output shape, not on the internal branching, so they should pass against the refactored implementation without modification — this is the test that proves the refactor didn't change behavior.

## `/admin/requests`

`requireRole(['admin', 'super_admin'])`. `searchParams`: `date` (`YYYY-MM-DD`, defaults to tomorrow via the same `todayInTimezone`/`addDays` helpers everywhere else uses), `filter` (`all | thali | no_thali | no_response | on_leave | gravy:<portion_id> | rice:<portion_id>`), `search` (free text).

Data fetch mirrors `/admin`'s existing pattern exactly (active users across all 3 roles, that date's `thali_requests`, leave rows overlapping that date, portion options) — same two-query-no-embed shape, same error-checking discipline established in Phase 3b-core's final fix wave. Each active user is classified via `classifyRequestStatus`, joined with their `profiles` row (name, `user_code`, mobile, email) via the two-query-no-embed pattern (never combine `profiles` with a multi-FK table in one `.select()`), then filtered by `filter` and `search` in application code — filtering an already-fetched, community-scale array in JS is simpler than translating every filter combination into SQL, and correct at this data volume.

Table columns: User (name + user_code), Thali (status badge), Gravy, Rice, Roti, Status. On mobile (`md:hidden` / `md:table` swap, one component, two Tailwind-conditional renderings — not two separate components), each row becomes a stacked card with the same fields as labeled rows.

## `/admin/users/search` and `/admin/users/[id]`

`/admin/users/search`: `requireRole(['admin', 'super_admin'])`. A plain GET form (`<input name="q">`), submitting reloads with `?q=...`. Below it, a results list from one `profiles` query: `.or('full_name.ilike.%${q}%,user_code.ilike.%${q}%,mobile.ilike.%${q}%,email.ilike.%${q}%')` — partial match across all four fields per §19. Empty `q` shows no results (not the whole user list) — matches §48's "do not download the entire user database to search." Each result links to `/admin/users/[id]`.

`/admin/users/[id]`: `requireRole(['admin', 'super_admin'])`. Selects only `profiles` columns (`full_name`, `user_code`, `mobile`, `email`, `role`, `active`) — never `auth.users`, never anything password/session-related, per §19's explicit requirement. Computes today's and tomorrow's status via `classifyRequestStatus` (same leave/request queries as `/admin/requests`, scoped to this one user). Shows the two statuses, the user's saved portion selection for tomorrow if `thali`, and the last 14 days of their `thali_requests` history (ordered `service_date desc`, no join needed — the caller already knows which user).

## Error handling

- No results for a search query: "No results found for this user search." (matches the exact empty-state copy pattern established in Phase 2/3a for consistency — §39's own example phrase).
- No requests for the selected date/filter combination on `/admin/requests`: "No thali requests found." (also a direct §39 example phrase).
- A user ID in the URL that doesn't resolve to a profile: redirect to `/admin/users/search` with a clear "User not found" message, not a crash.

## Testing

- Unit tests: `classifyRequestStatus`'s 4 branches directly (thali, no_thali, no_response, on_leave — including the leave-overrides-stale-request case, mirroring `daily-summary.test.ts`'s existing case 4 but at the single-row level).
- Unit tests: `daily-summary.test.ts` re-run unchanged after the refactor — this is the regression check proving `computeDailySummary`'s behavior didn't shift.
- No new integration test needed: this phase makes no RLS-relevant change (no new policies, no new tables) — the existing `profiles_select`/`thali_requests_select_admin`/`user_leaves_select` policies (all already `... or is_admin()`) already cover every read this phase performs, and that coverage was already integration-tested in Phase 3b-core.

## Seed data

None needed — this phase reads data Phase 3a/3b-core's seed scripts already produce (`seed:thali`, `seed:leave`). A manual/live verification pass (same authenticated-session pattern used throughout this project) should confirm `/admin/requests` and `/admin/users/[id]` render real seeded rows correctly, rather than adding a new seed script for a read-only feature.
