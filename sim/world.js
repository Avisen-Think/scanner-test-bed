// world.js — owns the scene's entities and builds new ones from library data per the
// customization params (design §9). Pure data layer: no DOM, no canvas. Entities it emits
// match the schema physics.accumulate expects (ships/structures/organics carry a resolved
// `contour`; rocks carry `substrate`/`resource`/`grade`; `size` scales all uniformly).
import { finalizeMobilePath, estimatePeriod, PATH_TYPES } from "./paths.js";
import { buildCreatureGroup } from "./creatures.js";

let counter = 0;
const uid = (type) => `${type}_${++counter}`;

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// rocks size within ship-size extremes (§6.2); grade 0.25–1.2 (§6.2)
export const ROCK_SIZE_MIN = 22, ROCK_SIZE_MAX = 92;
export const GRADE_MIN = 0.25, GRADE_MAX = 1.2;

// bucket ships into S/M/L by terciles of the library's actual size distribution
export function sizeBuckets(ships) {
  const sizes = ships.map((s) => s.size).sort((a, b) => a - b);
  const q = (f) => sizes[Math.floor(f * (sizes.length - 1))];
  const loCut = q(1 / 3), hiCut = q(2 / 3);
  const bucket = (sz) => (sz <= loCut ? "S" : sz >= hiCut ? "L" : "M");
  return { loCut, hiCut, bucket };
}
export function shipsInBucket(ships, size /* any|S|M|L */) {
  if (size === "any") return ships;
  const { bucket } = sizeBuckets(ships);
  return ships.filter((s) => bucket(s.size) === size);
}

function shipLike(entry, type, x, y, size) {
  return {
    id: uid(type), type, displayName: entry.name,
    contour: entry.contour, size: size ?? entry.size,
    emissive: entry.emissive || null, x, y, enabled: true, sigId: entry.id,
  };
}

function rockEntity(sub, res, grade, size, x, y) {
  const name = `${sub.name}${res ? " + " + res.name : " (barren)"} g${grade.toFixed(2)}`;
  return {
    id: uid("rock"), type: "rock", displayName: name,
    substrate: sub.contour, resource: res ? res.contour : null, grade: res ? grade : 0,
    size, emissive: null, x, y, enabled: true,
    sigId: sub.id + (res ? "+" + res.id : ""),
  };
}

// Build one entity from the current customization params at (x,y).
// Returns { entity }, { entity, extra } (creatures: extra sub-emitters), or { error: "<rule notice>" }.
export function createEntity(custom, lib, x, y, cfg) {
  if (x < 0 || x > 100 || y < 0 || y > 100) return { error: "placement outside the 100×100 field" };
  const c = custom;
  if (c.type === "ship" || c.type === "structure") {
    const pool = c.type === "ship" ? lib.ships : lib.structures;
    let entry;
    if (c.type === "ship") {
      const filtered = shipsInBucket(pool, c.shipSize);
      if (c.shipId !== "random") entry = pool.find((s) => s.id === c.shipId);
      if (!entry) entry = pick(filtered.length ? filtered : pool);
    } else {
      entry = c.structId !== "random" ? pool.find((s) => s.id === c.structId) : pick(pool);
    }
    const entity = shipLike(entry, c.type, x, y);
    if (c.type === "ship" && c.shipMobile && c.shipPathType) {
      entity.pathType = c.shipPathType;
      entity.path = { origin: { x, y }, headingDeg: 0, extent: c.shipExtent, phase0: 0, confirmed: false };
    }
    return { entity };
  }
  if (c.type === "rock") {
    const r = c.rock;
    const sub = r.substrate !== "random" ? lib.substrates.find((s) => s.id === r.substrate) : pick(lib.substrates);
    let res = null;
    if (r.resource === "none") res = null;
    else if (r.resource === "random") res = Math.random() < 0.15 ? null : pick(lib.resources); // 15% barren (§6.2)
    else res = lib.resources.find((s) => s.id === r.resource) || null;
    const size = r.sizeRandom ? Math.round(rnd(ROCK_SIZE_MIN, ROCK_SIZE_MAX)) : r.size;
    const grade = r.gradeRandom ? +rnd(GRADE_MIN, GRADE_MAX).toFixed(2) : r.grade;
    return { entity: rockEntity(sub, res, grade, size, x, y) };
  }
  if (c.type === "organic") {
    const o = c.organic;
    const size = o.sizeRandom ? Math.round(rnd(40, 92)) : o.size;
    if (o.isCreature) {
      const state = o.creatureId !== "random" ? lib.creatureStates.find((s) => s.id === o.creatureId) : pick(lib.creatureStates);
      const { seed, subEmitters } = buildCreatureGroup(state, lib.creatureFootprint, x, y, size, cfg.creatures.spreadKm);
      return { entity: seed, extra: subEmitters };
    }
    const entry = o.id !== "random" ? lib.organicsStatic.find((s) => s.id === o.id) : pick(lib.organicsStatic);
    return { entity: shipLike(entry, "organic", x, y, size) };
  }
  return { error: "unknown type" };
}

