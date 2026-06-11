// mew-v5-calendar.jsx — graphical day/week time grids for the center column.
// Three iterations: A "Today, to scale" · B "The week grid" · C "Grid + vitals".
// Reuses tokens/components from surfaces.jsx, mew-v2-parts.jsx, mew-v3-parts.jsx.

const CalStyles = () => (
  <style>{`
  .cal-gut{ position:absolute; left:0; top:0; bottom:0; width:44px; }
  .cal-hr{ position:absolute; left:44px; right:0; height:1px; background:var(--line2); }
  .cal-ht{ position:absolute; left:0; width:38px; text-align:right; font-family:ui-monospace,'SF Mono',monospace; font-size:10px; color:var(--faint); transform:translateY(-50%); }
  .cal-block{ position:absolute; border-radius:10px; padding:6px 9px; overflow:hidden; box-sizing:border-box; border:1px solid; }
  .cal-block .bt{ font-size:12.5px; font-weight:650; line-height:1.2; }
  .cal-block .bm{ font-size:10.5px; opacity:.75; margin-top:1px; white-space:nowrap; }
  .cal-block.work{ background:var(--gold-soft); border-color:#ddbb80; color:#7a5217; }
  .cal-block.private{ background:var(--sage-soft); border-color:#b9c9a9; color:#46603a; }
  .cal-block.rest{ background:transparent; border:1.4px dashed var(--sage); color:var(--sage); }
  .cal-block.now{ border:1.6px solid var(--gold); background:#f3d9a6; box-shadow:0 6px 18px -8px rgba(160,108,40,.45); }
  .cal-block.done{ opacity:.45; }
  .cal-block.done .bt{ text-decoration:line-through; }
  .mew--dark .cal-block.work{ color:#e7bd7c; border-color:#5a4523; }
  .mew--dark .cal-block.private{ color:#b6c9a4; border-color:#3d4a2e; }
  .cal-nowline{ position:absolute; left:44px; right:0; height:0; border-top:2px solid var(--gold); z-index:3; }
  .cal-nowline::before{ content:""; position:absolute; left:-5px; top:-5px; width:8px; height:8px; border-radius:50%; background:var(--gold); }
  .cal-nowtag{ position:absolute; right:0; top:-9px; font-size:9.5px; font-weight:800; letter-spacing:.06em; color:#fff; background:var(--gold); border-radius:6px; padding:1px 6px; }
  .nowbar{ display:flex; align-items:center; gap:14px; background:var(--panel2); border:1px solid var(--line); border-radius:16px; box-shadow:var(--shadow); padding:12px 18px; }
  .nowbar .serif{ font-size:21px; font-weight:500; letter-spacing:-0.015em; white-space:nowrap; }
  .wk-head{ display:grid; align-items:end; padding-bottom:8px; }
  .wk-hd{ text-align:center; font-size:12px; color:var(--muted); font-weight:600; padding:5px 0; border-radius:10px; }
  .wk-hd b{ display:block; font-size:14px; color:var(--ink); font-weight:700; }
  .wk-hd.today{ background:var(--gold-soft); box-shadow:inset 0 0 0 1.5px var(--gold); color:#7a5217; }
  .wk-hd.today b{ color:#7a5217; }
  .wk-hd .hv{ display:inline-block; margin-top:2px; font-size:9.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:var(--gold); }
  .wk-col{ position:relative; border-left:1px solid var(--line2); }
  .wk-col.past{ opacity:.5; }
  .wk-col.today-col{ background:linear-gradient(180deg, rgba(201,138,60,.05), rgba(201,138,60,.02)); }
  .vital{ flex:1; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:11px 14px; min-width:0; box-sizing:border-box; }
  .vital .vt{ font-size:10px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); white-space:nowrap; }
  .vital .vv{ font-size:16px; font-weight:700; margin-top:3px; white-space:nowrap; }
  .vital .vv small{ font-size:11.5px; font-weight:600; color:var(--muted); }
  .vital .vc{ font-size:10.5px; color:var(--muted); margin-top:3px; white-space:nowrap; }
  `}</style>
);

const LockGlyph = () => (
  <svg width="8" height="9" viewBox="0 0 8 9" style={{ marginLeft: 4, flex: "none", opacity: .8 }}><rect x="0.5" y="3.5" width="7" height="5" rx="1.4" fill="currentColor"/><path d="M2 4V2.6a2 2 0 0 1 4 0V4" fill="none" stroke="currentColor" strokeWidth="1.1"/></svg>
);

