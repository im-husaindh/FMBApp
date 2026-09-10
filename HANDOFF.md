# Handoff — FMBRequestThali

This is a status/onboarding doc for anyone (human or AI) picking up this project fresh. Setup steps live in `README.md`; this file covers what's built, how it was built, and what's left.

## What this is

A meal/thali request and menu-management system for a community organization ("FMB Community"), built against the full spec in `FMBRequestThali Web App — Complete Development Prompt.md` (repo root — read this first for the actual product requirements; §58 lists the build order the whole project followed). Next.js App Router + Supabase (Postgres + RLS + Auth), deployed to Vercel.

## Current status: 21 of 23 build-sequence items done

Per the spec's §58 build sequence, items 1–21 are complete, task-reviewed, and pushed to `origin/master`:

1. Project architecture, 2. Database schema, 3. Authentication, 4. Roles/RLS/security, 5. Application settings/timezone, 6. Menu data model, 7. Menu approval/versioning, 8. User dashboard, 9. Daily thali request workflow, 10. 6 PM server-side cutoff, 11. Portion management, 12. Admin dashboard and calculations, 13. Leave/no-service system, 14. User search, 15. Concern system, 16. Super-admin user management, 17. Notifications, 18. Reports, 19. Audit logging, 20. PWA, 21. Accessibility.

**Remaining:**
- **22. Automated testing** — unit tests for cutoff/portion/roti-total/leave-detection/menu-status logic and integration tests for most business rules already exist (see `src/lib/**/*.test.ts` and `src/lib/supabase/*.integration.test.ts`), but there is **no E2E test suite** (spec §50 asks for Playwright or equivalent, focused on role-security scenarios — genuinely not started).
- **23. Production hardening** — no single spec section owns this; it's a synthesis of §28 (Security: rate limiting for sensitive endpoints is not implemented anywhere, CSRF posture hasn't been explicitly reviewed), §54 (Performance: DB indexes exist per-migration but haven't been audited as a set), and §52 (Development Deliverables: deployment instructions don't exist yet — no Vercel config, no production secrets-management doc).

There is no branch structure — every phase was implemented and pushed directly to `master`. `git log --oneline` is the authoritative history; each phase is a small run of commits bracketed by a `docs: add Phase N design doc` / `docs: add Phase N implementation plan` pair and the implementation commits that follow.

## Where everything is documented

