// build_library.mjs — one-shot generator for data/library.json (Phase 0 extraction).
// Defines every signature SPARSELY (only nonzero bands, 1-indexed) exactly as written
// in signature-library-draft1.md, then expands to dense length-20 contours, validates
// peaks, and writes the JSON the tool + future harness both consume. Run with: node build_library.mjs
import { writeFileSync } from "node:fs";

const BANDS = 20;
// expand {bandNumber(1-indexed): value, …} → dense length-20 array
const X = (sparse) => {
  const a = new Array(BANDS).fill(0);
  for (const [b, v] of Object.entries(sparse)) a[Number(b) - 1] = v;
  return a;
};

// ── Ships ──────────────────────────────────────────────────────────────────
// contour bands 1–8 metallic, 9–11 transition; emissive [IR, EM, PA].
const ships = [
  // Military (lobe low, clean, EM-high, low particulate)
  { id: "deimos", name: "Deimos", role: "interceptor", lobe: "military", sizeClass: "S", size: 26,
    contour: X({1:1.00,2:.78,3:.42,4:.20,5:.10,6:.05,7:.04,8:.03, 9:.02,10:.01}), emissive:[40,52,8] },
  { id: "phobos", name: "Phobos", role: "scout", lobe: "military", sizeClass: "S", size: 24,
    contour: X({1:.62,2:1.00,3:.66,4:.30,5:.14,6:.07,7:.05,8:.06, 9:.03,10:.01}), emissive:[34,50,7] },
  { id: "rhea", name: "Rhea", role: "corvette", lobe: "military", sizeClass: "M", size: 55,
    contour: X({1:.40,2:.74,3:1.00,4:.50,5:.30,6:.16,7:.08,8:.06, 9:.04,10:.02,11:.01}), emissive:[55,68,12] },
  { id: "vega", name: "Vega", role: "frigate", lobe: "military", sizeClass: "M", size: 58,
    contour: X({1:.55,2:.92,3:.78,4:.58,5:.66,6:.34,7:.16,8:.10, 9:.06,10:.03,11:.01}), emissive:[52,66,14], note:"twin bump b2 & b5" },
  { id: "orion", name: "Orion", role: "gunship", lobe: "military", sizeClass: "M", size: 60,
    contour: X({1:1.00,2:.70,3:.46,4:.18,5:.40,6:.62,7:.22,8:.12, 9:.05,10:.02,11:.01}), emissive:[64,70,10], note:"hard notch b4 + secondary b6 (weapon resonance)" },
  { id: "triton", name: "Triton", role: "cruiser", lobe: "military", sizeClass: "L", size: 90,
    contour: X({1:.70,2:1.00,3:.86,4:.50,5:.64,6:.40,7:.22,8:.12, 9:.08,10:.04,11:.02}), emissive:[72,82,16] },
  { id: "andromeda", name: "Andromeda", role: "flagship", lobe: "military", sizeClass: "L", size: 92, unique: true,
    contour: X({1:1.00,2:.52,3:.94,4:.48,5:.82,6:.30,7:.18,8:.12, 9:.06,10:.03,11:.01, 19:.42}), emissive:[58,92,5],
    note:"UNIQUE. high-low-high b1/b3/b5 + cross-region organic transponder spike b19 (cross-region tell #1)" },

  // Civilian (lobe centre, balanced, dirtier)
  { id: "lyra", name: "Lyra", role: "survey probe", lobe: "civilian", sizeClass: "S", size: 22,
    contour: X({1:.20,2:.40,3:.70,4:1.00,5:.72,6:.40,7:.20,8:.10, 9:.03,10:.01}), emissive:[20,38,12] },
  { id: "mimas", name: "Mimas", role: "shuttle", lobe: "civilian", sizeClass: "S", size: 28,
    contour: X({1:.30,2:.55,3:.88,4:1.00,5:.62,6:.34,7:.18,8:.10, 9:.04,10:.02,11:.01}), emissive:[28,30,30], note:"near-confusable with Lyra (differ b2/b5 ratio + emissions)" },
  { id: "callisto", name: "Callisto", role: "liner", lobe: "civilian", sizeClass: "M", size: 56,
    contour: X({1:.34,2:.56,3:.92,4:.64,5:.96,6:.58,7:.30,8:.16, 9:.05,10:.03,11:.01}), emissive:[44,48,34], note:"twin b3 & b5" },
  { id: "cygnus", name: "Cygnus", role: "carrier", lobe: "civilian", sizeClass: "L", size: 88,
    contour: X({1:.40,2:.66,3:.90,4:.96,5:.94,6:.88,7:.60,8:.36, 9:.10,10:.06,11:.03}), emissive:[66,74,40], note:"broad central plateau" },

  // Crude / bulk (lobe high, transition spill, rough, high particulate)
  { id: "io", name: "Io", role: "mining tender", lobe: "crude", sizeClass: "S", size: 27,
    contour: X({1:.10,2:.14,3:.22,4:.40,5:.66,6:.90,7:1.00,8:.70, 9:.26,10:.15,11:.06}), emissive:[30,22,50] },
  { id: "titan", name: "Titan", role: "bulk hauler", lobe: "crude", sizeClass: "M", size: 58,
    contour: X({1:.18,2:.26,3:.40,4:.62,5:.84,6:1.00,7:.92,8:.78, 9:.34,10:.22,11:.12}), emissive:[46,34,72] },
  { id: "ganymede", name: "Ganymede", role: "bulk freighter", lobe: "crude", sizeClass: "L", size: 92,
    contour: X({1:.22,2:.32,3:.46,4:.66,5:.88,6:1.00,7:.96,8:.82, 9:.40,10:.28,11:.15}), emissive:[58,40,85], note:"max safe transition spill" },
];

