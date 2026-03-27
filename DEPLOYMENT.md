# Deployment Guide

This project is ready for production deployment with:
- Backend: Render (Node web service)
- Frontend: Vercel (React/Vite static app)

## 1. Push code to GitHub

1. Create a GitHub repo.
2. Push this project.

## 2. Deploy backend (Render)

1. In Render, create a new **Web Service** from your repo.
2. Set:
- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
3. Add environment variables:
- `PORT=4000`
- `JWT_SECRET=<long_random_secret>`
- `FRONTEND_ORIGIN=https://<your-vercel-domain>`
4. Deploy and copy backend URL:
- Example: `https://expense-tracker-api.onrender.com`

## 3. Deploy frontend (Vercel)

1. In Vercel, import the same repo.
2. Set:
- Root Directory: `frontend`
- Build Command: `npm run build`
- Output Directory: `dist`
3. Add environment variable:
- `VITE_API_BASE_URL=https://<your-render-backend-domain>`
4. Deploy and copy frontend URL.

## 4. Final production wiring

1. Go back to Render and update:
- `FRONTEND_ORIGIN=https://<your-final-vercel-domain>`
2. Redeploy backend.
3. Open frontend URL and run smoke test:
- Register and login
- Create account
- Add income and expense
- Edit and delete transaction
- Edit and delete account (only if account has no transactions)
- Confirm chart/calendar totals

## Notes

- Do not commit `backend/.env`.
- `backend/.env.example` and `frontend/.env.example` show required variables.
- The backend exposes `GET /api/health` for health checks.
