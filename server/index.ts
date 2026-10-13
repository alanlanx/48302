import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { Server } from "socket.io";
import type { Ack } from "@/lib/types";
import { normalizeCode } from "@/lib/names";
import { assertQuestionBank } from "@/server/questions";
import { getBoard } from "@/server/leaderboard";
import {
  advance,
  createRoom,
  disconnectPlayer,
  joinRoom,
  publicView,
  rematch,
  renamePlayer,
  shouldDrop,
  startGame,
  submitAnswer,
  type Room,
} from "@/server/engine";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const rooms = new Map<string, Room>();
const createRequests = new Map<string, { code: string; at: number }>();

function freshCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = createRoom({
      playerId: "placeholder",
      displayName: "暫",
      now: Date.now(),
    });
    if (code.ok && !rooms.has(code.room.code)) return code.room.code;
  }
  return `Z${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  assertQuestionBank();
  const httpServer = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    const parsed = parse(req.url || "/", true);
    handle(req, res, parsed);
  });

  const io = new Server(httpServer);

  const bindPlayer = (room: Room, playerId: string | undefined, socketId: string) => {
    const player = room.players.find((item) => item.id === playerId);
    if (!player || !playerId) return;
    player.socketId = socketId;
    player.connected = true;
    player.disconnectedAt = null;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;
    socket.data.code = room.code;
    socket.data.playerId = playerId;
    socket.join(`room:${room.code}`);
  };

  const emitRoom = (room: Room) => {
    const now = Date.now();
    const memberIds = io.sockets.adapter.rooms.get(`room:${room.code}`);
    const targets = new Set<string>(memberIds ? Array.from(memberIds) : []);
    for (const player of room.players) {
      if (player.socketId) targets.add(player.socketId);
    }
    for (const socketId of targets) {
      const socket = io.sockets.sockets.get(socketId);
      const playerId = socket?.data.playerId as string | undefined;
      if (!socket || !playerId) continue;
      socket.emit("room:state", publicView(room, playerId, now));
    }
  };

  const emitBoard = () => {
    io.to("board").emit("board:data", getBoard(Date.now()));
  };

  io.on("connection", (socket) => {
    const reply = (ack: ((result: Ack) => void) | undefined, result: Ack) => {
      if (typeof ack === "function") ack(result);
    };

    socket.on("board:watch", () => {
      socket.join("board");
      socket.emit("board:data", getBoard(Date.now()));
    });

    socket.on(
      "room:create",
      (
        payload: { requestId?: string; playerId?: string; displayName?: string },
        ack?: (result: Ack) => void,
      ) => {
        const now = Date.now();
        const requestId = payload?.requestId || "";
        const previous = requestId ? createRequests.get(requestId) : undefined;
        if (previous && rooms.has(previous.code) && now - previous.at < 10 * 60 * 1000) {
          const room = rooms.get(previous.code)!;
          const joined = joinRoom(room, {
            playerId: payload.playerId || "",
            displayName: payload.displayName || "",
            now,
          });
          if (!joined.ok && !room.players.some((player) => player.id === payload.playerId)) {
            reply(ack, joined);
            return;
          }
          bindPlayer(room, payload.playerId, socket.id);
          emitRoom(room);
          reply(ack, { ok: true, code: room.code });
          return;
        }

        const code = freshCode();
        const created = createRoom({
          playerId: payload?.playerId || "",
          displayName: payload?.displayName || "",
          now,
          code,
        });
        if (!created.ok) {
          reply(ack, created);
          return;
        }
        rooms.set(created.room.code, created.room);
        if (requestId) createRequests.set(requestId, { code: created.room.code, at: now });
        bindPlayer(created.room, payload?.playerId, socket.id);
        emitRoom(created.room);
        reply(ack, { ok: true, code: created.room.code });
      },
    );

    socket.on(
      "room:join",
      (
        payload: { code?: string; playerId?: string; displayName?: string },
        ack?: (result: Ack) => void,
      ) => {
        const code = normalizeCode(payload?.code || "");
        const room = code ? rooms.get(code) : undefined;
        if (!room) {
          reply(ack, { ok: false, error: "找不到這間房間，代碼可能打錯，或房間已經關閉" });
          return;
        }
        const now = Date.now();
        const joined = joinRoom(room, {
          playerId: payload?.playerId || "",
          displayName: payload?.displayName || "",
          now,
        });
        if (!joined.ok) {
          reply(ack, joined);
          return;
        }
        bindPlayer(room, payload?.playerId, socket.id);
        emitRoom(room);
        reply(ack, { ok: true, code: room.code });
      },
    );

    socket.on(
      "room:rename",
      (payload: { code?: string; playerId?: string; displayName?: string }, ack?: (result: Ack) => void) => {
        const room = rooms.get(normalizeCode(payload?.code || "") || "");
        if (!room) {
          reply(ack, { ok: false, error: "找不到這間房間" });
          return;
        }
        const renamed = renamePlayer(room, payload?.playerId || "", payload?.displayName || "");
        if (!renamed.ok) {
          reply(ack, renamed);
          return;
        }
        emitRoom(room);
        reply(ack, { ok: true });
      },
    );

    socket.on(
      "room:start",
      (payload: { code?: string; playerId?: string }, ack?: (result: Ack) => void) => {
        const room = rooms.get(normalizeCode(payload?.code || "") || "");
        if (!room) {
          reply(ack, { ok: false, error: "找不到這間房間" });
          return;
        }
        const started = startGame(room, payload?.playerId || "", Date.now());
        if (!started.ok) {
          reply(ack, started);
          return;
        }
        emitRoom(room);
        reply(ack, { ok: true });
      },
    );

    socket.on(
      "room:answer",
      (
        payload: { code?: string; playerId?: string; choice?: number },
        ack?: (result: Ack) => void,
      ) => {
        const room = rooms.get(normalizeCode(payload?.code || "") || "");
        if (!room) {
          reply(ack, { ok: false, error: "找不到這間房間" });
          return;
        }
        const answered = submitAnswer(room, payload?.playerId || "", Number(payload?.choice), Date.now());
        if (!answered.ok) {
          reply(ack, answered);
          return;
        }
        emitRoom(room);
        reply(ack, { ok: true });
      },
    );

    socket.on(
      "room:rematch",
      (payload: { code?: string; playerId?: string }, ack?: (result: Ack) => void) => {
        const room = rooms.get(normalizeCode(payload?.code || "") || "");
        if (!room) {
          reply(ack, { ok: false, error: "找不到這間房間" });
          return;
        }
        const again = rematch(room, payload?.playerId || "");
        if (!again.ok) {
          reply(ack, again);
          return;
        }
        emitRoom(room);
        reply(ack, { ok: true });
      },
    );

    socket.on("disconnect", () => {
      const code = socket.data.code as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!code || !playerId) return;
      const room = rooms.get(code);
      if (!room) return;
      const player = room.players.find((item) => item.id === playerId);
      if (!player || player.socketId !== socket.id) return;
      disconnectPlayer(room, playerId, Date.now());
      emitRoom(room);
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const changed = advance(room, now);
      if (changed) {
        emitRoom(room);
        if (room.phase === "final" && room.persisted) emitBoard();
      }
      if (shouldDrop(room, now)) rooms.delete(code);
    }
    for (const [id, entry] of createRequests) {
      if (now - entry.at > 10 * 60 * 1000) createRequests.delete(id);
    }
  }, 200);

  httpServer.listen(port, hostname, () => {
    console.log(`48302 開在 http://${hostname}:${port}`);
  });
});
