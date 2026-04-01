import type { Server } from "socket.io";

let io: Server | null = null;

export function registerIo(server: Server): void {
  io = server;
}

export function getIo(): Server | null {
  return io;
}
