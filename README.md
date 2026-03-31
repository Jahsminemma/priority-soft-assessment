# ShiftSync (Priority Soft assessment)

Monorepo: `shared/` (Zod contracts), `backend/` (Express + Prisma + Socket.IO), `frontend/` (Vite + React).

See [docs/README.md](docs/README.md) for local setup, seed accounts, and current scope.

```bash
npm install
docker compose up -d
# set DATABASE_URL, then:
cd backend && npx prisma migrate deploy && npm run db:seed && cd ..
npm run dev
```