/* blocks: [startH, endH, title, tag, {done, now, prot, busy}] */
const DAYBLOCKS = {
  Mon: [[9, 11, "Spec review", "work", { done: 1 }], [11.5, 12.5, "Standup + triage", "work", { done: 1 }], [14, 16, "Roadmap draft", "work", { done: 1 }], [16.5, 17.5, "Gym", "private", { done: 1, prot: 1 }]],
  Tue: [[8.25, 8.75, "Shape the day with MEW", "work", { done: 1 }], [9, 11.5, "Q3 deck — deep work", "work", { now: 1, prot: 1 }], [11.5, 12, "Team standup", "work", {}], [13, 14, "Lunch, away from screen", "private", { prot: 1 }], [14.5, 15.5, "Reply to Sam", "work", {}], [16, 17, "Walk", "private", { prot: 1 }], [18, 19, "Rest — earned", "rest", {}]],
  Wed: [[9, 13, "Deck build — deep work", "work", {}], [13.5, 14, "Design sync", "work", {}], [14.5, 18, "Deck build II", "work", {}]],
  Thu: [[9, 12, "The deck — held for you", "work", { prot: 1 }], [13, 14.5, "1:1s", "work", {}], [15, 16.5, "Review round", "work", {}]],
  Fri: [[9, 10.5, "Ship the deck", "work", {}], [11, 12, "Retro", "work", {}], [16, 17, "Climb", "private", { prot: 1 }]],
  Sat: [[10, 12.5, "Family morning", "private", { prot: 1 }]],
  Sun: [[16, 17, "Plan next week with MEW", "work", {}], [17, 18.5, "Rest", "rest", {}]],
};
const DAY_META = [
  { d: "Mon", n: 8, past: 1 }, { d: "Tue", n: 9, today: 1 }, { d: "Wed", n: 10, heavy: 1 },
  { d: "Thu", n: 11 }, { d: "Fri", n: 12 }, { d: "Sat", n: 13 }, { d: "Sun", n: 14 },
];
const NOW_H = 9 + 40 / 60;
const fmtH = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

function GridLines({ startH, endH, hpx }) {
  const hrs = [];
  for (let h = startH; h <= endH; h++) hrs.push(h);
  return (
    <React.Fragment>
      {hrs.map((h) => (
        <React.Fragment key={h}>
          <div className="cal-hr" style={{ top: (h - startH) * hpx }}></div>
          <div className="cal-ht" style={{ top: (h - startH) * hpx }}>{h}:00</div>
        </React.Fragment>
      ))}
    </React.Fragment>
  );
}

function CalBlock({ b, startH, hpx, mini }) {
  const [s, e, title, tag, f = {}] = b;
  const cls = "cal-block " + tag + (f.now ? " now" : "") + (f.done ? " done" : "");
  const h = (e - s) * hpx - 3;
  return (
    <div className={cls} style={{ top: (s - startH) * hpx + 1, height: h, left: mini ? 3 : 50, right: mini ? 3 : 6, padding: mini ? "3px 6px" : undefined }}>
      <div className="bt" style={mini ? { fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center" } : { display: "flex", alignItems: "center" }}>
        {f.done && !mini && <span style={{ marginRight: 5 }}>✓</span>}{title}{f.prot && <LockGlyph />}
      </div>
      {!mini && h > 34 && <div className="bm">{fmtH(s)} – {fmtH(e)}{f.now ? " · now" : f.prot ? " · protected" : ""}</div>}
    </div>
  );
}

function NowLine({ startH, hpx, label }) {
  return (
    <div className="cal-nowline" style={{ top: (NOW_H - startH) * hpx }}>
      {label && <span className="cal-nowtag">{fmtH(NOW_H)}</span>}
    </div>
  );
}

/* ── Today as a true time grid ── */
function DayGrid({ height, startH = 8, endH = 19 }) {
  const hpx = height / (endH - startH);
  return (
    <div style={{ position: "relative", height, minWidth: 0 }}>
      <GridLines startH={startH} endH={endH} hpx={hpx} />
      {DAYBLOCKS.Tue.map((b, i) => <CalBlock key={i} b={b} startH={startH} hpx={hpx} />)}
      <NowLine startH={startH} hpx={hpx} label />
    </div>
  );
}

/* ── GCal-style week grid with the MEW lens ── */
function WeekGrid({ height, startH = 8, endH = 19 }) {
  const hpx = height / (endH - startH);
  return (
    <div style={{ minWidth: 0 }}>
      <div className="wk-head" style={{ gridTemplateColumns: "44px repeat(7,1fr)", display: "grid", gap: 0 }}>
        <span></span>
        {DAY_META.map((m) => (
          <div key={m.d} className={"wk-hd" + (m.today ? " today" : "")} style={{ margin: "0 3px" }}>
            {m.d} <b>{m.n}</b>{m.heavy && <span className="hv">heavy · 8h</span>}
          </div>
        ))}
      </div>
      <div style={{ position: "relative", height }}>
        <GridLines startH={startH} endH={endH} hpx={hpx} />
        <div style={{ position: "absolute", left: 44, right: 0, top: 0, bottom: 0, display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
          {DAY_META.map((m) => (
            <div key={m.d} className={"wk-col" + (m.past ? " past" : "") + (m.today ? " today-col" : "")}>
              {DAYBLOCKS[m.d].map((b, i) => <CalBlock key={i} b={b} startH={startH} hpx={hpx} mini />)}
            </div>
          ))}
        </div>
        <NowLine startH={startH} hpx={hpx} />
      </div>
    </div>
  );
}

/* ── Vitals — stats in service of the vision ── */
function Vitals() {
  const mews = [4, 6, 3, 5, 7, 2, 5];
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div className="vital">
        <div className="vt">Mewmentum</div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
          <div className="vv">5 <small>mews today</small></div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 26 }}>
            {mews.map((v, i) => <span key={i} style={{ width: 7, height: 4 + v * 3, borderRadius: 3, background: i === 6 ? "var(--gold)" : "var(--sage)", opacity: i === 6 ? 1 : .7 }}></span>)}
          </div>
        </div>
        <div className="vc">steady — mewing away</div>
      </div>
      <div className="vital">
        <div className="vt">Planned vs your best</div>
        <div className="vv">6½h <small>vs best ≈5½h</small></div>
        <div style={{ position: "relative", height: 7, borderRadius: 4, background: "var(--line)", marginTop: 7 }}>
          <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "81%", borderRadius: 4, background: "var(--gold)" }}></span>
          <span style={{ position: "absolute", left: "68%", top: -3, bottom: -3, width: 2.5, borderRadius: 2, background: "var(--ink)" }}></span>
        </div>
        <div className="vc">a touch over — watching it</div>
      </div>
      <div className="vital">
        <div className="vt">Rest kept</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div className="vv">4<small> of 5 this week</small></div>
          <div style={{ display: "flex", gap: 4 }}>
            {[1, 1, 1, 1, 0].map((on, i) => <span key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: on ? "var(--sage)" : "var(--line)" }}></span>)}
          </div>
        </div>
        <div className="vc">walks + lunches, protected</div>
      </div>
    </div>
  );
}

