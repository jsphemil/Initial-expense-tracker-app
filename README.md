# Personal Expense Tracker

A full-stack expense tracking app with account-based ledgering, transfers, recurring rules, category memory, dashboard analytics, and CSV export.

## Live Deployments
- Frontend: https://initial-expense-tracker-app.vercel.app
- Backend: https://expense-tracker-api-vvwp.onrender.com

## Core Features
- Email/password auth with JWT
- Multi-account tracking with opening balances (supports negative balances for credit)
- Income and expense transactions
- Account-to-account transfers (saved as linked two-row ledger entries)
- Recurring income/expense rules:
  - Every X day/week/month/year
  - End date
  - Manual trigger + scheduled processing
- Category memory and dropdown suggestions (income/expense separated)
- Dashboard analytics:
  - Total balance, total income/expense
  - Monthly net and savings rate
  - Top expense category
  - Category chart toggle (pie/bar/line)
  - Daily expense calendar
  - Account-wise monthly summary
- Transaction filters/search and CSV export
- Mobile-responsive futuristic blue/green UI

## Tech Stack
- Frontend: React + Vite, Axios, Recharts, React Calendar, Day.js
- Backend: Node.js, Express, better-sqlite3, JWT, bcryptjs, rate limiting, CORS
- Database: SQLite
- Deployment: Render (backend), Vercel (frontend)

## Repository Structure
- `frontend/` - React app
- `backend/` - Express API + SQLite schema/migrations
- `docs/HANDOFF.md` - low-context resume checkpoint notes
- `render.yaml` - Render service blueprint

## Environment Variables

### Backend (`backend/.env`)
- `PORT=4000`
- `JWT_SECRET=<long_random_secret>`
- `FRONTEND_ORIGIN=<frontend_url_or_csv_list>`
- `CRON_SECRET=<secret_for_internal_recurring_endpoint>`
- Optional: `DB_FILE=<sqlite_filename>`

### Frontend (`frontend/.env`)
- `VITE_API_BASE_URL=<backend_base_url_without_/api>`

## Local Setup

1. Install backend dependencies
```bash
cd backend
npm install
```

2. Install frontend dependencies
```bash
cd ../frontend
npm install
```

3. Configure env files
- Copy `backend/.env.example` -> `backend/.env`
- Copy `frontend/.env.example` -> `frontend/.env`

4. Run backend
```bash
cd backend
npm start
```

5. Run frontend
```bash
cd frontend
npm run dev
```

## Useful Scripts

### Frontend
- `npm run dev`
- `npm run lint`
- `npm run build`

### Backend
- `npm start`
- `npm test` (requires environment where process spawn is allowed)

## API Highlights
- Health: `GET /api/health`
- Auth: `POST /api/auth/register`, `POST /api/auth/login`
- Accounts: `GET/POST /api/accounts`, `PATCH /api/accounts/:id`, `PATCH /api/accounts/:id/initial-balance`, `DELETE /api/accounts/:id`
- Categories: `GET /api/categories`
- Transactions: `GET/POST /api/transactions`, `PATCH/DELETE /api/transactions/:id`, `GET /api/transactions/export.csv`
- Transfers: `POST /api/transfers`
- Recurring: `GET/POST /api/recurring-rules`, `PATCH/DELETE /api/recurring-rules/:id`, `POST /api/recurring-rules/run`
- Internal scheduler endpoint: `POST /api/internal/run-recurring` with `x-cron-secret`

## Deployment Notes
- Backend should be deployed before frontend updates.
- Set backend `FRONTEND_ORIGIN` to your final frontend URL.
- Set backend `CRON_SECRET` for secure recurring trigger endpoint.
- See `DEPLOYMENT.md` for full deployment sequence.

## Known Notes
- Frontend production build currently reports a large bundle warning (non-blocking).
- Existing transfer rows are edited by delete-and-recreate flow (direct row edit blocked intentionally).

## Pause/Resume Workflow (Optimized Context)
- Stable checkpoint tag: `checkpoint-2026-03-29`
- Handoff file: `docs/HANDOFF.md`
- Resume prompt:
  - "Continue from `checkpoint-2026-03-29` on `main`. Read `docs/HANDOFF.md` only, then implement <single scoped task>."
