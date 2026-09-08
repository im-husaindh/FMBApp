# FMBRequestThali — Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a runnable Next.js + Supabase project with the cross-cutting foundation (auth, RBAC, RLS, centralized settings/time helpers) that every later feature phase builds on — no feature UI yet beyond a role-aware placeholder shell.

**Architecture:** Next.js App Router monolith with role-based route groups (`(auth)`, `(app)`), a local Supabase project (Postgres + Auth) driven entirely by SQL migrations, and a small set of centralized `lib/` helpers (`auth`, `time`, `settings`, `validation`, `supabase`) that later phases import rather than re-implement.

**Tech Stack:** Next.js (App Router, TS strict), Tailwind CSS, shadcn/ui, `@supabase/ssr` + `@supabase/supabase-js`, zod, vitest, Supabase CLI (local Postgres via Docker).

**Spec:** `docs/superpowers/specs/2026-09-09-phase1-foundation-design.md` (and source: `FMBRequestThali Web App — Complete Development Prompt.md`)

## Global Constraints

- TypeScript strict mode everywhere; never use `any`.
- All authorization is enforced server-side (`requireRole()`) AND at the database via RLS — never rely on hiding a UI element.
- The Supabase service-role key is never imported into any file under `src/` that can run in the browser — it is only used in `scripts/seed-users.ts` (a Node script), read from `process.env.SUPABASE_SERVICE_ROLE_KEY`.
- Application timezone defaults to `Asia/Kolkata`; the 6PM cutoff (built in a later phase) must never be computed from `Date.now()` interpreted in the browser's local zone — `lib/time` is the only place timezone math happens.
- `role` enum values are exactly `user`, `admin`, `super_admin` — used verbatim in SQL, TypeScript types, and RLS policies.
- Package manager: npm.
- Local dev database: Supabase CLI (`npx supabase`), which requires Docker Desktop running. If Docker isn't available yet when a task calls for `supabase db reset`, note that in your task report and move to the next task that doesn't need it — the SQL/code should still be written and reviewed; only the "apply and verify against a live DB" step is blocked.

---

## File Structure (for reference across tasks)

```
src/
  app/
    (auth)/login/page.tsx, (auth)/login/actions.ts
    (auth)/forgot-password/page.tsx, (auth)/forgot-password/actions.ts
    (auth)/reset-password/page.tsx, (auth)/reset-password/actions.ts
    (app)/dashboard/page.tsx
    (app)/admin/page.tsx
    (app)/super-admin/page.tsx
    not-authorized/page.tsx
  lib/
    supabase/server.ts, supabase/client.ts
    auth/index.ts
    time/cutoff.ts, time/cutoff.test.ts
    settings/index.ts, settings/index.test.ts
    validation/auth.ts, validation/profile.ts, validation/settings.ts
  middleware.ts
supabase/
  migrations/0001_profiles.sql
  migrations/0002_profiles_rls.sql
  migrations/0003_app_settings.sql
  migrations/0004_portion_options.sql
  migrations/0005_audit_logs.sql
  seed.sql
scripts/
  seed-users.ts
.env.example
```

---

### Task 1: Project scaffold

**Files:**
- Create: entire Next.js project at repo root (via `create-next-app`)
- Create: `vitest.config.ts`
- Create: `src/lib/sanity.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, `npm run lint`, `npm run test` — every later task relies on these existing.

- [ ] **Step 1: Scaffold the Next.js app**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

Run from the repo root (`C:\Users\Dhariwala\Documents\DOC\FMBApp`), which already contains the spec `.md` files and `docs/` — accept scaffolding into the existing (non-empty) directory when prompted.

- [ ] **Step 2: Confirm TypeScript strict mode**

Open `tsconfig.json` and verify `"strict": true` is set under `compilerOptions` (it is by default with the flags above — if not, add it).

- [ ] **Step 3: Install shadcn/ui and base components**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button input label card
```

- [ ] **Step 4: Install and configure vitest**

