// mew-v4-research.jsx — the nudge library (research → product), the day's
// interaction points, and the truth model. Doc-style artboards.

const NUDGES = [
  {
    name: "Right-size", tone: "honest, warm",
    quote: "You've planned 9 hours of deep work; your realistic best has been about 5½. Want me to right-size it?",
    trigger: "planned deep work > 1.2× your realistic best",
    research: "Planning fallacy — theses predicted at ~34 days, took 55.5; fixed only by connecting your own history. Buehler, Griffin & Ross 1994; Kahneman & Tversky.",
  },
  {
    name: "Drift check-in", tone: "gentle, no blame",
    quote: "Still on the deck, or should I move it? You've been off it ~12 minutes.",
    trigger: "now-block open · activity drifted ≥ 10 min",
    research: "Refocus after interruption ≈ 23 min; attention residue degrades the next task too. Mark, UC Irvine; Leroy 2009.",
  },
  {
    name: "Guard the block", tone: "protective",
    quote: "Each switch costs around 20 minutes of refocus — want me to guard the next block?",
    trigger: "≥ 3 self-interruptions within the hour",
    research: "Screen attention fell 2.5 min → 47 sec (2004–2023); ~44% of interruptions are self-inflicted. Mark, UC Irvine.",
  },
  {
    name: "Celebrate the mew", tone: "celebratory, brief",
    quote: "That's a mew — five today. The deck's nearly there.",
    trigger: "any task completed — always fires, never skipped",
    research: "Progress on meaningful work is the strongest motivator; small losses hurt more than small wins help — so rewards are positive-only. Amabile & Kramer 2011.",
  },
  {
    name: "Close the loop", tone: "calming, end-of-day",
    quote: "The deck isn't done — shall it live tomorrow at 9:00? Then let it go for tonight.",
    trigger: "open item at day end · no plan attached",
    research: "Unfinished tasks intrude on the mind (Zeigarnik 1927) until they have a concrete plan — then it lets go. Masicampo & Baumeister 2011.",
  },
  {
    name: "When & where", tone: "practical",
    quote: "Got it — 'call the bank.' When should it live? Thursday morning has room.",
    trigger: "intention captured without a time or place",
    research: "Implementation intentions (if-then plans with a when/where) raise goal attainment, d = .65 across 94 studies. Gollwitzer & Sheeran 2006.",
  },
  {
    name: "Protect the rest", tone: "firm but kind",
    quote: "That meeting lands on your walk. The walk is yours — keep it?",
    trigger: "event proposed over protected rest · rest skipped 2 days running",
    research: "Burnout = chronic unmanaged stress (WHO ICD-11); 55% of the workforce reports it. Rest is scheduled, protected, rewarded.",
  },
  {
    name: "The kinder plan", tone: "a real conversation",
    quote: "Fourth week of heavy carry-over. Can we look at the load together? I have a kinder shape for next week — proposed, not imposed.",
    trigger: "carry-over > 30% for 4 consecutive weeks",
    research: "Burnt-out employees are ~3× more likely to plan to leave. Eagle Hill 2025; Aflac 2025. Strain is met with help, never judgment.",
  },
];

