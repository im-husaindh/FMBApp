# Build a Production-Ready Web Application: FMBRequestThali

Act as a senior product architect, UI/UX designer, database architect, security engineer, and full-stack developer.

Design and build a complete, production-ready responsive web application called:

**FMBRequestThali**

The application is a meal/thali request and menu-management system that allows users to indicate whether they require a thali for the following day, select portion sizes, view menus, raise food-related concerns, and allows administrators to manage menus and calculate next-day food requirements.

The application must be extremely easy to understand and operate, including for elderly users who may not be comfortable with technology.

Do not overcomplicate the UI.

The primary objectives are:

- Very few clicks to complete daily actions.
- Large readable text.
- Large touch targets.
- Obvious Yes/No choices.
- Clear status indicators.
- Excellent mobile experience.
- Equally good desktop/laptop experience.
- Strong security and role-based permissions.
- Accurate next-day food requirement calculations.
- Complete audit trail for administrative changes.

---

# 1. Recommended Technology Stack

Use the following stack unless there is a compelling technical reason not to.

## Frontend and Full Stack

- Next.js using the current stable App Router architecture
- React
- TypeScript with strict mode
- Tailwind CSS
- shadcn/ui
- Lucide icons

## Backend

Use Next.js server-side functionality including:

- Server Components where appropriate
- Server Actions for mutations where appropriate
- Route Handlers/API routes where an API endpoint is more suitable

Never rely purely on client-side permission checking.

## Database and Authentication

Use Supabase:

- PostgreSQL database
- Supabase Auth
- Row Level Security
- Realtime where beneficial
- Database triggers/functions where they improve data integrity

Use database-level RLS policies so users cannot obtain unauthorized records even if frontend security is bypassed.

## Hosting

- Vercel for Next.js
- Supabase managed backend/database

## Application Type

Build the website as a responsive **Progressive Web App (PWA)**.

It should work well on:

- Android phones
- iPhones
- Tablets
- Windows PCs
- Macs
- Laptop browsers

Allow supported mobile users to install it to their home screen.

---

# 2. Application Timezone

The application's operational timezone must be configurable but initially set to:

**Asia/Kolkata**

Never determine the 6:00 PM deadline from the user's device clock.

The authoritative deadline must always be calculated server-side.

Store timestamps correctly using timezone-aware database timestamps.

---

# 3. User Roles

There are exactly three primary roles:

1. `user`
2. `admin`
3. `super_admin`

Implement proper RBAC — Role Based Access Control.

Permissions must be enforced both:

- server-side
- database-side using RLS

---

# 4. USER Role

A normal user should have access to:

- Dashboard
- Menu calendar
- Daily thali selection
- Portion selection
- Their own request history
- Their own leave/no-thali dates
- Food concerns
- Their profile
- Notifications

A user must never be able to see another user's personal request information.

---

# 5. ADMIN Role

An admin has everything available to a normal user plus administrative capabilities.

Admin can:

- Create menu
- Edit menu
- Submit menu changes for approval
- View existing approved menus
- Add no-thali/service-off dates
- Add or manage leave/no-thali entries where authorized
- See next-day request counts
- See portion-size summaries
- Search for a particular user
- View a selected user's thali history
- View food concerns
- Update concern status
- See operational reports

Important:

**An admin must NOT be able to directly publish a newly created menu or modified menu.**

Any new menu or change to an existing menu must be submitted to the `super_admin` for approval.

---

# 6. SUPER ADMIN Role

A `super_admin` has all functionality of:

- user
- admin

Additionally, a super admin can:

- Approve menu additions
- Approve menu edits
- Reject menu requests
- Add rejection comments
- Manage users
- Create users
- Activate/deactivate users
- Change appropriate user information
- Assign `user` or `admin` roles
- Manage administrators
- Configure portion sizes
- Configure application settings
- Configure cutoff time
- Configure default behaviour
- View full reports
- View audit logs
- Manage global no-service dates

Protect super-admin operations carefully.

Prevent accidental deletion or demotion of the final active super admin.

---

# 7. Authentication

