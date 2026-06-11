// mew-v11-final.jsx — T3 converged: session split with a real home for Pixie.
// The session column opens with a generous den — a large low-poly Pixie,
// condition, and pace — then the TUI session flows beneath it.

const FinStyles = () => (
  <style>{`
  .den-zone{ position:relative; padding:18px 20px 16px; border-bottom:1px solid var(--line2); overflow:hidden; }
  .den-zone::before{ content:""; position:absolute; inset:0; background:radial-gradient(ellipse 320px 200px at 30% 40%, rgba(227,182,108,.13), transparent 70%); pointer-events:none; }
  .den-big{ border-radius:24px; overflow:hidden; box-shadow:0 0 0 1.5px var(--gold), 0 0 34px rgba(227,182,108,.3), inset 0 -30px 50px -24px rgba(0,0,0,.55); flex:none; position:relative; }
  .den-big img{ display:block; }
  .den-meta{ position:relative; min-width:0; }
  .den-meta .nm{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.01em; }
  .den-meta .st{ display:flex; align-items:center; gap:7px; margin-top:6px; font-family:'JetBrains Mono',monospace; font-size:10.5px; color:var(--gold); white-space:nowrap; }
  .den-meta .st::before{ content:""; width:7px; height:7px; border-radius:50%; background:var(--gold); box-shadow:0 0 8px var(--gold); animation:stlPulse 3s ease-in-out infinite; }
  .den-meta .ds{ font-size:12px; color:var(--muted); line-height:1.55; margin-top:8px; }
  .den-pace{ margin-top:10px; }
  .den-pace .pl{ font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--faint); letter-spacing:.1em; text-transform:uppercase; margin-bottom:5px; }
  .den-pace .pb{ height:5px; border-radius:3px; background:var(--line); position:relative; }
  .den-pace .pb span{ position:absolute; left:0; top:0; bottom:0; width:72%; border-radius:3px; background:linear-gradient(90deg, var(--teal), var(--gold)); }
  `}</style>
);

function SurfaceFinal() {
  const [mode, setMode] = React.useState("day");
  return (
    <div className="stl" style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 472px" }}>
      {/* LEFT — the spine */}
      <div style={{ position: "relative", borderRight: "1px solid var(--line2)" }}>
        <div style={{ position: "absolute", top: 20, left: 28, zIndex: 10 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}><DevSelector mode={mode} setMode={setMode} /></div>
        <div style={{ position: "absolute", top: 64, left: 0, right: 0, textAlign: "center", zIndex: 5 }}>
          <div className="slabel" style={{ marginBottom: 8 }}>right now</div>
          <div className="disp" style={{ fontSize: 30, fontWeight: 600 }}>Finish the Q3 deck.</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}>
            <span className="badge ice">40:00 left</span><span className="badge">held · 11:30</span><span className="badge gold">5 mews</span>
          </div>
        </div>
        <SpineArea mode={mode} left={120} right={120} top={186} bottom={24} weekLeft={64} weekRight={36} />
      </div>

      {/* RIGHT — den + session */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--panel)" }}>
        {/* the den — Pixie's reserved space */}
        <div className="den-zone" style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <div className="den-big" style={{ width: 148, height: 148 }}>
            <img src="pixie-poly-face.svg" alt="Pixie" style={{ width: 200, marginLeft: -26, marginTop: -34 }} />
          </div>
          <div className="den-meta">
            <div className="nm">Pixie</div>
            <div className="st">healthy · mewing away</div>
            <div className="ds">A pace you can keep. Rest is on the calendar — Thursday is held for the deck.</div>
            <div className="den-pace">
              <div className="pl">pace · sustainable</div>
              <div className="pb"><span></span></div>
            </div>
          </div>
        </div>

        <div className="trm-bar" style={{ borderTop: "none" }}>
          <span className="dots"><span></span><span></span><span></span></span>
          <span>mew session — tty1</span>
          <span style={{ marginLeft: "auto" }}><kbd>⌘K</kbd></span>
        </div>

        <div style={{ flex: 1, padding: "14px 20px", minHeight: 0, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
          <div className="log" style={{ fontSize: 11.5 }}>
            <div style={{ color: "var(--faint)" }}># tuesday · plan committed 08:45 · 6 blocks</div>
            <div style={{ marginTop: 9 }}><span className="p-you prompt">you ❯</span> <b>block thursday morning for the deck, keep friday pm free</b></div>
            <div style={{ marginTop: 3 }}><span className="p-mew prompt">mew ❯</span> <span className="ok">✓</span> thu 09:00–12:00 <b>held</b> · fri 13:00+ kept empty</div>
            <div style={{ color: "var(--faint)", paddingLeft: 44 }}># third deep-work block this week</div>
            <div style={{ marginTop: 10 }}><span className="p-mew prompt">mew ❯</span> <span className="mw">★</span> <b>mew #5</b> — standup notes shipped · 5 today</div>
          </div>
          <div className="tui-nudge">
            <div className="h">▸ nudge/drift — 09:40</div>
            still on the deck, or should i move it? off-task ~12 min.<br />
            <span style={{ color: "var(--faint)" }}># each switch ≈ 20 min refocus · ignoring costs nothing</span><br />
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

Object.assign(window, { FinStyles, SurfaceFinal });
