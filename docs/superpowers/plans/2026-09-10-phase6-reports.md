# FMBRequestThali — Phase 6: Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admin/super_admin four reports — a single-date thali summary, a date-range summary (capped at 90 days), a per-user history over a chosen period, and a concern breakdown by category/status — all reusing existing aggregation logic rather than re-deriving it.

**Architecture:** Two new pure functions (`computeDateRangeSummary`, `computeConcernSummary`) plus five new read-only pages under `/admin/reports`. The Daily and Date Range reports both build on the already-shipped `computeDailySummary` (Phase 3b-core) — the range report calls it once per date and sums the results, so the leave-overrides-a-stale-request precedence stays in the one place it's already implemented. No new tables, no new RLS, no write paths.

**Tech Stack:** Next.js Server Components (GET forms only, no Server Actions needed — this phase is entirely read-only), Supabase (Postgres + RLS), Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-phase6-reports-design.md` (and source `FMBRequestThali Web App — Complete Development Prompt.md` §35, §43)

## Global Constraints

- Strict TypeScript, no `any`.
- No new tables, no new migrations, no new RLS policies — every query in this phase reads through RLS already integration-tested in earlier phases.
- Never embed two tables across a multi-FK relationship in one `.select()` — query separately and join in application code (established throughout every prior admin page).
- Every Supabase query result must be error-checked before its data is used, with a visible red-banner error state on failure — never a silently fabricated zero-count (this project has been burned by this exact bug class twice: Phase 3b-core's missing admin-read policy, Phase 3b-detail's unchecked query errors).
- Reports render as plain HTML tables — no charting library, matching source spec §43's "avoid complex graphs."
- The Date Range Report is capped at 90 days; a wider request shows an error and runs no query.
- All 5 new pages are gated `requireRole(['admin', 'super_admin'])`.
- Every date input/output uses the `YYYY-MM-DD` string format already used everywhere in this codebase (`todayInTimezone`, `addDays` from `src/lib/time/cutoff.ts`).

---

## File Structure

- `src/lib/reports/date-range-summary.ts` — `computeDateRangeSummary(dailySummaries: DailySummary[]): DateRangeSummary`
- `src/lib/reports/concern-summary.ts` — `computeConcernSummary(concerns: ConcernRow[]): ConcernSummary`
- `src/app/(app)/admin/reports/page.tsx` — landing page linking to the 4 reports
- `src/app/(app)/admin/reports/daily/page.tsx` — Daily Thali Report
- `src/app/(app)/admin/reports/range/page.tsx` — Date Range Report
- `src/app/(app)/admin/reports/user-history/page.tsx` — User History Report
- `src/app/(app)/admin/reports/concerns/page.tsx` — Concern Report
- `src/app/(app)/admin/page.tsx` — modify: add a "Reports" nav link

---

### Task 1: `lib/reports/date-range-summary.ts` — range aggregation

**Files:**
- Create: `src/lib/reports/date-range-summary.ts`
- Test: `src/lib/reports/date-range-summary.test.ts`

**Interfaces:**
- Consumes: `DailySummary` (existing, `src/lib/reports/daily-summary.ts`)
- Produces: `DateRangeSummary`, `computeDateRangeSummary(dailySummaries: DailySummary[]): DateRangeSummary` — Task 4's `/admin/reports/range` page calls this by name.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/date-range-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeDateRangeSummary } from './date-range-summary';
import type { DailySummary } from './daily-summary';

function makeDay(overrides: Partial<DailySummary>): DailySummary {
  return {
    totalUsers: 10,
    thaliCount: 0,
    noThaliCount: 0,
    noResponseCount: 0,
    onLeaveCount: 0,
    gravyBreakdown: [],
    riceBreakdown: [],
    rotiBreakdown: [],
    totalRotis: 0,
    ...overrides,
  };
}

describe('computeDateRangeSummary', () => {
  it('returns all-zero totals and a zero average for an empty array', () => {
    const summary = computeDateRangeSummary([]);
    expect(summary.totalDays).toBe(0);
    expect(summary.totalThalis).toBe(0);
    expect(summary.averageDailyThalis).toBe(0);
    expect(summary.gravyBreakdown).toEqual([]);
  });

  it('a single day\'s average equals that day\'s thali count', () => {
    const summary = computeDateRangeSummary([makeDay({ thaliCount: 7 })]);
    expect(summary.totalDays).toBe(1);
    expect(summary.totalThalis).toBe(7);
    expect(summary.averageDailyThalis).toBe(7);
  });

  it('sums counts across multiple days and averages correctly', () => {
    const summary = computeDateRangeSummary([
      makeDay({ thaliCount: 4, noThaliCount: 1, noResponseCount: 2, onLeaveCount: 1, totalRotis: 8 }),
      makeDay({ thaliCount: 6, noThaliCount: 0, noResponseCount: 1, onLeaveCount: 2, totalRotis: 12 }),
    ]);
    expect(summary.totalDays).toBe(2);
    expect(summary.totalThalis).toBe(10);
    expect(summary.averageDailyThalis).toBe(5);
    expect(summary.totalNoThali).toBe(1);
    expect(summary.totalNoResponse).toBe(3);
    expect(summary.totalOnLeave).toBe(3);
    expect(summary.totalRotis).toBe(20);
  });

  it('sums portion breakdowns by label/quantity across days', () => {
    const summary = computeDateRangeSummary([
      makeDay({
        gravyBreakdown: [{ label: 'Small', count: 2 }, { label: 'Regular', count: 3 }],
        riceBreakdown: [{ label: 'No Rice', count: 1 }],
        rotiBreakdown: [{ quantity: 2, count: 2 }],
      }),
      makeDay({
        gravyBreakdown: [{ label: 'Small', count: 1 }, { label: 'Regular', count: 0 }],
        riceBreakdown: [{ label: 'No Rice', count: 2 }],
        rotiBreakdown: [{ quantity: 2, count: 1 }, { quantity: 3, count: 1 }],
      }),
    ]);
    expect(summary.gravyBreakdown).toEqual([
      { label: 'Small', count: 3 },
      { label: 'Regular', count: 3 },
    ]);
    expect(summary.riceBreakdown).toEqual([{ label: 'No Rice', count: 3 }]);
    expect(summary.rotiBreakdown).toEqual([
      { quantity: 2, count: 3 },
      { quantity: 3, count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/reports/date-range-summary.test.ts
```

