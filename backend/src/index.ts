import http from "http";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { assignmentsRouter } from "./routes/assignments.js";
import { attachWebSocket } from "./ws.js";

const app = express();
const port = Number(process.env["PORT"] ?? 4000);

app.use(
  cors({
    origin: process.env["CORS_ORIGIN"]?.split(",") ?? true,
    credentials: true,
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/assignments", assignmentsRouter);

const httpServer = http.createServer(app);
attachWebSocket(httpServer);

httpServer.listen(port, () => {
  console.log(`ShiftSync API listening on :${port}`);
});
