// controls.js — the control rail. Phase 2: per-signal on/off + live distance read,
// a View & locks group (zoom, colour-coded, Lock Ship, Lock Sensors), the sensor gate,
// and the display tuning. Mutates shared scene/ship/env/ui/settings and calls onChange().
// Returns { sync } so main can refresh live values each recompute.

function el(tag, cls, props = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  Object.assign(e, props);
  return e;
}
function slider(min, max, step, value, oninput) {
  const s = el("input", "slider", { type: "range" });
  s.min = min; s.max = max; s.step = step; s.value = value;
  s.addEventListener("input", () => oninput(parseFloat(s.value)));
  return s;
}
function num(value, step, oninput, opts = {}) {
  const n = el("input", "numbox", { type: "number", value });
  n.step = step;
  if (opts.min != null) n.min = opts.min;
  n.style.width = opts.width || "5.5em";
  n.addEventListener("input", () => {
    if (n.value === "") return;
    let v = parseFloat(n.value);
    if (opts.min != null && v < opts.min) v = opts.min;
    oninput(v);
  });
  return n;
}
function select(options, value, onchange) {
  const s = el("select", "select");
  for (const o of options) s.appendChild(el("option", null, { value: o, textContent: o }));
  s.value = value;
  s.addEventListener("change", () => onchange(parseFloat(s.value)));
  return s;
}
function field(label, control, extra) {
  const row = el("div", "field");
  row.appendChild(el("label", "flabel", { textContent: label }));
  row.appendChild(control);
  if (extra) row.appendChild(extra);
  return row;
}
function btn(label, on, onclick) {
  const b = el("button", "modebtn" + (on ? " on" : ""), { textContent: label });
  b.addEventListener("click", onclick);
  return b;
}

