// mew-v27-canonical.jsx — THE CANONICAL MAIN PAGE.
// Focus = P1 "orbit lanes": every item a thin labeled arc, focus owns the outer
// orbit + the center, one click promotes/demotes. Week = solid columns (S1).
// Loose-threads rail (F1) on the left of the dial. Per-pet theming intact.

function FocusOrbit({ defaultFocus = 0 }) {
  const [focus, setFocus] = React.useState(defaultFocus);
  const [hover, setHover] = React.useState(null);
  const [railOpen, setRailOpen] = React.useState(false);
  const vis = P_ITEMS.map((it, i) => [it, i]).filter(([it]) => pVisible(it));
  const radii = radiiFor("lanes", vis, focus);
  const labels = resolveLabels(vis, radii, "lanes");
  const fItem = focus != null ? P_ITEMS[focus] : null;
  const nextUp = P_ITEMS.filter((it) => it.s > NOW_H)[0];
  return (
    <div style={{ position: "relative", width: PG.w, height: PG.h }}>
      <svg width={PG.w} height={PG.h} viewBox={`-${PG.ox} 0 ${PG.w} ${PG.h}`}>
        <circle cx={PG.cx} cy={PG.cy} r={PG.ro} fill="none" stroke="var(--line)" strokeWidth="1.2" />
        {vis.map(([it, i], k) => (
          <PriArc key={i} it={it} i={i} r={radii[k]} focus={focus} hover={hover} setHover={setHover} setFocus={setFocus}
            lx={labels[k].x} ly={labels[k].y} />
        ))}
        {(() => { const [x, y] = rPolar(PG.cx, PG.cy, PG.ro, 0); return (
          <g><circle cx={x} cy={y} r="6.5" fill="var(--ice)" style={{ filter: "drop-shadow(0 0 12px var(--glowc))" }} />
          <text x={x} y={y - 18} textAnchor="middle" style={{ fill: "var(--ice)", fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>now · {fmtH(NOW_H)}</text></g>
        ); })()}
      </svg>
      <PriCenter item={fItem} next={nextUp ? nextUp.title + " " + fmtH(nextUp.s) : "—"} onDemote={() => setFocus(null)} />
      {!railOpen ? (
        <div className="frail" onClick={() => setRailOpen(true)}>
          <span className="cnt">{THREADS.length}</span>
          {THREADS.map((t, i) => <span key={i} className="dot" style={{ background: i === 0 ? "var(--ice)" : i === 1 ? "var(--gold)" : i === 2 ? "var(--muted)" : "var(--faint)" }}></span>)}
          <span className="vlabel">threads</span>
        </div>
      ) : (
        <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", zIndex: 9 }}><ThreadBox onClose={() => setRailOpen(false)} /></div>
      )}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 18, textAlign: "center" }}>
        <span className="pri-hint">click any item to focus it · click the chip to let it run</span>
      </div>
    </div>
  );
}

function SurfaceMew({ pet = "cat", light, defaultView = "focus", defaultFocus = 0 }) {
  const [view, setView] = React.useState(defaultView);
  const petObj = PETS.find((p) => p.id === pet) || PETS[0];
  const petName = pet === "cat" ? "Pixie" : petObj.name;
  return (
    <div className={"stl nx ns sys " + (light ? "sys--light" : "")} data-pet={pet}
      style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 452px", background: "var(--bg)", position: "relative" }}>
      <div className="sys-wash"></div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 20, left: 28, zIndex: 10 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em", color: "var(--ink)" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 16, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <NxClock /><span className="agent">watching · drift armed · quiet 18:30</span>
        </div>
        <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}>
          <span className="seg2">
            <span className={view === "focus" ? "on" : ""} onClick={() => setView("focus")}>Focus</span>
            <span className={view === "week" ? "on" : ""} onClick={() => setView("week")}>Week</span>
          </span>
        </div>
        {view === "focus" ? <FocusOrbit defaultFocus={defaultFocus} /> : <div style={{ width: 730 }}><NxbColumns H={540} styleClass="nxs1" /></div>}
      </div>
      <RightColumn petName={petName} petId={pet} />
    </div>
  );
}

Object.assign(window, { FocusOrbit, SurfaceMew });