```bash
npm install -D vitest @vitejs/plugin-react
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 5: Add a sanity test**

Create `src/lib/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('arithmetic works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Add npm scripts**

In `package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 7: Verify everything runs**

```bash
npm run lint
npm run test
npm run build
```

Expected: all three succeed (lint: no errors; test: 1 passed; build: compiles).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js project with Tailwind, shadcn/ui, vitest"
```

---

### Task 2: Supabase CLI init, env template, Supabase client helpers

**Files:**
- Create: `supabase/config.toml` (via CLI)
- Create: `.env.example`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/client.ts`
- Modify: `.gitignore` (ensure `.env.local` is ignored — `create-next-app` already adds this; verify)

**Interfaces:**
- Produces: `createServerSupabaseClient(): Promise<SupabaseClient>`, `createBrowserSupabaseClient(): SupabaseClient` — every later server action, page, and the middleware import these.

- [ ] **Step 1: Init Supabase project**

```bash
npx supabase init
```

- [ ] **Step 2: Install Supabase client libraries**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 3: Create `.env.example`**

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Copy it to `.env.local` (not committed) — values for the anon key are filled in once `supabase start` runs (Task not blocked on this; leave blank until Docker is ready).

- [ ] **Step 4: Server-side Supabase client**

Create `src/lib/supabase/server.ts`:

```ts
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render — middleware refreshes the session instead.
          }
        },
      },
    }
  );
}
```

- [ ] **Step 5: Browser Supabase client**

Create `src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr';

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: succeeds (env vars are read at runtime, not build time, so blank `.env.local` is fine here).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: init Supabase project, add server/browser client helpers"
```

---

### Task 3: Migration — role enum, profiles table, auto-create + lock triggers

**Files:**
- Create: `supabase/migrations/0001_profiles.sql`

**Interfaces:**
- Produces: table `public.profiles(id, user_code, full_name, mobile, email, role, active, created_at, updated_at)`, enum `public.role`. Every later table with an `actor`/`user` FK references `profiles(id)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0001_profiles.sql`:

```sql
create type public.role as enum ('user', 'admin', 'super_admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_code text unique not null,
  full_name text not null,
  mobile text,
  email text,
  role public.role not null default 'user',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);

alter table public.profiles enable row level security;

-- Auto-create a profile row whenever a new auth user is created.
-- No client-side insert path into profiles exists, so a user can never
-- self-assign a role by inserting their own row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, user_code, full_name, email, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'user_code', substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    'user',
    true
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Only an active super_admin may change role or active status,
-- even though a user may update their own other profile fields.
create or replace function public.profiles_prevent_role_active_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active) then
    if not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin' and p.active = true
    ) then
      raise exception 'Only an active super_admin may change role or active status';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_before_update_lock_role_active
before update on public.profiles
for each row execute function public.profiles_prevent_role_active_change();
```

- [ ] **Step 2: Apply and verify (requires `supabase start` running)**

```bash
npx supabase db reset
```

Expected: migration applies with no errors; `\d public.profiles` in `npx supabase db psql` shows the table and both triggers.

If Docker/Supabase isn't running yet, skip this verification step for now — note it in your task report so it gets re-run once local Supabase is available.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): add role enum, profiles table, auto-create and role-lock triggers"
```

---

### Task 4: Migration — RLS helper functions and profiles RLS policies

**Files:**
- Create: `supabase/migrations/0002_profiles_rls.sql`

**Interfaces:**
- Consumes: `public.profiles` (Task 3)
- Produces: `public.is_admin(): boolean`, `public.is_super_admin(): boolean` — reused by every RLS policy in Tasks 5–7 and all later phases.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0002_profiles_rls.sql`:

```sql
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'super_admin') and active = true
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin' and active = true
  );
$$;

-- A user may read their own row; admins/super_admins may read every row.
create policy profiles_select on public.profiles
  for select
  using (id = auth.uid() or public.is_admin());

-- A user may update their own row (role/active changes are separately
-- blocked by the trigger from migration 0001 regardless of this policy).
create policy profiles_update_own on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- A super_admin may update any row (needed to change other users' role/active).
create policy profiles_update_super_admin on public.profiles
  for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- No insert/delete policy for any client role: profiles are only created
-- by the handle_new_user trigger and never deleted (deactivate instead).
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

Expected: applies with no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): add is_admin/is_super_admin helpers and profiles RLS policies"
```

---

### Task 5: Migration — app_settings table and RLS

**Files:**
- Create: `supabase/migrations/0003_app_settings.sql`

**Interfaces:**
- Consumes: `public.is_super_admin()` (Task 4)
- Produces: table `public.app_settings(key, value, updated_by, updated_at)`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_app_settings.sql`:

