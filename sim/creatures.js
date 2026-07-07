// creatures.js — pure creature-group math (design §7.4). No DOM/clock reads: callers (main.js's
// loop) supply simTime; this module only computes sub-emitter position from it. Same convention
// as paths.js.
//
// A creature is modelled as the design doc's own words: "a small bound cluster of sub-emitters
// sharing the footprint, with slight spatial jitter around its centre." Built as a SEED entity
// (the one visible/selectable/scannable contact) plus subEmitterCount-1 extra, hidden, physics-
// only entities that superpose through the unchanged accumulate() — flux and parallax
// decoherence emerge from that sum, not from a bespoke system.
//
// Motion formula per sub-emitter (fixed at creation: a random angle + phase so co-created
// emitters don't move in lockstep):
//   jitterRadius = (1 - coherence) * spreadKm        — spatial spread budget
//   staticPart   = jitterRadius * (1 - intrinsicVsParallax)   — fixed offset, parallax-only reveal
//   fluxPart(t)  = jitterRadius * intrinsicVsParallax * fluxAmplitude
//                  * sin(2π * fluxRate * t + emitterPhase)    — time-varying, revealed even standing still
//   pos(t)       = seed + (staticPart + fluxPart(t)) · (cos, sin)(emitterAngle)
// intrinsicVsParallax splits the budget between a component only motion-parallax reveals and one
// that shimmers on its own; coherence sets how much budget there is at all (a giant's single
// emitter needs none — rigid by construction, not by parameter tuning).

let counter = 0;
const uid = (type) => `${type}_${++counter}`;

// state: a library creatureStates entry. footprint: the shared creatureFootprint contour.
// size: total authored size (split evenly across all sub-emitters, seed included, so total
// energy doesn't depend on subEmitterCount — a flock and a giant of the same size read equally
// loud, differing only in temporal texture).
export function buildCreatureGroup(state, footprint, x, y, size, spreadKm, rand = Math.random) {
  const n = state.subEmitterCount;
  const perEmitterSize = size / n;
  const seed = {
    id: uid("creature"), type: "organic", displayName: state.name,
    isCreature: true, creatureState: state.id,
    contour: footprint, size: perEmitterSize, emissive: state.emissive,
    x, y, enabled: true, sigId: state.id,
    subEmitterCount: n, fluxAmplitude: state.fluxAmplitude, fluxRate: state.fluxRate,
    intrinsicVsParallax: state.intrinsicVsParallax,
    jitterRadius: (1 - state.coherence) * spreadKm,
  };
  const subEmitters = [];
  for (let i = 0; i < n - 1; i++) {
    subEmitters.push({
      id: uid("creature_emitter"), type: "organic",
      contour: footprint, size: perEmitterSize, emissive: null,
      x, y, enabled: true,
      creatureId: seed.id, hidden: true,
      emitterAngle: rand() * Math.PI * 2, emitterPhase: rand() * Math.PI * 2,
    });
  }
  return { seed, subEmitters };
}

// Live position of a sub-emitter at absolute time t (the session clock). `seed` carries the
// shared flux params; `emitter` carries its own fixed angle/phase.
export function creatureEmitterPosition(seed, emitter, t) {
  const r = seed.jitterRadius;
  const staticPart = r * (1 - seed.intrinsicVsParallax);
  const fluxPart = r * seed.intrinsicVsParallax * seed.fluxAmplitude
    * Math.sin(2 * Math.PI * seed.fluxRate * t + emitter.emitterPhase);
  const mag = staticPart + fluxPart;
  return {
    x: seed.x + Math.cos(emitter.emitterAngle) * mag,
    y: seed.y + Math.sin(emitter.emitterAngle) * mag,
  };
}
