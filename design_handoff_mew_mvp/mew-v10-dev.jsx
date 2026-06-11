// mew-v10-dev.jsx — the Den, professional & dev-friendly. No cursive.
// Three iterations: T1 Pro · T2 Terminal · T3 Session split.
// Reuses steel core (v8) + vertical spine (v9: VDay, VRuler, vdPct).

const DevStyles = () => (
  <style>{`
  .trm-bar{ display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid var(--line2); font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--muted); }
  .trm-bar .dots{ display:flex; gap:6px; }
  .trm-bar .dots span{ width:9px; height:9px; border-radius:50%; background:var(--line); }
  .trm-bar kbd{ font-size:10px; color:var(--muted); border:1px solid var(--line); border-radius:5px; padding:1px 6px; }
  .prompt{ font-family:'JetBrains Mono',monospace; }
  .prompt .p-mew{ color:var(--gold); font-weight:600; }
  .prompt .p-you{ color:var(--ice); font-weight:600; }
  .prompt .p-arr{ color:var(--faint); }
  .blink{ display:inline-block; width:8px; height:15px; background:var(--ice); vertical-align:-2px; margin-left:3px; animation:devBlink 1.1s steps(1) infinite; }
  @keyframes devBlink{ 0%,55%{ opacity:1; } 56%,100%{ opacity:0; } }
  .badge{ font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--muted); border:1px solid var(--line); border-radius:6px; padding:2px 8px; white-space:nowrap; }
  .badge.gold{ color:var(--gold); border-color:rgba(227,182,108,.4); }
  .badge.ice{ color:var(--ice); border-color:var(--ice-bd); }
  .log{ font-family:'JetBrains Mono',monospace; font-size:11px; line-height:1.9; color:var(--muted); }
  .log .t{ color:var(--faint); margin-right:9px; }
  .log .ok{ color:var(--teal); }
  .log .ev{ color:var(--ice); }
  .log .mw{ color:var(--gold); }
  .log b{ color:var(--ink); font-weight:500; }
  .tui-nudge{ font-family:'JetBrains Mono',monospace; font-size:11px; border:1px solid var(--ice-bd); border-radius:8px; padding:9px 12px; color:var(--muted); background:var(--ice-soft); line-height:1.7; }
  .tui-nudge .h{ color:var(--ice); font-weight:600; }
  .tui-btn{ display:inline-block; border:1px solid var(--line); border-radius:6px; padding:1px 9px; margin-right:6px; color:var(--ink); cursor:pointer; }
  .tui-btn.pri{ background:var(--ice); color:#0b1118; border-color:var(--ice); font-weight:600; }
  @media (prefers-reduced-motion: reduce){ .blink{ animation:none; } }
  `}</style>
);

function DevSelector({ mode, setMode }) {
  return (
    <span className="seg2">
      <span className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>Day</span>
      <span className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>Week</span>
    </span>
  );
}