- **Product spec**: `FMBRequestThali Web App — Complete Development Prompt.md` (repo root) — the source of truth for requirements. Numbered sections (§1–§60); §58 is the build order, §59 is the final validation checklist.
- **Per-phase design docs**: `docs/superpowers/specs/2026-*-phaseN-*-design.md` — one per phase, each explaining *why* that phase is shaped the way it is (architecture choices, scope-in/scope-out reasoning, rejected alternatives). Read the relevant one before touching a feature area — it usually explains a non-obvious constraint.
- **Per-phase implementation plans**: `docs/superpowers/plans/2026-*-phaseN-*.md` — the literal task-by-task build record for each phase, with exact code.
- This handoff doc, plus `README.md` (setup) and `AGENTS.md` (Next.js-version-specific notes — **read this if you're an AI agent working here**, it flags that this Next.js version has behavior diverging from most training data).

## How this was built (relevant if you're continuing with Claude Code)

Every phase went through the same four-stage pipeline (a `superpowers` plugin skill sequence): **brainstorming** (produces the design doc) → **writing-plans** (produces the implementation plan) → **subagent-driven-development** (dispatches a fresh implementer + independent reviewer per task, plus a final whole-branch review) → **finishing-a-development-branch** (test verification, then push). If you're an AI agent continuing this work, follow the same pipeline for consistency — the user has consistently approved this process phase after phase. If you're a human, the design docs are the fastest way to understand *why* a given piece of the app looks the way it does.

## Conventions established across every phase (read before writing new code)

These are load-bearing, not stylistic — several were bugs caught mid-session and then enforced everywhere after:

- **Every Supabase query destructures and checks `error` before using `data`.** Never let a failed query fail open into a fabricated zero-count or empty state — show a red-banner error instead (`bg-red-50 ... text-red-700`, now with `role="alert"`, see every page under `src/app/(app)/**`).
- **Never embed two tables with more than one FK path in a single `.select()`** (PostgREST's PGRST201 ambiguous-embed error). Query separately, join in application code — the "two-query-no-embed" pattern used in every admin/report page.
- **`FormData.get()` returns `null`, not `undefined`**, for a missing field — Zod schemas for form input must use `.nullable().optional()`, not just `.optional()`.
- **`.single()` throws on zero rows** — use `.maybeSingle()` whenever zero rows is a valid, expected outcome.
- **RLS policies need an `is_admin() OR own-row` branch**, not admin-only, whenever a user must read their own data.
- **Audit logging (Phase 19/Phase 7) uses `SECURITY DEFINER` SQL functions, not client-side inserts** — `actor_id` is always `auth.uid()` set inside the function, never client-supplied. See `supabase/migrations/0022_audit_log_event_rpc.sql` and `src/lib/audit/index.ts`. Extend this pattern for any new administrative write path, don't invent a new one.
- **No privileged/service-role Supabase client exists at runtime except in one file** (`src/app/(app)/super-admin/users/actions.ts`, for Supabase Admin API calls only — never use it for a data write that needs an accurate `actor_id`/`auth.uid()`, since a service-role JWT has no user context).
- **A Next.js "use client" component still gets server-rendered during SSR** — reading a browser-only global (e.g. `navigator.onLine`) in a `useState` lazy initializer runs during SSR too and silently returns the wrong value (Node ships a `navigator` global; it doesn't throw, it just lies). Read browser-only state inside `useEffect`, never in the render path. See `src/components/offline-banner.tsx` and its git history for the exact bug this caused.
- **This Next.js version (16.3.4) is newer than most training data** — `app/manifest.ts`, code-generated `icon.tsx`/`apple-icon.tsx` via `next/og`, and `experimental.useOffline` are real, current APIs, not hallucinations. Read `node_modules/next/dist/docs/` directly rather than assuming — see `AGENTS.md`.
- **`eslint.config.mjs` cannot spread `eslint-plugin-jsx-a11y`'s `flatConfigs.recommended` object whole** — it conflicts by plugin-object-identity with the `jsx-a11y` plugin `eslint-config-next` already registers. Only its `rules` key is applied (see the comment in `eslint.config.mjs`); this is intentional, not a workaround to "fix."
- **`role="alert"`/error-banner elements rely on absent→present DOM transitions to announce** — they won't reliably fire on a hard page-load where the error is present in the initial server-rendered HTML (e.g. a `<form method="get">` page). This is a known, accepted gap (see Phase 9's final review notes), not something to "fix" reflexively if you notice it.

## Known issues (pre-existing, not regressions)

- **Plain `npm install` fails** on a peer-dependency conflict (`vitest@5` wants `@types/node@^22`, root pins `@types/node@^20`). Use `npm install --legacy-peer-deps`, or fix the underlying version mismatch (bump `@types/node` or pin `vitest` back) if you want a clean `npm install` to work — this hasn't been addressed yet.
- **Two integration tests fail** on a fresh `npx supabase db reset` + `npx vitest run`: `menu-rls.integration.test.ts` (needs `npm run seed:menus` re-run after a `db reset`, since `db reset` wipes fixture data seed scripts don't auto-restore) and `rls.integration.test.ts:34` (a genuinely wrong test assertion — it asserts `error` is non-null for an RLS-blocked `app_settings` write, but Postgres RLS with a `USING` clause silently filters to zero rows rather than raising an error; the assertion should check for zero rows updated instead). Neither is a defect in application code — both are documented as pre-existing in every phase's final review since Phase 7.

## If you're starting the next phase (22 or 23)

Follow the same pipeline as every prior phase: read the relevant spec section(s) above, explore what's already true in the codebase (don't assume a gap exists — several "obvious" gaps this session turned out to already be handled, e.g. most of Phase 9's WCAG requirements were already met before that phase even started), then run the brainstorming → writing-plans → subagent-driven-development → finishing-a-development-branch sequence. For Item 22 specifically, Playwright is not installed in this repo and a prior phase (8) found that headless Chrome launch has a Windows-specific `chrome-launcher` EPERM issue in at least one environment this project has run in — verify E2E tooling actually works in your environment before committing to it in a design.
