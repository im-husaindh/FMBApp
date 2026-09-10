# FMBRequestThali — Phase 9: Accessibility Design

Source spec: `FMBRequestThali Web App — Complete Development Prompt.md` §33 (Accessibility, ~line 1312: "Target WCAG AA accessibility standards" — keyboard navigation, proper labels, semantic HTML, screen-reader support, sufficient contrast, focus states, large clickable/tappable areas, text alternatives, accessible modal dialogs, no important information conveyed only through colour), build sequence item 21, §59 checklist item "Keyboard navigation works." Builds on every prior phase's shipped UI (Phases 1-8, all merged/pushed to `master`) — this phase touches existing files only, no new subsystem.

## Why this shape

This is a remediation phase, not a new-subsystem phase, so it started with an audit rather than a design proposal: a systematic codebase survey (semantic HTML, focus states, color-only information, text alternatives, modal dialogs, keyboard navigation, contrast, page structure) against §33's explicit checklist, plus a check of what ESLint accessibility tooling already exists. The audit found this app already disciplined on WCAG AA basics — a direct consequence of §30's "Elderly-Friendly UI/UX" requirement (large touch targets, strong contrast, big text) having been a running convention since Phase 1, which overlaps heavily with §33's requirements. Rather than assume gaps and build speculative fixes, the scope below is exactly what the audit found broken — two concrete, scoped defects plus one tooling gap — not a general-purpose accessibility framework this app doesn't need.

## Scope

**In Phase 9:**
1. `role="alert"` added to every error-banner element (25 files, mechanical batch edit, identical pattern in each).
2. Real `<th>` header markup on the 3 `/admin/reports/*` pages whose tables currently use only `<td>` cells (`daily`, `range`, `concerns`).
3. `eslint-plugin-jsx-a11y` added as a direct `devDependency` (pinning the version already resolved transitively via `eslint-config-next`, 6.10.2 — not a new/different version) and its `flatConfigs.recommended` preset enabled in `eslint.config.mjs`, plus fixing whatever new findings that surfaces beyond the two items above.
4. A live contrast spot-check of `text-gray-500` usage (the one color combination the audit flagged as worth verifying with a real tool rather than visual estimation) — verification only, code changes only if a real AA failure is found.

**Explicitly not in Phase 9:**
- Accessible modal dialogs (§33 names this explicitly) — no modal/dialog/popover component exists anywhere in this codebase (confirmed by grep across `src/components/**` and `src/app/**` for "modal"/"dialog"/`<dialog>`/overlay patterns). Nothing to remediate; inventing a modal to satisfy a checklist item this app has no use for would violate this project's own YAGNI discipline.
- Any change to semantic HTML structure, form label associations, focus-state styling, keyboard operability of the one custom widget (the gravy/rice/roti selector in `thali-request-card.tsx`), or heading hierarchy — the audit found all of these already correct across every sampled page and component.
- A full automated contrast-ratio scan of every color pair in the app — the audit's manual pass found only one color (`text-gray-500`) worth a real check; everything else (body text, headings, buttons) already uses high-contrast combinations established since Phase 1's large-text/strong-contrast conventions.
- Any change to `jsx-a11y`'s `strict` preset (more aggressive, more prone to false-positive-style findings on a codebase that's already largely clean) — `recommended` is the correct, standard tier for this app's actual gap profile.

## `role="alert"` on error banners

All 25 files follow one identical JSX shape (verified via `grep -l bg-red-50`), exemplified by `src/app/(auth)/login/page.tsx:21-25`:

```tsx
{error && (
  <p className="rounded-lg bg-red-50 px-4 py-3 text-center text-lg text-red-700">
    Incorrect email or password.
  </p>
)}
```

Fix: add `role="alert"` to the element in each of the 25 files. No other change — these elements already render conditionally (only present in the DOM when an error actually exists), which is exactly the behavior `role="alert"` needs to trigger a screen reader announcement: the element must be absent-then-present, not present-but-hidden, for the live-region semantics to fire. No `aria-live` attribute is needed alongside it — `role="alert"` implies `aria-live="assertive"` per the ARIA spec.

