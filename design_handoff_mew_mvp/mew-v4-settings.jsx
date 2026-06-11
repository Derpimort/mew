// mew-v4-settings.jsx — Settings & Connections surface.
// One calm page: calendars + tag-privacy routing, your mew, nudges &
// notifications, privacy & model. Reuses .mew tokens from surfaces.jsx.

const SettingsStyles = () => (
  <style>{`
  .set-card{ background:var(--panel); border:1px solid var(--line); border-radius:20px; padding:20px 22px; box-sizing:border-box; }
  .set-card h2{ margin:0 0 4px; font-size:16.5px; font-weight:700; letter-spacing:-0.01em; }
  .set-card .sub{ color:var(--muted); font-size:13px; line-height:1.45; margin:0 0 14px; }
  .set-row{ display:flex; align-items:center; gap:12px; padding:11px 0; border-top:1px solid var(--line2); }
  .set-row:first-of-type{ border-top:0; }
  .set-row .rl{ flex:1; min-width:0; }
  .set-row .rl b{ font-size:14px; font-weight:650; display:block; }
  .set-row .rl span{ font-size:12.5px; color:var(--muted); line-height:1.4; display:block; margin-top:2px; }
  .tgl{ width:40px; height:24px; border-radius:999px; background:var(--line); position:relative; flex:none; transition:background .15s; }
  .tgl::after{ content:""; position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.18); transition:left .15s; }
  .tgl.on{ background:var(--sage); }
  .tgl.on::after{ left:19px; }
  .tgl.lock{ background:var(--gold); opacity:.92; }
  .tgl.lock::after{ left:19px; }
  .lockcap{ font-size:10.5px; font-weight:800; letter-spacing:.07em; color:var(--gold); text-transform:uppercase; white-space:nowrap; }
  .seg{ display:inline-flex; background:var(--panel2); border:1px solid var(--line); border-radius:999px; padding:3px; gap:2px; }
  .seg span{ font-size:12.5px; font-weight:650; padding:5px 13px; border-radius:999px; color:var(--muted); white-space:nowrap; }
  .seg span.on{ background:var(--ink); color:var(--bg); }
  .field{ display:flex; align-items:center; gap:8px; background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:8px 12px; font-family:ui-monospace,'SF Mono',monospace; font-size:12.5px; color:var(--muted); }

  .cal-table{ width:100%; border-collapse:separate; border-spacing:0 6px; }
  .cal-table th{ font-size:10.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); text-align:left; padding:0 10px 2px; }
  .cal-table td{ background:var(--panel2); padding:10px; font-size:13.5px; }
  .cal-table tr td:first-child{ border-radius:12px 0 0 12px; }
  .cal-table tr td:last-child{ border-radius:0 12px 12px 0; }
  .cal-name b{ display:block; font-size:13.5px; font-weight:650; white-space:nowrap; }
  .cal-name span{ font-size:11.5px; color:var(--muted); white-space:nowrap; }
  .vis{ display:inline-block; font-size:11px; font-weight:700; padding:3px 10px; border-radius:999px; white-space:nowrap; }
  .vis.details{ background:var(--gold-soft); color:#8a5a18; }
  .vis.busy{ background:var(--line2); color:var(--muted); }
  .vis.hidden{ color:var(--faint); background:transparent; border:1px dashed var(--line); }
  .mewrow td{ background:var(--sage-soft) !important; }
  .vis.all{ background:var(--sage); color:#fff; }
  `}</style>
);

const Tgl = ({ on, lock }) => <span className={"tgl" + (on ? " on" : "") + (lock ? " lock" : "")}></span>;

function SetRow({ title, sub, right }) {
  return (
    <div className="set-row">
      <div className="rl"><b>{title}</b>{sub && <span>{sub}</span>}</div>
      {right}
    </div>
  );
}

const CALS = [
  { name: "Google · Work", who: "acme.com", work: "details", priv: "busy", health: "busy" },
  { name: "Google · Personal", who: "gmail.com", work: "busy", priv: "details", health: "details" },
  { name: "Outlook · Acme Team", who: "shared", work: "busy", priv: "busy", health: "hidden" },
];
const VIS_LABEL = { details: "details", busy: "busy only", hidden: "hidden" };

