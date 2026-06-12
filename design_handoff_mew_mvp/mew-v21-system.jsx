// mew-v21-system.jsx — THE COMPLETE FINAL SYSTEM.
// • Per-pet theming: only --pa/--pb (accent pair) swap with data-pet; carbon/white
//   structure is constant. Tokens derived via rgba(var(--..-rgb), a)) — bulletproof.
// • CompanionStage: reserved hero space for the animated 3D/vector companion
//   (placeholder = pixie-poly-face.svg with slow float). Sized so motion has room.
// • SurfaceMain (Focus⇄Week live) + SurfaceSettings (live pet picker) on Carbon.

const SystemStyles = () => (
  <style>{`
  /* ---- pet accent registry: dark pair (pa/pb) + light pair (pal/pbl) ---- */
  .nx.sys[data-pet="cat"]{   --pa:#e9b96b;--pa-rgb:233,185,107; --pb:#d4c8a8;--pb-rgb:212,200,168; --pal:#a4761f;--pal-rgb:164,118,31; --pbl:#7e7250;--pbl-rgb:126,114,80; }
  .nx.sys[data-pet="dog"]{   --pa:#e0975a;--pa-rgb:224,151,90; --pb:#cbb091;--pb-rgb:203,176,145; --pal:#b56a28;--pal-rgb:181,106,40; --pbl:#8a7556;--pbl-rgb:138,117,86; }
  .nx.sys[data-pet="fox"]{   --pa:#e8825a;--pa-rgb:232,130,90; --pb:#d8a98f;--pb-rgb:216,169,143; --pal:#c25a2e;--pal-rgb:194,90,46; --pbl:#94705a;--pbl-rgb:148,112,90; }
  .nx.sys[data-pet="bunny"]{ --pa:#dd9ab8;--pa-rgb:221,154,184; --pb:#c6b4d2;--pb-rgb:198,180,210; --pal:#b15a86;--pal-rgb:177,90,134; --pbl:#836a96;--pbl-rgb:131,106,150; }
  .nx.sys[data-pet="bird"]{  --pa:#5fb6c0;--pa-rgb:95,182,192; --pb:#9fc9b2;--pb-rgb:159,201,178; --pal:#2f8a96;--pal-rgb:47,138,150; --pbl:#5a8a72;--pbl-rgb:90,138,114; }

  /* ---- CARBON (dark default) ---- */
  .nx.sys{
    --bg:#060708; --panel:#14161a; --panel2:#1a1d22; --glass:rgba(20,22,26,.94);
    --ink:#ecedef; --muted:#8f97a3; --faint:#555c66; --line:#23272e; --line2:#15171b;
    --ice:var(--pa); --ice-soft:rgba(var(--pa-rgb),.13); --ice-bd:rgba(var(--pa-rgb),.5);
    --gold:var(--pa); --gold-soft:rgba(var(--pa-rgb),.14);
    --teal:var(--pb); --teal-soft:rgba(var(--pb-rgb),.12); --teal-bd:rgba(var(--pb-rgb),.46);
    --glow:0 0 14px rgba(var(--pa-rgb),.45); --glowc:rgba(var(--pa-rgb),.8);
    --acc-rgb:var(--pa-rgb);
  }
  /* ---- PET WHITE (light) — warm white washed by the pet accent ---- */
  .nx.sys.sys--light{
    --bg:#fdfbf6; --panel:#f6f1e8; --panel2:#fffefb; --glass:rgba(255,254,250,.96);
    --ink:#1b160d; --muted:#766a58; --faint:#b0a48d; --line:#e7dfcd; --line2:#f1ebde;
    --ice:var(--pal); --ice-soft:rgba(var(--pal-rgb),.1); --ice-bd:rgba(var(--pal-rgb),.42);
    --gold:var(--pal); --gold-soft:rgba(var(--pal-rgb),.12);
    --teal:var(--pbl); --teal-soft:rgba(var(--pbl-rgb),.1); --teal-bd:rgba(var(--pbl-rgb),.4);
    --glow:0 0 12px rgba(var(--pal-rgb),.3); --glowc:rgba(var(--pal-rgb),.5);
    --acc-rgb:var(--pal-rgb);
  }
  .nx.sys.sys--light .nxs1 .nxb-blk.work,.nx.sys.sys--light .nxs1 .nxb-blk.private,.nx.sys.sys--light .nxs1 .nxb-blk.now,.nx.sys.sys--light .ca.pri,.nx.sys.sys--light .tui-btn.pri{ color:#fff; }
  /* steel detailing carried from .ns; ensure prompts read in light */
  .nx.sys.sys--light .prompt{ box-shadow:inset 0 1.5px 4px rgba(80,60,20,.08), 0 1px 0 #fff; }

  /* faint accent wash so "white" feels pet-tinted */
  .sys-wash{ position:absolute; inset:0; pointer-events:none; background:radial-gradient(120% 70% at 50% -8%, rgba(var(--acc-rgb),.10), transparent 60%); }

  /* ===== COMPANION STAGE — reserved space for the animated 3D companion ===== */
  .stage{ position:relative; height:330px; flex:none; overflow:hidden; border-bottom:1px solid var(--line2);
    background:radial-gradient(90% 70% at 50% 32%, rgba(var(--acc-rgb),.12), transparent 62%), linear-gradient(180deg, var(--panel2), var(--panel)); }
  .stage-floor{ position:absolute; left:50%; bottom:44px; transform:translateX(-50%); width:260px; height:46px; border-radius:50%;
    background:radial-gradient(ellipse, rgba(var(--acc-rgb),.22), transparent 70%); filter:blur(2px); }
  .stage-pet{ position:absolute; left:50%; bottom:58px; transform:translateX(-50%); width:188px; height:188px; border-radius:30px; overflow:hidden;
    box-shadow:0 0 0 1px rgba(var(--acc-rgb),.4), 0 0 40px rgba(var(--acc-rgb),.28), inset 0 -30px 50px -24px rgba(0,0,0,.5);
    animation:petFloat 7s ease-in-out infinite; }
  .stage-pet img{ width:252px; display:block; margin-left:-32px; margin-top:-26px; }
  @keyframes petFloat{ 0%,100%{ transform:translateX(-50%) translateY(0) scale(1);} 50%{ transform:translateX(-50%) translateY(-7px) scale(1.012);} }
  .stage-tag{ position:absolute; top:12px; left:14px; font-family:'JetBrains Mono',monospace; font-size:9px; letter-spacing:.06em; color:var(--faint);
    border:1px dashed var(--line); border-radius:6px; padding:3px 8px; }
  .stage-live{ position:absolute; top:12px; right:14px; display:inline-flex; align-items:center; gap:6px; font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--gold); }
  .stage-live::before{ content:""; width:6px; height:6px; border-radius:50%; background:var(--gold); box-shadow:0 0 8px var(--glowc); animation:stlPulse 3s ease-in-out infinite; }
  .stage-info{ position:absolute; left:0; right:0; bottom:12px; text-align:center; }
  .stage-info .nm{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:17px; color:var(--ink); }
  .stage-info .st{ font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--gold); margin-top:2px; }
  .stage-pace{ width:150px; height:5px; border-radius:3px; background:var(--line); margin:8px auto 0; overflow:hidden; }
  .stage-pace span{ display:block; height:100%; width:72%; border-radius:3px; background:linear-gradient(90deg, var(--teal), var(--gold)); }
  @media (prefers-reduced-motion: reduce){ .stage-pet{ animation:none; } }

  /* ===== settings ===== */
  .set-grid{ display:grid; grid-template-columns:1.18fr 1fr; gap:18px; padding:22px 28px 26px; }
  .set-card{ background:linear-gradient(180deg, var(--panel2), var(--panel)); border:1px solid var(--line); border-radius:16px; padding:18px 20px; }
  .set-card h2{ font-family:'Space Grotesk',sans-serif; font-size:15.5px; font-weight:600; margin:0 0 3px; }
  .set-card .sub{ font-size:12px; color:var(--muted); margin-bottom:12px; }
  .set-row{ display:flex; align-items:center; gap:12px; padding:10px 0; border-top:1px solid var(--line2); }
  .set-row:first-of-type{ border-top:none; }
  .set-row .rt{ font-size:13.5px; font-weight:600; }
  .set-row .rs{ font-size:11.5px; color:var(--muted); margin-top:1px; }
  .set-row .rc{ margin-left:auto; flex:none; }
  .tg{ width:42px; height:24px; border-radius:999px; background:var(--line); position:relative; cursor:pointer; transition:background .18s; }
  .tg.on{ background:var(--teal); } .tg.lock{ background:var(--gold); cursor:default; }
  .tg .kn{ position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:#fff; transition:left .18s; box-shadow:0 1px 2px rgba(0,0,0,.4); }
  .tg.on .kn,.tg.lock .kn{ left:21px; }
  .lockcap{ font-family:'JetBrains Mono',monospace; font-size:8.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--gold); margin-right:8px; }
  .segc{ display:inline-flex; background:var(--panel); border:1px solid var(--line); border-radius:9px; padding:3px; gap:2px; }
  .segc span{ font-size:11.5px; font-weight:600; padding:4px 12px; border-radius:6px; color:var(--muted); cursor:pointer; white-space:nowrap; }
  .segc span.on{ background:var(--ice-soft); color:var(--ice); box-shadow:inset 0 0 0 1px var(--ice-bd); }
  .petpick{ display:flex; gap:10px; flex-wrap:wrap; }
  .petopt{ display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer; }
  .petswatch{ width:46px; height:46px; border-radius:14px; display:grid; place-items:center; border:1.5px solid var(--line); position:relative; }
  .petopt.on .petswatch{ border-color:var(--accpa); box-shadow:0 0 0 2px var(--bg), 0 0 0 3.5px var(--accpa); }
  .petswatch i{ width:22px; height:22px; border-radius:50%; }
  .petopt .pn{ font-size:11px; font-weight:600; color:var(--muted); }
  .petopt.on .pn{ color:var(--ink); }
  .vis-chip{ font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:600; padding:3px 9px; border-radius:7px; white-space:nowrap; }
  .vis-chip.det{ background:var(--ice-soft); color:var(--ice); box-shadow:inset 0 0 0 1px var(--ice-bd); }
  .vis-chip.busy{ color:var(--muted); border:1px solid var(--line); }
  .vis-chip.hid{ color:var(--faint); border:1px dashed var(--line); }
  .vis-chip.all{ background:var(--teal); color:#16130c; }
  .nx.sys.sys--light .vis-chip.all{ color:#fff; }
  .keyfield{ font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--muted); background:var(--bg); border:1px solid var(--line); border-radius:7px; padding:5px 10px; }
  `}</style>
);

