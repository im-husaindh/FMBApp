# FMBRequestThali

Meal/thali request and menu-management system for a community organization.
Next.js App Router + Supabase (Postgres/Auth/RLS). Users submit daily thali
requests before a server-enforced cutoff; admins manage menus, leave,
concerns, and reporting; super admins approve menus, manage users, and review
an audit trail. See `HANDOFF.md` for current build status and project
conventions, and `docs/superpowers/specs/` for the design rationale behind
each part of the app.

## Prerequisites

- Node.js 20+
- Docker Desktop (for local Supabase)
- Supabase CLI (installed on demand via `npx supabase`)

## Local development

1. Copy the env template: `cp .env.example .env.local`
2. Install dependencies: `npm install`
3. Start local Supabase: `npx supabase start` — prints your local anon key and
   service role key. Put the anon key in `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   the service role key in `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
4. Apply migrations and seed data: `npx supabase db reset`
5. Create dev accounts: `npm run seed:users` (prints the shared dev password —
   development only, never used outside local dev)
6. Create sample menus: `npm run seed:menus` (11 service dates: past 3 days, today, next 7 days —
   including one pending approval and one rejected, for testing the approval queue)
7. Create sample thali requests: `npm run seed:thali` (varied requested/no-thali/no-response
   states across the same 11 service dates, for testing the dashboard and, later, admin
   operational views)
8. Create sample leave/holidays: `npm run seed:leave` (a few leave periods across
   seeded users and one upcoming service holiday, for testing the admin dashboard's
   counts and the dashboard's leave/no-service states)
9. Create sample concerns: `npm run seed:concerns` (three concerns across
   US001-US003 in open/reviewing/resolved states, with matching concern_updates
   and a notification for the resolved one, for testing the concern workflow)
10. Run the app: `npm run dev` — visit http://localhost:3000/login

## Testing

- `npm run test` (or `npx vitest run`) runs everything. With no environment
  variables set, integration tests (`src/lib/**/*.integration.test.ts`)
  auto-skip; only pure-function unit tests run.
- To also run the integration tests (RLS policies, RPCs, notifications,
  audit logging, etc.), export `.env.local`'s variables into your shell
  first (`export $(grep -v '^#' .env.local | xargs)` on a POSIX shell),
  against a running, seeded local Supabase instance.
- `npm run lint` — ESLint, including the `jsx-a11y` accessibility ruleset.
- Known pre-existing test issues (not regressions — see `HANDOFF.md`): two
  integration tests fail on a fresh `db reset` until `npm run seed:menus`
  is re-run, and one test in `rls.integration.test.ts` has an incorrect
  assertion against otherwise-correct RLS behavior.

## Project structure

See `HANDOFF.md` for current build status, established conventions, and
known issues. See `docs/superpowers/specs/` for one design doc per
development phase (architecture and rationale), and the source requirements
doc `FMBRequestThali Web App — Complete Development Prompt.md` for the full
product spec across all phases.