Build a simple authentication system.

Support:

- Email/mobile/username based login architecture as appropriate
- Password authentication
- Forgot password
- Reset password
- Secure session management
- Logout

Design authentication so additional OTP authentication can be added later without restructuring the entire app.

Keep the login page extremely simple.

Example:

FMBRequestThali

Welcome

[ Mobile / Email ]

[ Password ]

[ LOGIN ]

Forgot Password?

Do not show unnecessary technical information.

---

# 8. USER DASHBOARD

The dashboard is the most important page.

It should answer immediately:

1. What is tomorrow's menu?
2. Have I requested a thali?
3. Can I still change my selection?
4. What are the menus for upcoming days?

At the top of the dashboard display a prominent card:

## Tomorrow's Thali

Example:

**Wednesday, 9 September**

Dal Fry  
Paneer Masala  
Jeera Rice  
Roti  
Salad

Then show:

**Do you need a Thali tomorrow?**

Use TWO very large buttons:

✅ YES, I NEED THALI

❌ NO THALI

These buttons must be extremely easy to tap.

Do not use small radio buttons.

---

# 9. Portion Selection

If the user selects:

**YES, I NEED THALI**

display portion selection.

The configurable food components initially include:

### Gravy

- Small
- Regular
- Large

### Roti

Prefer a quantity selector because roti is count based.

Example:

[-] 3 [+]

Allow the permitted range to be configured by super admin.

### Rice

- Small
- Regular
- Large

The portion-size options should NOT be hard-coded deep into the codebase.

Create configurable portion options so the organisation can modify them later.

For example:

- No Rice
- Small
- Regular
- Large

and:

- 1 Roti
- 2 Roti
- 3 Roti
- 4 Roti

etc.

Super admin should be able to configure allowable options.

---

# 10. Saving a Request

After selecting the portions, show one clear button:

**CONFIRM THALI**

After saving, display an obvious success confirmation.

Example:

✅ Thali Confirmed

Tomorrow — Wednesday, 9 September

Gravy: Regular  
Roti: 3  
Rice: Small

You can change your selection until **6:00 PM today**.

Provide:

**CHANGE SELECTION**

button while modifications are permitted.

Do not silently change a saved request.

---

# 11. 6:00 PM Cutoff Rule

This is a critical business rule.

Users can create or modify tomorrow's thali request only until:

**6:00 PM Asia/Kolkata on the previous day.**

Example:

For Wednesday's thali, the selection closes on:

Tuesday at 6:00 PM.

At exactly 6:00 PM, the selection becomes locked.

Enforce this on the SERVER.

Do not trust:

- browser time
- phone time
- frontend JavaScript

After cutoff display:

🔒 **Request Closed**

"Tomorrow's thali selection closed at 6:00 PM."

If the user already selected a thali, show their final request.

If they selected No Thali, show:

**No Thali Requested**

If no response was submitted, show:

**No Response Submitted Before Cutoff**

Keep these three states separate:

- Thali requested
- No thali requested
- No response

This is important for reporting.

---

# 12. Menu Calendar

The user dashboard must display menus covering:

- previous 3 days
- today
- upcoming 7 days

Use a simple horizontally scrollable card interface on mobile.

On desktop, use a larger calendar/card layout.

Examples:

MON  
7 SEP  
Dal Rice...

TUE  
8 SEP  
Paneer...

TODAY  
9 SEP  
...

THU  
10 SEP  
...

Clearly visually distinguish:

- Past
- Today
- Tomorrow
- Future
- No-thali/service holiday

Tomorrow should be especially prominent.

Click/tap a day to see the complete menu.

---

# 13. Menu Data

A menu can contain flexible items rather than fixed fields.

Recommended model:

Menu

- id
- service_date
- title
- notes
- status
- version
- created_by
- submitted_by
- submitted_at
- approved_by
- approved_at
- rejected_by
- rejected_at
- rejection_reason
- created_at
- updated_at

Menu Items

- id
- menu_id
- item_name
- category
- description
- display_order

Possible categories:

