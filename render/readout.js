// readout.js — the spectral + emissive readout and the region-energy panel.
// Render-on-change for Phase 1 (static). The requestAnimationFrame loop arrives
// with the temporal layer (Phase 6); nothing here assumes a clock.
import {
  BANDS, EMISSIVE, REGIONS, TRANSITION,
  regionEnergy, regionContour, displayLog, displayLinear,
} from "../sim/physics.js";

// which region a 1-indexed band belongs to (for colouring). Exported so the library view
// (render/library.js) colours bands identically — one source of truth for the mapping.
export function bandRegion(b) {
  if (b >= REGIONS.metallic.lo && b <= REGIONS.metallic.hi) return "metallic";
  if (b >= TRANSITION.lo && b <= TRANSITION.hi) return "transition";
  if (b >= REGIONS.rocky.lo && b <= REGIONS.rocky.hi) return "rocky";
  return "organic";
}

let built = false;
let bandEls = []; // {fill, cap} per spectral band
let emEls = []; // per emissive bar
const EMIT_LABELS = ["IR", "EM", "PA"];

function buildSkeleton(root) {
  root.innerHTML = "";
  bandEls = [];
  emEls = [];

  const makeBar = (cls, label, sub) => {
    const col = document.createElement("div");
    col.className = `bar ${cls}`;
    const track = document.createElement("div");
    track.className = "track";
    const fill = document.createElement("div");
    fill.className = "fill";
    const cap = document.createElement("div");
    cap.className = "cap";
    track.appendChild(fill);
    track.appendChild(cap);
    const lab = document.createElement("div");
    lab.className = "blabel";
    lab.textContent = label;
    col.appendChild(track);
    col.appendChild(lab);
    if (sub) {
      const s = document.createElement("div");
      s.className = "bsub";
      s.textContent = sub;
      col.appendChild(s);
    }
    return { col, fill, cap };
  };

  // spectral group
  const spectral = document.createElement("div");
  spectral.className = "bargroup spectral";
  for (let b = 1; b <= BANDS; b++) {
    const reg = bandRegion(b);
    const { col, fill, cap } = makeBar(`reg-${reg}`, String(b), null);
    col.dataset.band = b;
    spectral.appendChild(col);
    bandEls.push({ fill, cap, col });
  }

  // emissive group (separate readout)
  const emissive = document.createElement("div");
  emissive.className = "bargroup emissive";
  for (let c = 0; c < EMISSIVE; c++) {
    const { col, fill, cap } = makeBar("reg-emissive", EMIT_LABELS[c], null);
    emissive.appendChild(col);
    emEls.push({ fill, cap, col });
  }

  const wrap = document.createElement("div");
  wrap.className = "readout-bars";
  wrap.appendChild(spectral);
  const divider = document.createElement("div");
  divider.className = "readout-divider";
  wrap.appendChild(divider);
  wrap.appendChild(emissive);
  root.appendChild(wrap);

  built = true;
}

// settings: { logMode, F, C, gain, emissiveDisplayMax }
// data: { R:[20], E:[3], perBand:[[{id,amount}]] }
// onHover(bandIndex|null): callback to drive the decompose panel
export function renderReadout(root, data, settings, onHover) {
  if (!built) {
    buildSkeleton(root);
    // hover wiring for the live decompose (cheap §5.1 by eye)
    bandEls.forEach((el, i) => {
      el.col.addEventListener("mouseenter", () => onHover && onHover(i));
      el.col.addEventListener("mouseleave", () => onHover && onHover(null));
    });
  }

  const { R, E } = data;
  const { logMode, F, C, gain, emissiveDisplayMax } = settings;

  for (let i = 0; i < BANDS; i++) {
    const gr = gain * R[i];
    const frac = logMode ? displayLog(R[i], F, C, gain) : displayLinear(R[i], gain);
    const el = bandEls[i];
    el.fill.style.height = (frac * 100).toFixed(2) + "%";
    // clip cap: a band pinned at the top rail. Linear ceiling is 1 (i.e. G·R>1);
    // log ceiling is C (G·R>C maps past 1).
    const clipped = logMode ? gr > C : gr > 1;
    el.cap.style.opacity = clipped ? "1" : "0";
    el.col.title = `band ${i + 1}: R=${R[i].toFixed(3)}`;
  }

  for (let c = 0; c < EMISSIVE; c++) {
    const frac = Math.max(0, Math.min(1, E[c] / emissiveDisplayMax));
    emEls[c].fill.style.height = (frac * 100).toFixed(2) + "%";
    emEls[c].col.title = `${EMIT_LABELS[c]}: ${E[c].toFixed(2)}`;
  }
}

