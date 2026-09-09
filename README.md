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
8. Run the app: `npm run dev` — visit http://localhost:3000/login

## Testing

- `npm run test` — unit tests (no live Supabase required)
- RLS smoke test requires local Supabase running and seeded; see Task 16 in
  `docs/superpowers/plans/2026-09-09-phase1-foundation.md` for the exact command.

## Project structure

See `docs/superpowers/specs/2026-09-09-phase1-foundation-design.md` for the
architecture and database design, and the source requirements doc
`FMBRequestThali Web App — Complete Development Prompt.md` for the full
product spec across all phases.
