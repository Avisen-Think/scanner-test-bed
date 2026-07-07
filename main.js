// main.js — wires the modules. Entities carry world POSITIONS (x,y); distance + bearing
// are derived each frame from where you drag the ship, then fed to the unchanged physics.
// Phase 6: an authoritative delta-time rAF loop drives mobile ships (design §7). The loop
// only runs while something in the scene is actually moving (gated by hasMotion()) — a fully
// static scene stays exactly as cheap/event-driven as before Phase 6.
import { accumulate, accumulateFast, angularGain } from "./sim/physics.js";
import { distance, bearingDeg, FIELD_KM } from "./sim/geometry.js";
import { pathPosition, finalizeMobilePath } from "./sim/paths.js";
import { creatureEmitterPosition } from "./sim/creatures.js";
import {
  renderReadout, renderRegionEnergy, renderDecompose, renderIdentity, dominantRegion,
  renderSourceTotals, renderPalette, renderCompare, renderMission,
} from "./render/readout.js";
import { createField } from "./render/field.js";
import { initControls } from "./ui/controls.js";
import { initCustomize } from "./ui/customize.js";
import { initGenerate } from "./ui/generate.js";
import { initScenario } from "./ui/scenario.js";
import { initLibrary } from "./render/library.js";
import { createEntity, removeEntity, generateScene } from "./sim/world.js";
import { buildScenario, parseScenario } from "./sim/scenario.js";

const $ = (id) => document.getElementById(id);

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`failed to load ${path}: ${res.status}`);
  return res.json();
}

// build a ship/structure/organic entity at a world position
function fromContour(entry, type, x, y, size) {
  return {
    id: entry.id, type, displayName: entry.name,
    contour: entry.contour, size: size ?? entry.size,
    emissive: entry.emissive || null, x, y, enabled: true,
  };
}
// build a rock composite at a world position
function rockComposite(id, displayName, substrate, resource, grade, size, x, y) {
  return {
    id, type: "rock", displayName,
    substrate: substrate ? substrate.contour : null,
    resource: resource ? resource.contour : null,
    grade, size, emissive: null, x, y, enabled: true,
  };
}

function buildScene(lib) {
  const ship = (id) => lib.ships.find((s) => s.id === id);
  const sub = (id) => lib.substrates.find((s) => s.id === id);
  const res = (id) => lib.resources.find((s) => s.id === id);
  const org = (id) => lib.organicsStatic.find((s) => s.id === id);
  // positions around field centre (50,50); spread within ~13 km so nothing is revealed
  // (≤5 km) at start — you read them in the spectrum first, then drag in to see them.
  return [
    fromContour(ship("andromeda"), "ship", 56, 50),       // ~6 km E
    fromContour(ship("triton"), "ship", 57, 51),          // ~7 km, ~1.4 km from Andromeda (pile-up when close)
    fromContour(ship("ganymede"), "ship", 40, 42),        // ~12.8 km SW (crude, transition spill)
    rockComposite("ironstone", "Ironstone (Granite+Iron g0.7)", sub("granite"), res("iron"), 0.70, 60, 53, 57), // ~7.6 km SE
    fromContour(org("biomass"), "organic", 47, 59, 50),   // ~9.5 km S
  ];
}

