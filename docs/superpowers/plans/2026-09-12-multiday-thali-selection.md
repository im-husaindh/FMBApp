# Multi-Day Thali Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "tomorrow" thali card with a multi-day accordion selector showing all upcoming approved menus, enforce a two-day-before cutoff, and allow bulk-apply portions with per-day overrides.

**Architecture:** Two-day cutoff is patched in TS (`cutoff.ts`) and DB (new migration). Dashboard fetches all approved menus from today onwards and passes `DayData[]` to a new `MultiDaySelector` client component. A single `submitMultiDayRequestsAction` upserts all changed days at once.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase/Postgres RLS, Zod, Tailwind, `'use client'` React state.

**Spec:** `docs/superpowers/specs/2026-09-12-multiday-thali-selection-design.md`

## Global Constraints

- Strict TypeScript, no `any`.
- FormData fields coming from JSON use `boolean` / `number` / `string | null` directly — not the `z.enum(['true','false'])` pattern used for FormData strings. The new zod schema reflects this.
- `isBeforeCutoff` must never receive a client-supplied clock — always call with `new Date()` on the server.
- Leave/holiday checks happen server-side (defence-in-depth); client only hides controls as UX.
- Migration numbering continues from 0022: next is `0023`.
- `ROTI_MIN_QTY` default `0`, `ROTI_MAX_QTY` default `6`, `CUTOFF_TIME` default `'23:30'`, `TIMEZONE` default `'Asia/Kolkata'`.

---

## File Structure

- `supabase/migrations/0023_cutoff_two_days.sql` — **New**: replaces `is_before_request_cutoff` with 2-day interval
- `src/lib/time/cutoff.ts` — **Modify**: `cutoffInstant` subtracts 2 days instead of 1
- `src/lib/validation/thali-request.ts` — **Modify**: add `multiDayRequestSchema` + `MultiDayRequestItem` type (JSON-typed, not FormData-typed)
- `src/components/thali/multi-day-selector.tsx` — **New**: `'use client'` accordion component
- `src/app/(app)/dashboard/page.tsx` — **Rewrite**: fetch approved menus from today, build `DayData[]`, render `MultiDaySelector`
- `src/app/(app)/dashboard/actions.ts` — **Replace** `submitThaliRequestAction` with `submitMultiDayRequestsAction`

---

### Task 1: DB migration — two-day cutoff

**Files:**
- Create: `supabase/migrations/0023_cutoff_two_days.sql`