```sql
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy app_settings_select on public.app_settings
  for select
  using (auth.uid() is not null);

create policy app_settings_write_super_admin on public.app_settings
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): add app_settings table with read-all/write-super-admin RLS"
```

---

### Task 6: Migration — portion_options table and RLS

**Files:**
- Create: `supabase/migrations/0004_portion_options.sql`

**Interfaces:**
- Consumes: `public.is_super_admin()` (Task 4)
- Produces: table `public.portion_options(id, category, label, sort_order, active)`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0004_portion_options.sql`:

```sql
create table public.portion_options (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('gravy', 'rice', 'roti')),
  label text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  unique (category, label)
);

alter table public.portion_options enable row level security;

create policy portion_options_select on public.portion_options
  for select
  using (auth.uid() is not null);

create policy portion_options_write_super_admin on public.portion_options
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): add portion_options table with read-all/write-super-admin RLS"
```

---

### Task 7: Migration — audit_logs table and read-only RLS

**Files:**
- Create: `supabase/migrations/0005_audit_logs.sql`

**Interfaces:**
- Consumes: `public.profiles(id)` (Task 3), `public.is_super_admin()` (Task 4)
- Produces: table `public.audit_logs(id, actor_id, action, entity_type, entity_id, previous_state, new_state, ip_address, created_at)` — insert-only via `security definer` functions written in later phases, never via a client grant.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0005_audit_logs.sql`:

```sql
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  previous_state jsonb,
  new_state jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);
create index audit_logs_created_at_idx on public.audit_logs(created_at);

alter table public.audit_logs enable row level security;

create policy audit_logs_select_super_admin on public.audit_logs
  for select
  using (public.is_super_admin());

-- Deliberately no insert/update/delete policy for any role: rows are
-- written only by SECURITY DEFINER functions (added in later phases)
-- running as the table owner, never via a direct client grant.
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): add audit_logs table, super-admin-read-only RLS, no client write path"
```

---

### Task 8: `lib/time` — cutoff calculation helpers

**Files:**
- Create: `src/lib/time/cutoff.ts`
- Test: `src/lib/time/cutoff.test.ts`

**Interfaces:**
- Produces: `zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date`, `cutoffInstant(serviceDate: string, timeZone: string, cutoffTime: string): Date`, `isBeforeCutoff(serviceDate: string, timeZone: string, cutoffTime: string, nowUtc?: Date): boolean` — the request-submission phase (Phase 2/3) calls `isBeforeCutoff` server-side and nowhere else.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/time/cutoff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cutoffInstant, isBeforeCutoff } from './cutoff';

describe('cutoffInstant', () => {
  it('computes 6pm IST on the previous day as the correct UTC instant', () => {
    // Service date Wed 2026-09-09 -> cutoff Tue 2026-09-08 18:00 IST (+05:30) = 12:30 UTC
    const instant = cutoffInstant('2026-09-09', 'Asia/Kolkata', '18:00');
    expect(instant.toISOString()).toBe('2026-09-08T12:30:00.000Z');
  });
});

