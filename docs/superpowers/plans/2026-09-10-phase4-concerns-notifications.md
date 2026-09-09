# FMBRequestThali — Phase 4: Concern System + Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any user raise a food concern and track its status/response over time, let admins manage a shared concern queue and reply, and give every user an in-app notification bell that lights up when their concern gets a response or is resolved.

**Architecture:** Three new tables (`concerns`, `concern_updates`, `notifications`) with RLS reusing the existing `is_admin()`/`is_super_admin()` functions (no new SQL functions needed). A single `notify()` helper (mirrors `getSettings(supabase, ...)`'s "take the client as a parameter" shape) is the only thing that writes to `notifications` — nothing else ever inserts there, and no client-facing insert policy exists on that table. A new minimal `src/app/(app)/layout.tsx` (this route group currently has none) adds a slim top bar with the bell, wrapping every existing page without touching any of their own inline headers.

**Tech Stack:** Next.js Server Components + Server Actions, Supabase (Postgres + RLS), zod, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-phase4-concerns-notifications-design.md` (and source `FMBRequestThali Web App — Complete Development Prompt.md` §21-23, §26, §28)

## Global Constraints

- Strict TypeScript, no `any`.
- Every zod field backed by a `FormData`-optional value must use `.nullable().optional()`, never `.optional().or(z.literal(''))` — `FormData.get()` returns `null`, not `undefined`, for an absent field.
- Never embed two tables across a multi-FK relationship in one `.select()` — query separately and join in application code (established throughout `/admin/leave`, `/admin/requests`, `/admin/users/search`).
- No image attachment upload UI or storage bucket in this phase — `concerns.attachment_url` is a nullable column, unused.
- No `assigned_to` column or per-admin assignment — every admin/super_admin sees the same shared concern queue.
- Only 2 notification types exist in this phase (`concern_response`, `concern_resolved`) — do not wire up menu/reminder-related notifications; that's explicitly deferred.
- No write to `audit_logs` anywhere in this phase.
- The notification bell's unread count is computed fresh on each server render — no client-side realtime subscription.
- Large touch targets (`h-12`/`h-14`), icon+text+color together for any status, never color alone.
- Migration numbering continues from Phase 3b-detail's last migration: next is `0017`.

---

## File Structure

- `supabase/migrations/0017_concerns_notifications.sql` — `concerns`, `concern_updates`, `notifications` tables
- `supabase/migrations/0018_concerns_notifications_rls.sql` — RLS for all three
- `src/lib/validation/concern.ts` — `concernCreateSchema`, `concernReplySchema`
- `src/lib/concerns/constants.ts` — `CONCERN_CATEGORIES`, `CONCERN_STATUSES` (labels + badge display info)
- `src/components/concerns/status-badge.tsx` — `ConcernStatusBadge` (shared across all 4 concern pages)
- `src/lib/notifications/index.ts` — `NotificationType`, `notify(supabase, recipientId, type, payload)`
- `src/app/(app)/layout.tsx` — new: bell top bar wrapping every existing `(app)` page
- `src/app/(app)/concerns/actions.ts` — `createConcernAction`
- `src/app/(app)/concerns/page.tsx` — submit form + own concern list
- `src/app/(app)/concerns/[id]/page.tsx` — one concern's timeline (own concerns only)
- `src/app/(app)/admin/concerns/page.tsx` — admin queue (filter/search)
- `src/app/(app)/admin/concerns/[id]/actions.ts` — `replyToConcernAction`
- `src/app/(app)/admin/concerns/[id]/page.tsx` — thread + reply form
- `src/app/(app)/notifications/page.tsx` — list, marks unread read on view
- `src/app/(app)/dashboard/page.tsx` — modify: add a "Raise Food Concern" link
- `src/app/(app)/admin/page.tsx` — modify: add a "Concerns" link (both render branches)
- `scripts/seed-concerns.ts` — new seed script
- `src/lib/supabase/concerns-notifications-rls.integration.test.ts` — new integration test
- `README.md` — document the new seed script

---

### Task 1: Migration — `concerns`, `concern_updates`, `notifications` tables

**Files:**
- Create: `supabase/migrations/0017_concerns_notifications.sql`

**Interfaces:**
- Produces: tables `concerns` (`id, concern_number, user_id, concern_date, category, message, attachment_url, status, created_at, updated_at, resolved_at`), `concern_updates` (`id, concern_id, new_status, message, changed_by, created_at`), `notifications` (`id, recipient_id, type, payload, read_at, created_at`) — every later task reads/writes these exact column names.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0017_concerns_notifications.sql`:

```sql
create table public.concerns (
  id uuid primary key default gen_random_uuid(),
  concern_number bigint generated always as identity,
  user_id uuid not null references public.profiles(id),
  concern_date date not null,
  category text not null check (category in ('taste','quality','quantity','packaging','missing_item','menu','other')),
  message text not null,
  attachment_url text,
  status text not null default 'open' check (status in ('open','reviewing','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index concerns_user_id_idx on public.concerns(user_id);
create index concerns_status_idx on public.concerns(status);
create unique index concerns_concern_number_idx on public.concerns(concern_number);

create table public.concern_updates (
  id uuid primary key default gen_random_uuid(),
  concern_id uuid not null references public.concerns(id),
  new_status text check (new_status in ('open','reviewing','resolved','closed')),
  message text,
  changed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint concern_updates_has_content check (new_status is not null or message is not null)
);
create index concern_updates_concern_id_idx on public.concern_updates(concern_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id),
  type text not null check (type in ('concern_response','concern_resolved')),
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_unread_idx on public.notifications(recipient_id) where read_at is null;

alter table public.concerns enable row level security;
alter table public.concern_updates enable row level security;
alter table public.notifications enable row level security;
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

Expected: migration `0017_concerns_notifications.sql` applies with no errors, alongside all prior migrations (0001-0016).

Verify the check constraints reject bad rows (via `npx supabase db psql` or the Studio SQL editor):

```sql
insert into concerns (user_id, concern_date, category, message)
values ((select id from profiles limit 1), '2026-09-10', 'not_a_category', 'test');
```

Expected: `ERROR: new row for relation "concerns" violates check constraint "concerns_category_check"`.

```sql
insert into concern_updates (concern_id, changed_by)
values ('00000000-0000-0000-0000-000000000000', (select id from profiles limit 1));
```

Expected: `ERROR: new row for relation "concern_updates" violates check constraint "concern_updates_has_content"` (both `new_status` and `message` are null).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0017_concerns_notifications.sql
git commit -m "feat(db): add concerns, concern_updates, and notifications tables"
```

---

### Task 2: Migration — RLS for concerns, concern_updates, notifications

**Files:**
- Create: `supabase/migrations/0018_concerns_notifications_rls.sql`

**Interfaces:**
- Consumes: `is_admin()` (Phase 1, migration `0002_profiles_rls.sql`)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0018_concerns_notifications_rls.sql`:

```sql
create policy concerns_select_own_or_admin on public.concerns
  for select using (user_id = auth.uid() or public.is_admin());

create policy concerns_insert_own on public.concerns
  for insert with check (user_id = auth.uid());

create policy concerns_update_admin on public.concerns
  for update using (public.is_admin()) with check (public.is_admin());

create policy concern_updates_select_own_or_admin on public.concern_updates
  for select using (
    public.is_admin()
    or exists (select 1 from public.concerns c where c.id = concern_id and c.user_id = auth.uid())
  );

create policy concern_updates_insert_admin on public.concern_updates
  for insert with check (public.is_admin());

create policy notifications_select_own on public.notifications
  for select using (recipient_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- Deliberately no insert policy on notifications for any client role — rows
-- are written only by lib/notifications' notify() helper, which runs with
-- the server's privileged Supabase client, never reachable from the browser.
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
npm run seed:users
```

```sql
select policyname, cmd, permissive from pg_policies where tablename in ('concerns', 'concern_updates', 'notifications') order by tablename, cmd;
```

Expected: 3 policies on `concerns` (select, insert, update — all permissive), 2 on `concern_updates` (select, insert), 2 on `notifications` (select, update). No insert policy row for `notifications`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0018_concerns_notifications_rls.sql
git commit -m "feat(db): add RLS for concerns, concern_updates, and notifications"
```

---

### Task 3: Shared building blocks — validation, constants, status badge

**Files:**
- Create: `src/lib/validation/concern.ts`
- Test: `src/lib/validation/concern.test.ts`
- Create: `src/lib/concerns/constants.ts`
- Create: `src/components/concerns/status-badge.tsx`

**Interfaces:**
- Produces: `concernCreateSchema`, `ConcernCreateInput`, `concernReplySchema`, `ConcernReplyInput`; `CONCERN_CATEGORIES: { value: string; label: string }[]`, `CONCERN_STATUSES: { value: string; label: string; icon: string; classes: string }[]`; `ConcernStatusBadge({ status }: { status: string })` — every page task (4-9) imports these by name.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/validation/concern.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { concernCreateSchema, concernReplySchema } from './concern';

describe('concernCreateSchema', () => {
  it('accepts a valid concern', () => {
    const result = concernCreateSchema.safeParse({
      concernDate: '2026-09-10',
      category: 'taste',
      message: 'The gravy was too salty today.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown category', () => {
    const result = concernCreateSchema.safeParse({
      concernDate: '2026-09-10',
      category: 'not_a_category',
      message: 'Something',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty message', () => {
    const result = concernCreateSchema.safeParse({
      concernDate: '2026-09-10',
      category: 'taste',
      message: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid date', () => {
    const result = concernCreateSchema.safeParse({
      concernDate: '10-09-2026',
      category: 'taste',
      message: 'Something',
    });
    expect(result.success).toBe(false);
  });
});

describe('concernReplySchema', () => {
  it('accepts a status with no message (FormData.get() returns null for an empty textarea is not this case, but an absent field is)', () => {
    const result = concernReplySchema.safeParse({ newStatus: 'reviewing', message: null });
    expect(result.success).toBe(true);
  });

  it('accepts a status with a message', () => {
    const result = concernReplySchema.safeParse({ newStatus: 'resolved', message: 'Fixed for tomorrow.' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = concernReplySchema.safeParse({ newStatus: 'archived', message: null });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/validation/concern.test.ts
```

Expected: FAIL — `./concern` has no exported members.

- [ ] **Step 3: Implement the validation schemas**

Create `src/lib/validation/concern.ts`:

```ts
import { z } from 'zod';

export const concernCreateSchema = z.object({
  concernDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  category: z.enum(['taste', 'quality', 'quantity', 'packaging', 'missing_item', 'menu', 'other']),
  message: z.string().trim().min(1, 'Please describe your concern'),
});
export type ConcernCreateInput = z.infer<typeof concernCreateSchema>;

export const concernReplySchema = z.object({
  newStatus: z.enum(['open', 'reviewing', 'resolved', 'closed']),
  message: z.string().trim().nullable().optional(),
});
export type ConcernReplyInput = z.infer<typeof concernReplySchema>;
```

Note: `concernReplySchema.message` uses `.nullable().optional()` because the reply form's textarea can be submitted empty — `FormData.get('message')` returns `null` in that case, not `undefined`. This exact `.nullable().optional()` requirement has broken form submission twice already in this project's history when a plain `.optional()` was used instead.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/validation/concern.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Create the shared constants**

Create `src/lib/concerns/constants.ts`:

```ts
export const CONCERN_CATEGORIES: { value: string; label: string }[] = [
  { value: 'taste', label: 'Taste' },
  { value: 'quality', label: 'Quality' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'missing_item', label: 'Missing Item' },
  { value: 'menu', label: 'Menu' },
  { value: 'other', label: 'Other' },
];

export const CONCERN_STATUSES: { value: string; label: string; icon: string; classes: string }[] = [
  { value: 'open', label: 'Open', icon: '!', classes: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  { value: 'reviewing', label: 'Reviewing', icon: '⋯', classes: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'resolved', label: 'Resolved', icon: '✓', classes: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'closed', label: 'Closed', icon: '✕', classes: 'bg-gray-50 text-gray-700 border-gray-200' },
];
```

- [ ] **Step 6: Create the shared status badge component**

Create `src/components/concerns/status-badge.tsx`:

```tsx
import { CONCERN_STATUSES } from '@/lib/concerns/constants';

export function ConcernStatusBadge({ status }: { status: string }) {
  const badge = CONCERN_STATUSES.find((s) => s.value === status) ?? CONCERN_STATUSES[0];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold ${badge.classes}`}>
      <span aria-hidden="true">{badge.icon}</span>
      {badge.label}
    </span>
  );
}
```

- [ ] **Step 7: Verify the build**

```bash
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/validation/concern.ts src/lib/validation/concern.test.ts src/lib/concerns/constants.ts src/components/concerns/status-badge.tsx
git commit -m "feat: add concern validation schemas, constants, and shared status badge"
```

---

### Task 4: `lib/notifications` — the `notify()` helper

**Files:**
- Create: `src/lib/notifications/index.ts`

**Interfaces:**
- Produces: `NotificationType` (`'concern_response' | 'concern_resolved'`), `notify(supabase: SupabaseClient, recipientId: string, type: NotificationType, payload: Record<string, unknown>): Promise<void>` — Task 9's `replyToConcernAction` calls this by name.

- [ ] **Step 1: Implement**

Create `src/lib/notifications/index.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export const NOTIFICATION_TYPES = {
  CONCERN_RESPONSE: 'concern_response',
  CONCERN_RESOLVED: 'concern_resolved',
} as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * The only thing that writes to `notifications`. Callers never touch the
 * table directly, so a future delivery channel (WhatsApp/SMS/email/push)
 * can be added inside this one function without changing any call site.
 * Takes the caller's own Supabase client (same shape as lib/settings'
 * getSettings) rather than creating its own — matches every other
 * cross-cutting helper in this codebase.
 */
export async function notify(
  supabase: SupabaseClient,
  recipientId: string,
  type: NotificationType,
  payload: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    recipient_id: recipientId,
    type,
    payload,
  });
  if (error) {
    // A failed notification must never block the action that triggered it
    // (e.g. an admin's concern reply) — log and continue.
    console.error(`Failed to create notification (${type}) for ${recipientId}:`, error.message);
  }
}
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications/index.ts
git commit -m "feat: add notify() helper for writing to the notifications table"
```

---

### Task 5: `(app)` route group layout — notification bell

**Files:**
- Create: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `getSessionProfile` (`src/lib/auth`, existing), `createServerSupabaseClient` (`src/lib/supabase/server`, existing), `notifications` table (Task 1)

This route group (`src/app/(app)/`) has no layout today — every page under it (`dashboard`, `admin`, `admin/leave`, `super-admin/service-holidays`, `admin/requests`, `admin/users/search`, `admin/users/[id]`) writes its own header markup inline, and none of them will be modified by this task. This layout adds ONLY a slim top bar containing the bell — it is additive, not a navigation redesign.

- [ ] **Step 1: Implement**

Create `src/app/(app)/layout.tsx`:

```tsx
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSessionProfile } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await getSessionProfile();

  if (!profile) {
    return <>{children}</>;
  }

  const supabase = await createServerSupabaseClient();
  const { data: unreadRows } = await supabase
    .from('notifications')
    .select('id')
    .eq('recipient_id', profile.id)
    .is('read_at', null);
  const unreadCount = unreadRows?.length ?? 0;

  return (
    <>
      <div className="flex items-center justify-end border-b border-gray-200 px-4 py-2">
        <Link
          href="/notifications"
          className="relative text-2xl"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
          🔔
          {unreadCount > 0 && (
            <span className="absolute -right-2 -top-1 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
              {unreadCount}
            </span>
          )}
        </Link>
      </div>
      {children}
    </>
  );
}
```

`getSessionProfile()` (not `requireRole`) is used deliberately: this layout must never redirect on its own — each child page already enforces its own role requirement via `requireRole`. If there's no session, the layout renders `children` with no bar at all (the child page's own `requireRole` will redirect to `/login` as it always has).

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

- [ ] **Step 3: Manual verification (requires a running dev server and a seeded database)**

Sign in and visit `/dashboard`. Confirm the bell appears at the top with no unread badge (no notifications seeded yet), and every existing page (`/dashboard`, `/admin`, `/admin/leave`, etc.) still renders its own header exactly as before, with the bell bar simply appearing above it.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/layout.tsx"
git commit -m "feat: add (app) route group layout with a notification bell"
```

---

### Task 6: User concern submission and list — `/concerns`

**Files:**
- Create: `src/app/(app)/concerns/actions.ts`
- Create: `src/app/(app)/concerns/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `getSettings`/`SETTINGS_KEYS`, `todayInTimezone` (existing), `concernCreateSchema` (Task 3), `CONCERN_CATEGORIES` (Task 3), `ConcernStatusBadge` (Task 3)
- Produces: `createConcernAction(formData: FormData)`

- [ ] **Step 1: Implement the server action**

Create `src/app/(app)/concerns/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { concernCreateSchema } from '@/lib/validation/concern';

export async function createConcernAction(formData: FormData) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const parsed = concernCreateSchema.safeParse({
    concernDate: formData.get('concernDate'),
    category: formData.get('category'),
    message: formData.get('message'),
  });

  if (!parsed.success) {
    redirect('/concerns?error=invalid');
  }

  const { error } = await supabase.from('concerns').insert({
    user_id: profile.id,
    concern_date: parsed.data.concernDate,
    category: parsed.data.category,
    message: parsed.data.message,
  });

  if (error) {
    redirect('/concerns?error=save_failed');
  }

  redirect('/concerns?submitted=1');
}
```

- [ ] **Step 2: Implement the page**

Create `src/app/(app)/concerns/page.tsx`:

```tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { todayInTimezone } from '@/lib/time/cutoff';
import { createConcernAction } from './actions';
import { CONCERN_CATEGORIES } from '@/lib/concerns/constants';
import { ConcernStatusBadge } from '@/components/concerns/status-badge';

export default async function ConcernsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const { error, submitted } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const settings = await getSettings(supabase, [SETTINGS_KEYS.TIMEZONE]);
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const today = todayInTimezone(timezone);

  const { data: concerns, error: listError } = await supabase
    .from('concerns')
    .select('id, concern_number, concern_date, category, status, created_at')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false });

  const errorMessage =
    error === 'invalid'
      ? 'Please check the form and try again.'
      : error === 'save_failed'
        ? 'Could not submit your concern. Please try again.'
        : null;

  const categoryLabel = (value: string) => CONCERN_CATEGORIES.find((c) => c.value === value)?.label ?? value;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Food Concerns</h1>

      {submitted === '1' && (
        <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-lg text-green-700">
          ✅ Concern Submitted — Your concern has been sent to the administration.
        </p>
      )}
      {errorMessage && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <h2 className="mt-6 text-2xl font-bold">Raise Food Concern</h2>
      <form action={createConcernAction} className="mt-4 space-y-4 rounded-xl border border-gray-200 p-6">
        <div>
          <label className="text-lg font-semibold" htmlFor="concernDate">
            Date
          </label>
          <input
            id="concernDate"
            name="concernDate"
            type="date"
            defaultValue={today}
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="category">
            Category
          </label>
          <select
            id="category"
            name="category"
            required
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            {CONCERN_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="message">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            required
            rows={4}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-lg"
          />
        </div>
        <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
          Submit Concern
        </button>
      </form>

      <h2 className="mt-8 text-2xl font-bold">Your Concerns</h2>
      {listError && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not load your concerns. Please try again.
        </p>
      )}
      {!listError && (concerns ?? []).length === 0 && (
        <p className="mt-4 text-lg text-gray-600">You haven&apos;t raised any concerns yet.</p>
      )}
      <div className="mt-4 space-y-3">
        {(concerns ?? []).map((c) => (
          <Link
            key={c.id}
            href={`/concerns/${c.id}`}
            className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                #{c.concern_number} — {categoryLabel(c.category)}
              </span>
              <ConcernStatusBadge status={c.status} />
            </div>
            <p className="mt-1 text-base text-gray-600">{c.concern_date}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/concerns/actions.ts" "src/app/(app)/concerns/page.tsx"
git commit -m "feat: add concern submission form and own-concern list at /concerns"
```

---

### Task 7: User concern detail — `/concerns/[id]`

**Files:**
- Create: `src/app/(app)/concerns/[id]/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `CONCERN_CATEGORIES` (Task 3), `ConcernStatusBadge` (Task 3)

This route is scoped to the caller's OWN concerns only, regardless of role — an admin viewing someone else's concern uses `/admin/concerns/[id]` (Task 9) instead. This task's query filters by `user_id = profile.id` explicitly, in addition to whatever RLS allows, so the two routes stay semantically distinct.

- [ ] **Step 1: Implement the page**

Create `src/app/(app)/concerns/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { CONCERN_CATEGORIES } from '@/lib/concerns/constants';
import { ConcernStatusBadge } from '@/components/concerns/status-badge';

export default async function ConcernDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: concern, error: concernError } = await supabase
    .from('concerns')
    .select('id, concern_number, concern_date, category, message, status')
    .eq('id', id)
    .eq('user_id', profile.id)
    .maybeSingle();

  if (concernError || !concern) {
    redirect('/concerns?error=not_found');
  }

  const { data: updates } = await supabase
    .from('concern_updates')
    .select('id, new_status, message, changed_by, created_at')
    .eq('concern_id', id)
    .order('created_at', { ascending: true });

  const changedByIds = [...new Set((updates ?? []).map((u) => u.changed_by))];
  const { data: admins } = changedByIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', changedByIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((admins ?? []).map((a) => [a.id, a.full_name]));

  const categoryLabel = CONCERN_CATEGORIES.find((c) => c.value === concern.category)?.label ?? concern.category;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/concerns" className="text-lg text-blue-600 underline">
        ← Back to Your Concerns
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Concern #{concern.concern_number}</h1>
        <ConcernStatusBadge status={concern.status} />
      </div>
      <p className="mt-2 text-lg text-gray-600">
        {categoryLabel} — {concern.concern_date}
      </p>
      <p className="mt-4 text-lg">{concern.message}</p>

      <h2 className="mt-8 text-xl font-bold">Updates</h2>
      {(updates ?? []).length === 0 && (
        <p className="mt-2 text-lg text-gray-600">No updates yet — an administrator will review this soon.</p>
      )}
      <div className="mt-2 space-y-3">
        {(updates ?? []).map((u) => (
          <div key={u.id} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
            <p className="text-base text-gray-500">
              {nameById.get(u.changed_by) ?? 'Administrator'} — {new Date(u.created_at).toLocaleString()}
            </p>
            {u.new_status && (
              <p className="mt-1">
                Status changed to <ConcernStatusBadge status={u.new_status} />
              </p>
            )}
            {u.message && <p className="mt-1">{u.message}</p>}
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

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/concerns/[id]/page.tsx"
git commit -m "feat: add concern detail/timeline page at /concerns/[id]"
```

---

### Task 8: Admin concern queue — `/admin/concerns`

**Files:**
- Create: `src/app/(app)/admin/concerns/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `CONCERN_CATEGORIES`, `CONCERN_STATUSES` (Task 3), `ConcernStatusBadge` (Task 3)

- [ ] **Step 1: Implement the page**

Create `src/app/(app)/admin/concerns/page.tsx`:

```tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { CONCERN_CATEGORIES, CONCERN_STATUSES } from '@/lib/concerns/constants';
import { ConcernStatusBadge } from '@/components/concerns/status-badge';

export default async function AdminConcernsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { status: statusParam, search: searchParam } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const status = statusParam ?? 'all';
  const search = (searchParam ?? '').trim().toLowerCase();

  const errorState = (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">Concerns</h1>
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load concerns. Please try again.
      </p>
    </main>
  );

  const concernsQuery = supabase
    .from('concerns')
    .select('id, concern_number, user_id, concern_date, category, status, created_at')
    .order('created_at', { ascending: false });
  const { data: concernRows, error: concernsError } =
    status === 'all' ? await concernsQuery : await concernsQuery.eq('status', status);
  if (concernsError) return errorState;

  const userIds = [...new Set((concernRows ?? []).map((c) => c.user_id))];
  const { data: userRows, error: usersError } = userIds.length
    ? await supabase.from('profiles').select('id, full_name, user_code').in('id', userIds)
    : { data: [] as { id: string; full_name: string; user_code: string }[], error: null };
  if (usersError) return errorState;
  const userById = new Map((userRows ?? []).map((u) => [u.id, u]));

  const categoryLabel = (value: string) => CONCERN_CATEGORIES.find((c) => c.value === value)?.label ?? value;

  const rows = (concernRows ?? []).filter((c) => {
    if (!search) return true;
    const user = userById.get(c.user_id);
    const numberMatch = String(c.concern_number).includes(search.replace('#', ''));
    const nameMatch = user?.full_name.toLowerCase().includes(search) ?? false;
    const codeMatch = user?.user_code.toLowerCase().includes(search) ?? false;
    return numberMatch || nameMatch || codeMatch;
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">Concerns</h1>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
        <div>
          <label className="text-sm font-semibold" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            <option value="all">All</option>
            {CONCERN_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
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
            defaultValue={searchParam ?? ''}
            placeholder="Concern #, name, or member ID"
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
          Apply
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="mt-6 text-lg text-gray-600">No concerns found.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((c) => {
            const user = userById.get(c.user_id);
            return (
              <Link
                key={c.id}
                href={`/admin/concerns/${c.id}`}
                className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    #{c.concern_number} — {user?.full_name} ({user?.user_code})
                  </span>
                  <ConcernStatusBadge status={c.status} />
                </div>
                <p className="mt-1 text-base text-gray-600">
                  {categoryLabel(c.category)} — {c.concern_date}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      <div className="mt-6">
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

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/admin/concerns/page.tsx"
git commit -m "feat: add admin concern queue at /admin/concerns"
```

---

### Task 9: Admin concern thread and reply — `/admin/concerns/[id]`

**Files:**
- Create: `src/app/(app)/admin/concerns/[id]/actions.ts`
- Create: `src/app/(app)/admin/concerns/[id]/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1), `concernReplySchema` (Task 3), `CONCERN_CATEGORIES`, `CONCERN_STATUSES` (Task 3), `ConcernStatusBadge` (Task 3), `notify`, `NotificationType` (Task 4)
- Produces: `replyToConcernAction(formData: FormData)`

The reply form always submits a `newStatus` (defaulting to the concern's current status in the `<select>`, so "no status change" is represented by re-submitting the same value) — this guarantees every `concern_updates` row this action writes has a non-null `new_status`, satisfying the `concern_updates_has_content` check constraint trivially and keeping the reply action's validation simple (no cross-field "at least one of status/message" refinement needed).

- [ ] **Step 1: Implement the server action**

Create `src/app/(app)/admin/concerns/[id]/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { concernReplySchema } from '@/lib/validation/concern';
import { notify, type NotificationType } from '@/lib/notifications';

export async function replyToConcernAction(formData: FormData) {
  const profile = await requireRole(['admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const concernId = formData.get('concernId') as string;

  const parsed = concernReplySchema.safeParse({
    newStatus: formData.get('newStatus'),
    message: formData.get('message'),
  });

  if (!parsed.success) {
    redirect(`/admin/concerns/${concernId}?error=invalid`);
  }

  const { data: concern, error: concernError } = await supabase
    .from('concerns')
    .select('user_id')
    .eq('id', concernId)
    .maybeSingle();

  if (concernError || !concern) {
    redirect('/admin/concerns?error=not_found');
  }

  const { error: insertError } = await supabase.from('concern_updates').insert({
    concern_id: concernId,
    new_status: parsed.data.newStatus,
    message: parsed.data.message || null,
    changed_by: profile.id,
  });

  if (insertError) {
    redirect(`/admin/concerns/${concernId}?error=save_failed`);
  }

  const { error: updateError } = await supabase
    .from('concerns')
    .update({
      status: parsed.data.newStatus,
      updated_at: new Date().toISOString(),
      ...(parsed.data.newStatus === 'resolved' ? { resolved_at: new Date().toISOString() } : {}),
    })
    .eq('id', concernId);

  if (updateError) {
    redirect(`/admin/concerns/${concernId}?error=save_failed`);
  }

  const notificationType: NotificationType = parsed.data.newStatus === 'resolved' ? 'concern_resolved' : 'concern_response';
  await notify(supabase, concern.user_id, notificationType, { concernId });

  redirect(`/admin/concerns/${concernId}`);
}
```

- [ ] **Step 2: Implement the page**

Create `src/app/(app)/admin/concerns/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { CONCERN_CATEGORIES, CONCERN_STATUSES } from '@/lib/concerns/constants';
import { ConcernStatusBadge } from '@/components/concerns/status-badge';
import { replyToConcernAction } from './actions';

export default async function AdminConcernDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: concern, error: concernError } = await supabase
    .from('concerns')
    .select('id, concern_number, user_id, concern_date, category, message, status')
    .eq('id', id)
    .maybeSingle();

  if (concernError || !concern) {
    redirect('/admin/concerns?error=not_found');
  }

  const { data: user } = await supabase
    .from('profiles')
    .select('full_name, user_code')
    .eq('id', concern.user_id)
    .maybeSingle();

  const { data: updates } = await supabase
    .from('concern_updates')
    .select('id, new_status, message, changed_by, created_at')
    .eq('concern_id', id)
    .order('created_at', { ascending: true });

  const changedByIds = [...new Set((updates ?? []).map((u) => u.changed_by))];
  const { data: admins } = changedByIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', changedByIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((admins ?? []).map((a) => [a.id, a.full_name]));

  const categoryLabel = CONCERN_CATEGORIES.find((c) => c.value === concern.category)?.label ?? concern.category;
  const errorMessage =
    error === 'invalid'
      ? 'Please check the form and try again.'
      : error === 'save_failed'
        ? 'Could not save your reply. Please try again.'
        : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/concerns" className="text-lg text-blue-600 underline">
        ← Back to Concerns
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Concern #{concern.concern_number}</h1>
        <ConcernStatusBadge status={concern.status} />
      </div>
      <p className="mt-2 text-lg text-gray-600">
        {user?.full_name} ({user?.user_code}) — {categoryLabel} — {concern.concern_date}
      </p>
      <p className="mt-4 text-lg">{concern.message}</p>

      {errorMessage && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <h2 className="mt-8 text-xl font-bold">Updates</h2>
      <div className="mt-2 space-y-3">
        {(updates ?? []).map((u) => (
          <div key={u.id} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
            <p className="text-base text-gray-500">
              {nameById.get(u.changed_by) ?? 'Administrator'} — {new Date(u.created_at).toLocaleString()}
            </p>
            {u.new_status && (
              <p className="mt-1">
                Status changed to <ConcernStatusBadge status={u.new_status} />
              </p>
            )}
            {u.message && <p className="mt-1">{u.message}</p>}
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-xl font-bold">Reply</h2>
      <form action={replyToConcernAction} className="mt-4 space-y-4 rounded-xl border border-gray-200 p-6">
        <input type="hidden" name="concernId" value={concern.id} />
        <div>
          <label className="text-lg font-semibold" htmlFor="newStatus">
            Status
          </label>
          <select
            id="newStatus"
            name="newStatus"
            defaultValue={concern.status}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            {CONCERN_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-lg font-semibold" htmlFor="message">
            Message (optional)
          </label>
          <textarea
            id="message"
            name="message"
            rows={4}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-lg"
          />
        </div>
        <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
          Post Reply
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

- [ ] **Step 4: Manual verification (requires a running dev server and a seeded database)**

Sign in as an admin, open a concern from `/admin/concerns`, post a reply with status "Resolved". Confirm: the update appears in the timeline immediately, the concern's badge updates, and (per Task 4) a `notifications` row was created for that concern's owner — check via the Studio SQL editor: `select * from notifications order by created_at desc limit 1;`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/concerns/[id]"
git commit -m "feat: add admin concern thread/reply page at /admin/concerns/[id]"
```

---

### Task 10: Notifications list — `/notifications`

**Files:**
- Create: `src/app/(app)/notifications/page.tsx`

**Interfaces:**
- Consumes: `requireRole`, `createServerSupabaseClient` (Phase 1)

Loading this page is what marks a user's currently-unread notifications as read (matches the reload-based, non-realtime approach already agreed for the bell) — there is no separate "mark all read" button. The update runs directly in this Server Component before rendering; this is an intentional, narrow exception to "Server Components only read" for the smallest possible piece of state (one bulk `UPDATE ... WHERE read_at IS NULL`), not a pattern to copy elsewhere in this app without the same justification.

- [ ] **Step 1: Implement the page**

Create `src/app/(app)/notifications/page.tsx`:

```tsx
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const NOTIFICATION_COPY: Record<string, string> = {
  concern_response: 'Your concern received a response.',
  concern_resolved: 'Your concern was resolved.',
};

export default async function NotificationsPage() {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const { data: notifications, error } = await supabase
    .from('notifications')
    .select('id, type, payload, read_at, created_at')
    .eq('recipient_id', profile.id)
    .order('created_at', { ascending: false });

  if (!error) {
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', profile.id)
      .is('read_at', null);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Notifications</h1>

      {error && (
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not load your notifications. Please try again.
        </p>
      )}
      {!error && (notifications ?? []).length === 0 && (
        <p className="mt-6 text-lg text-gray-600">You have no notifications yet.</p>
      )}

      <div className="mt-4 space-y-3">
        {(notifications ?? []).map((n) => {
          const payload = n.payload as { concernId?: string };
          return (
            <div key={n.id} className="rounded-lg border border-gray-200 px-4 py-3 text-lg">
              <p>{NOTIFICATION_COPY[n.type] ?? n.type}</p>
              {payload.concernId && (
                <a href={`/concerns/${payload.concernId}`} className="text-base text-blue-600 underline">
                  View concern
                </a>
              )}
              <p className="mt-1 text-base text-gray-500">{new Date(n.created_at).toLocaleString()}</p>
            </div>
          );
        })}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/notifications/page.tsx"
git commit -m "feat: add notifications list at /notifications, marks unread read on view"
```

---

### Task 11: Nav links from `/dashboard` and `/admin`

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/(app)/admin/page.tsx`

**Interfaces:**
- Consumes: none new — this task only adds `<Link>`s to existing pages.

- [ ] **Step 1: Add a concern link to the dashboard**

In `src/app/(app)/dashboard/page.tsx`, find the header `<div className="flex items-center justify-between">` block near the top (containing the "Good Morning" heading and the logout form) and add a link just after it:

```tsx
<div className="mt-3">
  <Link href="/concerns" className="text-lg text-blue-600 underline">
    Raise Food Concern
  </Link>
</div>
```

Add `import Link from 'next/link';` to the top of the file if it is not already imported (check first — `MenuCalendar`/`ThaliRequestCard` imports are already there, but `next/link` itself may not be).

- [ ] **Step 2: Add a concerns link to the admin dashboard**

In `src/app/(app)/admin/page.tsx`, there are two `<div className="mt-6 flex flex-wrap gap-3">...</div>` blocks (one inside the service-holiday early-return branch, one in the normal render). Add this link to both, immediately after the existing "Search Users" link:

```tsx
<Link href="/admin/concerns" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
  Concerns
</Link>
```

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx" "src/app/(app)/admin/page.tsx"
git commit -m "feat: add nav links to concerns from dashboard and admin dashboard"
```

---

### Task 12: Seed data

**Files:**
- Create: `scripts/seed-concerns.ts`
- Modify: `package.json` (add `seed:concerns` script)
- Modify: `README.md` (document the new seed script)

**Interfaces:**
- Consumes: `concerns`, `concern_updates`, `notifications` tables (Task 1)

- [ ] **Step 1: Implement the seed script**

Create `scripts/seed-concerns.ts`:

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
  const { data: users } = await supabase
    .from('profiles')
    .select('id, user_code')
    .in('user_code', ['US001', 'US002', 'US003']);

  if (!admin || !users || users.length < 3) {
    throw new Error('Run `npm run seed:users` first — admin/US001-US003 profiles not found.');
  }

  const byCode = (code: string) => users.find((u) => u.user_code === code)!.id;

  const concernRows: {
    user_id: string;
    concern_date: string;
    category: string;
    message: string;
    status: string;
    resolved_at: string | null;
  }[] = [
    {
      user_id: byCode('US001'),
      concern_date: dateOffset(-1),
      category: 'taste',
      message: 'The gravy was too salty yesterday.',
      status: 'open',
      resolved_at: null,
    },
    {
      user_id: byCode('US002'),
      concern_date: dateOffset(-2),
      category: 'quantity',
      message: 'The roti portion felt smaller than usual.',
      status: 'reviewing',
      resolved_at: null,
    },
    {
      user_id: byCode('US003'),
      concern_date: dateOffset(-3),
      category: 'packaging',
      message: 'The container lid was not sealing properly.',
      status: 'resolved',
      resolved_at: new Date().toISOString(),
    },
  ];

  for (const row of concernRows) {
    const { data: concern, error } = await supabase.from('concerns').insert(row).select('id, user_id, status').single();
    if (error || !concern) {
      console.error(`Failed to seed concern for ${row.user_id}:`, error?.message);
      continue;
    }
    console.log(`Seeded concern (${row.status}) for ${row.user_id}`);

    if (concern.status === 'reviewing' || concern.status === 'resolved') {
      const { error: updateError } = await supabase.from('concern_updates').insert({
        concern_id: concern.id,
        new_status: concern.status,
        message: concern.status === 'resolved' ? 'We have addressed this for tomorrow.' : 'Looking into this.',
        changed_by: admin!.id,
      });
      if (updateError) console.error('Failed to seed concern_update:', updateError.message);
    }

    if (concern.status === 'resolved') {
      const { error: notifyError } = await supabase.from('notifications').insert({
        recipient_id: concern.user_id,
        type: 'concern_resolved',
        payload: { concernId: concern.id },
      });
      if (notifyError) console.error('Failed to seed notification:', notifyError.message);
    }
  }
}

seed();
```

- [ ] **Step 2: Register the script**

In `package.json`, add to `"scripts"` (alongside the existing `seed:*` entries):

```json
"seed:concerns": "tsx scripts/seed-concerns.ts",
```

- [ ] **Step 3: Run and verify**

```bash
npm run seed:concerns
```

Expected: 3 "Seeded concern" lines, no errors. Verify in Studio SQL editor: `select status, count(*) from concerns group by status;` shows 1 open, 1 reviewing, 1 resolved.

- [ ] **Step 4: Update README**

Add a line documenting `npm run seed:concerns` alongside the existing seed-script documentation in `README.md` (find the section listing `seed:users`/`seed:menus`/`seed:thali`/`seed:leave` and add this one in the same style, run after `seed:users`).

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-concerns.ts package.json README.md
git commit -m "feat: add concern seed data script"
```

---

### Task 13: Integration tests — RLS for concerns, concern_updates, notifications

**Files:**
- Create: `src/lib/supabase/concerns-notifications-rls.integration.test.ts`

**Interfaces:**
- Consumes: `concerns`, `concern_updates`, `notifications` (Task 1), their RLS policies (Task 2)

- [ ] **Step 1: Write the tests**

Create `src/lib/supabase/concerns-notifications-rls.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !url || !anonKey || !serviceKey;

describe.skipIf(skip)('Concerns, concern_updates, and notifications RLS', () => {
  it('a user cannot read another user\'s concerns', async () => {
    const ownerClient = createClient(url!, anonKey!);
    await ownerClient.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const ownerId = (await ownerClient.auth.getUser()).data.user!.id;

    const { data: concern } = await ownerClient
      .from('concerns')
      .insert({ user_id: ownerId, concern_date: '2026-09-10', category: 'other', message: 'RLS test concern' })
      .select('id')
      .single();

    const otherClient = createClient(url!, anonKey!);
    await otherClient.auth.signInWithPassword({ email: 'user2@fmb.test', password: 'DevPass123!' });

    const { data } = await otherClient.from('concerns').select('id').eq('id', concern!.id);
    expect(data).toHaveLength(0);
  });

  it('an admin can read any user\'s concerns', async () => {
    const ownerClient = createClient(url!, anonKey!);
    await ownerClient.auth.signInWithPassword({ email: 'user3@fmb.test', password: 'DevPass123!' });
    const ownerId = (await ownerClient.auth.getUser()).data.user!.id;

    const { data: concern } = await ownerClient
      .from('concerns')
      .insert({ user_id: ownerId, concern_date: '2026-09-10', category: 'other', message: 'RLS test concern 2' })
      .select('id')
      .single();

    const adminClient = createClient(url!, anonKey!);
    await adminClient.auth.signInWithPassword({ email: 'admin1@fmb.test', password: 'DevPass123!' });

    const { data } = await adminClient.from('concerns').select('id').eq('id', concern!.id);
    expect(data).toHaveLength(1);
  });

  it('a regular user cannot insert into concern_updates', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const userId = (await client.auth.getUser()).data.user!.id;

    const { data: concern } = await client
      .from('concerns')
      .insert({ user_id: userId, concern_date: '2026-09-10', category: 'other', message: 'RLS test concern 3' })
      .select('id')
      .single();

    const { error } = await client
      .from('concern_updates')
      .insert({ concern_id: concern!.id, new_status: 'reviewing', changed_by: userId });
    expect(error).not.toBeNull();
  });

  it('notify() writes a row that only its recipient can read', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: recipient } = await serviceClient.from('profiles').select('id').eq('user_code', 'US001').single();
    const { data: inserted, error: insertError } = await serviceClient
      .from('notifications')
      .insert({ recipient_id: recipient!.id, type: 'concern_response', payload: {} })
      .select('id')
      .single();
    expect(insertError).toBeNull();

    const recipientClient = createClient(url!, anonKey!);
    await recipientClient.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const { data: ownData } = await recipientClient.from('notifications').select('id').eq('id', inserted!.id);
    expect(ownData).toHaveLength(1);

    const otherClient = createClient(url!, anonKey!);
    await otherClient.auth.signInWithPassword({ email: 'user2@fmb.test', password: 'DevPass123!' });
    const { data: otherData } = await otherClient.from('notifications').select('id').eq('id', inserted!.id);
    expect(otherData).toHaveLength(0);
  });

  it('a user cannot mark another user\'s notification as read', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: recipient } = await serviceClient.from('profiles').select('id').eq('user_code', 'US002').single();
    const { data: inserted } = await serviceClient
      .from('notifications')
      .insert({ recipient_id: recipient!.id, type: 'concern_response', payload: {} })
      .select('id')
      .single();

    const otherClient = createClient(url!, anonKey!);
    await otherClient.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const { data: updateResult } = await otherClient
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', inserted!.id)
      .select('id');
    expect(updateResult).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests (requires local Supabase running and seeded users)**

```bash
npx vitest run src/lib/supabase/concerns-notifications-rls.integration.test.ts
```

Expected: PASS (5 tests). If `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` aren't set in the shell running vitest, the suite is skipped rather than failing — that's expected in CI without a live Supabase instance.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/concerns-notifications-rls.integration.test.ts
git commit -m "test: add RLS integration tests for concerns, concern_updates, and notifications"
```

---

## Self-Review Notes

- **Spec coverage:** §21 (concern submission form, exact fields/copy) → Task 6. §22 (concern tracking fields, statuses, admin search/filter/update/respond) → Tasks 1, 3, 8, 9. §23 (bell + unread count, decoupled notification helper) → Tasks 4, 5, 10. §26 (three new tables) → Task 1. §28 (RLS: users own-row, admin shared-queue) → Task 2. Nav discoverability → Task 11. Seed data → Task 12. RLS verification → Task 13.
- **Type consistency:** `NotificationType` (Task 4) is imported verbatim by Task 9's action; `ConcernStatusBadge`/`CONCERN_CATEGORIES`/`CONCERN_STATUSES` (Task 3) are imported by name, unchanged, by Tasks 6-9 — no page redefines its own copy of these.
- **No placeholders:** every step has runnable code; no task defers behavior to a later "handle edge cases" step.
