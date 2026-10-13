export type Category = "line" | "ckhs" | "taipei";

export type BoardEntry = {
  name: string;
  points: number;
  rank: number;
};

export type Leaderboard = {
  month: string;
  monthLabel: string;
  entries: BoardEntry[];
  previousMonth: string;
  previousLabel: string;
  previousTop: BoardEntry[];
};

export type Phase = "lobby" | "question" | "reveal" | "final";

export type PublicPlayer = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  answered: boolean;
  correct?: boolean;
  delta?: number;
};

export type PublicQuestion = {
  index: number;
  total: number;
  category: Category;
  categoryLabel: string;
  prompt: string;
  options: string[];
  startAt: number;
  endsAt: number;
  durationMs: number;
  yourChoice: number | null;
  correctIndex?: number;
  explanation?: string;
};

export type RoomState = {
  code: string;
  phase: Phase;
  serverNow: number;
  youId: string;
  isHost: boolean;
  players: PublicPlayer[];
  question: PublicQuestion | null;
  winners: string[];
  board: Leaderboard | null;
  questionCount: number;
};

export type Ack = { ok: true; code?: string } | { ok: false; error: string };
