import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { nameKey, normalizeCode } from "../lib/names";
import { pointsFor } from "../lib/scoring";
import { taipeiMonth } from "../lib/time";
import {
  advance,
  createRoom,
  joinRoom,
  publicView,
  rematch,
  startGame,
  submitAnswer,
  type Room,
} from "../server/engine";
import { addPoints, getBoard, resetStoreForTests } from "../server/leaderboard";
import { QUESTIONS, assertQuestionBank } from "../server/questions";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "48302-"));
process.env.DATA_DIR = dataDir;
process.env.QUESTION_MS = "1000";
process.env.REVEAL_MS = "400";
process.env.QUESTIONS_PER_GAME = "4";

const SIMPLIFIED = /[国体东车门问这过发时个为后对还与会经从关书长头贝见页风云电话机场业产广万亿龙马鸟鱼齐启历岁县梦观实战术线网让给吗说们样听见习现点开关干后里么]/;

test("scoring pays a speed bonus on top of a correct answer", () => {
  assert.equal(pointsFor(true, 0, 20_000), 1500);
  assert.equal(pointsFor(true, 10_000, 20_000), 1250);
  assert.equal(pointsFor(true, 20_000, 20_000), 1000);
  assert.equal(pointsFor(false, 0, 20_000), 0);
});

test("Taipei month rolls at 00:00 Asia/Taipei", () => {
  assert.equal(taipeiMonth(Date.parse("2026-01-31T15:59:59.000Z")), "2026-01");
  assert.equal(taipeiMonth(Date.parse("2026-01-31T16:00:00.000Z")), "2026-02");
  assert.equal(taipeiMonth(Date.parse("2026-06-30T15:59:59.000Z")), "2026-06");
  assert.equal(taipeiMonth(Date.parse("2026-06-30T16:00:00.000Z")), "2026-07");
});

test("monthly board keeps last month and resets the new one", () => {
  resetStoreForTests();
  const january = Date.parse("2026-01-15T04:00:00.000Z");
  const february = Date.parse("2026-02-01T00:30:00.000Z");
  addPoints("Gary", 800, january);
  addPoints("昌佑", 400, january);
  addPoints("昌佑", 1500, february);
  addPoints("昌佑", 500, february);
  const board = getBoard(february);
  assert.equal(board.month, "2026-02");
  assert.equal(board.monthLabel, "2026年2月");
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].name, "昌佑");
  assert.equal(board.entries[0].points, 2000);
  assert.equal(board.previousLabel, "2026年1月");
  assert.equal(board.previousTop[0].name, "Gary");
  assert.equal(board.previousTop[1].name, "昌佑");
  assert.equal(getBoard(january).entries[0].name, "Gary");
});

test("names and room codes normalize", () => {
  assert.equal(nameKey("  Alan   Lan "), "alan lan");
  assert.equal(nameKey("英仔"), "英仔");
  assert.equal(normalizeCode("k7mp"), "K7MP");
  assert.equal(normalizeCode("https://play.example.com/r/ab12"), "AB12");
  assert.equal(normalizeCode("https://play.example.com/r/ab12/"), "AB12");
  assert.equal(normalizeCode("沒有"), null);
});

test("question bank is traditional Chinese and large enough", () => {
  const counts = assertQuestionBank();
  assert.ok(counts.line >= 40);
  assert.ok(counts.ckhs >= 12);
  assert.ok(counts.taipei >= 12);
  const ids = new Set(QUESTIONS.map((question) => question.id));
  assert.equal(ids.size, QUESTIONS.length);
  for (const question of QUESTIONS) {
    const blob = `${question.prompt}\n${question.options.join("\n")}\n${question.explanation}`;
    assert.equal(SIMPLIFIED.test(blob), false, `${question.id} has a simplified character`);
    assert.equal(/\d{8,}/.test(blob), false, question.id);
    assert.equal(/https?:\/\//.test(blob), false, question.id);
    assert.equal(blob.includes("\n\n"), false);
  }
});

function playUntilFinal(room: Room, start: number) {
  let now = start;
  let guard = 0;
  while (room.phase !== "final" && guard < 30) {
    guard += 1;
    if (room.phase === "question") {
      const question = room.questions[room.index];
      submitAnswer(room, "host", question.correctIndex, now + 20);
      submitAnswer(room, "guest", (question.correctIndex + 1) % 4, now + 80);
      now = question.endsAt + 400;
      advance(room, now);
    } else if (room.phase === "reveal") {
      now = room.revealEndsAt;
      advance(room, now);
    } else {
      break;
    }
  }
  return now;
}

test("a full game stays in sync, hides answers, then persists the month", () => {
  resetStoreForTests();
  const now = Date.parse("2026-10-13T02:00:00.000Z");
  const created = createRoom({ playerId: "host", displayName: "昌佑", now });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const room = created.room;
  assert.equal(joinRoom(room, { playerId: "guest", displayName: "英仔", now }).ok, true);
  assert.equal(joinRoom(room, { playerId: "other", displayName: "英仔", now }).ok, false);
  assert.equal(startGame(room, "guest", now).ok, false);
  assert.equal(startGame(room, "host", now).ok, true);
  assert.equal(room.questions.length, 4);

  const hostView = publicView(room, "host", now);
  const guestView = publicView(room, "guest", now);
  assert.equal(hostView.question?.prompt, guestView.question?.prompt);
  assert.deepEqual(hostView.question?.options, guestView.question?.options);
  assert.equal("correctIndex" in (hostView.question || {}), false);
  assert.equal(JSON.stringify(hostView).includes(room.questions[0].explanation), false);

  const first = room.questions[0];
  submitAnswer(room, "host", first.correctIndex, now + 10);
  submitAnswer(room, "guest", (first.correctIndex + 1) % 4, now + 50);
  assert.equal(advance(room, now + 200), false);
  assert.equal(room.phase, "question");
  assert.equal(submitAnswer(room, "late", 0, first.endsAt + 5000).ok, false);

  advance(room, first.endsAt + 400);
  assert.equal(room.phase, "reveal");
  const revealed = publicView(room, "host", first.endsAt + 400);
  assert.equal(revealed.question?.correctIndex, first.correctIndex);
  assert.equal(revealed.players.find((player) => player.id === "host")?.score, 1495);
  assert.equal(revealed.players.find((player) => player.id === "guest")?.score, 0);
  assert.deepEqual(revealed.question?.options, publicView(room, "guest", first.endsAt + 400).question?.options);

  const finishedAt = playUntilFinal(room, first.endsAt + 400);
  assert.equal(room.phase, "final");
  const done = publicView(room, "host", finishedAt);
  assert.deepEqual(done.winners, ["昌佑"]);
  assert.ok((done.board?.entries.find((entry) => entry.name === "昌佑")?.points || 0) >= 1490);

  assert.equal(rematch(room, "guest").ok, false);
  assert.equal(rematch(room, "host").ok, true);
  assert.equal(room.phase, "lobby");
  assert.equal(room.players.find((player) => player.id === "host")?.score, 0);
  const before = getBoard(finishedAt).entries.find((entry) => entry.name === "昌佑")?.points || 0;
  assert.equal(startGame(room, "host", finishedAt).ok, true);
  const again = playUntilFinal(room, finishedAt);
  const after = getBoard(again).entries.find((entry) => entry.name === "昌佑")?.points || 0;
  assert.ok(after > before);
});
