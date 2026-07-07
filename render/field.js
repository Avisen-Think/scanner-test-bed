// field.js — the play space (design §4). Canvas: draggable ship, grid + labels,
// 100↔20 km zoom with edge clamp, sensor footprint (circle or tapered-gain sector),
// proximity overlay, selection, and the Lock Ship / Lock Sensors aim modes.
//
// Geometry (each entity's d, bearing, gain, reveal/scan flags) is computed in main.js
// before render so physics and the map agree; this module only draws and handles input.
import {
  FIELD_KM, distance, bearingDeg, computeView, worldToScreen, screenToWorld, inView, clampToField, clampToView,
} from "../sim/geometry.js";

const TYPE_COLOR = { ship: "#5fb4e6", rock: "#d08a52", organic: "#6cc28a", structure: "#9aa6b4" };
const GREY = "#8b97a6";
const SHIP_GRAB_PX = 16;
const SIGNAL_GRAB_PX = 12;

export function createField(canvas, refs) {
  const ctx = canvas.getContext("2d");
  let px = 600; // css logical square size
  let view = computeView(50, 50, FIELD_KM);
  let lastZoom = null; // forces the first render to anchor the window

  const { ship, scene, env, ui, onChange, onPlace, onDelete, onSetDirection, onDrag } = refs;
  const liveUpdate = onDrag || onChange; // continuous drag/aim updates prefer the cheap path

  // ── sizing ──────────────────────────────────────────────────────────────
  function resize() {
    const wrap = canvas.parentElement;
    const side = Math.max(240, Math.min(wrap.clientWidth, wrap.clientHeight));
    const dpr = window.devicePixelRatio || 1;
    px = side;
    canvas.style.width = side + "px";
    canvas.style.height = side + "px";
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }
  if (window.ResizeObserver) new window.ResizeObserver(resize).observe(canvas.parentElement);
  window.addEventListener("resize", resize);

  // ── helpers ───────────────────────────────────────────────────────────────
  const w2s = (wx, wy) => worldToScreen(wx, wy, view, px);
  const s2w = (sx, sy) => screenToWorld(sx, sy, view, px);

  function pointerWorld(ev) {
    const r = canvas.getBoundingClientRect();
    return s2w(ev.clientX - r.left, ev.clientY - r.top);
  }
  function aimSector(pt) {
    env.sectorCenter = bearingDeg(ship.x, ship.y, pt.wx, pt.wy);
  }

  // ── interaction ─────────────────────────────────────────────────────────
  let draggingShip = false;
  let aiming = false;
  let movingId = null;

  function nearShip(ev) {
    const s = w2s(ship.x, ship.y);
    const er = canvas.getBoundingClientRect();
    return Math.hypot(ev.clientX - er.left - s.sx, ev.clientY - er.top - s.sy) <= SHIP_GRAB_PX;
  }
  function nearestContact(ev) {
    const er = canvas.getBoundingClientRect();
    const mx = ev.clientX - er.left, my = ev.clientY - er.top;
    let best = null, bestD = SIGNAL_GRAB_PX;
    for (const e of scene) {
      if (!isShown(e)) continue;
      const s = w2s(e.x, e.y);
      const d = Math.hypot(mx - s.sx, my - s.sy);
      if (d <= bestD) { bestD = d; best = e; }
    }
    return best;
  }

  canvas.addEventListener("pointerdown", (ev) => {
    const pt = pointerWorld(ev);

    // Mobile placement armed (design §7.2/§9) → this click sets the just-placed ship's
    // direction instead of placing another entity or falling through to select/drag.
    if (ui.mobileArmed && ui.pendingMobileId) {
      const e = scene.find((x) => x.id === ui.pendingMobileId);
      if (e && e.path && onSetDirection) {
        const heading = bearingDeg(e.path.origin.x, e.path.origin.y, pt.wx, pt.wy);
        onSetDirection(e.id, heading);
      }
      ui.mobileArmed = false;
      ui.pendingMobileId = null;
      canvas.setPointerCapture(ev.pointerId);
      onChange();
      return;
    }

    // Lock Sensors armed → this click sets the locked point
    if (ui.lockSensors && ui.sensorArmed) {
      ui.sensorPoint = { x: clampToField(pt.wx), y: clampToField(pt.wy) };
      ui.sensorArmed = false;
      canvas.setPointerCapture(ev.pointerId);
      onChange();
      return;
    }

    // Lock Ship → click-drag aims the sector; ship stays put
    if (ui.lockShip) {
      aiming = true;
      canvas.setPointerCapture(ev.pointerId);
      aimSector(pt);
      onChange();
      return;
    }

    // customization tools (design §9): place / delete / move
    if (ui.customizing && ui.tool) {
      const contact = nearestContact(ev);
      if (ui.tool === "place") {
        if (nearShip(ev)) { draggingShip = true; canvas.setPointerCapture(ev.pointerId); return; }
        if (contact) { ui.selectedId = contact.id; onChange(); return; }
        if (onPlace) onPlace({ x: clampToField(pt.wx), y: clampToField(pt.wy) });
        return;
      }
      if (ui.tool === "delete") {
        if (contact && onDelete) onDelete(contact);
        return;
      }
      if (ui.tool === "move") {
        if (contact) { movingId = contact.id; ui.selectedId = contact.id; canvas.setPointerCapture(ev.pointerId); onChange(); return; }
        if (nearShip(ev)) { draggingShip = true; canvas.setPointerCapture(ev.pointerId); return; }
        return;
      }
    }

    // grab the ship dot to drag it
    if (nearShip(ev)) {
      draggingShip = true;
      canvas.setPointerCapture(ev.pointerId);
      return;
    }

    // otherwise try to select a shown signal
    ui.selectedId = (nearestContact(ev) || {}).id || null;
    onChange();
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (movingId) {
      const e = scene.find((x) => x.id === movingId);
      if (e) { const pt = pointerWorld(ev); e.x = clampToField(pt.wx); e.y = clampToField(pt.wy); liveUpdate(); }
    } else if (draggingShip) {
      const pt = pointerWorld(ev);
      const c = clampToView(pt.wx, pt.wy, view); // bounded to the on-screen window when zoomed
      ship.x = c.x;
      ship.y = c.y;
      liveUpdate();
    } else if (aiming) {
      aimSector(pointerWorld(ev));
      liveUpdate();
    }
  });
  const endDrag = () => {
    const wasLive = draggingShip || aiming || movingId != null;
    draggingShip = false; aiming = false; movingId = null;
    // one full, untouched recompute the moment a drag/aim/move actually ends, so the
    // heavier panels (decompose, source-totals, selected/hud) catch up to the final state
    // instead of sitting at whatever the last throttled liveUpdate() happened to compute.
    if (wasLive && onChange) onChange();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // which signals are drawn: grey mode → revealed (≤ reveal range + in sector) AND enabled,
  // OR a scanned contact (identity was already earned — bypasses reveal/sector, not mute);
  // colour-coded mode → ALL placed (ground-truth debug overlay), incl. muted, all selectable
  // (a muted one draws dimmed so you can still see it and unmute it).
  // No array allocation here — this runs every render() call (every frame while anything
  // moves), so a plain predicate + direct scene iteration at each call site avoids an O(N)
  // filter()-copy on top of an already O(N) scene walk.
  function isShown(e) {
    // a creature's sub-emitters (design §7.4) are hidden physics-only contributors — only the
    // seed is ever a visible/selectable contact, in EITHER overlay mode (even colour-coded
    // ground-truth stays honest about "one creature, one contact," never a swarm of dots).
    if (e.hidden) return false;
    return ui.colorCoded || (e.enabled !== false && (e._revealed || e.scanned));
  }

  // ── drawing ───────────────────────────────────────────────────────────────
  function render() {
    // The window is ANCHORED, not ship-following: recompute it only when the zoom level
    // changes (centre it on the ship at that moment, edge-clamped). Dragging the ship after
    // that pans nothing — the background stays put and the ship moves within the window.
    // Zoom out and back in to re-anchor elsewhere.
    if (ui.zoom !== lastZoom) {
      view = computeView(ship.x, ship.y, ui.zoom, FIELD_KM);
      lastZoom = ui.zoom;
    }
    ctx.clearRect(0, 0, px, px);
    ctx.fillStyle = "#0c1016";
    ctx.fillRect(0, 0, px, px);

    drawGrid();
    drawFootprint();
    drawRings();
    drawSignals();
    drawShip();
    drawLockMarker();

    return status();
  }

  function drawGrid() {
    const step = ui.zoom >= FIELD_KM ? 10 : 2; // km
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = "top";
    const startX = Math.ceil(view.x0 / step) * step;
    const startY = Math.ceil(view.y0 / step) * step;
    for (let wx = startX; wx <= view.x0 + view.span + 1e-6; wx += step) {
      const { sx } = w2s(wx, 0);
      ctx.strokeStyle = Math.abs(wx % 10) < 1e-6 ? "#222c3a" : "#19212c";
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, px); ctx.stroke();
      if (Math.abs(wx % 10) < 1e-6 && wx < FIELD_KM) { // letter on X (stable per 10 km column)
        ctx.fillStyle = "#46505f";
        ctx.fillText(String.fromCharCode(65 + Math.round(wx / 10)), sx + 3, 3);
      }
    }
    for (let wy = startY; wy <= view.y0 + view.span + 1e-6; wy += step) {
      const { sy } = w2s(0, wy);
      ctx.strokeStyle = Math.abs(wy % 10) < 1e-6 ? "#222c3a" : "#19212c";
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(px, sy); ctx.stroke();
      if (Math.abs(wy % 10) < 1e-6) { // km number on Y
        ctx.fillStyle = "#46505f";
        ctx.fillText(String(Math.round(wy)), 3, sy + 2);
      }
    }
  }

  function drawFootprint() {
    const s = w2s(ship.x, ship.y);
    const rPx = (env.rMax / view.span) * px;
    if (env.sectorDeg >= 360) {
      // omnidirectional: uniform faint disc (g = 1 everywhere)
      ctx.fillStyle = "rgba(95,180,230,0.06)";
      ctx.beginPath(); ctx.arc(s.sx, s.sy, rPx, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(95,180,230,0.25)";
      ctx.beginPath(); ctx.arc(s.sx, s.sy, rPx, 0, Math.PI * 2); ctx.stroke();
      return;
    }
    // tapered sector: thin slices with alpha ∝ cos²(offset) → shows g(θ)
    const half = env.sectorDeg / 2;
    const c = (env.sectorCenter * Math.PI) / 180;
    const sliceDeg = 1.5;
    for (let off = -half; off < half; off += sliceDeg) {
      const x = Math.abs((off + sliceDeg / 2) / half); // 0 on-axis .. 1 at edge
      const g = Math.cos((x * Math.PI) / 2) ** 2;
      ctx.fillStyle = `rgba(95,180,230,${(0.02 + 0.16 * g).toFixed(3)})`;
      const a0 = c + (off * Math.PI) / 180;
      const a1 = c + ((off + sliceDeg) * Math.PI) / 180;
      ctx.beginPath(); ctx.moveTo(s.sx, s.sy); ctx.arc(s.sx, s.sy, rPx, a0, a1); ctx.closePath(); ctx.fill();
    }
    // on-axis line + edges
    ctx.strokeStyle = "rgba(95,180,230,0.5)";
    ctx.beginPath(); ctx.moveTo(s.sx, s.sy);
    ctx.lineTo(s.sx + Math.cos(c) * rPx, s.sy + Math.sin(c) * rPx); ctx.stroke();
  }

  function drawRings() {
    const s = w2s(ship.x, ship.y);
    const ring = (km, color) => {
      const r = (km / view.span) * px;
      ctx.strokeStyle = color; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(s.sx, s.sy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    };
    ring(ui.revealRange, "rgba(200,210,225,0.18)"); // proximity-reveal radius (adjustable)
    ring(2, "rgba(108,194,138,0.30)"); // scan radius
  }

  function drawSignals() {
    for (const e of scene) {
      if (!isShown(e)) continue;
      const s = w2s(e.x, e.y);
      const color = (ui.colorCoded || e.scanned) ? (TYPE_COLOR[e.type] || GREY) : GREY;
      const selected = ui.selectedId === e.id;
      ctx.globalAlpha = e.enabled === false ? 0.3 : 1; // muted → dimmed
      ctx.beginPath(); ctx.arc(s.sx, s.sy, selected ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.globalAlpha = 1;
      if (e._scannable) { // halo for within-scan-range contacts
        ctx.strokeStyle = "rgba(108,194,138,0.8)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.sx, s.sy, 8, 0, Math.PI * 2); ctx.stroke();
      }
      if (e.scanned) { // confirmed identity
        ctx.strokeStyle = "#6cc28a"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.sx, s.sy, 7, -0.4, 1.2); ctx.stroke();
      }
      if (selected) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.sx, s.sy, 9, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  function drawShip() {
    const s = w2s(ship.x, ship.y);
    ctx.fillStyle = "#eef3f8";
    ctx.beginPath(); ctx.arc(s.sx, s.sy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#5fb4e6"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.sx, s.sy, 8, 0, Math.PI * 2); ctx.stroke();
  }

  function drawLockMarker() {
    if (ui.lockSensors && ui.sensorPoint) {
      const s = w2s(ui.sensorPoint.x, ui.sensorPoint.y);
      ctx.strokeStyle = "#e8b14a"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.sx - 6, s.sy); ctx.lineTo(s.sx + 6, s.sy);
      ctx.moveTo(s.sx, s.sy - 6); ctx.lineTo(s.sx, s.sy + 6); ctx.stroke();
      ctx.beginPath(); ctx.arc(s.sx, s.sy, 7, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function status() {
    // contributors to the readout that fall outside the visible window (design §4). Hidden
    // creature sub-emitters (§7.4) are excluded — they aren't separately perceived contacts, so
    // counting them here would inflate "N revealed"/"N off-view" by up to subEmitterCount for a
    // single swarm.
    let offView = 0, revealed = 0;
    for (const e of scene) {
      if (e.hidden) continue;
      if (e._contrib) { if (!inView(e.x, e.y, view)) offView++; }
      if (e._revealed) revealed++;
    }
    return { offView, revealed };
  }

  resize();
  return { render, resize };
}
