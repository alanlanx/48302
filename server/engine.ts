import { cleanName, makeRoomCode, nameKey } from "@/lib/names";
import { pointsFor } from "@/lib/scoring";
import type { Category, Leaderboard, RoomState } from "@/lib/types";
import { addPoints, getBoard } from "@/server/leaderboard";
import { CATEGORY_LABEL, QUESTIONS, type Question } from "@/server/questions";

const HOST_GRACE_MS = 15_000;
const ANSWER_GRACE_MS = 400;
const EMPTY_ROOM_MS = 30 * 60 * 1000;

export type LiveQuestion = {
  id: string;
  category: Category;
  categoryLabel: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  startAt: number;
  endsAt: number;
  durationMs: number;
};

type Answer = { choice: number; at: number };
type LastResult = { correct: boolean; delta: number };

export type Player = {
  id: string;
  name: string;
  connected: boolean;
  disconnectedAt: number | null;
  score: number;
  answer: Answer | null;
  last: LastResult | null;
  socketId: string | null;
};

export type Room = {
  code: string;
  hostId: string;
  players: Player[];
  phase: "lobby" | "question" | "reveal" | "final";
  questions: LiveQuestion[];
  index: number;
  revealEndsAt: number;
  used: Set<string>;
  persisted: boolean;
  board: Leaderboard | null;
  emptySince: number | null;
  createdAt: number;
};

export function questionDuration() {
  const value = Number(process.env.QUESTION_MS);
  if (Number.isFinite(value) && value >= 500) return value;
  return 20_000;
}

export function revealDuration() {
  const value = Number(process.env.REVEAL_MS);
  if (Number.isFinite(value) && value >= 200) return value;
  return 8_000;
}

export function questionsPerGame() {
  const value = Number(process.env.QUESTIONS_PER_GAME);
  if (Number.isFinite(value) && value >= 1 && value <= 20) return Math.round(value);
  return 12;
}

function shuffle<T>(items: T[]) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function scaleTargets(count: number) {
  let line = Math.round((count * 8) / 12);
  let ckhs = Math.round((count * 2) / 12);
  let taipei = count - line - ckhs;
  if (taipei < 0) {
    line += taipei;
    taipei = 0;
  }
  if (line < 0) line = 0;
  const sum = line + ckhs + taipei;
  if (sum < count) line += count - sum;
  if (sum > count) line = Math.max(0, line - (sum - count));
  return { line, ckhs, taipei };
}

export function pickQuestions(pool: Question[], count: number) {
  const buckets: Record<Category, Question[]> = {
    line: [],
    ckhs: [],
    taipei: [],
  };
  for (const question of shuffle(pool)) buckets[question.category].push(question);
  const target = scaleTargets(count);
  const picked: Question[] = [];
  (Object.keys(target) as Category[]).forEach((category) => {
    picked.push(...buckets[category].splice(0, target[category]));
  });
  if (picked.length < count) {
    const rest = shuffle([...buckets.line, ...buckets.ckhs, ...buckets.taipei]);
    picked.push(...rest.slice(0, count - picked.length));
  }
  return shuffle(picked).slice(0, count);
}

function toLive(question: Question): LiveQuestion {
  const options = question.options.map((text, index) => ({
    text,
    correct: index === question.correctIndex,
  }));
  const shuffled = shuffle(options);
  return {
    id: question.id,
    category: question.category,
    categoryLabel: CATEGORY_LABEL[question.category],
    prompt: question.prompt,
    options: shuffled.map((option) => option.text),
    correctIndex: shuffled.findIndex((option) => option.correct),
    explanation: question.explanation,
    startAt: 0,
    endsAt: 0,
    durationMs: 0,
  };
}

function drawQuestions(room: Room) {
  const count = questionsPerGame();
  let pool = QUESTIONS.filter((question) => !room.used.has(question.id));
  let picked = pickQuestions(pool, count);
  if (picked.length < count) {
    const seen = new Set(picked.map((question) => question.id));
    const rest = QUESTIONS.filter((question) => !seen.has(question.id));
    picked = picked.concat(pickQuestions(rest, count - picked.length));
  }
  if (room.used.size + picked.length > QUESTIONS.length - count) {
    room.used = new Set(picked.map((question) => question.id));
  } else {
    for (const question of picked) room.used.add(question.id);
  }
  return picked.map(toLive);
}

function findPlayer(room: Room, playerId: string) {
  return room.players.find((player) => player.id === playerId);
}