- Gravy
- Dal
- Rice
- Roti/Bread
- Vegetable
- Salad
- Sweet
- Other

Do not require every category.

---

# 14. Menu Approval Workflow

Implement menu versioning and approval.

Possible statuses:

- `draft`
- `pending_approval`
- `approved`
- `rejected`
- `superseded`

Workflow:

Admin creates menu.

↓

Status = Draft

↓

Admin selects:

**Submit for Approval**

↓

Status = Pending Approval

↓

Super Admin reviews it.

Super Admin can choose:

**APPROVE**

or

**REJECT**

If approved:

- Approved menu becomes visible as official menu
- Store approver
- Store approval timestamp

If rejected:

- Require rejection reason
- Admin can edit and resubmit

---

# 15. Editing an Existing Approved Menu

This rule is extremely important.

If an admin changes an already-approved menu:

DO NOT modify the approved live menu immediately.

Instead:

1. Preserve current approved version.
2. Create a new menu revision.
3. Mark revision `pending_approval`.
4. Send it for super-admin approval.
5. Until approved, users continue seeing the previously approved menu.
6. After approval, replace the displayed version with the newly approved version.
7. Preserve old version in menu history.

Show the super admin exactly what changed.

Example:

Menu Change Request

Rice

Old:
Jeera Rice

New:
Veg Pulao

Gravy

Old:
Paneer Butter Masala

New:
Kadai Paneer

Highlight:

- Added items
- Removed items
- Changed items

---

# 16. Admin Dashboard

Create an operational dashboard specifically designed around **tomorrow's requirements**.

At the top display:

## Tomorrow — Wednesday, 9 September

### Summary Cards

TOTAL USERS  
150

THALI REQUIRED  
112

NO THALI  
28

NO RESPONSE  
10

ON LEAVE  
5

Use large easy-to-read cards.

---

# 17. Portion Summary

Below the total, show portion requirements.

Example:

## Gravy

Small: 20  
Regular: 70  
Large: 22

TOTAL: 112

## Rice

No Rice: 8  
Small: 25  
Regular: 60  
Large: 19

TOTAL SERVINGS: 104

## Roti

1 Roti × 5 users  
2 Roti × 20 users  
3 Roti × 65 users  
4 Roti × 22 users

TOTAL ROTIS: 328

Calculate total quantities accurately.

Never calculate critical totals only on the client.

Use server/database calculations.

---

# 18. Admin Detailed Request View

Allow administrator to select the summary and view details.

Example table:

| User | Thali | Gravy | Rice | Roti | Status |
|---|---|---|---|---|---|

Provide filters:

- All
- Thali
- No Thali
- No Response
- Leave
- Small portion
- Regular portion
- Large portion

Provide search.

On phones, convert the table into readable stacked cards.

---

# 19. User Search for Admin

Admin and super admin should have a prominent search.

Search by permitted profile fields such as:

- Name
- User ID/member number
- Mobile number
- Email

Use partial matching where appropriate.

When the admin selects a user, display:

### User Summary

Name  
User ID  
Account status

### Today's Status

Thali / No Thali / Leave

### Tomorrow's Status

Thali / No Thali / No response / Leave

### Portion Selection

Gravy  
Rice  
Roti

### Recent History

Show request history using date-based cards or a simple table.

Do not expose sensitive authentication information.

Never display password hashes or internal auth secrets.

---

# 20. Leave / No-Thali System

Implement two concepts cleanly.

## User Leave / No-Thali Period

An authorised admin may mark a user as unavailable for one or more service dates.

Store:

- user
- from date
- to date
- reason/optional note
- entered by
- created date

A leave automatically means:

**No Thali**

for those dates.

Prevent duplicate conflicting requests.

## Global No-Service / No-Thali Day

Super admin/admin according to configured permissions can create dates when thali service is unavailable to everyone.

Example:

Sunday, 13 September

**No Thali Service**

Reason:

Community Event

When there is a global no-service day:

- User cannot submit a request.
- Admin totals should identify the day as No Service.
- Menu cards should display No Thali Service.
- No user should accidentally be counted.

---