const PETS = [
  { id: "cat", name: "Cat", c1: "#e9b96b", c2: "#d4c8a8", who: "Pixie · golden british shorthair" },
  { id: "dog", name: "Dog", c1: "#e0975a", c2: "#cbb091", who: "your good dog" },
  { id: "fox", name: "Fox", c1: "#e8825a", c2: "#d8a98f", who: "a clever fox" },
  { id: "bunny", name: "Bunny", c1: "#dd9ab8", c2: "#c6b4d2", who: "a soft rabbit" },
  { id: "bird", name: "Bird", c1: "#5fb6c0", c2: "#9fc9b2", who: "a calm bird" },
];

function CompanionStage({ name = "Pixie", status = "healthy · mewing away", petId = "cat" }) {
  return (
    <div className="stage">
      <div className="stage-tag">companion · 3D / vector · animated</div>
      <div className="stage-live">live</div>
      <div className="stage-floor"></div>
      <div className="stage-pet">
        {petId === "cat"
          ? <img src="pixie-poly-face.svg" alt={name} />
          : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", background: "rgba(var(--acc-rgb),.14)" }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--gold)", textAlign: "center", lineHeight: 1.6 }}>{name}<br />3D companion<br /><span style={{ color: "var(--faint)" }}>art per pet</span></span>
            </div>}
      </div>
      <div className="stage-info">
        <div className="nm">{name}</div>
        <div className="st">{status}</div>
        <div className="stage-pace"><span></span></div>
      </div>
    </div>
  );
}