describe('isBeforeCutoff', () => {
  it('returns true just before cutoff', () => {
    const justBefore = new Date('2026-09-08T12:29:59.000Z');
    expect(isBeforeCutoff('2026-09-09', 'Asia/Kolkata', '18:00', justBefore)).toBe(true);
  });

  it('returns false exactly at and after cutoff', () => {
    const atCutoff = new Date('2026-09-08T12:30:00.000Z');
    expect(isBeforeCutoff('2026-09-09', 'Asia/Kolkata', '18:00', atCutoff)).toBe(false);
    const after = new Date('2026-09-08T13:00:00.000Z');
    expect(isBeforeCutoff('2026-09-09', 'Asia/Kolkata', '18:00', after)).toBe(false);
  });

  it('is independent of the host machine timezone', () => {
    // No Date/Intl call in the implementation may read the host's local timezone.
    const justBefore = new Date('2026-09-08T12:29:59.000Z');
    expect(isBeforeCutoff('2026-09-09', 'America/New_York', '18:00', justBefore)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/time/cutoff.test.ts
```

Expected: FAIL — `./cutoff` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/time/cutoff.ts`:

```ts
function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

/** Converts a wall-clock date+time in `timeZone` to the equivalent UTC instant. */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offsetMinutes = getTimezoneOffsetMinutes(new Date(naiveUtc), timeZone);
  return new Date(naiveUtc - offsetMinutes * 60000);
}

/** The UTC instant at which the selection window for `serviceDate` closes. */
export function cutoffInstant(serviceDate: string, timeZone: string, cutoffTime: string): Date {
  const [y, m, d] = serviceDate.split('-').map(Number);
  const prevDay = new Date(Date.UTC(y, m - 1, d));
  prevDay.setUTCDate(prevDay.getUTCDate() - 1);
  const prevDateStr = prevDay.toISOString().slice(0, 10);
  return zonedTimeToUtc(prevDateStr, cutoffTime, timeZone);
}

/** True if `nowUtc` is strictly before the cutoff for `serviceDate`. Never pass a client-supplied clock. */
export function isBeforeCutoff(
  serviceDate: string,
  timeZone: string,
  cutoffTime: string,
  nowUtc: Date = new Date()
): boolean {
  return nowUtc.getTime() < cutoffInstant(serviceDate, timeZone, cutoffTime).getTime();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/time/cutoff.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add timezone-safe cutoff calculation helpers"
```

---

### Task 9: `lib/settings` — typed app_settings accessor

**Files:**
- Create: `src/lib/settings/index.ts`
- Test: `src/lib/settings/index.test.ts`

**Interfaces:**
- Consumes: any `SupabaseClient` (duck-typed, from `@supabase/supabase-js`)
- Produces: `SETTINGS_KEYS`, `SettingKey`, `getSetting<T>(supabase, key): Promise<T | null>`, `getSettings(supabase, keys): Promise<Record<string, unknown>>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/settings/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getSetting, SETTINGS_KEYS } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';

function mockSupabase(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => result,
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('getSetting', () => {
  it('returns the value on success', async () => {
    const supabase = mockSupabase({ data: { value: '18:00' }, error: null });
    const result = await getSetting(supabase, SETTINGS_KEYS.CUTOFF_TIME);
    expect(result).toBe('18:00');
  });

  it('returns null on error', async () => {
    const supabase = mockSupabase({ data: null, error: { message: 'not found' } });
    const result = await getSetting(supabase, SETTINGS_KEYS.CUTOFF_TIME);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/settings/index.test.ts
```

Expected: FAIL — `./index` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/settings/index.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export const SETTINGS_KEYS = {
  APP_NAME: 'app_name',
  ORG_NAME: 'org_name',
  TIMEZONE: 'timezone',
  CUTOFF_TIME: 'cutoff_time',
  ROTI_MIN_QTY: 'roti_min_qty',
  ROTI_MAX_QTY: 'roti_max_qty',
} as const;

export type SettingKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

export async function getSetting<T = unknown>(
  supabase: SupabaseClient,
  key: SettingKey
): Promise<T | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .single();
  if (error || !data) return null;
  return (data as { value: T }).value;
}

export async function getSettings(
  supabase: SupabaseClient,
  keys: SettingKey[]
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('app_settings').select('key, value').in('key', keys);
  if (error || !data) return {};
  return Object.fromEntries(
    (data as { key: string; value: unknown }[]).map((row) => [row.key, row.value])
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/settings/index.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add typed app_settings accessor"
```

---

### Task 10: `lib/validation` — zod schemas

**Files:**
- Create: `src/lib/validation/auth.ts`
- Create: `src/lib/validation/profile.ts`
- Create: `src/lib/validation/settings.ts`
- Test: `src/lib/validation/auth.test.ts`

**Interfaces:**
- Produces: `loginSchema`, `LoginInput`, `forgotPasswordSchema`, `ForgotPasswordInput`, `resetPasswordSchema`, `ResetPasswordInput` (auth.ts); `profileUpdateSchema`, `ProfileUpdateInput` (profile.ts); `appSettingUpdateSchema`, `AppSettingUpdateInput` (settings.ts) — Tasks 12–13's server actions parse `FormData` through these.

- [ ] **Step 1: Install zod**

```bash
npm install zod
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/validation/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loginSchema, resetPasswordSchema } from './auth';

describe('loginSchema', () => {
  it('accepts a valid email and password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'secret1' });
    expect(result.success).toBe(true);
  });

  it('rejects a short password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: '123' });
    expect(result.success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('rejects mismatched passwords', () => {
    const result = resetPasswordSchema.safeParse({ password: 'secret1', confirmPassword: 'secret2' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/lib/validation/auth.test.ts
```

Expected: FAIL — `./auth` has no exported members.

- [ ] **Step 4: Implement**

Create `src/lib/validation/auth.ts`:

```ts
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(6),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
```

Create `src/lib/validation/profile.ts`:

```ts
import { z } from 'zod';

export const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  mobile: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{7,15}$/)
    .optional()
    .or(z.literal('')),
  email: z.string().trim().email().optional().or(z.literal('')),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
```

Create `src/lib/validation/settings.ts`:

```ts
import { z } from 'zod';

export const appSettingUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});
export type AppSettingUpdateInput = z.infer<typeof appSettingUpdateSchema>;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/lib/validation/auth.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add zod validation schemas for auth, profile, settings"
```

---

### Task 11: `lib/auth` and `middleware.ts`

**Files:**
- Create: `src/lib/auth/index.ts`
- Create: `src/middleware.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient()` (Task 2)
- Produces: `Role`, `SessionProfile`, `getSessionProfile(): Promise<SessionProfile | null>`, `requireRole(allowed: Role[]): Promise<SessionProfile>` — every protected page (Task 14) and every later phase's server action calls `requireRole`.

- [ ] **Step 1: Implement `lib/auth`**

Create `src/lib/auth/index.ts`:

```ts
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type Role = 'user' | 'admin' | 'super_admin';

export interface SessionProfile {
  id: string;
  fullName: string;
  role: Role;
  active: boolean;
}

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role, active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.active) return null;

  return {
    id: profile.id,
    fullName: profile.full_name,
    role: profile.role as Role,
    active: profile.active,
  };
}

export async function requireRole(allowed: Role[]): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!allowed.includes(profile.role)) redirect('/not-authorized');
  return profile;
}
```

- [ ] **Step 2: Implement middleware**

Create `src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isPublic = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add requireRole auth helper and session-refresh middleware"
```

---

### Task 12: Login page

**Files:**
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/login/actions.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient()` (Task 2), `loginSchema` (Task 10), shadcn `Button`/`Input`/`Label` (Task 1)
- Produces: `loginAction(formData: FormData): Promise<void>` (redirects on completion)

- [ ] **Step 1: Implement the server action**

Create `src/app/(auth)/login/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { loginSchema } from '@/lib/validation/auth';

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    redirect('/login?error=invalid');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  // Same generic message for wrong password vs unknown user — avoids user enumeration.
  if (error) {
    redirect('/login?error=invalid');
  }

  redirect('/dashboard');
}
```

- [ ] **Step 2: Implement the page**

Create `src/app/(auth)/login/page.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginAction } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">FMBRequestThali</h1>
          <p className="mt-1 text-lg text-gray-600">Welcome</p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-center text-lg text-red-700">
            Incorrect email or password.
          </p>
        )}

        <form action={loginAction} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email" className="text-lg">
              Email
            </Label>
            <Input id="email" name="email" type="email" required className="h-14 text-lg" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password" className="text-lg">
              Password
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              className="h-14 text-lg"
            />
          </div>
          <Button type="submit" className="h-14 w-full text-xl font-semibold">
            LOGIN
          </Button>
        </form>

        <a href="/forgot-password" className="block text-center text-lg text-blue-600 underline">
          Forgot Password?
        </a>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Manual verification**

```bash
npm run dev
```

Visit `http://localhost:3000/login`. Expected: page renders per the mockup in §7 of the source spec — app name, Welcome, Email field, Password field, LOGIN button, Forgot Password link. Submitting with no local Supabase running will fail at the network call — that's expected until Task 15's seed users exist and `supabase start` is running; the page rendering correctly is what this step verifies.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add login page and server action"
```

---

### Task 13: Forgot-password and reset-password pages

**Files:**
- Create: `src/app/(auth)/forgot-password/page.tsx`
- Create: `src/app/(auth)/forgot-password/actions.ts`
- Create: `src/app/(auth)/reset-password/page.tsx`
- Create: `src/app/(auth)/reset-password/actions.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient()` (Task 2), `forgotPasswordSchema`/`resetPasswordSchema` (Task 10)
- Produces: `forgotPasswordAction`, `resetPasswordAction`

- [ ] **Step 1: Forgot-password action**

Create `src/app/(auth)/forgot-password/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { forgotPasswordSchema } from '@/lib/validation/auth';

export async function forgotPasswordAction(formData: FormData) {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    redirect('/forgot-password?error=invalid');
  }

  const supabase = await createServerSupabaseClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`,
  });

  // Always show the same confirmation, whether or not the email exists.
  redirect('/forgot-password?sent=1');
}
```

- [ ] **Step 2: Forgot-password page**

Create `src/app/(auth)/forgot-password/page.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { forgotPasswordAction } from './actions';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-2xl font-bold">Reset Your Password</h1>

        {sent ? (
          <p className="rounded-lg bg-green-50 px-4 py-3 text-center text-lg text-green-700">
            If that email is registered, a reset link has been sent.
          </p>
        ) : (
          <>
            <p className="text-center text-lg text-gray-600">
              Enter your email and we&apos;ll send you a reset link.
            </p>
            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-3 text-center text-lg text-red-700">
                Enter a valid email address.
              </p>
            )}
            <form action={forgotPasswordAction} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="email" className="text-lg">
                  Email
                </Label>
                <Input id="email" name="email" type="email" required className="h-14 text-lg" />
              </div>
              <Button type="submit" className="h-14 w-full text-xl font-semibold">
                SEND RESET LINK
              </Button>
            </form>
          </>
        )}

        <a href="/login" className="block text-center text-lg text-blue-600 underline">
          Back to Login
        </a>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Reset-password action**

Create `src/app/(auth)/reset-password/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resetPasswordSchema } from '@/lib/validation/auth';

export async function resetPasswordAction(formData: FormData) {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    redirect('/reset-password?error=invalid');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    redirect('/reset-password?error=failed');
  }

  redirect('/login?reset=success');
}
```

- [ ] **Step 4: Reset-password page**

Create `src/app/(auth)/reset-password/page.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resetPasswordAction } from './actions';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-2xl font-bold">Set a New Password</h1>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-center text-lg text-red-700">
            {error === 'failed'
              ? 'Could not update your password. The reset link may have expired.'
              : 'Passwords must match and be at least 6 characters.'}
          </p>
        )}

        <form action={resetPasswordAction} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="password" className="text-lg">
              New Password
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              className="h-14 text-lg"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirmPassword" className="text-lg">
              Confirm Password
            </Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={6}
              className="h-14 text-lg"
            />
          </div>
          <Button type="submit" className="h-14 w-full text-xl font-semibold">
            UPDATE PASSWORD
          </Button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add forgot-password and reset-password pages"