export function initControls({ ship, env, settings, ui, els, onChange, sensorRanges = [50, 20, 10, 4, 2], getR }) {
  // (The old per-signal on/off list lived here; it was removed — it doesn't scale past a
  // handful of contacts. Muting a source now lives on the Selected-contact panel, and the
  // scene inventory is the map itself. See main.js renderSelected.)

  // ── view & locks ────────────────────────────────────────────────────────────
  els.view.innerHTML = "";
  const zoom100 = btn("100 km", ui.zoom >= 100, () => { ui.zoom = 100; onChange(); });
  const zoom20 = btn("20 km", ui.zoom < 100, () => { ui.zoom = 20; onChange(); });
  const zRow = el("div", "field");
  zRow.append(el("label", "flabel", { textContent: "Zoom" }), zoom100, zoom20);
  els.view.appendChild(zRow);

  const colorBtn = btn(ui.colorCoded ? "Colour-coded" : "Uniform grey", ui.colorCoded, () => {
    ui.colorCoded = !ui.colorCoded;
    colorBtn.textContent = ui.colorCoded ? "Colour-coded" : "Uniform grey";
    onChange();
  });
  const cRow = el("div", "field");
  cRow.append(el("label", "flabel", { textContent: "Overlay" }), colorBtn);
  els.view.appendChild(cRow);

  const lockShipBtn = btn("Lock Ship", ui.lockShip, () => {
    ui.lockShip = !ui.lockShip;
    if (ui.lockShip) { ui.lockSensors = false; ui.sensorPoint = null; ui.sensorArmed = false; ui.autoRotate = false; }
    onChange();
  });
  const lockSensBtn = btn("Lock Sensors", ui.lockSensors, () => {
    ui.lockSensors = !ui.lockSensors;
    if (ui.lockSensors) { ui.lockShip = false; ui.sensorArmed = true; ui.sensorPoint = null; ui.autoRotate = false; }
    else { ui.sensorPoint = null; ui.sensorArmed = false; }
    onChange();
  });
  const lRow = el("div", "field");
  lRow.append(el("label", "flabel", { textContent: "Locks" }), lockShipBtn, lockSensBtn);
  els.view.appendChild(lRow);
  const lockHint = el("div", "hint-line");
  els.view.appendChild(lockHint);

  // ── sensor gate ─────────────────────────────────────────────────────────────
  els.sensor.innerHTML = "";
  const rMaxSelect = select(sensorRanges, env.rMax, (v) => { env.rMax = v; onChange(); });
  els.sensor.appendChild(field("R_max (km)", rMaxSelect));
  const rvVal = el("span", "sigval", { textContent: ui.revealRange.toFixed(1) });
  const rvSlider = slider(1, 50, 0.5, ui.revealRange, (v) => { ui.revealRange = v; rvVal.textContent = v.toFixed(1); onChange(); });
  els.sensor.appendChild(field("Reveal range (km)", rvSlider, rvVal));
  const sectorSelect = select([360, 180, 90, 45], env.sectorDeg, (v) => { env.sectorDeg = v; onChange(); });
  els.sensor.appendChild(field("Sector (deg)", sectorSelect));
  const scVal = el("span", "sigval", { textContent: env.sectorCenter.toFixed(0) + "\u00B0" });
  const scSlider = slider(-180, 180, 1, env.sectorCenter, (v) => { env.sectorCenter = v; scVal.textContent = v.toFixed(0) + "\u00B0"; onChange(); });
  els.sensor.appendChild(field("Sector centre", scSlider, scVal));

  // auto-rotate: sweeps the sector on its own so a stationary ship still gets the bearing-sweep
  // read (the sector's tapered gain g(theta) rising/falling as it crosses a source) that manual
  // sweeping already gives -- same accumulate()/gating math, just an automated aim input, not a
  // new information channel. Mutually exclusive with Lock Ship / Lock Sensors (all three drive
  // env.sectorCenter; only one may own it at a time, same pattern those two already used against
  // each other).
  const rotBtn = btn(ui.autoRotate ? "Auto-rotate: on" : "Auto-rotate: off", ui.autoRotate, () => {
    ui.autoRotate = !ui.autoRotate;
    if (ui.autoRotate) { ui.lockShip = false; ui.lockSensors = false; ui.sensorPoint = null; ui.sensorArmed = false; }
    onChange();
  });
  const dirBtn = btn(ui.rotateDir >= 0 ? "CW" : "CCW", false, () => {
    ui.rotateDir = ui.rotateDir >= 0 ? -1 : 1;
    dirBtn.textContent = ui.rotateDir >= 0 ? "CW" : "CCW";
    onChange();
  });
  const rotRow = el("div", "field");
  rotRow.append(el("label", "flabel", { textContent: "Auto-rotate" }), rotBtn, dirBtn);
  els.sensor.appendChild(rotRow);

  const rrVal = el("span", "sigval", { textContent: ui.rotateRate.toFixed(0) + "°/s" });
  const rrSlider = slider(1, 90, 1, ui.rotateRate, (v) => { ui.rotateRate = v; rrVal.textContent = v.toFixed(0) + "°/s"; onChange(); });
  els.sensor.appendChild(field("Rotation rate", rrSlider, rrVal));

  const fullBtn = btn("Full 360°", ui.rotateMode !== "oscillate", () => {
    ui.rotateMode = "full"; fullBtn.classList.add("on"); oscBtn.classList.remove("on"); onChange();
  });
  const oscBtn = btn("Oscillate", ui.rotateMode === "oscillate", () => {
    ui.rotateMode = "oscillate"; oscBtn.classList.add("on"); fullBtn.classList.remove("on");
    // clamp into the chosen bounds immediately so switching modes can't leave the sector
    // sitting outside them until the sweep happens to reach an edge
    const lo = Math.min(ui.rotateMin, ui.rotateMax), hi = Math.max(ui.rotateMin, ui.rotateMax);
    env.sectorCenter = Math.max(lo, Math.min(hi, env.sectorCenter));
    onChange();
  });
  const modeRow = el("div", "field");
  modeRow.append(el("label", "flabel", { textContent: "Sweep mode" }), fullBtn, oscBtn);
  els.sensor.appendChild(modeRow);

  // oscillate bounds -- a specific-direction watch (e.g. "sweep the 300-360 deg arc") instead
  // of a full survey. Bearings share the sector-centre slider's -180..180 convention.
  const oscMinNum = num(ui.rotateMin, 1, (v) => { ui.rotateMin = v; onChange(); }, { min: -180, width: "4.5em" });
  const oscMaxNum = num(ui.rotateMax, 1, (v) => { ui.rotateMax = v; onChange(); }, { min: -180, width: "4.5em" });
  const oscRow = el("div", "field");
  oscRow.append(
    el("label", "flabel", { textContent: "Oscillate between" }),
    oscMinNum, el("span", "sigval", { textContent: "and" }), oscMaxNum,
  );
  els.sensor.appendChild(oscRow);

  // ── display + physics tuning ────────────────────────────────────────────────
  els.display.innerHTML = "";
  const modeWrap = el("div", "field");
  const linBtn = btn("Linear (gain)", !settings.logMode, () => { settings.logMode = false; linBtn.classList.add("on"); logBtn.classList.remove("on"); onChange(); });
  const logBtn = btn("Log (shape)", settings.logMode, () => { settings.logMode = true; logBtn.classList.add("on"); linBtn.classList.remove("on"); onChange(); });
  modeWrap.append(el("label", "flabel", { textContent: "Display mode" }), linBtn, logBtn);
  els.display.appendChild(modeWrap);

  const gVal = el("span", "sigval", { textContent: settings.gain.toFixed(3) });
  const gExp = slider(Math.log10(0.001), Math.log10(2), 0.01, Math.log10(settings.gain),
    (v) => { settings.gain = Math.pow(10, v); gVal.textContent = settings.gain.toFixed(3); onChange(); });
  // One-shot ballpark, not a persistent mode: fires once on click, using whatever the readout
  // holds right now, then leaves gain exactly where it landed for manual fine-tuning. Deliberately
  // NOT a continuously-renormalizing "auto" mode — that would be normalize-to-max by another name,
  // which concept §16 dropped on purpose (a signature's absolute loudness is real information;
  // riding gain by hand to bring a chased feature into the legible band is a skill, not friction).
  const gAutoBtn = btn("Auto (ballpark)", false, () => {
    const R = getR && getR();
    if (!R || !R.length) return;
    const maxR = Math.max(...R);
    if (!(maxR > 0)) return; // nothing in view to normalize against
    settings.gain = Math.min(2, Math.max(0.001, 1 / maxR)); // clamp to the slider's own range
    gExp.value = Math.log10(settings.gain);
    gVal.textContent = settings.gain.toFixed(3);
    onChange();
  });
  gAutoBtn.title = "Sets gain once so the loudest current band reads full-scale. A starting point, not a locked mode — fine-tune by hand from here.";
  const gRow = el("div", "field");
  gRow.append(el("label", "flabel", { textContent: "Gain G (master)" }), gExp, gVal, gAutoBtn);
  els.display.appendChild(gRow);
  const fNum = num(settings.F, 0.05, (v) => { settings.F = v; onChange(); }, { min: 0.001 });
  els.display.appendChild(field("F (floor)", fNum));
  const cNum = num(settings.C, 10, (v) => { settings.C = v; onChange(); }, { min: 1 });
  els.display.appendChild(field("C (saturation)", cNum));
  const dMinNum = num(env.dMin, 0.1, (v) => { env.dMin = v; onChange(); }, { min: 0.01 });
  els.display.appendChild(field("d_min (km)", dMinNum));
  const pNum = num(env.pEmissive, 0.1, (v) => { env.pEmissive = v; onChange(); }, { min: 0.1 });
  els.display.appendChild(field("p (emissive falloff)", pNum));
  const emNum = num(settings.emissiveDisplayMax, 10, (v) => { settings.emissiveDisplayMax = v; onChange(); }, { min: 1 });
  els.display.appendChild(field("Emissive display max", emNum));

  // ── live refresh (called each recompute — also what makes a Loaded scenario's values
  // show up on every control, not just take effect invisibly in the physics) ──────────
  function sync() {
    zoom100.classList.toggle("on", ui.zoom >= 100);
    zoom20.classList.toggle("on", ui.zoom < 100);
    colorBtn.classList.toggle("on", ui.colorCoded);
    colorBtn.textContent = ui.colorCoded ? "Colour-coded" : "Uniform grey";
    lockShipBtn.classList.toggle("on", ui.lockShip);
    lockSensBtn.classList.toggle("on", ui.lockSensors);
    const manual = !ui.lockShip && !ui.lockSensors && !ui.autoRotate && env.sectorDeg < 360;
    scSlider.disabled = !manual;
    scSlider.value = env.sectorCenter;
    scVal.textContent = env.sectorCenter.toFixed(0) + "\u00B0";
    lockHint.textContent = ui.mobileArmed
      ? "click the map again to set the new ship's direction"
      : ui.lockSensors && ui.sensorArmed
      ? "click the map to set the locked point"
      : ui.lockShip ? "click-drag the map to aim the sector"
      : "";

    rotBtn.classList.toggle("on", ui.autoRotate);
    rotBtn.textContent = ui.autoRotate ? "Auto-rotate: on" : "Auto-rotate: off";
    dirBtn.textContent = ui.rotateDir >= 0 ? "CW" : "CCW";
    rrSlider.value = ui.rotateRate; rrVal.textContent = ui.rotateRate.toFixed(0) + "\u00B0/s";
    fullBtn.classList.toggle("on", ui.rotateMode !== "oscillate");
    oscBtn.classList.toggle("on", ui.rotateMode === "oscillate");
    oscRow.style.display = ui.rotateMode === "oscillate" ? "flex" : "none";
    oscMinNum.value = ui.rotateMin;
    oscMaxNum.value = ui.rotateMax;

    rMaxSelect.value = env.rMax;
    rvSlider.value = ui.revealRange; rvVal.textContent = ui.revealRange.toFixed(1);
    sectorSelect.value = env.sectorDeg;

    linBtn.classList.toggle("on", !settings.logMode);
    logBtn.classList.toggle("on", settings.logMode);
    gExp.value = Math.log10(settings.gain); gVal.textContent = settings.gain.toFixed(3);
    fNum.value = settings.F;
    cNum.value = settings.C;
    dMinNum.value = env.dMin;
    pNum.value = env.pEmissive;
    emNum.value = settings.emissiveDisplayMax;
  }
  sync();
  return { sync };
}
