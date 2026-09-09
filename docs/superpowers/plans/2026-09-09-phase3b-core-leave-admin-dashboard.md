# FMBRequestThali — Phase 3b-core Leave/No-Service + Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the leave/no-service data model, wire it into Phase 3a's existing submission path so a user can't request a thali on a day they're on leave or the kitchen is closed, and build the admin operational dashboard (`/admin`) that shows tomorrow's counts and portion breakdown — correctly excluding leave/holiday days from being miscounted.

**Architecture:** Two new tables (`user_leaves`, `service_holidays`) with SQL helper functions mirroring Phase 3a's `is_before_request_cutoff` pattern, two new *restrictive* RLS policies added to the already-shipped `thali_requests` table (additive migration, existing policies untouched), and a single pure/unit-tested TS aggregation function (`lib/reports/daily-summary.ts`) that the admin dashboard's Server Component calls — no new SQL views, per the brainstormed YAGNI decision.

**Tech Stack:** Next.js Server Components + Server Actions, Supabase (Postgres + RLS), zod, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-09-phase3b-core-design.md` (and source `FMBRequestThali Web App — Complete Development Prompt.md` §16-20, §29, §49, §51)

## Global Constraints

- Strict TypeScript, no `any`.
- Every zod schema field that a `FormData`-backed form might omit must use `.nullable().optional()`, not `.optional().or(z.literal(''))` — `FormData.get()` returns `null` (not `undefined`) for an absent field, and this exact mismatch has broken submission twice already in this project's history.
- Never embed two tables across an ambiguous or multi-FK relationship in one `.select()` — `user_leaves` has TWO foreign keys to `profiles` (`user_id` and `entered_by`), so any query needing both a leave row and its user's name must either qualify the embed with the exact FK constraint name or (preferred, matching Phase 3a's established safe pattern) query the two tables separately and join in application code.
- Leave/holiday enforcement must be checked in both the Server Action (fast UX feedback) and RLS (`as restrictive`, unbypassable defense-in-depth) — same dual-enforcement pattern already used for the 6PM cutoff. Never trust only one layer.
- Never calculate the admin dashboard's counts/portion totals only in the client — the aggregation runs in an async Server Component (server-side) via a pure, unit-tested function.
- Large touch targets (`h-12`/`h-14`), icon+text+color together for status, never color alone.
- Migration numbering continues from Phase 3a's last migration: next is `0013`.

---

## File Structure

- `supabase/migrations/0013_leave_and_holidays.sql` — `user_leaves`, `service_holidays` tables
- `supabase/migrations/0014_leave_holidays_functions_rls.sql` — `is_on_leave`, `is_service_holiday` functions + RLS for the two new tables
- `supabase/migrations/0015_thali_requests_leave_holiday_restriction.sql` — restrictive policies on `thali_requests` (back-edit, additive only)
- `src/lib/validation/leave.ts` — `leaveCreateSchema`, `serviceHolidayCreateSchema`
- `src/lib/reports/daily-summary.ts` — `computeDailySummary` (pure, unit-tested)
- `src/app/(app)/dashboard/actions.ts` — modify: `submitThaliRequestAction` gains a leave/holiday check
- `src/app/(app)/dashboard/page.tsx` — modify: shows a dedicated info card instead of `ThaliRequestCard` when on leave or a holiday
- `src/app/(app)/admin/leave/actions.ts` — `createLeaveAction`
- `src/app/(app)/admin/leave/page.tsx` — leave list + create form
- `src/app/(app)/super-admin/service-holidays/actions.ts` — `createServiceHolidayAction`
- `src/app/(app)/super-admin/service-holidays/page.tsx` — holiday list + create form
- `src/lib/time/cutoff.ts` — modify: export `addDays` (currently duplicated as a local helper in `dashboard/page.tsx`)
- `src/app/(app)/admin/page.tsx` — modify: replace the Phase 1 placeholder with the real operational dashboard
- `scripts/seed-leave-and-holidays.ts` — new seed script
- `src/lib/supabase/leave-holiday-rls.integration.test.ts` — new integration test
- `README.md` — document the new seed script

---

### Task 1: Migration — `user_leaves` and `service_holidays` tables

**Files:**
- Create: `supabase/migrations/0013_leave_and_holidays.sql`

**Interfaces:**
- Produces: tables `user_leaves` (`id, user_id, from_date, to_date, reason, entered_by, created_at`) and `service_holidays` (`id, service_date, reason, created_by, created_at`) — every later task reads/writes these exact column names.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0013_leave_and_holidays.sql`:

```sql
create table public.user_leaves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  reason text,
  entered_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index user_leaves_user_id_idx on public.user_leaves(user_id);
create index user_leaves_date_range_idx on public.user_leaves(from_date, to_date);

create table public.service_holidays (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  reason text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.user_leaves enable row level security;
alter table public.service_holidays enable row level security;
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

Expected: migrations `0013_leave_and_holidays.sql` applies with no errors, alongside all prior migrations (0001-0012).

Verify the CHECK constraint rejects a bad range (via `npx supabase db psql` or the Studio SQL editor):

```sql
insert into user_leaves (user_id, from_date, to_date, entered_by)
values ((select id from profiles limit 1), '2026-01-10', '2026-01-05', (select id from profiles limit 1));
```

Expected: `ERROR: new row for relation "user_leaves" violates check constraint "user_leaves_to_date_check"`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0013_leave_and_holidays.sql
git commit -m "feat(db): add user_leaves and service_holidays tables"
```

---

### Task 2: Migration — leave/holiday SQL functions and RLS

**Files:**
- Create: `supabase/migrations/0014_leave_holidays_functions_rls.sql`

**Interfaces:**
- Consumes: `is_admin()`, `is_super_admin()` (Phase 1)
- Produces: SQL functions `is_on_leave(p_user_id uuid, p_service_date date) returns boolean`, `is_service_holiday(p_service_date date) returns boolean` — Task 3's restrictive policies and the integration test (Task 12) call these by name.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0014_leave_holidays_functions_rls.sql`:

