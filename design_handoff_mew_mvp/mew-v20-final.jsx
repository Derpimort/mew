// mew-v20-final.jsx — THE FINAL SYSTEM.
// Dark = CARBON: pitch-black stage, steel components, Pixie gold/cream accents.
// Light = PET WHITE: warm accented white (not cool steel) — paper warmed by her.
// SurfaceFin is the live main page: Focus ⇄ Week toggle actually switches.

const FinalStyles = () => (
  <style>{`
  .nx.fin{
    --bg:#060708; --panel:#14161a; --panel2:#1a1d22; --glass:rgba(20,22,26,.94);
    --ink:#ecedef; --muted:#8f97a3; --faint:#555c66; --line:#23272e; --line2:#15171b;
    --ice:#e9b96b; --ice-soft:rgba(233,185,107,.13); --ice-bd:rgba(233,185,107,.45);
    --teal:#d4c8a8; --teal-soft:rgba(212,200,168,.11); --teal-bd:rgba(212,200,168,.42);
    --gold:#e9b96b; --gold-soft:rgba(233,185,107,.14);
    --glow:0 0 14px rgba(233,185,107,.45); --glowc:rgba(233,185,107,.75);
  }
  .nx.fin--light{
    --bg:#fdfcf8; --panel:#f7f3ea; --panel2:#fffefb; --glass:rgba(255,254,250,.96);
    --ink:#1c160c; --muted:#7a6f5d; --faint:#b3a78f; --line:#e7dfcd; --line2:#f2ecdf;
    --ice:#a4761f; --ice-soft:rgba(164,118,31,.1); --ice-bd:rgba(164,118,31,.42);
    --teal:#7e7250; --teal-soft:rgba(126,114,80,.1); --teal-bd:rgba(126,114,80,.4);
    --gold:#a4761f; --gold-soft:rgba(164,118,31,.12);
    --glow:0 0 12px rgba(164,118,31,.3); --glowc:rgba(164,118,31,.45);
  }
  .fin--light.ns .prompt{ box-shadow:inset 0 1.5px 4px rgba(80,60,20,.1), 0 1px 0 #fff; }
  .fin--light.ns .tui-nudge{ box-shadow:0 6px 20px -12px rgba(90,70,30,.22); }
  .fin--light.ns .tui-btn{ box-shadow:0 1px 0 #fff, 0 1px 2px rgba(90,70,30,.14); }
  .fin--light.ns .tui-btn.pri{ color:#fff; }
  .fin--light .nxs1 .nxb-blk.work{ color:#fff; }
  .fin--light .nxs1 .nxb-blk.private{ color:#fff; }
  .fin--light .nxs1 .nxb-blk.now{ color:#fff; }
  .fin--light .nx-card .ca.pri{ color:#fff; }
  `}</style>
);

function SurfaceFin({ defaultView = "focus", light, reveal, expand }) {
  const [view, setView] = React.useState(defaultView);
  return (
    <div className={"stl nx ns " + (light ? "fin--light" : "fin")} style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 452px", background: "var(--bg)" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 20, left: 28, zIndex: 10 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em", color: "var(--ink)" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 22, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <span className="agent">watching · drift armed · quiet 18:30</span>
        </div>
        <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}>
          <span className="seg2">
            <span className={view === "focus" ? "on" : ""} onClick={() => setView("focus")}>Focus</span>
            <span className={view === "week" ? "on" : ""} onClick={() => setView("week")}>Week</span>
          </span>
        </div>
        {view === "focus" ? (
          <NxFocus reveal={reveal} expand={expand} />
        ) : (
          <div style={{ width: 730 }}><NxbColumns H={540} styleClass="nxs1" /></div>
        )}
      </div>
      <DenSession />
    </div>
  );
}

Object.assign(window, { FinalStyles, SurfaceFin });
