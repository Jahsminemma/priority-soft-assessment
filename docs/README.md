# ShiftSync — developer notes

## Local setup

1. **Postgres**: copy `.env.example` to `.env` in the repo root (or export vars), then start Postgres:

   ```bash
   docker compose up -d
   ```

2. **Database URL** (example):

   ```bash
   export DATABASE_URL="postgresql://shiftsync:shiftsync@localhost:5432/shiftsync"
   ```

3. **Migrate + seed**:

   ```bash
   cd backend
   npx prisma migrate dev --name init
   npm run db:seed
   ```

4. **Run API + UI**:

   ```bash
   cd ..
   npm run dev
   ```

   - API: `http://localhost:4000`
   - UI: `http://localhost:5173` (Vite proxies `/api` to the API)

## Demo logins (seed)

| Role    | Email                     | Password     |
| ------- | ------------------------- | ------------ |
| Admin   | `admin@coastaleats.test`  | `password123` |
| Manager | `manager@coastaleats.test`| `password123` |
| Staff   | `sam@coastaleats.test`    | `password123` |

## Implemented so far (MVP slice)

- JWT login + role-aware assignment preview/commit
- Server-side constraint engine (overlap, 10h rest, skill, certification, availability, daily/weekly warnings)
- Prisma schema + seed data (4 locations, skills, sample shift)
- Socket.IO server attached (auth on connect); UI wiring for broadcasts comes next

## Assumptions (intentional ambiguities)

Documented in code comments and will be expanded as features land (de-cert history, desired hours vs availability, etc.).
