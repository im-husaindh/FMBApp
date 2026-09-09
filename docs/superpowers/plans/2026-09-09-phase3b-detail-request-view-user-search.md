# FMBRequestThali — Phase 3b-detail: Admin Detailed Request View + User Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a filterable/searchable table of any date's thali requests (`/admin/requests`) and a way to look up one user by name/code/mobile/email and see their status and history (`/admin/users/search` + `/admin/users/[id]`), reusing the leave-overrides-a-stale-request classification logic Phase 3b-core already built.

**Architecture:** Extract the per-user status classification already inline in `computeDailySummary` into a shared pure function (`classifyRequestStatus`), refactor `computeDailySummary` to call it (behavior-preserving), then build one more pure function (`buildRequestListRows` + `filterRequestListRows`) that reuses the classifier to turn raw rows into a filterable per-user list. Both new pages are plain async Server Components: fetch with the two-query-no-embed pattern already established, filter/search in application code, render a table on desktop and stacked cards on mobile via one Tailwind breakpoint swap. Entirely read-only — no migrations, no RLS changes.

**Tech Stack:** Next.js Server Components (no Server Actions needed — GET forms only), Supabase (Postgres + RLS, read-only), Tailwind CSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-phase3b-detail-design.md` (and source `FMBRequestThali Web App — Complete Development Prompt.md` §18-19, §48, §53)

## Global Constraints

- Strict TypeScript, no `any`.
- **No migrations in this phase.** Every table this phase reads (`profiles`, `thali_requests`, `user_leaves`, `service_holidays`, `portion_options`) and every RLS policy covering admin reads of them already exists and was integration-tested in Phase 3b-core. Do not add, alter, or even re-run migration files.
- Never embed two tables across a multi-FK relationship in one `.select()` — `user_leaves` has TWO foreign keys to `profiles` (`user_id`, `entered_by`). Query separately and join in application code, exactly as Phase 3a/3b-core already do.
- The active-user population for any admin-facing count or list is **all three roles** (`profiles.active = true`, no `role` filter) — Phase 3b-core's final review found and fixed a bug where filtering to `role = 'user'` silently miscounted admins/super-admins who submit their own thali requests. Do not reintroduce that filter.
- Every admin/super-admin page uses the established `requireRole([...])` + `searchParams: Promise<{ ... }>` + red error banner convention (see `src/app/(app)/admin/leave/page.tsx`, `src/app/(app)/admin/page.tsx`).
- Search and filtering happen entirely in application code after one full fetch — this app's data is community-scale, and translating every filter/search combination into SQL is unnecessary complexity for that scale.
- Search is a plain GET `<form>` — no client-side JS, no debouncing, no Server Action. Submitting reloads the page with query params in the URL.
- Status must always be shown as icon/glyph + text + color together — never color alone (accessibility; matches every prior status display in this codebase).
- Large touch targets (`h-12`/`h-14`) on any input/button, matching every existing form in this codebase.
- Never select `auth.users` or any password/session-related column anywhere in this phase — only `profiles` columns for user identity (`id, full_name, user_code, mobile, email, role, active`).

---

## File Structure

- `src/lib/reports/request-status.ts` — new: `RequestStatus` type, `classifyRequestStatus(isOnLeave, request)` pure function
- `src/lib/reports/daily-summary.ts` — modify: refactor `computeDailySummary`'s loop to call `classifyRequestStatus` instead of its inline branching (no behavior change)
- `src/lib/reports/request-list.ts` — new: `ProfileRow`, `RequestListRow`, `RequestListFilter` types, `buildRequestListRows(...)`, `filterRequestListRows(...)` pure functions
- `src/app/(app)/admin/requests/page.tsx` — new: filterable/searchable table + mobile cards for one date's requests
- `src/app/(app)/admin/users/search/page.tsx` — new: plain-form user search
- `src/app/(app)/admin/users/[id]/page.tsx` — new: one user's status + 14-day history
- `src/app/(app)/admin/page.tsx` — modify: add nav links to the two new pages

---

### Task 1: `lib/reports/request-status.ts` — shared status classifier

**Files:**
- Create: `src/lib/reports/request-status.ts`
- Test: `src/lib/reports/request-status.test.ts`

**Interfaces:**
- Produces: `RequestStatus` (`'thali' | 'no_thali' | 'no_response' | 'on_leave'`), `classifyRequestStatus(isOnLeave: boolean, request: { wantsThali: boolean } | undefined): RequestStatus` — Task 2's `computeDailySummary` refactor, Task 3's `buildRequestListRows`, and Tasks 4 and 6's pages all call this by name.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/request-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyRequestStatus } from './request-status';

describe('classifyRequestStatus', () => {
  it('returns on_leave when the user is on leave, regardless of any request row', () => {
    expect(classifyRequestStatus(true, undefined)).toBe('on_leave');
    expect(classifyRequestStatus(true, { wantsThali: true })).toBe('on_leave');
  });

  it('returns no_response when not on leave and there is no request row', () => {
    expect(classifyRequestStatus(false, undefined)).toBe('no_response');
  });

  it('returns no_thali when not on leave and the request says wantsThali=false', () => {
    expect(classifyRequestStatus(false, { wantsThali: false })).toBe('no_thali');
  });

  it('returns thali when not on leave and the request says wantsThali=true', () => {
    expect(classifyRequestStatus(false, { wantsThali: true })).toBe('thali');
  });

  it('leave overrides even a stale thali request row (the precedence that matters most)', () => {
    expect(classifyRequestStatus(true, { wantsThali: true })).toBe('on_leave');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/reports/request-status.test.ts
```

