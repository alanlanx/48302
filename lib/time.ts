/** Taiwan does not observe daylight saving. Asia/Taipei is UTC+8 all year. */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taipeiParts(now = Date.now()) {
  const shifted = new Date(now + TAIPEI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export function taipeiMonth(now = Date.now()) {
  const parts = taipeiParts(now);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number) {
  const [year, mon] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string) {
  const [year, mon] = month.split("-");
  return `${year}年${Number(mon)}月`;
}
