// mew-v18-weekstyles.jsx — W2 (pure columns) finalized: today/selected day is
// WIDER, and translucency is replaced by three opaque AI-first material styles:
// S1 SOLID — full-ink blocks, dark text on Pixie gold/cream. Print-grade.
// S2 BLUEPRINT — crisp outlines, transparent interiors; only NOW is filled.
// S3 INK EDGE — opaque neutral panels with a colored edge; color as marker only.

const NxbStyles = () => (
  <style>{`
  .nxb-col{ position:relative; border-radius:12px; }
  .nxb-col.today{ background:var(--panel); box-shadow:inset 0 0 0 1.4px var(--ice-bd); }
  .nxb-col.past{ opacity:.45; }
  .nxb-dl{ text-align:center; margin-bottom:8px; }
  .nxb-dl .d{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:13px; }
  .nxb-dl .n{ font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--muted); margin-top:1px; }
  .nxb-dl.today .d{ color:var(--ice); font-size:15px; }
  .nxb-hl{ font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--faint); }
  .nxb-now{ position:absolute; left:2px; right:2px; height:1.6px; background:var(--ice); box-shadow:0 0 10px var(--glowc); z-index:6; border-radius:2px; }
  .nxb-now::before{ content:""; position:absolute; left:-4px; top:-3px; width:8px; height:8px; border-radius:50%; background:var(--ice); }
  .nxb-blk{ position:absolute; left:4px; right:4px; border-radius:7px; overflow:hidden; padding:4px 8px; box-sizing:border-box; }
  .nxb-blk .t{ font-family:'Hanken Grotesk',sans-serif; font-size:10.5px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.3; }
  .nxb-blk .m{ font-family:'JetBrains Mono',monospace; font-size:8.5px; white-space:nowrap; }

  /* S1 · SOLID — ink on color */
  .nxs1 .nxb-blk.work{ background:var(--ice); color:#16100a; }
  .nxs1 .nxb-blk.private{ background:var(--teal); color:#16130c; }
  .nxs1 .nxb-blk.rest{ background:transparent; box-shadow:inset 0 0 0 1.4px var(--teal); color:var(--teal); }
  .nxs1 .nxb-blk .m{ opacity:.66; }
  .nxs1 .nxb-blk.done{ background:transparent; box-shadow:inset 0 0 0 1.2px var(--faint); color:var(--muted); }
  .nxs1 .nxb-blk.done .t{ text-decoration:line-through; font-weight:600; }
  .nxs1 .nxb-blk.now{ background:var(--ice); color:#16100a; box-shadow:0 0 0 2px var(--bg), 0 0 0 3.6px var(--ice), 0 0 22px var(--glowc); }
  .nx--light .nxs1 .nxb-blk.work{ color:#fff; }
  .nx--light .nxs1 .nxb-blk.private{ color:#fff; }
  .nx--light .nxs1 .nxb-blk.now{ color:#fff; }

  /* S2 · BLUEPRINT — outlines only; now is the only fill */
  .nxs2 .nxb-blk{ background:transparent; border-radius:6px; }
  .nxs2 .nxb-blk.work{ box-shadow:inset 0 0 0 1.5px var(--ice); color:var(--ice); }
  .nxs2 .nxb-blk.private{ box-shadow:inset 0 0 0 1.5px var(--teal); color:var(--teal); }
  .nxs2 .nxb-blk.rest{ box-shadow:none; border:1.4px dashed var(--teal); color:var(--teal); }
  .nxs2 .nxb-blk.done{ box-shadow:inset 0 0 0 1.2px var(--faint); color:var(--muted); }
  .nxs2 .nxb-blk.done .t{ text-decoration:line-through; }
  .nxs2 .nxb-blk.now{ background:var(--ice); box-shadow:0 0 18px var(--glowc); color:#16100a; }
  .nxs2 .nxb-blk .m{ opacity:.8; }
  .nx--light .nxs2 .nxb-blk.now{ color:#fff; }

  /* S3 · INK EDGE — opaque neutral panels, color as a 3px edge */
  .nxs3 .nxb-blk{ background:var(--panel2); border-radius:6px; padding-left:11px; color:var(--ink); }
  .nxs3 .nxb-blk::before{ content:""; position:absolute; left:0; top:0; bottom:0; width:3.5px; }
  .nxs3 .nxb-blk.work::before{ background:var(--ice); }
  .nxs3 .nxb-blk.private::before{ background:var(--teal); }
  .nxs3 .nxb-blk.rest{ background:transparent; box-shadow:inset 0 0 0 1.2px var(--line); color:var(--teal); }
  .nxs3 .nxb-blk.rest::before{ background:var(--teal); opacity:.6; }
  .nxs3 .nxb-blk .m{ color:var(--muted); }
  .nxs3 .nxb-blk.done{ opacity:.5; }
  .nxs3 .nxb-blk.done .t{ text-decoration:line-through; }
  .nxs3 .nxb-blk.now{ background:var(--panel2); box-shadow:inset 0 0 0 1.6px var(--ice), 0 0 18px var(--glowc); }
  .nxs3 .nxb-blk.now::before{ background:var(--ice); width:4.5px; }
  `}</style>
);

