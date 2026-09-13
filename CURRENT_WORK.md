# CURRENT_WORK — resume pointer

Read this first at session start. It says where the work stands and what the next
action is. Everything durable lives in the files it points at; this page is a map, not
a copy.

**Updated:** 2026-09-12 · **`main` at write time:** `40305dd` (forge-bench fast-forwarded
into main the same day; nothing open).

---

## Where it stands

The forge bench (`FORGING.md`) has run through stage 5: every procedural building in
`src/client/render/buildings.ts` is a recipe with its numbers pinned, and the last round
lifted `gen.fire`, `heat.glow` and the bank's charge band into one shared `FrontPlate`.
Its open briefs are the *Next* section of the top entry in `ROUND_NOTES.md`: the louvre
and back-outlet pool pins that do not compare to their own machine's arguments, then
`gen.wheel` and `gen.stack`, the cooler's and heater's feet, the solar panel.

The look loop (`LOOK.md`) has five briefs written and untaken: the settler's arms
against the pitch, the walking feet, eight pile shapes, per-blade grass phase, a body's
worth of space for the animals, and round thirteen's hair value break.

## The pass now open

A pass at the physics, the graphics and the simulator, read as three segments, one
measured gap each, run through `/solve` (plan at the gate, segments to open PRs):

1. **The feel of the body you drive.** Acceleration and stopping, sway and run amplitude
   in the one bob the rig and the eye share, frame-rate-independent easing, exponential
   interpolation. Instrument first: a scripted walk traced at three frame rates, pinned.
2. **Measure the GPU, then spend triangles where they show.** A GPU timer in the look
   harness, a grass budget, then the untaken look briefs in play-distance order.
3. **The colony builds more than not.** Pin buildings finished per day and idle-with-
   open-jobs in the eval, then fix dispatch and the Steward against those numbers.

## Next action

Run `/solve` on the pass above. The plan lands here as `PLAN.md` and
`SEGMENT_STATUS.md` at the human gate.