function SpineArea({ mode, left = 280, right = 280, top = 196, bottom = 118, weekLeft = 96, weekRight = 40 }) {
  return mode === "day" ? (
    <div style={{ position: "absolute", left, right, top, bottom }}>
      <VRuler />
      <div style={{ position: "absolute", left: 40, right: 0, top: 0, bottom: 0 }}><VDay dayKey="Tue" today bright /></div>
    </div>
  ) : (
    <div style={{ position: "absolute", left: weekLeft, right: weekRight, top: top + 24, bottom }}>
      <VRuler />
      <div style={{ position: "absolute", left: 46, right: 0, top: 0, bottom: 0, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 10 }}>
        {DAY_META.map((m) => (
          <div key={m.d} className={"vd-col" + (m.past ? " past" : "")} style={{ position: "relative" }}>
            <div className={"vd-dlabel" + (m.today ? " today" : "")} style={{ position: "absolute", top: -26, left: 0, right: 0 }}><span>{m.d} {m.n}</span></div>
            <VDay dayKey={m.d} today={m.today} mini bright={m.today} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── T1 · PRO — v9's den, professional type, zero ornament ── */
function SurfaceT1() {
  const [mode, setMode] = React.useState("day");
  return (
    <div className="stl" style={{ width: 1280, height: 840, background: "linear-gradient(180deg,#0a0f16,#0e1722 50%,#101a26)" }}>
      <div style={{ position: "absolute", top: 20, left: 28 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em" }}>MEW</span></div>
      <div style={{ position: "absolute", top: 22, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <span className="agent">watching · 2 calendars · drift armed · quiet 18:30</span>
      </div>
      <div style={{ position: "absolute", top: 20, right: 26, zIndex: 10 }}><DevSelector mode={mode} setMode={setMode} /></div>

      <div style={{ position: "absolute", top: 66, left: 0, right: 0, textAlign: "center", zIndex: 5 }}>
        <div className="slabel" style={{ marginBottom: 9 }}>right now</div>
        <div className="disp" style={{ fontSize: 36, fontWeight: 600 }}>Finish the Q3 deck.</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}>
          <span className="badge ice">40:00 left</span><span className="badge">protected · 11:30</span><span className="badge gold">5 mews today</span>
        </div>
      </div>

      <SpineArea mode={mode} top={204} />

      <div style={{ position: "absolute", left: 36, right: 36, bottom: 22, display: "flex", alignItems: "center", gap: 20, zIndex: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, flex: "none" }}>
          <div className="pixavatar" style={{ width: 56, height: 56, borderRadius: 14 }}><img src="pixie-poly-face.svg" alt="" style={{ width: 78, marginLeft: -11, marginTop: -17 }} /></div>
          <div className="mono" style={{ fontSize: 9.5, color: "var(--gold)", lineHeight: 1.6 }}>pixie · healthy</div>
        </div>
        <div style={{ flex: 1, maxWidth: 560, margin: "0 auto" }}><CmdBar placeholder="Talk to MEW — schedule it, move it, ask it…" /></div>
        <div style={{ width: 312, flex: "none" }}><SNudge label="nudge · right-size" body="Wednesday holds 8h deep work; your best is ~5½." acts={["Right-size", "Keep"]} /></div>
      </div>
    </div>
  );
}

/* ── T2 · TERMINAL — prompt headline, event log, REPL composer ── */
function SurfaceT2() {
  const [mode, setMode] = React.useState("day");
  return (
    <div className="stl" style={{ width: 1280, height: 840, display: "flex", flexDirection: "column" }}>
      <div className="trm-bar">
        <span className="dots"><span></span><span></span><span></span></span>
        <span>mew — tuesday 9 jun · week 24</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "var(--gold)" }}>pixie:healthy</span><kbd>⌘K</kbd>
        </span>
      </div>

      <div style={{ padding: "22px 34px 6px", display: "flex", alignItems: "baseline", gap: 16 }}>
        <div className="prompt" style={{ fontSize: 13 }}>
          <span className="p-mew">mew</span> <span className="p-arr">❯</span> <span style={{ color: "var(--muted)" }}>now:</span>
        </div>
        <div>
          <span className="disp" style={{ fontSize: 30, fontWeight: 600 }}>Finish the Q3 deck.</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)", marginLeft: 14 }}>[40:00] [held→11:30] [<span style={{ color: "var(--gold)" }}>mews:5</span>]</span>
        </div>
        <div style={{ marginLeft: "auto" }}><DevSelector mode={mode} setMode={setMode} /></div>
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <SpineArea mode={mode} left={120} right={460} top={26} bottom={16} weekLeft={84} weekRight={476} />
        {/* event log */}
        <div style={{ position: "absolute", right: 34, top: 18, bottom: 16, width: 390, borderLeft: "1px solid var(--line2)", paddingLeft: 24, display: "flex", flexDirection: "column" }}>
          <div className="slabel" style={{ marginBottom: 10 }}>session log</div>
          <div className="log">
            <div><span className="t">08:44</span><span className="ev">↻</span> thu 09:00–12:00 <b>held</b> · fri pm freed</div>
            <div><span className="t">08:45</span><span className="ev">⚑</span> plan committed · 6 blocks · 6.5h</div>
            <div><span className="t">09:00</span><span className="ev">▶</span> block start · <b>q3-deck</b> · guard on</div>
            <div><span className="t">09:12</span><span className="mw">★</span> mew #5 — standup notes</div>
            <div><span className="t">09:28</span><span className="ok">✓</span> calendar sync · 2 remotes · busy-only out</div>
            <div style={{ margin: "10px 0" }}>
              <div className="tui-nudge">
                <div className="h">▸ nudge/drift — 09:40</div>
                still on the deck, or move it? off-task ~12 min.<br />
                <span style={{ color: "var(--faint)" }}># refocus costs ~20 min (Mark, UCI)</span><br />
                <span className="tui-btn pri">still on it</span><span className="tui-btn">move</span><span className="tui-btn">guard</span>
              </div>
            </div>
            <div><span className="t">09:41</span><span className="ev">…</span> awaiting reply <span className="blink" style={{ height: 11, width: 6 }}></span></div>
          </div>
          <div style={{ marginTop: "auto" }} className="mono">
            <div style={{ fontSize: 9.5, color: "var(--faint)", marginBottom: 8 }}># mirrors to browser notifs only when tab unfocused</div>
          </div>
        </div>
      </div>

      <div style={{ padding: "10px 34px 18px" }}>
        <div className="prompt" style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 15px", fontSize: 12.5 }}>
          <span className="p-you">you</span> <span className="p-arr">❯</span> <span style={{ color: "var(--ink)" }}>block thursday morning for the deck</span><span className="blink"></span>
        </div>
      </div>
    </div>
  );
}

/* ── T3 · SESSION SPLIT — spine left, live session (the chat) right ── */
function SurfaceT3() {
  const [mode, setMode] = React.useState("day");
  return (
    <div className="stl" style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 472px" }}>
      <div style={{ position: "relative", borderRight: "1px solid var(--line2)" }}>
        <div style={{ position: "absolute", top: 20, left: 28, zIndex: 10 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}><DevSelector mode={mode} setMode={setMode} /></div>
        <div style={{ position: "absolute", top: 64, left: 0, right: 0, textAlign: "center", zIndex: 5 }}>
          <div className="slabel" style={{ marginBottom: 8 }}>right now</div>
          <div className="disp" style={{ fontSize: 30, fontWeight: 600 }}>Finish the Q3 deck.</div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 8 }}>40:00 left · held until 11:30</div>
        </div>
        <SpineArea mode={mode} left={120} right={120} top={170} bottom={24} weekLeft={64} weekRight={36} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--panel)" }}>
        <div className="trm-bar">
          <span className="dots"><span></span><span></span><span></span></span>
          <span>mew session — tty1</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <PixAvatar size={22} /><span style={{ color: "var(--gold)" }}>healthy</span>
          </span>
        </div>
        <div style={{ flex: 1, padding: "16px 20px", minHeight: 0, display: "flex", flexDirection: "column", gap: 13 }}>
          <div className="log" style={{ fontSize: 11.5 }}>
            <div style={{ color: "var(--faint)" }}># tuesday · plan committed 08:45 · 6 blocks</div>
            <div style={{ marginTop: 10 }}><span className="p-you prompt">you ❯</span> <b>block thursday morning for the deck, keep friday pm free</b></div>
            <div style={{ marginTop: 4 }}><span className="p-mew prompt">mew ❯</span> <span className="ok">✓</span> thu 09:00–12:00 <b>held</b> · fri 13:00+ kept empty</div>
            <div style={{ color: "var(--faint)", paddingLeft: 44 }}># third deep-work block this week</div>
            <div style={{ marginTop: 12 }}><span className="p-mew prompt">mew ❯</span> <span className="mw">★</span> <b>mew #5</b> — standup notes shipped · 5 today</div>
          </div>
          <div className="tui-nudge">
            <div className="h">▸ nudge/drift — 09:40</div>
            still on the deck, or should i move it? off-task ~12 min.<br />
            <span style={{ color: "var(--faint)" }}># each switch ≈ 20 min refocus · positive-only, ignoring costs nothing</span><br />
            <span className="tui-btn pri">still on it</span><span className="tui-btn">move it</span><span className="tui-btn">guard block</span>
          </div>
          <div className="tui-nudge" style={{ borderColor: "rgba(227,182,108,.4)", background: "var(--gold-soft)" }}>
            <div className="h" style={{ color: "var(--gold)" }}>▸ nudge/right-size — pending</div>
            wed = 8.0h deep work · your best ≈ 5.5h. kinder shape?<br />
            <span className="tui-btn pri" style={{ background: "var(--gold)", borderColor: "var(--gold)" }}>right-size</span><span className="tui-btn">keep</span>
          </div>
        </div>
        <div style={{ padding: "0 16px 16px" }}>
          <div className="prompt" style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", fontSize: 12.5 }}>
            <span className="p-you">you</span> <span className="p-arr">❯</span><span className="blink"></span>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DevStyles, SurfaceT1, SurfaceT2, SurfaceT3 });
