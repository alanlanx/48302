import fs from "node:fs";
import path from "node:path";
import { monthLabel, shiftMonth, taipeiMonth } from "@/lib/time";
import type { Leaderboard } from "@/lib/types";
import { nameKey } from "@/lib/names";

type RecordRow = {
  key: string;
  name: string;
  month: string;
  points: number;
  updatedAt: number;
};

type FileShape = { records: RecordRow[] };

function dataFile() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "leaderboard.json");
}

function readStore(): FileShape {
  const file = dataFile();
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as FileShape;
    if (!parsed || !Array.isArray(parsed.records)) return { records: [] };
    return parsed;
  } catch {
    return { records: [] };
  }
}

function writeStore(store: FileShape) {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, file);
}

function prune(records: RecordRow[], month: string) {
  const oldest = shiftMonth(month, -14);
  return records.filter((row) => row.month >= oldest);
}

export function addPoints(displayName: string, points: number, now = Date.now()) {
  if (points <= 0) return;
  const month = taipeiMonth(now);
  const key = nameKey(displayName);
  const store = readStore();
  const existing = store.records.find((row) => row.key === key && row.month === month);
  if (existing) {
    existing.points += points;
    existing.name = displayName;
    existing.updatedAt = now;
  } else {
    store.records.push({ key, name: displayName, month, points, updatedAt: now });
  }
  store.records = prune(store.records, month);
  writeStore(store);
}

function rank(rows: RecordRow[]) {
  const sorted = rows.slice().sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, "zh-Hant"));
  return sorted.slice(0, 30).map((row, index) => ({
    name: row.name,
    points: row.points,
    rank: index + 1,
  }));
}

export function getBoard(now = Date.now()): Leaderboard {
  const month = taipeiMonth(now);
  const previousMonth = shiftMonth(month, -1);
  const store = readStore();
  const current = store.records.filter((row) => row.month === month);
  const previous = store.records.filter((row) => row.month === previousMonth);
  return {
    month,
    monthLabel: monthLabel(month),
    entries: rank(current),
    previousMonth,
    previousLabel: monthLabel(previousMonth),
    previousTop: rank(previous).slice(0, 5),
  };
}

export function resetStoreForTests() {
  const file = dataFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
