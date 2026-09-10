# FMBRequestThali — Phase 6: Reports Design

Source spec: `FMBRequestThali Web App — Complete Development Prompt.md` §35 (Reports, ~line 1359). Builds on Phase 1 (auth/RBAC), Phase 3a (thali requests), Phase 3b-core (leave/holidays, `computeDailySummary`), Phase 3b-detail (`classifyRequestStatus`, `/admin/users/search`, `/admin/users/[id]`), and Phase 4 (`concerns`) — all merged on `master`.

## Why this shape

Three of the four reports the spec asks for are almost entirely reuse, not new logic. The Daily Thali Report is `computeDailySummary` (Phase 3b-core) called for an admin-chosen date instead of the `/admin` dashboard's hardcoded "tomorrow" — no new aggregation function. The Date Range Report reuses the same function per-date across a range rather than re-deriving the leave-overrides-a-stale-request precedence a second time: it calls `computeDailySummary` once for each date in the range and sums/averages the results, so that one rule stays in the one place it's already implemented and tested. The Concern Report is the only genuinely new aggregation (a group-by over `concerns` by category and by status), since nothing existing groups concerns that way yet.

The User History Report deliberately does not touch the already-shipped `/admin/users/[id]` page. That page is the operational "what's this user doing right now" view (today/tomorrow status, a fixed trailing 14-day window); this phase's `/admin/reports/user-history` is the reporting view (an admin-chosen date range), reusing `/admin/users/search`'s entry point but landing on its own page. This matches the precedent set repeatedly across this project — a new capability links out to or reuses an existing shipped page's pattern, but never edits it.

Every report renders as a plain HTML table, matching source spec §43's explicit "avoid complex graphs" instruction. This also happens to be exactly the shape the spec's "design reports so CSV/Excel export can be added... where appropriate" note asks for — a table is already row-shaped, exportable data; no speculative export-library integration is needed now to satisfy that architectural note.

## Scope

**In Phase 6:**
- `src/lib/reports/date-range-summary.ts` — `computeDateRangeSummary(dailySummaries: DailySummary[]): DateRangeSummary`
- `src/lib/reports/concern-summary.ts` — `computeConcernSummary(concerns: ConcernRow[]): ConcernSummary`
- `/admin/reports` — landing page linking to the 4 reports below
- `/admin/reports/daily` — Daily Thali Report (single date)
- `/admin/reports/range` — Date Range Report (from/to, capped at 90 days)
- `/admin/reports/user-history` — search a user, choose a date range, see their history
- `/admin/reports/concerns` — Concern Report (optional date filter, category/status breakdowns)
- A nav link from `/admin` to `/admin/reports`
- All four report routes accessible to both `admin` and `super_admin`, per §35's explicit "Admin and super admin should have reporting"

**Explicitly not in Phase 6:**
- Actual CSV/Excel export — reports render as plain HTML tables only; that row-shaped data is what a later phase would serialize, not built now.
- `audit_logs` — remains completely unwritten-to by any code in this app; a separately-tracked gap for a future Audit Logging phase, not conflated with this one even though the source spec places them near each other.
- Source spec §36 "Admin Next-Day Kitchen View" — functionally redundant with the existing `/admin` dashboard's tomorrow's-summary-and-portions content, and not one of the 23 numbered items in spec §58's build sequence. Out of scope for this phase.
- Any modification to `/admin/users/[id]`, `/admin/users/search`, or `/admin` beyond the one new nav link — this phase only adds new pages.

## `computeDateRangeSummary`

```ts
export type DateRangeSummary = {
  totalDays: number;
  totalThalis: number;
  averageDailyThalis: number;
  totalNoThali: number;
  totalNoResponse: number;
  totalOnLeave: number;
  gravyBreakdown: { label: string; count: number }[];
  riceBreakdown: { label: string; count: number }[];
  rotiBreakdown: { quantity: number; count: number }[];
  totalRotis: number;
};

export function computeDateRangeSummary(dailySummaries: DailySummary[]): DateRangeSummary;
```

Sums `thaliCount`/`noThaliCount`/`noResponseCount`/`onLeaveCount`/`totalRotis` across every `DailySummary` in the array; `averageDailyThalis` is `totalThalis / totalDays` (guarded against a zero-length array, returning `0` rather than dividing by zero); portion breakdowns (gravy/rice/roti) are summed per-label/per-quantity across all days. Each `DailySummary` in the input array is produced by calling the existing `computeDailySummary` once per date in the chosen range — this function itself does no date arithmetic, leave lookups, or per-user classification; all of that stays exactly where Phase 3b-core already built and tested it.