/* the session log, reused under the stage */
function SessionLog() {
  return (
    <React.Fragment>
      <div className="trm-bar"><span className="dots"><span></span><span></span><span></span></span><span>mew session — tty1</span><span style={{ marginLeft: "auto" }}><kbd>⌘K</kbd></span></div>
      <div style={{ flex: 1, padding: "14px 20px", minHeight: 0, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden", justifyContent: "flex-end" }}>
        <div className="log" style={{ fontSize: 11.5 }}>
          <div style={{ color: "var(--faint)" }}># tuesday · plan committed 08:45 · 6 blocks</div>
          <div style={{ marginTop: 9 }}><span className="p-you prompt">you ❯</span> <b>block thursday morning for the deck</b></div>
          <div style={{ marginTop: 3 }}><span className="p-mew prompt">mew ❯</span> <span className="ok">✓</span> thu 09:00–12:00 <b>held</b></div>
          <div style={{ marginTop: 10 }}><span className="p-mew prompt">mew ❯</span> <span className="mw">★</span> <b>mew #5</b> — standup notes · 5 today</div>
        </div>
        <div className="tui-nudge">
          <div className="h">▸ nudge/drift — 09:40</div>
          still on the deck, or should i move it? off-task ~12 min.<br />
          <span className="tui-btn pri">still on it</span><span className="tui-btn">move it</span><span className="tui-btn">guard block</span>
        </div>
      </div>
      <div style={{ padding: "0 16px 16px" }}>
        <div className="prompt" style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", fontSize: 12.5 }}>
          <span className="p-you">you</span> <span className="p-arr">❯</span><span className="blink"></span>
        </div>
      </div>
    </React.Fragment>
  );
}

function RightColumn({ petName, petId }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--panel)", borderLeft: "1px solid var(--line2)" }}>
      <CompanionStage name={petName} petId={petId} status={petId === "cat" ? "healthy · mewing away" : "healthy"} />
      <SessionLog />
    </div>
  );
}