// region-energy panel: the robust read, live. Returns markup the caller drops in.
export function renderRegionEnergy(el, data, dominantContourRegion) {
  const e = regionEnergy(data.R);
  const total = e.metallic + e.rocky + e.organic || 1;
  const row = (name, key, val) => {
    const pct = ((val / total) * 100).toFixed(0);
    const dom = key === dominantContourRegion ? " dominant" : "";
    return `<div class="re-row${dom}">
      <span class="re-name reg-${key}-text">${name}</span>
      <span class="re-val">${val.toFixed(2)}</span>
      <span class="re-bar"><i style="width:${Math.min(100, (val / total) * 100)}%"></i></span>
      <span class="re-pct">${pct}%</span>
    </div>`;
  };
  el.innerHTML =
    row("Metallic", "metallic", e.metallic) +
    row("Rocky", "rocky", e.rocky) +
    row("Organic", "organic", e.organic) +
    `<div class="re-row re-trans"><span class="re-name">Transition</span><span class="re-val">${e.transition.toFixed(2)}</span><span class="re-note">firewall / not a material class</span></div>`;
}

// decompose panel for the hovered band: who contributed how much (ground truth, §5.1).
// groupId(rawId): collapses a creature's hidden sub-emitters (§7.4) into their seed's id, so a
// 12-emitter flock reports as ONE contributing source, not 11 anonymous extras — physics.js
// genuinely sees each sub-emitter as a distinct point source, but the player never perceives a
// creature as more than one contact, so this instrumentation shouldn't either. Defaults to the
// identity function for any caller that doesn't need grouping.
export function renderDecompose(el, data, bandIndex, entityNameById, groupId = (id) => id) {
  if (bandIndex == null) {
    el.innerHTML = `<div class="dc-hint">Hover a band to decompose the sum.</div>`;
    return;
  }
  const merged = new Map(); // groupId -> summed amount
  for (const c of data.perBand[bandIndex] || []) {
    const gid = groupId(c.id);
    merged.set(gid, (merged.get(gid) || 0) + c.amount);
  }
  const contribs = [...merged.entries()].map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount);
  const total = contribs.reduce((s, c) => s + c.amount, 0);
  let html = `<div class="dc-head">Band ${bandIndex + 1} &mdash; R = ${data.R[bandIndex].toFixed(3)}</div>`;
  if (!contribs.length) {
    html += `<div class="dc-hint">no contributors</div>`;
  } else {
    for (const c of contribs) {
      const pct = total > 0 ? (c.amount / total) * 100 : 0;
      html += `<div class="dc-row">
        <span class="dc-name">${entityNameById(c.id)}</span>
        <span class="dc-bar"><i style="width:${pct.toFixed(1)}%"></i></span>
        <span class="dc-amt">${c.amount.toFixed(3)}</span>
        <span class="dc-pct">${pct.toFixed(0)}%</span>
      </div>`;
    }
  }
  el.innerHTML = html;
}

// identity read helper: dominant-region normalized contour as small bars,
// so you can watch ratios hold under range/scale (the §2 ratio-legibility claim).
export function dominantRegion(data) {
  const e = regionEnergy(data.R);
  const entries = [["metallic", e.metallic], ["rocky", e.rocky], ["organic", e.organic]];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0 ? entries[0][0] : null;
}

// per-source region totals — the "exhaustive decompose" (Phase 5, design §5.1): instead of
// only the hovered band, this always shows every contributing entity's total energy in each
// robust region, summed across the whole spectrum. Answers "who's pushing this region read up"
// without hovering band by band — the region-energy collision check made exhaustive.
export function renderSourceTotals(el, data, entityNameById, groupId = (id) => id) {
  const totals = new Map(); // groupId -> { metallic, transition, rocky, organic }
  for (let i = 0; i < BANDS; i++) {
    const reg = bandRegion(i + 1);
    for (const c of data.perBand[i]) {
      const gid = groupId(c.id);
      const t = totals.get(gid) || { metallic: 0, transition: 0, rocky: 0, organic: 0 };
      t[reg] += c.amount;
      totals.set(gid, t);
    }
  }
  if (!totals.size) {
    el.innerHTML = `<div class="dc-hint">no contributors</div>`;
    return;
  }
  const rows = [...totals.entries()]
    .map(([id, t]) => ({ id, total: t.metallic + t.transition + t.rocky + t.organic, ...t }))
    .sort((a, b) => b.total - a.total);
  let html = `<div class="st-row st-head">
    <span></span><span class="reg-metallic-text">met</span>
    <span style="color:var(--transition)">trn</span>
    <span class="reg-rocky-text">rock</span><span class="reg-organic-text">org</span>
  </div>`;
  for (const r of rows) {
    html += `<div class="st-row">
      <span class="st-name">${entityNameById(r.id)}</span>
      <span class="st-seg reg-metallic-text">${r.metallic.toFixed(2)}</span>
      <span class="st-seg" style="color:var(--transition)">${r.transition.toFixed(2)}</span>
      <span class="st-seg reg-rocky-text">${r.rocky.toFixed(2)}</span>
      <span class="st-seg reg-organic-text">${r.organic.toFixed(2)}</span>
    </div>`;
  }
  el.innerHTML = html;
}