## `computeConcernSummary`

```ts
export type ConcernRow = { category: string; status: string };

export type ConcernSummary = {
  totalConcerns: number;
  byCategory: { category: string; count: number }[];
  byStatus: { status: string; count: number }[];
};

export function computeConcernSummary(concerns: ConcernRow[]): ConcernSummary;
```

A flat group-by-and-count over whatever `concerns` rows are passed in (already filtered by date range, if any, before this function is called) — `byCategory` covers all 7 category values from `CONCERN_CATEGORIES` (Phase 4), `byStatus` covers all 4 status values from `CONCERN_STATUSES`, each including zero-count entries so the report's table always shows every category/status rather than silently omitting ones with no matches that day.

## `/admin/reports/daily`

`requireRole(['admin', 'super_admin'])`. A single date input (`searchParams.date`, defaulting to tomorrow, matching the existing `/admin` dashboard's own default). Fetches active users, that date's `thali_requests`, `user_leaves` overlapping that date, and portion options — the exact same two-query-no-embed data-fetching shape `/admin` already uses — then calls `computeDailySummary` and renders its fields as a report-styled table (not the dashboard's card grid) with the date in the heading.

## `/admin/reports/range`

`requireRole(['admin', 'super_admin'])`. `searchParams.from`/`searchParams.to`; if the parsed range exceeds 90 days, the page shows "Please choose a range of 90 days or fewer." without running any query. Otherwise: one query for `thali_requests` where `service_date` is between `from` and `to`, one for `user_leaves` overlapping `[from, to]`, one for active users, one for portion options. In application code: build the list of dates in the range, group the fetched requests by date, and for each date determine on-leave users via the same overlap check `/admin/requests` already uses — then call `computeDailySummary` once per date, collect the array of `DailySummary` results, and pass it to `computeDateRangeSummary`. Rendered as a summary table (`totalThalis`, `averageDailyThalis`, `totalNoThali`, portion distribution, etc.).

## `/admin/reports/user-history`

`requireRole(['admin', 'super_admin'])`. A plain GET search form (`?q=`) identical in shape to `/admin/users/search` — search `profiles` by name/user_code/mobile/email via `ilike`, results link to `/admin/reports/user-history?userId=<id>` carrying the search context forward. Once a `userId` is present, a from/to date range form appears; submitting it queries that user's `thali_requests` in `[from, to]`, classifies each row (or its absence) via `classifyRequestStatus` — the same function and precedence `/admin/users/[id]`'s existing history list already uses, just over a caller-chosen range instead of a fixed `limit(14)` — and renders the results as a table.

## `/admin/reports/concerns`

`requireRole(['admin', 'super_admin'])`. Optional `searchParams.from`/`searchParams.to` (an omitted filter shows all concerns — the table is small enough at this app's scale that no cap is needed here, unlike the Date Range Report's per-user-per-date classification cost). One query for `concerns` (filtered by `concern_date` if a range was given), passed to `computeConcernSummary`, rendered as two small tables (by category, by status) side by side.

## Error handling

- Date Range Report over 90 days: "Please choose a range of 90 days or fewer."
- Any report with no matching data for its period: "No data found for this period." (matches this app's established empty-state phrasing, e.g. `/admin/requests`'s "No thali requests found.").
- Any Supabase query error: the established red-banner error-state pattern used throughout every prior admin page, error-checked before use — never a silently fabricated zero-count.

## Testing

- Unit tests: `computeDateRangeSummary` — sums/averages across a small hand-built array of `DailySummary` objects, including a single-day array (average equals that day's count) and an explicit zero-length-array case (average is `0`, not `NaN`/a thrown division error).
- Unit tests: `computeConcernSummary` — grouping counts against a small hand-built array of `ConcernRow` objects, including a category/status with zero matching rows still appearing in the output with `count: 0`.
- No new integration tests: every query in this phase reads through RLS policies already integration-tested in earlier phases (`profiles_select`, `thali_requests_select_admin`, `user_leaves_select`, `concerns_select_own_or_admin`) — this phase adds no new table, no new policy, and no new write path.

## Seed data

None needed — the existing seeded `thali_requests`, `user_leaves`, and `concerns` rows from earlier phases already exercise every report in this phase.