The 25 files (from the audit's `grep -l bg-red-50 src/`):
`super-admin/audit/page.tsx`, `admin/page.tsx`, `admin/reports/concerns/page.tsx`, `admin/reports/user-history/page.tsx`, `admin/reports/range/page.tsx`, `admin/reports/daily/page.tsx`, `super-admin/users/[id]/page.tsx`, `super-admin/users/page.tsx`, `dashboard/page.tsx`, `notifications/page.tsx`, `concerns/[id]/page.tsx`, `admin/concerns/[id]/page.tsx`, `admin/concerns/page.tsx`, `concerns/page.tsx`, `admin/users/[id]/page.tsx`, `admin/requests/page.tsx`, `admin/users/search/page.tsx`, `super-admin/service-holidays/page.tsx`, `admin/leave/page.tsx`, `super-admin/approvals/page.tsx`, `admin/menu/new/page.tsx`, `admin/menu/[id]/page.tsx`, `(auth)/reset-password/page.tsx`, `(auth)/login/page.tsx`, `(auth)/forgot-password/page.tsx` (all under `src/app/`).

## Report table headers

`src/app/(app)/admin/reports/daily/page.tsx`, `.../range/page.tsx`, and `.../concerns/page.tsx` render label/value summary rows as plain `<tr><td>Label</td><td>Value</td></tr>` inside a bare `<table><tbody>`, e.g. `admin/reports/concerns/page.tsx:85-94`:

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

These are key/value rows (a label paired with its value), not a column-headed data grid — the correct fix is `<th scope="row">` on the label cell, not a `<thead>` row of column headers (there's no natural column header for a "count" column when the row's own label already names what's being counted). Fix, applied to every such row across the 3 pages:

```tsx
<tr key={b.category} className="border-b border-gray-100">
  <th scope="row" className="py-2 text-left font-normal">{b.category}</th>
  <td className="py-2">{b.count}</td>
</tr>
```

`font-normal` counters `<th>`'s default browser bold styling, since these labels were never meant to look bolder than the data next to them — a purely visual no-op, not a semantic concern. `/admin/requests`, `/super-admin/audit`, and `/super-admin/users` (which already use `<thead>`/`<th>` correctly) are not touched.

## `jsx-a11y` ESLint ruleset

`package.json` gets a new `devDependency`: `"eslint-plugin-jsx-a11y": "6.10.2"` (the exact version already resolved transitively — this pins what's already effectively in use, not a version bump). `eslint.config.mjs` changes from:

```ts
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([...]),
]);
```

to additionally spread `jsxA11y.flatConfigs.recommended` (imported from `eslint-plugin-jsx-a11y`) into the config array, after `nextVitals`/`nextTs` so its rules apply on top of (not overridden by) the Next.js presets. Exact insertion point and any config-shape adjustment (the flat-config preset may need `files: ['**/*.{jsx,tsx}']` scoping, matching how `eslint-config-next` itself is structured) gets finalized in the implementation plan by reading the actual installed package's flat-config export shape at that point, not guessed here.

After enabling it, `npm run lint` is run once to see what it flags. Two categories of outcome:
- Findings matching this design's own already-identified gaps (the error banners, the report tables) — those are fixed by the tasks above regardless of whether the linter also flags them.
- Any NEW finding the linter surfaces that the manual audit missed — fixed as part of this phase per the resolved scope decision, not deferred, since the audit's own assessment is that this codebase is disciplined enough that new findings should be few and mechanical (e.g. a missing `aria-label` the manual grep-based audit didn't happen to check), not architecturally significant.

## Contrast spot-check

`text-gray-500` appears in 12 locations (per the audit), all on secondary/meta text (user codes in parentheses, timestamps, placeholder-style copy) at this app's established large font sizes. Verified live during implementation with an actual contrast-ratio calculation (`#6b7280` gray-500 against `#ffffff` white, this app's near-universal background) — not visual estimation. If the ratio clears WCAG AA's 4.5:1 threshold for normal text (or 3:1 if every usage happens to qualify as "large text" per WCAG's own size threshold), no code change. If it doesn't clear, the fix is a one-line Tailwind class swap (e.g. to `text-gray-600` or `text-gray-700`) applied everywhere `text-gray-500` is used for body-adjacent text — decided at implementation time based on the actual computed ratio, not speculated here.

## Error handling

Not applicable in the traditional sense — this phase doesn't add new failure modes. `role="alert"` on an already-conditionally-rendered element has no failure path of its own (worst case on an unsupported/ancient screen reader: the attribute is simply ignored, a silent no-op degradation, not a broken page). The `<th scope="row">` change is a pure markup swap with the `font-normal` override preventing any visual regression.

## Testing

- No automated test for `role="alert"` presence or `<th>` markup — this project has no component-rendering test infrastructure (confirmed during Phase 8's design: zero `.test.tsx` files, no React Testing Library/jsdom), and introducing one for a batch of attribute additions across 25+ files would be disproportionate, matching the same reasoning Phase 8 already applied to its offline banner.
- `npm run lint` (with the new `jsx-a11y/recommended` ruleset active) is this phase's primary mechanical correctness check — it runs on every task in every phase already, so enabling the ruleset means this phase's own tasks get re-verified by it as a side effect of the existing workflow, and it continues catching regressions in every future phase for free.
- Live verification (manual, post-implementation): spot-check 3-4 pages across different route groups with a browser screen reader (or DevTools Accessibility panel, if a real screen reader isn't available in the implementation environment) to confirm an error banner is actually announced when it appears, and that a report table's row headers are read out correctly. Confirm the `text-gray-500` contrast ratio with an actual online contrast checker or the DevTools color-picker's built-in ratio display.

## Seed data

None needed — this phase touches no database, no Server Action, no RLS.