```sql
create or replace function public.is_on_leave(p_user_id uuid, p_service_date date)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.user_leaves
    where user_id = p_user_id and p_service_date between from_date and to_date
  )
$$;

create or replace function public.is_service_holiday(p_service_date date)
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.service_holidays where service_date = p_service_date)
$$;

-- A user must be able to see their own leave rows (needed so their own dashboard
-- can detect "you're on leave tomorrow"), and admins see everyone's.
create policy user_leaves_select on public.user_leaves
  for select
  using (user_id = auth.uid() or public.is_admin());

create policy user_leaves_write_admin on public.user_leaves
  for all
  using (public.is_admin())
  with check (public.is_admin());

create policy service_holidays_select on public.service_holidays
  for select
  using (auth.uid() is not null);

create policy service_holidays_write_super_admin on public.service_holidays
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

Sanity-check the functions directly:

```sql
select public.is_on_leave('00000000-0000-0000-0000-000000000000', '2099-01-01'); -- expect false
select public.is_service_holiday('2020-01-01'); -- expect false
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0014_leave_holidays_functions_rls.sql
git commit -m "feat(db): add is_on_leave/is_service_holiday functions and RLS for leave/holiday tables"
```

---

### Task 3: Migration — restrictive RLS policies on `thali_requests` (back-edit)

**Files:**
- Create: `supabase/migrations/0015_thali_requests_leave_holiday_restriction.sql`

**Interfaces:**
- Consumes: `is_on_leave`, `is_service_holiday` (Task 2), `thali_requests` (Phase 3a, already shipped)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0015_thali_requests_leave_holiday_restriction.sql`:

```sql
-- Restrictive policies AND with the existing permissive insert/update policies from
-- Phase 3a (supabase/migrations/0011_thali_requests_rls.sql) rather than replacing
-- them — this migration never touches that file or its policies.
create policy thali_requests_insert_not_leave_or_holiday on public.thali_requests
  as restrictive
  for insert
  with check (
    not public.is_on_leave(user_id, service_date)
    and not public.is_service_holiday(service_date)
  );

create policy thali_requests_update_not_leave_or_holiday on public.thali_requests
  as restrictive
  for update
  with check (
    not public.is_on_leave(user_id, service_date)
    and not public.is_service_holiday(service_date)
  );
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
npm run seed:users
```

Using the Studio SQL editor or `psql`, insert a leave row for a seeded user covering a far-future date, then attempt (as that user, via a signed-in session — or note this will be exercised properly by Task 12's integration test) to confirm the restrictive policy is present:

```sql
select policyname, cmd, permissive from pg_policies where tablename = 'thali_requests';
```

Expected: 5 rows total — the 3 existing permissive policies from `0011_thali_requests_rls.sql` (`select`, `insert`, `update`, each `permissive`) plus the 2 new ones from this migration (`insert`, `update`, each `restrictive` i.e. `permissive = false`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0015_thali_requests_leave_holiday_restriction.sql
git commit -m "feat(db): block thali_requests writes on leave/holiday dates via restrictive RLS"
```

---

### Task 4: `lib/validation/leave.ts` — zod schemas

**Files:**
- Create: `src/lib/validation/leave.ts`
- Test: `src/lib/validation/leave.test.ts`

**Interfaces:**
- Produces: `leaveCreateSchema`, `LeaveCreateInput`, `serviceHolidayCreateSchema`, `ServiceHolidayCreateInput` — Task 8's `createLeaveAction` and Task 9's `createServiceHolidayAction` parse `FormData` through these.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/validation/leave.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { leaveCreateSchema, serviceHolidayCreateSchema } from './leave';

describe('leaveCreateSchema', () => {
  it('accepts a valid leave range with a reason', () => {
    const result = leaveCreateSchema.safeParse({
      userId: 'some-user-id',
      fromDate: '2026-09-10',
      toDate: '2026-09-12',
      reason: 'Family event',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a leave range with no reason field at all (FormData.get() returns null)', () => {
    const result = leaveCreateSchema.safeParse({
      userId: 'some-user-id',
      fromDate: '2026-09-10',
      toDate: '2026-09-12',
      reason: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a toDate before fromDate', () => {
    const result = leaveCreateSchema.safeParse({
      userId: 'some-user-id',
      fromDate: '2026-09-12',
      toDate: '2026-09-10',
      reason: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty userId', () => {
    const result = leaveCreateSchema.safeParse({
      userId: '',
      fromDate: '2026-09-10',
      toDate: '2026-09-12',
      reason: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('serviceHolidayCreateSchema', () => {
  it('accepts a valid date and reason', () => {
    const result = serviceHolidayCreateSchema.safeParse({
      serviceDate: '2026-09-20',
      reason: 'Community Event',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty reason', () => {
    const result = serviceHolidayCreateSchema.safeParse({
      serviceDate: '2026-09-20',
      reason: '   ',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/validation/leave.test.ts
```

Expected: FAIL — `./leave` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/validation/leave.ts`:

```ts
import { z } from 'zod';

export const leaveCreateSchema = z
  .object({
    userId: z.string().trim().min(1, 'Select a user'),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
    reason: z.string().trim().nullable().optional(),
  })
  .refine((data) => data.toDate >= data.fromDate, {
    message: 'End date must be on or after the start date',
    path: ['toDate'],
  });
export type LeaveCreateInput = z.infer<typeof leaveCreateSchema>;

export const serviceHolidayCreateSchema = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  reason: z.string().trim().min(1, 'A reason is required'),
});
export type ServiceHolidayCreateInput = z.infer<typeof serviceHolidayCreateSchema>;
```

Note: `reason` in `leaveCreateSchema` uses `.nullable().optional()`, not `.optional().or(z.literal(''))` — `FormData.get('reason')` returns `null` when a field is absent, and the plain-`.optional()` pattern has broken submission twice already in this project (menu creation, twice, in Phase 2). `serviceHolidayCreateSchema`'s `reason` is required and the form will always render that input, so a plain `.min(1)` is fine there — no absent-field risk.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/validation/leave.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/leave.ts src/lib/validation/leave.test.ts
git commit -m "feat: add leave and service-holiday validation schemas"
```

---

### Task 5: `lib/reports/daily-summary.ts` — pure aggregation function

**Files:**
- Create: `src/lib/reports/daily-summary.ts`
- Test: `src/lib/reports/daily-summary.test.ts`

