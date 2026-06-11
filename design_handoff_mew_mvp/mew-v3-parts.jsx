// mew-v3-parts.jsx — companion slot (Rive placeholder), chat-powered nudges,
// browser-notification mirror. Reuses surfaces.jsx + mew-v2-parts.jsx globals.

const V3Styles = () => (
  <style>{`
  .slot{ border:1.6px dashed var(--faint); border-radius:18px; background:var(--panel2); position:relative; }
  .slot-tag{ position:absolute; top:-9px; left:14px; background:var(--panel2); padding:0 8px; font-family:ui-monospace,'SF Mono',monospace; font-size:10.5px; letter-spacing:.08em; color:var(--faint); font-weight:600; }
  .slot-cap{ font-family:ui-monospace,'SF Mono',monospace; font-size:10.5px; color:var(--faint); letter-spacing:.02em; }
  .statechip{ font-size:12px; font-weight:700; padding:5px 11px; border-radius:999px; border:1px solid var(--line); background:var(--panel); cursor:pointer; color:var(--muted); transition:all .15s; user-select:none; white-space:nowrap; }
  .statechip.on{ background:var(--gold); border-color:var(--gold); color:#fff; }

  .nudge{ background:var(--panel2); border:1px solid var(--gold-soft); border-radius:16px; border-bottom-left-radius:5px; padding:12px 14px; max-width:92%; box-shadow:0 1px 2px rgba(74,57,30,.04); }
  .nudge .nlabel{ display:flex; align-items:center; gap:6px; font-size:10.5px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; color:var(--gold); margin-bottom:6px; white-space:nowrap; }
  .nudge .ntext{ font-size:14px; line-height:1.5; }
  .nudge .nfoot{ font-size:12px; color:var(--muted); margin-top:5px; line-height:1.45; }
  .nudge .nacts{ display:flex; gap:8px; margin-top:10px; }
  .nact{ font-size:12.5px; font-weight:700; padding:6px 13px; border-radius:999px; cursor:pointer; user-select:none; white-space:nowrap; }
  .nact.pri{ background:var(--gold); color:#fff; }
  .nact.sec{ border:1px solid var(--line); background:var(--panel); color:var(--ink); }

  .toast{ width:316px; background:rgba(252,250,245,.97); border:1px solid var(--line); border-radius:16px; box-shadow:0 8px 32px -8px rgba(60,40,10,.28); padding:12px 14px; display:flex; gap:11px; box-sizing:border-box; }
  .mew--dark .toast{ background:rgba(44,37,29,.92); }
  .toast .ticon{ width:34px; height:34px; border-radius:9px; overflow:hidden; flex:none; }
  .toast .ttitle{ font-size:13px; font-weight:700; display:flex; justify-content:space-between; gap:8px; }
  .toast .ttitle small{ color:var(--faint); font-weight:600; }
  .toast .tbody{ font-size:13px; color:var(--muted); line-height:1.4; margin-top:2px; }

  .bell{ position:relative; width:34px; height:34px; border-radius:50%; border:1px solid var(--line); background:var(--panel); display:grid; place-items:center; color:var(--muted); }
  .bell::after{ content:""; position:absolute; top:7px; right:8px; width:7px; height:7px; border-radius:50%; background:var(--gold); border:1.5px solid var(--panel); }
  `}</style>
);

const BellIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2a4 4 0 0 0-4 4c0 3-1.2 4.4-1.2 4.4h10.4S12 9 12 6a4 4 0 0 0-4-4Z" /><path d="M6.7 13.5a1.4 1.4 0 0 0 2.6 0" />
  </svg>
);

/* Companion slot — where pixie.riv drops in. Placeholder: low-poly portrait. */
const SLOT_STATES = [
  { id: "idle", label: "idle", status: "healthy · mewing away", note: "A pace you can keep. Rest is on the calendar.", mood: "healthy", dot: "var(--sage)" },
  { id: "celebrate", label: "mew!", status: "celebrating your mew", note: "Q3 deck outline — done. That's five today.", mood: "healthy", dot: "var(--gold)" },
  { id: "drowsy", label: "resting", status: "resting — earned", note: "Day's items done. The good kind of tired.", mood: "resting", dot: "#d8c094" },
  { id: "rundown", label: "run-down", status: "run-down · asks for a lighter day", note: "Three heavy weeks. Plan kinder tomorrow?", mood: "rundown", dot: "var(--rose)" },
];

function CompanionSlot() {
  const [st, setSt] = React.useState(SLOT_STATES[0]);
  return (
    <div style={{ padding: "20px 18px 14px", borderBottom: "1px solid var(--line2)" }}>
      <div className="slot" style={{ padding: "16px 16px 12px" }}>
        <span className="slot-tag">PIXIE · RIVE SLOT — placeholder</span>
        <div style={{ display: "flex", gap: 15, alignItems: "center" }}>
          <PixiePoly mood={st.mood} size={86} radius={16} style={{ flex: "none" }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16.5 }}>Pixie</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3, whiteSpace: "nowrap" }}>
              <span className="dot" style={{ background: st.dot }}></span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{st.status}</span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 5, lineHeight: 1.4 }}>{st.note}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 13, flexWrap: "wrap" }}>
          {SLOT_STATES.map((s) => (
            <span key={s.id} className={"statechip" + (st.id === s.id ? " on" : "")} onClick={() => setSt(s)}>{s.label}</span>
          ))}
        </div>
        <div className="slot-cap" style={{ marginTop: 11 }}>drop-in: pixie.riv · state machine "PixieMachine" · inputs ↦ live week</div>
      </div>
    </div>
  );
}