# 21. Food Concerns

Users must be able to raise concerns related to food.

Create a prominent:

**Raise Food Concern**

button.

Keep the form simple.

Fields:

### Concern Date

Default to today.

### Category

Selectable options:

- Taste
- Quality
- Quantity
- Packaging
- Missing Item
- Menu
- Other

### Message

Text area.

### Optional Attachment

Design architecture so an image attachment can be enabled if desired.

### Submit

After submission:

✅ Concern Submitted

"Your concern has been sent to the administration."

---

# 22. Concern Tracking

Each concern should have:

- concern number
- user_id
- concern_date
- category
- message
- attachment_url nullable
- status
- admin_response nullable
- assigned_to nullable
- created_at
- updated_at
- resolved_at

Statuses:

- Open
- Reviewing
- Resolved
- Closed

Users can see only their own concerns.

Admin/super admin can see permitted concerns.

Allow admin to:

- search
- filter
- update status
- enter response
- resolve concern

Users should be able to see administrative responses.

---

# 23. Notifications

Create an in-app notification system.

Possible notifications:

- Tomorrow's menu published
- Menu changed
- Menu change approved
- Reminder to select tomorrow's thali
- Selection deadline approaching
- Concern response received
- Concern resolved

Show a bell icon with unread count.

Build notification architecture so future integrations can add:

- WhatsApp
- SMS
- email
- push notification

Do not tightly couple core business logic to a particular notification provider.

---

# 24. Super Admin User Management

Create:

**Administration → Users**

Display:

- Name
- Member/User ID
- Mobile
- Email
- Role
- Status
- Created date

Actions:

- Add user
- Edit user
- Activate user
- Deactivate user
- Change role
- Reset/request password reset as appropriate
- View user history

Do not permanently delete operational historical records when a user leaves.

Prefer:

`active = false`

or a deactivation mechanism.

Historical thali records must remain available for reports.

---

# 25. Admin Approval Centre

Super admin dashboard should prominently display:

**Approvals Pending**

Example:

3 Menu Approvals

Click to open the approval queue.

Display:

- Menu date
- Admin requesting change
- Request type
- Submitted timestamp
- Current approved version
- Proposed version

Buttons:

✅ APPROVE

❌ REJECT

Rejection must request an explanatory comment.

---

# 26. Database Architecture

Design a normalized PostgreSQL database.

Recommended tables include:

### profiles

- id UUID linked to auth.users
- user_code
- full_name
- mobile
- email
- role
- active
- created_at
- updated_at

Role enum:

- user
- admin
- super_admin

### menus

Contains logical menu/service-date information.

### menu_versions

Stores menu revisions and approval state.

### menu_items

Stores menu items for each version.

### thali_requests

Recommended fields:

- id
- user_id
- service_date
- wants_thali
- gravy_portion_id nullable
- rice_portion_id nullable
- roti_quantity nullable
- submitted_at
- updated_at
- locked_at nullable
- source
- created_at

Create a unique constraint:

`user_id + service_date`

Only one current request should exist per user/date.

Maintain request change history separately.

### thali_request_history

Store changes including:

- request_id
- user_id
- previous_values
- new_values
- modified_by
- modified_at

### portion_options

Configure available portion types.

### user_leaves

### service_holidays

### concerns

### concern_updates

### notifications

### audit_logs

### app_settings

Create any additional normalized tables necessary.

---

# 27. Audit Logging

Administrative changes must be traceable.

Log important actions including:

- Menu created
- Menu edited
- Menu submitted
- Menu approved
- Menu rejected
- User created
- User edited
- User activated/deactivated
- Role changed
- Leave created
- Leave changed
- App setting changed
- Administrative request override if implemented
- Concern status changed

Audit records should contain:

- actor
- action
- entity type
- entity ID
- previous state
- new state
- timestamp
- IP/session metadata where appropriate

Audit records should not be editable by ordinary admins.

---

# 28. Security

Security is critical.

Implement:

