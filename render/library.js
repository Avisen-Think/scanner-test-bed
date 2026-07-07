// library.js — the Signal Library reference view (design §5.4). The single-signature readout of
// every library entry: the in-fiction prep sheet (concept §4.1 — signatures are knowledge the
// player brings, so in-play skill is separation, not recognition). Pure reference: NO distance/
// size/gain is applied, because none of those carry identity — a contour is size-invariant
// (peak ~1.0 by authoring) and IS the memorizable shape. Size is printed as a number.
//
// buildLibrary(container, lib) builds the content (legend + composer + sections). It's shared by
// two shells: the in-page overlay (initLibrary) and the standalone pop-out page (library.html),
// so the pop-out is a real second window you can park next to the scanner — no state to sync,
// since reference data is static.
import { BANDS, EMISSIVE, REGIONS, resolveContour, regionEnergy } from "../sim/physics.js";
import { bandRegion } from "./readout.js";

const EMIT_LABELS = ["IR", "EM", "PA"];
const REGION_STARTS = new Set([REGIONS.metallic.lo, 9, REGIONS.rocky.lo, REGIONS.organic.lo]); // 1,9,12,18
const GRADE_MIN = 0.25, GRADE_MAX = 1.2; // mirror world.js grade bounds

function el(tag, cls, props = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  Object.assign(e, props);
  return e;
}
function field(label, ...controls) {
  const r = el("div", "field");
  r.appendChild(el("label", "flabel", { textContent: label }));
  controls.forEach((c) => r.appendChild(c));
  return r;
}
function select(options, value, onChange) {
  const s = el("select", "select");
  for (const o of options) s.appendChild(el("option", null, { value: o.value, textContent: o.label }));
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

// 20-band strip, region-coloured. height = value / scaleMax (clamped). scaleMax defaults to 1
// (contours are peak ~1, so standalone entries share an absolute 0–1 scale, height-comparable).
function bandStrip(contour, { scaleMax = 1, short = false, faint = false } = {}) {
  const strip = el("div", "lib-strip" + (short ? " short" : ""));
  for (let i = 0; i < BANDS; i++) {
    const b = i + 1;
    const cls = `lib-bar reg-${bandRegion(b)}`
      + (REGION_STARTS.has(b) && b !== 1 ? " b-edge" : "")
      + (faint ? " faint" : "");
    const bar = el("div", cls);
    bar.style.height = (Math.max(0, Math.min(1, contour[i] / scaleMax)) * 100).toFixed(1) + "%";
    bar.title = `band ${b}: ${contour[i].toFixed(3)}`;
    strip.appendChild(bar);
  }
  return strip;
}

// emissive mini-readout (3 bars, absolute 0–100 — the live readout's fixed ceiling)
function emissiveStrip(emissive) {
  const wrap = el("div", "lib-em");
  for (let c = 0; c < EMISSIVE; c++) {
    const col = el("div", "col");
    const v = emissive[c] || 0;
    const bar = el("div", "bar");
    bar.style.height = Math.round((v / 100) * 46) + "px";
    bar.title = `${EMIT_LABELS[c]}: ${v}`;
    col.append(bar, el("div", "lab", { textContent: EMIT_LABELS[c] }));
    wrap.appendChild(col);
  }
  return wrap;
}

// a standard single-signature card
function card({ name, meta, note, noteTell, contour, emissive }) {
  const c = el("div", "lib-card");
  c.appendChild(el("div", "name", { textContent: name }));
  if (meta) c.appendChild(el("div", "meta", { textContent: meta }));
  const row = el("div", "lib-striprow");
  row.appendChild(bandStrip(contour));
  if (emissive) row.appendChild(emissiveStrip(emissive));
  c.appendChild(row);
  if (note) c.appendChild(el("div", "note" + (noteTell ? " tell" : ""), { textContent: note }));
  return c;
}

function section(title, desc, cards, wide = false) {
  const s = el("div", "lib-section");
  s.appendChild(el("h3", null, { textContent: title }));
  if (desc) s.appendChild(el("p", "desc", { textContent: desc }));
  const grid = el("div", "lib-grid" + (wide ? " wide" : ""));
  cards.forEach((c) => grid.appendChild(c));
  s.appendChild(grid);
  return s;
}

// baseline vs resolved (substrate + resource·grade) strips on a shared scale, + the region read.
// Used by both the authored composite cards and the interactive composer.
function renderResolved(out, lib, substrateId, resourceId, grade) {
  const sub = substrateId && substrateId !== "none" ? lib.substrates.find((s) => s.id === substrateId) : null;
  const res = resourceId && resourceId !== "none" ? lib.resources.find((r) => r.id === resourceId) : null;
  // resolve EXACTLY as the engine does — the reference must not diverge from accumulate()
  const resolved = resolveContour({
    substrate: sub ? sub.contour : null,
    resource: res ? res.contour : null,
    grade: res ? grade : 0,
  });
  const baseline = sub ? sub.contour : new Array(BANDS).fill(0);
  const scaleMax = Math.max(1e-6, ...resolved, ...baseline);

  out.innerHTML = "";
  const r1 = el("div", "lib-striprow");
  r1.append(el("div", "lib-pairlab", { textContent: sub ? "substrate" : "no substrate" }), bandStrip(baseline, { scaleMax, short: true, faint: true }));
  const r2 = el("div", "lib-striprow");
  r2.append(el("div", "lib-pairlab", { textContent: "= composite" }), bandStrip(resolved, { scaleMax, short: true }));
  out.append(r1, r2);

  // region read: which material class it lands in — and the transition energy the firewall quarantines
  const e = regionEnergy(resolved);
  const mats = [["metallic", e.metallic], ["rocky", e.rocky], ["organic", e.organic]].sort((a, b) => b[1] - a[1]);
  const dom = mats[0][1] > 0 ? mats[0][0] : "\u2014";
  const line = el("div", "lib-compose-read");
  line.innerHTML = `reads as <b class="reg-${dom}-text">${dom}</b> &middot; `
    + `metallic ${e.metallic.toFixed(2)} / rocky ${e.rocky.toFixed(2)} / organic ${e.organic.toFixed(2)} &middot; `
    + `<span style="color:var(--transition)">transition ${e.transition.toFixed(2)} (quarantined)</span>`;
  out.appendChild(line);
}

function compositeCard(comp, lib) {
  const c = el("div", "lib-card");
  c.appendChild(el("div", "name", { textContent: comp.name }));
  const sub = comp.substrate ? lib.substrates.find((s) => s.id === comp.substrate) : null;
  const res = comp.resource ? lib.resources.find((r) => r.id === comp.resource) : null;
  c.appendChild(el("div", "meta", {
    textContent: `${sub ? sub.name : "(no substrate)"}  ${res ? "+ " + res.name + " \u00D7" + comp.grade : "(barren)"}`,
  }));
  const out = el("div", "lib-compose-out");
  c.appendChild(out);
  renderResolved(out, lib, comp.substrate, comp.resource, comp.grade);
  if (comp.note) c.appendChild(el("div", "note tell", { textContent: comp.note }));
  return c;
}

// interactive composer: pick substrate + resource + grade, watch the resolved contour live.
function composerSection(lib) {
  const s = el("div", "lib-section");
  s.appendChild(el("h3", null, { textContent: "Compose a rock" }));
  s.appendChild(el("p", "desc", {
    textContent: "Pick a substrate and a resource and watch the resolved contour build — substrate + resource\u00D7grade, exactly as the engine reads it. Faint = the bare substrate, solid = the composite; the gap is the resource. Watch the region read: a resource whose bump leans into the metallic region (\u22648) adds to metallic energy, while a bump in the transition firewall (9\u201311) is quarantined and never counts toward a material class.",
  }));

  const state = { substrate: lib.substrates[0].id, resource: lib.resources[0].id, grade: 0.7 };
  const card = el("div", "lib-card lib-compose");
  const controls = el("div", "lib-compose-controls");
  const out = el("div", "lib-compose-out");

  const subOpts = [{ value: "none", label: "\u2014 none \u2014" }, ...lib.substrates.map((x) => ({ value: x.id, label: x.name }))];
  const resOpts = [{ value: "none", label: "\u2014 none (barren) \u2014" }, ...lib.resources.map((x) => ({ value: x.id, label: x.name }))];
  const draw = () => renderResolved(out, lib, state.substrate, state.resource, state.grade);

  const gradeVal = el("span", "sigval", { textContent: state.grade.toFixed(2) });
  const gradeSlider = el("input", "slider", { type: "range" });
  gradeSlider.min = GRADE_MIN; gradeSlider.max = GRADE_MAX; gradeSlider.step = 0.05; gradeSlider.value = state.grade;
  gradeSlider.addEventListener("input", () => { state.grade = parseFloat(gradeSlider.value); gradeVal.textContent = state.grade.toFixed(2); draw(); });

  controls.append(
    field("Substrate", select(subOpts, state.substrate, (v) => { state.substrate = v; draw(); })),
    field("Resource", select(resOpts, state.resource, (v) => { state.resource = v; draw(); })),
    field("Grade", gradeSlider, gradeVal),
  );
  card.append(controls, out);
  const grid = el("div", "lib-grid");
  grid.appendChild(card);
  s.appendChild(grid);
  draw();
  return s;
}

// ── the shared content builder (legend + composer + all sections) ──
export function buildLibrary(container, lib) {
  container.innerHTML = "";

  const legend = el("div", "lib-legend");
  legend.append(
    el("span", "reg-metallic-text", { textContent: "metallic 1\u20138" }),
    el("span", null, { textContent: "transition 9\u201311 (firewall)" }),
    el("span", "reg-rocky-text", { textContent: "rocky 12\u201317" }),
    el("span", "reg-organic-text", { textContent: "organic 18\u201320" }),
  );
  legend.children[1].style.color = "var(--transition)";
  container.appendChild(legend);

  container.appendChild(composerSection(lib));

  const ships = lib.ships.slice().sort((a, b) => (a.lobe + a.size).localeCompare(b.lobe + b.size));
  container.appendChild(section(
    "Ships", "Metallic contour (1\u20138). Robust read is region energy; identity is the fragile shape inside the hump. Lobe (military / civilian / crude) is the coarse family; role is the individual.",
    ships.map((s) => card({ name: s.name, meta: `${s.role} \u00B7 ${s.lobe} \u00B7 ${s.sizeClass} \u00B7 size ${s.size}`, contour: s.contour, emissive: s.emissive })),
  ));

  container.appendChild(section(
    "Structures", "Flat by design \u2014 no contour peak to read. Identity is carried by emissive (EM-loud vs emission-dead) and cross-region bleed, not shape.",
    lib.structures.map((s) => card({ name: s.name, meta: `size ${s.size}`, contour: s.contour, emissive: s.emissive, note: s.note, noteTell: !!s.note })),
  ));

  container.appendChild(section(
    "Organics", "Organic region (18\u201320). Static footprints here; the live/temporal creature signatures arrive in Phase 6.",
    lib.organicsStatic.map((s) => card({ name: s.name, meta: `kind ${s.kind}`, contour: s.contour, emissive: s.emissive, note: s.note })),
  ));

  container.appendChild(section(
    "Substrates", "The rock baselines (rocky 12\u201317). A barren rock reads as one of these. Learn their shapes: a resource bump has to be spotted as a perturbation ON one of them.",
    lib.substrates.map((s) => card({ name: s.name, meta: `kind ${s.kind}`, contour: s.contour })),
  ));

  container.appendChild(section(
    "Resources", "The additive perturbation: a rock is substrate + resource\u00D7grade. These are the resource contours ALONE \u2014 the bump you're learning to spot. Most peak across the transition firewall (9\u201311) and low-rocky, i.e. just below the substrate hump, which is what makes them separable. metal = whether it reads metal-ward (the ambiguous ones lean toward the ship region).",
    lib.resources.map((s) => card({ name: s.name, meta: `${s.metal ? "metal" : "non-metal"}`, contour: s.contour, note: s.note, noteTell: true })),
  ));

  if (lib.composites && lib.composites.length) {
    container.appendChild(section(
      "Example rocks", "Authored representative composites, rendered through the engine's own substrate + resource\u00D7grade. Faint = the bare substrate; solid = the composite. The gap between them is the resource \u2014 the skill made concrete.",
      lib.composites.map((c) => compositeCard(c, lib)), true,
    ));
  }

  if (lib.creatureFootprint) {
    container.appendChild(section("Creatures", "", [card({
      name: "Creature (static footprint)", meta: "temporal signature \u2014 Phase 6", contour: lib.creatureFootprint,
      note: "Caveat: a creature's real identity is in its TEMPORAL behaviour (sub-emitter flux + parallax decoherence, Phase 6), not this static footprint. Shown only for completeness \u2014 do not memorize this as a look you'll read in play.",
      noteTell: true,
    })]));
  }
}

// open the standalone library page as a separate window you can park beside the scanner
function popOut() {
  window.open("./library.html", "signal-library", "width=920,height=900");
}

// ── in-page overlay shell ──
export function initLibrary({ lib, root, openBtn }) {
  root.innerHTML = "";

  const head = el("div", "lib-head");
  head.appendChild(el("h2", null, { textContent: "Signal Library" }));
  head.appendChild(el("span", "sub", { textContent: "single-signature reference \u00B7 shape only (no range/size/gain) \u00B7 \u00A75.4" }));
  const popBtn = el("button", "modebtn lib-pop lib-close", { textContent: "Pop out \u29C9" });
  const closeBtn = el("button", "modebtn lib-close", { textContent: "Close" });
  head.append(popBtn, closeBtn);
  root.appendChild(head);

  const body = el("div", "lib-body");
  root.appendChild(body);
  buildLibrary(body, lib);

  const open = () => { root.classList.add("open"); body.scrollTop = 0; };
  const close = () => root.classList.remove("open");
  if (openBtn) openBtn.addEventListener("click", open);
  popBtn.addEventListener("click", () => { popOut(); close(); });
  closeBtn.addEventListener("click", close);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && root.classList.contains("open")) close(); });

  return { open, close };
}
