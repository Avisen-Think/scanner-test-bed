// generate.js — the Phase 4 generation panel (design §11). Bulk random scatter + clusters.
// Mutates the shared `gen` params; hands finished scenes back through onGenerate. No DOM logic
// lives in world.js (the generator is pure) — this file is only the controls for it.

function el(t, c, p = {}) { const e = document.createElement(t); if (c) e.className = c; Object.assign(e, p); return e; }
function label(txt) { return el("label", "flabel", { textContent: txt }); }
function row(lbl, ...controls) { const r = el("div", "field"); r.appendChild(label(lbl)); controls.forEach((c) => r.appendChild(c)); return r; }
function btn(txt, on, onclick) { const b = el("button", "modebtn" + (on ? " on" : ""), { textContent: txt }); b.addEventListener("click", onclick); return b; }

function countRow(lbl, min, max, step, value, set, onChange) {
  const valEl = el("span", "sigval", { textContent: String(value) });
  const s = el("input", "slider", { type: "range" });
  s.min = min; s.max = max; s.step = step; s.value = value;
  s.addEventListener("input", () => { const v = parseInt(s.value, 10); set(v); valEl.textContent = String(v); onChange && onChange(); });
  return { row: row(lbl, s, valEl), slider: s, valEl };
}

// like countRow but returns the slider too, so a checkbox elsewhere can enable/disable it
function varietyRow(lbl, min, max, value, disabled, set, onChange) {
  const valEl = el("span", "sigval", { textContent: String(value) });
  const s = el("input", "slider", { type: "range" });
  s.min = min; s.max = max; s.step = 1; s.value = value; s.disabled = disabled;
  s.addEventListener("input", () => { const v = parseInt(s.value, 10); set(v); valEl.textContent = String(v); onChange && onChange(); });
  return { row: row(lbl, s, valEl), slider: s, valEl };
}

export function initGenerate({ gen, container, onGenerate, onClear }) {
  container.innerHTML = "";

  const shipsRow = countRow("Ships", 0, 100, 1, gen.ships, (v) => (gen.ships = v));
  const rocksRow = countRow("Rocks", 0, 300, 1, gen.rocks, (v) => (gen.rocks = v));
  const organicsRow = countRow("Organics", 0, 60, 1, gen.organics, (v) => (gen.organics = v));
  const creaturesRow = countRow("Creatures", 0, 20, 1, gen.creatures, (v) => (gen.creatures = v));
  container.append(shipsRow.row, rocksRow.row, organicsRow.row, creaturesRow.row);

  const shipCl = btn("Ship clusters", gen.shipClusters, () => { gen.shipClusters = !gen.shipClusters; shipCl.classList.toggle("on", gen.shipClusters); });
  const rockCl = btn("Rock clusters", gen.rockClusters, () => { gen.rockClusters = !gen.rockClusters; rockCl.classList.toggle("on", gen.rockClusters); });
  const clRow = el("div", "field");
  clRow.append(label("Clusters"), shipCl, rockCl);
  container.appendChild(clRow);

  // mobile ships (design §7.2, §11): 30% of ship seeds draw a path when this is on; the
  // ratio itself stays a settled constant (config.mobile.generateRatio), same convention as
  // the cluster odds above — not exposed as a slider.
  const mobileBtn = btn("Mobile ships", gen.mobileEnabled, () => { gen.mobileEnabled = !gen.mobileEnabled; mobileBtn.classList.toggle("on", gen.mobileEnabled); });
  const mRow = el("div", "field");
  mRow.append(label("Motion"), mobileBtn);
  container.appendChild(mRow);

  // rock strata/resource variety cap (HANDOFF §3a-i): off by default (full pool). Enabling it
  // draws a random palette of this size each Generate and constrains every rock to it, so a
  // given confounder (e.g. copper-on-granite) recurs across the field instead of appearing once.
  const varietyBtn = btn("Limit variety", gen.varietyCap, () => {
    gen.varietyCap = !gen.varietyCap;
    varietyBtn.classList.toggle("on", gen.varietyCap);
    subVariety.slider.disabled = !gen.varietyCap;
    resVariety.slider.disabled = !gen.varietyCap;
  });
  const vRow = el("div", "field");
  vRow.append(label("Rock variety"), varietyBtn);
  container.appendChild(vRow);

  const subVariety = varietyRow("Strata count", 1, 4, gen.substrateVariety, !gen.varietyCap, (v) => (gen.substrateVariety = v));
  const resVariety = varietyRow("Resource count", 1, 4, gen.resourceVariety, !gen.varietyCap, (v) => (gen.resourceVariety = v));
  container.appendChild(subVariety.row);
  container.appendChild(resVariety.row);

  // game modes (design §10): picked before Generate, so they shape THIS Generate's scene —
  // ship-find rolls one random hull and guarantees exactly one spawns; resource-find rolls a
  // resource (from the variety-capped pool if one's active) and forces ≥20% of rocks to carry
  // it. Independent toggles, not mutually exclusive — nothing stops hunting for both at once.
  const shipFindBtn = btn("Ship-find", gen.shipFindMode, () => { gen.shipFindMode = !gen.shipFindMode; shipFindBtn.classList.toggle("on", gen.shipFindMode); });
  const resFindBtn = btn("Resource-find", gen.resourceFindMode, () => { gen.resourceFindMode = !gen.resourceFindMode; resFindBtn.classList.toggle("on", gen.resourceFindMode); });
  const modeRow = el("div", "field");
  modeRow.append(label("Find mode"), shipFindBtn, resFindBtn);
  container.appendChild(modeRow);

  const actions = el("div", "field");
  actions.append(
    label(""),
    btn("Generate", false, () => onGenerate()),
    btn("Clear", false, () => onClear()),
  );
  container.appendChild(actions);

  container.appendChild(el("div", "hint-line", {
    textContent: "replaces the scene · clusters: ships same-lobe, rocks same substrate/resource · variety: caps the strata/resource pool rocks draw from · creatures: random flock/herd/giant, no cluster rule (their sub-emitters are their own bound cluster) · find modes: rolled fresh each Generate, see the Mission card",
  }));

  // refresh every control from `gen` — needed so Load Scenario (design §12) doesn't just take
  // effect invisibly in the next Generate; the panel has to show what it loaded.
  function sync() {
    shipsRow.slider.value = gen.ships; shipsRow.valEl.textContent = String(gen.ships);
    rocksRow.slider.value = gen.rocks; rocksRow.valEl.textContent = String(gen.rocks);
    organicsRow.slider.value = gen.organics; organicsRow.valEl.textContent = String(gen.organics);
    creaturesRow.slider.value = gen.creatures; creaturesRow.valEl.textContent = String(gen.creatures);
    shipCl.classList.toggle("on", gen.shipClusters);
    rockCl.classList.toggle("on", gen.rockClusters);
    mobileBtn.classList.toggle("on", gen.mobileEnabled);
    varietyBtn.classList.toggle("on", gen.varietyCap);
    subVariety.slider.value = gen.substrateVariety; subVariety.slider.disabled = !gen.varietyCap;
    subVariety.valEl.textContent = String(gen.substrateVariety);
    resVariety.slider.value = gen.resourceVariety; resVariety.slider.disabled = !gen.varietyCap;
    resVariety.valEl.textContent = String(gen.resourceVariety);
    shipFindBtn.classList.toggle("on", gen.shipFindMode);
    resFindBtn.classList.toggle("on", gen.resourceFindMode);
  }
  return { sync };
}
