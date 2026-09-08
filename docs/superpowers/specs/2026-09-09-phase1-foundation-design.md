# FMBRequestThali — Phase 1: Foundation Design

Source spec: `FMBRequestThali Web App — Complete Development Prompt.md` (full application requirements). This document scopes **Phase 1 only** — the foundation every later phase builds on. Later phases (menu workflow, user dashboard/requests, admin, super-admin, concerns/notifications/reports/PWA/tests) each get their own spec.

## Why phase it

The source spec covers ~20 build-sequence items across a full production app. Building it in one pass isn't reviewable or verifiable. Phase 1 delivers the pieces every other phase depends on: a runnable project, the DB tables that don't belong to any single feature, RBAC, RLS, and centralized settings/time helpers — so later phases add features without ever re-deriving auth or the cutoff rule.

## Scope

**In Phase 1:**
- Next.js (App Router, TS strict) + Tailwind + shadcn/ui project scaffold, npm
- Local Supabase (CLI) project: migrations, RLS, seed
- Tables: `profiles`, `app_settings`, `portion_options`, `audit_logs` (+ `role` enum)
- Supabase Auth (email/password), login / forgot-password / reset-password pages
- Centralized helpers: `lib/auth` (session + `requireRole()`), `lib/time` (timezone/cutoff calc — logic only, no feature uses it yet), `lib/settings` (typed `app_settings` accessor), `lib/validation` (zod, shared client/server)
- Seed script: 1 super_admin, 2 admin, 15 user accounts (dev-only, clearly marked)
- Minimal authenticated shell: after login, land on a placeholder page per role showing name + role, nothing else (proves auth+RBAC end-to-end; real dashboards are Phase 2+)

**Explicitly not in Phase 1** (later phases): menus/menu_versions/menu_items, thali_requests + history, user_leaves, service_holidays, concerns, concern_updates, notifications, all UI beyond the auth pages and the placeholder shell, reports, PWA manifest/service worker, audit-log *writers* for features that don't exist yet, automated test suite beyond unit tests for the helpers built here.

## Architecture & folder structure

```
src/
  app/
    (auth)/login/, (auth)/forgot-password/, (auth)/reset-password/
    (app)/dashboard/         ← placeholder landing, all roles
    (app)/admin/             ← placeholder, admin+ only
    (app)/super-admin/       ← placeholder, super_admin only
    api/                     ← route handlers, empty in Phase 1
  lib/
    supabase/   server client, browser client, middleware client
    auth/       getSession(), requireRole(role[])
    time/       now(), cutoffFor(serviceDate), isBeforeCutoff() — pure functions, unit tested, unused by any route yet
    settings/   getSetting(key), typed keys for known settings
    validation/ zod schemas (profile, settings) shared client+server
  components/ui/   shadcn primitives
supabase/
  migrations/
  seed.sql
middleware.ts      session refresh + auth-gate redirect
```

Route groups by role make the authz boundary visible in the file tree. `requireRole()` is the single choke point every protected page/action calls server-side — RLS is the backstop if that's ever bypassed. Neither is optional; the doc is explicit that hiding a UI button is not security (§28).

## Database schema (Phase 1 tables)

```sql
create type role as enum ('user', 'admin', 'super_admin');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_code text unique not null,
  full_name text not null,
  mobile text,
  email text,
  role role not null default 'user',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

create table portion_options (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('gravy', 'rice', 'roti')),
  label text not null,
  sort_order int not null default 0,
  active boolean not null default true
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  previous_state jsonb,
  new_state jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);
```

Indexes: `profiles(role)`, `profiles(user_code)`, `audit_logs(entity_type, entity_id)`, `audit_logs(created_at)`.

A trigger on `auth.users` (`after insert`) creates the matching `profiles` row with `role = 'user'` — no client path ever inserts into `profiles` directly, closing the self-promotion hole (§28: "cannot promote themselves").

`role` and `active` on `profiles` are not updatable by the row owner even though the owner can update other profile fields — enforced by a `before update` trigger that rejects changes to those two columns unless the acting user is `super_admin` (RLS alone can't do column-level write restriction cleanly in Postgres).

`roti_min_qty` / `roti_max_qty` live in `app_settings` as JSON values rather than a table, since it's a configured range, not a list of options — matches §9's "allow the permitted range to be configured."

`app_settings` seed values: `app_name`, `org_name`, `timezone` (`Asia/Kolkata`), `cutoff_time` (`18:00`), `roti_min_qty`, `roti_max_qty`.

## RLS

Two `SECURITY DEFINER` helper functions, reused by every policy in this and future phases:

```sql
create function auth.is_admin() returns boolean ...   -- role in ('admin','super_admin') and active
create function auth.is_super_admin() returns boolean ... -- role = 'super_admin' and active
```

- `profiles`: owner can `select`/`update` own row (column-restricted per above); `admin`/`super_admin` can `select` all; only `super_admin` can `update` any row's `role`/`active`. No client `delete`.
- `app_settings`, `portion_options`: `select` for any authenticated active user; `insert`/`update`/`delete` only `super_admin`.
- `audit_logs`: `select` only `super_admin`. No `insert`/`update`/`delete` policy for any role — rows are written exclusively by triggers/`SECURITY DEFINER` functions running as the table owner, never by a client-facing grant.

## Auth flow

Supabase Auth, email + password. Login page matches the doc's minimal mockup (§7): app name, mobile/email field, password field, LOGIN button, "Forgot Password?" link — nothing else. `middleware.ts` refreshes the Supabase session on every request and redirects unauthenticated users to `/login`; redirects authenticated users away from `/login`. Session cookies only — no tokens in localStorage. Architecture keeps auth behind `lib/auth` so OTP can be added later as an additional step without touching callers of `requireRole()` (§7).

## Error handling

- Failed login: inline message, no distinction between "wrong password" and "unknown user" (avoid user enumeration).
- `requireRole()` failure: redirect to `/login` if unauthenticated, or a plain "Not authorized" page if authenticated but wrong role — never a silent blank page.
- Zod validation failures on any server action return field-level errors, never a raw exception.

## Testing (Phase 1)

- Unit tests: `lib/time` cutoff calculation (before/at/after boundary, timezone correctness independent of host clock), `lib/settings` accessor.
- One RLS smoke test: a `user`-role session cannot read another user's `profiles` row or write `role`/`active`; an `admin`-role session cannot write `app_settings`.
- No e2e tests yet — nothing user-facing enough to warrant Playwright until Phase 2+.

## Seed data (dev-only)

`supabase/seed.sql`: 1 super_admin, 2 admin, 15 user profiles with realistic Indian names, `user_code` values, dummy mobiles. Auth users created via Supabase admin API in a seed script (not raw SQL, since `auth.users` needs hashed passwords) with a clearly-printed dev password. Never committed as real credentials — script output states "development only."