```

---

### Task 14: Placeholder dashboard shell and not-authorized page

**Files:**
- Create: `src/app/(app)/dashboard/page.tsx`
- Create: `src/app/(app)/admin/page.tsx`
- Create: `src/app/(app)/super-admin/page.tsx`
- Create: `src/app/not-authorized/page.tsx`

**Interfaces:**
- Consumes: `requireRole()` (Task 11)

- [ ] **Step 1: Dashboard (all roles)**

Create `src/app/(app)/dashboard/page.tsx`:

```tsx
import { requireRole } from '@/lib/auth';

export default async function DashboardPage() {
  const profile = await requireRole(['user', 'admin', 'super_admin']);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Welcome, {profile.fullName}</h1>
      <p className="mt-2 text-lg text-gray-600">Role: {profile.role}</p>
    </main>
  );
}
```

- [ ] **Step 2: Admin placeholder**

Create `src/app/(app)/admin/page.tsx`:

```tsx
import { requireRole } from '@/lib/auth';

export default async function AdminPage() {
  const profile = await requireRole(['admin', 'super_admin']);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Admin Area</h1>
      <p className="mt-2 text-lg text-gray-600">
        Signed in as {profile.fullName} ({profile.role})
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Super-admin placeholder**

Create `src/app/(app)/super-admin/page.tsx`:

```tsx
import { requireRole } from '@/lib/auth';

export default async function SuperAdminPage() {
  const profile = await requireRole(['super_admin']);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Super Admin Area</h1>
      <p className="mt-2 text-lg text-gray-600">
        Signed in as {profile.fullName} ({profile.role})
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Not-authorized page**

Create `src/app/not-authorized/page.tsx`:

```tsx
export default function NotAuthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Not Authorized</h1>
        <p className="mt-2 text-lg text-gray-600">You do not have permission to view this page.</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add role-gated placeholder dashboard, admin, super-admin pages"
```

---

### Task 15: Seed data — default settings/portions and dev users

**Files:**
- Create: `supabase/seed.sql`
- Create: `scripts/seed-users.ts`
- Modify: `package.json` (add `seed:users` script, `tsx` devDependency)

**Interfaces:**
- Consumes: tables from Tasks 3, 5, 6

- [ ] **Step 1: Write `supabase/seed.sql`**

Create `supabase/seed.sql`:

```sql
insert into public.app_settings (key, value) values
  ('app_name', '"FMBRequestThali"'),
  ('org_name', '"FMB Community"'),
  ('timezone', '"Asia/Kolkata"'),
  ('cutoff_time', '"18:00"'),
  ('roti_min_qty', '0'),
  ('roti_max_qty', '6')
on conflict (key) do nothing;

insert into public.portion_options (category, label, sort_order) values
  ('gravy', 'Small', 1), ('gravy', 'Regular', 2), ('gravy', 'Large', 3),
  ('rice', 'No Rice', 1), ('rice', 'Small', 2), ('rice', 'Regular', 3), ('rice', 'Large', 4)
on conflict (category, label) do nothing;
```

- [ ] **Step 2: Install `tsx`**

```bash
npm install -D tsx
```

- [ ] **Step 3: Write the user seed script**

Create `scripts/seed-users.ts`:

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

// DEVELOPMENT ONLY. Never reuse this password or these accounts outside local dev.
const DEV_PASSWORD = 'DevPass123!';

type SeedUser = {
  email: string;
  fullName: string;
  role: 'super_admin' | 'admin' | 'user';
  userCode: string;
};

const users: SeedUser[] = [
  { email: 'superadmin@fmb.test', fullName: 'Asha Mehta', role: 'super_admin', userCode: 'SA001' },
  { email: 'admin1@fmb.test', fullName: 'Ravi Shah', role: 'admin', userCode: 'AD001' },
  { email: 'admin2@fmb.test', fullName: 'Neha Doshi', role: 'admin', userCode: 'AD002' },
  ...Array.from({ length: 15 }, (_, i) => ({
    email: `user${i + 1}@fmb.test`,
    fullName: `Community Member ${i + 1}`,
    role: 'user' as const,
    userCode: `US${String(i + 1).padStart(3, '0')}`,
  })),
];

async function seed() {
  for (const u of users) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.fullName, user_code: u.userCode },
    });
    if (error) {
      console.error(`Failed to create ${u.email}:`, error.message);
      continue;
    }
    if (u.role !== 'user') {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ role: u.role })
        .eq('id', data.user!.id);
      if (updateError) console.error(`Failed to set role for ${u.email}:`, updateError.message);
    }
    console.log(`Created ${u.role}: ${u.email}`);
  }
  console.log('\nDEVELOPMENT ONLY — all seeded users share password:', DEV_PASSWORD);
}

seed();
```

- [ ] **Step 4: Add npm script**

In `package.json` `"scripts"`, add:

```json
"seed:users": "tsx scripts/seed-users.ts"
```

- [ ] **Step 5: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
npm run seed:users
```

Expected: `db reset` applies all migrations + `seed.sql`; `seed:users` prints "Created super_admin: superadmin@fmb.test", 2 "Created admin: ...", 15 "Created user: ...", then the dev-password line.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add default settings/portion seed data and dev user seed script"
```

---

### Task 16: RLS smoke test

**Files:**
- Test: `src/lib/supabase/rls.integration.test.ts`

**Interfaces:**
- Consumes: seeded `user1@fmb.test` (Task 15), live local Supabase instance

- [ ] **Step 1: Write the test**

Create `src/lib/supabase/rls.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const skip = !url || !anonKey;

describe.skipIf(skip)('RLS: profiles and app_settings', () => {
  it("a user cannot read another user's profile row", async () => {
    const client = createClient(url!, anonKey!);
    const { error: signInError } = await client.auth.signInWithPassword({
      email: 'user1@fmb.test',
      password: 'DevPass123!',
    });
    expect(signInError).toBeNull();

    const {
      data: { user },
    } = await client.auth.getUser();
    const { data: others } = await client.from('profiles').select('id').neq('id', user!.id);

    expect(others).toEqual([]);
  });

  it('a user cannot write app_settings', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });

    const { error } = await client
      .from('app_settings')
      .update({ value: '"tampered"' })
      .eq('key', 'cutoff_time');

    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it (requires local Supabase running + Task 15 seed applied)**

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key> npx vitest run src/lib/supabase/rls.integration.test.ts
```

Expected: PASS (2 tests). Without those env vars set, the suite reports skipped rather than failing — so `npm run test` stays green in environments without a live Supabase instance.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: add RLS smoke test for profiles and app_settings"
```

---

### Task 17: README, env template finalization, final verification

**Files:**
- Create: `README.md`
- Modify: `.env.example` (finalize comments)

**Interfaces:** none (documentation + verification only)

- [ ] **Step 1: Write `README.md`**

```markdown
# FMBRequestThali

Meal/thali request and menu-management system. This is Phase 1 (foundation) —
project scaffold, database schema, authentication, RBAC/RLS, and centralized
settings/time helpers. No feature UI yet beyond a role-aware placeholder shell.

## Prerequisites

- Node.js 20+
- Docker Desktop (for local Supabase)
- Supabase CLI (installed on demand via `npx supabase`)

## Local development

1. Copy the env template: `cp .env.example .env.local`
2. Start local Supabase: `npx supabase start` — prints your local anon key and
   service role key. Put the anon key in `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   the service role key in `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
3. Apply migrations and seed data: `npx supabase db reset`
4. Create dev accounts: `npm run seed:users` (prints the shared dev password —
   development only, never used outside local dev)
5. Install dependencies: `npm install`
6. Run the app: `npm run dev` — visit http://localhost:3000/login

## Testing

- `npm run test` — unit tests (no live Supabase required)
- RLS smoke test requires local Supabase running and seeded; see Task 16 in
  `docs/superpowers/plans/2026-09-09-phase1-foundation.md` for the exact command.

## Project structure

See `docs/superpowers/specs/2026-09-09-phase1-foundation-design.md` for the
architecture and database design, and the source requirements doc
`FMBRequestThali Web App — Complete Development Prompt.md` for the full
product spec across all phases.
```

- [ ] **Step 2: Finalize `.env.example` with comments**

```
# Local Supabase (from `npx supabase start` output)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Server-only — never expose to the browser. Used by scripts/seed-users.ts only.
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Step 3: Full verification pass**

```bash
npm run lint
npm run test
npm run build
```

Expected: all pass. If Docker/local Supabase is running, additionally run:

```bash
npx supabase db reset
npm run seed:users
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key> npx vitest run src/lib/supabase/rls.integration.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: add README with setup instructions"
```

---

## Self-Review Notes

- **Spec coverage:** every Phase-1 item from the design doc (project scaffold, Supabase local project, profiles/app_settings/portion_options/audit_logs tables + RLS, auth pages, centralized `lib/auth`/`lib/time`/`lib/settings`/`lib/validation`, seed data, RLS smoke test) maps to a task above.
- **Deferred to later phases (explicitly, not gaps):** menus/menu_versions/menu_items, thali_requests, user_leaves, service_holidays, concerns, notifications, reports, PWA manifest/service worker, e2e tests — all listed as out-of-scope in the design doc.
- **Naming consistency checked:** `requireRole`, `getSessionProfile`, `createServerSupabaseClient`, `createBrowserSupabaseClient`, `getSetting`/`getSettings`/`SETTINGS_KEYS`, `isBeforeCutoff`/`cutoffInstant`/`zonedTimeToUtc` are used identically wherever referenced across tasks.
