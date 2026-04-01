import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { verifyToken } from "../security/index.js";
import { registerIo } from "./io.server.js";
import { registerSocketConnectionHandlers } from "./socket.handlers.js";

export function attachWebSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env["CORS_ORIGIN"]?.split(",") ?? "*",
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    const token =
      typeof socket.handshake.auth["token"] === "string"
        ? socket.handshake.auth["token"]
        : undefined;
    if (!token) {
      next(new Error("Unauthorized"));
      return;
    }
    try {
      const p = verifyToken(token);
      socket.data.userId = p.sub;
      socket.data.role = p.role;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  registerSocketConnectionHandlers(io);
  registerIo(io);

  return io;
}

export type IoServer = Server;