// ── Structures (flat slabs; identity is in emissions, not shape) ─────────────
const structures = [
  { id: "ceres", name: "Ceres Station", role: "industrial station", sizeClass: "L", size: 86,
    contour: X({1:.30,2:.38,3:.55,4:.72,5:.92,6:.95,7:.96,8:.93, 9:.40,10:.28,11:.16}), emissive:[62,90,48], note:"flat right-loaded slab, EM-loud" },
  { id: "vault", name: "Vault", role: "bunker", sizeClass: "S", size: 30,
    contour: X({1:.55,2:.62,3:.68,4:.66,5:.60,6:.40,7:.24,8:.14, 9:.06,10:.03,11:.01}), emissive:[14,10,4], note:"flat, emission-dead (the tell)" },
  { id: "kepler", name: "Kepler", role: "research facility", sizeClass: "M", size: 62,
    contour: X({1:.60,2:.72,3:.80,4:.78,5:.82,6:.76,7:.66,8:.52, 9:.14,10:.10,11:.06, 18:.20,19:.18,20:.12}), emissive:[50,84,28], note:"broad flat, EM-loud, soft organic bleed b18–20 (cross-region tell #2)" },
];

// ── Rocky substrates (broad central hump; sedimentary types lean organic) ────
const substrates = [
  { id: "basalt", name: "Basalt", kind: "igneous", contour: X({12:.55,13:.85,14:1.00,15:.78,16:.45,17:.22,18:.05}) },
  { id: "granite", name: "Granite", kind: "igneous", contour: X({12:.40,13:.70,14:.95,15:1.00,16:.70,17:.40,18:.06,19:.02}) },
  { id: "gneiss", name: "Gneiss", kind: "metamorphic", contour: X({12:.50,13:.88,14:.66,15:.92,16:.74,17:.46,18:.05}), note:"twin bump = foliation" },
  { id: "sandstone", name: "Sandstone", kind: "sedimentary", contour: X({12:.25,13:.45,14:.66,15:.88,16:1.00,17:.78,18:.30,19:.12,20:.04}) },
  { id: "shale", name: "Shale", kind: "sedimentary", contour: X({12:.30,13:.52,14:.74,15:.96,16:.86,17:.60,18:.40,19:.20,20:.08}), note:"organic-rich" },
  { id: "limestone", name: "Limestone", kind: "carbonate", contour: X({12:.18,13:.34,14:.52,15:.74,16:.96,17:1.00,18:.62,19:.34,20:.14}), note:"strongest organic lean" },
];

