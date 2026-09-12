# Multi-Day Thali Selection — Design Spec

**Date:** 2026-09-12
**Status:** Approved for implementation

---

## Goal

Replace the single "tomorrow" thali request card on the dashboard with a multi-day selector that shows all upcoming approved menus, lets users bulk-apply portions then override per day, and enforces a two-day-before cutoff at 6:30 PM.

---

## Out of Scope

- Changes to admin menu creation flow (biweekly cadence is a team process, no UI change)
- New DB tables or schema changes
- Changes to concerns, notifications, leave, or admin reporting

---

## Section 1: Cutoff Change

**Rule:** Cutoff is 2 days before the service date at the configured `cutoff_time`.

Two places enforce this — both change from 1 → 2:

### `src/lib/time/cutoff.ts`

`cutoffInstant` currently subtracts 1 UTC day:
```ts
prevDay.setUTCDate(prevDay.getUTCDate() - 1);
```
Change to subtract 2:
```ts
prevDay.setUTCDate(prevDay.getUTCDate() - 2);
```

### `supabase/migrations/0023_cutoff_two_days.sql`

`is_before_request_cutoff` uses `interval '1 day'`; replace with `interval '2 days'`:
```sql
create or replace function public.is_before_request_cutoff(p_service_date date)
returns boolean language sql security definer set search_path = public as $$
  select now() at time zone 'UTC' <
    ((p_service_date - interval '2 days')::date::text || ' ' ||
     (select value #>> '{}' from public.app_settings where key = 'cutoff_time'))::timestamp
    at time zone (select coalesce(value #>> '{}', 'UTC')
                  from public.app_settings where key = 'timezone')
$$;
```

No RLS policy changes — the same policies still call this function.

---

## Section 2: Dashboard Data Fetching

`src/app/(app)/dashboard/page.tsx` drops the single "tomorrow" fetch and instead:

1. Fetches all approved menus where `service_date >= today`, ordered by date.
2. For each, resolves menu items via `current_approved_version_id → menu_versions → menu_items`.
3. Fetches existing `thali_requests` for the user across those dates.
4. Fetches `user_leaves` and `service_holidays` for those dates (to mark days as unavailable).
5. Passes all of the above to `<MultiDaySelector>`.

Settings fetched: `CUTOFF_TIME`, `TIMEZONE`, `ROTI_MIN_QTY`, `ROTI_MAX_QTY`.
Portion options (`gravyOptions`, `riceOptions`) fetched same as before.

A date is **locked** (read-only) when `!isBeforeCutoff(serviceDate, timezone, cutoffTime)`.
A date is **unavailable** when the user is on leave or it's a service holiday — shown as a disabled card.

---

## Section 3: Multi-Day Selector Component

**File:** `src/components/thali/multi-day-selector.tsx` — `'use client'`

### Props

```ts
interface DayData {
  serviceDate: string;         // YYYY-MM-DD
  menuItems: string[];         // ordered display names
  locked: boolean;             // cutoff passed
  unavailable: boolean;        // on leave or holiday
  existing: {                  // null = no prior submission
    wantsThali: boolean;
    gravyPortionId: string | null;
    ricePortionId: string | null;
    rotiQuantity: number | null;
  } | null;
}

interface Props {
  days: DayData[];
  gravyOptions: { id: string; label: string }[];
  riceOptions:  { id: string; label: string }[];
  rotiMin: number;
  rotiMax: number;
  cutoffTime: string;          // display string e.g. "6:30 PM"
  action: (formData: FormData) => Promise<void>;
}
```

### State

```ts
type DayState = {
  wantsThali: boolean;
  gravyPortionId: string;
  ricePortionId: string;
  rotiQuantity: number;
};
// Keyed by serviceDate. Initialised from existing requests or defaults.
const [dayStates, setDayStates] = useState<Record<string, DayState>>(...);
```

### Bulk Apply

A "Set for all days" section at the top:
- Gravy dropdown, rice dropdown, roti quantity — same controls as the existing ThaliRequestCard
- "Apply to all open days" button updates all non-locked, non-unavailable days in `dayStates`

### Day Rows

Scrollable list. Each row:
- Date label + menu items preview
- Yes/No toggle for `wantsThali`
- "Customise" expand/collapse for per-day portion overrides (only when `wantsThali = true`)
- Locked days: all controls disabled, shows saved choice with a "Closed" badge
- Unavailable days: shows "On leave" or "No service" — no controls

### Submission

A `<form action={action}>` wrapping the whole component. On submit, the hidden input `multiDayRequests` contains `JSON.stringify(activeDayStates)` — an array of `{ serviceDate, wantsThali, gravyPortionId, ricePortionId, rotiQuantity }` for all non-locked, non-unavailable days.

---

## Section 4: Server Action

**`submitMultiDayRequestsAction(formData: FormData)`** in `src/app/(app)/dashboard/actions.ts`

1. Parse `multiDayRequests` JSON array.
2. Validate each entry with zod (reuse/extend `thaliRequestSchema` per date).
3. For each entry, check `isBeforeCutoff` server-side (defence-in-depth; locked days won't be in the payload but this guards against manipulation).
4. Check leave/holiday for each date.
5. Bulk upsert via `supabase.from('thali_requests').upsert(rows, { onConflict: 'user_id,service_date' })`.
6. On any error, `redirect('/dashboard?error=...')`. On success, `redirect('/dashboard')`.

The existing `submitThaliRequestAction` is removed (replaced entirely by the multi-day action).

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/0023_cutoff_two_days.sql` | New — replace cutoff function with 2-day interval |
| `src/lib/time/cutoff.ts` | Modify — `cutoffInstant` subtracts 2 days |
| `src/components/thali/multi-day-selector.tsx` | New — accordion multi-day selection client component |
| `src/app/(app)/dashboard/page.tsx` | Rewrite data fetching + swap `ThaliRequestCard` for `MultiDaySelector` |
| `src/app/(app)/dashboard/actions.ts` | Replace `submitThaliRequestAction` with `submitMultiDayRequestsAction` |

`ThaliRequestCard` component is left in place (still used by other code if any). If unused after this change, it becomes dead code — leave deletion for a cleanup pass.

---

## Accessibility

- Each day row is a `<fieldset>` with a `<legend>` for the date
- Locked badge has `aria-label="Selections closed"`
- Bulk apply button is `type="button"` (not submit)
- Error messages use `role="alert"`