- Supabase Auth
- PostgreSQL RLS
- Server-side authorization
- Secure session cookies
- CSRF protection where relevant
- Input validation
- Output sanitization
- Rate limiting for sensitive endpoints
- Schema validation using Zod or equivalent
- Secure secrets management
- No secret keys exposed to frontend
- No service role key exposed to browser

Use the principle of least privilege.

### RLS Examples

User:

- can read their own profile
- can read approved menu data
- can read/write their own thali requests while allowed
- can read/write their own concerns
- can read their own notifications

Admin:

- can access operational data allowed for administration
- cannot approve menu changes
- cannot promote themselves
- cannot bypass super-admin approval

Super admin:

- receives explicitly authorised elevated operations

Never rely on hiding UI buttons as security.

---

# 29. Cutoff-Safe Database Operation

Avoid race conditions around 6:00 PM.

When a user submits a request:

1. Server calculates current application time.
2. Server calculates cutoff.
3. Verify service date is eligible.
4. Check no global service holiday exists.
5. Check user isn't on leave.
6. Verify cutoff hasn't passed.
7. Validate portions.
8. Write/update request in a database transaction.
9. Return saved authoritative result.

If cutoff has passed between loading the screen and pressing Submit, reject modification and display:

**Selection time has closed. Your previous saved selection has been kept.**

---

# 30. Elderly-Friendly UI/UX

This is one of the highest priorities.

The interface must be understandable by somebody with little technical experience.

Follow these principles:

### Typography

- Default body text approximately 17–18px
- Important text 20px+
- Page headings approximately 28–32px
- Strong contrast
- Avoid thin fonts

### Buttons

Use large buttons.

Minimum comfortable touch height:

approximately 48–52px.

Primary actions can be even larger.

### Icons

Use icons together with words.

Good:

✅ Yes, I Need Thali

Bad:

✅

Do not force users to understand unexplained icons.

### Colours

Do not communicate information using colour alone.

Combine:

- icon
- text
- colour

Example:

✅ Confirmed

❌ No Thali

🔒 Closed

### Navigation

Keep primary navigation small and consistent.

For a user:

- Home
- Menu
- My Requests
- Concerns
- Profile

For admin:

- Dashboard
- Requests
- Menu
- Concerns
- Search
- More

For super admin:

Additional administration pages can appear under:

- Administration

On mobile use a large bottom navigation bar for the most common actions.

On desktop use a simple sidebar.

---

# 31. Dashboard Design

Do NOT create a typical complicated enterprise dashboard containing dozens of widgets.

The user's homepage should focus on:

1. Tomorrow
2. Yes/No selection
3. Portion selection
4. Upcoming menus

Everything else is secondary.

---

# 32. Prevent User Mistakes

Use confirmations only when helpful.

Example:

User selects:

NO THALI

Display:

**No thali for Wednesday, 9 September?**

[YES, CONFIRM NO THALI]

[GO BACK]

For thali confirmation show the selected portions before final confirmation when appropriate.

Do not use technical terms like:

- record
- payload
- database
- mutation

in user-facing interfaces.

---

# 33. Accessibility

Target WCAG AA accessibility standards.

Implement:

- Keyboard navigation
- Proper labels
- Semantic HTML
- Screen-reader support
- Sufficient contrast
- Focus states
- Large clickable/tappable areas
- Text alternatives
- Accessible modal dialogs
- No important information conveyed only through colour

---

# 34. Responsive Design

Design mobile-first.

### Mobile

Prioritize:

- One-column layout
- Large cards
- Bottom navigation
- Sticky thali confirmation button where useful
- Horizontal menu-date scrolling

### Tablet

Use two-column layouts where appropriate.

### Desktop

Use sidebar + wider dashboard.

Do NOT simply stretch mobile cards across an entire desktop screen.

Use sensible maximum content widths.

---

# 35. Reports

Admin and super admin should have reporting.

Provide reports such as:

### Daily Thali Report

Date  
Total active users  
Thali requested  
No thali  
No response  
Leave  
Total gravy by size  
Total rice by size  
Total roti

### Date Range Report

Allow:

From Date  
To Date

Summary:

- Total thalis
- Average daily thalis
- No-thali count
- Portion distribution

### User History Report

Search user and display their requests over a selected period.

### Concern Report

Breakdown by:

- category
- status
- date

Design reports so CSV/Excel export can be added or implemented where appropriate.

---

# 36. Admin Next-Day Kitchen View

Create a special highly readable screen:

**Tomorrow's Kitchen Requirement**

This screen should be usable without going through multiple dashboard pages.

Example:

WEDNESDAY  
9 SEPTEMBER

TOTAL THALI

# 112

GRAVY

Small — 20  
Regular — 70  
Large — 22

RICE

No Rice — 8  
Small — 25  
Regular — 60  
Large — 19

ROTI

1 × 5  
2 × 20  
3 × 65  
4 × 22

**TOTAL ROTIS: 328**

NO THALI — 28

NO RESPONSE — 10

LEAVE — 5

Last calculated:

6:00 PM

Provide:

**View Detailed List**

and an appropriate print/export option.

Design this page to be printable on A4 if required.

---

# 37. Status After Deadline

After the daily cutoff, create/freeze an operational snapshot of next day's counts if useful for auditability.

Do not allow later user actions to silently change kitchen totals.

If super admin is allowed an emergency override in the future, it must:

- require a reason
- be logged
- clearly indicate that the request was modified after cutoff

Do not create an invisible override.

---

# 38. Application Settings

Create configurable settings controlled by super admin.

Examples:

Application Name  
Organisation Name  
Timezone  
Daily Cutoff Time  
Default Gravy Portions  
Default Rice Portions  
Maximum Roti Quantity  
Concern Categories  
Reminder Time  
Allow Weekend Service  
Allow Admin User Search  
PWA Settings

Store business configuration centrally instead of scattering constants throughout the application.

---

# 39. Empty States

Handle empty states elegantly.

Examples:

"No menu has been published for this date yet."

"No concerns submitted."

"No pending menu approvals."

"No thali requests found."

"No results found for this user search."

Never show broken or blank sections.

---

# 40. Loading and Error States

Create polished:

- skeleton loading states
- saving states
- success states
- validation messages
- retry states
- offline-friendly messaging

Disable duplicate submit clicks.

Example button transition:

CONFIRM THALI

↓

SAVING...

↓

✅ CONFIRMED

---

# 41. Network Resilience

Because users may use slower mobile connections:

- Minimize unnecessary JavaScript
- Optimize queries
- Cache appropriate menu information
- Avoid unnecessarily large images
- Show clear saving progress
- Never show a success message until server confirmation has been received

If submission fails:

"Your selection was not saved. Please try again."

Do not pretend that a failed request succeeded.

---

# 42. Suggested Pages

Create routes similar to:

### Public/Auth

`/login`

`/forgot-password`

### User

`/dashboard`

`/menu`

`/requests`

`/requests/history`

`/concerns`

`/concerns/new`

`/profile`

`/notifications`

### Admin

`/admin`

`/admin/tomorrow`

`/admin/requests`

`/admin/menu`

`/admin/menu/new`

`/admin/menu/[id]`

`/admin/users/search`

`/admin/concerns`

`/admin/reports`

### Super Admin

`/super-admin`

`/super-admin/approvals`

`/super-admin/users`

`/super-admin/users/[id]`

`/super-admin/settings`

`/super-admin/audit`

Route protection must happen on the server.

Do not assume a protected URL is secure simply because it isn't shown in navigation.

---

# 43. UI Visual Style

Visual style should be:

- Clean
- Calm
- Friendly
- Modern
- Professional
- Minimal
- Accessible
- Community-oriented

Use:

- White/light neutral backgrounds
- Soft cards
- Subtle borders
- Moderate corner radius
- Minimal shadows
- Clear hierarchy
- Generous spacing

Avoid:

- excessive gradients
- glassmorphism
- tiny fonts
- excessive animations
- unnecessarily colourful interfaces
- complex graphs
- cluttered tables
- hidden swipe-only functionality

This is a utility application, so usability is more important than visual novelty.

---