// ── Rocky resources (metal leans transition/metallic; non-metal leans rocky) ─
// Hydrocarbons lives here, not under organics (design §6.2: resource-organics are ROCK
// resources) — HANDOFF §4 Q1, resolved. It leans into the organic region (16–20) by design:
// that's the rock resource that makes a bed read bio-adjacent, the in-family confusable for
// a real organic signal.
const resources = [
  { id: "iron", name: "Iron", metal: true, contour: X({8:.18,9:.72,10:1.00,11:.80,12:.28}), note:"broad, peak b10" },
  { id: "copper", name: "Copper", metal: true, contour: X({7:.10,8:.40,9:1.00,10:.66,11:.32,12:.10}), note:"leans metallic, peak b9" },
  { id: "platinum", name: "Platinum", metal: true, contour: X({9:.28,10:.70,11:1.00,12:.50,13:.18}), note:"rare, sharp, leans rock-ward" },
  { id: "volatiles", name: "Volatiles", metal: false, contour: X({9:.18,10:.52,11:1.00,12:.46,13:.14}), note:"nearest the metals, most ambiguous" },
  { id: "sulfur", name: "Sulfur", metal: false, contour: X({10:.22,11:.58,12:1.00,13:.55,14:.18}), note:"peak b12" },
  { id: "silica", name: "Silica", metal: false, contour: X({11:.30,12:.66,13:1.00,14:.72,15:.32}), note:"deep in rocky, overlaps substrate" },
  { id: "hydrocarbons", name: "Hydrocarbons", metal: false, contour: X({16:.15,17:.85,18:1.00,19:.40,20:.12}), note:"inert, cold; leans organic — the rock resource that reads bio-adjacent" },
];

// ── Static organics (biomass; reuse rock machinery) ───────────────────────────
const organicsStatic = [
  { id: "biomass", name: "Biomass", kind: "plant", contour: X({17:.20,18:.58,19:1.00,20:.66}), emissive:[18,4,8], note:"cool" },
];

// ── Creatures: one shared footprint, identity in the temporal state ──────────
const creatureFootprint = X({17:.18,18:.40,19:.72,20:1.00});
const creatureStates = [
  { id: "flock", name: "Flock", subEmitterCount: 12, fluxAmplitude: 0.9, fluxRate: 3.0, intrinsicVsParallax: 0.7, coherence: 0.2, emissive:[50,6,24], read:"constant shimmer even when still" },
  { id: "herd", name: "Herd", subEmitterCount: 5, fluxAmplitude: 0.4, fluxRate: 1.0, intrinsicVsParallax: 0.3, coherence: 0.55, emissive:[68,8,18], read:"stable at rest, profile shifts under your motion" },
  { id: "giant", name: "Lone giant", subEmitterCount: 1, fluxAmplitude: 0.08, fluxRate: 0.4, intrinsicVsParallax: 0.1, coherence: 0.95, emissive:[82,10,12], read:"stable on both channels — one coherent source" },
];

// ── Named worked composites (rock/organic examples, design §3.5/lib §3.5) ────
const composites = [
  { id: "ironstone", name: "Ironstone", substrate: "granite", resource: "iron", grade: 0.70, note:"canonical good-ore read: central hump + clean transition spike" },
  { id: "cinnabar_bed", name: "Cinnabar bed", substrate: "limestone", resource: "sulfur", grade: 0.60, note:"non-metal problem: sulfur peak merges into limestone low edge" },
  { id: "mesa", name: "Mesa", substrate: "sandstone", resource: null, grade: 0, note:"substrate-only landmark, no value" },
  { id: "ingot_cache", name: "Ingot cache", substrate: null, resource: "iron", grade: 1.0, note:"resource-only, unprocessed ore cargo (bare spike)" },
  { id: "tar_sands", name: "Tar sands", substrate: "sandstone", resource: "hydrocarbons", grade: 0.70, note:"hydrocarbon bump merging with sandstone organic lean" },
];

// ── validate & report peaks ──────────────────────────────────────────────────
const peak = (a) => Math.max(...a);
const warnings = [];
for (const s of [...ships, ...structures, ...substrates, ...resources, ...organicsStatic]) {
  const p = peak(s.contour);
  if (p > 1.0001) warnings.push(`${s.name}: peak ${p} > 1.0`);
}
if (warnings.length) console.log("PEAK WARNINGS:\n" + warnings.join("\n"));
else console.log("All contour peaks <= 1.0 ✓");

const library = {
  meta: {
    bands: BANDS,
    emissive: ["IR", "EM", "PA"],
    regions: { metallic: [1, 8], transition: [9, 11], rocky: [12, 17], organic: [18, 20] },
    note: "Linear, no wrap. Transition 9–11 is firewall/spill, not a robust region. Contours are size-invariant (peak ~1.0 for non-structures). Structures are flat by design. First-pass, harness-unvalidated (library §STATUS).",
  },
  ships, structures, substrates, resources, organicsStatic,
  creatureFootprint, creatureStates, composites,
};

writeFileSync(new URL("./data/library.json", import.meta.url), JSON.stringify(library, null, 2));
console.log(`Wrote data/library.json — ${ships.length} ships, ${structures.length} structures, ${substrates.length} substrates, ${resources.length} resources, ${organicsStatic.length} static organics, ${creatureStates.length} creature states, ${composites.length} composites.`);
