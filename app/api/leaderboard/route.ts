import { getBoard } from "@/server/leaderboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json(getBoard(Date.now()));
}