# 44. Example Mobile Home Screen

Conceptually:

--------------------------------

FMBRequestThali        🔔

Good Morning

## Tomorrow

Wednesday, 9 September

### Menu

Paneer Masala  
Dal Fry  
Jeera Rice  
Roti  
Salad

### Do you need a thali?

[ ✅ YES, I NEED THALI ]

[ ❌ NO THALI ]

Selection closes today at:

**6:00 PM**

--------------------------------

### Upcoming Menu

THU 10  
Veg Kofta...

FRI 11  
Dal Makhani...

SAT 12  
Paneer...

--------------------------------

Home | Menu | Requests | Concerns | Profile

---

# 45. Example Confirmed State

Tomorrow's Thali

✅ **CONFIRMED**

Gravy  
Regular

Rice  
Small

Roti  
3

[ CHANGE SELECTION ]

You can make changes until:

**6:00 PM today**

---

# 46. Example Admin Dashboard

Good Morning

## Tomorrow

Wednesday, 9 September

THALI  
**112**

NO THALI  
**28**

NO RESPONSE  
**10**

LEAVE  
**5**

[ VIEW KITCHEN REQUIREMENT ]

### Portions

Gravy  
Small 20 | Regular 70 | Large 22

Rice  
Small 25 | Regular 60 | Large 19

Roti  
Total: **328**

### Pending Work

Menu Approval  
Awaiting Super Admin

Food Concerns  
4 Open

---

# 47. Example Super Admin Dashboard

Good Morning

## Tomorrow's Thali

112 Required

## Requires Attention

🔔 3 Menu Approvals

⚠️ 4 Open Food Concerns

👥 2 User Management Requests if applicable

### Menu Approval

Wednesday, 9 September

Requested by: Admin

Changes:

Paneer Masala  
→ Kadai Paneer

[ REVIEW ]

---

# 48. Search and Filtering

Provide fast searchable interfaces.

Use debounced search when appropriate.

Support pagination for large datasets.

Do not download the entire user database to the browser simply to search.

Search should happen securely server-side/database-side.

---

# 49. Data Integrity Rules

Enforce critical rules at database/server level where possible.

Examples:

- One thali request per user/service date
- Menu date uniqueness for active logical menu
- Only approved menu version is public
- Leave overrides a normal request appropriately
- Global no-service date prevents request
- Portions required when wants_thali = true
- Portions null/irrelevant when wants_thali = false
- Admin cannot approve own menu through unauthorized APIs
- Deactivated users cannot submit requests
- Cutoff cannot be bypassed using direct API request

---

# 50. Testing

Create meaningful automated tests.

Include:

### Unit Tests

- cutoff calculation
- portion calculations
- total roti calculation
- leave date detection
- menu status transition

### Integration Tests

- User submits thali before 6 PM
- User modifies before 6 PM
- User tries to modify after 6 PM
- User selects no thali
- User on leave
- Global service holiday
- Admin creates menu
- Admin submits approval
- Admin cannot approve
- Super admin approves
- Rejected menu
- User cannot view another user's records
- Deactivated user cannot submit

### End-to-End Tests

Test critical workflows using Playwright or equivalent.

Pay particular attention to role-security tests.

---

# 51. Seed / Demo Data

Include realistic development seed data.

Create:

- 1 super admin
- 2 admins
- approximately 15 sample users
- past 3 days of menus
- today's menu
- next 7 days of menus
- different thali request statuses
- concerns
- one pending menu approval
- one rejected menu version
- leave entries
- one service holiday

Clearly mark credentials as development-only.

Never commit real credentials.

---

# 52. Development Deliverables

Generate the project as a clean production-quality repository.

Include:

- Complete source code
- Database migrations
- RLS policies
- Database constraints
- Seed script
- TypeScript types
- Environment variable template
- README
- Local development instructions
- Deployment instructions
- Testing instructions
- Authentication setup instructions

Use:

`.env.example`

Never include actual production secrets.

---

# 53. Code Quality

Requirements:

