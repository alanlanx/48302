"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { Brand, Lights } from "@/components/chrome";
import { normalizeCode } from "@/lib/names";
import type { Ack } from "@/lib/types";

const PLAYER_KEY = "48302:playerId";
const NAME_KEY = "48302:name";
const CREATE_KEY = "48302:create";

function identity() {
  const playerId = localStorage.getItem(PLAYER_KEY) || crypto.randomUUID();
  localStorage.setItem(PLAYER_KEY, playerId);
  return { playerId, name: localStorage.getItem(NAME_KEY) || "" };
}

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(localStorage.getItem(NAME_KEY) || "");
  }, []);

  function remember(next: string) {
    localStorage.setItem(NAME_KEY, next);
  }

  function createRoom() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("先取一個名字，同學才知道是誰。");
      return;
    }
    setBusy(true);
    setError("");
    remember(trimmed);
    const { playerId } = identity();
    const requestId = sessionStorage.getItem(CREATE_KEY) || crypto.randomUUID();
    sessionStorage.setItem(CREATE_KEY, requestId);
    const socket = io({ transports: ["websocket", "polling"] });
    const timer = window.setTimeout(() => {
      setError("連不上房間。請確認已經執行 npm run dev。");
      setBusy(false);
      socket.disconnect();
    }, 8000);
    socket.emit(
      "room:create",
      { requestId, playerId, displayName: trimmed },
      (ack: Ack) => {
        window.clearTimeout(timer);
        if (!ack.ok || !ack.code) {
          setError(ack.ok ? "開房間失敗" : ack.error);
          setBusy(false);
          socket.disconnect();
          return;
        }
        sessionStorage.removeItem(CREATE_KEY);
        socket.disconnect();
        router.push(`/r/${ack.code}`);
      },
    );
  }

  function joinRoom() {
    const trimmed = name.trim();
    const room = normalizeCode(code);
    if (!trimmed) {
      setError("先取一個名字，同學才知道是誰。");
      return;
    }
    if (!room) {
      setError("房間代碼是四個字，或直接貼上連結。");
      return;
    }
    remember(trimmed);
    router.push(`/r/${room}`);
  }

  return (
    <main className="shell">
      <Lights />
      <Brand />
      <div className="stack">
        <section className="card stack">
          <div>
            <label htmlFor="name">你的名字</label>
            <input
              id="name"
              className="field"
              maxLength={24}
              placeholder="昌佑、英仔、Alan…"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="nickname"
            />
          </div>
          <button className="btn btn-primary" onClick={createRoom} disabled={busy}>
            {busy ? "正在開門…" : "開新房間"}
          </button>
          <div className="or">或</div>
          <div>
            <label htmlFor="code">房間代碼或連結</label>
            <input
              id="code"
              className="field"
              placeholder="例如 K7MP"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoCapitalize="characters"
            />
          </div>
          <button className="btn btn-gold" onClick={joinRoom}>
            加入房間
          </button>
          {error ? <p className="banner">{error}</p> : null}
        </section>
        <section className="card">
          <p className="hint">
            房主把連結丟進群組。大家看到同一題、同一個倒數，答對有分數，答得快再加成。打完看冠軍，還能在同一間再來一局。
          </p>
        </section>
        <p className="footer-link">
          <a href="/leaderboard">本月排行榜</a>
        </p>
      </div>
    </main>
  );
}
