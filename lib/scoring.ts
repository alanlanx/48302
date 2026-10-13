export const BASE_POINTS = 1000;
export const SPEED_BONUS = 500;

/** Correct answers score 1000, plus up to 500 for answering immediately. */
export function pointsFor(correct: boolean, elapsedMs: number, durationMs: number) {
  if (!correct) return 0;
  const duration = Math.max(1, durationMs);
  const ratio = Math.min(1, Math.max(0, elapsedMs / duration));
  return BASE_POINTS + Math.round(SPEED_BONUS * (1 - ratio));
}

export function formatPoints(points: number) {
  return points.toLocaleString("zh-Hant-TW");
}