- TypeScript strict mode
- Avoid `any`
- Reusable components
- Clear file structure
- Server/client component boundaries used correctly
- Centralized authorization helpers
- Centralized date/cutoff helpers
- Centralized application settings
- Centralized validation schemas
- No duplicate business rules scattered throughout components

Write maintainable code rather than merely producing a visual prototype.

---

# 54. Performance

Optimize for normal community-scale usage while designing it so the database can handle growth.

Use:

- database indexes
- indexed service dates
- indexed user IDs
- indexed menu statuses
- indexed concern statuses
- pagination
- efficient aggregate queries
- server-side calculations
- caching where appropriate

Do not prematurely create unnecessary microservices.

Use a modular monolithic architecture.

---

# 55. Architecture Principle

Prefer:

**Simple architecture + strong database + clear business rules**

over unnecessary complexity.

Do NOT use:

- microservices
- Kubernetes
- separate mobile application
- unnecessary message queues
- Redux unless clearly needed
- complicated state management

This application can be implemented effectively using a well-designed Next.js application and PostgreSQL/Supabase backend.

---

# 56. Future-Ready Architecture

Architect clean interfaces so these features can be added later without a complete rewrite:

- WhatsApp reminders
- Push notifications
- SMS notifications
- Meal ratings
- Multiple meal types such as lunch/dinner
- Multiple kitchens/locations
- QR identification
- User groups/families
- Monthly analytics
- Ingredient quantity forecasting
- Excel/PDF reports

Do NOT implement unnecessary future features now unless they are needed by the current architecture.

---

# 57. Important Business Priority

The application exists primarily to answer one operational question accurately:

**"Exactly how much food needs to be prepared for tomorrow?"**

Everything around thali selection, cutoff rules, portion sizes, leave, menu status and reporting must ultimately ensure that this number is accurate.

The second priority is:

**Make submitting tomorrow's requirement effortless for every user, especially elderly users.**

---

# 58. Build Sequence

Implement the application in this order:

1. Project architecture
2. Database schema
3. Authentication
4. Roles/RLS/security
5. Application settings/timezone
6. Menu data model
7. Menu approval/versioning
8. User dashboard
9. Daily thali request workflow
10. 6 PM server-side cutoff
11. Portion management
12. Admin dashboard and calculations
13. Leave/no-service system
14. User search
15. Concern system
16. Super-admin user management
17. Notifications
18. Reports
19. Audit logging
20. PWA
21. Accessibility
22. Automated testing
23. Production hardening

Do not start by building decorative pages before the database and permission architecture are correct.

---

# 59. Final Validation Checklist

Before declaring the application complete, verify that:

- A normal user cannot access admin APIs.
- Admin cannot access super-admin-only actions.
- Admin cannot approve a menu.
- Menu changes aren't visible until approved.
- Previous menu version remains live while a change is awaiting approval.
- User cannot alter next-day request after 6 PM.
- Changing device time cannot bypass cutoff.
- Direct API requests cannot bypass cutoff.
- User can clearly select Thali or No Thali.
- Portion selections are correctly stored.
- Leave users aren't accidentally counted.
- No-service dates generate no counts.
- Admin totals mathematically equal detailed records.
- Total roti quantity is calculated correctly.
- No Response is kept separate from No Thali.
- All administrative changes are auditable.
- UI works at small mobile widths.
- UI works on desktop.
- Text remains readable for elderly users.
- Keyboard navigation works.
- Important information isn't conveyed by colour alone.
- Loading and error states work.
- Database RLS tests pass.

---

# 60. Expected Output

Do not provide only mockups or pseudo-code.

Build an actual functional application.

First provide:

1. Final architecture and folder structure.
2. Database ER model.
3. SQL/database schema.
4. RLS/security design.
5. User-flow description.
6. UI component/page architecture.

Then implement the complete project.

For major decisions, prioritize:

1. Security
2. Data accuracy
3. Ease of use
4. Accessibility
5. Maintainability
6. Performance
7. Visual appearance

The finished application should feel simple enough that a first-time elderly user can understand what to do within seconds, while the administrative backend remains powerful enough to reliably manage daily thali requirements.