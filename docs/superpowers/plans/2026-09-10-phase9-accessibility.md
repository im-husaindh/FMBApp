# FMBRequestThali — Phase 9: Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Error banners are announced to screen readers, report tables have real header semantics, and the fuller `jsx-a11y` ESLint ruleset is enabled and passing — closing the two concrete WCAG AA gaps this phase's audit found, plus catching anything else mechanically.

**Architecture:** Three independent, mechanical remediations to existing files — no new subsystem, no new page, no new component. Each task is a batch edit of the same shape repeated across several files.

**Tech Stack:** Next.js/React JSX, ESLint flat config, `eslint-plugin-jsx-a11y` (already installed transitively, promoted to a direct dependency).

**Spec:** `docs/superpowers/specs/2026-09-10-phase9-accessibility-design.md`

## Global Constraints

- No automated component-rendering test exists in this repo (confirmed during Phase 8: zero `.test.tsx` files, no React Testing Library/jsdom) — this phase does not introduce one. `npm run lint` (with the new ruleset) and manual/live verification are this phase's correctness checks.
- `eslint-plugin-jsx-a11y` is pinned to `6.10.2` exactly — the version already resolved transitively via `eslint-config-next` in this repo's `node_modules`. Do not let `npm install` float it to a newer version; add it with the exact version string, not a `^`/`~` range.
- Every `role="alert"` addition must land on the exact JSX element whose `className` contains `bg-red-50` — not a wrapping element, not a child element. The design doc's audit used `grep -l` (files containing at least one match) to find 25 *files* — it does not mean exactly one element per file. At least one file (`(app)/admin/reports/range/page.tsx`, confirmed by direct reading during plan-writing) has 3 separate `bg-red-50` elements, one per early-return error branch. Task 1's Step 1 measures the true total occurrence count live rather than assuming 25 — every occurrence in every file gets `role="alert"`, and the final count (Task 1 Step 3) must equal Task 1 Step 1's measured baseline, not a hardcoded 25.
- The `<th scope="row">` fix changes only the label cell of each row to a `<th>`; the value cell stays a `<td>`. Preserve each row's exact existing `className` value and font-weight styling (`font-semibold` stays `font-semibold` where it already was; rows with no explicit font-weight class get `font-normal` added to counter `<th>`'s default browser bold, so unstyled label cells don't suddenly look different from before).
- This phase touches no database, no Server Action, no RLS, no migration — if an implementer finds themselves about to touch any of those, that's a signal of scope drift.

---

### Task 1: `role="alert"` on all 25 error banners

**Files (all under `src/app/`, each modified once):**
- `(app)/super-admin/audit/page.tsx`
- `(app)/admin/page.tsx`
- `(app)/admin/reports/concerns/page.tsx`
- `(app)/admin/reports/user-history/page.tsx`
- `(app)/admin/reports/range/page.tsx`
- `(app)/admin/reports/daily/page.tsx`
- `(app)/super-admin/users/[id]/page.tsx`
- `(app)/super-admin/users/page.tsx`
- `(app)/dashboard/page.tsx`
- `(app)/notifications/page.tsx`
- `(app)/concerns/[id]/page.tsx`
- `(app)/admin/concerns/[id]/page.tsx`
- `(app)/admin/concerns/page.tsx`
- `(app)/concerns/page.tsx`
- `(app)/admin/users/[id]/page.tsx`
- `(app)/admin/requests/page.tsx`
- `(app)/admin/users/search/page.tsx`
- `(app)/super-admin/service-holidays/page.tsx`
- `(app)/admin/leave/page.tsx`
- `(app)/super-admin/approvals/page.tsx`
- `(app)/admin/menu/new/page.tsx`
- `(app)/admin/menu/[id]/page.tsx`
- `(auth)/reset-password/page.tsx`
- `(auth)/login/page.tsx`
- `(auth)/forgot-password/page.tsx`

**Interfaces:** none — pure JSX attribute addition, no new exports, no new types.

