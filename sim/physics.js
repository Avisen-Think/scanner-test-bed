// physics.js — canonical accumulation (scanner-test-bed-design §3).
//
// Pure functions only: no DOM, no module-level mutable state, no randomness.
// The future Python collision harness re-implements this same math; if the two
// ever disagree, the harness is the authority (design §3). Keep this a faithful,
// boring transcription of §3 so that "they agree" is easy to verify by reading.

export const BANDS = 20; // spectral bands, linear, NO wrap (band 1 and 20 are not neighbours)
export const EMISSIVE = 3; // IR, EM, Particulate

// Region band ranges, 1-indexed inclusive (spectrum-breakdown §1).
// IMPORTANT: transition bands 9–11 belong to NO robust region by design — they are
// the firewall / spill zone (design §2, breakdown §4). Region energy deliberately
// skips them, so a metal+rock pile-up's forged transition energy never lands in a
// material-class total.
export const REGIONS = {
  metallic: { lo: 1, hi: 8 },
  rocky: { lo: 12, hi: 17 },
  organic: { lo: 18, hi: 20 },
};
export const TRANSITION = { lo: 9, hi: 11 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- angular gain g(θ) -------------------------------------------------------
// Tapered window (design §3, §9): gain 1 on-axis, falling to 0 at the sector edge
// via a cos² taper — this is what turns bearing from categorical ("in the box")
// into continuous ("a band peaks as the beam centres on a source").
// sectorDeg >= 360  → omnidirectional, g = 1 everywhere (no bearing information).
// All angles in degrees.
export function angularGain(bearingDeg, centerDeg, sectorDeg) {
  if (sectorDeg >= 360) return 1;
  const half = sectorDeg / 2;
  // smallest angular distance between bearing and sector centre, 0..180
  const dist = Math.abs(((bearingDeg - centerDeg + 540) % 360) - 180);
  if (dist > half) return 0; // outside the sector
  const x = dist / half; // 0 on-axis .. 1 at the edge
  const c = Math.cos((x * Math.PI) / 2);
  return c * c; // cos² → smooth peak on-axis, zero at edge
}

// distance/angle weight  w(d,θ) = g(θ) / max(d, d_min)²   (design §3)
export function weight(d, g, dMin) {
  const dd = Math.max(d, dMin);
  return g / (dd * dd);
}

// emissive weight, faster falloff p>2 → near-range confirm (design §3, breakdown §5)
export function weightEmissive(d, g, dMin, p) {
  const dd = Math.max(d, dMin);
  return g / Math.pow(dd, p);
}

// --- per-source signature value ----------------------------------------------
// ships / structures / organics:  S[i] = contour[i] · size
// rocks:                          S[i] = (substrate[i] + resource[i]·grade) · size
// Rocks are resolved to an effective contour here so the accumulator stays
// type-agnostic; the substrate/resource split is kept on the entity for the
// future decompose overlay.
export function resolveContour(entity) {
  if (entity.contour) return entity.contour; // ships/structures/organics: already resolved
  const sub = entity.substrate || new Array(BANDS).fill(0);
  const res = entity.resource || new Array(BANDS).fill(0);
  const grade = entity.grade ?? 0;
  const out = new Array(BANDS);
  for (let i = 0; i < BANDS; i++) out[i] = sub[i] + res[i] * grade;
  return out;
}

// visibility gate: inside R_max AND inside the sector (design §3)
export function isVisible(entity, env) {
  if (entity.d > env.rMax) return false;
  const g = angularGain(entity.bearing ?? 0, env.sectorCenter ?? 0, env.sectorDeg ?? 360);
  return g > 0;
}

// --- THE accumulation  R[i] (design §3) --------------------------------------
//   R[i] = Σ_e contour_e[i] · size_e · k_e · w(d_e, θ_e)     over visible e
// Returns:
//   R          : spectral readout, length 20 (raw, pre-display-transform)
//   E          : emissive readout, length 3 (raw)
//   perBand    : perBand[i] = [{id, amount}, …]  ← live decompose ground-truth (§5.1)
//   visibleIds : ids that passed the gate
export function accumulate(entities, env) {
  const R = new Array(BANDS).fill(0);
  const E = new Array(EMISSIVE).fill(0);
  const perBand = Array.from({ length: BANDS }, () => []);
  const visibleIds = [];

  for (const e of entities) {
    if (e.enabled === false) continue;
    if (e.d > env.rMax) continue;
    const g = angularGain(e.bearing ?? 0, env.sectorCenter ?? 0, env.sectorDeg ?? 360);
    if (g <= 0) continue;

    const k = e.k ?? 1;
    const size = e.size ?? 1;
    const w = weight(e.d, g, env.dMin) * size * k;
    const contour = resolveContour(e);

    for (let i = 0; i < BANDS; i++) {
      const amt = contour[i] * w;
      if (amt !== 0) {
        R[i] += amt;
        perBand[i].push({ id: e.id, amount: amt });
      }
    }

    if (e.emissive) {
      const wem = weightEmissive(e.d, g, env.dMin, env.pEmissive) * k;
      for (let c = 0; c < EMISSIVE; c++) E[c] += e.emissive[c] * wem;
    }
    visibleIds.push(e.id);
  }
  return { R, E, perBand, visibleIds };
}

// Lightweight variant of accumulate() for high-frequency callers (Phase 6's per-frame
// motion loop) that only need R/E — not the full per-source-per-band contributor list.
// Same math, same gates, same result for R/E; skips building `perBand`/`visibleIds`, which
// is where nearly all of accumulate()'s per-call allocation goes (an {id,amount} object per
// band per visible entity). Never used to answer the §5.1 decompose/source-totals questions
// — those need the real per-source breakdown and still call the canonical accumulate().
export function accumulateFast(entities, env) {
  const R = new Array(BANDS).fill(0);
  const E = new Array(EMISSIVE).fill(0);
  for (const e of entities) {
    if (e.enabled === false) continue;
    if (e.d > env.rMax) continue;
    const g = angularGain(e.bearing ?? 0, env.sectorCenter ?? 0, env.sectorDeg ?? 360);
    if (g <= 0) continue;

    const k = e.k ?? 1;
    const size = e.size ?? 1;
    const w = weight(e.d, g, env.dMin) * size * k;
    const contour = resolveContour(e);
    for (let i = 0; i < BANDS; i++) R[i] += contour[i] * w;

    if (e.emissive) {
      const wem = weightEmissive(e.d, g, env.dMin, env.pEmissive) * k;
      for (let c = 0; c < EMISSIVE; c++) E[c] += e.emissive[c] * wem;
    }
  }
  return { R, E };
}

// --- robust region energy (the type/material read, design §2) ----------------
// A LINEAR functional of R, and R is a linear sum of sources, therefore the region
// energy of a mix is EXACTLY the sum of the parts. This is the additive-stability
// claim everything leans on, true by arithmetic. Skips transition (9–11).
export function regionEnergy(R) {
  const sum = (lo, hi) => {
    let s = 0;
    for (let b = lo; b <= hi; b++) s += R[b - 1];
    return s;
  };
  return {
    metallic: sum(REGIONS.metallic.lo, REGIONS.metallic.hi),
    rocky: sum(REGIONS.rocky.lo, REGIONS.rocky.hi),
    organic: sum(REGIONS.organic.lo, REGIONS.organic.hi),
    transition: sum(TRANSITION.lo, TRANSITION.hi), // reported for inspection; not a material class
  };
}

// in-region normalized contour (the fragile identity read, design §2):
// normalize the dominant region's bands to their own peak → scale-invariant shape.
export function regionContour(R, regionKey) {
  const reg = REGIONS[regionKey];
  if (!reg) return [];
  const slice = [];
  for (let b = reg.lo; b <= reg.hi; b++) slice.push(R[b - 1]);
  const peak = Math.max(...slice, 1e-12);
  return slice.map((v) => v / peak);
}

// --- display transforms (design §3, extended) --------------------------------
// Chosen by the QUESTION being asked (shape vs dominance), not by range.
// F (floor) and C (saturation) are FIXED constants, never frame-derived.
//
// Gain G is a MASTER pre-scale applied in BOTH modes (test-bed extension of §3,
// which placed gain only in linear): the log curve sees G·value exactly as linear
// does, so G brightens/dims without changing shape (a uniform offset on a log axis).
// Guarded so a zero/negative floor or an inverted F≥C can never emit NaN — an
// unguarded log(0)=−∞ makes every band NaN and silently freezes the bars.
export function displayLog(value, F, C, G = 1) {
  const f = F > 1e-9 ? F : 1e-9; // floor must be strictly positive
  const c = C > f ? C : f * 10; // saturation must sit above the floor
  const v = Math.max(G * value, f);
  return clamp01((Math.log(v) - Math.log(f)) / (Math.log(c) - Math.log(f)));
}
export function displayLinear(value, G) {
  return clamp01(G * value);
}