Expected: FAIL — `./request-status` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/reports/request-status.ts`:

```ts
export type RequestStatus = 'thali' | 'no_thali' | 'no_response' | 'on_leave';

/**
 * The one place this app decides what a user's status is for a date. A leave
 * day overrides even a stale thali_requests row — checked first — because
 * leave/holiday enforcement (Phase 3b-core) only blocks NEW writes; a leave
 * added after a user already submitted a request does not retroactively
 * delete that row.
 */
export function classifyRequestStatus(
  isOnLeave: boolean,
  request: { wantsThali: boolean } | undefined
): RequestStatus {
  if (isOnLeave) return 'on_leave';
  if (!request) return 'no_response';
  return request.wantsThali ? 'thali' : 'no_thali';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/reports/request-status.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/request-status.ts src/lib/reports/request-status.test.ts
git commit -m "feat: add shared classifyRequestStatus function"
```

---

### Task 2: Refactor `computeDailySummary` to use the shared classifier

**Files:**
- Modify: `src/lib/reports/daily-summary.ts`
- Do NOT modify: `src/lib/reports/daily-summary.test.ts` — this file's 5 existing tests are the regression proof that this refactor changes no behavior. If any of them fail after this task, the refactor introduced a real behavior change and must be fixed, not the test.

**Interfaces:**
- Consumes: `classifyRequestStatus` (Task 1)
- Produces: `computeDailySummary` keeps its exact existing signature and return shape — no caller anywhere in the codebase changes.

- [ ] **Step 1: Confirm the current tests pass before touching anything**

```bash
npx vitest run src/lib/reports/daily-summary.test.ts
```

Expected: PASS (5 tests) — this is your baseline.

- [ ] **Step 2: Refactor the implementation**

Replace the body of `computeDailySummary` in `src/lib/reports/daily-summary.ts` (keep the file's existing type exports — `ThaliRequestRow`, `PortionOptionRow`, `DailySummary` — unchanged) with:

```ts
import { classifyRequestStatus } from './request-status';

export type ThaliRequestRow = {
  userId: string;
  wantsThali: boolean;
  gravyPortionId: string | null;
  ricePortionId: string | null;
  rotiQuantity: number | null;
};

export type PortionOptionRow = { id: string; label: string };

export type DailySummary = {
  totalUsers: number;
  thaliCount: number;
  noThaliCount: number;
  noResponseCount: number;
  onLeaveCount: number;
  gravyBreakdown: { label: string; count: number }[];
  riceBreakdown: { label: string; count: number }[];
  rotiBreakdown: { quantity: number; count: number }[];
  totalRotis: number;
};

export function computeDailySummary(
  activeUserIds: string[],
  requests: ThaliRequestRow[],
  onLeaveUserIds: string[],
  gravyOptions: PortionOptionRow[],
  riceOptions: PortionOptionRow[]
): DailySummary {
  const onLeaveSet = new Set(onLeaveUserIds);
  const requestsByUser = new Map(requests.map((r) => [r.userId, r]));

  let thaliCount = 0;
  let noThaliCount = 0;
  let noResponseCount = 0;
  let onLeaveCount = 0;

  const gravyCounts = new Map<string, number>();
  const riceCounts = new Map<string, number>();
  const rotiCounts = new Map<number, number>();
  let totalRotis = 0;

  for (const userId of activeUserIds) {
    const request = requestsByUser.get(userId);
    const status = classifyRequestStatus(onLeaveSet.has(userId), request);

    if (status === 'on_leave') {
      onLeaveCount++;
      continue;
    }
    if (status === 'no_response') {
      noResponseCount++;
      continue;
    }
    if (status === 'no_thali') {
      noThaliCount++;
      continue;
    }

    // status === 'thali' — classifyRequestStatus only returns 'thali' when request is defined.
    if (!request) continue;
    thaliCount++;
    if (request.gravyPortionId) {
      gravyCounts.set(request.gravyPortionId, (gravyCounts.get(request.gravyPortionId) ?? 0) + 1);
    }
    if (request.ricePortionId) {
      riceCounts.set(request.ricePortionId, (riceCounts.get(request.ricePortionId) ?? 0) + 1);
    }
    if (request.rotiQuantity !== null) {
      rotiCounts.set(request.rotiQuantity, (rotiCounts.get(request.rotiQuantity) ?? 0) + 1);
      totalRotis += request.rotiQuantity;
    }
  }

  const gravyBreakdown = gravyOptions.map((opt) => ({ label: opt.label, count: gravyCounts.get(opt.id) ?? 0 }));
  const riceBreakdown = riceOptions.map((opt) => ({ label: opt.label, count: riceCounts.get(opt.id) ?? 0 }));
  const rotiBreakdown = Array.from(rotiCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([quantity, count]) => ({ quantity, count }));

  return {
    totalUsers: activeUserIds.length,
    thaliCount,
    noThaliCount,
    noResponseCount,
    onLeaveCount,
    gravyBreakdown,
    riceBreakdown,
    rotiBreakdown,
    totalRotis,
  };
}
```

The `if (!request) continue;` guard inside the `thali` branch is unreachable in practice (`classifyRequestStatus` never returns `'thali'` without a defined `request`) but is required so TypeScript narrows `request` to non-`undefined` for the portion-counting code below it, without resorting to a non-null assertion (`!`).

- [ ] **Step 3: Run tests to verify no regression**

```bash
npx vitest run src/lib/reports/daily-summary.test.ts
```

Expected: PASS (the same 5 tests, unmodified, still pass). If any fails, the refactor changed behavior — fix the refactor, not the test.

- [ ] **Step 4: Verify the build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/daily-summary.ts
git commit -m "refactor: have computeDailySummary call the shared classifyRequestStatus"
```

---

### Task 3: `lib/reports/request-list.ts` — per-user list building and filtering

**Files:**
- Create: `src/lib/reports/request-list.ts`
- Test: `src/lib/reports/request-list.test.ts`

**Interfaces:**
- Consumes: `classifyRequestStatus`, `RequestStatus` (Task 1); `ThaliRequestRow`, `PortionOptionRow` (existing, `daily-summary.ts`)
- Produces: `ProfileRow`, `RequestListRow`, `RequestListFilter` types; `buildRequestListRows(profiles, requests, onLeaveUserIds, gravyOptions, riceOptions): RequestListRow[]`; `filterRequestListRows(rows, filter, search): RequestListRow[]` — Task 4's `/admin/requests` page calls both by name.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/request-list.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRequestListRows, filterRequestListRows, type ProfileRow } from './request-list';
import type { ThaliRequestRow, PortionOptionRow } from './daily-summary';

const profiles: ProfileRow[] = [
  { id: 'u1', fullName: 'Amina Khan', userCode: 'M001', mobile: '9990001111', email: 'amina@example.com' },
  { id: 'u2', fullName: 'Bilal Sheikh', userCode: 'M002', mobile: '9990002222', email: 'bilal@example.com' },
  { id: 'u3', fullName: 'Chandni Rao', userCode: 'M003', mobile: null, email: null },
  { id: 'u4', fullName: 'Dawood Ali', userCode: 'M004', mobile: '9990004444', email: 'dawood@example.com' },
];

const gravyOptions: PortionOptionRow[] = [{ id: 'g1', label: 'Small' }, { id: 'g2', label: 'Regular' }];
const riceOptions: PortionOptionRow[] = [{ id: 'r1', label: 'No Rice' }, { id: 'r2', label: 'Small' }];

const requests: ThaliRequestRow[] = [
  { userId: 'u1', wantsThali: true, gravyPortionId: 'g1', ricePortionId: 'r1', rotiQuantity: 2 },
  { userId: 'u2', wantsThali: false, gravyPortionId: null, ricePortionId: null, rotiQuantity: null },
  { userId: 'u4', wantsThali: true, gravyPortionId: 'g2', ricePortionId: 'r2', rotiQuantity: 3 },
];

describe('buildRequestListRows', () => {
  it('classifies each profile and attaches profile info and portion labels', () => {
    const rows = buildRequestListRows(profiles, requests, ['u4'], gravyOptions, riceOptions);
    const byId = new Map(rows.map((r) => [r.userId, r]));

    expect(byId.get('u1')).toMatchObject({
      fullName: 'Amina Khan',
      userCode: 'M001',
      status: 'thali',
      gravyPortionId: 'g1',
      gravyLabel: 'Small',
      ricePortionId: 'r1',
      riceLabel: 'No Rice',
      rotiQuantity: 2,
    });
    expect(byId.get('u2')).toMatchObject({ status: 'no_thali', gravyPortionId: null, gravyLabel: null });
    expect(byId.get('u3')).toMatchObject({ status: 'no_response' });
    // u4 has a thali request row but is on leave — leave must win.
    expect(byId.get('u4')).toMatchObject({ status: 'on_leave', gravyPortionId: null, gravyLabel: null });
  });
});

describe('filterRequestListRows', () => {
  const rows = buildRequestListRows(profiles, requests, ['u4'], gravyOptions, riceOptions);

  it('"all" returns every row', () => {
    expect(filterRequestListRows(rows, 'all', '')).toHaveLength(4);
  });

  it('filters by status', () => {
    expect(filterRequestListRows(rows, 'thali', '').map((r) => r.userId)).toEqual(['u1']);
    expect(filterRequestListRows(rows, 'no_thali', '').map((r) => r.userId)).toEqual(['u2']);
    expect(filterRequestListRows(rows, 'no_response', '').map((r) => r.userId)).toEqual(['u3']);
    expect(filterRequestListRows(rows, 'on_leave', '').map((r) => r.userId)).toEqual(['u4']);
  });

  it('filters by exact gravy portion id', () => {
    expect(filterRequestListRows(rows, 'gravy:g1', '').map((r) => r.userId)).toEqual(['u1']);
  });

  it('filters by exact rice portion id', () => {
    expect(filterRequestListRows(rows, 'rice:r2', '').map((r) => r.userId)).toEqual([]);
    // u4's rice portion is r2, but u4 is on_leave so it has no rice portion recorded — confirms leave zeroes out portion fields.
  });

  it('searches case-insensitively across name, user code, mobile, and email', () => {
    expect(filterRequestListRows(rows, 'all', 'amina').map((r) => r.userId)).toEqual(['u1']);
    expect(filterRequestListRows(rows, 'all', 'M002').map((r) => r.userId)).toEqual(['u2']);
    expect(filterRequestListRows(rows, 'all', '9990004444').map((r) => r.userId)).toEqual(['u4']);
    expect(filterRequestListRows(rows, 'all', 'bilal@example').map((r) => r.userId)).toEqual(['u2']);
  });

  it('combines a status filter and a search with AND', () => {
    expect(filterRequestListRows(rows, 'thali', 'bilal')).toHaveLength(0);
    expect(filterRequestListRows(rows, 'thali', 'amina')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/reports/request-list.test.ts
```

Expected: FAIL — `./request-list` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/reports/request-list.ts`:

```ts
import { classifyRequestStatus, type RequestStatus } from './request-status';
import type { ThaliRequestRow, PortionOptionRow } from './daily-summary';

export type ProfileRow = {
  id: string;
  fullName: string;
  userCode: string;
  mobile: string | null;
  email: string | null;
};

export type RequestListRow = {
  userId: string;
  fullName: string;
  userCode: string;
  mobile: string | null;
  email: string | null;
  status: RequestStatus;
  gravyPortionId: string | null;
  gravyLabel: string | null;
  ricePortionId: string | null;
  riceLabel: string | null;
  rotiQuantity: number | null;
};

export type RequestListFilter =
  | 'all'
  | 'thali'
  | 'no_thali'
  | 'no_response'
  | 'on_leave'
  | `gravy:${string}`
  | `rice:${string}`;

export function buildRequestListRows(
  profiles: ProfileRow[],
  requests: ThaliRequestRow[],
  onLeaveUserIds: string[],
  gravyOptions: PortionOptionRow[],
  riceOptions: PortionOptionRow[]
): RequestListRow[] {
  const onLeaveSet = new Set(onLeaveUserIds);
  const requestsByUser = new Map(requests.map((r) => [r.userId, r]));
  const gravyLabelById = new Map(gravyOptions.map((o) => [o.id, o.label]));
  const riceLabelById = new Map(riceOptions.map((o) => [o.id, o.label]));

  return profiles.map((profile) => {
    const request = requestsByUser.get(profile.id);
    const status = classifyRequestStatus(onLeaveSet.has(profile.id), request);
    const hasThali = status === 'thali' && !!request;

    return {
      userId: profile.id,
      fullName: profile.fullName,
      userCode: profile.userCode,
      mobile: profile.mobile,
      email: profile.email,
      status,
      gravyPortionId: hasThali ? request!.gravyPortionId : null,
      gravyLabel: hasThali && request!.gravyPortionId ? gravyLabelById.get(request!.gravyPortionId) ?? null : null,
      ricePortionId: hasThali ? request!.ricePortionId : null,
      riceLabel: hasThali && request!.ricePortionId ? riceLabelById.get(request!.ricePortionId) ?? null : null,
      rotiQuantity: hasThali ? request!.rotiQuantity : null,
    };
  });
}

export function filterRequestListRows(rows: RequestListRow[], filter: RequestListFilter, search: string): RequestListRow[] {
  let result = rows;

  if (filter.startsWith('gravy:')) {
    const id = filter.slice('gravy:'.length);
    result = result.filter((r) => r.gravyPortionId === id);
  } else if (filter.startsWith('rice:')) {
    const id = filter.slice('rice:'.length);
    result = result.filter((r) => r.ricePortionId === id);
  } else if (filter !== 'all') {
    result = result.filter((r) => r.status === filter);
  }

  const term = search.trim().toLowerCase();
  if (term) {
    result = result.filter((r) =>
      [r.fullName, r.userCode, r.mobile, r.email].some((field) => field?.toLowerCase().includes(term))
    );
  }

  return result;
}
```

The `request!` non-null assertions inside `buildRequestListRows` are guarded by the `hasThali` check computed just above them (`status === 'thali' && !!request`), so they can never fire on `undefined` — this is the same narrowing problem as Task 2's `computeDailySummary`, solved the same way but with a boolean flag instead of an early `continue` because this function builds a return value per-profile rather than accumulating counters in a loop it can `continue` out of.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/reports/request-list.test.ts
```

Expected: PASS (8 tests across both `describe` blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/request-list.ts src/lib/reports/request-list.test.ts
git commit -m "feat: add buildRequestListRows/filterRequestListRows for the admin requests view"
```

---

### Task 4: `/admin/requests` — detailed request view

**Files:**
- Create: `src/app/(app)/admin/requests/page.tsx`

**Interfaces:**
- Consumes: `requireRole` (`src/lib/auth`), `createServerSupabaseClient` (`src/lib/supabase/server`), `getSettings`/`SETTINGS_KEYS` (`src/lib/settings`), `todayInTimezone`/`addDays` (`src/lib/time/cutoff`), `buildRequestListRows`/`filterRequestListRows`/`RequestListFilter` (Task 3), `ThaliRequestRow` (`src/lib/reports/daily-summary`)

Note on the two "Thali"-shaped columns the source spec asks for (User/Thali/Gravy/Rice/Roti/Status): **Thali** is a plain Yes/No/— readout of whether the row has a request with `wantsThali=true` (blank for `no_response`/`on_leave`, since there's nothing to read); **Status** is the full classification badge (Thali Confirmed / No Thali / No Response / On Leave) with its own icon and color, used for filtering. They are not redundant — Thali is the raw field, Status is the derived category.

- [ ] **Step 1: Implement the page**

Create `src/app/(app)/admin/requests/page.tsx`:

```tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone, addDays } from '@/lib/time/cutoff';
import type { ThaliRequestRow, PortionOptionRow } from '@/lib/reports/daily-summary';
import {
  buildRequestListRows,
  filterRequestListRows,
  type ProfileRow,
  type RequestListFilter,
  type RequestListRow,
} from '@/lib/reports/request-list';
import type { RequestStatus } from '@/lib/reports/request-status';

const STATUS_BADGE: Record<RequestStatus, { icon: string; label: string; classes: string }> = {
  thali: { icon: '✓', label: 'Thali', classes: 'bg-green-50 text-green-700 border-green-200' },
  no_thali: { icon: '✕', label: 'No Thali', classes: 'bg-gray-50 text-gray-700 border-gray-200' },
  no_response: { icon: '?', label: 'No Response', classes: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  on_leave: { icon: '⏸', label: 'On Leave', classes: 'bg-blue-50 text-blue-700 border-blue-200' },
};

function StatusBadge({ status }: { status: RequestStatus }) {
  const badge = STATUS_BADGE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold ${badge.classes}`}>
      <span aria-hidden="true">{badge.icon}</span>
      {badge.label}
    </span>
  );
}

function thaliCell(row: RequestListRow): string {
  if (row.status === 'thali') return 'Yes';
  if (row.status === 'no_thali') return 'No';
  return '—';
}

export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; filter?: string; search?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { date: dateParam, filter: filterParam, search: searchParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const errorState = (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold">Detailed Requests</h1>
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load requests. Please try again.
      </p>
    </main>
  );

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const tomorrow = addDays(today, 1);
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : tomorrow;
  const filter = (filterParam ?? 'all') as RequestListFilter;
  const search = searchParam ?? '';

  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, user_code, mobile, email')
    .eq('active', true)
    .order('full_name');
  if (profileError) return errorState;

  const profiles: ProfileRow[] = (profileRows ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    userCode: p.user_code,
    mobile: p.mobile,
    email: p.email,
  }));
  const profileIds = profiles.map((p) => p.id);

  const { data: requestRows, error: requestError } = profileIds.length
    ? await supabase
        .from('thali_requests')
        .select('user_id, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
        .eq('service_date', date)
        .in('user_id', profileIds)
    : { data: [] as { user_id: string; wants_thali: boolean; gravy_portion_id: string | null; rice_portion_id: string | null; roti_quantity: number | null }[], error: null };
  if (requestError) return errorState;

  const requests: ThaliRequestRow[] = (requestRows ?? []).map((r) => ({
    userId: r.user_id,
    wantsThali: r.wants_thali,
    gravyPortionId: r.gravy_portion_id,
    ricePortionId: r.rice_portion_id,
    rotiQuantity: r.roti_quantity,
  }));

  const { data: leaveRows, error: leaveError } = profileIds.length
    ? await supabase
        .from('user_leaves')
        .select('user_id')
        .lte('from_date', date)
        .gte('to_date', date)
        .in('user_id', profileIds)
    : { data: [] as { user_id: string }[], error: null };
  if (leaveError) return errorState;
  const onLeaveUserIds = (leaveRows ?? []).map((l) => l.user_id);

  const { data: gravyOptions, error: gravyError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'gravy')
    .eq('active', true)
    .order('sort_order');
  if (gravyError) return errorState;
  const { data: riceOptions, error: riceError } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'rice')
    .eq('active', true)
    .order('sort_order');
  if (riceError) return errorState;

  const allRows = buildRequestListRows(profiles, requests, onLeaveUserIds, gravyOptions ?? [], riceOptions ?? []);
  const rows = filterRequestListRows(allRows, filter, search);

  const filterOptions: { value: RequestListFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'thali', label: 'Thali' },
    { value: 'no_thali', label: 'No Thali' },
    { value: 'no_response', label: 'No Response' },
    { value: 'on_leave', label: 'On Leave' },
    ...(gravyOptions ?? []).map((o) => ({ value: `gravy:${o.id}` as RequestListFilter, label: `Gravy: ${o.label}` })),
    ...(riceOptions ?? []).map((o) => ({ value: `rice:${o.id}` as RequestListFilter, label: `Rice: ${o.label}` })),
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold">Detailed Requests</h1>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
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
        <div>
          <label className="text-sm font-semibold" htmlFor="filter">
            Filter
          </label>
          <select
            id="filter"
            name="filter"
            defaultValue={filter}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            {filterOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-sm font-semibold" htmlFor="search">
            Search
          </label>
          <input
            id="search"
            name="search"
            type="text"
            defaultValue={search}
            placeholder="Name, member ID, mobile, or email"
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
          Apply
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="mt-6 text-lg text-gray-600">No thali requests found.</p>
      ) : (
        <>
          <table className="mt-6 hidden w-full text-left md:table">
            <thead>
              <tr className="border-b border-gray-200 text-sm font-semibold text-gray-600">
                <th className="py-2">User</th>
                <th className="py-2">Thali</th>
                <th className="py-2">Gravy</th>
                <th className="py-2">Rice</th>
                <th className="py-2">Roti</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId} className="border-b border-gray-100 text-lg">
                  <td className="py-3">
                    <span className="font-semibold">{row.fullName}</span>{' '}
                    <span className="text-gray-500">({row.userCode})</span>
                  </td>
                  <td className="py-3">{thaliCell(row)}</td>
                  <td className="py-3">{row.gravyLabel ?? '—'}</td>
                  <td className="py-3">{row.riceLabel ?? '—'}</td>
                  <td className="py-3">{row.rotiQuantity ?? '—'}</td>
                  <td className="py-3">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 space-y-3 md:hidden">
            {rows.map((row) => (
              <div key={row.userId} className="rounded-lg border border-gray-200 p-4 text-lg">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {row.fullName} <span className="text-gray-500">({row.userCode})</span>
                  </span>
                  <StatusBadge status={row.status} />
                </div>
                <div className="mt-2 text-base text-gray-700">
                  Thali: {thaliCell(row)} · Gravy: {row.gravyLabel ?? '—'} · Rice: {row.riceLabel ?? '—'} · Roti:{' '}
                  {row.rotiQuantity ?? '—'}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-6 flex gap-3">
        <Link href="/admin" className="text-lg text-blue-600 underline">
          Back to Dashboard
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

- [ ] **Step 3: Manual verification (requires a running dev server and a seeded database)**

```bash
npm run dev
```

Sign in as an admin (or super_admin) and visit `/admin/requests`. Confirm: the table shows tomorrow's requests by default; changing the date, filter, or search field and clicking Apply reloads the page with the new results; a gravy/rice filter option narrows the list to just that portion; the table becomes stacked cards below the `md` breakpoint (resize the browser or use dev tools' device toolbar).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/requests"
git commit -m "feat: add admin detailed request view at /admin/requests"
```

---

### Task 5: `/admin/users/search` — user search

**Files:**
- Create: `src/app/(app)/admin/users/search/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient`

- [ ] **Step 1: Implement the page**

Create `src/app/(app)/admin/users/search/page.tsx`:

```tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function AdminUserSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { q, error } = await searchParams;
  const query = (q ?? '').trim();
  const supabase = await createServerSupabaseClient();

  let results: { id: string; full_name: string; user_code: string; mobile: string | null; email: string | null }[] = [];
  let loadError = false;

  if (query) {
    // PostgREST's .or() filter string treats "," and "()" as syntax — strip them
    // so a search term containing one can't break or redirect the filter.
    const sanitized = query.replace(/[,()]/g, '');
    const { data, error: searchError } = await supabase
      .from('profiles')
      .select('id, full_name, user_code, mobile, email')
      .eq('active', true)
      .or(
        `full_name.ilike.%${sanitized}%,user_code.ilike.%${sanitized}%,mobile.ilike.%${sanitized}%,email.ilike.%${sanitized}%`
      )
      .order('full_name')
      .limit(25);
    if (searchError) {
      loadError = true;
    } else {
      results = data ?? [];
    }
  }

  const errorMessage = error === 'not_found' ? 'User not found.' : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Search Users</h1>
      {errorMessage && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

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

      {loadError && (
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not run this search. Please try again.
        </p>
      )}

      {!loadError && query && results.length === 0 && (
        <p className="mt-6 text-lg text-gray-600">No results found for this user search.</p>
      )}

      <div className="mt-6 space-y-3">
        {results.map((user) => (
          <Link
            key={user.id}
            href={`/admin/users/${user.id}`}
            className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
          >
            <span className="font-semibold">{user.full_name}</span>{' '}
            <span className="text-gray-500">({user.user_code})</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

- [ ] **Step 3: Manual verification (requires a running dev server and a seeded database)**

Sign in as an admin, visit `/admin/users/search`, search for a seeded user by a partial name, then by their member ID, then by a partial mobile number. Confirm each returns that user, and an empty/no-match search shows "No results found for this user search." rather than the full user list.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/users/search"
git commit -m "feat: add admin user search at /admin/users/search"
```

---

### Task 6: `/admin/users/[id]` — user detail and history

**Files:**
- Create: `src/app/(app)/admin/users/[id]/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient`, `getSettings`/`SETTINGS_KEYS`, `todayInTimezone`/`addDays`, `classifyRequestStatus` (Task 1)

- [ ] **Step 1: Implement the page**

Create `src/app/(app)/admin/users/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone, addDays } from '@/lib/time/cutoff';
import { classifyRequestStatus, type RequestStatus } from '@/lib/reports/request-status';

const STATUS_LABEL: Record<RequestStatus, string> = {
  thali: '✓ Thali',
  no_thali: '✕ No Thali',
  no_response: '? No Response',
  on_leave: '⏸ On Leave',
};

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(['admin', 'super_admin']);
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: user, error: userError } = await supabase
    .from('profiles')
    .select('id, full_name, user_code, mobile, email, role, active')
    .eq('id', id)
    .maybeSingle();

  if (userError || !user) {
    redirect('/admin/users/search?error=not_found');
  }

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const tomorrow = addDays(today, 1);

  const { data: leaveRows } = await supabase
    .from('user_leaves')
    .select('from_date, to_date')
    .eq('user_id', id)
    .gte('to_date', today);
  const isOnLeave = (date: string) => (leaveRows ?? []).some((l) => l.from_date <= date && date <= l.to_date);

  const { data: recentRequests } = await supabase
    .from('thali_requests')
    .select('service_date, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
    .eq('user_id', id)
    .order('service_date', { ascending: false })
    .limit(14);

  const requestByDate = new Map((recentRequests ?? []).map((r) => [r.service_date, r]));
  const gravyRiceIds = [
    ...new Set(
      (recentRequests ?? []).flatMap((r) => [r.gravy_portion_id, r.rice_portion_id]).filter((v): v is string => !!v)
    ),
  ];
  const { data: portionOptions } = gravyRiceIds.length
    ? await supabase.from('portion_options').select('id, label').in('id', gravyRiceIds)
    : { data: [] as { id: string; label: string }[] };
  const labelById = new Map((portionOptions ?? []).map((o) => [o.id, o.label]));

  const todayRequest = requestByDate.get(today);
  const tomorrowRequest = requestByDate.get(tomorrow);
  const todayStatus = classifyRequestStatus(isOnLeave(today), todayRequest ? { wantsThali: todayRequest.wants_thali } : undefined);
  const tomorrowStatus = classifyRequestStatus(
    isOnLeave(tomorrow),
    tomorrowRequest ? { wantsThali: tomorrowRequest.wants_thali } : undefined
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/users/search" className="text-lg text-blue-600 underline">
        ← Back to Search
      </Link>

      <h1 className="mt-4 text-3xl font-bold">{user.full_name}</h1>
      <p className="text-lg text-gray-600">
        {user.user_code} · {user.role} · {user.active ? 'Active' : 'Inactive'}
      </p>
      {user.mobile && <p className="text-lg text-gray-600">{user.mobile}</p>}
      {user.email && <p className="text-lg text-gray-600">{user.email}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-600">TODAY — {today}</p>
          <p className="text-xl font-semibold">{STATUS_LABEL[todayStatus]}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-600">TOMORROW — {tomorrow}</p>
          <p className="text-xl font-semibold">{STATUS_LABEL[tomorrowStatus]}</p>
          {tomorrowStatus === 'thali' && tomorrowRequest && (
            <p className="mt-1 text-base text-gray-700">
              {labelById.get(tomorrowRequest.gravy_portion_id ?? '') ?? '—'} ·{' '}
              {labelById.get(tomorrowRequest.rice_portion_id ?? '') ?? '—'} · Roti {tomorrowRequest.roti_quantity ?? '—'}
            </p>
          )}
        </div>
      </div>

      <h2 className="mt-8 text-2xl font-bold">Recent History</h2>
      <div className="mt-2 space-y-2">
        {(recentRequests ?? []).length === 0 && <p className="text-lg text-gray-600">No requests recorded yet.</p>}
        {(recentRequests ?? []).map((r) => (
          <div key={r.service_date} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
            <span className="font-semibold">{r.service_date}</span> —{' '}
            {r.wants_thali
              ? `Thali (${labelById.get(r.gravy_portion_id ?? '') ?? '—'}, ${labelById.get(r.rice_portion_id ?? '') ?? '—'}, Roti ${r.roti_quantity ?? '—'})`
              : 'No Thali'}
          </div>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

- [ ] **Step 3: Manual verification (requires a running dev server and a seeded database)**

From `/admin/users/search`, click into a seeded user. Confirm: today's and tomorrow's status show correctly (including showing "⏸ On Leave" for a user seeded with a leave row covering that date, even if they also have a stale request row for it); the recent history list shows up to 14 past rows in descending date order; only `profiles` fields are shown — no auth/session data anywhere on the page.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/users/[id]"
git commit -m "feat: add admin user detail and history page at /admin/users/[id]"
```

---

### Task 7: Nav links from `/admin` + final verification

**Files:**
- Modify: `src/app/(app)/admin/page.tsx`

**Interfaces:**
- Consumes: none new — this task only adds `<Link>`s to the existing page.

- [ ] **Step 1: Add the nav links**

In `src/app/(app)/admin/page.tsx`, there are two `<Link href="/admin/menu">...</Link>` / `<Link href="/admin/leave">...</Link>` pairs — one inside the service-holiday early-return branch, one at the bottom of the normal render. Add two more links, in the same style, to **both** locations:

```tsx
<Link href="/admin/requests" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
  Detailed Requests
</Link>
<Link href="/admin/users/search" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
  Search Users
</Link>
```

Place them immediately after the existing `Manage Leave` link in each of the two `<div className="mt-6 flex flex-wrap gap-3">...</div>` blocks.

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

Expected: all green, including every test from Tasks 1-3 of this plan and every pre-existing test from Phases 1-3b-core.

- [ ] **Step 4: Manual verification (requires a running dev server)**

Sign in as an admin, land on `/admin`, and confirm both new links are visible and navigate correctly to `/admin/requests` and `/admin/users/search`. Confirm the same two links also appear on the "No Thali Service Tomorrow" holiday state (temporarily add a `service_holidays` row for tomorrow if none exists locally, to exercise that branch, then remove it).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/page.tsx"
git commit -m "feat: add nav links to detailed requests and user search from /admin"
```

---

## Self-Review Notes

- **Spec coverage:** §18 (filterable table+cards, User/Thali/Gravy/Rice/Roti/Status columns, All/Thali/No Thali/No Response/Leave/portion filters, search) → Tasks 3-4. §19 (search by name/user_code/mobile/email with partial match, user summary/today/tomorrow/portion/history, no auth secrets) → Tasks 5-6. §53 (no duplicated business rules) → Tasks 1-2 (the classifier extraction this whole plan is built around). Nav discoverability → Task 7.
- **Type consistency:** `RequestStatus` (Task 1) is reused verbatim by `daily-summary.ts` (Task 2, via import), `request-list.ts` (Task 3, via import), and both new pages (Tasks 4 and 6, via import) — no page redefines its own status union.
- **No placeholders:** every step has runnable code; no task defers behavior to a later "handle edge cases" step.
