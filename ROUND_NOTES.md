# Round notes

One round, one measured gap, one fix. Newest first.

---

## 2026-08-12 — An overlay in first person was a trap

**Track A.** No Track B this round; the measured gap was not visual mush.

### The gap

The HUD's four overlays — key list, colony-code box, new-colony card, ending — live in one DOM
tree over both views. First person holds the pointer lock. A locked pointer is *no cursor at
all*, so any of the four landing on a possessed body was unanswerable, and one of them lands
without being asked for: the ending card opens on the tick a colony is founded or a ship sails,
whichever camera the player happens to be behind.

Three things were wrong at once, and all three were provable from the source rather than
guessed at:

- `Input` binds `keydown` and `mousemove` to `window`, not to the canvas. `App.step()` had no
  gate on either `fpsFrame()` or `fps.applyTick()`, so **W kept walking the settler and the
  mouse kept turning a head the player could not see**, behind the card.
- `input.releaseLock()` had exactly one caller in the whole client — `exitFps()`
  (`grep -rn releaseLock src/client/`). Nothing handed the pointer back when a card opened, so
  **there was no cursor to press any button with**.
- `globalKeys()` had Escape routes for help, backup and setup, and **none for the ending card**
  — which is the one card the player did not open. The HUD exposed no accessor for it either.

Escape was not a way out on its own: Chrome consumes the keypress that exits a pointer lock, so
the page never sees that keydown. A locked player pressing Escape got a cursor back and the
card stayed exactly where it was.

### The fix

One rule: **while an overlay is up, the body reads no input and the pointer goes back.**

- **New** `src/client/overlays.ts` — `anyOverlayUp`, `bodyMayAct`, `pointerMustBeFree`, and the
  `Overlays` shape. Its own module, importing only a type from `sim/save`, for the reason
  `pace.ts` is its own module: `app.ts` cannot be loaded outside a browser, and a rule about
  who is allowed to move should be provable rather than asserted in a comment.
- `app.ts` — `overlays()` reads the four HUD flags; `step()` gates the per-frame `fpsFrame()`
  and the per-tick `applyTick()` on the same `bodyMayAct` answer and calls `releaseLock()` when
  `pointerMustBeFree`; `globalKeys()` gains an Escape route for the ending card and then stops
  at a guard, so pause, the view swap and every panel key belong to the card while it is up.
  (That last one also fixes a smaller thing nobody had written down: a `p` typed into the
  colony-code box used to open the work tab underneath it.)
- `ui/hud.ts` — `endingOpen` and `closeEnding()`, matching the existing `helpOpen` /
  `backupOpen` / `setupOpen` shape, plus `endingDismissible`. The wipe card refuses to close:
  it has no dismiss button either, because there is no colony behind it to go back to.

The world keeps ticking behind the card. That is deliberate and it is stage 5b's promise — an
ending that stopped the colony would contradict the card that says *keep playing*.

### Before / after

- **PLAYTEST 9nn — "Take a card in a body"** (new, follows 9mm). Land an ending while walking
  in first person. Before: locked mouse, no cursor, W still walking, no Escape. After: the
  pointer comes back on the frame the card opens, the settler stands still, Escape closes it,
  and the *Click to look with the mouse* hint is waiting when it goes.
- **`tests/overlays.test.ts`** (new, 9 tests) — the rule over all sixteen combinations of the
  four overlays: the body has its controls only on an uncovered screen, loses them to any one
  of the four, has none to lose at the desk, and the pointer is handed back on exactly the
  frames the body is not driving.
- **`tests/architecture.test.ts`** — one new rule, *"asks one module who has the hands while a
  card is up"*: `app.ts` imports `./overlays` and mentions both decisions. Pins the wiring,
  which is the half a refactor drops silently.

### Verified

- `npx tsc --noEmit` — clean.
- `npm test` — **94 of 96 files, 1,790 passed, 13 skipped**, 1,477 s. Ten of those are this
  round's, and the run was taken *after* the last edit rather than beside it: an earlier pass
  that started before the `syncHud` change was discarded as the record even though it was green,
  because a suite that predates a line is not evidence about it. ACCEPTANCE.md carries the
  breakdown.
- `npm run build` — exit 0. 917.85 kB JS (262.44 kB gzip), 23.41 kB CSS. The rule cost 1.26 kB
  of JS and nothing at all in CSS, which is the right price for a thing that only decides who
  reads the keyboard.
- `npm run measure -- --days 60 --past-founding` then `npm run balance` — 39 colonies in
  2,847 s, 4 green. Not this round's work, but it is the first grid that could read stage 5b's
  two promises and both came back green, so the docs stopped deferring them.
- Dual-view honesty: nothing in `sim/` was touched. The rule reads `ViewMode` and two booleans;
  it cannot desync a view from the world because it never looks at the world.

### Next target

- **Stage 5c, the manifest** — who actually left, by name. `EndingRecord` is the hook, and the
  ending card is the place it belongs.
- Track B, when a round is free for it: **L5 Motion** is the layer with the widest gap between
  the two cameras. A settler crossing the yard reads fine from above and reads as a slide from
  eye level.
- Still open from stage 5a: `every-ending-is-reachable` and `no-ending-is-free` have no unit
  tests in `tests/balance-principles.test.ts`, while the three road promises and 5b's do.