function SurfaceMain({ pet = "cat", light, defaultView = "focus", reveal }) {
  const [view, setView] = React.useState(defaultView);
  const petObj = PETS.find((p) => p.id === pet) || PETS[0];
  const petName = pet === "cat" ? "Pixie" : petObj.name;
  return (
    <div className={"stl nx ns sys " + (light ? "sys--light" : "")} data-pet={pet} style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 452px", background: "var(--bg)", position: "relative" }}>
      <div className="sys-wash"></div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 20, left: 28, zIndex: 10 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em", color: "var(--ink)" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 16, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <NxClock />
          <span className="agent">watching · drift armed · quiet 18:30</span>
        </div>
        <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}>
          <span className="seg2">
            <span className={view === "focus" ? "on" : ""} onClick={() => setView("focus")}>Focus</span>
            <span className={view === "week" ? "on" : ""} onClick={() => setView("week")}>Week</span>
          </span>
        </div>
        {view === "focus" ? <NxFocus reveal={reveal} /> : <div style={{ width: 730 }}><NxbColumns H={540} styleClass="nxs1" /></div>}
      </div>
      <RightColumn petName={petName} petId={pet} />
    </div>
  );
}

Object.assign(window, { SystemStyles, PETS, CompanionStage, RightColumn, SessionLog, SurfaceMain });
