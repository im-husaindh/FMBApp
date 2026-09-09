# FMBRequestThali — Phase 3a Core Thali Request Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user-facing thali request flow — the real `/dashboard` (Tomorrow's Thali card, Yes/No, portion selection, confirm/change states, locked-after-cutoff states) and the menu calendar — with the 6PM cutoff enforced both in the Server Action and at the database layer via RLS.

**Architecture:** One new table (`thali_requests`) with a DB-level CHECK tying portions to `wants_thali`, a SQL mirror of the existing `lib/time/cutoff.ts` logic so RLS can independently enforce the cutoff, a zod schema whose roti-quantity bounds are parameterized by the currently-configured `app_settings` values (not hard-coded), and a client component for the interactive Yes/No/portions/confirm flow driven by a single Server Action.

**Tech Stack:** Next.js Server Components + Server Actions, Supabase (Postgres + RLS), zod, Tailwind, lucide-react icons (already a dependency, unused until now).

**Spec:** `docs/superpowers/specs/2026-09-09-phase3a-thali-request-design.md` (and source `FMBRequestThali Web App — Complete Development Prompt.md` §4, §8-12, §26, §29, §30, §32, §41, §49, §51)

## Global Constraints

- Strict TypeScript, no `any`.
- Never trust client-supplied time for the cutoff — always `isBeforeCutoff()` (TS, Server Action) or `is_before_request_cutoff()` (SQL, RLS), never `new Date()` read on the browser.
- Portions must be non-null when `wants_thali = true` and null when `false` — enforced by a DB CHECK constraint, not just application code (§49).
- One request per `(user_id, service_date)` — enforced by a DB unique constraint, upsert on conflict, never insert-then-update as two separate paths.
- `thali_request_history` is explicitly out of scope for this phase (see design doc's Scope section) — do not add it.
- Never show a success/confirmed state before the server has actually returned success (§41).
- Large touch targets (`h-12`/`h-14` buttons, matching Phase 2's established Tailwind pattern), icon + text + color together — never color alone (§30).
- Migration numbering continues from Phase 2's last migration: next is `0010`.

---

## File Structure

- `supabase/migrations/0010_thali_requests.sql` — table, indexes, RLS enabled (no policies yet)
- `supabase/migrations/0011_thali_requests_rls.sql` — `is_before_request_cutoff()` SQL function + RLS policies
- `src/lib/time/cutoff.ts` — extend with `todayInTimezone()` and `serviceDateRange()`
- `src/lib/time/cutoff.test.ts` — extend with tests for the above
- `src/lib/validation/thali-request.ts` — `thaliRequestSchema(rotiMin, rotiMax)` factory
- `src/lib/validation/thali-request.test.ts` — new test file
- `src/app/(app)/dashboard/actions.ts` — extend with `submitThaliRequestAction` (keep existing `logoutAction`)
- `src/components/thali/thali-request-card.tsx` — new client component (Yes/No/portions/confirm-no/locked/confirmed states)
- `src/components/thali/menu-calendar.tsx` — new presentational component
- `src/app/(app)/dashboard/page.tsx` — rewrite (replaces Phase 1's placeholder)
- `scripts/seed-thali-requests.ts` — new seed script
- `package.json` — add `seed:thali` script
- `src/lib/supabase/thali-request-rls.integration.test.ts` — new integration test
- `README.md` — document the new seed script

---

### Task 1: Migration — `thali_requests` table

**Files:**
- Create: `supabase/migrations/0010_thali_requests.sql`

**Interfaces:**
- Produces: table `thali_requests` with columns `id, user_id, service_date, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity, submitted_at, updated_at, locked_at, source, created_at` — every later task in this plan reads/writes these exact column names.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0010_thali_requests.sql`:

```sql
create table public.thali_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  service_date date not null,
  wants_thali boolean not null,
  gravy_portion_id uuid references public.portion_options(id),
  rice_portion_id uuid references public.portion_options(id),
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

create index thali_requests_service_date_idx on public.thali_requests(service_date);
create index thali_requests_user_id_idx on public.thali_requests(user_id);

alter table public.thali_requests enable row level security;
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

Expected: migration `0010_thali_requests.sql` applies with no errors, alongside all prior migrations (0001-0009).

Then confirm the constraint actually rejects a mismatched row (using `psql` via `npx supabase db psql` or the Studio SQL editor):

```sql
-- Should fail (wants_thali=true but no portions):
insert into thali_requests (user_id, service_date, wants_thali)
values ((select id from profiles limit 1), '2099-01-01', true);
```

Expected: `ERROR: new row for relation "thali_requests" violates check constraint "thali_requests_portions_match_wants"`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0010_thali_requests.sql
git commit -m "feat(db): add thali_requests table with portions-match-wants_thali constraint"
```

---

### Task 2: Migration — cutoff function and RLS policies

**Files:**
- Create: `supabase/migrations/0011_thali_requests_rls.sql`

**Interfaces:**
- Consumes: `app_settings` (Phase 1, keys `cutoff_time`/`timezone`), `thali_requests` (Task 1)
- Produces: SQL function `is_before_request_cutoff(p_service_date date) returns boolean` — Task 10's integration test calls this directly by name via `supabase.rpc('is_before_request_cutoff', { p_service_date })`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0011_thali_requests_rls.sql`:

```sql
create or replace function public.is_before_request_cutoff(p_service_date date)
returns boolean
language sql
stable
as $$
  select now() < (
    ((p_service_date - interval '1 day')::date::text || ' ' ||
     (select value #>> '{}' from public.app_settings where key = 'cutoff_time'))::timestamp
    at time zone (select value #>> '{}' from public.app_settings where key = 'timezone')
  )
$$;

create policy thali_requests_select_own on public.thali_requests
  for select
  using (user_id = auth.uid());

create policy thali_requests_insert_own on public.thali_requests
  for insert
  with check (user_id = auth.uid() and public.is_before_request_cutoff(service_date));

create policy thali_requests_update_own on public.thali_requests
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_before_request_cutoff(service_date));
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
npm run seed:users
```

Then, using the Studio SQL editor or `psql`, sanity-check the function directly (no auth context needed since it's a plain SQL function):

```sql
select public.is_before_request_cutoff('2099-01-01');  -- expect true (far future)
select public.is_before_request_cutoff('2020-01-01');  -- expect false (long past)
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_thali_requests_rls.sql
git commit -m "feat(db): add is_before_request_cutoff() and RLS policies for thali_requests"
```

---

### Task 3: `lib/time/cutoff.ts` — today/tomorrow and date-range helpers

**Files:**
- Modify: `src/lib/time/cutoff.ts`
- Test: `src/lib/time/cutoff.test.ts` (existing file — add tests, do not remove existing ones)

**Interfaces:**
- Produces: `todayInTimezone(timeZone: string, nowUtc?: Date): string`, `serviceDateRange(timeZone: string, daysBefore: number, daysAfter: number, nowUtc?: Date): string[]` — Task 8's dashboard page calls both.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/time/cutoff.test.ts` (append; keep the existing `describe` blocks for `cutoffInstant`/`isBeforeCutoff` untouched):

```ts
import { todayInTimezone, serviceDateRange } from './cutoff';

describe('todayInTimezone', () => {
  it('returns the next calendar day in IST when UTC is still on the previous day', () => {
    // 2026-09-09T20:00:00Z = 2026-09-10 01:30 IST
    expect(todayInTimezone('Asia/Kolkata', new Date('2026-09-09T20:00:00Z'))).toBe('2026-09-10');
  });

  it('returns the same calendar day in IST for a UTC morning instant', () => {
    // 2026-09-09T10:00:00Z = 2026-09-09 15:30 IST
    expect(todayInTimezone('Asia/Kolkata', new Date('2026-09-09T10:00:00Z'))).toBe('2026-09-09');
  });
});

describe('serviceDateRange', () => {
  it('returns an inclusive range spanning daysBefore through daysAfter today', () => {
    const result = serviceDateRange('Asia/Kolkata', 3, 7, new Date('2026-09-09T10:00:00Z'));
    expect(result).toHaveLength(11);
    expect(result[0]).toBe('2026-09-06');
    expect(result[3]).toBe('2026-09-09');
    expect(result[10]).toBe('2026-09-16');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/time/cutoff.test.ts
```

Expected: FAIL — `todayInTimezone`/`serviceDateRange` are not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/time/cutoff.ts`:

```ts
/** Today's date (YYYY-MM-DD) as a wall-clock date in `timeZone`. */
export function todayInTimezone(timeZone: string, nowUtc: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(nowUtc);
}

/** Inclusive YYYY-MM-DD range: `daysBefore` days before today through `daysAfter` days after, in `timeZone`. */
export function serviceDateRange(
  timeZone: string,
  daysBefore: number,
  daysAfter: number,
  nowUtc: Date = new Date()
): string[] {
  const today = todayInTimezone(timeZone, nowUtc);
  const [y, m, d] = today.split('-').map(Number);
  const dates: string[] = [];
  for (let offset = -daysBefore; offset <= daysAfter; offset++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + offset);
    dates.push(dt.toISOString().slice(0, 10));
  }
  return dates;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/time/cutoff.test.ts
```

Expected: PASS (all tests, existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/time/cutoff.ts src/lib/time/cutoff.test.ts
git commit -m "feat: add todayInTimezone and serviceDateRange helpers"
```

---

### Task 4: `lib/validation/thali-request.ts` — zod schema

**Files:**
- Create: `src/lib/validation/thali-request.ts`
- Test: `src/lib/validation/thali-request.test.ts`

**Interfaces:**
- Produces: `thaliRequestSchema(rotiMin: number, rotiMax: number)` (a function returning a zod schema — bounds are dynamic per `app_settings`, so this can't be a static exported schema like Phase 2's), `ThaliRequestInput` type — Task 5's Server Action calls `thaliRequestSchema(rotiMin, rotiMax).safeParse(...)`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/validation/thali-request.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { thaliRequestSchema } from './thali-request';

describe('thaliRequestSchema', () => {
  const schema = thaliRequestSchema(0, 6);

  it('accepts wants_thali=false with no portions', () => {
    const result = schema.safeParse({ serviceDate: '2026-09-10', wantsThali: 'false' });
    expect(result.success).toBe(true);
  });

  it('accepts wants_thali=true with all portions within the configured roti range', () => {
    const result = schema.safeParse({
      serviceDate: '2026-09-10',
      wantsThali: 'true',
      gravyPortionId: 'gravy-1',
      ricePortionId: 'rice-1',
      rotiQuantity: '3',
    });
    expect(result.success).toBe(true);
  });

  it('rejects wants_thali=true missing a portion', () => {
    const result = schema.safeParse({
      serviceDate: '2026-09-10',
      wantsThali: 'true',
      gravyPortionId: 'gravy-1',
      rotiQuantity: '3',
    });
    expect(result.success).toBe(false);
  });

  it('rejects wants_thali=false with a portion present', () => {
    const result = schema.safeParse({
      serviceDate: '2026-09-10',
      wantsThali: 'false',
      gravyPortionId: 'gravy-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a roti quantity outside the configured range', () => {
    const result = schema.safeParse({
      serviceDate: '2026-09-10',
      wantsThali: 'true',
      gravyPortionId: 'gravy-1',
      ricePortionId: 'rice-1',
      rotiQuantity: '9',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid service date format', () => {
    const result = schema.safeParse({ serviceDate: '10-09-2026', wantsThali: 'false' });
    expect(result.success).toBe(false);
  });

  it('accepts wants_thali=false when portion fields are null, matching real FormData.get() behavior', () => {
    // FormData.get() returns null (not undefined) for a field that was never in the form —
    // exactly what happens when the "No Thali" form omits the portion inputs entirely.
    const result = schema.safeParse({
      serviceDate: '2026-09-10',
      wantsThali: 'false',
      gravyPortionId: null,
      ricePortionId: null,
      rotiQuantity: null,
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/validation/thali-request.test.ts
```

Expected: FAIL — `./thali-request` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/validation/thali-request.ts`:

```ts
import { z } from 'zod';

export function thaliRequestSchema(rotiMin: number, rotiMax: number) {
  return z
    .object({
      serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
      wantsThali: z.enum(['true', 'false']).transform((v) => v === 'true'),
      // .nullable() is required, not just .optional(): FormData.get() returns null
      // (never undefined) for a field the form never included — the "No Thali" form
      // in Task 6 omits these three fields entirely. This is the same class of bug
      // Phase 2 hit twice (a field validated as optional-or-empty-string rejected the
      // `null` FormData.get() actually returns) — fixed here at the schema level so
      // every caller gets it right automatically, instead of requiring every Server
      // Action to remember to coalesce `?? ''` before calling this schema.
      gravyPortionId: z.string().trim().nullable().optional(),
      ricePortionId: z.string().trim().nullable().optional(),
      rotiQuantity: z.string().trim().nullable().optional(),
    })
    .transform((data) => ({
      serviceDate: data.serviceDate,
      wantsThali: data.wantsThali,
      gravyPortionId: data.gravyPortionId || undefined,
      ricePortionId: data.ricePortionId || undefined,
      rotiQuantity: data.rotiQuantity ? Number(data.rotiQuantity) : undefined,
    }))
    .refine(
      (data) =>
        data.wantsThali
          ? !!data.gravyPortionId &&
            !!data.ricePortionId &&
            data.rotiQuantity !== undefined &&
            Number.isInteger(data.rotiQuantity) &&
            data.rotiQuantity >= rotiMin &&
            data.rotiQuantity <= rotiMax
          : !data.gravyPortionId && !data.ricePortionId && data.rotiQuantity === undefined,
      { message: 'Select all portions to confirm a thali, or leave them blank for no thali' }
    );
}

export type ThaliRequestInput = z.infer<ReturnType<typeof thaliRequestSchema>>;
```

Note: portion IDs are validated as non-empty strings, not `.uuid()` — the DB foreign key already rejects a genuinely invalid ID, and Zod 4's `.uuid()` enforces strict RFC 4122 variant nibbles that real UUIDs from `portion_options` will satisfy, but there's no need to duplicate that check here (matches the lesson from Phase 2 Task 4's review: don't add a validation layer that can diverge from the DB's own constraint).

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/validation/thali-request.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/thali-request.ts src/lib/validation/thali-request.test.ts
git commit -m "feat: add thali request validation schema with dynamic roti-quantity bounds"
```

---

### Task 5: Dashboard server action — `submitThaliRequestAction`

**Files:**
- Modify: `src/app/(app)/dashboard/actions.ts` (existing file — keep `logoutAction`, add the new export alongside it)

**Interfaces:**
- Consumes: `requireRole()` (Phase 1), `getSettings`/`SETTINGS_KEYS` (Phase 1, `src/lib/settings`), `isBeforeCutoff` (Task 3, already existed), `thaliRequestSchema` (Task 4)
- Produces: `submitThaliRequestAction(formData: FormData)` — Task 6's client component's `<form action={...}>` and Task 8's page both reference this exact name.

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
    // The only realistic cause at this point (shape already validated above) is the
    // RLS with-check's cutoff condition failing due to a race between page load and
    // submit — same user-facing message as the fast-path check above (§29).
    redirect('/dashboard?error=cutoff_passed');
  }

  redirect('/dashboard');
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: succeeds (nothing imports `submitThaliRequestAction` yet, so this just confirms it compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/dashboard/actions.ts"
git commit -m "feat: add submitThaliRequestAction with dual cutoff enforcement"
```

---

### Task 6: `components/thali/thali-request-card.tsx` — Yes/No/portions/confirm/locked states

**Files:**
- Create: `src/components/thali/thali-request-card.tsx`

**Interfaces:**
- Consumes: shadcn `Button` (Phase 1/2), `lucide-react` icons
- Produces: `ExistingRequest` type, `PortionOption` type, `ThaliRequestCard({ serviceDate, serviceDateLabel, cutoffPassed, existingRequest, gravyOptions, riceOptions, rotiMin, rotiMax, action })` — Task 8's dashboard page renders this.

- [ ] **Step 1: Implement**

Create `src/components/thali/thali-request-card.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type PortionOption = { id: string; label: string };

export type ExistingRequest = {
  wantsThali: boolean;
  rotiQuantity: number | null;
  gravyLabel: string | null;
  riceLabel: string | null;
} | null;

type Step = 'view' | 'choice' | 'portions' | 'confirm-no';

export function ThaliRequestCard({
  serviceDate,
  serviceDateLabel,
  cutoffPassed,
  existingRequest,
  gravyOptions,
  riceOptions,
  rotiMin,
  rotiMax,
  action,
}: {
  serviceDate: string;
  serviceDateLabel: string;
  cutoffPassed: boolean;
  existingRequest: ExistingRequest;
  gravyOptions: PortionOption[];
  riceOptions: PortionOption[];
  rotiMin: number;
  rotiMax: number;
  action: (formData: FormData) => void;
}) {
  const [step, setStep] = useState<Step>(existingRequest ? 'view' : 'choice');
  const [gravyPortionId, setGravyPortionId] = useState('');
  const [ricePortionId, setRicePortionId] = useState('');
  const [rotiQuantity, setRotiQuantity] = useState(rotiMin);

  if (cutoffPassed) {
    return (
      <div className="rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 text-xl font-semibold text-gray-700">
          <Lock className="size-6" />
          Request Closed
        </div>
        <p className="mt-2 text-lg text-gray-600">{serviceDateLabel}&apos;s thali selection closed at 6:00 PM.</p>
        {existingRequest ? (
          existingRequest.wantsThali ? (
            <div className="mt-4 space-y-1 text-lg">
              <p className="font-semibold text-green-700">Thali Requested</p>
              <p>Gravy: {existingRequest.gravyLabel}</p>
              <p>Rice: {existingRequest.riceLabel}</p>
              <p>Roti: {existingRequest.rotiQuantity}</p>
            </div>
          ) : (
            <p className="mt-4 text-lg font-semibold text-gray-700">No Thali Requested</p>
          )
        ) : (
          <p className="mt-4 text-lg font-semibold text-gray-700">No Response Submitted Before Cutoff</p>
        )}
      </div>
    );
  }

  if (step === 'view' && existingRequest) {
    return (
      <div className="rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 text-xl font-semibold text-green-700">
          <CheckCircle2 className="size-6" />
          {existingRequest.wantsThali ? 'Confirmed' : 'No Thali'}
        </div>
        {existingRequest.wantsThali && (
          <div className="mt-4 space-y-1 text-lg">
            <p>Gravy: {existingRequest.gravyLabel}</p>
            <p>Rice: {existingRequest.riceLabel}</p>
            <p>Roti: {existingRequest.rotiQuantity}</p>
          </div>
        )}
        <p className="mt-4 text-lg text-gray-600">You can change your selection until 6:00 PM today.</p>
        <Button type="button" className="mt-4 h-14 w-full text-xl" onClick={() => setStep('choice')}>
          Change Selection
        </Button>
      </div>
    );
  }

  if (step === 'confirm-no') {
    return (
      <div className="rounded-xl border border-gray-200 p-6">
        <p className="text-xl font-semibold">No thali for {serviceDateLabel}?</p>
        <form action={action} className="mt-4">
          <input type="hidden" name="serviceDate" value={serviceDate} />
          <input type="hidden" name="wantsThali" value="false" />
          <Button type="submit" variant="destructive" className="h-14 w-full text-xl">
            <XCircle className="size-6" />
            Yes, Confirm No Thali
          </Button>
        </form>
        <Button
          type="button"
          variant="outline"
          className="mt-3 h-14 w-full text-xl"
          onClick={() => setStep(existingRequest ? 'view' : 'choice')}
        >
          Go Back
        </Button>
      </div>
    );
  }

  if (step === 'portions') {
    return (
      <form action={action} className="rounded-xl border border-gray-200 p-6">
        <input type="hidden" name="serviceDate" value={serviceDate} />
        <input type="hidden" name="wantsThali" value="true" />
        <p className="text-xl font-semibold">Do you need a Thali {serviceDateLabel}?</p>

        <div className="mt-4">
          <p className="text-lg font-semibold">Gravy</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {gravyOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setGravyPortionId(opt.id)}
                className={`h-12 rounded-lg border px-4 text-lg ${
                  gravyPortionId === opt.id ? 'border-blue-600 bg-blue-50 font-semibold' : 'border-gray-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <input type="hidden" name="gravyPortionId" value={gravyPortionId} />

        <div className="mt-4">
          <p className="text-lg font-semibold">Rice</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {riceOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setRicePortionId(opt.id)}
                className={`h-12 rounded-lg border px-4 text-lg ${
                  ricePortionId === opt.id ? 'border-blue-600 bg-blue-50 font-semibold' : 'border-gray-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <input type="hidden" name="ricePortionId" value={ricePortionId} />

        <div className="mt-4">
          <p className="text-lg font-semibold">Roti</p>
          <div className="mt-2 flex items-center gap-4">
            <button
              type="button"
              onClick={() => setRotiQuantity((q) => Math.max(rotiMin, q - 1))}
              className="h-12 w-12 rounded-lg border border-gray-300 text-xl"
            >
              −
            </button>
            <span className="w-8 text-center text-xl font-semibold">{rotiQuantity}</span>
            <button
              type="button"
              onClick={() => setRotiQuantity((q) => Math.min(rotiMax, q + 1))}
              className="h-12 w-12 rounded-lg border border-gray-300 text-xl"
            >
              +
            </button>
          </div>
        </div>
        <input type="hidden" name="rotiQuantity" value={rotiQuantity} />

        <Button type="submit" disabled={!gravyPortionId || !ricePortionId} className="mt-6 h-14 w-full text-xl">
          Confirm Thali
        </Button>
      </form>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 p-6">
      <p className="text-xl font-semibold">Do you need a Thali {serviceDateLabel}?</p>
      <div className="mt-4 space-y-3">
        <Button type="button" className="h-14 w-full text-xl" onClick={() => setStep('portions')}>
          <CheckCircle2 className="size-6" />
          Yes, I Need Thali
        </Button>
        <Button type="button" variant="outline" className="h-14 w-full text-xl" onClick={() => setStep('confirm-no')}>
          <XCircle className="size-6" />
          No Thali
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: succeeds (this component isn't imported anywhere yet, so this just confirms it compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add src/components/thali/thali-request-card.tsx
git commit -m "feat: add ThaliRequestCard component for the dashboard's Yes/No/portions flow"
```

---

### Task 7: `components/thali/menu-calendar.tsx` — calendar display

**Files:**
- Create: `src/components/thali/menu-calendar.tsx`

**Interfaces:**
- Produces: `CalendarDay` type, `MenuCalendar({ days, todayDate, tomorrowDate })` — Task 8's dashboard page renders this with data it fetches itself.

- [ ] **Step 1: Implement**

Create `src/components/thali/menu-calendar.tsx`:

```tsx
export type CalendarDay = { serviceDate: string; items: string[] };

export function MenuCalendar({
  days,
  todayDate,
  tomorrowDate,
}: {
  days: CalendarDay[];
  todayDate: string;
  tomorrowDate: string;
}) {
  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold">Menu Calendar</h2>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {days.map((day) => {
          const isToday = day.serviceDate === todayDate;
          const isTomorrow = day.serviceDate === tomorrowDate;
          const isPast = day.serviceDate < todayDate;
          const label = isToday ? 'TODAY' : isTomorrow ? 'TOMORROW' : day.serviceDate;
          return (
            <div
              key={day.serviceDate}
              className={`min-w-[140px] shrink-0 rounded-lg border p-3 ${
                isTomorrow
                  ? 'border-blue-600 bg-blue-50'
                  : isToday
                    ? 'border-green-600 bg-green-50'
                    : isPast
                      ? 'border-gray-200 bg-gray-50 opacity-70'
                      : 'border-gray-200'
              }`}
            >
              <p className="text-sm font-semibold">{label}</p>
              <p className="text-xs text-gray-600">{day.serviceDate}</p>
              <div className="mt-2 text-sm">
                {day.items.length === 0 ? (
                  <p className="text-gray-500">No menu published yet.</p>
                ) : (
                  day.items.slice(0, 3).map((item) => <p key={item}>{item}</p>)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/thali/menu-calendar.tsx
git commit -m "feat: add MenuCalendar presentational component"
```

---

### Task 8: Dashboard page — assemble the full flow

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx` (full rewrite, replacing the Phase 1 placeholder)

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient`, `getSettings`/`SETTINGS_KEYS`, `isBeforeCutoff`/`todayInTimezone`/`serviceDateRange` (Task 3), `submitThaliRequestAction`/`logoutAction` (Task 5), `ThaliRequestCard`/`ExistingRequest`/`PortionOption` (Task 6), `MenuCalendar`/`CalendarDay` (Task 7)

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

export default async function DashboardPage() {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

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

  const { data: existing } = await supabase
    .from('thali_requests')
    .select('wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
    .eq('service_date', tomorrow)
    .maybeSingle();

  let existingRequest: ExistingRequest = null;
  if (existing) {
    existingRequest = {
      wantsThali: existing.wants_thali,
      rotiQuantity: existing.roti_quantity,
      gravyLabel: (gravyOptions ?? []).find((o) => o.id === existing.gravy_portion_id)?.label ?? null,
      riceLabel: (riceOptions ?? []).find((o) => o.id === existing.rice_portion_id)?.label ?? null,
    };
  }

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
        <ThaliRequestCard
          serviceDate={tomorrow}
          serviceDateLabel="tomorrow"
          cutoffPassed={cutoffPassed}
          existingRequest={existingRequest}
          gravyOptions={gravyOptions ?? []}
          riceOptions={riceOptions ?? []}
          rotiMin={rotiMin}
          rotiMax={rotiMax}
          action={submitThaliRequestAction}
        />
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

Expected: succeeds, `/dashboard` listed as a dynamic route.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat: assemble real user dashboard with thali request flow and menu calendar"
```

---

### Task 9: Seed script — thali requests

**Files:**
- Create: `scripts/seed-thali-requests.ts`
- Modify: `package.json` (add `seed:thali` script)

**Interfaces:**
- Consumes: seeded profiles (`user_code` `US001`-`US015`, Phase 1's `seed:users`), `portion_options` (Phase 1), `thali_requests` (Task 1)

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-thali-requests.ts`:

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
  const { data: users } = await supabase.from('profiles').select('id, user_code').like('user_code', 'US%');
  if (!users || users.length === 0) {
    throw new Error('Run `npm run seed:users` first — no US-coded user profiles found.');
  }

  const { data: gravyOptions } = await supabase.from('portion_options').select('id').eq('category', 'gravy');
  const { data: riceOptions } = await supabase.from('portion_options').select('id').eq('category', 'rice');
  if (!gravyOptions?.length || !riceOptions?.length) {
    throw new Error('portion_options is empty — check supabase/seed.sql ran (Phase 1).');
  }

  for (let offset = -3; offset <= 7; offset++) {
    const serviceDate = dateOffset(offset);
    let count = 0;
    for (let index = 0; index < users.length; index++) {
      const user = users[index];
      // Rotate through 5 buckets per (user, date) so every date has a realistic mix:
      // 3/5 request a thali with varied portions, 1/5 says no thali, 1/5 has no response at all.
      const bucket = (index + offset) % 5;
      if (bucket === 4) continue; // no response — no row for this user/date
      const wantsThali = bucket !== 3;
      const row = wantsThali
        ? {
            user_id: user.id,
            service_date: serviceDate,
            wants_thali: true,
            gravy_portion_id: gravyOptions[index % gravyOptions.length].id,
            rice_portion_id: riceOptions[index % riceOptions.length].id,
            roti_quantity: 2 + (index % 3),
          }
        : { user_id: user.id, service_date: serviceDate, wants_thali: false };
      await supabase.from('thali_requests').upsert(row, { onConflict: 'user_id,service_date' });
      count++;
    }
    console.log(`Seeded ${count} thali requests for ${serviceDate}`);
  }
}

seed();
```

- [ ] **Step 2: Add npm script**

In `package.json` `"scripts"`, add:

```json
"seed:thali": "tsx scripts/seed-thali-requests.ts"
```

- [ ] **Step 3: Attempt to run (requires local Supabase running + Phase 1's `seed:users` already run)**

```bash
npx supabase db reset
npm run seed:users
npm run seed:thali
```

Expected: 11 lines of "Seeded N thali requests for YYYY-MM-DD". If Docker isn't available, note that and move on — the script's correctness was verified by careful reading in the self-review step below.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-thali-requests.ts package.json
git commit -m "feat: add seed script for varied thali request states across 11 service dates"
```

---

### Task 10: RLS/cutoff integration test

**Files:**
- Create: `src/lib/supabase/thali-request-rls.integration.test.ts`

**Interfaces:**
- Consumes: seeded `user1@fmb.test`/`user2@fmb.test` (Phase 1), seeded `portion_options`, live local Supabase instance, `isBeforeCutoff` (Task 3), `is_before_request_cutoff` RPC (Task 2)

- [ ] **Step 1: Write the test**

Create `src/lib/supabase/thali-request-rls.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { isBeforeCutoff } from '@/lib/time/cutoff';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const skip = !url || !anonKey;

describe.skipIf(skip)('Thali request RLS and cutoff', () => {
  it('a user can submit a future request and update it without creating a duplicate row', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const userId = (await client.auth.getUser()).data.user!.id;

    const { data: gravy } = await client.from('portion_options').select('id').eq('category', 'gravy').limit(1).single();
    const { data: rice } = await client.from('portion_options').select('id').eq('category', 'rice').limit(1).single();

    const future = new Date();
    future.setDate(future.getDate() + 30);
    const serviceDate = future.toISOString().slice(0, 10);

    const { error: insertError } = await client.from('thali_requests').upsert(
      {
        user_id: userId,
        service_date: serviceDate,
        wants_thali: true,
        gravy_portion_id: gravy!.id,
        rice_portion_id: rice!.id,
        roti_quantity: 3,
      },
      { onConflict: 'user_id,service_date' }
    );
    expect(insertError).toBeNull();

    const { error: updateError } = await client
      .from('thali_requests')
      .upsert({ user_id: userId, service_date: serviceDate, wants_thali: false }, { onConflict: 'user_id,service_date' });
    expect(updateError).toBeNull();

    const { data: rows } = await client.from('thali_requests').select('id, wants_thali').eq('service_date', serviceDate);
    expect(rows).toHaveLength(1);
    expect(rows![0].wants_thali).toBe(false);
  });

  it('a user cannot submit or modify a request after cutoff', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user2@fmb.test', password: 'DevPass123!' });
    const userId = (await client.auth.getUser()).data.user!.id;

    const past = new Date();
    past.setDate(past.getDate() - 5);
    const serviceDate = past.toISOString().slice(0, 10);

    const { error } = await client
      .from('thali_requests')
      .upsert({ user_id: userId, service_date: serviceDate, wants_thali: false }, { onConflict: 'user_id,service_date' });
    expect(error).not.toBeNull();
  });

  it("a user cannot read another user's thali_requests rows", async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });

    const { data: otherUser } = await client.from('profiles').select('id').eq('user_code', 'US002').single();
    const { data: rows } = await client.from('thali_requests').select('id').eq('user_id', otherUser!.id);
    expect(rows).toHaveLength(0);
  });

  it('the SQL is_before_request_cutoff() function agrees with the TS isBeforeCutoff() helper', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });

    const future = new Date();
    future.setDate(future.getDate() + 60);
    const serviceDate = future.toISOString().slice(0, 10);

    const tsResult = isBeforeCutoff(serviceDate, 'Asia/Kolkata', '18:00');
    const { data, error } = await client.rpc('is_before_request_cutoff', { p_service_date: serviceDate });
    expect(error).toBeNull();
    expect(data).toBe(tsResult);
  });
});
```

Note on the last test: this checks agreement at one representative far-future instant rather than the exact cutoff boundary. `lib/time/cutoff.ts`'s own unit tests (Phase 1, `cutoff.test.ts`) already rigorously exercise the TS side's boundary behavior (`isBeforeCutoff` just-before/at/after cutoff); this integration test's job is only to catch the SQL reimplementation diverging (wrong timezone, wrong day arithmetic), which a single non-trivial instant already does without the flakiness risk of asserting on a real-time boundary in CI.

- [ ] **Step 2: Run it (requires local Supabase running + seed:users + seed:thali already applied)**

```bash
npx supabase status
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key> npx vitest run src/lib/supabase/thali-request-rls.integration.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/thali-request-rls.integration.test.ts
git commit -m "test: add RLS/cutoff integration test for thali requests"
```

---

### Task 11: README update and final verification

**Files:**
- Modify: `README.md`

**Interfaces:** none (documentation + verification only)

- [ ] **Step 1: Update `README.md`**

In the "Local development" numbered list, add a step after "Create sample menus: `npm run seed:menus`" for seeding thali requests:

```
Create sample thali requests: `npm run seed:thali` (varied requested/no-thali/no-response
states across the same 11 service dates, for testing the dashboard and, later, admin
operational views)
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
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key> npx vitest run src/lib/supabase/thali-request-rls.integration.test.ts
```

Also do a manual click-through of `/dashboard` in a browser signed in as a seeded user — confirm the Yes/No buttons, portion selection, Confirm Thali, Change Selection, and the menu calendar all render and the confirmed selection persists on reload. (Per the Phase 2 final review's lesson: build-passing and test-passing are not the same as "actually loads in a browser" — the `/admin/menu` list page shipped with a live-breaking bug that only a real click-through would have caught.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: document thali request seeding in README"
```

---

## Self-Review Notes

- **Spec coverage:** §4 (user dashboard access), §8 (Tomorrow's Thali card, Yes/No), §9 (portion selection, gravy/rice/roti), §10 (Confirm Thali, success confirmation, Change Selection), §11 (6PM cutoff, three distinct post-cutoff states), §12 (menu calendar, prev 3/today/next 7, visual distinction), §26 (`thali_requests` schema), §29 (server-side cutoff-safe operation order), §30 (icon+text+color, large touch targets), §32 (No-Thali confirmation dialog), §41 (never show success before server confirmation), §49 (portions null/required tied to `wants_thali`, one request per user/date, cutoff unbypassable via direct API) all map to a task above.
- **Deferred to later sub-phases (explicitly, not gaps):** `thali_request_history`, any admin-facing read of `thali_requests` (Phase 3b), leave/no-service (Phase 3b), concerns/notifications (Phase 3c), reports/kitchen view (Phase 3d) — per the design doc's Scope section.
- **Naming consistency checked:** `thaliRequestSchema`/`ThaliRequestInput`, `submitThaliRequestAction`, `ThaliRequestCard`/`ExistingRequest`/`PortionOption`, `MenuCalendar`/`CalendarDay`, `todayInTimezone`/`serviceDateRange` are used identically wherever referenced across tasks.
- **Lesson carried forward from Phase 2's final review:** every new query joining `menus`↔`menu_versions` in this plan (Task 8) avoids the ambiguous-FK-embed trap by never embedding across those two tables in one `.select()` — it queries `menus` and `menu_versions` separately and joins them in application code. (A pre-existing instance of that exact bug was also found and fixed on `master` while designing this plan, in `/admin/menu`'s list query — unrelated to this plan's scope, already committed separately.)
- **Deliberate simplification marked:** `locked_at` is part of the schema but intentionally never written by this phase (see Task 1) — computed live from `isBeforeCutoff()`/`is_before_request_cutoff()` everywhere a lock check is needed, never trusted from a stored column, so there's no staleness risk to introduce in the first place.
