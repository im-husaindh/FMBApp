# Bottom Navigation Bar — Design Spec

**Date:** 2026-09-12
**Status:** Approved for implementation

---

## Goal

Add a persistent, role-aware bottom tab bar and a minimal top header to all authenticated pages, replacing the current ad-hoc inline navigation links scattered across the dashboard and admin pages.

---

## Current State

- `src/app/(app)/layout.tsx` — renders only a notification bell in a top strip
- `src/app/(app)/dashboard/page.tsx` — inline logout button, inline role links (Admin Panel, Super Admin Panel, Raise Food Concern)
- `src/app/(app)/admin/page.tsx` — button grid for sub-pages (kept as-is; nav bar covers top-level only)
- No shared nav component exists

---

## Design

### Top Header Strip

A narrow bar across the top of every authenticated page.

- **Left:** App name "FMB" (or wordmark, plain text is fine for now)
- **Right:** "Log Out" button (form action, same `logoutAction` from dashboard)

The existing notification bell moves to the bottom tab bar (as the Notifications tab).

### Bottom Tab Bar

Fixed to the bottom of the viewport. Shows only tabs appropriate to the current user's role.

| Tab label | Icon | Route | Visible to |
|-----------|------|-------|------------|
| Home | 🏠 | `/dashboard` | user, admin, super_admin |
| Concerns | 💬 | `/concerns` | user, admin, super_admin |
| Notifications | 🔔 | `/notifications` | user, admin, super_admin |
| Admin | ⚙️ | `/admin` | admin, super_admin |
| Super Admin | 🛡️ | `/super-admin` | super_admin |

- Active tab is highlighted (bold label + accent color underline or filled background)
- Notifications tab shows the unread badge count (red pill) when > 0
- Tab bar has a top border to separate it from page content

### Layout Adjustments

- All authenticated pages get `padding-bottom` sufficient to clear the fixed bottom bar (~64–80px)
- Applied via a wrapper `<div>` in `(app)/layout.tsx`, not per-page

---

## Component Architecture

### `src/components/nav/top-header.tsx` — Server Component

Receives `profile` (for logout action availability). Renders the app name and a logout form.

```
TopHeader
├── "FMB" wordmark (left)
└── <form action={logoutAction}><button>Log Out</button></form> (right)
```

### `src/components/nav/bottom-tab-bar.tsx` — Client Component

Receives: `role`, `unreadCount`.

Uses `usePathname()` to determine the active tab. Renders only the tabs the role has access to. Marks the matching tab active.

```
BottomTabBar
├── Tab: Home → /dashboard
├── Tab: Concerns → /concerns
├── Tab: Notifications → /notifications (+ badge)
├── Tab: Admin → /admin (admin + super_admin only)
└── Tab: Super Admin → /super-admin (super_admin only)
```

### `src/app/(app)/layout.tsx` — Updated Shell

Fetches `profile` and `unreadCount` (already does this). Composes the full shell:

```
AppLayout
├── TopHeader (profile)
├── <div class="pb-20">{children}</div>
└── BottomTabBar (role, unreadCount)
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/nav/top-header.tsx` | **New** — top bar with app name + logout |
| `src/components/nav/bottom-tab-bar.tsx` | **New** — client component, role-aware tabs with active state |
| `src/app/(app)/layout.tsx` | Updated — compose TopHeader + BottomTabBar, pass role + unreadCount |
| `src/app/(app)/dashboard/page.tsx` | Remove inline logout button and role-based nav links (moved to nav bar) |

Admin/super-admin sub-pages are **not** changed — their internal button grids remain.

---

## Active Tab Detection

`usePathname()` returns the current path. A tab is active when the current path starts with its route:

- `/dashboard` → Home active
- `/concerns` or `/concerns/...` → Concerns active
- `/notifications` → Notifications active
- `/admin` or `/admin/...` → Admin active (only shown to admin+super_admin)
- `/super-admin` or `/super-admin/...` → Super Admin active

---

## Accessibility

- Each tab is an `<a>` (or `<Link>`) with `aria-label` including the tab name
- Active tab gets `aria-current="page"`
- Unread badge on Notifications is `aria-label="N unread notifications"`
- Bottom tab bar has `role="navigation"` and `aria-label="Main navigation"`
- Top header has `role="banner"`

---

## Out of Scope

- Animated tab transitions
- Tab bar hiding on scroll
- Per-page sub-navigation within admin/super-admin sections
