// scenario.js — save/load JSON (design §12, §5.3): the harness seam made concrete. Pure
// functions only: build a plain, JSON-safe snapshot of the live app state on the way out,
// validate/normalize one back on the way in. No DOM, no fetch — main.js does the file I/O and
// hands this module plain objects/strings. A future Python harness can load the same shape and
// re-run physics.js's accumulate() over `entities` + `env` directly — no need to re-implement
// the generator or its RNG.
export const SCENARIO_VERSION = 1;

// whitelist: only the physics/placement-schema fields, never the per-frame computed ones
// (d, bearing, _g, _inSector, _contrib, _revealed, _scannable, k) that updateGeometry stamps
// on each entity every recompute — those are derived from ship position, not scene state.
// pathType/path/followsId/followOffset are Phase 6 mobile-ship state (design §7.2) — authored
// scene state, not per-frame derived, so (unlike d/bearing/etc.) they belong in the whitelist.
// isCreature/creatureState/subEmitterCount/fluxAmplitude/fluxRate/intrinsicVsParallax/
// jitterRadius/creatureId/emitterAngle/emitterPhase/hidden are Phase 6 creature state (design
// §7.4) — same reasoning: authored at creation, not derived per frame.
const ENTITY_FIELDS = [
  "id", "type", "displayName", "x", "y", "enabled", "size", "emissive",
  "contour", "substrate", "resource", "grade", "sigId", "scanned",
  "pathType", "path", "followsId", "followOffset",
  "isCreature", "creatureState", "subEmitterCount", "fluxAmplitude", "fluxRate",
  "intrinsicVsParallax", "jitterRadius", "creatureId", "emitterAngle", "emitterPhase", "hidden",
];

function cleanEntity(e) {
  const out = {};
  for (const f of ENTITY_FIELDS) if (e[f] !== undefined) out[f] = e[f];
  return out;
}

// build a plain, JSON-safe scenario object from the live app state
export function buildScenario({ ship, env, ui, settings, gen, palette, mode, scene }) {
  return {
    version: SCENARIO_VERSION,
    savedAt: new Date().toISOString(),
    ship: { x: ship.x, y: ship.y },
    env: {
      rMax: env.rMax, sectorDeg: env.sectorDeg, sectorCenter: env.sectorCenter,
      dMin: env.dMin, pEmissive: env.pEmissive,
    },
    ui: { zoom: ui.zoom, colorCoded: ui.colorCoded, revealRange: ui.revealRange },
    settings: {
      logMode: settings.logMode, F: settings.F, C: settings.C,
      gain: settings.gain, emissiveDisplayMax: settings.emissiveDisplayMax,
    },
    gen: { ...gen },
    palette: palette || null,
    // active ship-find/resource-find targets + hit counts (design §10) — saved alongside
    // palette so a scenario mid-hunt reloads with the same target and progress, not a blank one.
    mode: mode || { ship: null, resource: null, shipHits: 0, resourceHits: 0 },
    entities: scene.map(cleanEntity),
  };
}

// validate + normalize a loaded scenario back to the shape buildScenario produces.
// Returns { scenario } or { error }. Accepts a JSON string or an already-parsed object.
export function parseScenario(json) {
  let obj;
  try {
    obj = typeof json === "string" ? JSON.parse(json) : json;
  } catch (err) {
    return { error: `invalid JSON: ${err.message}` };
  }
  if (!obj || typeof obj !== "object") return { error: "not a scenario object" };
  if (obj.version !== SCENARIO_VERSION) return { error: `unsupported scenario version ${obj.version}` };
  if (!obj.ship || !obj.env || !obj.settings || !obj.gen) return { error: "missing ship/env/settings/gen" };
  if (!Array.isArray(obj.entities)) return { error: "missing entities array" };
  return {
    scenario: {
      version: obj.version,
      ship: { x: obj.ship.x, y: obj.ship.y },
      env: { ...obj.env },
      ui: { ...obj.ui },
      settings: { ...obj.settings },
      gen: { ...obj.gen },
      palette: obj.palette || null,
      mode: obj.mode || { ship: null, resource: null, shipHits: 0, resourceHits: 0 },
      entities: obj.entities.map(cleanEntity),
    },
  };
}
