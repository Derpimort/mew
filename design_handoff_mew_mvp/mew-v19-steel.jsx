// mew-v19-steel.jsx — S1 locked, now with STEEL. Linear-grade cool-graphite
// surfaces under Pixie's warm accents — applied to the whole surface,
// especially the chat/session column. Three variants:
// G1 GRAPHITE — steel panels everywhere, key-line borders (most Linear).
// G2 CARBON — pitch black stage, steel only on interactive surfaces, subtle sheen.
// G3 STEEL LIGHT — the light twin: white-steel surfaces, cool borders.

const NsStyles = () => (
  <style>{`
  /* shared steel detailing */
  .ns .trm-bar{ background:linear-gradient(180deg, var(--panel2), var(--panel)); border-bottom:1px solid var(--line); border-top:1px solid var(--line); }
  .ns .den-zone{ background:linear-gradient(180deg, var(--panel2), var(--panel)); border-bottom:1px solid var(--line); }
  .ns .prompt{ box-shadow:inset 0 1.5px 4px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.03); }
  .ns .tui-nudge{ background:linear-gradient(180deg, var(--panel2), var(--panel)); border:1px solid var(--line); box-shadow:0 6px 20px -10px rgba(0,0,0,.5); }
  .ns .tui-nudge .h{ color:var(--ice); }
  .ns .tui-btn{ background:var(--panel2); border:1px solid var(--line); box-shadow:0 1px 0 rgba(255,255,255,.04), 0 1px 2px rgba(0,0,0,.3); }
  .ns .tui-btn.pri{ background:var(--ice); border-color:var(--ice); box-shadow:0 2px 10px -2px var(--glowc); color:#16100a; }
  .ns .seg2{ background:linear-gradient(180deg, var(--panel2), var(--panel)); box-shadow:inset 0 1px 0 rgba(255,255,255,.04); }
  .ns .nxb-col.today{ background:linear-gradient(180deg, var(--panel2), var(--panel)); }
  .ns .den-big{ box-shadow:0 0 0 1.5px var(--gold), 0 0 28px rgba(233,185,107,.22), inset 0 -30px 50px -24px rgba(0,0,0,.55); }
  .ns3.ns .prompt{ box-shadow:inset 0 1.5px 4px rgba(20,25,35,.12), 0 1px 0 #fff; }
  .ns3.ns .tui-nudge{ box-shadow:0 6px 20px -12px rgba(30,40,60,.25); }
  .ns3.ns .tui-btn{ box-shadow:0 1px 0 #fff, 0 1px 2px rgba(30,40,60,.15); }
  .ns3.ns .tui-btn.pri{ color:#fff; }
  .ns3.ns .nxs1 .nxb-blk.work{ color:#fff; }
  .ns3.ns .nxs1 .nxb-blk.private{ color:#fff; }
  .ns3.ns .nxs1 .nxb-blk.now{ color:#fff; }

  /* G1 · GRAPHITE — cool steel panels, the Linear temperature */
  .nx.ns1{
    --bg:#0f1114; --panel:#16191e; --panel2:#1d2127; --glass:rgba(24,27,33,.92);
    --ink:#e9ebee; --muted:#959daa; --faint:#5b626d; --line:#272c35; --line2:#1d2129;
    --ice:#e9b96b; --ice-soft:rgba(233,185,107,.13); --ice-bd:rgba(233,185,107,.45);
    --teal:#d4c8a8; --teal-soft:rgba(212,200,168,.11); --teal-bd:rgba(212,200,168,.42);
    --gold:#e9b96b; --gold-soft:rgba(233,185,107,.14);
    --glow:0 0 14px rgba(233,185,107,.4); --glowc:rgba(233,185,107,.7);
  }
  /* G2 · CARBON — black stage, steel components only */
  .nx.ns2{
    --bg:#060708; --panel:#14161a; --panel2:#1a1d22; --glass:rgba(20,22,26,.94);
    --ink:#ecedef; --muted:#8f97a3; --faint:#555c66; --line:#23272e; --line2:#15171b;
    --ice:#e9b96b; --ice-soft:rgba(233,185,107,.13); --ice-bd:rgba(233,185,107,.45);
    --teal:#d4c8a8; --teal-soft:rgba(212,200,168,.11); --teal-bd:rgba(212,200,168,.42);
    --gold:#e9b96b; --gold-soft:rgba(233,185,107,.14);
    --glow:0 0 14px rgba(233,185,107,.45); --glowc:rgba(233,185,107,.75);
  }
  /* G3 · STEEL LIGHT */
  .nx.ns3{
    --bg:#f3f4f6; --panel:#ffffff; --panel2:#eceef2; --glass:rgba(255,255,255,.95);
    --ink:#15171c; --muted:#5e6673; --faint:#9aa1ab; --line:#d8dce3; --line2:#e8ebef;
    --ice:#a4761f; --ice-soft:rgba(164,118,31,.1); --ice-bd:rgba(164,118,31,.42);
    --teal:#7e7250; --teal-soft:rgba(126,114,80,.1); --teal-bd:rgba(126,114,80,.4);
    --gold:#a4761f; --gold-soft:rgba(164,118,31,.12);
    --glow:0 0 12px rgba(164,118,31,.3); --glowc:rgba(164,118,31,.45);
  }
  `}</style>
);

function SurfaceNxS({ variant = 1, view = "week" }) {
  return (
    <div className={"stl nx ns ns" + variant} style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 452px", background: "var(--bg)" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 20, left: 28, zIndex: 10 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em", color: "var(--ink)" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 22, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <span className="agent">watching · drift armed · quiet 18:30</span>
        </div>
        <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}>
          <span className="seg2">
            <span className={view === "focus" ? "on" : ""}>Focus</span>
            <span className={view === "week" ? "on" : ""}>Week</span>
          </span>
        </div>
        {view === "week" ? (
          <div style={{ width: 730 }}><NxbColumns H={540} styleClass="nxs1" /></div>
        ) : (
          <NxFocus reveal />
        )}
      </div>
      <DenSession />
    </div>
  );
}

Object.assign(window, { NsStyles, SurfaceNxS });
