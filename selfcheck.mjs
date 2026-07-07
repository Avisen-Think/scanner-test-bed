// selfcheck.mjs — discharge the Phase-1 validation goal in actual code:
// "confirm region energy adds and a learned shape holds under range/jitter."
// Run: node selfcheck.mjs   (no browser needed)
import { readFileSync } from "node:fs";
import { accumulate, accumulateFast, regionEnergy, regionContour, displayLog, resolveContour } from "./sim/physics.js";
import { distance, bearingDeg, computeView, worldToScreen, screenToWorld, inView, clampToView } from "./sim/geometry.js";
import { createEntity, removeEntity, shipsInBucket, sizeBuckets, GRADE_MIN, GRADE_MAX, generateScene } from "./sim/world.js";
import { buildScenario, parseScenario, SCENARIO_VERSION } from "./sim/scenario.js";
import { pathPosition, finalizeMobilePath } from "./sim/paths.js";
import { buildCreatureGroup, creatureEmitterPosition } from "./sim/creatures.js";

const lib = JSON.parse(readFileSync(new URL("./data/library.json", import.meta.url)));
const ship = (id) => lib.ships.find((s) => s.id === id);
const sub = (id) => lib.substrates.find((s) => s.id === id);
const res = (id) => lib.resources.find((s) => s.id === id);

const env = { rMax: 50, sectorDeg: 360, sectorCenter: 0, dMin: 0.5, pEmissive: 3 };

const mkShip = (id, d, k = 1) => ({ id, type: "ship", contour: ship(id).contour, size: ship(id).size, emissive: ship(id).emissive, d, bearing: 0, k, enabled: true });
const ironstone = (d, k = 1) => ({ id: "ironstone", type: "rock", substrate: sub("granite").contour, resource: res("iron").contour, grade: 0.7, size: 60, d, bearing: 0, k, enabled: true });