// ── Phase 4: random generation + clusters (design §11) ──────────────────────────
// Pure data: hands back an array of entities in the same schema createEntity emits. `rand`
// is threaded (default Math.random) so a seeded RNG makes a whole scene reproducible — which
// is what lets selfcheck assert exact spacing/count/cluster invariants.
const SPACING = 0.5;         // km: signal–signal and signal–border floor
const CLUSTER_MIN = 0.1;     // km: relaxed floor between cluster members (fallback)
const NEAR_LO = 0.2, NEAR_HI = 0.8; // km: cluster member offset from its seed

const clampField = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);
const gpick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
const gRound = (rand, a, b) => Math.round(a + rand() * (b - a));

// draw n distinct entries from arr (a random palette) using the threaded rand — the
// confounder-density dial (HANDOFF §3a-i): capping the pool makes a given substrate/resource
// combo recur across the field instead of appearing once per unique roll.
function pickN(rand, arr, n) {
  const pool = arr.slice();
  const out = [];
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i++) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

function tooClose(x, y, others, min) {
  for (const e of others) if (Math.hypot(e.x - x, e.y - y) < min) return true;
  return false;
}

// a scattered position ≥ SPACING from every placed signal and the border; null if it can't find one
function scatterPos(rand, placed, tries = 40) {
  const lo = SPACING, hi = 100 - SPACING;
  for (let t = 0; t < tries; t++) {
    const x = lo + rand() * (hi - lo), y = lo + rand() * (hi - lo);
    if (!tooClose(x, y, placed, SPACING)) return { x, y };
  }
  return null;
}

// a cluster-member position NEAR_LO–NEAR_HI km from the seed. Primary: also ≥ SPACING from every
// other signal and inside the border. Fallback (design §11): after 3 primary tries, relax — allow
// crossing the border and enforce only the 0.1 km inter-member floor. Null if even that fails.
function clusterPos(rand, seed, placed, members) {
  const off = () => {
    const a = rand() * Math.PI * 2, r = NEAR_LO + rand() * (NEAR_HI - NEAR_LO);
    return { x: seed.x + Math.cos(a) * r, y: seed.y + Math.sin(a) * r };
  };
  for (let t = 0; t < 3; t++) {
    const { x, y } = off();
    if (x < SPACING || x > 100 - SPACING || y < SPACING || y > 100 - SPACING) continue;
    if (tooClose(x, y, placed, SPACING)) continue;
    return { x, y };
  }
  for (let t = 0; t < 3; t++) {
    const p = off();
    const x = clampField(p.x), y = clampField(p.y);
    if (tooClose(x, y, members, CLUSTER_MIN)) continue;
    return { x, y };
  }
  return null;
}