function SurfaceSettings() {
  return (
    <div className="mew" style={{ width: 1280, height: 880, display: "grid", gridTemplateRows: "auto 1fr" }}>
      <div className="topbar">
        <span className="wordmark">MEW</span>
        <span className="topdate">Settings</span>
        <div className="topright"><span style={{ fontWeight: 600, color: "var(--gold)" }}>← Back to your week</span></div>
      </div>

      <div style={{ padding: "24px 30px 28px", display: "grid", gridTemplateColumns: "1.22fr 1fr", gap: 20, minHeight: 0, boxSizing: "border-box" }}>
        {/* LEFT column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, minHeight: 0 }}>
          <div className="set-card" style={{ flex: "none" }}>
            <h2>Calendars &amp; what they see</h2>
            <p className="sub">Every calendar you connect sees only what its tags allow — your private time appears to everyone else as simply <b>busy</b>. Only MEW sees the whole picture.</p>
            <table className="cal-table">
              <thead><tr><th>calendar</th><th>work</th><th>private</th><th>health</th><th></th></tr></thead>
              <tbody>
                <tr className="mewrow">
                  <td className="cal-name"><b>MEW</b><span>your whole week, one coherent thing</span></td>
                  <td><span className="vis all">everything</span></td>
                  <td><span className="vis all">everything</span></td>
                  <td><span className="vis all">everything</span></td>
                  <td></td>
                </tr>
                {CALS.map((c) => (
                  <tr key={c.name}>
                    <td className="cal-name"><b>{c.name}</b><span>{c.who} · connected</span></td>
                    <td><span className={"vis " + c.work}>{VIS_LABEL[c.work]}</span></td>
                    <td><span className={"vis " + c.priv}>{VIS_LABEL[c.priv]}</span></td>
                    <td><span className={"vis " + c.health}>{VIS_LABEL[c.health]}</span></td>
                    <td style={{ textAlign: "right", color: "var(--faint)", fontSize: 12, whiteSpace: "nowrap" }}>edit</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--gold)", whiteSpace: "nowrap" }}>+ Connect a calendar</span>
              <span style={{ fontSize: 12, color: "var(--faint)" }}>Google · Outlook · CalDAV</span>
            </div>
          </div>

          <div className="set-card" style={{ flex: 1 }}>
            <h2>Privacy &amp; model</h2>
            <p className="sub">Private by design — local-first, your data stays yours.</p>
            <SetRow title="Local-first storage" sub="Your week lives on this device; nothing required to leave it." right={<React.Fragment><span className="lockcap">by design</span><Tgl lock /></React.Fragment>} />
            <SetRow title="Bring your own key" sub="MEW talks to the model with your key, not ours." right={<span className="field">sk-••••••••••7f2a</span>} />
            <SetRow title="Where the model runs" sub="Fully local keeps every word on your machine." right={<span className="seg"><span className="on">Remote</span><span>Fully local</span></span>} />
            <SetRow title="Overnight consolidation" sub="The brain (GBrain) sharpens patterns while you sleep. History informs; the live week decides." right={<Tgl on />} />
          </div>
        </div>

        {/* RIGHT column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, minHeight: 0 }}>
          <div className="set-card">
            <h2>Your mew</h2>
            <div style={{ display: "flex", gap: 14, alignItems: "center", margin: "10px 0 4px" }}>
              <PixiePoly mood="healthy" size={74} radius={16} style={{ flex: "none" }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 15.5 }}>Pixie</span>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>rename</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>Golden British Shorthair · <span style={{ color: "var(--gold)", fontWeight: 650 }}>change look</span></div>
              </div>
            </div>
            <SetRow title="Condition mirrors sustainability" sub="How sustainably you work — never just how much." right={<React.Fragment><span className="lockcap">always</span><Tgl lock /></React.Fragment>} />
            <SetRow title="Care, not blame" sub="She never guilts, never punishes, never dies." right={<React.Fragment><span className="lockcap">absolute</span><Tgl lock /></React.Fragment>} />
          </div>

          <div className="set-card" style={{ flex: 1 }}>
            <h2>Nudges &amp; notifications</h2>
            <p className="sub">Every nudge is a chat message first. Anything else is a mirror.</p>
            <SetRow title="Nudges in chat" sub="The single source — drift check-ins, right-sizing, carry-over." right={<React.Fragment><span className="lockcap">chat-first</span><Tgl lock /></React.Fragment>} />
            <SetRow title="Browser notifications" sub="Mirror the latest nudge when this tab is unfocused." right={<Tgl on />} />
            <SetRow title="Quiet hours" sub="Nothing fires while you rest." right={<span className="seg"><span className="on">18:30 – 08:30</span></span>} />
            <SetRow title="Show the science" sub="Research footnotes in nudges, in your own numbers." right={<Tgl on />} />
            <SetRow title="Positive only" sub="No broken streaks, no penalties, no guilt — ever." right={<React.Fragment><span className="lockcap">principle</span><Tgl lock /></React.Fragment>} />
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SettingsStyles, SurfaceSettings });