/* ── slim now bar (shared by all three) ── */
function NowBar() {
  return (
    <div className="nowbar">
      <span className="label" style={{ color: "var(--gold)", whiteSpace: "nowrap" }}>right now</span>
      <span className="serif">Finish the Q3 deck.</span>
      <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 13.5, whiteSpace: "nowrap" }}>40 min left · protected until 11:30</span>
    </div>
  );
}

/* ── shells ── */
function LeftRail() {
  return (
    <div style={{ borderRight: "1px solid var(--line2)", padding: "20px 14px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div className="label" style={{ padding: "0 8px 12px" }}>My entire week</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {WEEK.map((d) => <WeekRow key={d.d} day={d} />)}
      </div>
      <div style={{ marginTop: "auto", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.45 }}>
        <span style={{ color: "var(--gold)", fontWeight: 700 }}>Wednesday looks heavy.</span> <span style={{ color: "var(--muted)" }}>8h deep work — your best is ~5½. Nudge waiting in chat.</span>
      </div>
    </div>
  );
}

function RightCol() {
  return (
    <div style={{ borderLeft: "1px solid var(--line2)", display: "flex", flexDirection: "column", background: "var(--panel)", minHeight: 0 }}>
      <CompanionSlot />
      <NudgeChat />
    </div>
  );
}

function CalTopbar() {
  return (
    <div className="topbar">
      <span className="wordmark">MEW</span>
      <span className="topdate">Tuesday, June 9 · week 24</span>
      <div className="topright">
        <span className="pillstat"><span className="dot" style={{ background: "var(--sage)" }}></span>5 mews today</span>
        <span className="bell"><BellIcon /></span>
      </div>
    </div>
  );
}

/* A — today, to scale (keeps the week rail) */
function SurfaceCalA() {
  return (
    <div className="mew" style={{ width: 1280, height: 840, display: "grid", gridTemplateRows: "auto 1fr" }}>
      <CalTopbar />
      <div style={{ display: "grid", gridTemplateColumns: "312px 1fr 384px", minHeight: 0 }}>
        <LeftRail />
        <div style={{ padding: "20px 26px 22px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <NowBar />
          <DayGrid height={640} />
        </div>
        <RightCol />
      </div>
    </div>
  );
}

/* B — the week grid (GCal language, MEW lens) */
function SurfaceCalB() {
  return (
    <div className="mew" style={{ width: 1280, height: 840, display: "grid", gridTemplateRows: "auto 1fr" }}>
      <CalTopbar />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 384px", minHeight: 0 }}>
        <div style={{ padding: "18px 26px 22px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <NowBar />
          <WeekGrid height={600} />
        </div>
        <RightCol />
      </div>
    </div>
  );
}

/* C — today grid + vitals (stats in service of the vision) */
function SurfaceCalC() {
  return (
    <div className="mew" style={{ width: 1280, height: 840, display: "grid", gridTemplateRows: "auto 1fr" }}>
      <CalTopbar />
      <div style={{ display: "grid", gridTemplateColumns: "312px 1fr 384px", minHeight: 0 }}>
        <LeftRail />
        <div style={{ padding: "18px 26px 22px", display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
          <NowBar />
          <Vitals />
          <DayGrid height={538} />
        </div>
        <RightCol />
      </div>
    </div>
  );
}

Object.assign(window, { CalStyles, SurfaceCalA, SurfaceCalB, SurfaceCalC, DayGrid, WeekGrid, Vitals, NowBar, DAYBLOCKS, DAY_META, NOW_H, fmtH, LockGlyph, RightCol, CalTopbar, LeftRail });