export function createRoom(input: {
  playerId: string;
  displayName: string;
  now: number;
  code?: string;
}): { ok: true; room: Room } | { ok: false; error: string } {
  const name = cleanName(input.displayName);
  if (!name) return { ok: false, error: "請輸入 1 到 24 個字的名字" };
  if (!input.playerId || input.playerId.length > 80) return { ok: false, error: "玩家資料不正確" };
  const room: Room = {
    code: input.code || makeRoomCode(),
    hostId: input.playerId,
    players: [
      {
        id: input.playerId,
        name,
        connected: true,
        disconnectedAt: null,
        score: 0,
        answer: null,
        last: null,
        socketId: null,
      },
    ],
    phase: "lobby",
    questions: [],
    index: 0,
    revealEndsAt: 0,
    used: new Set(),
    persisted: false,
    board: null,
    emptySince: null,
    createdAt: input.now,
  };
  return { ok: true, room };
}

export function joinRoom(
  room: Room,
  input: { playerId: string; displayName: string; now: number },
): { ok: true } | { ok: false; error: string } {
  const existing = findPlayer(room, input.playerId);
  if (existing) {
    existing.connected = true;
    existing.disconnectedAt = null;
    room.emptySince = null;
    return { ok: true };
  }
  const name = cleanName(input.displayName);
  if (!name) return { ok: false, error: "請輸入 1 到 24 個字的名字" };
  const sameName = room.players.find((player) => nameKey(player.name) === nameKey(name));
  if (sameName && !sameName.connected) {
    const wasHost = room.hostId === sameName.id;
    sameName.id = input.playerId;
    sameName.name = name;
    sameName.connected = true;
    sameName.disconnectedAt = null;
    room.emptySince = null;
    if (wasHost) room.hostId = input.playerId;
    return { ok: true };
  }
  if (sameName) return { ok: false, error: "這個名字已經有人用了，加個註記吧" };
  if (room.players.length >= 40) return { ok: false, error: "這間房間滿了" };
  room.players.push({
    id: input.playerId,
    name,
    connected: true,
    disconnectedAt: null,
    score: 0,
    answer: null,
    last: null,
    socketId: null,
  });
  room.emptySince = null;
  return { ok: true };
}

export function renamePlayer(room: Room, playerId: string, displayName: string) {
  if (room.phase !== "lobby") return { ok: false as const, error: "開打之後就不能改名了" };
  const player = findPlayer(room, playerId);
  if (!player) return { ok: false as const, error: "你不在這個房間" };
  const name = cleanName(displayName);
  if (!name) return { ok: false as const, error: "請輸入 1 到 24 個字的名字" };
  const taken = room.players.some((other) => other.id !== playerId && nameKey(other.name) === nameKey(name));
  if (taken) return { ok: false as const, error: "這個名字已經有人用了，加個註記吧" };
  player.name = name;
  return { ok: true as const };
}

export function disconnectPlayer(room: Room, playerId: string, now: number) {
  const player = findPlayer(room, playerId);
  if (!player) return;
  player.connected = false;
  player.disconnectedAt = now;
  player.socketId = null;
  if (room.players.every((item) => !item.connected)) room.emptySince = now;
}

export function startGame(room: Room, playerId: string, now: number) {
  if (room.hostId !== playerId) return { ok: false as const, error: "只有房主可以開始" };
  if (room.phase !== "lobby") return { ok: false as const, error: "這局已經開始了" };
  if (!room.players.some((player) => player.connected)) {
    return { ok: false as const, error: "還沒有人在線上" };
  }
  room.questions = drawQuestions(room);
  room.index = 0;
  room.persisted = false;
  room.board = null;
  for (const player of room.players) {
    player.score = 0;
    player.answer = null;
    player.last = null;
  }
  beginQuestion(room, now);
  return { ok: true as const };
}

function beginQuestion(room: Room, now: number) {
  const question = room.questions[room.index];
  const duration = questionDuration();
  question.startAt = now;
  question.endsAt = now + duration;
  question.durationMs = duration;
  room.phase = "question";
  for (const player of room.players) {
    player.answer = null;
    player.last = null;
  }
}

export function submitAnswer(room: Room, playerId: string, choice: number, now: number) {
  if (room.phase !== "question") return { ok: false as const, error: "這題已經收卷了" };
  const question = room.questions[room.index];
  if (!question || now > question.endsAt + ANSWER_GRACE_MS) {
    return { ok: false as const, error: "時間到了" };
  }
  const player = findPlayer(room, playerId);
  if (!player) return { ok: false as const, error: "你不在這個房間" };
  if (player.answer) return { ok: true as const };
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) {
    return { ok: false as const, error: "沒有這個選項" };
  }
  player.answer = { choice, at: now };
  return { ok: true as const };
}

