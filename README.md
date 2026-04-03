# ShiftSync (Priority Soft assessment)

Full-stack workforce scheduling: **Express + Prisma + PostgreSQL** API, **React (Vite)** UI, **Socket.IO** for live updates, shared **Zod** contracts in `shared/`.

## Submission links


| Deliverable             | URL                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Working application** | [https://sharesync-ass.netlify.app/](https://sharesync-ass.netlify.app/)                                           |
| **Source code**         | [https://github.com/Jahsminemma/priority-soft-assessment](https://github.com/Jahsminemma/priority-soft-assessment) |


**Brief documentation** (logins, limitations, assumptions, feature summary): **[docs/README.md](docs/README.md)**.

## Architecture

High-level stack: browser (React + Socket.IO client) → Express API (REST + realtime) → shared Zod contracts → Prisma / PostgreSQL.

## Local development

1. **Environment**: copy `.env.example` to `.env` in the **repo root**. Set `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGIN`.
2. **Postgres** (Docker example):
  ```bash
   docker compose up -d
  ```
3. **Migrate + seed** (from `backend/`):
  ```bash
   cd backend
   npx prisma migrate deploy
   npm run db:seed
  ```
   Destructive full reset (local only): `cd backend && npm run db:reset`.
4. **Run API + UI** (repo root):
  ```bash
   npm run dev
  ```
  - API: `http://localhost:4000`
  - UI: `http://localhost:5173` (Vite proxies `/api` and `/socket.io`)

Further deployment checklist: [DEPLOYMENT.md](../DEPLOYMENT.md).