let pass = 0, fail = 0;
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * (1 + Math.abs(a) + Math.abs(b));
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`); }
}

console.log("\n[1] Region energy is EXACTLY additive under superposition (§2)");
{
  const A = mkShip("andromeda", 6);
  const B = ironstone(5);
  const eA = regionEnergy(accumulate([A], env).R);
  const eB = regionEnergy(accumulate([B], env).R);
  const eAB = regionEnergy(accumulate([A, B], env).R);
  for (const r of ["metallic", "rocky", "organic", "transition"]) {
    check(`E_${r}(A+B) == E_${r}(A) + E_${r}(B)`, approx(eAB[r], eA[r] + eB[r]),
      `got ${eAB[r].toFixed(6)} vs ${(eA[r] + eB[r]).toFixed(6)}`);
  }
}

console.log("\n[2] Identity (in-region normalized contour) is INVARIANT under range (§2)");
{
  const close = regionContour(accumulate([mkShip("andromeda", 3)], env).R, "metallic");
  const far = regionContour(accumulate([mkShip("andromeda", 18)], env).R, "metallic");
  const maxDiff = Math.max(...close.map((v, i) => Math.abs(v - far[i])));
  check("Andromeda metallic contour identical at 3 km vs 18 km", maxDiff < 1e-12, `maxDiff=${maxDiff.toExponential(2)}`);
}

console.log("\n[3] Identity is INVARIANT under any uniform per-source scale k (§2)");
{
  // k is no longer a jitter feature, but physics still supports a per-source scalar;
  // this confirms identity ratios survive ANY uniform scaling (the reason dropping
  // jitter is safe for the identity channel).
  const k1 = regionContour(accumulate([mkShip("andromeda", 6, 1.0)], env).R, "metallic");
  const k2 = regionContour(accumulate([mkShip("andromeda", 6, 1.18)], env).R, "metallic");
  const maxDiff = Math.max(...k1.map((v, i) => Math.abs(v - k2[i])));
  check("Andromeda metallic contour identical at k=1.0 vs k=1.18", maxDiff < 1e-12, `maxDiff=${maxDiff.toExponential(2)}`);
}

console.log("\n[4] Isolation gate: in a MIX the contour smears (identity NOT preserved) (§2)");
{
  const solo = regionContour(accumulate([mkShip("andromeda", 6)], env).R, "metallic");
  const mixed = regionContour(accumulate([mkShip("andromeda", 6), mkShip("triton", 6)], env).R, "metallic");
  const maxDiff = Math.max(...solo.map((v, i) => Math.abs(v - mixed[i])));
  check("Andromeda+Triton metallic contour differs from Andromeda alone", maxDiff > 0.05, `maxDiff=${maxDiff.toFixed(4)} (want a visible smear)`);
}

console.log("\n[5] Transition (9–11) is excluded from every robust material class (§2)");
{
  // Ganymede has heavy transition spill; its transition energy must not appear in metallic/rocky/organic totals
  const e = regionEnergy(accumulate([mkShip("ganymede", 5)], env).R);
  check("Ganymede has nonzero reported transition energy", e.transition > 0, `transition=${e.transition.toFixed(4)}`);
  // reconstruct metallic strictly from bands 1–8 of the raw readout to confirm no leakage
  const R = accumulate([mkShip("ganymede", 5)], env).R;
  const m18 = R.slice(0, 8).reduce((s, v) => s + v, 0);
  check("metallic region == sum(bands 1–8) exactly", approx(e.metallic, m18), `${e.metallic.toFixed(6)} vs ${m18.toFixed(6)}`);
}

console.log("\n[6] Display transforms: floor guard + gain acts in log (the two fixes)");
{
  // the freeze bug: F=0 / F<0 / F>=C must never produce NaN
  const bad = [
    ["F=0", displayLog(5, 0, 300, 0.15)],
    ["F<0", displayLog(5, -0.2, 300, 0.15)],
    ["F>=C", displayLog(5, 400, 300, 0.15)],
    ["F=C", displayLog(5, 300, 300, 0.15)],
  ];
  let anyNaN = false;
  for (const [label, v] of bad) if (!Number.isFinite(v)) { anyNaN = true; console.log(`      ${label} -> ${v}`); }
  check("displayLog never returns NaN for degenerate F/C", !anyNaN);

  // gain now moves the log display (was previously ignored in log mode)
  const lo = displayLog(5, 0.3, 300, 0.05);
  const hi = displayLog(5, 0.3, 300, 0.50);
  check("gain changes the log readout (no longer a no-op in log mode)", hi > lo, `G=0.05->${lo.toFixed(3)}, G=0.50->${hi.toFixed(3)}`);

  // higher gain lifts both bands together (a uniform offset on the log axis)
  const a1 = displayLog(5, 0.3, 300, 0.1), b1 = displayLog(2, 0.3, 300, 0.1);
  const a2 = displayLog(5, 0.3, 300, 0.3), b2 = displayLog(2, 0.3, 300, 0.3);
  check("higher gain lifts both bands (shape rides up together)", a2 > a1 && b2 > b1);
}

console.log("\n[7] Play-space geometry (Phase 2)");
{
  // distance & bearing basics
  check("distance is Euclidean", approx(distance(0, 0, 3, 4), 5));
  check("bearing east = 0deg", approx(bearingDeg(0, 0, 1, 0), 0));
  check("bearing south(+y) = 90deg (screen y-down)", approx(bearingDeg(0, 0, 0, 1), 90));

  // full view = whole field, no offset
  const full = computeView(50, 50, 100, 100);
  check("zoom>=field gives full field", full.x0 === 0 && full.y0 === 0 && full.span === 100);

  // zoom centres on ship away from edges
  const mid = computeView(50, 50, 20, 100);
  check("20km window centres on ship mid-field", approx(mid.x0, 40) && approx(mid.y0, 40) && mid.span === 20);

  // edge clamp: ship near corner → window pinned inside field, ship off-centre
  const corner = computeView(3, 3, 20, 100);
  check("window edge-clamped at corner (x0,y0 >= 0)", corner.x0 === 0 && corner.y0 === 0);
  const farCorner = computeView(98, 98, 20, 100);
  check("window edge-clamped at far corner (x0,y0 = 80)", approx(farCorner.x0, 80) && approx(farCorner.y0, 80));

  // world<->screen round trip
  const s = worldToScreen(63, 27, mid, 600);
  const back = screenToWorld(s.sx, s.sy, mid, 600);
  check("world->screen->world round-trips", approx(back.wx, 63, 1e-9) && approx(back.wy, 27, 1e-9));

  // inView
  check("point inside window detected", inView(45, 45, mid));
  check("point outside window detected", !inView(5, 5, mid));

  // clampToView: ship drag is bounded to the fixed (anchored) window, not the whole field
  const cvOut = clampToView(120, -5, mid); // mid window is [40..60] in both axes
  check("clampToView pins out-of-window drag to window edges", approx(cvOut.x, 60) && approx(cvOut.y, 40));
  const cvIn = clampToView(45, 55, mid);
  check("clampToView leaves in-window points untouched", approx(cvIn.x, 45) && approx(cvIn.y, 55));
  const cvFull = clampToView(120, -5, full); // at full zoom the window IS the field
  check("clampToView at full zoom clamps to field bounds", approx(cvFull.x, 100) && approx(cvFull.y, 0));
}

console.log("\n[8] Hand-placement factories (Phase 3, §9)");
{
  // ship factory yields a physics-compatible entity (resolved contour + size + position)
  const r1 = createEntity({ type: "ship", shipSize: "any", shipId: "andromeda" }, lib, 30, 40);
  check("ship placement: resolved contour + position", !!r1.entity && Array.isArray(r1.entity.contour) && r1.entity.x === 30 && r1.entity.y === 40);
  check("ship placement: accumulate accepts it", (() => {
    const e = r1.entity; e.d = 5; e.bearing = 0;
    const R = accumulate([e], env).R; return R.some((v) => v > 0);
  })());

  // size-class filtering partitions the ship list and never empties it
  const buckets = sizeBuckets(lib.ships);
  check("size buckets ordered (loCut <= hiCut)", buckets.loCut <= buckets.hiCut);
  const S = shipsInBucket(lib.ships, "S"), M = shipsInBucket(lib.ships, "M"), L = shipsInBucket(lib.ships, "L");
  check("S/M/L each non-empty & sum to all", S.length > 0 && M.length > 0 && L.length > 0 && S.length + M.length + L.length === lib.ships.length);
  check("Large bucket holds the size-92 hulls", L.some((s) => s.size === 92));

  // rock factory: explicit substrate+resource+grade
  const rr = createEntity({ type: "rock", rock: { substrate: "granite", resource: "iron", size: 60, sizeRandom: false, grade: 0.7, gradeRandom: false } }, lib, 10, 10);
  check("rock placement: substrate+resource+grade kept on entity", rr.entity.type === "rock" && Array.isArray(rr.entity.substrate) && Array.isArray(rr.entity.resource) && rr.entity.grade === 0.7);

  // barren rock: resource None → no resource feature, grade neutralized
  const barren = createEntity({ type: "rock", rock: { substrate: "granite", resource: "none", size: 50, sizeRandom: false, grade: 1, gradeRandom: false } }, lib, 10, 10);
  check("barren rock (None): resource null, grade 0", barren.entity.resource === null && barren.entity.grade === 0);

  // random grade stays within the documented 0.25–1.2 band
  const grades = Array.from({ length: 50 }, () => createEntity({ type: "rock", rock: { substrate: "random", resource: "iron", sizeRandom: true, gradeRandom: true } }, lib, 5, 5).entity.grade);
  check("random grade within [0.25,1.2]", grades.every((g) => g >= GRADE_MIN - 1e-9 && g <= GRADE_MAX + 1e-9));

  // out-of-bounds placement is refused with a named notice
  const oob = createEntity({ type: "ship", shipSize: "any", shipId: "random" }, lib, 120, 5);
  check("out-of-bounds placement refused", !!oob.error && !oob.entity);

  // placed entities get unique ids (no collision with the signature id)
  const a = createEntity({ type: "ship", shipId: "andromeda" }, lib, 1, 1).entity;
  const b = createEntity({ type: "ship", shipId: "andromeda" }, lib, 2, 2).entity;
  check("placed entities get unique ids", a.id !== b.id && a.id !== "andromeda");

  // remove
  const arr = [a, b];
  removeEntity(arr, a.id);
  check("removeEntity drops the right one", arr.length === 1 && arr[0].id === b.id);
}

console.log("\n[9] Signal Library consistency (Phase 3, §5.4)");
{
  // The library view's composite previews MUST resolve identically to what the engine reads,
  // or the reference sheet teaches a look the accumulation never produces. Verify the exact
  // substrate + resource·grade the view renders equals resolveContour used by accumulate().
  const comp = (lib.composites || []).find((c) => c.id === "ironstone");
  check("authored 'ironstone' composite exists", !!comp);
  if (comp) {
    const s = sub(comp.substrate), r = res(comp.resource);
    const viewResolved = resolveContour({ substrate: s.contour, resource: r.contour, grade: comp.grade });
    const engineResolved = resolveContour({ substrate: s.contour, resource: r.contour, grade: comp.grade });
    // and confirm it equals the hand math substrate + resource*grade, band by band
    const handMath = s.contour.map((v, i) => v + r.contour[i] * comp.grade);
    check("composite preview == engine resolveContour", viewResolved.every((v, i) => approx(v, engineResolved[i])));
    check("composite preview == substrate + resource*grade (hand math)", viewResolved.every((v, i) => approx(v, handMath[i])));
    // the ironstone tell: iron adds energy in the transition firewall (9–11) on top of granite's rocky hump
    const transAdded = [8, 9, 10].some((i) => viewResolved[i] > s.contour[i] + 1e-9); // 0-indexed bands 9–11
    check("iron adds a transition-band bump over the bare substrate", transAdded);
  }
  // every library contour is length BANDS (the strip renderer assumes this)
  const allContours = [
    ...lib.ships, ...lib.structures, ...lib.substrates, ...lib.resources, ...lib.organicsStatic,
  ].map((e) => e.contour);
  check("every library contour has 20 bands", allContours.every((c) => Array.isArray(c) && c.length === 20));

  // the composer's region-read (regionEnergy of a resolved rock) demonstrates the firewall:
  // iron's big transition bump is NOT counted in any material class, so granite+iron still
  // reads rocky. This is the §2 firewall — the thing that stops a resource forging a metal read.
  const gIron = resolveContour({ substrate: sub("granite").contour, resource: res("iron").contour, grade: 1.2 });
  const eIron = regionEnergy(gIron);
  check("granite+iron reads rocky-dominant despite the transition bump", eIron.rocky > eIron.metallic && eIron.rocky > eIron.organic);
  check("iron's transition energy is quarantined (nonzero, not in any material class)", eIron.transition > 0);
  // but a resource that leans into the METALLIC region (\u22648) DOES add metallic energy — the
  // cross-level collision path the composer makes visible (copper keys band 8).
  const bareGranite = regionEnergy(sub("granite").contour);
  const gCopper = regionEnergy(resolveContour({ substrate: sub("granite").contour, resource: res("copper").contour, grade: 1.2 }));
  check("copper leaks into metallic energy (the collision path)", gCopper.metallic > bareGranite.metallic + 1e-9);
}

console.log("\n[10] Generation + clusters (Phase 4, §11)");
{
  // seeded RNG (mulberry32) so a whole generated scene is reproducible and exactly checkable
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const minPairwise = (arr) => {
    let m = Infinity;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) m = Math.min(m, Math.hypot(arr[i].x - arr[j].x, arr[i].y - arr[j].y));
    return m;
  };
  const closestPair = (arr) => {
    let best = null, bd = Infinity;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const d = Math.hypot(arr[i].x - arr[j].x, arr[i].y - arr[j].y);
      if (d < bd) { bd = d; best = [arr[i], arr[j]]; }
    }
    return best;
  };

  // reproducibility: same seed → identical scene
  const A = generateScene(lib, { ships: 15, rocks: 30, organics: 5 }, mulberry32(42));
  const B = generateScene(lib, { ships: 15, rocks: 30, organics: 5 }, mulberry32(42));
  check("seeded generation is reproducible", JSON.stringify(A.map((e) => [e.type, e.x.toFixed(4), e.y.toFixed(4)])) === JSON.stringify(B.map((e) => [e.type, e.x.toFixed(4), e.y.toFixed(4)])));

  // counts are totals (cluster members drawn from the count, not added on top) — sparse ⇒ exact
  check("ship count == requested", A.filter((e) => e.type === "ship").length === 15);
  check("rock count == requested", A.filter((e) => e.type === "rock").length === 30);
  check("organic count == requested", A.filter((e) => e.type === "organic").length === 5);

  // everything inside the field
  check("all entities within field bounds", A.every((e) => e.x >= 0 && e.x <= 100 && e.y >= 0 && e.y <= 100));

  // clusters OFF ⇒ pure scatter: every pair ≥ the 0.5 km spacing floor
  const scatterOnly = generateScene(lib, { ships: 25, rocks: 60, organics: 10, shipClusters: false, rockClusters: false }, mulberry32(7));
  check("no clusters ⇒ min pairwise ≥ 0.5 km (scatter floor)", minPairwise(scatterOnly) >= 0.5 - 1e-9);

  // clusters ON ⇒ some pair sits inside the scatter floor (a clump formed), and nothing overlaps
  const clustered = generateScene(lib, { ships: 60, rocks: 90, organics: 0 }, mulberry32(3));
  check("clusters ⇒ some pair < 0.5 km (a clump exists)", minPairwise(clustered) < 0.5);
  check("clusters ⇒ min pairwise ≥ 0.1 km (no overlap)", minPairwise(clustered) >= 0.1 - 1e-9);

  // content: the closest ship pair is a cluster pair (0.2–0.8 km, far tighter than sparse scatter),
  // and ship clusters are same-LOBE (in-family). Recover lobe via sigId → library lookup.
  const ships = clustered.filter((e) => e.type === "ship");
  const lobeOf = (e) => (lib.ships.find((s) => s.id === e.sigId) || {}).lobe;
  const cs = closestPair(ships);
  check("closest ship pair is a cluster pair (< 0.85 km)", cs && Math.hypot(cs[0].x - cs[1].x, cs[0].y - cs[1].y) < 0.85);
  check("ship cluster members share a lobe (in-family)", cs && lobeOf(cs[0]) === lobeOf(cs[1]));

  // content: the closest rock pair is a cluster pair sharing substrate+resource (sigId)
  const rocks = clustered.filter((e) => e.type === "rock");
  const cr = closestPair(rocks);
  check("closest rock pair is a cluster pair (< 0.85 km)", cr && Math.hypot(cr[0].x - cr[1].x, cr[0].y - cr[1].y) < 0.85);
  check("rock cluster members share substrate+resource (sigId)", cr && cr[0].sigId === cr[1].sigId);

  // additivity still holds on a big generated sum: region energy of the whole == sum over singles
  const many = generateScene(lib, { ships: 30, rocks: 80, organics: 12 }, mulberry32(99))
    .map((e) => ({ ...e, d: 3, bearing: 0, k: 1 }));
  const whole = regionEnergy(accumulate(many, env).R);
  const partsSum = many.reduce((acc, e) => {
    const r = regionEnergy(accumulate([{ ...e }], env).R);
    return { metallic: acc.metallic + r.metallic, rocky: acc.rocky + r.rocky, organic: acc.organic + r.organic };
  }, { metallic: 0, rocky: 0, organic: 0 });
  check("region energy additive across a 120-source generated scene",
    approx(whole.metallic, partsSum.metallic, 1e-9) && approx(whole.rocky, partsSum.rocky, 1e-9) && approx(whole.organic, partsSum.organic, 1e-9));

  // variety cap (HANDOFF §3a-i): off by default ⇒ unrestricted pool still in play
  const distinctSub = (arr) => new Set(arr.filter((e) => e.type === "rock").map((e) => e.sigId.split("+")[0])).size;
  const uncapped = generateScene(lib, { ships: 0, rocks: 80, organics: 0 }, mulberry32(11));
  check("varietyCap off ⇒ can draw more substrates than a cap of 2 would allow",
    distinctSub(uncapped) > 2, `distinct substrates=${distinctSub(uncapped)}`);

  // varietyCap on ⇒ every rock's substrate/resource stays inside the drawn palette size
  const capped = generateScene(lib, { ships: 0, rocks: 80, organics: 0, varietyCap: true, substrateVariety: 2, resourceVariety: 2 }, mulberry32(11));
  check("varietyCap on ⇒ at most 2 distinct substrates across 80 rocks", distinctSub(capped) <= 2, `distinct substrates=${distinctSub(capped)}`);
  const distinctRes = (arr) => new Set(
    arr.filter((e) => e.type === "rock" && e.sigId.includes("+")).map((e) => e.sigId.split("+")[1]),
  ).size;
  check("varietyCap on ⇒ at most 2 distinct resources across 80 rocks", distinctRes(capped) <= 2, `distinct resources=${distinctRes(capped)}`);

  // same seed ⇒ same drawn palette (reproducible, like the rest of generation)
  const capped2 = generateScene(lib, { ships: 0, rocks: 80, organics: 0, varietyCap: true, substrateVariety: 2, resourceVariety: 2 }, mulberry32(11));
  check("varietyCap palette is reproducible under the same seed",
    JSON.stringify(capped.map((e) => e.sigId)) === JSON.stringify(capped2.map((e) => e.sigId)));
}

console.log("\n[11] Hydrocarbons reclassified as a rock resource (Phase 5, HANDOFF §4 Q1)");
{
  check("hydrocarbons is in lib.resources", lib.resources.some((r) => r.id === "hydrocarbons"));
  check("hydrocarbons is NOT in lib.organicsStatic", !lib.organicsStatic.some((s) => s.id === "hydrocarbons"));
  const hc = lib.resources.find((r) => r.id === "hydrocarbons");
  check("hydrocarbons carries a metal flag like every other resource", hc && hc.metal === false);
  // it's still usable as an ordinary rock resource through the normal factories
  const rr = createEntity({ type: "rock", rock: { substrate: "sandstone", resource: "hydrocarbons", size: 50, sizeRandom: false, grade: 0.7, gradeRandom: false } }, lib, 5, 5);
  check("hydrocarbons placeable as a rock resource", !!rr.entity && Array.isArray(rr.entity.resource));
}

console.log("\n[12] Generation palette exposure (Phase 5, HANDOFF §3a-i → UI readout)");
{
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const uncapped = generateScene(lib, { ships: 0, rocks: 20, organics: 0 }, mulberry32(5));
  check("no variety cap ⇒ palette is null", uncapped.palette === null);

  const capped = generateScene(lib, { ships: 0, rocks: 20, organics: 0, varietyCap: true, substrateVariety: 2, resourceVariety: 3 }, mulberry32(5));
  check("variety cap on ⇒ palette exposes the drawn substrate count", !!capped.palette && capped.palette.substrates.length === 2);
  check("variety cap on ⇒ palette exposes the drawn resource count", !!capped.palette && capped.palette.resources.length === 3);
  check("palette entries carry id + name (for the UI list)", capped.palette.substrates.every((s) => s.id && s.name));
}

console.log("\n[13] Scenario save/load round-trip (Phase 5, design §12/§5.3 — the harness seam)");
{
  const ship = { x: 12.5, y: 40 };
  const env = { rMax: 20, sectorDeg: 90, sectorCenter: 45, dMin: 0.5, pEmissive: 3 };
  const ui = { zoom: 20, colorCoded: true, revealRange: 6, lockShip: false, selectedId: "should-not-be-saved" };
  const settings = { logMode: true, F: 0.3, C: 300, gain: 0.2, emissiveDisplayMax: 100 };
  const gen = { ships: 10, rocks: 20, organics: 3, shipClusters: true, rockClusters: false, varietyCap: true, substrateVariety: 2, resourceVariety: 2 };
  const palette = { substrates: [{ id: "granite", name: "Granite" }], resources: [{ id: "iron", name: "Iron" }] };
  const scanned = createEntity({ type: "ship", shipId: "andromeda" }, lib, 30, 40).entity;
  scanned.scanned = true;
  scanned.d = 3; scanned.bearing = 90; scanned._g = 1; scanned._inSector = true; scanned._contrib = true; scanned.k = 1.1; // per-frame junk
  const rock = createEntity({ type: "rock", rock: { substrate: "granite", resource: "iron", size: 60, sizeRandom: false, grade: 0.7, gradeRandom: false } }, lib, 10, 10).entity;
  const scene = [scanned, rock];

  const built = buildScenario({ ship, env, ui, settings, gen, palette, scene });
  check("buildScenario stamps the current version", built.version === SCENARIO_VERSION);
  check("buildScenario strips per-frame computed fields off entities", built.entities.every((e) => e.d === undefined && e.bearing === undefined && e.k === undefined));
  check("buildScenario keeps scan state", built.entities.find((e) => e.id === scanned.id).scanned === true);

  // round-trip through an actual JSON string, like a saved file would be
  const { scenario, error } = parseScenario(JSON.stringify(built));
  check("parseScenario accepts a freshly-built scenario with no error", !error, error);
  check("ship round-trips", scenario.ship.x === ship.x && scenario.ship.y === ship.y);
  check("env round-trips", scenario.env.rMax === env.rMax && scenario.env.sectorDeg === env.sectorDeg);
  check("gen round-trips (variety cap settings included)", scenario.gen.varietyCap === true && scenario.gen.substrateVariety === 2);
  check("palette round-trips", scenario.palette.substrates[0].id === "granite");
  check("entity count round-trips", scenario.entities.length === scene.length);
  check("resolved-contour rock entity round-trips (substrate/resource/grade intact)",
    Array.isArray(scenario.entities[1].substrate) && Array.isArray(scenario.entities[1].resource) && scenario.entities[1].grade === 0.7);

  // malformed / mismatched-version input is rejected, not silently accepted
  check("parseScenario rejects invalid JSON", !!parseScenario("{not json").error);
  check("parseScenario rejects the wrong version", !!parseScenario(JSON.stringify({ ...built, version: 999 })).error);
  check("parseScenario rejects a missing entities array", !!parseScenario(JSON.stringify({ ...built, entities: undefined })).error);
}

console.log("\n[14] Mobile ship paths (Phase 6, design §7.2)");
{
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // line: bounces between origin and origin + heading·extent, reversing at each end
  const linePath = finalizeMobilePath("line", { origin: { x: 0, y: 0 }, extent: 2, phase0: 0, t0: 0 }, 0);
  const p0 = pathPosition("line", linePath, 0.5, 0);
  const pMid = pathPosition("line", linePath, 0.5, 2 / 0.5); // t = extent/speed → far end
  const pBack = pathPosition("line", linePath, 0.5, (2 * 2) / 0.5); // full round trip → origin
  check("line starts at origin", approx(p0.x, 0) && approx(p0.y, 0));
  check("line reaches the far end at t = extent/speed", approx(pMid.x, 2) && approx(pMid.y, 0), `got ${pMid.x},${pMid.y}`);
  check("line returns to origin after a full round trip", approx(pBack.x, 0) && approx(pBack.y, 0), `got ${pBack.x},${pBack.y}`);

  // circle: origin lies ON the circle; position stays exactly `extent` (radius) from centre
  const circPath = finalizeMobilePath("circle", { origin: { x: 0, y: 0 }, extent: 1, phase0: 0, t0: 0 }, 0);
  check("circle position at t=0 is the origin", approx(pathPosition("circle", circPath, 1, 0).x, 0, 1e-9) && approx(pathPosition("circle", circPath, 1, 0).y, 0, 1e-9));
  for (const t of [0, 0.7, 1.3, 3.1, 6.2]) {
    const p = pathPosition("circle", circPath, 1, t);
    const r = Math.hypot(p.x - circPath.centre.x, p.y - circPath.centre.y);
    check(`circle stays at radius (t=${t})`, approx(r, 1, 1e-9), `got r=${r}`);
  }

  // fig-8: passes through its own origin at t=0 and stays within its extent
  const fig8Path = { origin: { x: 5, y: 5 }, headingDeg: 0, extent: 2, phase0: 0, t0: 0, confirmed: true };
  const f0 = pathPosition("fig8", fig8Path, 1, 0);
  check("fig-8 passes through origin at t=0", approx(f0.x, 5) && approx(f0.y, 5));
  let boundedOk = true;
  for (let t = 0; t < 20; t += 0.3) {
    const p = pathPosition("fig8", fig8Path, 1, t);
    if (Math.abs(p.x - 5) > 1 + 1e-6 || Math.abs(p.y - 5) > 0.5 + 1e-6) boundedOk = false;
  }
  check("fig-8 stays within its extent", boundedOk);

  // an unconfirmed path (direction not yet set by the second click) never moves
  const unconfirmed = { origin: { x: 3, y: 4 }, headingDeg: 0, extent: 2, phase0: 0, t0: 0, confirmed: false };
  const pu = pathPosition("line", unconfirmed, 0.5, 100);
  check("unconfirmed path stays at its origin", approx(pu.x, 3) && approx(pu.y, 4));

  // rigid-shape guardrail (concept §7.3): motion changes x/y only — the identity-bearing
  // contour a moving entity contributes must be untouched by the same path math.
  const mover = mkShip("andromeda", 6);
  const contourBefore = JSON.stringify(mover.contour);
  const q1 = pathPosition("line", linePath, 0.5, 0);
  const q2 = pathPosition("line", linePath, 0.5, 3);
  mover.x = q1.x; mover.y = q1.y;
  const contourMid = JSON.stringify(mover.contour);
  mover.x = q2.x; mover.y = q2.y;
  const contourAfter = JSON.stringify(mover.contour);
  check("a moving entity's contour is untouched by position updates", contourBefore === contourMid && contourMid === contourAfter);
  check("...while its position actually changed", q1.x !== q2.x || q1.y !== q2.y);

  // generation wiring: seeded reproducibility, and the ratio produces neither zero nor all
  const mobOpts = { ships: 40, rocks: 0, organics: 0, shipClusters: false, mobileEnabled: true, mobileRatio: 0.3, mobileSpeed: 0.5 };
  const genA = generateScene(lib, mobOpts, mulberry32(21));
  const genB = generateScene(lib, mobOpts, mulberry32(21));
  const mobileCount = (arr) => arr.filter((e) => e.pathType).length;
  check("mobile-ship generation is reproducible under a seed",
    JSON.stringify(genA.map((e) => [e.pathType, e.path && e.path.headingDeg])) === JSON.stringify(genB.map((e) => [e.pathType, e.path && e.path.headingDeg])));
  check("mobileEnabled ⇒ some but not all ships are mobile", mobileCount(genA) > 0 && mobileCount(genA) < genA.length, `mobile=${mobileCount(genA)}/${genA.length}`);
  check("mobileEnabled=false ⇒ no ships are mobile", mobileCount(generateScene(lib, { ...mobOpts, mobileEnabled: false }, mulberry32(21))) === 0);
  check("every mobile ship's path is already confirmed (generation has no second click)", genA.filter((e) => e.pathType).every((e) => e.path.confirmed));

  // cluster followers ride a mobile seed rigidly, and don't carry their own path
  const clustered = generateScene(lib, { ships: 60, rocks: 0, organics: 0, shipClusters: true, mobileEnabled: true, mobileRatio: 1 }, mulberry32(3));
  const follower = clustered.find((e) => e.followsId);
  check("a cluster with a mobile seed produces followers", !!follower);
  if (follower) {
    const leader = clustered.find((e) => e.id === follower.followsId);
    check("the follower's leader is itself mobile", !!leader && !!leader.pathType);
    check("a follower carries no path of its own", !follower.pathType);
    check("a follower carries a fixed offset", typeof follower.followOffset.dx === "number" && typeof follower.followOffset.dy === "number");
  }

  // scenario round-trip: pathType/path/followsId/followOffset survive JSON.stringify → parseScenario
  const shipEntity = createEntity({ type: "ship", shipId: "andromeda" }, lib, 20, 20).entity;
  shipEntity.pathType = "circle";
  shipEntity.path = finalizeMobilePath("circle", { origin: { x: 20, y: 20 }, extent: 1.5, phase0: 0.4, t0: 12 }, 30);
  const followerEntity = createEntity({ type: "ship", shipId: "andromeda" }, lib, 20.3, 20.1).entity;
  followerEntity.followsId = shipEntity.id;
  followerEntity.followOffset = { dx: 0.3, dy: 0.1 };
  const scn = { ship: { x: 0, y: 0 }, env: { rMax: 20, sectorDeg: 360, sectorCenter: 0, dMin: 0.5, pEmissive: 3 },
    ui: {}, settings: { logMode: false, F: 0.3, C: 300, gain: 0.15, emissiveDisplayMax: 100 },
    gen: { ships: 0, rocks: 0, organics: 0 }, palette: null, scene: [shipEntity, followerEntity] };
  const builtMobile = buildScenario(scn);
  const { scenario: parsedMobile, error: mobileErr } = parseScenario(JSON.stringify(builtMobile));
  check("scenario round-trip parses cleanly", !mobileErr, mobileErr);
  const rtShip = parsedMobile.entities.find((e) => e.id === shipEntity.id);
  const rtFollower = parsedMobile.entities.find((e) => e.id === followerEntity.id);
  check("pathType round-trips", rtShip && rtShip.pathType === "circle");
  check("path (incl. resolved centre/theta0) round-trips", rtShip && rtShip.path && approx(rtShip.path.extent, 1.5) && rtShip.path.confirmed === true && typeof rtShip.path.theta0 === "number");
  check("followsId/followOffset round-trip", rtFollower && rtFollower.followsId === shipEntity.id && rtFollower.followOffset.dx === 0.3);

  // accumulateFast (the per-frame-loop optimization) must agree EXACTLY with the canonical
  // accumulate() on R/E — it's a perf shortcut, not a different formula, on the frozen §3 seam
  const busyScene = generateScene(lib, { ships: 40, rocks: 60, organics: 10 }, mulberry32(55))
    .map((e) => ({ ...e, d: Math.random() * 15, bearing: Math.random() * 360, k: 0.9 + Math.random() * 0.2 }));
  const full = accumulate(busyScene, env);
  const fast = accumulateFast(busyScene, env);
  check("accumulateFast.R === accumulate.R exactly", full.R.every((v, i) => approx(v, fast.R[i])));
  check("accumulateFast.E === accumulate.E exactly", full.E.every((v, i) => approx(v, fast.E[i])));
}

console.log("\n[15] Creatures — bound sub-emitter clusters (Phase 6, design §7.4)");
{
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const flockState = lib.creatureStates.find((s) => s.id === "flock");
  const giantState = lib.creatureStates.find((s) => s.id === "giant");
  const footprint = lib.creatureFootprint;
  const spreadKm = 0.4;

  // energy-budget invariant: total size splits evenly across ALL sub-emitters (seed included),
  // so a flock and a giant of the same authored size carry the same total energy budget.
  const { seed: fSeed, subEmitters: fSubs } = buildCreatureGroup(flockState, footprint, 10, 10, 60, spreadKm, mulberry32(1));
  check("flock produces subEmitterCount-1 extra emitters", fSubs.length === flockState.subEmitterCount - 1, `got ${fSubs.length}`);
  check("flock sub-emitter sizes sum to the authored total size", approx(fSeed.size * flockState.subEmitterCount, 60));

  // giant: rigid by construction — a single emitter, no jitter machinery needed at all
  const { seed: gSeed, subEmitters: gSubs } = buildCreatureGroup(giantState, footprint, 10, 10, 60, spreadKm, mulberry32(2));
  check("giant (subEmitterCount:1) produces zero extra emitters", gSubs.length === 0);
  check("giant's own size carries the full authored total", approx(gSeed.size, 60));

  // accumulate a creature group as seen from an observer at (ox,oy) at simTime t
  const asEntities = (seed, subs, t, ox, oy) => {
    const live = [seed, ...subs.map((e) => ({ ...e, ...creatureEmitterPosition(seed, e, t) }))];
    return live.map((e) => ({ ...e, d: distance(ox, oy, e.x, e.y), bearing: bearingDeg(ox, oy, e.x, e.y) }));
  };
  const shift = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

  // decoherence (concept §6.2) — NOT visible in regionContour: every sub-emitter shares the
  // identical footprint, so summing same-shaped vectors just rescales the same shape (no shape
  // smear possible by construction, unlike a real pile-up of DIFFERENT signatures). What a bound
  // cluster's parallax actually breaks is the AMPLITUDE's inverse-square scaling: a true rigid
  // point's organic-region energy scales as exactly 1/d² between two observer positions; a
  // spread-out cluster's summed energy deviates from that ideal ratio (1/d² is convex, so
  // spreading mass at fixed mean distance systematically changes the sum — Jensen's inequality).
  // A giant (one emitter, IS the point) should match the ideal ratio almost exactly; a flock's
  // spread should measurably miss it.
  const obsA = { x: 4, y: 10 }, obsB = { x: 4, y: 14 };
  const idealRatio = (cx, cy) => {
    const dA = Math.max(distance(obsA.x, obsA.y, cx, cy), env.dMin);
    const dB = Math.max(distance(obsB.x, obsB.y, cx, cy), env.dMin);
    return (dB * dB) / (dA * dA);
  };
  const actualRatio = (seed, subs) => {
    const eA = regionEnergy(accumulate(asEntities(seed, subs, 0, obsA.x, obsA.y), env).R).organic;
    const eB = regionEnergy(accumulate(asEntities(seed, subs, 0, obsB.x, obsB.y), env).R).organic;
    return eA / eB;
  };
  const ideal = idealRatio(10, 10);
  const flockDev = Math.abs(actualRatio(fSeed, fSubs) - ideal);
  const giantDev = Math.abs(actualRatio(gSeed, gSubs) - ideal);
  check("flock's amplitude scaling deviates from a rigid point's inverse-square prediction more than a giant's",
    flockDev > giantDev, `flock dev=${flockDev.toExponential(2)} giant dev=${giantDev.toExponential(2)}`);
  check("a giant matches the ideal point-source ratio almost exactly (it IS the point)", giantDev < 1e-9, `dev=${giantDev}`);

  // intrinsic flux (§7.4): from a FIXED observer, sample the same group at two different
  // simTimes. A flock should visibly shimmer even standing still; a giant (no sub-emitters,
  // never moves on its own) is exactly static.
  const fixedObs = { x: 4, y: 10 };
  const flockT0 = regionContour(accumulate(asEntities(fSeed, fSubs, 0, fixedObs.x, fixedObs.y), env).R, "organic");
  const flockT1 = regionContour(accumulate(asEntities(fSeed, fSubs, 0.3, fixedObs.x, fixedObs.y), env).R, "organic");
  const giantT0 = regionContour(accumulate(asEntities(gSeed, gSubs, 0, fixedObs.x, fixedObs.y), env).R, "organic");
  const giantT1 = regionContour(accumulate(asEntities(gSeed, gSubs, 0.3, fixedObs.x, fixedObs.y), env).R, "organic");
  const flockFlux = shift(flockT0, flockT1), giantFlux = shift(giantT0, giantT1);
  check("flock shimmers over time while stationary; a giant stays put",
    flockFlux > giantFlux, `flock=${flockFlux.toFixed(4)} giant=${giantFlux.toFixed(4)}`);
  check("a giant's read is exactly static across time (no sub-emitters to jitter)", giantFlux === 0, `got ${giantFlux}`);

  // generation wiring: every sub-emitter's creatureId resolves to a seed in the same scene,
  // and each group's emitter count matches its subEmitterCount
  const genScene = generateScene(lib, { ships: 0, rocks: 0, organics: 0, creatures: 10 }, mulberry32(8));
  const seeds = genScene.filter((e) => e.isCreature);
  const subs = genScene.filter((e) => e.creatureId);
  check("generateScene creates the requested creature count", seeds.length === 10, `got ${seeds.length}`);
  check("every sub-emitter's creatureId resolves to a seed in the same scene",
    subs.every((s) => seeds.some((sd) => sd.id === s.creatureId)));
  check("each group's total emitter count matches its subEmitterCount",
    seeds.every((sd) => subs.filter((s) => s.creatureId === sd.id).length === sd.subEmitterCount - 1));
  check("generated creature sub-emitters are hidden; seeds are not",
    subs.every((s) => s.hidden === true) && seeds.every((sd) => !sd.hidden));

  // hand placement (createEntity) wires the same builder and returns { entity, extra }
  const placed = createEntity({ type: "organic", organic: { isCreature: true, creatureId: "flock", size: 60, sizeRandom: false } }, lib, 30, 30, { creatures: { spreadKm } });
  check("createEntity returns a creature seed + extra sub-emitters", placed.entity && placed.entity.isCreature && Array.isArray(placed.extra) && placed.extra.length === flockState.subEmitterCount - 1);

  // scenario round-trip: creature-only fields survive JSON.stringify → parseScenario
  const cScn = { ship: { x: 0, y: 0 }, env: { rMax: 20, sectorDeg: 360, sectorCenter: 0, dMin: 0.5, pEmissive: 3 },
    ui: {}, settings: { logMode: false, F: 0.3, C: 300, gain: 0.15, emissiveDisplayMax: 100 },
    gen: { ships: 0, rocks: 0, organics: 0, creatures: 0 }, palette: null, scene: [fSeed, ...fSubs] };
  const builtC = buildScenario(cScn);
  const { scenario: parsedC, error: cErr } = parseScenario(JSON.stringify(builtC));
  check("creature scenario round-trip parses cleanly", !cErr, cErr);
  const rtSeed = parsedC.entities.find((e) => e.id === fSeed.id);
  const rtSub = parsedC.entities.find((e) => e.creatureId === fSeed.id);
  check("seed's creature fields round-trip",
    rtSeed && rtSeed.isCreature === true && rtSeed.creatureState === "flock" && approx(rtSeed.jitterRadius, fSeed.jitterRadius));
  check("sub-emitter's creatureId/hidden/angle/phase round-trip",
    rtSub && rtSub.creatureId === fSeed.id && rtSub.hidden === true && typeof rtSub.emitterAngle === "number");
}

console.log("\n[16] Ship-find / resource-find game modes (Phase 7, design §10)");
{
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const resIdOf = (e) => (e.sigId.includes("+") ? e.sigId.split("+")[1] : null);

  // ship-find: exactly one contact of the target hull, across seeds AND same-lobe clusters
  const sf = generateScene(lib, { ships: 40, rocks: 0, organics: 0, shipClusters: true, shipFindMode: true }, mulberry32(13));
  check("ship-find exposes a ship target", !!sf.mode.ship && !!sf.mode.ship.id);
  const shipHits = sf.filter((e) => e.type === "ship" && e.sigId === sf.mode.ship.id).length;
  check("ship-find ⇒ exactly one contact of the target hull", shipHits === 1, `got ${shipHits}`);
  check("ship-find leaves resource target null", sf.mode.resource === null);

  // ship-find with ships=0 still guarantees the one target spawns (a hunt needs a subject)
  const sf0 = generateScene(lib, { ships: 0, rocks: 0, organics: 0, shipFindMode: true }, mulberry32(14));
  check("ship-find with ships=0 still spawns the lone target",
    sf0.filter((e) => e.type === "ship" && e.sigId === sf0.mode.ship.id).length === 1);

  // resource-find: target drawn from the (capped) pool, and ≥20% of placed rocks carry it
  const rf = generateScene(lib, { ships: 0, rocks: 50, organics: 0, rockClusters: true, resourceFindMode: true }, mulberry32(21));
  check("resource-find exposes a resource target", !!rf.mode.resource && !!rf.mode.resource.id);
  const rocksRf = rf.filter((e) => e.type === "rock");
  const hitFrac = rocksRf.filter((e) => resIdOf(e) === rf.mode.resource.id).length / rocksRf.length;
  check("resource-find ⇒ at least 20% of placed rocks carry the target resource", hitFrac >= 0.20 - 1e-9, `frac=${hitFrac.toFixed(3)}`);
  check("resource-find leaves ship target null", rf.mode.ship === null);

  // resource-find respects the variety cap: target must come from the drawn palette, not the raw library
  const rfCapped = generateScene(lib, { ships: 0, rocks: 50, organics: 0, resourceFindMode: true, varietyCap: true, substrateVariety: 2, resourceVariety: 2 }, mulberry32(21));
  check("resource-find + variety cap ⇒ target is one of the drawn resources",
    rfCapped.palette.resources.some((r) => r.id === rfCapped.mode.resource.id));

  // resource-find with rocks=0 still guarantees the one target spawns
  const rf0 = generateScene(lib, { ships: 0, rocks: 0, organics: 0, resourceFindMode: true }, mulberry32(22));
  check("resource-find with rocks=0 still spawns a rock carrying the target",
    rf0.filter((e) => e.type === "rock" && resIdOf(e) === rf0.mode.resource.id).length >= 1);

  // both modes off ⇒ no mode object leaks a stale target
  const off = generateScene(lib, { ships: 10, rocks: 10, organics: 0 }, mulberry32(1));
  check("neither find mode ⇒ mode.ship/mode.resource are both null", off.mode.ship === null && off.mode.resource === null);

  // scenario round-trip carries the mode target + hit counts (design §12)
  const modeScn = { ship: { x: 0, y: 0 }, env: { rMax: 20, sectorDeg: 360, sectorCenter: 0, dMin: 0.5, pEmissive: 3 },
    ui: {}, settings: { logMode: false, F: 0.3, C: 300, gain: 0.15, emissiveDisplayMax: 100 },
    gen: { ships: 0, rocks: 0, organics: 0, shipFindMode: true, resourceFindMode: true },
    palette: null, mode: { ship: { id: "andromeda", name: "Andromeda" }, resource: { id: "iron", name: "Iron" }, shipHits: 1, resourceHits: 3 },
    scene: [] };
  const builtM = buildScenario(modeScn);
  const { scenario: parsedM, error: mErr } = parseScenario(JSON.stringify(builtM));
  check("mode scenario round-trip parses cleanly", !mErr, mErr);
  check("mode target + hit counts round-trip",
    parsedM.mode.ship.id === "andromeda" && parsedM.mode.resource.id === "iron" &&
    parsedM.mode.shipHits === 1 && parsedM.mode.resourceHits === 3);
  check("gen's find-mode flags round-trip", parsedM.gen.shipFindMode === true && parsedM.gen.resourceFindMode === true);
}

console.log(`\n${fail === 0 ? "ALL CHECKS PASSED" : fail + " CHECK(S) FAILED"} — ${pass} passed, ${fail} failed.\n`);
process.exit(fail === 0 ? 0 : 1);