/* Chat with nudges as first-class messages */
function NudgeChat() {
  return (
    <React.Fragment>
      <div style={{ flex: 1, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 11, justifyContent: "flex-end", minHeight: 0 }}>
        <div className="bubble me">block thursday morning for the deck, keep friday afternoon free</div>
        <div className="nudge">
          <div className="nlabel"><BellIcon /> nudge · drift check-in</div>
          <div className="ntext">Still on the deck, or should I move it? You've been off it ~12 min.</div>
          <div className="nfoot">Each switch costs ~20 min of refocus — I can guard this block.</div>
          <div className="nacts"><span className="nact pri">Still on it</span><span className="nact sec">Move it</span><span className="nact sec">Guard block</span></div>
        </div>
        <div className="nudge">
          <div className="nlabel"><BellIcon /> nudge · right-size</div>
          <div className="ntext">Wednesday holds 8h of deep work; your realistic best has been ~5½.</div>
          <div className="nfoot">People underestimate their own tasks by ~40% — you're in good company.</div>
          <div className="nacts"><span className="nact pri">Right-size it</span><span className="nact sec">Keep as is</span></div>
        </div>
      </div>
      <div style={{ padding: "10px 14px 16px" }}>
        <div className="composer"><input placeholder="Talk to MEW…" readOnly /><span className="send"><SendIcon /></span></div>
      </div>
    </React.Fragment>
  );
}

/* Browser-notification mirror of the latest nudge — shown as its own frame */
function NotifToast() {
  return (
    <div className="mew" style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#3a342b,#55483a)", display: "flex", flexDirection: "column", alignItems: "flex-end", padding: "18px 18px 0 0", gap: 10, boxSizing: "border-box" }}>
      <div className="toast">
        <span className="ticon"><img src="pixie-poly-face.svg" alt="" style={{ width: 48, marginLeft: -7, marginTop: -4 }} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="ttitle"><span style={{ whiteSpace: "nowrap" }}>Pixie · MEW</span><small>now</small></div>
          <div className="tbody">Still on the deck, or should I move it?</div>
        </div>
      </div>
      <div className="slot-cap" style={{ width: 316, textAlign: "left", color: "#cbbda6" }}>
        fires only when the tab is unfocused · always mirrors a chat nudge · click → focuses the chat thread · Notification API, permission asked in onboarding
      </div>
    </div>
  );
}

/* v3 main page */
function SurfaceWeek3() {
  return (
    <div className="mew" style={{ width: 1280, height: 840, display: "grid", gridTemplateRows: "auto 1fr", position: "relative" }}>
      <div className="topbar">
        <span className="wordmark">MEW</span>
        <span className="topdate">Tuesday, June 9 · week 24</span>
        <div className="topright">
          <span className="pillstat"><span className="dot" style={{ background: "var(--sage)" }}></span>4 mews today</span>
          <span className="bell"><BellIcon /></span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "312px 1fr 384px", minHeight: 0 }}>
        <div style={{ borderRight: "1px solid var(--line2)", padding: "20px 14px", display: "flex", flexDirection: "column" }}>
          <div className="label" style={{ padding: "0 8px 12px" }}>My entire week</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {WEEK.map((d) => <WeekRow key={d.d} day={d} />)}
          </div>
          <div style={{ display: "flex", gap: 14, padding: "14px 10px 4px", fontSize: 12, color: "var(--muted)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "var(--gold)" }}></span>work</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "var(--sage)" }}></span>private</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "#d8c094" }}></span>rest</span>
          </div>
          <div style={{ marginTop: "auto", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.45 }}>
            <span style={{ color: "var(--gold)", fontWeight: 700 }}>Wednesday looks heavy.</span> <span style={{ color: "var(--muted)" }}>8h of deep work — your best is ~5½. The nudge is waiting in chat.</span>
          </div>
        </div>

        <div style={{ padding: "26px 36px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className="nowcard">
            <div className="label" style={{ marginBottom: 8 }}>right now</div>
            <div className="serif" style={{ fontSize: 38, lineHeight: 1.08, fontWeight: 500, letterSpacing: "-0.02em" }}>Finish the Q3 deck.</div>
            <div style={{ color: "var(--muted)", fontSize: 15.5, marginTop: 10 }}>40 min left in this block · protected until 11:30 · 4 mews today</div>
            <div style={{ display: "flex", gap: 5, marginTop: 16 }}>
              {[1, 1, 1, 1, 0, 0, 0].map((on, i) => <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: on ? "var(--sage)" : "var(--line)" }}></span>)}
            </div>
          </div>
          <div className="label" style={{ margin: "26px 2px 14px" }}>Today · Tuesday</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <Tl time="9:00" title="Q3 deck — deep work" tag="work" now />
            <div className="nowline"><span style={{ whiteSpace: "nowrap" }}>now · 9:40</span></div>
            <Tl time="11:30" title="Team standup" tag="work" />
            <Tl time="13:00" title="Lunch, away from screen" tag="private" done />
            <Tl time="14:30" title="Reply to Sam" tag="work" />
            <Tl time="16:00" title="Walk" tag="private" />
            <Tl time="18:00" title="Rest — earned" rest />
          </div>
        </div>

        <div style={{ borderLeft: "1px solid var(--line2)", display: "flex", flexDirection: "column", background: "var(--panel)", minHeight: 0 }}>
          <CompanionSlot />
          <NudgeChat />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { V3Styles, SurfaceWeek3, CompanionSlot, NudgeChat, NotifToast, BellIcon });