(async function boot() {
  let lib, cfg;
  try {
    [lib, cfg] = await Promise.all([loadJSON("./data/library.json"), loadJSON("./data/config.json")]);
  } catch (err) {
    $("readout").innerHTML = `<div class="boot-error">Couldn't load data files.<br>${err.message}<br><br>This page must be served over <b>http://</b> (VS Code Live Server, or <code>python -m http.server</code>) — ES modules and fetch don't run from <code>file://</code>.</div>`;
    return;
  }

  const scene = buildScene(lib);
  const ship = { x: 50, y: 50 };
  const env = { rMax: 50, sectorDeg: 360, sectorCenter: 0, dMin: cfg.dMin, pEmissive: cfg.emissive.p };
  const ui = {
    zoom: 100, colorCoded: false, lockShip: false, lockSensors: false, sensorPoint: null, sensorArmed: false,
    selectedId: null, revealRange: 5, customizing: false, tool: "place",
    mobileArmed: false, pendingMobileId: null,
    // auto-rotate: sweeps env.sectorCenter on its own (see stepSensorRotation below). rotateDir
    // doubles as "current travel direction" — the Reverse button sets it, and oscillate mode's
    // bounds-hit logic flips it too, so both mechanisms drive one shared field consistently.
    autoRotate: false, rotateRate: 15, rotateDir: 1, rotateMode: "full", rotateMin: -90, rotateMax: 90,
  };
  const custom = {
    type: "ship",
    shipSize: "any", shipId: "random",
    shipMobile: false, shipPathType: "line", shipExtent: cfg.mobile.lineExtent[0],
    structId: "random",
    rock: { substrate: "random", resource: "random", size: 50, sizeRandom: true, grade: 0.7, gradeRandom: true },
    organic: { id: "random", size: 60, sizeRandom: true, isCreature: false, creatureId: "random" },
  };
  const gen = {
    ships: 20, rocks: 40, organics: 8, creatures: 4, shipClusters: true, rockClusters: true,
    varietyCap: false, substrateVariety: 3, resourceVariety: 3,
    mobileEnabled: true, shipFindMode: false, resourceFindMode: false,
  };
  const settings = {
    logMode: cfg.display.logMode, F: cfg.display.F, C: cfg.display.C, gain: cfg.display.gain,
    emissiveDisplayMax: cfg.emissive.displayMax,
  };

  const nameById = (id) => {
    const e = scene.find((x) => x.id === id);
    if (!e) return id;
    // flag a merged creature row so a large "Flock" total doesn't read as one small ship
    return e.isCreature ? `${e.displayName} (${e.subEmitterCount})` : e.displayName;
  };
  // a creature's hidden sub-emitters (§7.4) are physics-real point sources but never a
  // perceived contact — fold their per-band/per-source contributions into their seed's id so
  // the decompose/source-totals panels (§5.1) report ONE row per creature, not N anonymous ones.
  // Backed by a Map built once per call (not a scene.find per contribution) — renderDecompose/
  // renderSourceTotals call groupId() once per per-band contributor entry, so an O(entity-count)
  // find() there would go quadratic on a busy generated scene (§2 item 12's stutter class).
  function groupId(id) {
    if (!groupId.map) { groupId.map = new Map(); for (const e of scene) groupId.map.set(e.id, e.creatureId || e.id); }
    return groupId.map.get(id) ?? id;
  }

  // derive d, bearing, gating per entity from ship + sector (so physics + map agree)
  function updateGeometry() {
    if (ui.lockSensors && ui.sensorPoint) {
      env.sectorCenter = bearingDeg(ship.x, ship.y, ui.sensorPoint.x, ui.sensorPoint.y);
    }
    for (const e of scene) {
      e.d = distance(ship.x, ship.y, e.x, e.y);
      e.bearing = bearingDeg(ship.x, ship.y, e.x, e.y);
      const g = angularGain(e.bearing, env.sectorCenter, env.sectorDeg);
      const on = e.enabled !== false;
      e._g = g;
      e._inSector = g > 0;
      e._contrib = on && e.d <= env.rMax && g > 0;
      e._revealed = on && e.d <= ui.revealRange && g > 0;
      e._scannable = on && e.d <= 2 && g > 0;
    }
  }

  let hoveredBand = null;
  let last = null;
  let scan = null; // { id, start } while a scan is filling
  let genPalette = null; // last Generate's drawn variety-cap palette (null = full pool), §3a-i
  let snapshot = null; // { R, ship } frozen readout for the compare panel, design §5.3
  // active ship-find/resource-find targets + hit counts (design §10). Reset on every Generate/
  // Clear, same lifetime as genPalette — the hunt belongs to "this generated scene," not the
  // session. ship/resource are { id, name } | null; hits are counted on a completed scan.
  let mode = { ship: null, resource: null, shipHits: 0, resourceHits: 0 };

  // ── Phase 6: the authoritative delta-time loop (design §7.1) ─────────────────────────
  // Only ticks while something in the scene can actually move — a static scene never pays
  // for a running rAF loop, matching pre-Phase-6 behaviour exactly.
  let simTime = 0, rafId = null, lastTs = null;
  // Creatures keep the loop alive even if the player never moves — intrinsic flux (design §7.4)
  // must animate on its own, unlike a mobile ship's path or a cluster follower's rigid offset.
  // Auto-rotate (the sensor sweep) does too — it's a source of motion in its own right, just
  // aimed at the sector instead of an entity.
  function hasMotion() {
    return scene.some((e) => e.pathType || e.followsId || e.isCreature || e.creatureId)
      || (ui.autoRotate && ui.rotateRate > 0);
  }
  // drives env.sectorCenter on its own clock — same env field manual dragging and Lock Sensors
  // already write, so it's gated off whenever either of those owns it (mutual exclusion is also
  // enforced in ui/controls.js's toggle handlers, this is defense against a stray loaded state).
  function stepSensorRotation(dt) {
    if (!ui.autoRotate || ui.lockSensors) return;
    const delta = ui.rotateRate * ui.rotateDir * dt;
    if (ui.rotateMode === "oscillate") {
      const lo = Math.min(ui.rotateMin, ui.rotateMax), hi = Math.max(ui.rotateMin, ui.rotateMax);
      let c = env.sectorCenter + delta;
      if (c >= hi) { c = hi; ui.rotateDir = -1; }
      else if (c <= lo) { c = lo; ui.rotateDir = 1; }
      env.sectorCenter = c;
    } else {
      let c = (env.sectorCenter + delta + 180) % 360;
      if (c < 0) c += 360;
      env.sectorCenter = c - 180;
    }
  }
  function stepMotion(dt) {
    simTime += dt;
    stepSensorRotation(dt);
    let byId = null; // built lazily, only when a follower/emitter actually needs it (O(N) once, not O(N) per follower)
    for (const e of scene) {
      if (!e.pathType) continue;
      const p = pathPosition(e.pathType, e.path, cfg.mobile.speed, simTime);
      e.x = p.x; e.y = p.y;
    }
    for (const e of scene) {
      if (!e.followsId) continue;
      if (!byId) { byId = new Map(); for (const s of scene) byId.set(s.id, s); }
      const lead = byId.get(e.followsId);
      if (lead) { e.x = lead.x + e.followOffset.dx; e.y = lead.y + e.followOffset.dy; }
    }
    for (const e of scene) {
      if (!e.creatureId) continue;
      if (!byId) { byId = new Map(); for (const s of scene) byId.set(s.id, s); }
      const seed = byId.get(e.creatureId);
      if (!seed) continue;
      const p = creatureEmitterPosition(seed, e, simTime);
      e.x = p.x; e.y = p.y;
    }
  }
  const MAX_DT = 0.1; // clamp a slow/first frame (JIT warmup, GC, first paint) so motion
                       // eases through it instead of visibly jumping (design §7.1: still
                       // real delta-time on every normal frame, just capped against outliers)
  // accumulate()'s full per-source-per-band contributor list (§5.1's decompose ground truth)
  // and the DOM tables built on top of it (decompose, source-totals) are the only things here
  // that scale with entity count — the more signatures in range, the more that costs, which is
  // exactly the "more signatures / bigger R_max ⇒ worse stutter" pattern. The bars/region/
  // identity panels only need 20-ish numbers (accumulateFast, no perBand), so they stay on
  // every animation frame — cheap regardless of scene size, and this is what actually needs to
  // stay continuous for the motion-reading skill (concept §6.1/§6.2: a snapshot-y readout kills
  // that channel). Only the O(entity-count) tables are throttled, at a rate no one needs faster
  // than to read them. Discrete interactions (drag/control/scan/generate/load) are untouched —
  // they call the full recompute() directly, not through this loop.
  function renderBars() {
    const fast = accumulateFast(scene, env);
    renderReadout($("readout"), fast, settings, (b) => {
      hoveredBand = b;
      if (last) renderDecompose($("decompose"), last, hoveredBand, nameById, groupId);
    });
    renderRegionEnergy($("region-energy"), fast, dominantRegion(fast));
    renderIdentity($("identity"), fast);
  }
  const HEAVY_INTERVAL_MS = 250;
  let lastHeavyTs = -Infinity;
  // The cheap-every-time / heavy-throttled split, factored out so ANY continuous-update
  // source can use it — not just the motion loop. Dragging your own ship (or moving a
  // placed entity, or aiming a locked sensor) fires pointermove repeatedly too, and was
  // still calling the full recompute() on every single event until now — the one place the
  // O(entity-count) cost wasn't yet throttled, and the likely reason big/full-R_max scenes
  // still stutter under manual dragging even though the motion loop itself is smooth.
  function liveUpdate() {
    updateGeometry();
    if (fieldApi) fieldApi.render();
    renderBars();
    const now = performance.now();
    if (now - lastHeavyTs >= HEAVY_INTERVAL_MS) {
      lastHeavyTs = now;
      recompute();
    }
  }
  function tick(ts) {
    if (lastTs == null) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, MAX_DT);
    lastTs = ts;
    if (hasMotion()) {
      stepMotion(dt);
      liveUpdate();
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null; lastTs = null;
    }
  }
  function ensureLoop() {
    if (rafId == null && hasMotion()) { lastTs = null; rafId = requestAnimationFrame(tick); }
  }
  // a freshly generated/loaded mobile ship's path.t0 starts at 0 (world.js can't see the
  // clock); stamp the real session time so its motion starts from "now," not from wherever
  // simTime happened to be at generation.
  function stampPathOrigins(entities) {
    for (const e of entities) if (e.pathType && e.path) e.path.t0 = simTime;
  }

  function renderSelected() {
    const elx = $("selected");
    const e = scene.find((x) => x.id === ui.selectedId);
    if (!e) { elx.innerHTML = `<div class="dc-hint">Click a contact on the map to inspect it.</div>`; return; }
    const known = ui.colorCoded || e.scanned; // identity revealed by ground-truth mode OR a completed scan
    let html = `<div class="sel-head">${known ? e.displayName : "Unidentified contact"}${e.scanned ? ' <span class="scan-tag">scanned</span>' : ""}</div>`;
    html += `<div class="sel-row"><span>distance</span><b>${(e.d ?? 0).toFixed(2)} km</b></div>`;
    html += `<div class="sel-row"><span>bearing</span><b>${(e.bearing ?? 0).toFixed(0)}\u00B0</b></div>`;
    html += `<div class="sel-row"><span>in sector</span><b>${e._inSector ? "yes" : "no"}</b></div>`;
    html += `<div class="sel-row"><span>position</span><b>${e.x.toFixed(1)}, ${e.y.toFixed(1)}</b></div>`;
    const muted = e.enabled === false;
    html += `<div class="sel-row"><span>in readout</span><b>${muted ? "muted" : e._contrib ? "yes" : "no"}</b></div>`;
    if (known) {
      html += `<div class="sel-row"><span>type</span><b>${e.type}</b></div>`;
      if (e.size) html += `<div class="sel-row"><span>size</span><b>${e.size}</b></div>`;
    }
    if (scan && scan.id === e.id) {
      html += `<div class="scan-bar"><i id="scan-fill" style="width:0%"></i></div><div class="sel-note">scanning\u2026 hold within ${SCAN_KM} km &amp; in sector</div>`;
    } else if (!known && e._scannable) {
      html += `<button class="modebtn scan-btn" id="scan-btn">Scan (5 s)</button>`;
    } else if (!known) {
      html += `<div class="sel-note">Identity hidden \u2014 close to within ${SCAN_KM} km (in sector) and scan, or switch overlay to colour-coded.</div>`;
    }
    // per-source mute (replaces the old signal-list checkbox): drops this source out of the
    // accumulation so you can watch what it was contributing to the sum. In grey mode a muted
    // source vanishes from the map, but this panel stays its handle (selection persists), so
    // Unmute is always reachable here; colour-coded also keeps it on the map, dimmed.
    html += `<button class="modebtn scan-btn" id="sel-mute">${muted ? "Unmute source" : "Mute source"}</button>`;
    elx.innerHTML = html;
    const sb = $("scan-btn");
    if (sb) sb.addEventListener("click", () => startScan(e));
    const mb = $("sel-mute");
    if (mb) mb.addEventListener("click", () => {
      const next = e.enabled !== false ? false : true;
      e.enabled = next;
      // a creature's sub-emitters are hidden physics-only contributors (§7.4) — muting the one
      // visible contact must silence all of them together, or most of the swarm keeps sounding.
      if (e.isCreature) for (const s of scene) if (s.creatureId === e.id) s.enabled = next;
      recompute();
    });
  }

  const SCAN_KM = 2;
  const SCAN_MS = 5000;
  function startScan(e) {
    scan = { id: e.id, start: performance.now() };
    renderSelected();
    requestAnimationFrame(tickScan);
  }
  function tickScan() {
    if (!scan) return;
    const e = scene.find((x) => x.id === scan.id);
    if (!e || ui.selectedId !== scan.id || !e._scannable) { scan = null; renderSelected(); return; } // aborted
    const t = (performance.now() - scan.start) / SCAN_MS;
    if (t >= 1) {
      e.scanned = true; scan = null;
      // hit counter (design §10): a completed scan checks against the active hunt target(s).
      // Ship-find is binary (there's exactly one, so this can only ever flip 0→1); resource-find
      // is cumulative (several rocks can carry the target resource). sigId's "sub+res" shape
      // (world.js's rockEntity) is how a rock's resource id is recovered without a dedicated field.
      if (mode.ship && e.type === "ship" && e.sigId === mode.ship.id) mode.shipHits = 1;
      if (mode.resource && e.type === "rock" && e.sigId.split("+")[1] === mode.resource.id) mode.resourceHits++;
      recompute();
      return;
    }
    const fill = $("scan-fill");
    if (fill) fill.style.width = (t * 100).toFixed(1) + "%";
    requestAnimationFrame(tickScan);
  }

  let fieldApi = null;

  function recompute() {
    // scene composition may have changed since the last recompute (place/delete/generate/load)
    // — drop groupId's memoized id map so it rebuilds against the current scene instead of
    // silently missing newly added/removed creature groups.
    groupId.map = null;
    updateGeometry();
    last = accumulate(scene, env);
    const fstat = fieldApi ? fieldApi.render() : { offView: 0, revealed: 0 };
    renderReadout($("readout"), last, settings, (b) => {
      hoveredBand = b;
      renderDecompose($("decompose"), last, hoveredBand, nameById, groupId);
    });
    renderRegionEnergy($("region-energy"), last, dominantRegion(last));
    renderIdentity($("identity"), last);
    renderDecompose($("decompose"), last, hoveredBand, nameById, groupId);
    renderSourceTotals($("source-totals"), last, nameById, groupId);
    renderPalette($("palette"), genPalette);
    renderMission($("mission"), mode);
    renderCompare($("compare"), snapshot, { R: last.R, ship: { x: ship.x, y: ship.y } });
    renderSelected();
    controls.sync();
    $("offview").textContent = fstat.offView > 0 ? `${fstat.offView} contributing off-view` : "";
    $("hud").textContent = `ship ${ship.x.toFixed(1)}, ${ship.y.toFixed(1)} km \u00B7 aim ${env.sectorCenter.toFixed(0)}\u00B0 \u00B7 ${fstat.revealed} revealed \u00B7 ${env.sectorDeg >= 360 ? "360\u00B0" : env.sectorDeg + "\u00B0"} / R\u2264${env.rMax}`;
  }

  const controls = initControls({ scene, ship, env, settings, ui, els: {
    view: $("view"), sensor: $("sensor"), display: $("display"),
  }, onChange: recompute, sensorRanges: cfg.sensor.ranges, getR: () => (last ? last.R : null) });

  const cz = initCustomize({ lib, cfg, custom, ui, container: $("customize"), onChange: recompute });

  initLibrary({ lib, root: $("library-root"), openBtn: $("lib-open") });

  function resetScene(entities) {
    // mutate the shared array in place — field/controls/physics all hold this same reference
    scene.length = 0;
    if (entities) scene.push(...entities);
    ui.selectedId = null;
    ui.mobileArmed = false;
    ui.pendingMobileId = null;
    scan = null;
    recompute();
  }
  const genApi = initGenerate({
    gen, container: $("generate"),
    onGenerate: () => {
      const s = generateScene(lib, {
        ...gen,
        mobileRatio: cfg.mobile.generateRatio,
        mobileSpeed: cfg.mobile.speed,
        mobileExtents: { line: cfg.mobile.lineExtent, circle: cfg.mobile.circleRadius, fig8: cfg.mobile.fig8Extent },
        creatureSpreadKm: cfg.creatures.spreadKm,
        creatureSizeRange: [cfg.creatures.sizeMin, cfg.creatures.sizeMax],
      });
      genPalette = s.palette || null;
      mode = { ship: s.mode.ship, resource: s.mode.resource, shipHits: 0, resourceHits: 0 };
      stampPathOrigins(s);
      resetScene(s);
      ensureLoop();
    },
    onClear: () => { genPalette = null; mode = { ship: null, resource: null, shipHits: 0, resourceHits: 0 }; resetScene(null); },
  });

  initScenario({
    container: $("scenario"),
    onSave: () => buildScenario({ ship, env, ui, settings, gen, palette: genPalette, mode, scene }),
    onLoad: (text) => {
      const { scenario, error } = parseScenario(text);
      if (error) return { error };
      Object.assign(ship, scenario.ship);
      Object.assign(env, scenario.env);
      Object.assign(ui, scenario.ui);
      Object.assign(settings, scenario.settings);
      Object.assign(gen, scenario.gen);
      genPalette = scenario.palette || null;
      mode = scenario.mode || { ship: null, resource: null, shipHits: 0, resourceHits: 0 };
      snapshot = null;
      resetScene(scenario.entities);
      controls.sync();
      genApi.sync();
      ensureLoop();
      return {};
    },
  });

  $("snap-btn").addEventListener("click", () => {
    snapshot = { R: last.R.slice(), ship: { x: ship.x, y: ship.y } };
    recompute();
  });
  $("snap-clear").addEventListener("click", () => { snapshot = null; recompute(); });

  function placeAt(pt) {
    const res = createEntity(custom, lib, pt.x, pt.y, cfg);
    if (res.error) { cz.setNotice("Can't place: " + res.error); return; }
    scene.push(res.entity, ...(res.extra || []));
    ui.selectedId = res.entity.id;
    if (res.entity.pathType && res.entity.path && !res.entity.path.confirmed) {
      ui.mobileArmed = true;
      ui.pendingMobileId = res.entity.id;
      cz.setNotice("Click again on the map to set this ship's direction.");
    } else {
      cz.setNotice("");
    }
    recompute();
  }
  function setDirection(id, headingDeg) {
    const e = scene.find((x) => x.id === id);
    if (!e || !e.path) return;
    finalizeMobilePath(e.pathType, e.path, headingDeg);
    e.path.t0 = simTime;
    cz.setNotice("");
    ensureLoop();
    recompute();
  }
  function deleteEntity(e) {
    removeEntity(scene, e.id);
    // a creature's sub-emitters have no existence of their own outside their seed (§7.4) —
    // deleting the one visible contact must remove the whole swarm, not leave it silently
    // contributing to the readout forever.
    if (e.isCreature) {
      for (const s of scene.filter((x) => x.creatureId === e.id)) removeEntity(scene, s.id);
    }
    if (ui.selectedId === e.id) ui.selectedId = null;
    if (scan && scan.id === e.id) scan = null;
    if (ui.pendingMobileId === e.id) { ui.mobileArmed = false; ui.pendingMobileId = null; cz.setNotice(""); }
    recompute();
  }

  fieldApi = createField($("field"), {
    ship, scene, env, ui, onChange: recompute, onPlace: placeAt, onDelete: deleteEntity,
    onSetDirection: setDirection, onDrag: liveUpdate,
  });

  recompute();
  ensureLoop();
})();
