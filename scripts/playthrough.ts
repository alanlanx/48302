import { io, type Socket } from "socket.io-client";
import type { Ack, Leaderboard, RoomState } from "../lib/types";

const base = process.env.BASE_URL || "http://127.0.0.1:3456";

function connect(name: string) {
  const socket: Socket = io(base, { transports: ["websocket"] });
  const playerId = crypto.randomUUID();
  const states: RoomState[] = [];
  socket.on("room:state", (state: RoomState) => states.push(state));
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} 連線逾時`)), 8000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return { socket, playerId, name, states, ready };
}

function latest(states: RoomState[]) {
  return states.at(-1);
}

async function waitFor(states: RoomState[], label: string, predicate: (state: RoomState) => boolean) {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    const state = latest(states);
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等不到：${label}，最後狀態 ${latest(states)?.phase}`);
}

async function main() {
  const host = connect("昌佑");
  const guest = connect("英仔");
  await Promise.all([host.ready, guest.ready]);

  const created = await new Promise<Ack>((resolve) => {
    host.socket.emit(
      "room:create",
      { requestId: crypto.randomUUID(), playerId: host.playerId, displayName: host.name },
      resolve,
    );
  });
  if (!created.ok || !created.code) throw new Error("開房間失敗");
  const code = created.code;

  const joined = await new Promise<Ack>((resolve) => {
    guest.socket.emit(
      "room:join",
      { code, playerId: guest.playerId, displayName: guest.name },
      resolve,
    );
  });
  if (!joined.ok) throw new Error(joined.error);

  const lobby = await waitFor(host.states, "兩人大廳", (state) => state.players.length === 2 && state.phase === "lobby");
  if (lobby.code !== code) throw new Error("代碼不一致");
  await waitFor(guest.states, "客人進大廳", (state) => state.players.length === 2);

  host.socket.emit("room:start", { code, playerId: host.playerId });
  const hostQuestion = await waitFor(host.states, "房主題目", (state) => state.phase === "question" && !!state.question);
  const guestQuestion = await waitFor(guest.states, "客人題目", (state) => state.phase === "question" && !!state.question);
  if (hostQuestion.question?.prompt !== guestQuestion.question?.prompt) {
    throw new Error("兩邊題目不一樣");
  }
  if (JSON.stringify(hostQuestion.question?.options) !== JSON.stringify(guestQuestion.question?.options)) {
    throw new Error("兩邊選項不一樣");
  }
  if ("correctIndex" in (hostQuestion.question || {})) throw new Error("題目提早洩漏正解");

  host.socket.emit("room:answer", { code, playerId: host.playerId, choice: 0 });
  guest.socket.emit("room:answer", { code, playerId: guest.playerId, choice: 1 });
  const revealed = await waitFor(host.states, "揭曉", (state) => state.phase === "reveal");
  const guestRevealed = await waitFor(guest.states, "客人揭曉", (state) => state.phase === "reveal");
  if (revealed.question?.correctIndex !== guestRevealed.question?.correctIndex) {
    throw new Error("揭曉不同步");
  }
  if (!revealed.question?.explanation) throw new Error("沒有解析");

  const finished = await waitFor(host.states, "結束", (state) => state.phase === "final");
  await waitFor(guest.states, "客人結束", (state) => state.phase === "final");
  if (finished.winners.length < 1) throw new Error("沒有冠軍");

  const board = (await fetch(`${base}/api/leaderboard`).then((response) => response.json())) as Leaderboard;
  const winner = finished.winners[0];
  if (!board.entries.some((entry) => entry.name === winner && entry.points > 0)) {
    throw new Error(`排行榜沒有 ${winner}`);
  }

  host.socket.emit("room:rematch", { code, playerId: host.playerId });
  await waitFor(host.states, "再來一局回到大廳", (state) => state.phase === "lobby");
  await waitFor(guest.states, "客人回到大廳", (state) => state.phase === "lobby" && state.code === code);

  host.socket.disconnect();
  guest.socket.disconnect();
  console.log(`同步對戰完成：房間 ${code}，冠軍 ${finished.winners.join("、")}，本月 ${board.monthLabel}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
