# ShiftSync — developer notes

## Local setup

1. **Environment**: copy `.env.example` to `.env` in the **repo root** (the API loads this via `dotenv`). Set `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGIN`.

2. **Postgres**: start Postgres (Docker example):

   ```bash
   docker compose up -d
   ```

   Ensure `.env` includes `DATABASE_URL` (e.g. `postgresql://shiftsync:shiftsync@localhost:5432/shiftsync`).

3. **Migrate + seed** (from `backend/`, with `DATABASE_URL` in `.env`):
  ```bash
   cd backend
   npx prisma migrate deploy
   npm run db:seed
  ```

   **Replace the whole database with only seed data** (destructive — deletes all rows and any non-migration state):

   ```bash
   cd backend
   npm run db:reset
   ```

   Prisma will prompt for confirmation, then drop/recreate the schema, apply migrations, and run `prisma db seed`. From repo root: `npm run db:reset`.

   Non-interactive (e.g. scripts): `cd backend && npx prisma migrate reset --force` (still runs the seed).

   Use the same commands against any Postgres by setting `DATABASE_URL` (e.g. Render external URL). **Never** run reset on a production database you care about unless you intend to wipe it.

4. **Run API + UI**:
  ```bash
   cd ..
   npm run dev
  ```
  - API: `http://localhost:4000`
  - UI: `http://localhost:5173` (Vite proxies `/api` to the API)

## Demo logins (seed)


| Role    | Email                      | Password      |
| ------- | -------------------------- | ------------- |
| Admin   | `admin@coastaleats.test`   | `password123` |
| Manager | `manager@coastaleats.test` | `password123` |
| Staff   | `sam@coastaleats.test` … `eve@coastaleats.test` | `password123` |

Seed covers **three locations** (SF, LA, NYC), **skills** (server, bartender, line_cook, host), and the **next ISO week** (Monday of the week after you run seed) with scenarios: partial headcount, DRAFT + PROPOSED, **PENDING SWAP** and **OPEN DROP** coverage, **double-book** and **10h rest** conflicts on Jamie, **>12h day** shift, Sam **Wednesday unavailability**, **weekend-only** staff (Eve), LA line cook understaffed, NYC Thu shifts, optional sample **clock session**, and **hourly rates** for labor/analytics. In-app notifications are not inserted by seed (they come from real workflows). Re-run `npm run db:seed` to re-anchor seeded shifts to the **next** ISO week from that moment. In the app, open the schedule for that week to see the demo shifts.

## Implemented so far

- JWT login + role-aware assignment preview/commit
- Server-side constraint engine (overlap, 10h rest, skill, certification, availability, daily/weekly warnings)
- Prisma schema + rich seed data (locations, skills, multi-scenario schedule)
- Socket.IO server attached (auth on connect); UI wiring for broadcasts comes next

## Assumptions (intentional ambiguities)

Documented in code comments and will be expanded as features land (de-cert history, desired hours vs availability, etc.).