**Interfaces:**
- Produces: `is_before_request_cutoff(p_service_date date)` returning `boolean`, now using `interval '2 days'`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/0023_cutoff_two_days.sql
create or replace function public.is_before_request_cutoff(p_service_date date)
returns boolean
language sql
stable
as $$
  select now() < (
    ((p_service_date - interval '2 days')::date::text || ' ' ||
     (select value #>> '{}' from public.app_settings where key = 'cutoff_time'))::timestamp
    at time zone (select value #>> '{}' from public.app_settings where key = 'timezone')
  )
$$;
```

- [ ] **Step 2: Apply migration to local Supabase**

```bash
cd /Users/husain/Downloads/Projects/FMBApp && npx supabase db push
```

Expected: migration applies cleanly; no errors.

- [ ] **Step 3: Verify function updated**

```bash
npx supabase db diff
```

Expected: no pending diff (migration is applied).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0023_cutoff_two_days.sql
git commit -m "feat: change request cutoff to 2 days before service date (DB)"
```

---

### Task 2: TS cutoff — subtract 2 days

**Files:**
- Modify: `src/lib/time/cutoff.ts:37-43`

**Interfaces:**
- Produces: `cutoffInstant(serviceDate, timeZone, cutoffTime): Date` — now returns 2 days before

- [ ] **Step 1: Update `cutoffInstant`**

In `src/lib/time/cutoff.ts`, change the function body:

```ts
export function cutoffInstant(serviceDate: string, timeZone: string, cutoffTime: string): Date {
  const [y, m, d] = serviceDate.split('-').map(Number);
  const twoDaysBefore = new Date(Date.UTC(y, m - 1, d));
  twoDaysBefore.setUTCDate(twoDaysBefore.getUTCDate() - 2);
  const prevDateStr = twoDaysBefore.toISOString().slice(0, 10);
  return zonedTimeToUtc(prevDateStr, cutoffTime, timeZone);
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/husain/Downloads/Projects/FMBApp && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/time/cutoff.ts
git commit -m "feat: change cutoffInstant to subtract 2 days instead of 1"
```

---

### Task 3: Multi-day zod schema

**Files:**
- Modify: `src/lib/validation/thali-request.ts`

**Interfaces:**
- Produces:
  ```ts
  export function multiDayRequestSchema(rotiMin: number, rotiMax: number):
    ZodArray<ZodObject<...>>
  export type MultiDayRequestItem = {
    serviceDate: string;
    wantsThali: boolean;
    gravyPortionId: string | null;
    ricePortionId: string | null;
    rotiQuantity: number | null;
  }
  ```

- [ ] **Step 1: Add schema to `src/lib/validation/thali-request.ts`**

Append to the end of the existing file:

```ts
const singleDayItemSchema = (rotiMin: number, rotiMax: number) =>
  z
    .object({
      serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      wantsThali: z.boolean(),
      gravyPortionId: z.string().nullable(),
      ricePortionId: z.string().nullable(),
      rotiQuantity: z.number().int().nullable(),
    })
    .refine(
      (d) =>
        d.wantsThali
          ? !!d.gravyPortionId &&
            !!d.ricePortionId &&
            d.rotiQuantity !== null &&
            d.rotiQuantity >= rotiMin &&
            d.rotiQuantity <= rotiMax
          : d.gravyPortionId === null && d.ricePortionId === null && d.rotiQuantity === null,
      { message: 'Invalid thali request entry' }
    );

export function multiDayRequestSchema(rotiMin: number, rotiMax: number) {
  return z.array(singleDayItemSchema(rotiMin, rotiMax)).min(1);
}

export type MultiDayRequestItem = {
  serviceDate: string;
  wantsThali: boolean;
  gravyPortionId: string | null;
  ricePortionId: string | null;
  rotiQuantity: number | null;
};
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/husain/Downloads/Projects/FMBApp && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/validation/thali-request.ts
git commit -m "feat: add multiDayRequestSchema for JSON-typed multi-day submission"
```

---

### Task 4: MultiDaySelector client component

**Files:**
- Create: `src/components/thali/multi-day-selector.tsx`

**Interfaces:**
- Consumes: `MultiDayRequestItem` from `@/lib/validation/thali-request` (Task 3)
- Produces: `<MultiDaySelector>` component with props as below

```ts
export interface DayData {
  serviceDate: string;
  menuItems: string[];
  locked: boolean;
  unavailable: boolean;
  unavailableReason: string | null;
  existing: {
    wantsThali: boolean;
    gravyPortionId: string | null;
    ricePortionId: string | null;
    rotiQuantity: number | null;
  } | null;
}

export interface MultiDaySelectorProps {
  days: DayData[];
  gravyOptions: { id: string; label: string }[];
  riceOptions: { id: string; label: string }[];
  rotiMin: number;
  rotiMax: number;
  cutoffTime: string;
  action: (formData: FormData) => Promise<void>;
}
```

- [ ] **Step 1: Create `src/components/thali/multi-day-selector.tsx`**

```tsx
'use client';

import { useState, useRef } from 'react';
import type { MultiDayRequestItem } from '@/lib/validation/thali-request';

export interface DayData {
  serviceDate: string;
  menuItems: string[];
  locked: boolean;
  unavailable: boolean;
  unavailableReason: string | null;
  existing: {
    wantsThali: boolean;
    gravyPortionId: string | null;
    ricePortionId: string | null;
    rotiQuantity: number | null;
  } | null;
}

export interface MultiDaySelectorProps {
  days: DayData[];
  gravyOptions: { id: string; label: string }[];
  riceOptions: { id: string; label: string }[];
  rotiMin: number;
  rotiMax: number;
  cutoffTime: string;
  action: (formData: FormData) => Promise<void>;
}

type DayState = {
  wantsThali: boolean;
  gravyPortionId: string;
  ricePortionId: string;
  rotiQuantity: number;
};

function defaultState(
  existing: DayData['existing'],
  gravyOptions: { id: string }[],
  riceOptions: { id: string }[],
  rotiMin: number
): DayState {
  if (existing?.wantsThali) {
    return {
      wantsThali: true,
      gravyPortionId: existing.gravyPortionId ?? gravyOptions[0]?.id ?? '',
      ricePortionId: existing.ricePortionId ?? riceOptions[0]?.id ?? '',
      rotiQuantity: existing.rotiQuantity ?? rotiMin,
    };
  }
  if (existing && !existing.wantsThali) {
    return {
      wantsThali: false,
      gravyPortionId: gravyOptions[0]?.id ?? '',
      ricePortionId: riceOptions[0]?.id ?? '',
      rotiQuantity: rotiMin,
    };
  }
  return {
    wantsThali: true,
    gravyPortionId: gravyOptions[0]?.id ?? '',
    ricePortionId: riceOptions[0]?.id ?? '',
    rotiQuantity: rotiMin,
  };
}

export function MultiDaySelector({
  days,
  gravyOptions,
  riceOptions,
  rotiMin,
  rotiMax,
  cutoffTime,
  action,
}: MultiDaySelectorProps) {
  const [dayStates, setDayStates] = useState<Record<string, DayState>>(() => {
    const init: Record<string, DayState> = {};
    for (const day of days) {
      init[day.serviceDate] = defaultState(day.existing, gravyOptions, riceOptions, rotiMin);
    }
    return init;
  });

  const [bulkGravy, setBulkGravy] = useState(gravyOptions[0]?.id ?? '');
  const [bulkRice, setBulkRice] = useState(riceOptions[0]?.id ?? '');
  const [bulkRoti, setBulkRoti] = useState(rotiMin);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const openDays = days.filter((d) => !d.locked && !d.unavailable);

  function applyToAll() {
    setDayStates((prev) => {
      const next = { ...prev };
      for (const day of openDays) {
        next[day.serviceDate] = {
          ...next[day.serviceDate],
          gravyPortionId: bulkGravy,
          ricePortionId: bulkRice,
          rotiQuantity: bulkRoti,
        };
      }
      return next;
    });
  }

  function setDayField<K extends keyof DayState>(
    serviceDate: string,
    field: K,
    value: DayState[K]
  ) {
    setDayStates((prev) => ({
      ...prev,
      [serviceDate]: { ...prev[serviceDate], [field]: value },
    }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const payload: MultiDayRequestItem[] = openDays.map((day) => {
      const s = dayStates[day.serviceDate];
      return {
        serviceDate: day.serviceDate,
        wantsThali: s.wantsThali,
        gravyPortionId: s.wantsThali ? s.gravyPortionId : null,
        ricePortionId: s.wantsThali ? s.ricePortionId : null,
        rotiQuantity: s.wantsThali ? s.rotiQuantity : null,
      };
    });
    const fd = new FormData();
    fd.append('multiDayRequests', JSON.stringify(payload));
    await action(fd);
    setPending(false);
  }

  if (days.length === 0) {
    return (
      <p className="mt-6 text-lg text-gray-600">
        No upcoming menus have been approved yet.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Bulk apply */}
      {openDays.length > 0 && (
        <section className="rounded-xl border border-gray-200 p-4">
          <h2 className="text-lg font-semibold">Set for all open days</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Gravy</label>
              <select
                value={bulkGravy}
                onChange={(e) => setBulkGravy(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
              >
                {gravyOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Rice</label>
              <select
                value={bulkRice}
                onChange={(e) => setBulkRice(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
              >
                {riceOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">
                Roti ({rotiMin}–{rotiMax})
              </label>
              <input
                type="number"
                min={rotiMin}
                max={rotiMax}
                value={bulkRoti}
                onChange={(e) => setBulkRoti(Number(e.target.value))}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
              />
            </div>
            <button
              type="button"
              onClick={applyToAll}
              className="w-full rounded-lg bg-gray-800 px-4 py-3 text-base font-semibold text-white"
            >
              Apply to all open days
            </button>
          </div>
        </section>
      )}

      {/* Per-day rows */}
      <form ref={formRef} onSubmit={handleSubmit}>
        <div className="space-y-3">
          {days.map((day) => {
            const s = dayStates[day.serviceDate];
            const isExpanded = expanded[day.serviceDate] ?? false;

            if (day.unavailable) {
              return (
                <fieldset
                  key={day.serviceDate}
                  className="rounded-xl border border-gray-200 p-4 opacity-60"
                >
                  <legend className="text-base font-semibold">{day.serviceDate}</legend>
                  {day.menuItems.length > 0 && (
                    <p className="mt-1 text-sm text-gray-500">{day.menuItems.join(' · ')}</p>
                  )}
                  <p className="mt-2 text-sm text-gray-500">
                    {day.unavailableReason ?? 'Unavailable'}
                  </p>
                </fieldset>
              );
            }

            if (day.locked) {
              return (
                <fieldset
                  key={day.serviceDate}
                  className="rounded-xl border border-gray-200 p-4 opacity-70"
                >
                  <legend className="flex items-center gap-2 text-base font-semibold">
                    {day.serviceDate}
                    <span
                      className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600"
                      aria-label="Selections closed"
                    >
                      Closed
                    </span>
                  </legend>
                  {day.menuItems.length > 0 && (
                    <p className="mt-1 text-sm text-gray-500">{day.menuItems.join(' · ')}</p>
                  )}
                  <p className="mt-2 text-sm text-gray-600">
                    {s.wantsThali
                      ? `Thali requested — cutoff was ${cutoffTime} two days before`
                      : 'No thali'}
                  </p>
                </fieldset>
              );
            }

            return (
              <fieldset
                key={day.serviceDate}
                className="rounded-xl border border-gray-200 p-4"
              >
                <legend className="text-base font-semibold">{day.serviceDate}</legend>
                {day.menuItems.length > 0 && (
                  <p className="mt-1 text-sm text-gray-500">{day.menuItems.join(' · ')}</p>
                )}
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setDayField(day.serviceDate, 'wantsThali', true)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                      s.wantsThali
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300 text-gray-700'
                    }`}
                  >
                    Yes, Thali
                  </button>
                  <button
                    type="button"
                    onClick={() => setDayField(day.serviceDate, 'wantsThali', false)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                      !s.wantsThali
                        ? 'border-gray-800 bg-gray-800 text-white'
                        : 'border-gray-300 text-gray-700'
                    }`}
                  >
                    No Thali
                  </button>
                </div>

                {s.wantsThali && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [day.serviceDate]: !prev[day.serviceDate],
                        }))
                      }
                      className="text-sm text-blue-600 underline"
                    >
                      {isExpanded ? 'Hide portions' : 'Customise portions'}
                    </button>

                    {!isExpanded && (
                      <p className="mt-1 text-sm text-gray-600">
                        {gravyOptions.find((o) => o.id === s.gravyPortionId)?.label ?? '—'} gravy ·{' '}
                        {riceOptions.find((o) => o.id === s.ricePortionId)?.label ?? '—'} rice ·{' '}
                        {s.rotiQuantity} roti
                      </p>
                    )}

                    {isExpanded && (
                      <div className="mt-2 space-y-2">
                        <div>
                          <label className="text-sm font-medium text-gray-700">Gravy</label>
                          <select
                            value={s.gravyPortionId}
                            onChange={(e) =>
                              setDayField(day.serviceDate, 'gravyPortionId', e.target.value)
                            }
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                          >
                            {gravyOptions.map((o) => (
                              <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-700">Rice</label>
                          <select
                            value={s.ricePortionId}
                            onChange={(e) =>
                              setDayField(day.serviceDate, 'ricePortionId', e.target.value)
                            }
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                          >
                            {riceOptions.map((o) => (
                              <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-700">
                            Roti ({rotiMin}–{rotiMax})
                          </label>
                          <input
                            type="number"
                            min={rotiMin}
                            max={rotiMax}
                            value={s.rotiQuantity}
                            onChange={(e) =>
                              setDayField(day.serviceDate, 'rotiQuantity', Number(e.target.value))
                            }
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </fieldset>
            );
          })}
        </div>

        {openDays.length > 0 && (
          <button
            type="submit"
            disabled={pending}
            className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-4 text-xl font-semibold text-white disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save All'}
          </button>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/husain/Downloads/Projects/FMBApp && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/thali/multi-day-selector.tsx
git commit -m "feat: add MultiDaySelector client component"
```

---

### Task 5: Rewrite dashboard page data fetching

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `DayData`, `MultiDaySelectorProps` from `@/components/thali/multi-day-selector` (Task 4)
- Consumes: `submitMultiDayRequestsAction` from `./actions` (written in Task 6 — import will exist by then)
- Consumes: `isBeforeCutoff`, `todayInTimezone` from `@/lib/time/cutoff`

- [ ] **Step 1: Rewrite `src/app/(app)/dashboard/page.tsx`**

```tsx
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { isBeforeCutoff, todayInTimezone } from '@/lib/time/cutoff';
import { submitMultiDayRequestsAction } from './actions';
import {
  MultiDaySelector,
  type DayData,
} from '@/components/thali/multi-day-selector';

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
  const cutoffTime = (settings[SETTINGS_KEYS.CUTOFF_TIME] as string) ?? '23:30';
  const cutoffTimeDisplay = new Date(`1970-01-01T${cutoffTime}`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const rotiMin = (settings[SETTINGS_KEYS.ROTI_MIN_QTY] as number) ?? 0;
  const rotiMax = (settings[SETTINGS_KEYS.ROTI_MAX_QTY] as number) ?? 6;

  const today = todayInTimezone(timezone);

  // Fetch all approved menus from today onwards
  const { data: menus } = await supabase
    .from('menus')
    .select('id, service_date, current_approved_version_id')
    .not('current_approved_version_id', 'is', null)
    .gte('service_date', today)
    .order('service_date', { ascending: true });

  const approvedMenus = menus ?? [];
  const serviceDates = approvedMenus.map((m) => m.service_date);

  // Resolve menu items for each approved version
  const approvedVersionIds = approvedMenus
    .map((m) => m.current_approved_version_id)
    .filter((id): id is string => !!id);

  const { data: versions } = approvedVersionIds.length
    ? await supabase
        .from('menu_versions')
        .select('id, menu_items(item_name, display_order)')
        .in('id', approvedVersionIds)
    : {
        data: [] as {
          id: string;
          menu_items: { item_name: string; display_order: number }[];
        }[],
      };

  const versionsById = new Map((versions ?? []).map((v) => [v.id, v]));

  // Fetch existing thali requests for these dates
  const { data: existingRequests } = serviceDates.length
    ? await supabase
        .from('thali_requests')
        .select('service_date, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
        .eq('user_id', profile.id)
        .in('service_date', serviceDates)
    : { data: [] as { service_date: string; wants_thali: boolean; gravy_portion_id: string | null; rice_portion_id: string | null; roti_quantity: number | null }[] };

  const requestsByDate = new Map(
    (existingRequests ?? []).map((r) => [r.service_date, r])
  );

  // Fetch leave and holiday overlapping these dates
  const [{ data: leaveRows }, { data: holidayRows }] = serviceDates.length
    ? await Promise.all([
        supabase
          .from('user_leaves')
          .select('from_date, to_date, reason')
          .eq('user_id', profile.id)
          .lte('from_date', serviceDates[serviceDates.length - 1])
          .gte('to_date', serviceDates[0]),
        supabase
          .from('service_holidays')
          .select('service_date, reason')
          .in('service_date', serviceDates),
      ])
    : [{ data: [] as { from_date: string; to_date: string; reason: string | null }[] }, { data: [] as { service_date: string; reason: string | null }[] }];

  const holidayReasonByDate = new Map(
    (holidayRows ?? []).map((h) => [h.service_date, h.reason])
  );

  function isOnLeave(serviceDate: string): string | null {
    for (const leave of leaveRows ?? []) {
      if (leave.from_date <= serviceDate && serviceDate <= leave.to_date) {
        return leave.reason ?? 'On leave';
      }
    }
    return null;
  }

  // Fetch portion options
  const [{ data: gravyOptions }, { data: riceOptions }] = await Promise.all([
    supabase
      .from('portion_options')
      .select('id, label')
      .eq('category', 'gravy')
      .eq('active', true)
      .order('sort_order'),
    supabase
      .from('portion_options')
      .select('id, label')
      .eq('category', 'rice')
      .eq('active', true)
      .order('sort_order'),
  ]);

  // Build DayData array
  const days: DayData[] = approvedMenus.map((menu) => {
    const version = menu.current_approved_version_id
      ? versionsById.get(menu.current_approved_version_id)
      : undefined;
    const menuItems = (version?.menu_items ?? [])
      .sort((a, b) => a.display_order - b.display_order)
      .map((i) => i.item_name);

    const locked = !isBeforeCutoff(menu.service_date, timezone, cutoffTime);
    const leaveReason = isOnLeave(menu.service_date);
    const holidayReason = holidayReasonByDate.get(menu.service_date) ?? null;
    const unavailable = leaveReason !== null || holidayReason !== null;
    const unavailableReason = leaveReason ?? (holidayReason ? `No service: ${holidayReason}` : null);

    const req = requestsByDate.get(menu.service_date) ?? null;
    const existing = req
      ? {
          wantsThali: req.wants_thali,
          gravyPortionId: req.gravy_portion_id,
          ricePortionId: req.rice_portion_id,
          rotiQuantity: req.roti_quantity,
        }
      : null;

    return { serviceDate: menu.service_date, menuItems, locked, unavailable, unavailableReason, existing };
  });

  const errorMessage =
    errorParam === 'cutoff_passed'
      ? 'One or more selections could not be saved — the cutoff has passed.'
      : errorParam === 'invalid'
        ? 'Your selection was not saved. Please try again.'
        : errorParam === 'unavailable'
          ? 'One or more dates are unavailable (leave or no-service day).'
          : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Good Morning, {profile.fullName}</h1>

      {errorMessage && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          {errorMessage}
        </p>
      )}

      <h2 className="mt-6 text-2xl font-bold">Upcoming Thali Requests</h2>
      <p className="text-sm text-gray-600">
        Cutoff: {cutoffTimeDisplay}, two days before each service date.
      </p>

      <MultiDaySelector
        days={days}
        gravyOptions={gravyOptions ?? []}
        riceOptions={riceOptions ?? []}
        rotiMin={rotiMin}
        rotiMax={rotiMax}
        cutoffTime={cutoffTimeDisplay}
        action={submitMultiDayRequestsAction}
      />
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/husain/Downloads/Projects/FMBApp && npx tsc --noEmit
```

Expected: errors only for the missing `submitMultiDayRequestsAction` (Task 6 adds it). All other errors must be zero.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/page.tsx
git commit -m "feat: rewrite dashboard to fetch all upcoming approved menus for multi-day selector"
```

---

### Task 6: Replace server action

**Files:**
- Modify: `src/app/(app)/dashboard/actions.ts`

**Interfaces:**
- Consumes: `multiDayRequestSchema`, `MultiDayRequestItem` from `@/lib/validation/thali-request` (Task 3)
- Produces: `submitMultiDayRequestsAction(formData: FormData): Promise<never>`

- [ ] **Step 1: Replace `submitThaliRequestAction` in `src/app/(app)/dashboard/actions.ts`**

Replace the entire file with:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { isBeforeCutoff } from '@/lib/time/cutoff';
import { multiDayRequestSchema } from '@/lib/validation/thali-request';

export async function submitMultiDayRequestsAction(formData: FormData) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const raw = formData.get('multiDayRequests');
  if (typeof raw !== 'string') {
    redirect('/dashboard?error=invalid');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    redirect('/dashboard?error=invalid');
  }

  const settings = await getSettings(supabase, [
    SETTINGS_KEYS.CUTOFF_TIME,
    SETTINGS_KEYS.TIMEZONE,
    SETTINGS_KEYS.ROTI_MIN_QTY,
    SETTINGS_KEYS.ROTI_MAX_QTY,
  ]);
  const cutoffTime = (settings[SETTINGS_KEYS.CUTOFF_TIME] as string) ?? '23:30';
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const rotiMin = (settings[SETTINGS_KEYS.ROTI_MIN_QTY] as number) ?? 0;
  const rotiMax = (settings[SETTINGS_KEYS.ROTI_MAX_QTY] as number) ?? 6;

  const result = multiDayRequestSchema(rotiMin, rotiMax).safeParse(parsed);
  if (!result.success) {
    redirect('/dashboard?error=invalid');
  }

  const items = result.data;

  // Server-side cutoff guard (defence-in-depth; client already filters locked days)
  for (const item of items) {
    if (!isBeforeCutoff(item.serviceDate, timezone, cutoffTime)) {
      redirect('/dashboard?error=cutoff_passed');
    }
  }

  // Leave and holiday checks
  const dates = items.map((i) => i.serviceDate);
  const [{ data: leaveRows }, { data: holidayRows }] = await Promise.all([
    supabase
      .from('user_leaves')
      .select('from_date, to_date')
      .eq('user_id', profile.id)
      .lte('from_date', dates[dates.length - 1])
      .gte('to_date', dates[0]),
    supabase.from('service_holidays').select('service_date').in('service_date', dates),
  ]);

  const holidayDates = new Set((holidayRows ?? []).map((h) => h.service_date));
  for (const item of items) {
    if (holidayDates.has(item.serviceDate)) {
      redirect('/dashboard?error=unavailable');
    }
    for (const leave of leaveRows ?? []) {
      if (leave.from_date <= item.serviceDate && item.serviceDate <= leave.to_date) {
        redirect('/dashboard?error=unavailable');
      }
    }
  }

  // Bulk upsert
  const rows = items.map((item) => ({
    user_id: profile.id,
    service_date: item.serviceDate,
    wants_thali: item.wantsThali,
    gravy_portion_id: item.gravyPortionId,
    rice_portion_id: item.ricePortionId,
    roti_quantity: item.rotiQuantity,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('thali_requests')
    .upsert(rows, { onConflict: 'user_id,service_date' });

  if (error) {
    redirect('/dashboard?error=unavailable');
  }

  redirect('/dashboard');
}
```

- [ ] **Step 2: Type-check the full project**

```bash
cd /Users/husain/Downloads/Projects/FMBApp && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/actions.ts
git commit -m "feat: replace single-day action with submitMultiDayRequestsAction"
```

---

### Task 7: Visual verification

- [ ] **Step 1: Ensure dev server is running at `http://localhost:3000`**

```bash
cd /Users/husain/Downloads/Projects/FMBApp && npm run dev
```

- [ ] **Step 2: Log in as a regular user (`husaindh@fmb.test` / `123456`) and navigate to `/dashboard`**

Verify:
- Page shows "Upcoming Thali Requests" heading
- Cutoff note shows "6:30 PM, two days before each service date" (or configured time)
- Approved menus render as day rows; unapproved menus do not appear
- Days where cutoff has passed show a "Closed" badge and locked controls
- Bulk "Set for all days" section is visible when open days exist

- [ ] **Step 3: Test bulk apply**

- Set gravy/rice/roti in the bulk section
- Click "Apply to all open days"
- Verify each open day row's collapsed summary updates to the chosen portions

- [ ] **Step 4: Test per-day override**

- Click "Customise portions" on one day
- Change its gravy
- Verify only that day changed; others retain the bulk-applied values

- [ ] **Step 5: Test save**

- Click "Save All"
- Verify redirect back to `/dashboard`
- Reload and verify each day row shows the saved selections

- [ ] **Step 6: Test locked day**

- Find a day whose cutoff has passed (service date ≤ today + 1)
- Verify controls are disabled and "Closed" badge is shown
- Verify "Save All" does not include that day in the payload (check Network tab)
