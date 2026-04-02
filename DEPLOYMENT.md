# Deployment

ShiftSync is a monorepo: **shared** (types/schemas), **backend** (Express, Prisma, Socket.IO), **frontend** (Vite + React).

## Environment variables


| Variable       | Where          | Purpose                                                                                                                    |
| -------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Backend        | PostgreSQL connection string (Render Postgres, or local dev: `docker-compose.yml` on port **5433**)                        |
| `JWT_SECRET`   | Backend        | Signing key for auth tokens — **must be a strong secret in production**                                                    |
| `PORT`         | Backend        | API port (default `4000`; Render sets this automatically if you use their `PORT`)                                          |
| `CORS_ORIGIN`  | Backend        | Comma-separated allowed browser origins. Set to your Netlify URL(s), e.g. `https://your-app.netlify.app`                   |
| `VITE_API_URL` | Frontend build | Public API base URL. For Netlify, set to your Render API origin, e.g. `https://your-api.onrender.com` (no trailing slash). |


See `.env.production.example` for a concise checklist of values to configure in Render and Netlify.

## Netlify (frontend) + Render (backend + database)

The monorepo uses npm workspaces: **shared must be built before** the package that imports it.

**Netlify**

- Install and build from the **repository root** (not only `frontend/`).
- Example build: `npm ci && npm run build -w @shiftsync/shared && npm run build -w @shiftsync/frontend` (use `yarn` if that is your lockfile).
- Publish directory: `frontend/dist`.
- Set **`VITE_API_URL`** to your Render API’s public HTTPS URL.

**Render**

- Create a **PostgreSQL** instance and a **Web Service** for the API.
- **Build Command:** e.g. `npm ci && npm run build -w shared && npm run build -w backend`
- **Start Command:** e.g. `npm run start -w backend` (runs `node dist/index.js` in the backend workspace).
- **Environment:** `DATABASE_URL` (from Render Postgres), `JWT_SECRET`, `CORS_ORIGIN` (Netlify origin(s)), `NODE_ENV=production`.

Run migrations when deploying or in a one-off shell: `cd backend && npx prisma migrate deploy` (with `DATABASE_URL` set), or add a Render **release command** / deploy script that runs `prisma migrate deploy` before start.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, `npm run build`, and `npm test` on pushes and pull requests to `main`/`master`.

## Local development

1. **Database:** `docker compose up -d` starts Postgres on port **5433** (see `docker-compose.yml`).
2. **App:** from the repo root, `yarn dev` or `npm run dev` runs the backend and frontend together.

