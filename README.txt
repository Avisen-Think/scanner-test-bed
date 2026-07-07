SCANNER TEST BED — USER GUIDE
==============================

This is an INSTRUMENT, not a game. It's a test bed for a spectrum-analyzer style
sensor: you place or generate objects ("contacts") in a 100x100 km field, then
read their combined signal off a spectral display and try to work out what's
out there before you can see it. Full design background lives in
scanning-system-concept.md and scanner-test-bed-design.md; current build status
is in HANDOFF.md. This file is just "how do I drive it."


1. RUNNING IT
--------------
This is plain ES-module JavaScript with no build step, but it will NOT run by
double-clicking index.html (browsers block ES modules over file://). It must be
served over http://.

  1. Open this folder in VS Code.
  2. Install the "Live Server" extension (Extensions panel, search "Live Server").
  3. Right-click index.html -> "Open with Live Server" (or click "Go Live" in
     the status bar).

It opens in your browser and reloads automatically whenever you save a file.


2. THE SCREEN, IN TWO HALVES
------------------------------
LEFT: the field. A 100x100 km map. The white dot with the cyan ring is your
ship. Drag it and everything recomputes live — every contact's distance and
bearing to the ship is derived every frame, not stored.

RIGHT: the readout. What your sensor actually "hears" from wherever the ship
currently is: spectral bars, region-energy totals, an identity read, and a
stack of instrumentation cards below it.

The left rail (far left) holds every control: what's selected, placement,
generation, save/load, view options, sensor gating, and display tuning.


3. READING THE FIELD (map)
-----------------------------
- Drag the ship (white/cyan dot) to move it. Distance and bearing to every
  contact update live.
- Click a contact to select it — details appear in the "Selected contact"
  panel in the rail.
- The sensor footprint is drawn as a disc (360 degree sector) or a tapered
  wedge (narrower sector). Brightness across the wedge is the actual angular
  gain applied to contacts in it — brighter parts of the wedge contribute more
  to the readout, not just a cosmetic gradient.
- Two dashed rings: the reveal range (contacts start appearing on the map once
  you're this close) and the 2 km scan radius (needed to identify a contact —
  see section 7).
- "N contributing off-view" in the footer means sources are affecting your
  readout but are currently scrolled off the visible map — the spectrum can
  show you things the map can't.

IMPORTANT DISTINCTION: reveal range (map) and R_max (the sensor's read range,
in the rail) are independent. You can be READING a source's contribution to
the spectrum long before it's close enough to SEE as a dot on the map. That
gap is the point of the tool — read before you see.


4. THE READOUT (right column)
--------------------------------
- Spectral readout — 20 colour-coded spectral bars plus a separate 3-bar
  emissive readout. Hover any band to see which contacts are contributing to
  it and by how much ("decompose the sum").
- Mission — shows your active Ship-find / Resource-find target(s) and whether
  you've found them yet, if either mode is toggled on before Generate (see
  section 6).
- Generated palette — after a Generate with "Limit variety" on, lists which
  rock strata/resources were actually drawn and capped to for this scene.
