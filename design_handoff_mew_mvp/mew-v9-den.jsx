// mew-v9-den.jsx — THE DEN, vertical. Time falls top→bottom along a luminous
// spine; work lives left of the line, life right. Day = one tall spine,
// Week = seven slender spines. Live Day/Week selector. Steel system (v8 core).

const VDenStyles = () => (
  <style>{`
  .vd-block{ position:absolute; border:1px solid; overflow:hidden; padding:5px 9px; box-sizing:border-box; }
  .vd-block .bt{ font-size:11.5px; font-weight:600; line-height:1.3; }
  .vd-block .bm2{ font-size:9px; opacity:.7; font-family:'JetBrains Mono',monospace; margin-top:1px; white-space:nowrap; }
  .vd-block.work{ background:var(--ice-soft); border-color:var(--ice-bd); color:var(--ice); border-radius:9px 4px 4px 9px; }
  .vd-block.private{ background:var(--teal-soft); border-color:var(--teal-bd); color:var(--teal); border-radius:4px 9px 9px 4px; }
  .vd-block.rest{ background:transparent; border:1.2px dashed var(--teal); color:var(--teal); border-radius:4px 9px 9px 4px; }
  .vd-block.now{ border-color:var(--ice); box-shadow:var(--glow); color:var(--ink); background:linear-gradient(90deg, rgba(130,180,232,.28), rgba(130,180,232,.10)); }
  .vd-block.done{ opacity:.4; }
  .vd-block.done .bt{ text-decoration:line-through; }
  .vd-mini .bt{ font-size:9px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .vd-spine{ position:absolute; top:0; bottom:0; width:2px; transform:translateX(-50%); background:linear-gradient(180deg, transparent, var(--ice-bd) 8%, var(--ice-bd) 92%, transparent); }
  .vd-spine.bright{ background:linear-gradient(180deg, transparent, var(--ice-bd) 6%, var(--ice) 50%, var(--ice-bd) 94%, transparent); box-shadow:0 0 14px rgba(130,180,232,.3); }
  .vd-tick{ position:absolute; width:6px; height:1.5px; background:var(--line); transform:translate(-50%,-50%); }
  .vd-hl{ position:absolute; transform:translateY(-50%); font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--faint); }
  .vd-orb{ position:absolute; transform:translate(-50%,-50%); width:11px; height:11px; border-radius:50%; background:#dcebfa; box-shadow:0 0 22px 6px rgba(130,180,232,.6); z-index:6; }
  .vd-dlabel{ text-align:center; font-size:11.5px; font-weight:700; margin-bottom:8px; }
  .vd-dlabel small{ display:block; font-size:8.5px; color:var(--faint); font-family:'JetBrains Mono',monospace; margin-top:1px; }
  .vd-dlabel.today span{ background:var(--ice-soft); box-shadow:inset 0 0 0 1px var(--ice-bd); color:var(--ice); border-radius:7px; padding:2px 9px; }
  .vd-col.past{ opacity:.42; }
  `}</style>
);

const vdPct = (h) => ((h - 8) / 11) * 100;

/* one vertical day — spine centered in its container */
function VDay({ dayKey, today, mini, bright }) {
  const blocks = DAYBLOCKS[dayKey];
  const gap = mini ? 4 : 8;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div className={"vd-spine" + (bright ? " bright" : "")} style={{ left: "50%" }}></div>
      {!mini && [9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((h) => <span key={h} className="vd-tick" style={{ left: "50%", top: vdPct(h) + "%" }}></span>)}
      {blocks.map((b, i) => {
        const [s, e, title, tag, f = {}] = b;
        const work = tag === "work";
        const hp = vdPct(e) - vdPct(s);
        const showT = mini ? (e - s) >= 1 : true;
        return (
          <div key={i} className={"vd-block " + tag + (f.now ? " now" : "") + (f.done ? " done" : "") + (mini ? " vd-mini" : "")}
            style={{ top: vdPct(s) + "%", height: "calc(" + hp + "% - 3px)",
              left: work ? (mini ? 2 : 56) : "calc(50% + " + gap + "px)",
              right: work ? "calc(50% + " + gap + "px)" : (mini ? 2 : 56),
              padding: mini ? "2px 5px" : undefined }}
            title={title + " · " + fmtH(s) + "–" + fmtH(e)}>
            {showT && <div className="bt">{f.done && "✓ "}{title}</div>}
            {!mini && (e - s) >= 0.75 && <div className="bm2">{fmtH(s)}–{fmtH(e)}{f.prot ? " · held" : ""}{f.now ? " · now" : ""}</div>}
          </div>
        );
      })}
      {today && (
        <React.Fragment>
          <div className="vd-orb" style={{ left: "50%", top: vdPct(NOW_H) + "%" }}></div>
          {!mini && <span className="mono" style={{ position: "absolute", left: "calc(50% + 14px)", top: vdPct(NOW_H) + "%", transform: "translateY(-50%)", fontSize: 9.5, color: "var(--ice)", zIndex: 6 }}>{fmtH(NOW_H)}</span>}
        </React.Fragment>
      )}
    </div>
  );
}

