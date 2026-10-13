"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Brand, Lights } from "@/components/chrome";
import { formatPoints } from "@/lib/scoring";
import type { Ack, RoomState } from "@/lib/types";

const PLAYER_KEY = "48302:playerId";
const NAME_KEY = "48302:name";
const MARKS = ["甲", "乙", "丙", "丁"];

function loadIdentity() {
  const playerId = localStorage.getItem(PLAYER_KEY) || crypto.randomUUID();
  localStorage.setItem(PLAYER_KEY, playerId);
  return { playerId, name: localStorage.getItem(NAME_KEY) || "" };
}

export default function RoomClient({ code }: { code: string }) {
  const socketRef = useRef<Socket | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [draft, setDraft] = useState("");
  const [joinName, setJoinName] = useState("");
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<RoomState | null>(null);
  const [banner, setBanner] = useState("");
  const [fatal, setFatal] = useState("");
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);

  useEffect(() => {
    const identity = loadIdentity();
    setPlayerId(identity.playerId);
    setDraft(identity.name);
    setJoinName(identity.name);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !playerId || !joinName.trim()) return;
    const socket = io({ transports: ["websocket", "polling"] });
    socketRef.current = socket;
    const join = () => {
      socket.emit(
        "room:join",
        { code, playerId, displayName: joinName },
        (ack: Ack) => {
          if (!ack.ok) {
            if (ack.error.includes("名字")) setBanner(ack.error);
            else setFatal(ack.error);
          } else {
            setFatal("");
            setBanner("");
          }
        },
      );
    };
    socket.on("connect", join);
    socket.on("room:state", (next: RoomState) => {
      offset.current = next.serverNow - Date.now();
      setState(next);
      setNow(Date.now() + offset.current);
    });
    socket.on("disconnect", () => {
      if (socketRef.current === socket) setBanner("連線晃了一下，正在接回來…");
    });
    const resync = window.setInterval(() => {
      if (socket.connected) join();
    }, 3000);
    return () => {
      window.clearInterval(resync);
      socketRef.current = null;
      socket.disconnect();
    };
  }, [ready, playerId, joinName, code]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 100);
    return () => clearInterval(timer);
  }, []);

  function ask(event: string, payload: object) {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit(event, payload, (ack: Ack) => {
      if (!ack.ok) setBanner(ack.error);
      else setBanner("");
    });
  }

  function saveName(next: string) {
    const trimmed = next.trim();
    if (!trimmed) {
      setBanner("請輸入名字");
      return;
    }
    localStorage.setItem(NAME_KEY, trimmed);
    setDraft(trimmed);
    if (state) {
      ask("room:rename", { code: state.code, playerId, displayName: trimmed });
      return;
    }
    setBanner("");
    setJoinName(trimmed);
  }

  async function copyLink() {
    const link = `${window.location.origin}/r/${state?.code || code}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const input = document.createElement("textarea");
      input.value = link;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const question = state?.question;
  const remaining = question ? Math.max(0, question.endsAt - now) : 0;
  const ratio = question ? Math.max(0, Math.min(1, remaining / question.durationMs)) : 0;
  const seconds = Math.ceil(remaining / 1000);
  const locked = !question || state?.phase !== "question" || remaining <= 0 || question.yourChoice !== null;
  const you = state?.players.find((player) => player.id === state.youId);

  const correctNames = useMemo(
    () => state?.players.filter((player) => player.correct) ?? [],
    [state],
  );

  if (!ready) {
    return (
      <main className="shell">
        <p>連線中…</p>
      </main>
    );
  }

  if (!joinName && !state) {
    return (
      <main className="shell">
        <Lights />
        <Brand compact />
        <section className="card stack">
          <h2 style={{ margin: 0 }}>進房間之前，先留個名字</h2>
          <input
            className="field"
            maxLength={24}
            placeholder="同學怎麼叫你"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="btn btn-primary" onClick={() => saveName(draft)}>
            進入 {code.toUpperCase()}
          </button>
          {banner ? <p className="banner">{banner}</p> : null}
        </section>
      </main>
    );
  }

  if (fatal) {
    return (
      <main className="shell">
        <Lights />
        <Brand compact />
        <section className="card stack">
          <p className="banner">{fatal}</p>
          <a className="btn btn-gold" href="/" style={{ textAlign: "center", textDecoration: "none" }}>
            回首頁
          </a>
        </section>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="shell">
        <Lights />
        <Brand compact />
        <p>正在進入房間…</p>
        {banner ? <p className="banner">{banner}</p> : null}
      </main>
    );
  }

  return (
    <main className="shell">
      <Lights />
      <Brand compact />
      {banner ? <p className="banner">{banner}</p> : null}

      {state.phase === "lobby" ? (
        <div className="stack">
          <section className="ticket">
            <div className="share-row">
              <div>
                <div style={{ fontWeight: 800 }}>房間代碼</div>
                <p className="code">{state.code}</p>
              </div>
            </div>
            <button className="btn btn-gold" onClick={copyLink} style={{ width: "100%", marginTop: 8 }}>
              {copied ? "連結已複製，丟到群組吧" : "複製連結"}
            </button>
          </section>

          <section className="card stack">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>大廳</strong>
              <span>{state.players.length} 人</span>
            </div>
            <div className="players">
              {state.players.map((player) => (
                <span key={player.id} className={`chip ${player.isHost ? "host" : ""} ${player.connected ? "" : "off"}`}>
                  {player.name}
                  {player.isHost ? <em className="badge-host">房主</em> : null}
                  {!player.connected ? " · 離線" : null}
                </span>
              ))}
            </div>
            <p className="hint">
              一共 {state.questionCount} 題。答對 1000 分，越快最多再加 500。重新整理這個頁面就能回到同一局。
            </p>
            {state.players.length < 2 ? <p className="hint">再揪一位會更好笑。</p> : null}
            {state.isHost ? (
              <button
                className="btn btn-primary sticky-start"
                onClick={() => ask("room:start", { code: state.code, playerId })}
              >
                開始遊戲
              </button>
            ) : (
              <p className="hint">等房主開始。你可以先把連結傳出去。</p>
            )}
            {renaming ? (
              <div className="stack">
                <input className="field" maxLength={24} value={draft} onChange={(event) => setDraft(event.target.value)} />
                <button
                  className="btn btn-gold"
                  onClick={() => {
                    saveName(draft);
                    setRenaming(false);
                  }}
                >
                  儲存名字
                </button>
              </div>
            ) : (
              <button className="btn btn-ghost" onClick={() => setRenaming(true)}>
                改名字
              </button>
            )}
          </section>
        </div>
      ) : null}

      {question && (state.phase === "question" || state.phase === "reveal") ? (
        <div className="stack">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end" }}>
            <span className={`seconds ${seconds <= 5 ? "urgent" : ""}`}>
              {state.phase === "reveal" ? "揭曉" : seconds}
            </span>
            <span>
              第 {question.index + 1} 題／共 {question.total} 題
            </span>
          </div>
          <div className={`timer ${seconds <= 5 ? "urgent" : ""}`} aria-hidden="true">
            <div className="timer-fill" style={{ width: state.phase === "reveal" ? "0%" : `${ratio * 100}%` }} />
          </div>
          <section className="paper" aria-live="polite">
            <div className="q-top">
              <span className={`cat cat-${question.category}`}>{question.categoryLabel}</span>
              <span className="q-count">{question.yourChoice !== null && state.phase === "question" ? "已作答" : ""}</span>
            </div>
            <h2 className="q-text">{question.prompt}</h2>
            {state.phase === "reveal" && question.explanation ? (
              <div className="explain">
                <strong>正解</strong>
                <div>{question.explanation}</div>
                <div className="who">
                  {correctNames.length === 0 ? <span className="delta-bad">這題沒有人答對</span> : null}
                  {correctNames.map((player) => (
                    <span key={player.id} className="delta-good">
                      {player.name} +{formatPoints(player.delta || 0)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          <div className="opts">
            {question.options.map((option, index) => {
              const mine = question.yourChoice === index;
              const revealed = state.phase === "reveal";
              const right = revealed && question.correctIndex === index;
              const dim = revealed && !right;
              return (
                <button
                  key={option}
                  className={`opt opt-${index} ${mine ? "picked" : ""} ${right ? "right" : ""} ${dim ? "dim" : ""}`}
                  disabled={locked || revealed}
                  onClick={() => ask("room:answer", { code: state.code, playerId, choice: index })}
                >
                  <span className="mark">{MARKS[index]}</span>
                  <span>{option}</span>
                  {right ? <span className="stamp">正解</span> : null}
                </button>
              );
            })}
          </div>
          <Scoreboard state={state} />
        </div>
      ) : null}

      {state.phase === "final" ? (
        <div className="stack">
          <section className="paper crown">
            <div className="confetti" aria-hidden="true">
              {["#d83a32", "#f0b429", "#0e7a62", "#3146b5", "#e4b15a"].map((color, index) => (
                <i key={color} style={{ left: `${12 + index * 18}%`, background: color, animationDelay: `${index * 0.08}s` }} />
              ))}
            </div>
            <div className="cat cat-line">本局結束</div>
            <p style={{ margin: "10px 0 0", color: "#6d655b" }}>{state.winners.length > 1 ? "並列冠軍" : "冠軍"}</p>
            <h2>{state.winners.join("、")}</h2>
            {state.board ? (
              <p style={{ marginTop: 0 }}>
                {state.players.some((player) => player.score > 0)
                  ? `有得分的人已記入 ${state.board.monthLabel} 排行榜。${
                      you && you.score > 0
                        ? `${you.name} 本月累積 ${formatPoints(
                            state.board.entries.find((entry) => entry.name === you.name)?.points ?? you.score,
                          )} 分。`
                        : "你這局是 0 分，不會寫進榜上。"
                    }`
                  : "這局大家都是 0 分，排行榜先不動。"}
              </p>
            ) : null}
          </section>
          <Scoreboard state={state} />
          {state.isHost ? (
            <button className="btn btn-primary" onClick={() => ask("room:rematch", { code: state.code, playerId })}>
              再來一局
            </button>
          ) : (
            <p className="hint">等房主按再來一局。房間代碼還是 {state.code}。</p>
          )}
          <a className="btn btn-ghost" href="/leaderboard" style={{ textAlign: "center", textDecoration: "none" }}>
            看本月排行榜
          </a>
        </div>
      ) : null}
    </main>
  );
}

function roundNote(player: RoomState["players"][number]) {
  if (!player.answered) return "未作答";
  if (player.correct) return `+${formatPoints(player.delta || 0)}`;
  return "答錯";
}

function Scoreboard({ state }: { state: RoomState }) {
  return (
    <section className="card">
      <strong>分數</strong>
      <div className="scores" style={{ marginTop: 8 }}>
        {state.players.map((player, index) => (
          <div key={player.id} className={`score-row ${player.id === state.youId ? "me" : ""}`}>
            <span>{index + 1}</span>
            <span>
              {player.name}
              {player.isHost ? " · 房主" : ""}
              {!player.connected ? " · 離線" : ""}
            </span>
            <strong>
              {formatPoints(player.score)}
              {state.phase === "reveal" && player.delta !== undefined ? (
                <span style={{ marginLeft: 6, color: player.correct ? "#b7f0cf" : "#ffc1b5" }}>
                  {roundNote(player)}
                </span>
              ) : null}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}
