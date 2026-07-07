// geometry.js — pure spatial helpers for the play space. No DOM, no canvas.
// Kept separate from field.js so the viewport/clamp/projection math is unit-testable.
//
// Convention: world and screen both use y-DOWN. Angles are "screen degrees":
// 0° = +x (east), positive = clockwise. This matches Canvas's arc() direction and
// physics.angularGain is convention-agnostic (it only compares bearing vs centre),
// so as long as bearings and the sector centre share this convention, it's consistent.

export const FIELD_KM = 100;

export function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

export function bearingDeg(fromX, fromY, toX, toY) {
  return (Math.atan2(toY - fromY, toX - fromX) * 180) / Math.PI;
}

// Zoomed window in world km. Returns top-left {x0,y0} + square span.
// zoomSpan >= fieldKm → full field. Otherwise a window of side zoomSpan centred on
// the ship, edge-CLAMPED so it never spills past [0, fieldKm] (the ship sits
// off-centre near edges rather than the window showing empty space outside the field).
export function computeView(shipX, shipY, zoomSpan, fieldKm = FIELD_KM) {
  if (zoomSpan >= fieldKm) return { x0: 0, y0: 0, span: fieldKm };
  const clamp = (v) => Math.max(0, Math.min(fieldKm - zoomSpan, v));
  return { x0: clamp(shipX - zoomSpan / 2), y0: clamp(shipY - zoomSpan / 2), span: zoomSpan };
}

// world km → screen px (square canvas of side `px`)
export function worldToScreen(wx, wy, view, px) {
  const s = px / view.span;
  return { sx: (wx - view.x0) * s, sy: (wy - view.y0) * s };
}

// screen px → world km
export function screenToWorld(sx, sy, view, px) {
  const s = view.span / px;
  return { wx: view.x0 + sx * s, wy: view.y0 + sy * s };
}

// is a world point inside the current view rectangle? (for the off-view count)
export function inView(wx, wy, view) {
  return wx >= view.x0 && wx <= view.x0 + view.span && wy >= view.y0 && wy <= view.y0 + view.span;
}

export const clampToField = (v, fieldKm = FIELD_KM) => Math.max(0, Math.min(fieldKm, v));

// Clamp a world point to the current view rectangle. When zoomed in, the window is
// FIXED (anchored at zoom time, not following the ship), so dragging the ship is bounded
// to what's on screen — to reach elsewhere you zoom out and re-anchor. At full-field zoom
// the view IS the field, so this reduces to clampToField.
export function clampToView(wx, wy, view) {
  return {
    x: Math.max(view.x0, Math.min(view.x0 + view.span, wx)),
    y: Math.max(view.y0, Math.min(view.y0 + view.span, wy)),
  };
}
