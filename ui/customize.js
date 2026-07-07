// customize.js — the §9 hand-placement / customization panel. Lives below the selected
// contact. Enabling it auto-turns-on colour-coded (all-selectable) mode. Mutates the shared
// `custom` (placement params) and `ui` (customizing / tool); main reads `custom` at click time.
// Mobile ship placement (design §7.2, §9): the extent slider's range is matched to the chosen
// path type; direction is set by a second click on the map, mirroring the Lock-Sensors
// arm-then-click pattern (ui.mobileArmed/pendingMobileId, consumed in field.js/main.js).
import { shipsInBucket, ROCK_SIZE_MIN, ROCK_SIZE_MAX, GRADE_MIN, GRADE_MAX } from "../sim/world.js";
import { PATH_TYPES } from "../sim/paths.js";

function el(t, c, p = {}) { const e = document.createElement(t); if (c) e.className = c; Object.assign(e, p); return e; }
function label(txt) { return el("label", "flabel", { textContent: txt }); }
function row(lbl, ...controls) { const r = el("div", "field"); r.appendChild(label(lbl)); controls.forEach((c) => r.appendChild(c)); return r; }
function btn(txt, on, onclick) { const b = el("button", "modebtn" + (on ? " on" : ""), { textContent: txt }); b.addEventListener("click", onclick); return b; }
function strSelect(options, value, onchange) {
  const s = el("select", "select");
  for (const o of options) s.appendChild(el("option", null, { value: o.value, textContent: o.label }));
  s.value = value;
  s.addEventListener("change", () => onchange(s.value));
  return s;
}
function rangeRow(lbl, min, max, step, value, randomable, getRandom, set, onChange) {
  const valEl = el("span", "sigval", { textContent: (+value).toFixed(step < 1 ? 2 : 0) });
  const s = el("input", "slider", { type: "range" }); s.min = min; s.max = max; s.step = step; s.value = value;
  s.disabled = getRandom();
  s.addEventListener("input", () => { set.value(parseFloat(s.value)); valEl.textContent = parseFloat(s.value).toFixed(step < 1 ? 2 : 0); onChange(); });
  const r = row(lbl, s, valEl);
  if (randomable) {
    const cb = el("input", null, { type: "checkbox", checked: getRandom() });
    cb.addEventListener("change", () => { set.random(cb.checked); s.disabled = cb.checked; onChange(); });
    const wrap = el("label", "rnd-lab"); wrap.append(cb, document.createTextNode(" rand"));
    r.appendChild(wrap);
  }
  return r;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function extentRange(pathType, cfg) {
  if (pathType === "circle") return cfg.mobile.circleRadius;
  if (pathType === "fig8") return cfg.mobile.fig8Extent;
  return cfg.mobile.lineExtent;
}
const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function initCustomize({ lib, cfg, custom, ui, container, onChange }) {
  container.innerHTML = "";
  const toggle = btn(ui.customizing ? "Disable placement" : "Enable placement", ui.customizing, () => {
    ui.customizing = !ui.customizing;
    if (ui.customizing) { ui.colorCoded = true; ui.tool = ui.tool || "place"; }
    renderAll(); onChange();
  });
  container.appendChild(toggle);
  const notice = el("div", "place-notice"); container.appendChild(notice);
  const body = el("div", "cz-body"); container.appendChild(body);

  function shipUnitOptions() {
    const pool = shipsInBucket(lib.ships, custom.shipSize);
    return [{ value: "random", label: "Random" }, ...pool.map((s) => ({ value: s.id, label: `${s.name} · ${s.size}` }))];
  }

  function renderForm(form) {
    form.innerHTML = "";
    if (custom.type === "ship") {
      const sizeSel = strSelect(
        [["any", "Any"], ["S", "Small"], ["M", "Medium"], ["L", "Large"]].map(([v, l]) => ({ value: v, label: l })),
        custom.shipSize, (v) => { custom.shipSize = v; if (!shipsInBucket(lib.ships, v).some((s) => s.id === custom.shipId)) custom.shipId = "random"; renderForm(form); onChange(); });
      form.appendChild(row("Size class", sizeSel));
      form.appendChild(row("Unit", strSelect(shipUnitOptions(), custom.shipId, (v) => { custom.shipId = v; onChange(); })));

      const mobileCb = el("input", null, { type: "checkbox", checked: custom.shipMobile });
      mobileCb.addEventListener("change", () => { custom.shipMobile = mobileCb.checked; renderForm(form); onChange(); });
      const mobileWrap = el("label", "rnd-lab"); mobileWrap.append(mobileCb, document.createTextNode(" mobile (place, then click again to set direction)"));
      const mobileRow = el("div", "field"); mobileRow.append(label("Mobile"), mobileWrap);
      form.appendChild(mobileRow);
      if (custom.shipMobile) {
        const pathOpts = PATH_TYPES.map((p) => ({ value: p, label: cap(p) }));
        form.appendChild(row("Path", strSelect(pathOpts, custom.shipPathType, (v) => {
          custom.shipPathType = v;
          const [lo, hi] = extentRange(v, cfg);
          custom.shipExtent = clampTo(custom.shipExtent, lo, hi);
          renderForm(form); onChange();
        })));
        const [lo, hi] = extentRange(custom.shipPathType, cfg);
        form.appendChild(rangeRow(
          custom.shipPathType === "circle" ? "Radius (km)" : "Extent (km)",
          lo, hi, 0.1, custom.shipExtent, false, () => false,
          { value: (x) => (custom.shipExtent = x) }, onChange,
        ));
      }
    } else if (custom.type === "structure") {
      const opts = [{ value: "random", label: "Random" }, ...lib.structures.map((s) => ({ value: s.id, label: `${s.name} · ${s.size}` }))];
      form.appendChild(row("Unit", strSelect(opts, custom.structId, (v) => { custom.structId = v; onChange(); })));
    } else if (custom.type === "rock") {
      const r = custom.rock;
      const subOpts = [{ value: "random", label: "Random" }, ...lib.substrates.map((s) => ({ value: s.id, label: s.name }))];
      const resOpts = [{ value: "random", label: "Random" }, { value: "none", label: "None (barren)" }, ...lib.resources.map((s) => ({ value: s.id, label: s.name }))];
      form.appendChild(row("Strata", strSelect(subOpts, r.substrate, (v) => { r.substrate = v; onChange(); })));
      form.appendChild(row("Resource", strSelect(resOpts, r.resource, (v) => { r.resource = v; onChange(); })));
      form.appendChild(rangeRow("Size", ROCK_SIZE_MIN, ROCK_SIZE_MAX, 1, r.size, true, () => r.sizeRandom, { value: (x) => (r.size = x), random: (b) => (r.sizeRandom = b) }, onChange));
      form.appendChild(rangeRow("Grade", GRADE_MIN, GRADE_MAX, 0.05, r.grade, true, () => r.gradeRandom, { value: (x) => (r.grade = x), random: (b) => (r.gradeRandom = b) }, onChange));
    } else if (custom.type === "organic") {
      const o = custom.organic;

      const creatureCb = el("input", null, { type: "checkbox", checked: o.isCreature });
      creatureCb.addEventListener("change", () => { o.isCreature = creatureCb.checked; renderForm(form); onChange(); });
      const creatureWrap = el("label", "rnd-lab"); creatureWrap.append(creatureCb, document.createTextNode(" creature (temporal — §7.4)"));
      const creatureRow = el("div", "field"); creatureRow.append(label("Creature"), creatureWrap);
      form.appendChild(creatureRow);

      if (o.isCreature) {
        const stateOpts = [{ value: "random", label: "Random" }, ...lib.creatureStates.map((s) => ({ value: s.id, label: s.name }))];
        form.appendChild(row("State", strSelect(stateOpts, o.creatureId, (v) => { o.creatureId = v; onChange(); })));
        form.appendChild(rangeRow("Size", cfg.creatures.sizeMin, cfg.creatures.sizeMax, 1, o.size, true, () => o.sizeRandom, { value: (x) => (o.size = x), random: (b) => (o.sizeRandom = b) }, onChange));
      } else {
        const opts = [{ value: "random", label: "Random" }, ...lib.organicsStatic.map((s) => ({ value: s.id, label: s.name }))];
        form.appendChild(row("Type", strSelect(opts, o.id, (v) => { o.id = v; onChange(); })));
        form.appendChild(rangeRow("Size", 40, 92, 1, o.size, true, () => o.sizeRandom, { value: (x) => (o.size = x), random: (b) => (o.sizeRandom = b) }, onChange));
      }
    }
  }

  function renderAll() {
    toggle.textContent = ui.customizing ? "Disable placement" : "Enable placement";
    toggle.classList.toggle("on", ui.customizing);
    body.style.display = ui.customizing ? "" : "none";
    notice.style.display = ui.customizing ? "" : "none";
    if (!ui.customizing) return;
    body.innerHTML = "";
    const tools = el("div", "field"); tools.appendChild(label("Tool"));
    for (const t of ["place", "delete", "move"]) tools.appendChild(btn(cap(t), ui.tool === t, () => { ui.tool = t; renderAll(); onChange(); }));
    body.appendChild(tools);
    body.appendChild(row("Type", strSelect(
      ["ship", "structure", "rock", "organic"].map((v) => ({ value: v, label: cap(v) })),
      custom.type, (v) => { custom.type = v; renderForm(form); onChange(); })));
    const form = el("div", "cz-form"); body.appendChild(form);
    renderForm(form);
  }

  function setNotice(msg) { notice.textContent = msg || ""; }

  renderAll();
  return { setNotice };
}