function NudgeLibrary() {
  return (
    <div className="doc" style={{ padding: 26, width: "100%", height: "100%", background: "#f6f1e8", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gridAutoRows: "1fr", gap: 16, boxSizing: "border-box" }}>
      {NUDGES.map((n) => (
        <div key={n.name} className="card" style={{ display: "flex", flexDirection: "column", padding: "15px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 14.5, whiteSpace: "nowrap" }}>{n.name}</span>
            <span style={{ fontSize: 10.5, color: "#b09a76", fontWeight: 650, letterSpacing: ".03em" }}>{n.tone}</span>
          </div>
          <div className="serifq" style={{ fontFamily: "'Newsreader',serif", fontStyle: "italic", fontSize: 14.5, lineHeight: 1.42, color: "#3d362c", margin: "9px 0 10px" }}>“{n.quote}”</div>
          <div className="mono" style={{ fontSize: 10.5, lineHeight: 1.5, marginBottom: 8 }}><b>TRIGGER</b> · {n.trigger}</div>
          <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#8b7c66", marginTop: "auto" }}>{n.research}</div>
        </div>
      ))}
    </div>
  );
}

/* ── A day with MEW — six interaction points ─────────────────────────── */
function Mini({ children, style }) {
  return <div style={{ background: "#fffdf8", border: "1px solid #e8ddca", borderRadius: 12, padding: "9px 11px", fontSize: 11.5, lineHeight: 1.4, color: "#5f5544", ...style }}>{children}</div>;
}
const MiniPill = ({ children, gold, sage }) => (
  <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", background: gold ? "#f0dcb8" : sage ? "#e2ead9" : "#f1ebdd", color: gold ? "#8a5a18" : sage ? "#4d6340" : "#8c7e6b" }}>{children}</span>
);

const MOMENTS = [
  {
    t: "8:45", h: "Shape it", cap: "Speak the week into existence; blocks land placed, tagged, protected.",
    mock: (<React.Fragment>
      <Mini style={{ background: "#c98a3c", color: "#fff", borderColor: "#c98a3c", borderBottomRightRadius: 4 }}>“block thursday morning for the deck”</Mini>
      <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}><MiniPill gold>Thu 9–12 · deck</MiniPill><MiniPill sage>✓ protected</MiniPill></div>
    </React.Fragment>),
  },
  {
    t: "9:00", h: "One headline", cap: "At any moment, the one thing that matters right now.",
    mock: (<Mini><span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".08em", color: "#b09a76" }}>RIGHT NOW</span><div style={{ fontFamily: "'Newsreader',serif", fontSize: 15.5, marginTop: 3, color: "#2b2620" }}>Finish the Q3 deck.</div></Mini>),
  },
  {
    t: "9:52", h: "Drift, caught kindly", cap: "A check-in, not a scolding — before it costs half an hour.",
    mock: (<Mini style={{ borderColor: "#f0dcb8" }}><span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".08em", color: "#c98a3c" }}>NUDGE</span><div style={{ marginTop: 3 }}>Still on the deck, or should I move it?</div><div style={{ display: "flex", gap: 5, marginTop: 7 }}><MiniPill gold>Still on it</MiniPill><MiniPill>Move it</MiniPill></div></Mini>),
  },
  {
    t: "11:20", h: "A mew", cap: "Every completion is a visible small win. Pixie celebrates; nothing ever punishes.",
    mock: (<div style={{ display: "flex", gap: 9, alignItems: "center" }}><PixiePoly mood="healthy" size={46} radius={12} style={{ flex: "none" }} /><div><MiniPill sage>+1 mew · 5 today</MiniPill><div style={{ fontSize: 10.5, color: "#8b7c66", marginTop: 5 }}>celebrate fires on PixieMachine</div></div></div>),
  },
  {
    t: "16:00", h: "Private stays private", cap: "Your walk is yours; work calendars see only 'busy'.",
    mock: (<React.Fragment>
      <Mini><b style={{ color: "#2b2620" }}>You see</b> — Walk · 16:00 <MiniPill sage>private</MiniPill></Mini>
      <Mini style={{ marginTop: 6 }}><b style={{ color: "#2b2620" }}>Work sees</b> — Busy</Mini>
    </React.Fragment>),
  },
  {
    t: "18:00", h: "Rest, earned · loops closed", cap: "Done items rest with her; what's left rolls forward with a plan — your head stops holding the week.",
    mock: (<div style={{ display: "flex", gap: 9, alignItems: "center" }}><PixiePoly mood="resting" size={46} radius={12} style={{ flex: "none" }} /><div style={{ display: "flex", flexDirection: "column", gap: 5 }}><MiniPill>Pixie is resting</MiniPill><MiniPill gold>deck → tomorrow 9:00</MiniPill></div></div>),
  },
];

function DayMoments() {
  return (
    <div className="doc" style={{ padding: 26, width: "100%", height: "100%", background: "#f6f1e8", display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 14, boxSizing: "border-box" }}>
      {MOMENTS.map((m) => (
        <div key={m.t} className="card" style={{ padding: "14px 14px", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "#b09a76", marginBottom: 3 }}>{m.t}</div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{m.h}</div>
          <div>{m.mock}</div>
          <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#8b7c66", marginTop: "auto", paddingTop: 10 }}>{m.cap}</div>
        </div>
      ))}
    </div>
  );
}

/* ── How MEW stays true ──────────────────────────────────────────────── */
function TruthModel() {
  return (
    <div className="doc" style={{ padding: 26, width: "100%", height: "100%", background: "#f6f1e8", display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 18, alignItems: "stretch", boxSizing: "border-box" }}>
      <div className="card">
        <h3>The live week — decides</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Single source of truth for anything happening <b>now</b>.</li>
          <li>"What should I do right now," what's open, what's done — always answered from live state, never a snapshot.</li>
          <li>The now-headline, drift detection, and mew counts read it directly.</li>
        </ul>
      </div>
      <div style={{ alignSelf: "center", textAlign: "center", width: 210 }}>
        <div style={{ fontFamily: "'Newsreader',serif", fontStyle: "italic", fontSize: 18, color: "#3d362c", lineHeight: 1.35 }}>“History informs;<br />the live week decides.”</div>
        <div style={{ color: "#b09a76", fontSize: 20, marginTop: 8 }}>⇄</div>
      </div>
      <div className="card">
        <h3>The brain (GBrain) — informs</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Hybrid recall + a self-building graph of how your work, people and projects connect.</li>
          <li>Overnight consolidation keeps the picture sharp; estimates come from how your weeks <b>actually</b> went.</li>
          <li>Before answering, it re-reads live state — and flags anything it can't verify as current.</li>
        </ul>
      </div>
    </div>
  );
}

Object.assign(window, { NudgeLibrary, DayMoments, TruthModel });
