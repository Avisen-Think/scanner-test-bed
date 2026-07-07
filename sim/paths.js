// paths.js — pure mobile-ship path math (design §7.2). No DOM, no clock reads: callers
// (main.js's loop) supply elapsed time; this module only computes position from it.
// Same convention as geometry.js: y-down, degrees, 0°=+x east, CW positive.
//
// A path is { origin:{x,y}, headingDeg, extent, phase0, t0, confirmed, centre?, theta0? }.
// `extent` is the full segment length (line), radius (circle), or long-axis length (fig8).
// `t0` is the simTime at which this path's motion was activated (placement confirm /
// generation) — position is computed from (t - t0 + phase0), so a ship starts exactly at its
// origin the instant its path is confirmed, regardless of how long the session clock has run.
// `phase0` staggers otherwise-identical paths so co-placed/co-generated ships don't move in
// lockstep. `confirmed` gates whether stepMotion touches this entity at all — an unconfirmed
// (direction not yet set) mobile ship stays put.

function linePos(path, tLocal, speed) {
  const { origin, headingDeg, extent } = path;
  const rad = (headingDeg * Math.PI) / 180;
  const hx = Math.cos(rad), hy = Math.sin(rad);
  const period = (2 * extent) / speed;
  let tm = tLocal % period;
  if (tm < 0) tm += period;
  const dist = tm * speed;
  const d = dist <= extent ? dist : 2 * extent - dist;
  return { x: origin.x + hx * d, y: origin.y + hy * d };
}

function circlePos(path, tLocal, speed) {
  const r = path.extent;
  const omega = speed / r;
  const theta = path.theta0 + omega * tLocal;
  return { x: path.centre.x + r * Math.cos(theta), y: path.centre.y + r * Math.sin(theta) };
}

function fig8Pos(path, tLocal, speed) {
  const { origin, headingDeg, extent } = path;
  const rad = (headingDeg * Math.PI) / 180;
  const a = extent / 2;
  const omega = speed / a;
  const th = omega * tLocal;
  const lx = a * Math.sin(th);
  const ly = (a * Math.sin(2 * th)) / 2;
  const cosr = Math.cos(rad), sinr = Math.sin(rad);
  return { x: origin.x + lx * cosr - ly * sinr, y: origin.y + lx * sinr + ly * cosr };
}

// Position at absolute time `t` (the session clock). Unconfirmed paths (direction not yet
// set) stay at their origin.
export function pathPosition(pathType, path, speed, t) {
  if (!path.confirmed) return { x: path.origin.x, y: path.origin.y };
  const tLocal = t - (path.t0 || 0) + (path.phase0 || 0);
  if (pathType === "line") return linePos(path, tLocal, speed);
  if (pathType === "circle") return circlePos(path, tLocal, speed);
  if (pathType === "fig8") return fig8Pos(path, tLocal, speed);
  return { x: path.origin.x, y: path.origin.y };
}

// Resolve a path's direction-dependent geometry once the heading is known (the second click
// in hand placement; immediate for generation). Mutates and returns `path`.
export function finalizeMobilePath(pathType, path, headingDeg) {
  path.headingDeg = headingDeg;
  if (pathType === "circle") {
    const rad = (headingDeg * Math.PI) / 180;
    const rot = rad + Math.PI / 2; // centre sits 90° clockwise of the initial heading
    const cx = path.origin.x + Math.cos(rot) * path.extent;
    const cy = path.origin.y + Math.sin(rot) * path.extent;
    path.centre = { x: cx, y: cy };
    path.theta0 = Math.atan2(path.origin.y - cy, path.origin.x - cx);
  }
  path.confirmed = true;
  return path;
}

// Rough period (seconds) for a path at the given speed — used to draw a random phase0 so
// co-created ships don't move in lockstep.
export function estimatePeriod(pathType, extent, speed) {
  if (pathType === "line") return (2 * extent) / speed;
  if (pathType === "circle") return (2 * Math.PI * extent) / speed;
  if (pathType === "fig8") return (2 * Math.PI * (extent / 2)) / speed;
  return 1;
}

export const PATH_TYPES = ["line", "circle", "fig8"];
