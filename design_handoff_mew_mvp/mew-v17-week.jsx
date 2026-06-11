// mew-v17-week.jsx — WEEK VIEW in the Noir system. The dial belongs to Focus;
// the week needs its own honest form. Three iterations:
// W1 Quick-dial + vertical week — small today-dial on top, seven day columns below.
// W2 Pure columns — the week as time-true vertical block columns (GCal bones, noir skin).
// W3 Today magnified — seven horizontal tracks, today expanded with labels.

const NxwStyles = () => (
  <style>{`
  .nxw-col{ position:relative; border-radius:12px; }
  .nxw-col.today{ background:var(--panel); box-shadow:inset 0 0 0 1.4px var(--ice-bd); }
  .nxw-col.past{ opacity:.42; }
  .nxw-blk{ position:absolute; left:5px; right:5px; border-radius:7px; overflow:hidden; padding:3px 7px; box-sizing:border-box; }
  .nxw-blk.work{ background:var(--ice-soft); box-shadow:inset 0 0 0 1px var(--ice-bd); color:var(--ice); }
  .nxw-blk.private{ background:var(--teal-soft); box-shadow:inset 0 0 0 1px var(--teal-bd); color:var(--teal); }
  .nxw-blk.rest{ box-shadow:inset 0 0 0 1.2px var(--teal-bd); color:var(--teal); }
  .nxw-blk.rest{ background:transparent; border:none; }
  .nxw-blk.now{ box-shadow:inset 0 0 0 1.6px var(--ice), 0 0 14px var(--glowc); color:var(--ink); background:var(--ice-soft); }
  .nxw-blk.done{ opacity:.4; }
  .nxw-blk .t{ font-family:'Hanken Grotesk',sans-serif; font-size:10px; font-weight:650; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.3; }
  .nxw-blk.done .t{ text-decoration:line-through; }
  .nxw-blk .m{ font-family:'JetBrains Mono',monospace; font-size:8.5px; opacity:.7; white-space:nowrap; }
  .nxw-dl{ text-align:center; margin-bottom:8px; }
  .nxw-dl .d{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:13px; }
  .nxw-dl .n{ font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--muted); margin-top:1px; }
  .nxw-dl.today .d{ color:var(--ice); }
  .nxw-nowline{ position:absolute; left:2px; right:2px; height:1.6px; background:var(--ice); box-shadow:0 0 10px var(--glowc); z-index:5; border-radius:2px; }
  .nxw-nowline::before{ content:""; position:absolute; left:-4px; top:-3px; width:8px; height:8px; border-radius:50%; background:var(--ice); }
  .nxw-hl{ font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--faint); }
  .nx .vd-orb{ background:var(--ice); box-shadow:0 0 18px 5px var(--glowc); }
  .nxw-row{ display:grid; grid-template-columns:46px 1fr; gap:0 12px; align-items:center; }
  .nxw-row.past{ opacity:.42; }
  .nxw-rtrack{ position:relative; border-radius:10px; background:var(--panel); height:30px; }
  .nxw-row.today .nxw-rtrack{ background:var(--panel2); box-shadow:inset 0 0 0 1.4px var(--ice-bd); }
  .nxw-rblk{ position:absolute; top:4px; bottom:4px; border-radius:6px; }
  .nxw-rlbl .d{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:12.5px; }
  .nxw-rlbl .n{ font-family:'JetBrains Mono',monospace; font-size:8.5px; color:var(--muted); }
  `}</style>
);

const nxwY = (h, H) => ((h - 8) / 11) * H;

