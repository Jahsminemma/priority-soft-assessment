import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import {
  adminInvitesRouter,
  analyticsRouter,
  auditRouter,
  authRouter,
  assignmentsRouter,
  clockRouter,
  coverageRouter,
  locationsRouter,
  meRouter,
  notificationsRouter,
  registerRouter,
  scheduleRouter,
  shiftsRouter,
  skillsRouter,
} from "./http/routes/index.js";
import { attachWebSocket } from "./realtime/index.js";

const app = express();
const port = Number(process.env["PORT"] ?? 4000);

app.use(
  cors({
    origin: process.env["CORS_ORIGIN"]?.split(",") ?? true,
    credentials: true,
  }),
);
app.use(express.json());

/** Avoid stale JSON in browser HTTP cache when switching weeks / refetching lists. */
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/admin", adminInvitesRouter);
app.use("/api/register", registerRouter);
app.use("/api/me", meRouter);
app.use("/api/audit", auditRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/clock", clockRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/shifts", shiftsRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/assignments", assignmentsRouter);
app.use("/api/schedule", scheduleRouter);
app.use("/api/coverage", coverageRouter);
app.use("/api/notifications", notificationsRouter);

const httpServer = http.createServer(app);
attachWebSocket(httpServer);

httpServer.listen(port, () => {
  console.log(`ShiftSync API listening on :${port}`);
});