**Interfaces:**
- Produces: `ThaliRequestRow`, `PortionOptionRow`, `DailySummary` types, `computeDailySummary(activeUserIds: string[], requests: ThaliRequestRow[], onLeaveUserIds: string[], gravyOptions: PortionOptionRow[], riceOptions: PortionOptionRow[]): DailySummary` — Task 10's admin dashboard page calls this with rows it fetches itself.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/daily-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeDailySummary } from './daily-summary';

describe('computeDailySummary', () => {
  const gravyOptions = [
    { id: 'g1', label: 'Small' },
    { id: 'g2', label: 'Regular' },
  ];
  const riceOptions = [
    { id: 'r1', label: 'No Rice' },
    { id: 'r2', label: 'Small' },
  ];

  it('counts a user with a thali request into the portion breakdowns', () => {
    const summary = computeDailySummary(
      ['u1'],
      [{ userId: 'u1', wantsThali: true, gravyPortionId: 'g1', ricePortionId: 'r1', rotiQuantity: 2 }],
      [],
      gravyOptions,
      riceOptions
    );
    expect(summary.thaliCount).toBe(1);
    expect(summary.gravyBreakdown).toEqual([
      { label: 'Small', count: 1 },
      { label: 'Regular', count: 0 },
    ]);
    expect(summary.totalRotis).toBe(2);
  });

  it('counts a user with wants_thali=false as no-thali', () => {
    const summary = computeDailySummary(
      ['u1'],
      [{ userId: 'u1', wantsThali: false, gravyPortionId: null, ricePortionId: null, rotiQuantity: null }],
      [],
      gravyOptions,
      riceOptions
    );
    expect(summary.noThaliCount).toBe(1);
    expect(summary.thaliCount).toBe(0);
  });

  it('counts a user with no request row and not on leave as no-response', () => {
    const summary = computeDailySummary(['u1'], [], [], gravyOptions, riceOptions);
    expect(summary.noResponseCount).toBe(1);
  });

  it('counts a user on leave as on-leave, even if they have a stale thali request row', () => {
    const summary = computeDailySummary(
      ['u1'],
      [{ userId: 'u1', wantsThali: true, gravyPortionId: 'g1', ricePortionId: 'r1', rotiQuantity: 2 }],
      ['u1'],
      gravyOptions,
      riceOptions
    );
    expect(summary.onLeaveCount).toBe(1);
    expect(summary.thaliCount).toBe(0);
    expect(summary.gravyBreakdown).toEqual([
      { label: 'Small', count: 0 },
      { label: 'Regular', count: 0 },
    ]);
  });

  it('produces a roti breakdown sorted by quantity', () => {
    const summary = computeDailySummary(
      ['u1', 'u2'],
      [
        { userId: 'u1', wantsThali: true, gravyPortionId: 'g1', ricePortionId: 'r1', rotiQuantity: 3 },
        { userId: 'u2', wantsThali: true, gravyPortionId: 'g1', ricePortionId: 'r1', rotiQuantity: 1 },
      ],
      [],
      gravyOptions,
      riceOptions
    );
    expect(summary.rotiBreakdown).toEqual([
      { quantity: 1, count: 1 },
      { quantity: 3, count: 1 },
    ]);
    expect(summary.totalRotis).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/reports/daily-summary.test.ts
```

Expected: FAIL — `./daily-summary` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/reports/daily-summary.ts`:

```ts
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

/**
 * A leave day takes precedence over any thali_requests row for that user/date —
 * checked first below — because the RLS/action enforcement (Task 3) only blocks
 * NEW writes; a leave added after a user already submitted a request does not
 * retroactively delete that row, so this function must not trust the row's
 * presence blindly.
 */
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
    if (onLeaveSet.has(userId)) {
      onLeaveCount++;
      continue;
    }
    const request = requestsByUser.get(userId);
    if (!request) {
      noResponseCount++;
      continue;
    }
    if (!request.wantsThali) {
      noThaliCount++;
      continue;
    }
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/reports/daily-summary.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/daily-summary.ts src/lib/reports/daily-summary.test.ts
git commit -m "feat: add pure daily-summary aggregation function"
```

---

### Task 6: Wire leave/holiday check into `submitThaliRequestAction`

**Files:**
- Modify: `src/app/(app)/dashboard/actions.ts` (existing file — keep `logoutAction` unchanged)

**Interfaces:**
- Consumes: `user_leaves`, `service_holidays` (Task 1)

- [ ] **Step 1: Implement**

Replace `src/app/(app)/dashboard/actions.ts` entirely with:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { isBeforeCutoff } from '@/lib/time/cutoff';
import { thaliRequestSchema } from '@/lib/validation/thali-request';

export async function logoutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function submitThaliRequestAction(formData: FormData) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const serviceDate = formData.get('serviceDate') as string;

  const settings = await getSettings(supabase, [
    SETTINGS_KEYS.CUTOFF_TIME,
    SETTINGS_KEYS.TIMEZONE,
    SETTINGS_KEYS.ROTI_MIN_QTY,
    SETTINGS_KEYS.ROTI_MAX_QTY,
  ]);
  const cutoffTime = (settings[SETTINGS_KEYS.CUTOFF_TIME] as string) ?? '18:00';
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const rotiMin = (settings[SETTINGS_KEYS.ROTI_MIN_QTY] as number) ?? 0;
  const rotiMax = (settings[SETTINGS_KEYS.ROTI_MAX_QTY] as number) ?? 6;

  const parsed = thaliRequestSchema(rotiMin, rotiMax).safeParse({
    serviceDate,
    wantsThali: formData.get('wantsThali'),
    gravyPortionId: formData.get('gravyPortionId'),
    ricePortionId: formData.get('ricePortionId'),
    rotiQuantity: formData.get('rotiQuantity'),
  });

  if (!parsed.success) {
    redirect('/dashboard?error=invalid');
  }

  if (!isBeforeCutoff(serviceDate, timezone, cutoffTime)) {
    redirect('/dashboard?error=cutoff_passed');
  }

  const [{ data: leaveRows }, { data: holidayRows }] = await Promise.all([
    supabase
      .from('user_leaves')
      .select('id')
      .eq('user_id', profile.id)
      .lte('from_date', serviceDate)
      .gte('to_date', serviceDate),
    supabase.from('service_holidays').select('id').eq('service_date', serviceDate),
  ]);

  if ((leaveRows?.length ?? 0) > 0 || (holidayRows?.length ?? 0) > 0) {
    redirect('/dashboard?error=unavailable');
  }

  const { error } = await supabase.from('thali_requests').upsert(
    {
      user_id: profile.id,
      service_date: parsed.data.serviceDate,
      wants_thali: parsed.data.wantsThali,
      gravy_portion_id: parsed.data.wantsThali ? parsed.data.gravyPortionId : null,
      rice_portion_id: parsed.data.wantsThali ? parsed.data.ricePortionId : null,
      roti_quantity: parsed.data.wantsThali ? parsed.data.rotiQuantity : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,service_date' }
  );

  if (error) {
    // The only realistic causes at this point (shape already validated, leave/holiday
    // already checked above) are the RLS with-check's cutoff/leave/holiday conditions
    // failing due to a race between page load and submit.
    redirect('/dashboard?error=unavailable');
  }

  redirect('/dashboard');
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/dashboard/actions.ts"
git commit -m "feat: block thali submission on leave/holiday dates in submitThaliRequestAction"
```

---

### Task 7: Wire leave/holiday states into the dashboard page

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx` (existing file)

**Interfaces:**
- Consumes: `user_leaves`, `service_holidays` (Task 1)

- [ ] **Step 1: Implement**

Replace `src/app/(app)/dashboard/page.tsx` entirely with:

```tsx
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { isBeforeCutoff, todayInTimezone, serviceDateRange } from '@/lib/time/cutoff';
import { submitThaliRequestAction, logoutAction } from './actions';
import { ThaliRequestCard, type ExistingRequest } from '@/components/thali/thali-request-card';
import { MenuCalendar, type CalendarDay } from '@/components/thali/menu-calendar';

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const { error: errorParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const settings = await getSettings(supabase, [
    SETTINGS_KEYS.CUTOFF_TIME,
    SETTINGS_KEYS.TIMEZONE,
    SETTINGS_KEYS.ROTI_MIN_QTY,
    SETTINGS_KEYS.ROTI_MAX_QTY,
  ]);
  const cutoffTime = (settings[SETTINGS_KEYS.CUTOFF_TIME] as string) ?? '18:00';
  const cutoffTimeDisplay = new Date(`1970-01-01T${cutoffTime}`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const rotiMin = (settings[SETTINGS_KEYS.ROTI_MIN_QTY] as number) ?? 0;
  const rotiMax = (settings[SETTINGS_KEYS.ROTI_MAX_QTY] as number) ?? 6;

  const today = todayInTimezone(timezone);
  const tomorrow = addDays(today, 1);
  const cutoffPassed = !isBeforeCutoff(tomorrow, timezone, cutoffTime);

  const dates = serviceDateRange(timezone, 3, 7);

  const { data: menus } = await supabase
    .from('menus')
    .select('id, service_date, current_approved_version_id')
    .in('service_date', dates);

  const approvedVersionIds = (menus ?? [])
    .map((m) => m.current_approved_version_id)
    .filter((id): id is string => !!id);

  const { data: versions } = approvedVersionIds.length
    ? await supabase.from('menu_versions').select('id, menu_items(item_name, display_order)').in('id', approvedVersionIds)
    : { data: [] as { id: string; menu_items: { item_name: string; display_order: number }[] }[] };

  const versionsById = new Map((versions ?? []).map((v) => [v.id, v]));
  const calendarDays: CalendarDay[] = dates.map((serviceDate) => {
    const menu = (menus ?? []).find((m) => m.service_date === serviceDate);
    const version = menu?.current_approved_version_id ? versionsById.get(menu.current_approved_version_id) : undefined;
    const items = (version?.menu_items ?? []).sort((a, b) => a.display_order - b.display_order).map((i) => i.item_name);
    return { serviceDate, items };
  });

  const tomorrowMenu = calendarDays.find((d) => d.serviceDate === tomorrow);

  const { data: gravyOptions } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'gravy')
    .eq('active', true)
    .order('sort_order');
  const { data: riceOptions } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'rice')
    .eq('active', true)
    .order('sort_order');

  const { data: existing, error: existingError } = await supabase
    .from('thali_requests')
    .select('wants_thali, gravy_portion_id, rice_portion_id, roti_quantity, updated_at')
    .eq('service_date', tomorrow)
    .eq('user_id', profile.id)
    .maybeSingle();

  if (existingError) {
    console.error('Failed to load existing thali request:', existingError);
  }

  let existingRequest: ExistingRequest = null;
  if (existing) {
    existingRequest = {
      wantsThali: existing.wants_thali,
      rotiQuantity: existing.roti_quantity,
      gravyPortionId: existing.gravy_portion_id,
      ricePortionId: existing.rice_portion_id,
      gravyLabel: (gravyOptions ?? []).find((o) => o.id === existing.gravy_portion_id)?.label ?? null,
      riceLabel: (riceOptions ?? []).find((o) => o.id === existing.rice_portion_id)?.label ?? null,
      updatedAt: existing.updated_at,
    };
  }

  const { data: leaveRows } = await supabase
    .from('user_leaves')
    .select('reason')
    .eq('user_id', profile.id)
    .lte('from_date', tomorrow)
    .gte('to_date', tomorrow);
  const { data: holidayRows } = await supabase.from('service_holidays').select('reason').eq('service_date', tomorrow);

  const onLeave = (leaveRows?.length ?? 0) > 0;
  const isHoliday = (holidayRows?.length ?? 0) > 0;

  const errorMessage =
    errorParam === 'cutoff_passed'
      ? 'Selection time has closed. Your previous saved selection has been kept.'
      : errorParam === 'invalid'
        ? 'Your selection was not saved. Please try again.'
        : errorParam === 'unavailable'
          ? "You're on leave or thali service is unavailable for this date."
          : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Good Morning, {profile.fullName}</h1>
        <form action={logoutAction}>
          <button type="submit" className="text-lg text-blue-600 underline">
            Log Out
          </button>
        </form>
      </div>

      {errorMessage && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <h2 className="mt-6 text-2xl font-bold">Tomorrow&apos;s Thali</h2>
      <p className="text-lg text-gray-600">{tomorrow}</p>
      {tomorrowMenu && tomorrowMenu.items.length > 0 ? (
        <div className="mt-2 space-y-1 text-lg">
          {tomorrowMenu.items.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-lg text-gray-600">No menu has been published for this date yet.</p>
      )}

      <div className="mt-4">
        {isHoliday ? (
          <div className="rounded-xl border border-gray-200 p-6">
            <p className="text-xl font-semibold">No Thali Service Tomorrow</p>
            {holidayRows![0].reason && <p className="mt-2 text-lg text-gray-600">{holidayRows![0].reason}</p>}
          </div>
        ) : onLeave ? (
          <div className="rounded-xl border border-gray-200 p-6">
            <p className="text-xl font-semibold">You&apos;re on Leave Tomorrow</p>
            {leaveRows![0].reason && <p className="mt-2 text-lg text-gray-600">{leaveRows![0].reason}</p>}
          </div>
        ) : (
          <ThaliRequestCard
            key={existingRequest?.updatedAt ?? 'none'}
            serviceDate={tomorrow}
            serviceDateLabel="tomorrow"
            cutoffPassed={cutoffPassed}
            existingRequest={existingRequest}
            gravyOptions={gravyOptions ?? []}
            riceOptions={riceOptions ?? []}
            rotiMin={rotiMin}
            rotiMax={rotiMax}
            cutoffTime={cutoffTimeDisplay}
            action={submitThaliRequestAction}
          />
        )}
      </div>

      <MenuCalendar days={calendarDays} todayDate={today} tomorrowDate={tomorrow} />
    </main>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat: show leave/no-service state on dashboard instead of the thali request card"
```

---

### Task 8: Admin leave management — `/admin/leave`

**Files:**
- Create: `src/app/(app)/admin/leave/actions.ts`
- Create: `src/app/(app)/admin/leave/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `leaveCreateSchema` (Task 4)
- Produces: `createLeaveAction(formData: FormData)`

- [ ] **Step 1: Implement the server action**

Create `src/app/(app)/admin/leave/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { leaveCreateSchema } from '@/lib/validation/leave';

export async function createLeaveAction(formData: FormData) {
  const profile = await requireRole(['admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const userCode = (formData.get('userCode') as string | null)?.trim().toUpperCase();
  const { data: user } = userCode
    ? await supabase.from('profiles').select('id').eq('user_code', userCode).maybeSingle()
    : { data: null };

  if (!user) {
    redirect('/admin/leave?error=user_not_found');
  }

  const parsed = leaveCreateSchema.safeParse({
    userId: user.id,
    fromDate: formData.get('fromDate'),
    toDate: formData.get('toDate'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    redirect('/admin/leave?error=invalid');
  }

  const { data: overlapping } = await supabase
    .from('user_leaves')
    .select('id')
    .eq('user_id', parsed.data.userId)
    .lte('from_date', parsed.data.toDate)
    .gte('to_date', parsed.data.fromDate);

  if (overlapping && overlapping.length > 0) {
    redirect('/admin/leave?error=overlap');
  }

  const { error } = await supabase.from('user_leaves').insert({
    user_id: parsed.data.userId,
    from_date: parsed.data.fromDate,
    to_date: parsed.data.toDate,
    reason: parsed.data.reason || null,
    entered_by: profile.id,
  });

  if (error) {
    redirect('/admin/leave?error=save_failed');
  }

  redirect('/admin/leave');
}
```

- [ ] **Step 2: Implement the page**

Create `src/app/(app)/admin/leave/page.tsx`:

```tsx
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLeaveAction } from './actions';

export default async function AdminLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { error } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: leaves } = await supabase
    .from('user_leaves')
    .select('id, user_id, from_date, to_date, reason')
    .order('from_date', { ascending: false })
    .limit(30);

  const userIds = [...new Set((leaves ?? []).map((l) => l.user_id))];
  const { data: users } = userIds.length
    ? await supabase.from('profiles').select('id, full_name, user_code').in('id', userIds)
    : { data: [] as { id: string; full_name: string; user_code: string }[] };
  const usersById = new Map((users ?? []).map((u) => [u.id, u]));

  const errorMessage =
    error === 'user_not_found'
      ? 'No user found with that member ID.'
      : error === 'overlap'
        ? 'This user already has a leave period covering part of these dates.'
        : error === 'invalid'
          ? 'Check the dates and try again.'
          : error === 'save_failed'
            ? 'Could not save the leave entry. Please try again.'
            : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Manage Leave</h1>
      {errorMessage && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <form action={createLeaveAction} className="mt-6 space-y-4 rounded-xl border border-gray-200 p-6">
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
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-lg font-semibold" htmlFor="fromDate">
              From
            </label>
            <input
              id="fromDate"
              name="fromDate"
              type="date"
              required
              className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
            />
          </div>
          <div className="flex-1">
            <label className="text-lg font-semibold" htmlFor="toDate">
              To
            </label>
            <input
              id="toDate"
              name="toDate"
              type="date"
              required
              className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
            />
          </div>
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="reason">
            Reason (optional)
          </label>
          <input
            id="reason"
            name="reason"
            type="text"
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
          Add Leave
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {(leaves ?? []).length === 0 && <p className="text-lg text-gray-600">No leave entries yet.</p>}
        {(leaves ?? []).map((leave) => {
          const user = usersById.get(leave.user_id);
          return (
            <div key={leave.id} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
              <span className="font-semibold">{user?.full_name}</span> ({user?.user_code}): {leave.from_date} –{' '}
              {leave.to_date}
              {leave.reason && <span className="text-gray-600"> — {leave.reason}</span>}
            </div>
          );
        })}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/leave"
git commit -m "feat: add admin leave management page"
```

---

### Task 9: Super-admin service holidays — `/super-admin/service-holidays`

**Files:**
- Create: `src/app/(app)/super-admin/service-holidays/actions.ts`
- Create: `src/app/(app)/super-admin/service-holidays/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `serviceHolidayCreateSchema` (Task 4)
- Produces: `createServiceHolidayAction(formData: FormData)`

- [ ] **Step 1: Implement the server action**

Create `src/app/(app)/super-admin/service-holidays/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceHolidayCreateSchema } from '@/lib/validation/leave';

export async function createServiceHolidayAction(formData: FormData) {
  const profile = await requireRole(['super_admin']);
  const supabase = await createServerSupabaseClient();

  const parsed = serviceHolidayCreateSchema.safeParse({
    serviceDate: formData.get('serviceDate'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    redirect('/super-admin/service-holidays?error=invalid');
  }

  const { error } = await supabase.from('service_holidays').insert({
    service_date: parsed.data.serviceDate,
    reason: parsed.data.reason,
    created_by: profile.id,
  });

  if (error) {
    if (error.code === '23505') {
      redirect('/super-admin/service-holidays?error=duplicate');
    }
    redirect('/super-admin/service-holidays?error=save_failed');
  }

  redirect('/super-admin/service-holidays');
}
```

- [ ] **Step 2: Implement the page**

Create `src/app/(app)/super-admin/service-holidays/page.tsx`:

```tsx
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceHolidayAction } from './actions';

export default async function ServiceHolidaysPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole(['super_admin']);
  const { error } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: holidays } = await supabase
    .from('service_holidays')
    .select('id, service_date, reason')
    .order('service_date', { ascending: false })
    .limit(30);

  const errorMessage =
    error === 'duplicate'
      ? 'A no-service date already exists for that day.'
      : error === 'invalid'
        ? 'Enter a valid date and reason.'
        : error === 'save_failed'
          ? 'Could not save. Please try again.'
          : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">No-Service Dates</h1>
      {errorMessage && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <form
        action={createServiceHolidayAction}
        className="mt-6 space-y-4 rounded-xl border border-gray-200 p-6"
      >
        <div>
          <label className="text-lg font-semibold" htmlFor="serviceDate">
            Date
          </label>
          <input
            id="serviceDate"
            name="serviceDate"
            type="date"
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="reason">
            Reason
          </label>
          <input
            id="reason"
            name="reason"
            type="text"
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
          Add No-Service Date
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {(holidays ?? []).length === 0 && <p className="text-lg text-gray-600">No no-service dates scheduled.</p>}
        {(holidays ?? []).map((h) => (
          <div key={h.id} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
            <span className="font-semibold">{h.service_date}</span> — {h.reason}
          </div>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/super-admin/service-holidays"
git commit -m "feat: add super-admin no-service date management page"
```

---

### Task 10: Admin operational dashboard — `/admin`

**Files:**
- Modify: `src/lib/time/cutoff.ts` (add `addDays` export)
- Modify: `src/lib/time/cutoff.test.ts` (add a test for it)
- Modify: `src/app/(app)/dashboard/page.tsx` (use the new export instead of its local copy)
- Modify: `src/app/(app)/admin/page.tsx` (full rewrite, replacing the Phase 1 placeholder)

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `todayInTimezone` (Phase 3a), `computeDailySummary` (Task 5), `user_leaves`/`service_holidays` (Task 1)
- Produces: `addDays(dateStr: string, days: number): string` in `lib/time/cutoff.ts` — no longer duplicated locally in `dashboard/page.tsx`.

- [ ] **Step 1: Extract `addDays` into `lib/time/cutoff.ts`**

Append to `src/lib/time/cutoff.ts`:

```ts
/** Adds (or subtracts, with a negative value) whole days to a YYYY-MM-DD date string. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
```

Add to `src/lib/time/cutoff.test.ts` (append):

```ts
import { addDays } from './cutoff';

describe('addDays', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('subtracts days with a negative value', () => {
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });
});
```

Run `npx vitest run src/lib/time/cutoff.test.ts` — expect all tests (existing + new) to pass.

In `src/app/(app)/dashboard/page.tsx`: delete the local `function addDays(...)` definition (lines near the top of the file), and change the import line to:

```ts
import { isBeforeCutoff, todayInTimezone, serviceDateRange, addDays } from '@/lib/time/cutoff';
```

Run `npm run build` to confirm the page still compiles with the imported version.

- [ ] **Step 2: Implement the admin dashboard page**

Replace `src/app/(app)/admin/page.tsx` entirely with:

```tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone, addDays } from '@/lib/time/cutoff';
import { computeDailySummary, type ThaliRequestRow } from '@/lib/reports/daily-summary';

export default async function AdminPage() {
  const profile = await requireRole(['admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);
  const tomorrow = addDays(today, 1);

  const { data: holidayRows } = await supabase.from('service_holidays').select('reason').eq('service_date', tomorrow);
  const holidayReason = holidayRows?.[0]?.reason ?? null;

  if (holidayReason) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="mt-2 text-lg text-gray-600">Tomorrow — {tomorrow}</p>
        <div className="mt-6 rounded-xl border border-gray-200 p-6">
          <p className="text-xl font-semibold">No Thali Service Tomorrow</p>
          <p className="mt-2 text-lg text-gray-600">{holidayReason}</p>
        </div>
        <Link href="/admin/menu" className="mt-6 inline-block rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
          Manage Menus
        </Link>
      </main>
    );
  }

  const { data: activeUsers } = await supabase.from('profiles').select('id').eq('role', 'user').eq('active', true);
  const activeUserIds = (activeUsers ?? []).map((u) => u.id);

  const { data: requestRows } = activeUserIds.length
    ? await supabase
        .from('thali_requests')
        .select('user_id, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
        .eq('service_date', tomorrow)
        .in('user_id', activeUserIds)
    : { data: [] as { user_id: string; wants_thali: boolean; gravy_portion_id: string | null; rice_portion_id: string | null; roti_quantity: number | null }[] };

  const requests: ThaliRequestRow[] = (requestRows ?? []).map((r) => ({
    userId: r.user_id,
    wantsThali: r.wants_thali,
    gravyPortionId: r.gravy_portion_id,
    ricePortionId: r.rice_portion_id,
    rotiQuantity: r.roti_quantity,
  }));

  const { data: leaveRows } = activeUserIds.length
    ? await supabase
        .from('user_leaves')
        .select('user_id')
        .lte('from_date', tomorrow)
        .gte('to_date', tomorrow)
        .in('user_id', activeUserIds)
    : { data: [] as { user_id: string }[] };
  const onLeaveUserIds = (leaveRows ?? []).map((l) => l.user_id);

  const { data: gravyOptions } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'gravy')
    .eq('active', true)
    .order('sort_order');
  const { data: riceOptions } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'rice')
    .eq('active', true)
    .order('sort_order');

  const summary = computeDailySummary(activeUserIds, requests, onLeaveUserIds, gravyOptions ?? [], riceOptions ?? []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Admin Dashboard</h1>
      <p className="mt-2 text-lg text-gray-600">
        Signed in as {profile.fullName} ({profile.role})
      </p>
      <h2 className="mt-6 text-2xl font-bold">Tomorrow — {tomorrow}</h2>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-600">TOTAL USERS</p>
          <p className="text-3xl font-bold">{summary.totalUsers}</p>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-700">THALI REQUIRED</p>
          <p className="text-3xl font-bold text-green-700">{summary.thaliCount}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-600">NO THALI</p>
          <p className="text-3xl font-bold">{summary.noThaliCount}</p>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm font-semibold text-yellow-800">NO RESPONSE</p>
          <p className="text-3xl font-bold text-yellow-800">{summary.noResponseCount}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-600">ON LEAVE</p>
          <p className="text-3xl font-bold">{summary.onLeaveCount}</p>
        </div>
      </div>

      <h3 className="mt-6 text-xl font-bold">Portions</h3>
      <div className="mt-2 space-y-3">
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="font-semibold">Gravy</p>
          <p className="text-lg">
            {summary.gravyBreakdown.map((b) => `${b.label} ${b.count}`).join(' | ')}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="font-semibold">Rice</p>
          <p className="text-lg">{summary.riceBreakdown.map((b) => `${b.label} ${b.count}`).join(' | ')}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="font-semibold">Roti</p>
          <p className="text-lg">
            {summary.rotiBreakdown.map((b) => `${b.quantity} × ${b.count}`).join(' | ')}
          </p>
          <p className="mt-1 text-lg font-semibold">Total: {summary.totalRotis}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/admin/menu" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
          Manage Menus
        </Link>
        <Link href="/admin/leave" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
          Manage Leave
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: succeeds, `/admin` listed as a dynamic route.

- [ ] **Step 4: Commit**

```bash
git add src/lib/time/cutoff.ts src/lib/time/cutoff.test.ts "src/app/(app)/dashboard/page.tsx" "src/app/(app)/admin/page.tsx"
git commit -m "feat: build admin operational dashboard with tomorrow's counts and portion summary"
```

---

### Task 11: Seed script — leave entries and a service holiday

**Files:**
- Create: `scripts/seed-leave-and-holidays.ts`
- Modify: `package.json` (add `seed:leave` script)

**Interfaces:**
- Consumes: seeded profiles (`user_code` `US001`-`US015`, `AD001`, `SA001`, Phase 1's `seed:users`), `user_leaves`/`service_holidays` (Task 1)

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-leave-and-holidays.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (local Supabase only — never run this against a production project).'
  );
}

const supabase = createClient(url, serviceKey);

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seed() {
  const { data: admin } = await supabase.from('profiles').select('id').eq('user_code', 'AD001').single();
  const { data: superAdmin } = await supabase.from('profiles').select('id').eq('user_code', 'SA001').single();
  const { data: users } = await supabase
    .from('profiles')
    .select('id, user_code')
    .in('user_code', ['US004', 'US005', 'US006']);

  if (!admin || !superAdmin || !users || users.length < 3) {
    throw new Error('Run `npm run seed:users` first — admin/super_admin/US004-US006 profiles not found.');
  }

  const leaveRows = [
    {
      user_id: users.find((u) => u.user_code === 'US004')!.id,
      from_date: dateOffset(2),
      to_date: dateOffset(4),
      reason: 'Family function',
      entered_by: admin.id,
    },
    {
      user_id: users.find((u) => u.user_code === 'US005')!.id,
      from_date: dateOffset(-2),
      to_date: dateOffset(1),
      reason: 'Travel',
      entered_by: admin.id,
    },
    {
      user_id: users.find((u) => u.user_code === 'US006')!.id,
      from_date: dateOffset(6),
      to_date: dateOffset(9),
      reason: null,
      entered_by: admin.id,
    },
  ];

  for (const row of leaveRows) {
    const { error } = await supabase.from('user_leaves').insert(row);
    if (error) {
      console.error(`Failed to seed leave for ${row.user_id}:`, error.message);
      continue;
    }
    console.log(`Seeded leave: ${row.from_date} to ${row.to_date}`);
  }

  const holidayDate = dateOffset(5);
  const { error: holidayError } = await supabase
    .from('service_holidays')
    .insert({ service_date: holidayDate, reason: 'Community Event', created_by: superAdmin.id });
  if (holidayError) {
    console.error('Failed to seed service holiday:', holidayError.message);
  } else {
    console.log(`Seeded service holiday for ${holidayDate}`);
  }
}

seed();
```

- [ ] **Step 2: Add npm script**

In `package.json` `"scripts"`, add:

```json
"seed:leave": "tsx scripts/seed-leave-and-holidays.ts"
```

- [ ] **Step 3: Attempt to run (requires local Supabase running + `seed:users` already run)**

```bash
npx supabase db reset
npm run seed:users
npm run seed:leave
```

Expected: 3 "Seeded leave: ..." lines and 1 "Seeded service holiday for ..." line.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-leave-and-holidays.ts package.json
git commit -m "feat: add seed script for leave entries and a service holiday"
```

---

### Task 12: RLS integration test

**Files:**
- Create: `src/lib/supabase/leave-holiday-rls.integration.test.ts`

**Interfaces:**
- Consumes: seeded `user1@fmb.test`/`user2@fmb.test`/`AD001`/`SA001` (Phase 1), `is_on_leave`/`is_service_holiday` RPCs (Task 2), live local Supabase instance

- [ ] **Step 1: Write the test**

Create `src/lib/supabase/leave-holiday-rls.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !url || !anonKey || !serviceKey;

describe.skipIf(skip)('Leave and service-holiday enforcement', () => {
  it('a user on leave cannot submit a thali request for a leave date', async () => {
    const adminClient = createClient(url!, serviceKey!);
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const userId = (await client.auth.getUser()).data.user!.id;

    const future = new Date();
    future.setDate(future.getDate() + 40);
    const serviceDate = future.toISOString().slice(0, 10);

    const { data: admin } = await adminClient.from('profiles').select('id').eq('user_code', 'AD001').single();
    await adminClient
      .from('user_leaves')
      .insert({ user_id: userId, from_date: serviceDate, to_date: serviceDate, entered_by: admin!.id });

    const { error } = await client
      .from('thali_requests')
      .upsert({ user_id: userId, service_date: serviceDate, wants_thali: false }, { onConflict: 'user_id,service_date' });
    expect(error).not.toBeNull();
  });

  it('no user can submit a thali request for a service-holiday date', async () => {
    const adminClient = createClient(url!, serviceKey!);
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user2@fmb.test', password: 'DevPass123!' });
    const userId = (await client.auth.getUser()).data.user!.id;

    const future = new Date();
    future.setDate(future.getDate() + 41);
    const serviceDate = future.toISOString().slice(0, 10);

    const { data: superAdmin } = await adminClient.from('profiles').select('id').eq('user_code', 'SA001').single();
    await adminClient
      .from('service_holidays')
      .insert({ service_date: serviceDate, reason: 'Test holiday', created_by: superAdmin!.id });

    const { error } = await client
      .from('thali_requests')
      .upsert({ user_id: userId, service_date: serviceDate, wants_thali: false }, { onConflict: 'user_id,service_date' });
    expect(error).not.toBeNull();
  });

  it('is_on_leave agrees with direct table state', async () => {
    const adminClient = createClient(url!, serviceKey!);

    const future = new Date();
    future.setDate(future.getDate() + 42);
    const serviceDate = future.toISOString().slice(0, 10);

    const { data: user } = await adminClient.from('profiles').select('id').eq('user_code', 'US003').single();
    const { data: admin } = await adminClient.from('profiles').select('id').eq('user_code', 'AD001').single();
    await adminClient
      .from('user_leaves')
      .insert({ user_id: user!.id, from_date: serviceDate, to_date: serviceDate, entered_by: admin!.id });

    const { data: onLeave, error } = await adminClient.rpc('is_on_leave', {
      p_user_id: user!.id,
      p_service_date: serviceDate,
    });
    expect(error).toBeNull();
    expect(onLeave).toBe(true);

    const { data: notOnLeave } = await adminClient.rpc('is_on_leave', {
      p_user_id: user!.id,
      p_service_date: '2020-01-01',
    });
    expect(notOnLeave).toBe(false);
  });
});
```

- [ ] **Step 2: Run it (requires local Supabase running + `seed:users` already applied)**

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key> SUPABASE_SERVICE_ROLE_KEY=<local service key> npx vitest run src/lib/supabase/leave-holiday-rls.integration.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/leave-holiday-rls.integration.test.ts
git commit -m "test: add RLS integration test for leave/holiday enforcement"
```

---

### Task 13: README update and final verification

**Files:**
- Modify: `README.md`

**Interfaces:** none (documentation + verification only)

- [ ] **Step 1: Update `README.md`**

In the "Local development" numbered list, add a step after "Create sample thali requests: `npm run seed:thali`" for seeding leave/holidays:

```
Create sample leave/holidays: `npm run seed:leave` (a few leave periods across
seeded users and one upcoming service holiday, for testing the admin dashboard's
counts and the dashboard's leave/no-service states)
```

Renumber subsequent steps accordingly.

- [ ] **Step 2: Full verification pass**

```bash
npm run lint
npm run test
npm run build
```

Expected: all pass. If Docker/local Supabase is running, additionally run:

```bash
npx supabase db reset
npm run seed:users
npm run seed:menus
npm run seed:thali
npm run seed:leave
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key> SUPABASE_SERVICE_ROLE_KEY=<local service key> npx vitest run src/lib/supabase/leave-holiday-rls.integration.test.ts
```

Then do the same authenticated no-JS-form-fallback login check established in Phase 3a's final verification (fetch `/login`, extract the `$ACTION_ID_...` hidden field, POST `multipart/form-data` with it plus `email`/`password`, capture the session cookie, `curl` `/admin` and `/dashboard` with it) to confirm both pages render without a server error for a real signed-in admin/user session — since Phase 3a's own final review found that build/test passing is not equivalent to "actually loads."

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: document leave/holiday seeding in README"
```

---

## Self-Review Notes

- **Spec coverage:** §16 (admin dashboard, tomorrow's summary), §17 (portion summary, server-calculated), §20 (user leave, global no-service, "no user accidentally counted"), §29/§49 (leave/holiday block a request, non-silent failure), §51 (leave entries + one service holiday in seed data) all map to a task above. §18 (detailed request view) and §19 (user search) are explicitly out of scope — deferred to Phase 3b-detail per the brainstormed split.
- **Naming consistency checked:** `leaveCreateSchema`/`serviceHolidayCreateSchema`, `computeDailySummary`/`ThaliRequestRow`/`PortionOptionRow`/`DailySummary`, `createLeaveAction`/`createServiceHolidayAction`, `is_on_leave`/`is_service_holiday`, `addDays` are used identically wherever referenced across tasks.
- **Cross-task interface check:** Task 6/7's leave/holiday queries and Task 10's admin dashboard queries both read `user_leaves`/`service_holidays` with the exact column names Task 1 defines. Task 8's `usersById` join deliberately avoids embedding `user_leaves` with `profiles` in one `.select()` (that relationship has two FK paths — `user_id` and `entered_by` — the same ambiguous-embed class of bug that hit Phase 2/3a three times) by querying the two tables separately and joining in application code, per the Global Constraints.
- **Lesson carried forward:** every zod schema field that can come from an omitted form field (`leaveCreateSchema.reason`) uses `.nullable().optional()`, verified in Task 4 with an explicit test case using `reason: null` (not just an absent key or empty string) to catch the exact failure mode that broke menu creation twice in Phase 2.
- **Deliberate simplification marked:** leave-range overlap prevention is an application-level check-then-insert in `createLeaveAction` (Task 8), not a DB exclusion constraint — noted in the design doc as a ceiling (race under concurrent edits for the same user) with an explicit upgrade path (`btree_gist` exclusion constraint) if that risk ever becomes real.