function VRuler() {
  return (
    <React.Fragment>
      {[8, 10, 12, 14, 16, 18].map((h) => <span key={h} className="vd-hl" style={{ left: 0, top: vdPct(h) + "%" }}>{h}:00</span>)}
    </React.Fragment>
  );
}

function SurfaceVDen({ defaultMode = "day" }) {
  const [mode, setMode] = React.useState(defaultMode);
  return (
    <div className="stl" style={{ width: 1280, height: 840, background: "linear-gradient(180deg,#090e15 0%,#0e1722 46%,#142231 70%,#101a26 100%)" }}>
      {[[120, 64], [340, 110], [580, 52], [820, 128], [1080, 72], [980, 178], [220, 168], [1180, 148], [700, 92], [460, 196]].map(([x, y], i) => (
        <span key={i} style={{ position: "absolute", left: x, top: y, width: 2, height: 2, borderRadius: "50%", background: "var(--ice)", opacity: .35 }}></span>
      ))}

      <div style={{ position: "absolute", top: 22, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <span className="agent">mew · watching your {mode === "day" ? "tuesday" : "week"}</span>
      </div>
      <div style={{ position: "absolute", top: 22, right: 26, zIndex: 10 }}>
        <span className="seg2">
          <span className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>Day</span>
          <span className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>Week</span>
        </span>
      </div>

      <div style={{ position: "absolute", top: 64, left: 0, right: 0, textAlign: "center", zIndex: 5 }}>
        <div className="slabel" style={{ marginBottom: 9 }}>right now</div>
        <div style={{ fontFamily: "'Newsreader',serif", fontStyle: "italic", fontSize: 38, fontWeight: 500 }}>Finish the Q3 deck.</div>
        <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 7 }}>40:00 left · protected · <span style={{ color: "var(--gold)" }}>5 mews</span> today</div>
      </div>

      {/* the fall — time runs downward */}
      {mode === "day" ? (
        <div style={{ position: "absolute", left: 280, right: 280, top: 208, bottom: 124 }}>
          <VRuler />
          <div style={{ position: "absolute", left: 40, right: 0, top: 0, bottom: 0 }}>
            <VDay dayKey="Tue" today bright />
          </div>
        </div>
      ) : (
        <div style={{ position: "absolute", left: 96, right: 40, top: 232, bottom: 124 }}>
          <VRuler />
          <div style={{ position: "absolute", left: 46, right: 0, top: 0, bottom: 0, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 10 }}>
            {DAY_META.map((m) => (
              <div key={m.d} className={"vd-col" + (m.past ? " past" : "")} style={{ position: "relative" }}>
                <div className={"vd-dlabel" + (m.today ? " today" : "")} style={{ position: "absolute", top: -26, left: 0, right: 0 }}>
                  <span>{m.d} {m.n}</span>
                </div>
                <VDay dayKey={m.d} today={m.today} mini bright={m.today} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* grounded bottom strip — pixie · whisper · nudge */}
      <div style={{ position: "absolute", left: 36, right: 36, bottom: 22, display: "flex", alignItems: "center", gap: 20, zIndex: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, flex: "none" }}>
          <div className="pixavatar" style={{ width: 64, height: 64, borderRadius: 16 }}>
            <img src="pixie-poly-face.svg" alt="Pixie" style={{ width: 88, marginLeft: -12, marginTop: -20 }} />
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: "var(--gold)", lineHeight: 1.6 }}>pixie · healthy<br />mewing away</div>
        </div>
        <div style={{ flex: 1, maxWidth: 560, margin: "0 auto" }}><CmdBar placeholder="Whisper to MEW…" /></div>
        <div style={{ width: 312, flex: "none" }}>
          <SNudge label="nudge · right-size" body="Wednesday holds 8h deep work; your best is ~5½." acts={["Right-size", "Keep"]} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { VDenStyles, SurfaceVDen });