- [ ] **Step 1: Measure the true baseline count**

Run: `grep -rc "bg-red-50" src/app --include="*.tsx" | awk -F: '{sum+=$2} END {print sum}'`

This is the authoritative count for Step 3's verification — **do not assume it equals 25**. The 25 files listed above were found via `grep -l` (files containing at least one match), which collapses multiple matches in the same file to one. At least one file (`(app)/admin/reports/range/page.tsx`) has 3 separate `bg-red-50` elements (one per early-return error branch — the "start date after end date" error, the "range too long" error, and the general query-failure `errorState`), so the true total is higher than 25. Write down whatever number this command prints — call it N — and use N (not 25) in Step 3.

- [ ] **Step 2: Add `role="alert"` to every occurrence, in every file**

For each of the 25 files listed above: find **every** JSX element whose `className` string contains `bg-red-50` — some files have exactly one, at least `range/page.tsx` has three, and any file not yet individually confirmed may have more than one (check each file's full content rather than assuming a single early-return pattern). In every file this phase's audit found, each such element is a `<p className="...bg-red-50...">` element — some wrapped in a conditional like `{error && (...)}`, some are a plain `errorState`/inline-return JSX variable returned on a Supabase query error or validation failure. Add a `role="alert"` attribute to each one — for example, in `src/app/(auth)/login/page.tsx`, change:

```tsx
{error && (
  <p className="rounded-lg bg-red-50 px-4 py-3 text-center text-lg text-red-700">
    Incorrect email or password.
  </p>
)}
```

to:

```tsx
{error && (
  <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-center text-lg text-red-700">
    Incorrect email or password.
  </p>
)}
```

Apply the identical transformation (add `role="alert"` to the element carrying `bg-red-50` in its `className`, changing nothing else about that element or any surrounding markup) to the other 24 files. Do not add `aria-live` alongside it — `role="alert"` already implies `aria-live="assertive"` per the ARIA spec, and adding both is redundant.

- [ ] **Step 2 example: `src/app/(app)/admin/reports/daily/page.tsx`**

Change:

```tsx
  const errorState = (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Daily Thali Report</h1>
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load this report. Please try again.
      </p>
    </main>
  );
```

to:

```tsx
  const errorState = (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Daily Thali Report</h1>
      <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load this report. Please try again.
      </p>
    </main>
  );
```

- [ ] **Step 2 example (multi-occurrence file): `src/app/(app)/admin/reports/range/page.tsx`**

This file has 3 separate `bg-red-50` elements. Change:

```tsx
  if (from > to) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        {header}
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          The start date must be on or before the end date.
        </p>
      </main>
    );
  }

  const dates = datesBetween(from, to);
  if (dates.length > MAX_RANGE_DAYS) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        {header}
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Please choose a range of {MAX_RANGE_DAYS} days or fewer.
        </p>
      </main>
    );
  }

  const errorState = (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {header}
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load this report. Please try again.
      </p>
    </main>
  );
```

to:

```tsx
  if (from > to) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        {header}
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          The start date must be on or before the end date.
        </p>
      </main>
    );
  }

  const dates = datesBetween(from, to);
  if (dates.length > MAX_RANGE_DAYS) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        {header}
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Please choose a range of {MAX_RANGE_DAYS} days or fewer.
        </p>
      </main>
    );
  }

  const errorState = (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {header}
      <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load this report. Please try again.
      </p>
    </main>
  );
```

All three get the attribute — they're three independent error states (invalid range order, range too long, query failure), each needs its own announcement when it's the one actually rendered.

For every other file in the list, read the full file first to confirm whether it has one occurrence (most do) or more than one (like this file), rather than assuming a single early-return pattern. Add `role="alert"` to each one found.

- [ ] **Step 3: Verify the count now matches**

Run: `grep -rc 'role="alert"' src/app --include="*.tsx" | awk -F: '{sum+=$2} END {print sum}'`
Expected: equals N, the number written down in Step 1 — not a hardcoded 25.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors or warnings (this task runs before Task 3 enables the fuller `jsx-a11y` ruleset, so only the existing narrow ruleset applies here).

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat: add role=alert to all error banners for screen-reader announcement"
```

---

### Task 2: `<th scope="row">` on report table label cells

**Files:**
- Modify: `src/app/(app)/admin/reports/daily/page.tsx`
- Modify: `src/app/(app)/admin/reports/range/page.tsx`
- Modify: `src/app/(app)/admin/reports/concerns/page.tsx`

**Interfaces:** none — pure JSX element-type change (`<td>` → `<th scope="row">` on label cells only), no new exports, no new types, no change to any of the `compute*Summary` functions these pages already call.

Every table in these 3 files is a label/value row layout — the label cell (always the first `<td>` in each `<tr>`) becomes a `<th scope="row">`; the value cell (always the second `<td>`) is untouched.

- [ ] **Step 1: `daily/page.tsx` — 4 tables**

Change the main summary table from:

```tsx
      <table className="mt-6 w-full text-left">
        <tbody className="text-lg">
          <tr className="border-b border-gray-100">
            <td className="py-2 font-semibold">Date</td>
            <td className="py-2">{date}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <td className="py-2 font-semibold">Total Active Users</td>
            <td className="py-2">{summary.totalUsers}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <td className="py-2 font-semibold">Thali Requested</td>
            <td className="py-2">{summary.thaliCount}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <td className="py-2 font-semibold">No Thali</td>
            <td className="py-2">{summary.noThaliCount}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <td className="py-2 font-semibold">No Response</td>
            <td className="py-2">{summary.noResponseCount}</td>
          </tr>
          <tr>
            <td className="py-2 font-semibold">Leave</td>
            <td className="py-2">{summary.onLeaveCount}</td>
          </tr>
        </tbody>
      </table>
```

to:

```tsx
      <table className="mt-6 w-full text-left">
        <tbody className="text-lg">
          <tr className="border-b border-gray-100">
            <th scope="row" className="py-2 text-left font-semibold">Date</th>
            <td className="py-2">{date}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <th scope="row" className="py-2 text-left font-semibold">Total Active Users</th>
            <td className="py-2">{summary.totalUsers}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <th scope="row" className="py-2 text-left font-semibold">Thali Requested</th>
            <td className="py-2">{summary.thaliCount}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <th scope="row" className="py-2 text-left font-semibold">No Thali</th>
            <td className="py-2">{summary.noThaliCount}</td>
          </tr>
          <tr className="border-b border-gray-100">
            <th scope="row" className="py-2 text-left font-semibold">No Response</th>
            <td className="py-2">{summary.noResponseCount}</td>
          </tr>
          <tr>
            <th scope="row" className="py-2 text-left font-semibold">Leave</th>
            <td className="py-2">{summary.onLeaveCount}</td>
          </tr>
        </tbody>
      </table>
```

(These rows already had `font-semibold` — it's preserved verbatim, `text-left` is added since `<th>` defaults to `text-center` in most browser stylesheets and this table's cells are otherwise all left-aligned via the table's own `text-left` class, which doesn't cascade a text-align override strongly enough against `<th>`'s UA stylesheet default.)

Change the Gravy breakdown table from:

```tsx
      <table className="mt-2 w-full text-left">
        <tbody className="text-lg">
          {summary.gravyBreakdown.map((b) => (
            <tr key={b.label} className="border-b border-gray-100">
              <td className="py-2">{b.label}</td>
              <td className="py-2">{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
```

to:

```tsx
      <table className="mt-2 w-full text-left">
        <tbody className="text-lg">
          {summary.gravyBreakdown.map((b) => (
            <tr key={b.label} className="border-b border-gray-100">
              <th scope="row" className="py-2 text-left font-normal">{b.label}</th>
              <td className="py-2">{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
```

Apply the identical change (same before/after shape, just the variable name) to the Rice breakdown table (`summary.riceBreakdown`, key `b.label`) directly below it.

Change the Roti breakdown table from:

```tsx
      <table className="mt-2 w-full text-left">
        <tbody className="text-lg">
          {summary.rotiBreakdown.map((b) => (
            <tr key={b.quantity} className="border-b border-gray-100">
              <td className="py-2">{b.quantity}</td>
              <td className="py-2">{b.count}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 font-semibold">Total Roti</td>
            <td className="py-2 font-semibold">{summary.totalRotis}</td>
          </tr>
        </tbody>
      </table>
```

to:

```tsx
      <table className="mt-2 w-full text-left">
        <tbody className="text-lg">
          {summary.rotiBreakdown.map((b) => (
            <tr key={b.quantity} className="border-b border-gray-100">
              <th scope="row" className="py-2 text-left font-normal">{b.quantity}</th>
              <td className="py-2">{b.count}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-2 text-left font-semibold">Total Roti</th>
            <td className="py-2 font-semibold">{summary.totalRotis}</td>
          </tr>
        </tbody>
      </table>
```

- [ ] **Step 2: `range/page.tsx` — 4 tables**

Change the main summary table from:

```tsx
          <table className="mt-6 w-full text-left">
            <tbody className="text-lg">
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Total Days</td>
                <td className="py-2">{summary.totalDays}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Total Thalis</td>
                <td className="py-2">{summary.totalThalis}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Average Daily Thalis</td>
                <td className="py-2">{summary.averageDailyThalis.toFixed(1)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">No Thali</td>
                <td className="py-2">{summary.totalNoThali}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">No Response</td>
                <td className="py-2">{summary.totalNoResponse}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 font-semibold">Leave</td>
                <td className="py-2">{summary.totalOnLeave}</td>
              </tr>
              <tr>
                <td className="py-2 font-semibold">Total Roti</td>
                <td className="py-2">{summary.totalRotis}</td>
              </tr>
            </tbody>
          </table>
```

to:

```tsx
          <table className="mt-6 w-full text-left">
            <tbody className="text-lg">
              <tr className="border-b border-gray-100">
                <th scope="row" className="py-2 text-left font-semibold">Total Days</th>
                <td className="py-2">{summary.totalDays}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <th scope="row" className="py-2 text-left font-semibold">Total Thalis</th>
                <td className="py-2">{summary.totalThalis}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <th scope="row" className="py-2 text-left font-semibold">Average Daily Thalis</th>
                <td className="py-2">{summary.averageDailyThalis.toFixed(1)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <th scope="row" className="py-2 text-left font-semibold">No Thali</th>
                <td className="py-2">{summary.totalNoThali}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <th scope="row" className="py-2 text-left font-semibold">No Response</th>
                <td className="py-2">{summary.totalNoResponse}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <th scope="row" className="py-2 text-left font-semibold">Leave</th>
                <td className="py-2">{summary.totalOnLeave}</td>
              </tr>
              <tr>
                <th scope="row" className="py-2 text-left font-semibold">Total Roti</th>
                <td className="py-2">{summary.totalRotis}</td>
              </tr>
            </tbody>
          </table>
```

Change the Gravy Distribution table from:

```tsx
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.gravyBreakdown.map((b) => (
                <tr key={b.label} className="border-b border-gray-100">
                  <td className="py-2">{b.label}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
```

to:

```tsx
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.gravyBreakdown.map((b) => (
                <tr key={b.label} className="border-b border-gray-100">
                  <th scope="row" className="py-2 text-left font-normal">{b.label}</th>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
```

Apply the identical change to the Rice Distribution table (`summary.riceBreakdown`, key `b.label`) directly below it.

Change the Roti Distribution table from:

```tsx
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.rotiBreakdown.map((b) => (
                <tr key={b.quantity} className="border-b border-gray-100">
                  <td className="py-2">{b.quantity}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
```

to:

```tsx
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.rotiBreakdown.map((b) => (
                <tr key={b.quantity} className="border-b border-gray-100">
                  <th scope="row" className="py-2 text-left font-normal">{b.quantity}</th>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
```

- [ ] **Step 3: `concerns/page.tsx` — 2 tables**

Change the By Category table from:

```tsx
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.byCategory.map((b) => (
                <tr key={b.category} className="border-b border-gray-100">
                  <td className="py-2">{b.category}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
```

to:

```tsx
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.byCategory.map((b) => (
                <tr key={b.category} className="border-b border-gray-100">
                  <th scope="row" className="py-2 text-left font-normal">{b.category}</th>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
```

Change the By Status table from:

```tsx
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.byStatus.map((b) => (
                <tr key={b.status} className="border-b border-gray-100">
                  <td className="py-2">{b.status}</td>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
```

to:

```tsx
          <table className="mt-2 w-full text-left">
            <tbody className="text-lg">
              {summary.byStatus.map((b) => (
                <tr key={b.status} className="border-b border-gray-100">
                  <th scope="row" className="py-2 text-left font-normal">{b.status}</th>
                  <td className="py-2">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors or warnings.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/admin/reports/daily/page.tsx src/app/\(app\)/admin/reports/range/page.tsx src/app/\(app\)/admin/reports/concerns/page.tsx
git commit -m "feat: add th scope=row to report table label cells"
```

---

### Task 3: Enable `jsx-a11y` recommended ruleset and fix what it surfaces

**Files:**
- Modify: `package.json`
- Modify: `eslint.config.mjs`
- Modify: any file the new ruleset flags (exact list not known until Step 3 runs — see Step 4)

**Interfaces:** none new — this task only changes lint configuration and whatever source it causes to be flagged.

- [ ] **Step 1: Confirm the currently-installed version**

Run: `node -e "console.log(require('eslint-plugin-jsx-a11y/package.json').version)"`
Expected: `6.10.2` (the version this plan pins — if a different version prints, use that exact version instead in Step 2, since the goal is to pin what's already resolved, not force a specific number regardless of what's actually installed).

- [ ] **Step 2: Add the direct dependency**

In `package.json`, add to the `devDependencies` object (alphabetically, between `"eslint-config-next"` and `"shadcn"`):

```json
    "eslint-plugin-jsx-a11y": "6.10.2",
```

Run: `npm install`
Expected: completes with no version change reported for `eslint-plugin-jsx-a11y` (it was already present transitively at this exact version) — `package-lock.json` gets a new explicit top-level entry for it, but `node_modules/eslint-plugin-jsx-a11y` itself should not change.

- [ ] **Step 3: Enable the ruleset**

Change `eslint.config.mjs` from:

```ts
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

to:

```ts
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  jsxA11y.flatConfigs.recommended,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

- [ ] **Step 4: Run lint and record every finding**

Run: `npm run lint`
Expected: some number of new findings (possibly zero) from the `jsx-a11y/*` rules, on top of a clean pass from the existing Next.js rules (Tasks 1-2's changes are already lint-clean per their own Step 4).

If there are zero new findings: skip to Step 6.

If there are findings: for each one, open the flagged file at the flagged line and fix it using the narrowest correct fix for that specific `jsx-a11y` rule (e.g. `jsx-a11y/label-has-associated-control` → add the missing `htmlFor`/wrap the input; `jsx-a11y/click-events-have-key-events` + `jsx-a11y/no-static-element-interactions` → either add the matching keyboard handler and `role`/`tabIndex`, or — preferred, since this codebase already uses native elements everywhere per Phase 9's audit — change the interactive `<div>`/`<span>` to a real `<button>`/`<a>` if that's a clean fit; `jsx-a11y/anchor-is-valid` → ensure the anchor has a real `href` or is a `<button>` instead). Do not disable any rule with an `eslint-disable` comment to make a finding go away — every finding gets a real fix, since the whole point of this task is closing gaps the manual audit might have missed, not suppressing the tool that found them.

- [ ] **Step 5: Re-run lint after fixes**

Run: `npm run lint`
Expected: clean, zero errors/warnings.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (relevant if Step 4 changed any element type, e.g. a `<div>` becoming a `<button>`, which could require adding a `type="button"` to avoid an implicit form-submit behavior change).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json eslint.config.mjs
git commit -m "feat: enable jsx-a11y recommended ESLint ruleset"
```

If Step 4 found and fixed any issues, stage those files in the same commit (or a clearly-labeled second commit, e.g. `fix: address jsx-a11y findings surfaced by the new ruleset`, if the fixes touch many unrelated files and a split commit is clearer) — controller's call at review time based on how large Step 4's fix set turns out to be.

---

### Task 4: Live verification — contrast and screen-reader spot-check

**Files:** none (no code changes expected — this task is manual/live verification, documented as its own task since it's this phase's actual correctness check for the two things `npm run lint` cannot verify: real screen-reader announcement behavior and computed color contrast ratios).

**Interfaces:** none.

- [ ] **Step 1: Confirm the `text-gray-500` contrast ratio**

Run: `npm run build && npm start`, then open `http://localhost:3000` in a browser (or use a contrast-ratio tool against the known hex values directly, without needing the running server, if a browser isn't available in the implementation environment: Tailwind's `gray-500` is `#6b7280`, and every usage found by the design doc's audit sits on this app's near-universal white (`#ffffff`) background).

Calculate or look up the contrast ratio of `#6b7280` on `#ffffff`. Expected: this pair's ratio is approximately 4.83:1 — if the tool you use reports a ratio at or above 4.5:1, no code change is needed (WCAG AA's threshold for normal-size text). If it reports below 4.5:1, change every `text-gray-500` usage found via `grep -rl "text-gray-500" src/` to `text-gray-600` (Tailwind's next-darker step, `#4b5563`, comfortably clears AA) and re-run `npx tsc --noEmit && npm run lint` to confirm nothing else regressed.

- [ ] **Step 2: Screen-reader / accessibility-tree spot-check of the error-banner fix**

With the server still running from Step 1: navigate to `http://localhost:3000/login`, submit the form with an invalid email/password to trigger the error banner. Using either a real screen reader (VoiceOver on macOS, NVDA on Windows, or a mobile screen reader) or, if none is available in this environment, Chrome DevTools' Accessibility panel (inspect the error `<p>` element and confirm its "Computed Properties" show `role: alert`): confirm the element is exposed with `role="alert"` in the accessibility tree. Expected: role is present and correctly computed — no visual regression to the banner's existing appearance.

- [ ] **Step 3: Spot-check one report table's header semantics**

Navigate to `http://localhost:3000/admin/reports/daily` (as an authenticated admin/super_admin — use this project's existing seeded dev credentials, e.g. `admin1@fmb.test` / `DevPass123!`, per this session's established seed-user convention). Inspect the summary table in DevTools: confirm the first cell of each row is now an actual `<th scope="row">` element (not a `<td>`) in the rendered DOM, and that it visually still reads the same as before (bold label, not shifted or re-colored) except for the Gravy/Rice/Roti breakdown tables' label cells, which are intentionally `font-normal` now (matching their pre-existing un-bolded appearance — confirm this, don't just assume it, since a missed `font-normal` would make those labels unexpectedly bold).

- [ ] **Step 4: Stop the server**

Stop the `npm start` process. No commit for this task unless Step 1 required a `text-gray-500` → `text-gray-600` fix, in which case commit that change now:

```bash
git add src
git commit -m "fix: darken text-gray-500 to text-gray-600 for WCAG AA contrast"
```

(Only if Step 1 actually found a real AA failure — if the ratio already cleared 4.5:1, there is nothing to commit for this task.)
