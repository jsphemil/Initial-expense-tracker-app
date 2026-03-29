# Handoff - Expense Tracker

## Resume In One Prompt (Low Context)
Use this exact prompt next time:

"Continue the Expense Tracker from tag `checkpoint-2026-03-29` on `main`. Read `docs/HANDOFF.md` only, then implement: <single scoped task>. Keep changes backward-compatible and deploy-safe."

## Current Checkpoint
- Date: 2026-03-29
- Branch: `main`
- Last commit hash: `9b5fb18`
- Stable checkpoint tag: `checkpoint-2026-03-29`

## What Is Done
- Branding/UI text updated:
  - App name shown as Personal Expense Tracker.
  - Dashboard header text simplified to Dashboard.
  - Browser tab title set to Expense Tracker.
- Theme refresh to futuristic blue/green palette.
- Calendar styling fixed:
  - Current month readable.
  - Neighbor months muted gray.
  - Active date highlighted with neon accent.
  - Navigation and labels readable.
- Mobile-responsive layout improvements.
- Navbar sections added.
- Onboarding gate for first-time users without accounts.
- Opening balance included in total wallet balance logic.
- Category memory added (income/expense suggestions).
- Transfer flow added as linked two-row accounting entries.
- Recurring transaction rules added:
  - Every X day/week/month/year.
  - End date support.
  - Manual run endpoint + periodic backend processing.
- Transactions improvements:
  - Filters/search.
  - CSV export endpoint + UI action.
- Dashboard insights update:
  - Monthly net, savings rate, top expense category.
  - Expense chart type toggle (pie/bar/line) and themed colors.

## Env Vars (Required)
Backend:
- `JWT_SECRET`
- `FRONTEND_ORIGIN`
- `CRON_SECRET`

Frontend:
- `VITE_API_BASE_URL`

## Deployment Notes
- Deploy backend first, then frontend.
- Keep DB migrations backward-compatible (additive changes only unless planned migration).
- Validate these smoke paths after deploy:
  - Register/login.
  - First account onboarding.
  - Income/expense entry + category suggestion reuse.
  - Transfer creates linked entries.
  - Recurring rule run creates due transactions.
  - Filters and CSV export work.

## Known Caveats
- Frontend build warns about large chunk size (informational, not blocking).
- Local/sandbox automated test process may fail where child process spawn is restricted.

## Suggested Next Backlog (in order)
1. Split large frontend bundle (lazy-load chart/widgets/routes).
2. Add robust backend integration tests in CI runner with process/network permissions.
3. Add edit flow for transfer groups (guided replace instead of direct row edit).
4. Add richer recurring controls (skip dates, pause window, preview occurrences).
5. Add account reconciliation workflow.

## Minimal Context Strategy
When resuming, provide only:
- Repo + branch/tag.
- One target outcome.
- Constraints/deadline.
Do not include full history/logs unless debugging a regression.