function NxbColumns({ H = 540, styleClass }) {
  const cols = "34px " + DAY_META.map((m) => (m.today ? "2.3fr" : "1fr")).join(" ");
  return (
    <div className={styleClass}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 7 }}>
        <span></span>
        {DAY_META.map((m) => (
          <div key={m.d} className={"nxb-dl" + (m.today ? " today" : "")}>
            <div className="d">{m.d}</div><div className="n">jun {m.n}{m.heavy ? " · 8h" : ""}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 7 }}>
        <div style={{ position: "relative" }}>
          {[8, 11, 14, 17].map((h) => <span key={h} className="nxb-hl" style={{ position: "absolute", top: nxwY(h, H) - 5, right: 2 }}>{h}:00</span>)}
        </div>
        {DAY_META.map((m) => (
          <div key={m.d} className={"nxb-col" + (m.today ? " today" : "") + (m.past ? " past" : "")} style={{ height: H }}>
            {DAYBLOCKS[m.d].map((b, i) => {
              const [s, e, title, tag, f = {}] = b;
              const dur = e - s;
              const showT = m.today ? dur >= 0.45 : dur >= 1;
              const showM = m.today && dur >= 0.95;
              return (
                <div key={i} className={"nxb-blk " + tag + (f.now ? " now" : "") + (f.done ? " done" : "")}
                  style={{ top: nxwY(s, H) + 1.5, height: nxwY(e, H) - nxwY(s, H) - 4 }} title={title + " · " + fmtH(s) + "–" + fmtH(e)}>
                  {showT && <div className="t" style={m.today ? {} : { fontSize: 9, fontWeight: 650 }}>{f.done ? "✓ " : ""}{title}</div>}
                  {showM && <div className="m">{fmtH(s)}–{fmtH(e)}{f.prot ? " · held" : ""}{f.now ? " · now" : ""}</div>}
                </div>
              );
            })}
            {m.today && <div className="nxb-now" style={{ top: nxwY(NOW_H, H) }}></div>}
          </div>
        ))}
      </div>
      <div className="nx-mono" style={{ fontSize: 10.5, color: "var(--muted)", textAlign: "center", marginTop: 16 }}>
        32h planned · rest kept <span style={{ color: "var(--teal)", fontWeight: 700 }}>4/5</span> · wednesday wants a kinder shape — <span style={{ color: "var(--gold)", fontWeight: 700 }}>nudge in chat</span>
      </div>
    </div>
  );
}

function SurfaceNxB({ variant = 1, light }) {
  return (
    <div className={"stl nx" + (light ? " nx--light" : "")} style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 452px", background: "var(--bg)" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 20, left: 28, zIndex: 10 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em", color: "var(--ink)" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 22, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <span className="agent">watching · drift armed · quiet 18:30</span>
        </div>
        <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}>
          <span className="seg2"><span>Focus</span><span className="on">Week</span></span>
        </div>
        <div style={{ width: 730 }}>
          <NxbColumns H={540} styleClass={"nxs" + variant} />
        </div>
      </div>
      <DenSession />
    </div>
  );
}

Object.assign(window, { NxbStyles, SurfaceNxB });