- Region energy — four totals (Metallic / Transition / Rocky / Organic). This
  is the ROBUST reading: it's just a sum, so it stays additive no matter how
  many sources are piled up. Transition energy is reported but deliberately
  excluded from every material class (a "firewall" so a metal+rock pile-up
  can't fake an ore signature).
- Identity — the dominant region's shape, normalized. This is the FRAGILE
  reading: two similar signatures overlapping will smear this into something
  unreadable even though region energy stays perfectly clean. That fragility
  is intentional — it's what makes close-range identification a real skill
  rather than a guaranteed unlock.
- Decompose the sum — hover a band for its per-contact contributors; below it,
  a table always lists every contributing entity's total share of each region
  across the whole spectrum (not just the hovered band).
- Snapshot compare — click "Snapshot" to freeze the current readout beside the
  live one (two mini spectra + a delta table), so you can tell whether closing
  distance / muting a source / changing a setting actually changed anything.
  "Clear" drops it.


5. THE LEFT RAIL, GROUP BY GROUP
-----------------------------------

Selected contact
  Whatever you last clicked on the map: live distance/bearing/status, a "Mute
  source" toggle (drops it from the readout without deleting it), and a Scan
  button when you're close enough (see section 7).

Customization (hand placement, design section 9)
  "Enable placement" turns this on and auto-switches the overlay to
  colour-coded (see section 8) so you can see everything you place.
    - Tool: Place / Delete / Move.
    - Type: Ship, Structure, Rock, or Organic — each has its own options:
        Ship/Structure — size class filter + pick a specific unit or Random.
          Check "mobile" to give it a path (line/circle/figure-8); after
          placing, click the map a second time to set its direction.
        Rock — strata + resource (or Random, or None for a barren rock) +
          size + grade, each with a "rand" checkbox. The rock's contour is
          built live as (substrate + resource x grade) x size, exactly the
          math the sensor uses.
        Organic — pick a static type + size, OR check "creature" for a
          temporal signature (flock / herd / lone giant / random) — creatures
          shimmer or drift over time rather than reading as a fixed shape;
          see section 9.
  Click the field to place/delete/move with the current tool+type.

Generation (bulk scatter, design section 11)
  Instead of hand-placing, scatter a whole scene at once:
    - Ships / Rocks / Organics / Creatures — count sliders.
    - Ship clusters / Rock clusters — toggle small clumped groups instead of
      pure scatter. Ship clusters are same-lobe (e.g. all military) — a hard
      identification case on purpose. Rock clusters share substrate+resource
      (an ore vein).
    - Motion: "Mobile ships" — some ship seeds are given a moving path.
    - Rock variety: "Limit variety" caps the whole scene's rocks to a small
      drawn palette of strata/resources (1-4 each) so the same confounders
      recur across the field instead of appearing once — useful for learning
      to recognize a specific collision.
    - Find mode: "Ship-find" guarantees exactly one of a randomly chosen hull
      spawns somewhere in the scene; "Resource-find" guarantees at least 20%
      of rocks carry a randomly chosen resource. Either or both can be on —
      the Mission card (readout column) names your target(s) and tracks hits.
    - Generate replaces the whole scene. Clear empties it.
  Counts are TOTALS — turning clusters on redistributes where things land, it
  doesn't add more contacts.

Scenario (save/load, design section 12)
  "Save scenario" downloads the current scene (ship position, every setting,
  every entity, generation params, find-mode progress) as a
  scenario-<timestamp>.json file. "Load scenario..." reads one back in and
  restores the whole rail to match — a good way to return to a specific setup
  or share one.

View & locks
    - Zoom: 100 km (survey) or 20 km (close work). At 20 km the view anchors
      on the ship at the moment you zoom and then holds still — dragging the
      ship moves it WITHIN that fixed window rather than panning the
      background. To look elsewhere, zoom out and back in to re-anchor.
    - Overlay: Uniform grey (honest mode — contacts only show if in reveal
      range and in your sector, no identity without a scan) vs Colour-coded
      (ground truth — everything visible, selectable, and colour-typed; used
      for authoring/checking a scene, not for "playing" it).
    - Lock Ship: freezes the ship in place; drag the map itself to aim the
      sector instead.
    - Lock Sensors: ship stays draggable, but the sector locks onto a clicked
      world point and keeps pointing at it as you move past.
    (Auto-rotate, below, is mutually exclusive with both locks — turning any
    one of the three on turns the other two off.)

Sensor gate
    - R_max — how far out the sensor can read at all (the outer limit of what
      contributes to the spectrum).
    - Reveal range — how close a contact must be before it appears as a dot on
      the map. Independent of R_max on purpose (see section 3).
    - Sector (deg) — 360 for an omnidirectional disc, or a narrower wedge
      (180/90/45) for a directional sensor.
    - Sector centre — aim the wedge manually (disabled while a lock or
      auto-rotate owns it).
    - Auto-rotate — sweeps the sector on its own at a chosen rate (deg/s),
      either a full 360 degree sweep or oscillating between two bearings you
      set. Useful for hands-free situational awareness while stationary —
      watch each source's contribution rise and fall as the sweep crosses it.

Display & tuning
    - Linear (gain) vs Log (shape) display mode.
    - Gain — master pre-scale on the linear display. "Auto (ballpark)" sets it
      once so the current loudest band reads full-scale, as a fast starting
      point — it does NOT keep re-normalizing every frame, so a signature's
      real loudness (faint-because-far vs. faint-because-small) stays honest
      information rather than being erased.
    - F (floor) / C (saturation) — the display's dynamic-range constants.
    - d_min — minimum-distance floor (prevents a divide-by-near-zero blowup
      right on top of a source).
    - p (emissive falloff) / Emissive display max — tuning for the separate
      3-bar emissive readout.


6. FINDING THINGS: SHIP-FIND / RESOURCE-FIND
-----------------------------------------------
Toggle "Ship-find" and/or "Resource-find" in the Generation panel BEFORE you
click Generate — they shape that generation, not the live scene. Once
generated, the Mission card (top of the readout column) names your target(s):
    - Ship-find: exactly one hull of the rolled type is guaranteed somewhere
      in the scene. Scan it (section 7) to mark it found.
    - Resource-find: a rolled resource is guaranteed on at least 20% of
      generated rocks. Each one you scan increments the hit counter.
Both can be active at once — you can hunt a hull and a resource in the same
generated field.


7. SCANNING (identifying a contact for certain)
--------------------------------------------------
In grey (honest) overlay, an unscanned contact just reads "Unidentified" no
matter how obvious its spectral shape looks. To confirm identity for real:
  1. Select the contact.
  2. Get within 2 km of it, with it inside your sector.
  3. A "Scan (5 s)" button appears in the Selected-contact panel — click it
     and hold your position.
  4. If you drift out of range or out of sector before it fills, the scan
     aborts and you start over.
  5. Once complete, the contact is marked (a green arc) and its identity is
     locked in permanently on the map, even if it later falls outside reveal
     range or your sector — a scan is a paid-for result you don't lose.
(Muting a contact overrides this: a muted-then-scanned contact still hides,
since muting is your own deliberate choice to drop it.)


8. GREY VS COLOUR-CODED OVERLAY
------------------------------------
- Uniform grey — the "honest" play mode. Contacts only appear if within reveal
  range and inside your sector; none of them show identity unless scanned.
  This is the mode that matches what a real sensor operator would actually get.
- Colour-coded — the ground-truth debug view. Every contact is visible,
  selectable, and colour-typed regardless of range or sector. Useful when
  you're authoring a scene by hand and want to see what you've placed, or
  checking a generated scene's contents — not meant to be "played" as a hunt.
Enabling the Customization panel auto-switches you into colour-coded mode.


9. CREATURES: WHY THEY DON'T HAVE A FIXED SHAPE
----------------------------------------------------
A creature (flock / herd / lone giant) is a single contact on the map, but
under the hood it's a bunch of identical emitters spread around one point.
Because they're all the SAME shape, their combined spectral shape never
smears the way a mixed group of different ships would — a flock's identity
reads the same as one animal's. What DOES change is the reading over time
and as you move past it: a flock shimmers/drifts noticeably (even standing
still), a herd is calmer and mostly shifts as you move relative to it, and a
lone giant is essentially rock-steady (it IS just one point). In other words:
you can't spot "this is a swarm, not one animal" by staring at its shape —
you have to watch it change over time. That's deliberate.


10. SIGNAL LIBRARY (reference sheet)
-----------------------------------------
Click "Signal Library" (top-left) to open a full-screen reference of every
signature in the game — ships, structures, organics, substrates, and
resources — shown as SHAPE ONLY (no distance/size/gain applied), since shape
is the size-invariant, memorizable part of an identity. Size is printed as a
plain number instead, since that's about detection range, not identity.
Notable bits inside:
    - Compose a rock (top of the sheet) — pick a substrate + resource + grade
      and watch the combined contour build live, with the bare substrate shown
      faintly behind the finished composite so the added resource is visually
      obvious. A region read underneath shows which material class it lands
      in and highlights the transition-band energy that's excluded from every
      class (the same firewall used everywhere else).
    - Example rocks — the game's authored composites, shown baseline vs.
      finished so you can see exactly what each resource contributes.
    - Creatures — shown as a static footprint with a caveat that real
      creature identity is temporal (section 9) — don't memorize this shape
      as if it were fixed.
    - "Pop out" detaches the library into its own real browser window/page so
      you can keep it open on a second monitor alongside the live scanner.
      Close the in-page version with the button or Esc.


11. A GOOD FIRST WALKTHROUGH
---------------------------------
  1. Start zoomed to 100 km, overlay on Uniform grey, nothing placed yet.
     Use Generation to scatter a small scene (e.g. 10 ships, 20 rocks) and
     click Generate.
  2. Notice the map may show nothing at first (everything's outside reveal
     range) while the spectral readout is already lit — you're reading things
     you can't see yet.
  3. Drag the ship toward a contact. Watch it appear on the map once you cross
     reveal range, and watch the spectral bars rise as you close distance.
  4. Get within 2 km, select it, and hit Scan to confirm its identity.
  5. Try parking between two close-together contacts and watch the identity
     read smear into an ambiguous blob while region energy stays clean and
     additive — that gap between "the totals are honest" and "the shape is
     readable" is the whole point of this instrument.
  6. Switch overlay to Colour-coded to see the full ground truth of what you
     generated, then switch back to grey to return to the honest read.
  7. Try Snapshot before and after a change (closing distance, muting a
     source, adjusting gain) to see exactly what moved.
  8. Save the scenario, mess with the scene further, then Load it back to
     return to your saved setup.


12. RE-VERIFYING WITHOUT A BROWSER (for the curious/technical)
--------------------------------------------------------------------
    node selfcheck.mjs       runs the project's dependency-free test suite
    node build_library.mjs   regenerates data/library.json from source defs
No install/build step needed for either.


13. THINGS NOT TO TOUCH CASUALLY
-------------------------------------
The data/ folder (library.json, config.json) holds hand-tuned values that
took real effort to set — treat it as precious, don't "clean it up" without
checking first.