Expected: FAIL — `./date-range-summary` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/reports/date-range-summary.ts`:

```ts
import type { DailySummary } from './daily-summary';

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

/**
 * Sums a set of already-computed per-date DailySummary objects into a range
 * total. Does no date arithmetic, leave lookups, or per-user classification
 * itself — each DailySummary is produced by calling computeDailySummary
 * once per date, so the leave-overrides-a-stale-request precedence stays
 * in the one place it's already implemented and tested.
 */
export function computeDateRangeSummary(dailySummaries: DailySummary[]): DateRangeSummary {
  const totalDays = dailySummaries.length;

  let totalThalis = 0;
  let totalNoThali = 0;
  let totalNoResponse = 0;
  let totalOnLeave = 0;
  let totalRotis = 0;

  const gravyCounts = new Map<string, number>();
  const riceCounts = new Map<string, number>();
  const rotiCounts = new Map<number, number>();
  const gravyOrder: string[] = [];
  const riceOrder: string[] = [];

  for (const day of dailySummaries) {
    totalThalis += day.thaliCount;
    totalNoThali += day.noThaliCount;
    totalNoResponse += day.noResponseCount;
    totalOnLeave += day.onLeaveCount;
    totalRotis += day.totalRotis;

    for (const { label, count } of day.gravyBreakdown) {
      if (!gravyCounts.has(label)) gravyOrder.push(label);
      gravyCounts.set(label, (gravyCounts.get(label) ?? 0) + count);
    }
    for (const { label, count } of day.riceBreakdown) {
      if (!riceCounts.has(label)) riceOrder.push(label);
      riceCounts.set(label, (riceCounts.get(label) ?? 0) + count);
    }
    for (const { quantity, count } of day.rotiBreakdown) {
      rotiCounts.set(quantity, (rotiCounts.get(quantity) ?? 0) + count);
    }
  }

  const gravyBreakdown = gravyOrder.map((label) => ({ label, count: gravyCounts.get(label) ?? 0 }));
  const riceBreakdown = riceOrder.map((label) => ({ label, count: riceCounts.get(label) ?? 0 }));
  const rotiBreakdown = Array.from(rotiCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([quantity, count]) => ({ quantity, count }));

  return {
    totalDays,
    totalThalis,
    averageDailyThalis: totalDays > 0 ? totalThalis / totalDays : 0,
    totalNoThali,
    totalNoResponse,
    totalOnLeave,
    gravyBreakdown,
    riceBreakdown,
    rotiBreakdown,
    totalRotis,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/reports/date-range-summary.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/date-range-summary.ts src/lib/reports/date-range-summary.test.ts
git commit -m "feat: add computeDateRangeSummary for the date range report"
```

---

### Task 2: `lib/reports/concern-summary.ts` — concern aggregation

**Files:**
- Create: `src/lib/reports/concern-summary.ts`
- Test: `src/lib/reports/concern-summary.test.ts`

**Interfaces:**
- Consumes: `CONCERN_CATEGORIES`, `CONCERN_STATUSES` (existing, `src/lib/concerns/constants.ts`)
- Produces: `ConcernRow`, `ConcernSummary`, `computeConcernSummary(concerns: ConcernRow[]): ConcernSummary` — Task 6's `/admin/reports/concerns` page calls this by name.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/concern-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeConcernSummary } from './concern-summary';

describe('computeConcernSummary', () => {
  it('returns zero totals and every category/status at 0 for an empty array', () => {
    const summary = computeConcernSummary([]);
    expect(summary.totalConcerns).toBe(0);
    expect(summary.byCategory.every((c) => c.count === 0)).toBe(true);
    expect(summary.byStatus.every((s) => s.count === 0)).toBe(true);
    expect(summary.byCategory).toHaveLength(7);
    expect(summary.byStatus).toHaveLength(4);
  });

  it('counts by category and by status, including zero-count entries', () => {
    const summary = computeConcernSummary([
      { category: 'taste', status: 'open' },
      { category: 'taste', status: 'resolved' },
      { category: 'quantity', status: 'open' },
    ]);
    expect(summary.totalConcerns).toBe(3);

    const taste = summary.byCategory.find((c) => c.category === 'Taste');
    expect(taste?.count).toBe(2);
    const quantity = summary.byCategory.find((c) => c.category === 'Quantity');
    expect(quantity?.count).toBe(1);
    const packaging = summary.byCategory.find((c) => c.category === 'Packaging');
    expect(packaging?.count).toBe(0);

    const open = summary.byStatus.find((s) => s.status === 'Open');
    expect(open?.count).toBe(2);
    const resolved = summary.byStatus.find((s) => s.status === 'Resolved');
    expect(resolved?.count).toBe(1);
    const closed = summary.byStatus.find((s) => s.status === 'Closed');
    expect(closed?.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/reports/concern-summary.test.ts
```

Expected: FAIL — `./concern-summary` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/reports/concern-summary.ts`:

```ts
import { CONCERN_CATEGORIES, CONCERN_STATUSES } from '@/lib/concerns/constants';

export type ConcernRow = { category: string; status: string };

export type ConcernSummary = {
  totalConcerns: number;
  byCategory: { category: string; count: number }[];
  byStatus: { status: string; count: number }[];
};

export function computeConcernSummary(concerns: ConcernRow[]): ConcernSummary {
  const categoryCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();

  for (const c of concerns) {
    categoryCounts.set(c.category, (categoryCounts.get(c.category) ?? 0) + 1);
    statusCounts.set(c.status, (statusCounts.get(c.status) ?? 0) + 1);
  }

  const byCategory = CONCERN_CATEGORIES.map((cat) => ({
    category: cat.label,
    count: categoryCounts.get(cat.value) ?? 0,
  }));
  const byStatus = CONCERN_STATUSES.map((st) => ({
    status: st.label,
    count: statusCounts.get(st.value) ?? 0,
  }));

  return {
    totalConcerns: concerns.length,
    byCategory,
    byStatus,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/reports/concern-summary.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/concern-summary.ts src/lib/reports/concern-summary.test.ts
git commit -m "feat: add computeConcernSummary for the concern report"
```

---

### Task 3: Reports landing page + Daily Thali Report

**Files:**
- Create: `src/app/(app)/admin/reports/page.tsx`
- Create: `src/app/(app)/admin/reports/daily/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `getSettings`/`SETTINGS_KEYS`, `todayInTimezone`/`addDays` (existing), `computeDailySummary`, `ThaliRequestRow` (existing, `src/lib/reports/daily-summary.ts`)

- [ ] **Step 1: Implement the landing page**

Create `src/app/(app)/admin/reports/page.tsx`:

```tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';

export default async function AdminReportsPage() {
  await requireRole(['admin', 'super_admin']);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Reports</h1>
      <div className="mt-6 space-y-3">
        <Link
          href="/admin/reports/daily"
          className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
        >
          Daily Thali Report
        </Link>
        <Link
          href="/admin/reports/range"
          className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
        >
          Date Range Report
        </Link>
        <Link
          href="/admin/reports/user-history"
          className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
        >
          User History Report
        </Link>
        <Link
          href="/admin/reports/concerns"
          className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
        >
          Concern Report
        </Link>
      </div>
      <div className="mt-6">
        <Link href="/admin" className="text-lg text-blue-600 underline">
          ← Back to Dashboard
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Implement the Daily Thali Report**

Create `src/app/(app)/admin/reports/daily/page.tsx`:

```tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone, addDays } from '@/lib/time/cutoff';
import { computeDailySummary, type ThaliRequestRow } from '@/lib/reports/daily-summary';

export default async function DailyThaliReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { date: dateParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const errorState = (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Daily Thali Report</h1>
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load this report. Please try again.
      </p>
    </main>
  );

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const tomorrow = addDays(today, 1);
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : tomorrow;

  const { data: activeUsers, error: activeUsersError } = await supabase
    .from('profiles')
    .select('id')
    .eq('active', true);
  if (activeUsersError) return errorState;
  const activeUserIds = (activeUsers ?? []).map((u) => u.id);

  const { data: requestRows, error: requestRowsError } = activeUserIds.length
    ? await supabase
        .from('thali_requests')
        .select('user_id, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
        .eq('service_date', date)
        .in('user_id', activeUserIds)
    : {
        data: [] as {
          user_id: string;
          wants_thali: boolean;
          gravy_portion_id: string | null;
          rice_portion_id: string | null;
          roti_quantity: number | null;
        }[],
        error: null,
      };
  if (requestRowsError) return errorState;

  const requests: ThaliRequestRow[] = (requestRows ?? []).map((r) => ({
    userId: r.user_id,
    wantsThali: r.wants_thali,
    gravyPortionId: r.gravy_portion_id,
    ricePortionId: r.rice_portion_id,
    rotiQuantity: r.roti_quantity,
  }));

  const { data: leaveRows, error: leaveRowsError } = activeUserIds.length
    ? await supabase
        .from('user_leaves')
        .select('user_id')
        .lte('from_date', date)
        .gte('to_date', date)
        .in('user_id', activeUserIds)
    : { data: [] as { user_id: string }[], error: null };
  if (leaveRowsError) return errorState;
  const onLeaveUserIds = (leaveRows ?? []).map((l) => l.user_id);

  const { data: gravyOptions, error: gravyOptionsError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'gravy')
    .eq('active', true)
    .order('sort_order');
  if (gravyOptionsError) return errorState;
  const { data: riceOptions, error: riceOptionsError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'rice')
    .eq('active', true)
    .order('sort_order');
  if (riceOptionsError) return errorState;

  const summary = computeDailySummary(activeUserIds, requests, onLeaveUserIds, gravyOptions ?? [], riceOptions ?? []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/reports" className="text-lg text-blue-600 underline">
        ← Back to Reports
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Daily Thali Report</h1>

      <form method="get" className="mt-6 flex items-end gap-3 rounded-xl border border-gray-200 p-4">
        <div>
          <label className="text-sm font-semibold" htmlFor="date">
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={date}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
          View
        </button>
      </form>

      <table className="mt-6 w-full text-left">
        <tbody className="text-lg">
          <tr className="border-b border-gray-100">
            <td className="py-2 font-semibold">Date</td>
            <td className="py-2">{date}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <td className="py-2 font-semibold">Total Active Users</td>
            <td className="py-2">{summary.totalUsers}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <td className="py-2 font-semibold">Thali Requested</td>
            <td className="py-2">{summary.thaliCount}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <td className="py-2 font-semibold">No Thali</td>
            <td className="py-2">{summary.noThaliCount}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <td className="py-2 font-semibold">No Response</td>
            <td className="py-2">{summary.noResponseCount}</td>
          </tr>
          <tr>
            <td className="py-2 font-semibold">Leave</td>
            <td className="py-2">{summary.onLeaveCount}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-6 text-xl font-bold">Gravy</h2>
      <table className="mt-2 w-full text-left">
        <tbody className="text-lg">
          {summary.gravyBreakdown.map((b) => (
            <tr key={b.label} className="border-b border-gray-100">
              <td className="py-2">{b.label}</td>
              <td className="py-2">{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-6 text-xl font-bold">Rice</h2>
      <table className="mt-2 w-full text-left">
        <tbody className="text-lg">
          {summary.riceBreakdown.map((b) => (
            <tr key={b.label} className="border-b border-gray-100">
              <td className="py-2">{b.label}</td>
              <td className="py-2">{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-6 text-xl font-bold">Roti</h2>
      <table className="mt-2 w-full text-left">
        <tbody className="text-lg">
          {summary.rotiBreakdown.map((b) => (
            <tr key={b.quantity} className="border-b border-gray-100">
              <td className="py-2">{b.quantity}</td>
              <td className="py-2">{b.count}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 font-semibold">Total Roti</td>
            <td className="py-2 font-semibold">{summary.totalRotis}</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

- [ ] **Step 4: Manual verification (requires a running dev server and a seeded database)**

Sign in as an admin, visit `/admin/reports`, confirm all 4 links render. Click "Daily Thali Report", confirm it defaults to tomorrow and the numbers roughly match what `/admin` shows for tomorrow. Change the date to a past date with seeded `thali_requests` and confirm the report reflects that date's real data.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/reports/page.tsx" "src/app/(app)/admin/reports/daily/page.tsx"
git commit -m "feat: add reports landing page and Daily Thali Report at /admin/reports/daily"
```

---

### Task 4: Date Range Report

**Files:**
- Create: `src/app/(app)/admin/reports/range/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `getSettings`/`SETTINGS_KEYS`, `todayInTimezone`/`addDays` (existing), `computeDailySummary`, `ThaliRequestRow` (existing), `computeDateRangeSummary` (Task 1)

- [ ] **Step 1: Implement the page**

Create `src/app/(app)/admin/reports/range/page.tsx`:

```tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone, addDays } from '@/lib/time/cutoff';
import { computeDailySummary, type ThaliRequestRow } from '@/lib/reports/daily-summary';
import { computeDateRangeSummary } from '@/lib/reports/date-range-summary';

const MAX_RANGE_DAYS = 90;

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export default async function DateRangeReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { from: fromParam, to: toParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const defaultFrom = addDays(today, -6);

  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : defaultFrom;
  const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : today;

  const form = (
    <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
      <div>
        <label className="text-sm font-semibold" htmlFor="from">
          From
        </label>
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={from}
          className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
        />
      </div>
      <div>
        <label className="text-sm font-semibold" htmlFor="to">
          To
        </label>
        <input
          id="to"
          name="to"
          type="date"
          defaultValue={to}
          className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
        />
      </div>
      <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
        View
      </button>
    </form>
  );

  const header = (
    <>
      <Link href="/admin/reports" className="text-lg text-blue-600 underline">
        ← Back to Reports
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Date Range Report</h1>
      {form}
    </>
  );

  if (from > to) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        {header}
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          The start date must be on or before the end date.
        </p>
      </main>
    );
  }

  const dates = datesBetween(from, to);
  if (dates.length > MAX_RANGE_DAYS) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        {header}
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Please choose a range of {MAX_RANGE_DAYS} days or fewer.
        </p>
      </main>
    );
  }

  const errorState = (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {header}
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load this report. Please try again.
      </p>
    </main>
  );

  const { data: activeUsers, error: activeUsersError } = await supabase
    .from('profiles')
    .select('id')
    .eq('active', true);
  if (activeUsersError) return errorState;
  const activeUserIds = (activeUsers ?? []).map((u) => u.id);

  const { data: requestRows, error: requestRowsError } = activeUserIds.length
    ? await supabase
        .from('thali_requests')
        .select('user_id, service_date, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
        .gte('service_date', from)
        .lte('service_date', to)
        .in('user_id', activeUserIds)
    : {
        data: [] as {
          user_id: string;
          service_date: string;
          wants_thali: boolean;
          gravy_portion_id: string | null;
          rice_portion_id: string | null;
          roti_quantity: number | null;
        }[],
        error: null,
      };
  if (requestRowsError) return errorState;

  const { data: leaveRows, error: leaveRowsError } = activeUserIds.length
    ? await supabase
        .from('user_leaves')
        .select('user_id, from_date, to_date')
        .lte('from_date', to)
        .gte('to_date', from)
        .in('user_id', activeUserIds)
    : { data: [] as { user_id: string; from_date: string; to_date: string }[], error: null };
  if (leaveRowsError) return errorState;

  const { data: gravyOptions, error: gravyOptionsError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'gravy')
    .eq('active', true)
    .order('sort_order');
  if (gravyOptionsError) return errorState;
  const { data: riceOptions, error: riceOptionsError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'rice')
    .eq('active', true)
    .order('sort_order');
  if (riceOptionsError) return errorState;

  const requestsByDate = new Map<string, ThaliRequestRow[]>();
  for (const r of requestRows ?? []) {
    const row: ThaliRequestRow = {
      userId: r.user_id,
      wantsThali: r.wants_thali,
      gravyPortionId: r.gravy_portion_id,
      ricePortionId: r.rice_portion_id,
      rotiQuantity: r.roti_quantity,
    };
    const list = requestsByDate.get(r.service_date) ?? [];
    list.push(row);
    requestsByDate.set(r.service_date, list);
  }

  const dailySummaries = dates.map((date) => {
    const onLeaveUserIds = (leaveRows ?? [])
      .filter((l) => l.from_date <= date && date <= l.to_date)
      .map((l) => l.user_id);
    return computeDailySummary(
      activeUserIds,
      requestsByDate.get(date) ?? [],
      onLeaveUserIds,
      gravyOptions ?? [],
      riceOptions ?? []
    );
  });

  const summary = computeDateRangeSummary(dailySummaries);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {header}

      {activeUserIds.length === 0 ? (
        <p className="mt-6 text-lg text-gray-600">No data found for this period.</p>
      ) : (
        <>
          <table className="mt-6 w-full text-left">
            <tbody className="text-lg">
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Total Days</td>
                <td className="py-2">{summary.totalDays}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Total Thalis</td>
                <td className="py-2">{summary.totalThalis}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Average Daily Thalis</td>
                <td className="py-2">{summary.averageDailyThalis.toFixed(1)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">No Thali</td>
                <td className="py-2">{summary.totalNoThali}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">No Response</td>
                <td className="py-2">{summary.totalNoResponse}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Leave</td>
                <td className="py-2">{summary.totalOnLeave}</td>
              </tr>
              <tr>
                <td className="py-2 font-semibold">Total Roti</td>
                <td className="py-2">{summary.totalRotis}</td>
              </tr>
            </tbody>
          </table>

          <h2 className="mt-6 text-xl font-bold">Gravy Distribution</h2>
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.gravyBreakdown.map((b) => (
                <tr key={b.label} className="border-b border-gray-100">
                  <td className="py-2">{b.label}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="mt-6 text-xl font-bold">Rice Distribution</h2>
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.riceBreakdown.map((b) => (
                <tr key={b.label} className="border-b border-gray-100">
                  <td className="py-2">{b.label}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="mt-6 text-xl font-bold">Roti Distribution</h2>
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.rotiBreakdown.map((b) => (
                <tr key={b.quantity} className="border-b border-gray-100">
                  <td className="py-2">{b.quantity}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

- [ ] **Step 3: Manual verification (requires a running dev server and a seeded database)**

Sign in as an admin, visit `/admin/reports/range`, confirm it defaults to the last 7 days. Submit a range covering seeded `thali_requests` data and confirm the totals look plausible against what `/admin/reports/daily` shows for the individual dates in that range. Submit a range wider than 90 days and confirm the "90 days or fewer" message appears with no crash. Submit a `from` after `to` and confirm the "start date must be on or before" message appears.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/reports/range/page.tsx"
git commit -m "feat: add Date Range Report at /admin/reports/range"
```

---

### Task 5: User History Report

**Files:**
- Create: `src/app/(app)/admin/reports/user-history/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `getSettings`/`SETTINGS_KEYS`, `todayInTimezone` (existing), `classifyRequestStatus`, `RequestStatus` (existing, `src/lib/reports/request-status.ts`)

- [ ] **Step 1: Implement the page**

Create `src/app/(app)/admin/reports/user-history/page.tsx`:

```tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone } from '@/lib/time/cutoff';
import { classifyRequestStatus, type RequestStatus } from '@/lib/reports/request-status';

const STATUS_LABEL: Record<RequestStatus, string> = {
  thali: '✓ Thali',
  no_thali: '✕ No Thali',
  no_response: '? No Response',
  on_leave: '⏸ On Leave',
};

export default async function UserHistoryReportPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; userId?: string; from?: string; to?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { q, userId, from: fromParam, to: toParam } = await searchParams;
  const query = (q ?? '').trim();
  const supabase = await createServerSupabaseClient();

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : today;
  const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : today;

  let searchResults: { id: string; full_name: string; user_code: string }[] = [];
  let searchError = false;
  if (query) {
    const sanitized = query.replace(/[,()]/g, '');
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, user_code')
      .eq('active', true)
      .or(
        `full_name.ilike.%${sanitized}%,user_code.ilike.%${sanitized}%,mobile.ilike.%${sanitized}%,email.ilike.%${sanitized}%`
      )
      .order('full_name')
      .limit(25);
    if (error) searchError = true;
    else searchResults = data ?? [];
  }

  let selectedUser: { id: string; full_name: string; user_code: string } | null = null;
  let historyRows: { service_date: string; wants_thali: boolean }[] = [];
  let historyError = false;
  let isOnLeave: (date: string) => boolean = () => false;

  if (userId) {
    const { data: userRow, error: userError } = await supabase
      .from('profiles')
      .select('id, full_name, user_code')
      .eq('id', userId)
      .maybeSingle();

    if (userError) {
      historyError = true;
    } else if (userRow) {
      selectedUser = userRow;

      const { data: leaveRows, error: leaveError } = await supabase
        .from('user_leaves')
        .select('from_date, to_date')
        .eq('user_id', userId)
        .lte('from_date', to)
        .gte('to_date', from);

      if (leaveError) {
        historyError = true;
      } else {
        isOnLeave = (date: string) => (leaveRows ?? []).some((l) => l.from_date <= date && date <= l.to_date);

        const { data: requestRows, error: requestError } = await supabase
          .from('thali_requests')
          .select('service_date, wants_thali')
          .eq('user_id', userId)
          .gte('service_date', from)
          .lte('service_date', to)
          .order('service_date', { ascending: false });

        if (requestError) {
          historyError = true;
        } else {
          historyRows = requestRows ?? [];
        }
      }
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/reports" className="text-lg text-blue-600 underline">
        ← Back to Reports
      </Link>
      <h1 className="mt-4 text-3xl font-bold">User History Report</h1>

      <form method="get" className="mt-6 flex gap-3">
        <input
          name="q"
          type="text"
          defaultValue={query}
          placeholder="Name, member ID, mobile, or email"
          className="h-12 flex-1 rounded-lg border border-gray-300 px-3 text-lg"
        />
        <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
          Search
        </button>
      </form>

      {searchError && (
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not run this search. Please try again.
        </p>
      )}
      {!searchError && query && searchResults.length === 0 && (
        <p className="mt-6 text-lg text-gray-600">No results found for this user search.</p>
      )}

      {!selectedUser && searchResults.length > 0 && (
        <div className="mt-6 space-y-3">
          {searchResults.map((user) => (
            <Link
              key={user.id}
              href={`/admin/reports/user-history?userId=${user.id}`}
              className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
            >
              <span className="font-semibold">{user.full_name}</span>{' '}
              <span className="text-gray-500">({user.user_code})</span>
            </Link>
          ))}
        </div>
      )}

      {historyError && (
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not load this user&apos;s history. Please try again.
        </p>
      )}

      {selectedUser && !historyError && (
        <>
          <h2 className="mt-8 text-xl font-bold">
            {selectedUser.full_name} <span className="text-gray-500">({selectedUser.user_code})</span>
          </h2>

          <form method="get" className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
            <input type="hidden" name="userId" value={selectedUser.id} />
            <div>
              <label className="text-sm font-semibold" htmlFor="from">
                From
              </label>
              <input
                id="from"
                name="from"
                type="date"
                defaultValue={from}
                className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
              />
            </div>
            <div>
              <label className="text-sm font-semibold" htmlFor="to">
                To
              </label>
              <input
                id="to"
                name="to"
                type="date"
                defaultValue={to}
                className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
              />
            </div>
            <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
              View
            </button>
          </form>

          {historyRows.length === 0 ? (
            <p className="mt-6 text-lg text-gray-600">No data found for this period.</p>
          ) : (
            <div className="mt-6 space-y-2">
              {historyRows.map((r) => {
                const status = classifyRequestStatus(isOnLeave(r.service_date), { wantsThali: r.wants_thali });
                return (
                  <div key={r.service_date} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
                    <span className="font-semibold">{r.service_date}</span> — {STATUS_LABEL[status]}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

- [ ] **Step 3: Manual verification (requires a running dev server and a seeded database)**

Sign in as an admin, visit `/admin/reports/user-history`, search for a seeded user by partial name, click into a result, confirm the default range (today only) shows either their status or "No data found for this period." Widen the range to cover several days of seeded `thali_requests` and confirm each date's status renders correctly, including a date where that user has a seeded leave row overlapping a stale request row (leave should win — same precedence proven in earlier phases).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/reports/user-history/page.tsx"
git commit -m "feat: add User History Report at /admin/reports/user-history"
```

---

### Task 6: Concern Report

**Files:**
- Create: `src/app/(app)/admin/reports/concerns/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `computeConcernSummary` (Task 2)

- [ ] **Step 1: Implement the page**

Create `src/app/(app)/admin/reports/concerns/page.tsx`:

```tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { computeConcernSummary } from '@/lib/reports/concern-summary';

export default async function ConcernReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { from: fromParam, to: toParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : null;
  const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : null;

  const errorState = (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/reports" className="text-lg text-blue-600 underline">
        ← Back to Reports
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Concern Report</h1>
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load this report. Please try again.
      </p>
    </main>
  );

  let concernQuery = supabase.from('concerns').select('category, status');
  if (from) concernQuery = concernQuery.gte('concern_date', from);
  if (to) concernQuery = concernQuery.lte('concern_date', to);

  const { data: concernRows, error } = await concernQuery;
  if (error) return errorState;

  const summary = computeConcernSummary(concernRows ?? []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/reports" className="text-lg text-blue-600 underline">
        ← Back to Reports
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Concern Report</h1>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
        <div>
          <label className="text-sm font-semibold" htmlFor="from">
            From (optional)
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from ?? ''}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor="to">
            To (optional)
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to ?? ''}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
          View
        </button>
      </form>

      {summary.totalConcerns === 0 ? (
        <p className="mt-6 text-lg text-gray-600">No data found for this period.</p>
      ) : (
        <>
          <p className="mt-6 text-lg">
            Total Concerns: <span className="font-semibold">{summary.totalConcerns}</span>
          </p>

          <h2 className="mt-6 text-xl font-bold">By Category</h2>
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.byCategory.map((b) => (
                <tr key={b.category} className="border-b border-gray-100">
                  <td className="py-2">{b.category}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="mt-6 text-xl font-bold">By Status</h2>
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.byStatus.map((b) => (
                <tr key={b.status} className="border-b border-gray-100">
                  <td className="py-2">{b.status}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

- [ ] **Step 3: Manual verification (requires a running dev server and a seeded database)**

Sign in as an admin, visit `/admin/reports/concerns`, confirm it shows all seeded concerns grouped by category and status with no date filter. Apply a date range that excludes all seeded concerns and confirm "No data found for this period." appears.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/reports/concerns/page.tsx"
git commit -m "feat: add Concern Report at /admin/reports/concerns"
```

---

### Task 7: Nav link from `/admin`

**Files:**
- Modify: `src/app/(app)/admin/page.tsx`

**Interfaces:**
- Consumes: none new — this task only adds a `<Link>` to an existing page.

- [ ] **Step 1: Add the nav link**

In `src/app/(app)/admin/page.tsx`, there are two `<div className="mt-6 flex flex-wrap gap-3">` blocks (one inside the service-holiday early-return branch, one in the normal render). Add this link to both, immediately after the existing "Concerns" link:

```tsx
<Link href="/admin/reports" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
  Reports
</Link>
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

- [ ] **Step 3: Run the full test suite**

```bash
npm run lint
npx vitest run
npm run build
```

Expected: all green, including every test from Tasks 1-2 of this plan plus every pre-existing test from earlier phases.

- [ ] **Step 4: Manual verification (requires a running dev server)**

Sign in as an admin, land on `/admin`, confirm the "Reports" link is visible and navigates to `/admin/reports`. Confirm the same link also appears on the "No Thali Service Tomorrow" holiday state.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/page.tsx"
git commit -m "feat: add nav link to reports from /admin"
```

---

## Self-Review Notes

- **Spec coverage:** Daily Thali Report (all named fields) → Task 3. Date Range Report (from/to, 90-day cap, totals/average/portion distribution) → Task 4. User History Report (search + selected period) → Task 5. Concern Report (category/status breakdown) → Task 6. "Design for exportability" → satisfied structurally by every report rendering plain row-shaped tables, no task builds actual export. Nav discoverability → Task 7.
- **Type consistency:** `DateRangeSummary` (Task 1) and `ConcernSummary`/`ConcernRow` (Task 2) are imported by name, unchanged, by Tasks 4 and 6 respectively — no page redefines its own copy. `ThaliRequestRow`/`computeDailySummary` (existing) are used identically in Tasks 3 and 4, matching the exact shape `/admin/page.tsx` already established.
- **No placeholders:** every step has runnable code; no task defers behavior to a later "handle edge cases" step.