function NxwColumns({ H = 400, detailToday = true }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "34px repeat(7,1fr)", gap: 8 }}>
        <span></span>
        {DAY_META.map((m) => (
          <div key={m.d} className={"nxw-dl" + (m.today ? " today" : "")}>
            <div className="d">{m.d}</div><div className="n">jun {m.n}{m.heavy ? " · 8h" : ""}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "34px repeat(7,1fr)", gap: 8 }}>
        <div style={{ position: "relative" }}>
          {[8, 11, 14, 17].map((h) => <span key={h} className="nxw-hl" style={{ position: "absolute", top: nxwY(h, H) - 5, right: 2 }}>{h}:00</span>)}
        </div>
        {DAY_META.map((m) => (
          <div key={m.d} className={"nxw-col" + (m.today ? " today" : "") + (m.past ? " past" : "")} style={{ height: H }}>
            {DAYBLOCKS[m.d].map((b, i) => {
              const [s, e, title, tag, f = {}] = b;
              const showText = detailToday && m.today && (e - s) >= 0.5;
              return (
                <div key={i} className={"nxw-blk " + tag + (f.now ? " now" : "") + (f.done ? " done" : "")}
                  style={{ top: nxwY(s, H) + 1, height: nxwY(e, H) - nxwY(s, H) - 3 }} title={title}>
                  {showText && <div className="t">{f.done ? "✓ " : ""}{title}</div>}
                  {showText && (e - s) >= 1 && <div className="m">{fmtH(s)}–{fmtH(e)}{f.prot ? " · held" : ""}</div>}
                </div>
              );
            })}
            {m.today && <div className="nxw-nowline" style={{ top: nxwY(NOW_H, H) }}></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* W1 · quick dial on top, the week below */
function NxWeekW1() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, width: 700 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <NxMini dayKey="Tue" size={148} today />
        <div>
          <div className="nx-mono" style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>right now</div>
          <div className="nx-task" style={{ fontSize: 22, margin: "6px 0 4px" }}>Finish the Q3 deck.</div>
          <div className="nx-mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>40:00 left · held until 11:30 · <span style={{ color: "var(--gold)", fontWeight: 700 }}>5 mews</span></div>
        </div>
      </div>
      <div style={{ width: "100%" }}><NxwColumns H={400} /></div>
    </div>
  );
}

/* W2 · pure columns — blocks only, bigger */
function NxWeekW2() {
  return (
    <div style={{ width: 720 }}>
      <NxwColumns H={560} />
      <div className="nx-mono" style={{ fontSize: 10.5, color: "var(--muted)", textAlign: "center", marginTop: 18 }}>
        32h planned · rest kept <span style={{ color: "var(--teal)", fontWeight: 700 }}>4/5</span> · wednesday wants a kinder shape — <span style={{ color: "var(--gold)", fontWeight: 700 }}>nudge in chat</span>
      </div>
    </div>
  );
}

/* W3 · horizontal tracks, today magnified with labels */
function NxWeekW3() {
  return (
    <div style={{ width: 700, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="nxw-row" style={{ marginBottom: 2 }}>
        <span></span>
        <div style={{ position: "relative", height: 12 }}>
          {[8, 10, 12, 14, 16, 18].map((h) => <span key={h} className="nxw-hl" style={{ position: "absolute", left: (((h - 8) / 11) * 100) + "%", transform: "translateX(-50%)" }}>{h}:00</span>)}
        </div>
      </div>
      {DAY_META.map((m) => {
        const tall = m.today;
        return (
          <div key={m.d} className={"nxw-row" + (m.today ? " today" : "") + (m.past ? " past" : "")}>
            <div className="nxw-rlbl"><div className="d" style={{ color: m.today ? "var(--ice)" : "var(--ink)" }}>{m.d}</div><div className="n">jun {m.n}</div></div>
            <div className="nxw-rtrack" style={{ height: tall ? 96 : 30 }}>
              {DAYBLOCKS[m.d].map((b, i) => {
                const [s, e, title, tag, f = {}] = b;
                const l = ((s - 8) / 11) * 100, w = ((e - s) / 11) * 100;
                return (
                  <div key={i} className={"nxw-blk " + tag + (f.now ? " now" : "") + (f.done ? " done" : "")}
                    style={{ left: l + "%", width: "calc(" + w + "% - 3px)", top: 4, bottom: 4, right: "auto", padding: tall ? "5px 8px" : "0", borderRadius: tall ? 8 : 5 }} title={title}>
                    {tall && w > 7 && <div className="t" style={{ fontSize: 10.5 }}>{f.done ? "✓ " : ""}{title}</div>}
                    {tall && w > 12 && <div className="m">{fmtH(s)}–{fmtH(e)}{f.prot ? " · held" : ""}</div>}
                  </div>
                );
              })}
              {m.today && (() => { const l = ((NOW_H - 8) / 11) * 100; return (
                <div style={{ position: "absolute", top: -4, bottom: -4, left: l + "%", width: 2, borderRadius: 2, background: "var(--ice)", boxShadow: "0 0 10px var(--glowc)", zIndex: 5 }}>
                  <span className="nx-mono" style={{ position: "absolute", top: -16, left: "50%", transform: "translateX(-50%)", fontSize: 8.5, fontWeight: 700, color: "var(--ice)", whiteSpace: "nowrap" }}>{fmtH(NOW_H)}</span>
                </div>
              ); })()}
            </div>
          </div>
        );
      })}
      <div className="nx-mono" style={{ fontSize: 10.5, color: "var(--muted)", textAlign: "center", marginTop: 12, gridColumn: "1 / -1" }}>
        32h planned · rest kept <span style={{ color: "var(--teal)", fontWeight: 700 }}>4/5</span> · <span style={{ color: "var(--gold)", fontWeight: 700 }}>wednesday heavy — nudge in chat</span>
      </div>
    </div>
  );
}

function SurfaceNxW({ variant = 1, light }) {
  const Comp = variant === 1 ? NxWeekW1 : variant === 2 ? NxWeekW2 : NxWeekW3;
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
        <Comp />
      </div>
      <DenSession />
    </div>
  );
}

Object.assign(window, { NxwStyles, SurfaceNxW });