// active hunt targets + hit counter (design §10): ship-find/resource-find are independent
// toggles, so up to both rows can show at once; neither active ⇒ the hint. mode = { ship, resource,
// shipHits, resourceHits } — ship/resource are { id, name } | null, set fresh by the last Generate.
export function renderMission(el, mode) {
  if (!mode || (!mode.ship && !mode.resource)) {
    el.innerHTML = `<div class="dc-hint">No find mode active — toggle Ship-find or Resource-find in Generation before your next Generate.</div>`;
    return;
  }
  let html = "";
  if (mode.ship) {
    const found = mode.shipHits > 0;
    html += `<div class="pal-row"><span class="pal-lab">Ship target</span><span class="pal-val">${mode.ship.name} &mdash; ${found ? "found" : "not found"}</span></div>`;
  }
  if (mode.resource) {
    html += `<div class="pal-row"><span class="pal-lab">Resource target</span><span class="pal-val">${mode.resource.name} &mdash; ${mode.resourceHits} found</span></div>`;
  }
  el.innerHTML = html;
}

// the drawn variety-cap palette from the last Generate (HANDOFF §3a-i): which strata/resources
// this scene's rocks were capped to, so a recurring confounder is nameable, not just visible.
export function renderPalette(el, palette) {
  if (!palette) {
    el.innerHTML = `<div class="dc-hint">No variety cap on the last generation — rocks drew from the full strata/resource pool.</div>`;
    return;
  }
  const list = (arr) => (arr.length ? arr.map((x) => x.name).join(", ") : "—");
  el.innerHTML = `
    <div class="pal-row"><span class="pal-lab">Strata (${palette.substrates.length})</span><span class="pal-val">${list(palette.substrates)}</span></div>
    <div class="pal-row"><span class="pal-lab">Resources (${palette.resources.length})</span><span class="pal-val">${list(palette.resources)}</span></div>
  `;
}

// mini 20-band strip for the snapshot/compare panel — same region colouring as the live
// readout, scaled to a shared max so frozen vs live heights are directly comparable.
function miniStrip(R, scaleMax) {
  let html = '<div class="cmp-strip">';
  for (let i = 0; i < BANDS; i++) {
    const b = i + 1;
    const h = (Math.max(0, Math.min(1, R[i] / scaleMax)) * 100).toFixed(1);
    html += `<div class="cmp-bar reg-${bandRegion(b)}" style="height:${h}%" title="band ${b}: ${R[i].toFixed(3)}"></div>`;
  }
  return html + "</div>";
}

// snapshot / compare (design §5.3): hold a frozen readout beside the live one. frozen/live are
// { R, ship } — frozen is null until the user takes a snapshot.
export function renderCompare(el, frozen, live) {
  if (!frozen) {
    el.innerHTML = `<div class="dc-hint">Snapshot the current readout to hold it beside the live one — then close the distance, mute a source, or change a setting and watch what actually moved.</div>`;
    return;
  }
  const scaleMax = Math.max(1e-6, ...frozen.R, ...live.R);
  const ef = regionEnergy(frozen.R), el2 = regionEnergy(live.R);
  const delta = (a, b) => { const d = b - a; return (d > 0 ? "+" : "") + d.toFixed(2); };
  const dRow = (label, cls, a, b) => `<div class="cmp-drow"><span class="${cls}">${label}</span><span>${a.toFixed(2)} → ${b.toFixed(2)} (${delta(a, b)})</span></div>`;
  el.innerHTML = `
    <div class="cmp-lab">Frozen — ship ${frozen.ship.x.toFixed(1)}, ${frozen.ship.y.toFixed(1)}</div>
    ${miniStrip(frozen.R, scaleMax)}
    <div class="cmp-lab">Live — ship ${live.ship.x.toFixed(1)}, ${live.ship.y.toFixed(1)}</div>
    ${miniStrip(live.R, scaleMax)}
    <div class="cmp-deltas">
      ${dRow("Metallic", "reg-metallic-text", ef.metallic, el2.metallic)}
      ${dRow("Rocky", "reg-rocky-text", ef.rocky, el2.rocky)}
      ${dRow("Organic", "reg-organic-text", ef.organic, el2.organic)}
    </div>
  `;
}

export function renderIdentity(el, data) {
  const reg = dominantRegion(data);
  if (!reg) {
    el.innerHTML = `<div class="dc-hint">no signal</div>`;
    return;
  }
  const c = regionContour(data.R, reg);
  const lo = REGIONS[reg].lo;
  let html = `<div class="id-head">Dominant region: <b class="reg-${reg}-text">${reg}</b> &mdash; normalized contour (peak = 1.00)</div><div class="id-bars">`;
  c.forEach((v, k) => {
    html += `<div class="id-col"><div class="id-track"><div class="id-fill" style="height:${(v * 100).toFixed(0)}%"></div></div><div class="id-lab">${lo + k}</div><div class="id-num">${v.toFixed(2)}</div></div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
}