function reveal(room: Room, now: number) {
  const question = room.questions[room.index];
  for (const player of room.players) {
    const choice = player.answer?.choice ?? null;
    const elapsed = player.answer
      ? Math.min(question.durationMs, Math.max(0, player.answer.at - question.startAt))
      : question.durationMs;
    const correct = choice === question.correctIndex;
    const delta = pointsFor(correct, elapsed, question.durationMs);
    player.score += delta;
    player.last = { correct, delta };
  }
  room.phase = "reveal";
  room.revealEndsAt = now + revealDuration();
}

function finish(room: Room, now: number) {
  room.phase = "final";
  if (!room.persisted) {
    room.persisted = true;
    for (const player of room.players) {
      if (player.score > 0) addPoints(player.name, player.score, now);
    }
    room.board = getBoard(now);
  }
}

function goNext(room: Room, now: number) {
  room.index += 1;
  if (room.index >= room.questions.length) {
    finish(room, now);
    return;
  }
  beginQuestion(room, now);
}

function ensureHost(room: Room, now: number) {
  const host = findPlayer(room, room.hostId);
  const hostStillHere =
    host && (host.connected || now - (host.disconnectedAt ?? now) < HOST_GRACE_MS);
  if (hostStillHere) return;
  const next = room.players.find((player) => player.connected);
  if (next) room.hostId = next.id;
}

export function advance(room: Room, now: number) {
  const before = `${room.phase}:${room.hostId}:${room.index}`;
  ensureHost(room, now);
  if (room.phase === "question") {
    const question = room.questions[room.index];
    if (question && now >= question.endsAt + ANSWER_GRACE_MS) reveal(room, now);
  } else if (room.phase === "reveal" && now >= room.revealEndsAt) {
    goNext(room, now);
  }
  if (room.players.some((player) => player.connected)) room.emptySince = null;
  return before !== `${room.phase}:${room.hostId}:${room.index}`;
}

export function rematch(room: Room, playerId: string) {
  if (room.hostId !== playerId) return { ok: false as const, error: "只有房主可以再來一局" };
  if (room.phase !== "final") return { ok: false as const, error: "這局還沒打完" };
  room.phase = "lobby";
  room.questions = [];
  room.index = 0;
  room.persisted = false;
  room.board = null;
  for (const player of room.players) {
    player.score = 0;
    player.answer = null;
    player.last = null;
  }
  return { ok: true as const };
}

export function shouldDrop(room: Room, now: number) {
  return room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_MS;
}

export function publicView(room: Room, playerId: string, now: number): RoomState {
  const you = findPlayer(room, playerId);
  const question = room.questions[room.index];
  const showSecrets = room.phase === "reveal" || room.phase === "final";
  const ranked = room.players
    .map((player, index) => ({ player, index }))
    .sort((a, b) => {
      if (room.phase === "lobby") return a.index - b.index;
      return b.player.score - a.player.score || a.index - b.index;
    });
  const maxScore = room.players.reduce((max, player) => Math.max(max, player.score), 0);
  const winners =
    room.phase === "final"
      ? room.players.filter((player) => player.score === maxScore).map((player) => player.name)
      : [];

  return {
    code: room.code,
    phase: room.phase,
    serverNow: now,
    youId: playerId,
    isHost: room.hostId === playerId,
    players: ranked.map(({ player }) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      connected: player.connected,
      isHost: player.id === room.hostId,
      answered: Boolean(player.answer),
      ...(showSecrets && player.last
        ? { correct: player.last.correct, delta: player.last.delta }
        : {}),
    })),
    question:
      question && room.phase !== "lobby" && room.phase !== "final"
        ? {
            index: room.index,
            total: room.questions.length,
            category: question.category,
            categoryLabel: question.categoryLabel,
            prompt: question.prompt,
            options: question.options,
            startAt: question.startAt,
            endsAt: question.endsAt,
            durationMs: question.durationMs,
            yourChoice: you?.answer?.choice ?? null,
            ...(room.phase === "reveal"
              ? { correctIndex: question.correctIndex, explanation: question.explanation }
              : {}),
          }
        : null,
    winners,
    board: room.phase === "final" ? room.board : null,
    questionCount: questionsPerGame(),
  };
}