// Generate a full scene. opts: { ships, rocks, organics, shipClusters, rockClusters }.
// Counts are TOTALS (cluster members are drawn from the count, not added on top).
export function generateScene(lib, opts = {}, rand = Math.random) {
  const {
    ships = 20, rocks = 40, organics = 8, creatures = 0, shipClusters = true, rockClusters = true,
    varietyCap = false, substrateVariety = 3, resourceVariety = 3,
    mobileEnabled = true, mobileRatio = 0.3, mobileSpeed = 0.5,
    mobileExtents = { line: [1, 3], circle: [0.5, 2], fig8: [1, 3] },
    creatureSpreadKm = 0.4, creatureSizeRange = [40, 92],
    shipFindMode = false, resourceFindMode = false,
  } = opts;
  const out = [];

  // attach a random, immediately-confirmed path to a freshly placed ship SEED (design §7.2:
  // "30% of ships"; generation has no second click, so heading is rolled too). Cluster
  // followers never get their own path — they ride the seed's via followsId (below).
  function maybeMakeMobile(ship) {
    if (!mobileEnabled || rand() >= mobileRatio) return;
    const pathType = gpick(rand, PATH_TYPES);
    const [lo, hi] = mobileExtents[pathType];
    const extent = lo + rand() * (hi - lo);
    const headingDeg = rand() * 360;
    const phase0 = rand() * estimatePeriod(pathType, extent, mobileSpeed);
    ship.pathType = pathType;
    ship.path = finalizeMobilePath(pathType, { origin: { x: ship.x, y: ship.y }, extent, phase0, t0: 0 }, headingDeg);
  }

  // optional palette cap: restrict this scene's rocks to a random subset of substrates/resources
  // (HANDOFF §3a-i). Off by default (full pool, current behaviour unchanged).
  const substratePool = varietyCap ? pickN(rand, lib.substrates, substrateVariety) : lib.substrates;
  const resourcePool = varietyCap ? pickN(rand, lib.resources, resourceVariety) : lib.resources;

  // ── Game modes (design §10) ──────────────────────────────────────────────────────────────
  // Ship-find: exactly ONE contact of the chosen hull may exist in the whole scene, so every
  // other random ship pick (seed AND same-lobe cluster family) must draw from a pool that
  // excludes it — otherwise a coincidental duplicate could spawn and the "exactly one" promise
  // (design §10) would be a lie. Resource-find: the target resource is drawn from resourcePool
  // (the post-variety-cap pool, not the raw library) — the "check" that it's actually a resource
  // this scene's rocks can carry, so a capped palette can never nominate an absent target.
  const shipTarget = shipFindMode ? gpick(rand, lib.ships) : null;
  const shipPool = shipTarget ? lib.ships.filter((s) => s.id !== shipTarget.id) : lib.ships;
  const resourceTarget = resourceFindMode ? gpick(rand, resourcePool) : null;

  // ships: seeds + same-lobe in-family clusters (cap 20% of ships clustered, +1–3 at 0.2–0.8 km)
  // shipFindMode reserves one slot for the lone target hull (below) — the scatter/cluster loop
  // below only ever fills ships-1 of those, drawing from shipPool so it can never duplicate it.
  {
    const scatterShips = shipTarget ? Math.max(0, ships - 1) : ships;
    let placed = 0, budget = Math.floor(scatterShips * 0.20);
    while (placed < scatterShips) {
      const pos = scatterPos(rand, out);
      if (!pos) break;
      const entry = gpick(rand, shipPool);
      const seed = shipLike(entry, "ship", pos.x, pos.y);
      maybeMakeMobile(seed);
      out.push(seed); placed++;
      if (shipClusters && budget > 0 && placed < scatterShips && rand() < 0.10) {
        const n = Math.min(1 + Math.floor(rand() * 3), scatterShips - placed, budget);
        const family = shipPool.filter((s) => s.lobe === entry.lobe);
        const members = [seed];
        for (let m = 0; m < n; m++) {
          const cp = clusterPos(rand, seed, out, members);
          if (!cp) break;
          const mem = shipLike(gpick(rand, family), "ship", cp.x, cp.y);
          if (seed.pathType) {
            mem.followsId = seed.id;
            mem.followOffset = { dx: mem.x - seed.x, dy: mem.y - seed.y };
          }
          out.push(mem); members.push(mem); placed++; budget--;
        }
      }
    }
    // the lone target hull (§10): a plain scattered contact, never clustered, so it can't be
    // mistaken for one of several — "exactly one" holds by construction, not by luck.
    if (shipTarget) {
      const pos = scatterPos(rand, out);
      if (pos) {
        const seed = shipLike(shipTarget, "ship", pos.x, pos.y);
        maybeMakeMobile(seed);
        out.push(seed);
      }
    }
  }

  // rocks: seeds + same substrate/resource clusters (cap 50%, +1–4 at 0.2–0.8 km, 60–100% seed size)
  // resourceFindMode forces the target resource onto seeds until at least 20% of all placed
  // rocks (seed + cluster members, since members inherit the seed's resource) carry it — a
  // floor, not a cap, so a coincidental extra hit from the normal random draw is fine.
  {
    // resourceFindMode needs at least one rock to carry the target — bump a 0 slider up to 1
    // rather than silently generating a mode with nothing to find (mirrors the ship-find bump).
    const scatterRocks = resourceTarget ? Math.max(1, rocks) : rocks;
    const findQuota = resourceTarget ? Math.max(1, Math.ceil(scatterRocks * 0.20)) : 0;
    let findHits = 0;
    let placed = 0, budget = Math.floor(scatterRocks * 0.50);
    while (placed < scatterRocks) {
      const pos = scatterPos(rand, out);
      if (!pos) break;
      const sub = gpick(rand, substratePool);
      const forceTarget = resourceTarget && findHits < findQuota;
      const res = forceTarget ? resourceTarget : (rand() < 0.15 ? null : gpick(rand, resourcePool)); // 15% barren (§6.2)
      const grade = +(GRADE_MIN + rand() * (GRADE_MAX - GRADE_MIN)).toFixed(2);
      const size = gRound(rand, ROCK_SIZE_MIN, ROCK_SIZE_MAX);
      out.push(rockEntity(sub, res, grade, size, pos.x, pos.y)); placed++;
      let hits = res === resourceTarget ? 1 : 0;
      const seed = out[out.length - 1];
      if (rockClusters && budget > 0 && placed < scatterRocks && rand() < 0.30) {
        const n = Math.min(1 + Math.floor(rand() * 4), scatterRocks - placed, budget);
        const members = [seed];
        for (let m = 0; m < n; m++) {
          const cp = clusterPos(rand, seed, out, members);
          if (!cp) break;
          const memSize = Math.round(size * (0.6 + rand() * 0.4)); // 60–100% strength
          out.push(rockEntity(sub, res, grade, memSize, cp.x, cp.y));
          members.push(out[out.length - 1]); placed++; budget--;
          if (res === resourceTarget) hits++;
        }
      }
      findHits += hits;
    }
  }

  // organics: plain scatter (no cluster rule in §11)
  for (let i = 0; i < organics; i++) {
    const pos = scatterPos(rand, out);
    if (!pos) break;
    const entry = gpick(rand, lib.organicsStatic);
    out.push(shipLike(entry, "organic", pos.x, pos.y, gRound(rand, 40, 92)));
  }

  // creatures: plain scatter, no cluster rule — a creature's sub-emitters are its own internal
  // bound cluster (§7.4), not a scatter-level one on top of that.
  for (let i = 0; i < creatures; i++) {
    const pos = scatterPos(rand, out);
    if (!pos) break;
    const state = gpick(rand, lib.creatureStates);
    const size = gRound(rand, creatureSizeRange[0], creatureSizeRange[1]);
    const { seed, subEmitters } = buildCreatureGroup(state, lib.creatureFootprint, pos.x, pos.y, size, creatureSpreadKm, rand);
    out.push(seed, ...subEmitters);
  }

  // expose the drawn palette (HANDOFF §3a-i) so callers can display or save which strata/
  // resources this scene's rocks were capped to — the confounder-recurrence payoff only
  // works if you can actually see what got capped to. null when the cap is off (full pool).
  out.palette = varietyCap
    ? {
        substrates: substratePool.map((s) => ({ id: s.id, name: s.name })),
        resources: resourcePool.map((r) => ({ id: r.id, name: r.name })),
      }
    : null;

  // this Generate's active hunt targets (design §10), so the caller can drive a hit counter —
  // null when a mode is off. shipTarget/resourceTarget are library entries; expose only the
  // id/name a UI or scan-match check needs.
  out.mode = {
    ship: shipTarget ? { id: shipTarget.id, name: shipTarget.name } : null,
    resource: resourceTarget ? { id: resourceTarget.id, name: resourceTarget.name } : null,
  };

  return out;
}

export function removeEntity(scene, id) {
  const i = scene.findIndex((e) => e.id === id);
  if (i >= 0) scene.splice(i, 1);
  return i >= 0;
}
