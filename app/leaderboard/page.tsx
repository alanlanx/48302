"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { Brand, Lights } from "@/components/chrome";
import { formatPoints } from "@/lib/scoring";
import type { Leaderboard } from "@/lib/types";

export default function LeaderboardPage() {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/leaderboard")
      .then((response) => response.json())
      .then((data: Leaderboard) => {
        if (!cancelled) setBoard(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    const socket = io({ transports: ["websocket", "polling"] });
    socket.emit("board:watch");
    socket.on("board:data", (data: Leaderboard) => setBoard(data));
    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, []);

  return (
    <main className="shell">
      <Lights />
      <Brand compact />
      <section className="paper">
        <div className="cat cat-ckhs">本月排行榜</div>
        <h2 className="q-text" style={{ marginTop: 10 }}>
          {board ? board.monthLabel : "讀取中…"}
        </h2>
        <p style={{ color: "#6d655b" }}>以名字累計，台北時間每個月 1 日換榜。同一個人用同一個名字打，分數會疊上去。</p>
        {failed ? <p className="banner">排行榜暫時讀不到，再試一次。</p> : null}
        {board && board.entries.length === 0 ? <p>這個月還沒有成績。打完一局，名字就會出現在這裡。</p> : null}
        <div className="scores">
          {board?.entries.map((entry) => (
            <div key={entry.name} className="score-row" style={{ background: "#efe6d4", color: "#1a1612" }}>
              <span>{entry.rank}</span>
              <span>{entry.name}</span>
              <strong>{formatPoints(entry.points)}</strong>
            </div>
          ))}
        </div>
      </section>
      {board && board.previousTop.length > 0 ? (
        <section className="card" style={{ marginTop: 12 }}>
          <strong>上月前五 · {board.previousLabel}</strong>
          <div className="scores" style={{ marginTop: 8 }}>
            {board.previousTop.map((entry) => (
              <div key={entry.name} className="score-row">
                <span>{entry.rank}</span>
                <span>{entry.name}</span>
                <strong>{formatPoints(entry.points)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <p className="footer-link">
        <a href="/">回首頁開房間</a>
      </p>
    </main>
  );
}
