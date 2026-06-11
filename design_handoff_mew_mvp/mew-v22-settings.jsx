// mew-v22-settings.jsx — Settings on Carbon, with a LIVE pet-type picker that
// re-themes the whole page (theme follows pet). Reuses SystemStyles tokens.

function Toggle({ on, lock, cap }) {
  return (
    <div className="rc" style={{ display: "flex", alignItems: "center" }}>
      {lock && cap && <span className="lockcap">{cap}</span>}
      <div className={"tg" + (on ? " on" : "") + (lock ? " lock" : "")}><span className="kn"></span></div>
    </div>
  );
}
function SetRow({ t, s, children }) {
  return (
    <div className="set-row">
      <div style={{ minWidth: 0 }}><div className="rt">{t}</div>{s && <div className="rs">{s}</div>}</div>
      {children}
    </div>
  );
}

function SurfaceSettings({ light, defaultPet = "cat" }) {
  const [pet, setPet] = React.useState(defaultPet);
  const [mode, setMode] = React.useState(light ? "white" : "carbon");
  const petObj = PETS.find((p) => p.id === pet);
  const isLight = mode === "white";
  return (
    <div className={"stl nx ns sys " + (isLight ? "sys--light" : "")} data-pet={pet}
      style={{ width: 1280, height: 840, background: "var(--bg)", position: "relative", overflow: "hidden", color: "var(--ink)" }}>
      <div className="sys-wash"></div>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 28px", borderBottom: "1px solid var(--line2)", position: "relative" }}>
        <span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em" }}>MEW</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>settings</span>
        <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--gold)" }}>← back to your week</span>
      </div>

      <div className="set-grid" style={{ position: "relative" }}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="set-card">
            <h2>Your companion</h2>
            <div className="sub">Your pet sets the personality — and the theme follows it.</div>
            <div className="petpick" style={{ marginBottom: 6 }}>
              {PETS.map((p) => (
                <div key={p.id} className={"petopt" + (p.id === pet ? " on" : "")} onClick={() => setPet(p.id)} style={{ "--accpa": p.c1 }}>
                  <div className="petswatch"><i style={{ background: "linear-gradient(135deg," + p.c1 + "," + p.c2 + ")" }}></i></div>
                  <span className="pn">{p.name}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, padding: "12px", background: "var(--bg)", border: "1px solid var(--line2)", borderRadius: 12 }}>
              <div style={{ width: 58, height: 58, borderRadius: 14, overflow: "hidden", flex: "none", boxShadow: "0 0 0 1px rgba(var(--acc-rgb),.4), 0 0 20px rgba(var(--acc-rgb),.25)", display: "grid", placeItems: "center", background: "rgba(var(--acc-rgb),.12)" }}>
                {pet === "cat" ? <img src="pixie-poly-face.svg" alt="" style={{ width: 80, marginLeft: -11, marginTop: -8 }} /> : <span className="mono" style={{ fontSize: 16, color: "var(--gold)" }}>{petObj.name[0]}</span>}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{pet === "cat" ? "Pixie" : petObj.name} <span className="mono" style={{ fontSize: 10, color: "var(--faint)", fontWeight: 400 }}>rename</span></div>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>{petObj.who}</div>
                <div className="mono" style={{ fontSize: 10, color: "var(--gold)", marginTop: 4 }}>animated 3D companion · change look</div>
              </div>
            </div>
            <SetRow t="Condition mirrors sustainability" s="Not how much you do — how sustainably."><Toggle on lock cap="always" /></SetRow>
            <SetRow t="Care, not blame" s="Strain is met with help, never judgment."><Toggle on lock cap="absolute" /></SetRow>
          </div>

          <div className="set-card">
            <h2>Calendars & what they see</h2>
            <div className="sub">MEW sees the whole week; each calendar sees only what you allow.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr repeat(3,auto)", gap: "8px 10px", alignItems: "center" }}>
              <span className="mono" style={{ fontSize: 9, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".1em" }}>calendar</span>
              <span className="mono" style={{ fontSize: 9, color: "var(--faint)" }}>work</span>
              <span className="mono" style={{ fontSize: 9, color: "var(--faint)" }}>private</span>
              <span className="mono" style={{ fontSize: 9, color: "var(--faint)" }}>health</span>

              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--gold)" }}>MEW</span>
              <span className="vis-chip all">all</span><span className="vis-chip all">all</span><span className="vis-chip all">all</span>

              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Google · Work</span>
              <span className="vis-chip det">details</span><span className="vis-chip busy">busy</span><span className="vis-chip hid">hidden</span>

              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Google · Personal</span>
              <span className="vis-chip busy">busy</span><span className="vis-chip det">details</span><span className="vis-chip det">details</span>

              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Outlook · Acme</span>
              <span className="vis-chip det">details</span><span className="vis-chip hid">hidden</span><span className="vis-chip hid">hidden</span>
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--gold)", marginTop: 12 }}>+ connect a calendar <span style={{ color: "var(--faint)" }}>· google · outlook · caldav</span></div>
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="set-card">
            <h2>Appearance</h2>
            <div className="sub">Two modes; the accent is your pet's. Carbon by default.</div>
            <SetRow t="Mode">
              <div className="rc"><span className="segc">
                <span className={!isLight ? "on" : ""} onClick={() => setMode("carbon")}>Carbon</span>
                <span className={isLight ? "on" : ""} onClick={() => setMode("white")}>Pet white</span>
              </span></div>
            </SetRow>
            <SetRow t="Accent" s={"Follows " + (pet === "cat" ? "Pixie" : petObj.name) + " — gold for work, soft for life."}>
              <div className="rc" style={{ display: "flex", gap: 6 }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--ice)" }}></span>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--teal)" }}></span>
              </div>
            </SetRow>
          </div>

          <div className="set-card">
            <h2>Nudges & notifications</h2>
            <div className="sub">Everything arrives in chat. Browser only mirrors when you're away.</div>
            <SetRow t="Nudges in chat" s="The one channel — never a separate inbox."><Toggle on lock cap="chat-first" /></SetRow>
            <SetRow t="Browser notifications" s="Mirror the chat nudge when the tab is unfocused."><Toggle on /></SetRow>
            <SetRow t="Quiet hours"><div className="rc"><span className="segc"><span className="on">18:30 – 08:30</span></span></div></SetRow>
            <SetRow t="Show the science" s="Each nudge cites the research behind it."><Toggle on /></SetRow>
            <SetRow t="Positive only" s="Reward follow-through; never punish gaps."><Toggle on lock cap="principle" /></SetRow>
          </div>

          <div className="set-card">
            <h2>Privacy & model</h2>
            <div className="sub">Local-first. Your week is yours.</div>
            <SetRow t="Local-first storage" s="Your data lives on your device."><Toggle on lock cap="by design" /></SetRow>
            <SetRow t="Bring your own key"><div className="rc"><span className="keyfield">sk-••••••••••7f2a</span></div></SetRow>
            <SetRow t="Where the model runs">
              <div className="rc"><span className="segc"><span className="on">Remote</span><span>Fully local</span></span></div>
            </SetRow>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SurfaceSettings, Toggle, SetRow });
