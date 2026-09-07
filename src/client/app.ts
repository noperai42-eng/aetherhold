/**
 * The application: one world, one scene, two cameras.
 *
 * The simulation advances on a fixed 20 Hz step that has nothing to do with the
 * frame rate; rendering interpolates between the last two steps. Switching views
 * swaps which camera renders and which controller receives input — it never
 * touches the world, which is why the switch is instant and can never disagree
 * with itself.
 */

import { FpsController } from './fps/controller';
import { Hud } from './ui/hud';
import { Input } from './input/input';
import { TouchControls } from './input/touch-controls';
import { ManagerCamera } from './manager/camera';
import { ManagerController } from './manager/controller';
import { QUALITY, Viewport, guessQuality } from './render/renderer';
import { Ambience } from './audio/ambience';
import { Sfx } from './audio/sfx';
import { alphaOf, pace } from './pace';
import { anyOverlayUp, bodyMayAct, pointerMustBeFree } from './overlays';
import { WorldView } from './render/world-view';
import { clearSave, defaultCamera, hasSave, loadGame, saveGame, savedAt, serialize } from '../sim/save';
import { exportColony, importColony } from '../sim/transfer';
import { createWorld } from '../sim/worldgen';
import { daylight, timeOfDay } from '../sim/clock';
import { cloudiness, rainfall, windStrength } from '../sim/weather';
import { findPawn, livingColonists, msg } from '../sim/world';
import { orderCampaign, orderCaravan } from '../sim/jobs';
import { abandonEnding, commitEnding } from '../sim/endings';
import { indoors } from '../sim/rooms';
import { installDevtools } from './devtools';
import { interact } from '../sim/interact';
import { makeStreams, stepWorld } from '../sim/tick';
import {
  cancelStackEntry,
  inhabitableId,
  markHuntPawn,
  markTamePawn,
  possess,
  releasePossession,
  setDrafted,
  setManual,
  setPriority,
} from '../sim/orders';
import { RESEARCH, setProject } from '../sim/research';
import { acceptOffer, currentTrader } from '../sim/trade';
import { setSteward } from '../sim/steward';
import { releasePet } from '../sim/pets';
import { summonPicky } from '../sim/pickies';
import type { ResearchId } from '../sim/research';
import type { BuildingKind, Difficulty, Pawn, World, WorkType } from '../sim/types';
import type { CameraState, ViewMode } from '../sim/save';
import type { Quality } from './render/renderer';
import type { Overlays } from './overlays';
import type { Selection, Tool } from './manager/controller';
import type { Streams } from '../sim/tick';
import { HollowHud } from './scene/hollow-hud';
import { HollowView } from './scene/hollow-view';
import {
  createHollowState,
  hollowInteract,
  pocketFromSearch,
  setHollowView,
  type HollowState,
} from './scene/hollow-loop';

/** Seconds of *unpaused* play between autosaves. A paused colony has nothing new to keep. */
const AUTOSAVE_EVERY = 60;

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly viewport: Viewport;
  private readonly input: Input;
  private readonly sfx = new Sfx();
  private readonly ambience = new Ambience();
  private ambienceStarted = false;
  private readonly hud: Hud;

  private world: World;
  private streams: Streams;
  private view: WorldView;
  private cam: ManagerCamera;
  private manager: ManagerController;
  private readonly fps = new FpsController();
  private readonly touch: TouchControls;

  private mode: ViewMode = 'manager';
  private speed = 1;
  /** The body V returns to, remembered even while the manager view has the wheel. */
  private possessedId: number | null = null;

  private accumulator = 0;
  private last = 0;
  private raf = 0;
  private frameTimes = 0;
  private frameCount = 0;
  private fpsShown = 0;

  private seenMessages = 0;
  private seenProjectileId = 0;
  private seenBuilt = 0;
  private quality: Quality;

  private sinceAutosave = 0;
  private autosaveExists = false;

  /**
   * Additive pocket scene. Null while the colony has the renderer. Does not
   * touch `src/sim` — the valley keeps ticking only when this is empty.
   */
  private hollowView: HollowView | null = null;
  private hollowHud: HollowHud | null = null;
  private hollowState: HollowState | null = null;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.canvas = canvas;
    this.quality = guessQuality();
    this.viewport = new Viewport(canvas, this.quality);
    this.input = new Input(canvas);
    this.touch = new TouchControls(this.input, hudRoot);

    this.world = createWorld();
    this.streams = makeStreams(this.world);
    this.view = new WorldView(this.viewport, this.world);
    this.cam = new ManagerCamera(this.world, defaultCamera(this.world));
    this.manager = new ManagerController(this.cam, { possess: (id) => this.enterFps(id) });
    this.seenMessages = this.world.messages.length;
    this.seenBuilt = this.world.stats.built;

    this.hud = new Hud(hudRoot, {
      setSpeed: (m) => this.setSpeed(m),
      save: () => this.save(),
      load: () => this.load(),
      restart: (opts) => this.restart(opts),
      setQuality: (q) => this.setQuality(q),
      select: (sel: Selection | null) => {
        this.manager.selection = sel;
      },
      possess: (id) => this.enterFps(id),
      setDraft: (id, on) => setDrafted(this.world, id, on),
      setHunted: (id, on) => markHuntPawn(this.world, id, on),
      releaseAnimal: (id) => {
        const beast = findPawn(this.world, id);
        if (beast) releasePet(this.world, beast);
      },
      setTamed: (id, on) => markTamePawn(this.world, id, on),
      setPriority: (id, work: WorkType, level) => setPriority(this.world, id, work, level),
      setTool: (tool: Tool, kind: BuildingKind | null) => this.manager.setTool(tool, kind),
      setResearch: (id) => this.setResearch(id),
      acceptTrade: (offerId) => this.acceptTrade(offerId),
      sendCaravan: (pawnId, settlementId, kind, amount) => {
        const pawn = findPawn(this.world, pawnId);
        if (!pawn) return;
        // The refusal is a sentence, not a silence: every reason a trip cannot
        // start is something the player can act on, and the log is where they
        // are already looking.
        const r = orderCaravan(this.world, pawn, settlementId, { kind, amount });
        if (!r.ok) msg(this.world, r.text, 'bad');
      },
      sendWarParty: (holdingId) => {
        // Same shape as the caravan above and for the same reason: every refusal
        // `planCampaign` can give is a sentence about something the player can
        // fix — hands, a shut ring, raiders in the yard — and the log is where
        // they are already reading.
        const r = orderCampaign(this.world, holdingId);
        msg(this.world, r.text, r.ok ? 'good' : 'bad');
      },
      // Both are silent on refusal, unlike the two above, because neither can be
      // refused from a panel that is drawing itself off the same two functions:
      // the offer rows only exist for open endings, and the link only exists
      // while one is running. A sentence in the log would be for a bug.
      commitEnding: (id) => commitEnding(this.world, id),
      abandonEnding: () => abandonEnding(this.world),
      cancelBuilding: (id) => this.cancelBuilding(id),
      switchView: () => this.toggleView(),
      loadAutosave: () => this.load('auto'),
      colonyCode: () => exportColony(serialize(this.world, this.viewState(), this.speed, Date.now())),
      loadColonyCode: (code) => this.adoptCode(code),
      setSteward: (on) => setSteward(this.world, on),
      setManual: (id, on) => setManual(this.world, id, on),
      cancelStackEntry: (id, jobId) => cancelStackEntry(this.world, id, jobId),
      focus: (x, y) => this.cam.focusOn(x, y),
      sendPickyErrand: (kind) => summonPicky(this.world, { kind }),
    });

    window.addEventListener('resize', this.onResize);
    window.addEventListener('beforeunload', this.onUnload);
    installDevtools(() => this.world, () => this.streams, this.cam);
    this.onResize();

    // First frame is drawn from a real sync so prewarm compiles the shaders that
    // will actually be used, not an empty scene's.
    this.view.onTick(this.world);
    this.view.sync(this.world, 0, this.cam.target, null, 0);
    this.viewport.prewarm([this.cam.camera, this.fps.camera]);

    this.autosaveExists = hasSave('auto');
    if (hasSave()) msg(this.world, 'A saved colony is waiting — press Load to resume it.', 'info');
    if (this.autosaveExists) {
      const auto = savedAt('auto') ?? 0;
      const manual = savedAt('manual') ?? 0;
      const fresher = auto > manual ? ' It is newer than your last manual save.' : '';
      msg(this.world, `The last session was autosaved — press Continue to pick it up.${fresher}`, 'info');
    }
    this.hud.toggleHelp();
    if (typeof location !== 'undefined' && pocketFromSearch(location.search)) {
      this.enterHollow();
    }
  }

  start(): void {
    this.last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- frame

  private step(dt: number): void {
    this.trackFps(dt);
    this.globalKeys();

    if (this.hollowState && this.hollowView && this.hollowHud) {
      this.hollowFrame(dt);
      this.input.endFrame();
      return;
    }

    const pawn = this.mode === 'fps' ? this.playerPawn() : null;
    if (this.mode === 'fps' && !pawn) this.exitFps('Nobody left to inhabit.');

    // An overlay takes the body's controls and hands back the mouse. See
    // `overlays.ts` — the world keeps ticking behind the card, because an
    // ending that stopped the colony would be a different promise than the one
    // the card makes, but nobody is driving the settler while it is up.
    const overlays = this.overlays();
    const bodyActs = bodyMayAct(this.mode, overlays);
    if (pointerMustBeFree(this.mode, overlays)) this.input.releaseLock();

    if (this.mode === 'manager') {
      this.manager.update(this.world, this.input, dt);
    } else if (pawn && bodyActs) {
      this.fpsFrame(pawn, dt);
    }

    // ---- fixed-step simulation ----
    const owed = pace(this.accumulator, dt, this.speed);
    this.accumulator = owed.left;
    for (let step = 0; step < owed.steps; step++) {
      const body = bodyActs ? this.playerPawn() : null;
      if (body) this.fps.applyTick(this.world, body, this.input, this.streams.combat);
      stepWorld(this.world, this.streams);
      this.view.onTick(this.world);
    }
    if (this.speed > 0) {
      this.sinceAutosave += dt;
      if (this.sinceAutosave >= AUTOSAVE_EVERY) this.autosave();
    }

    const alpha = alphaOf(owed, this.speed);
    this.afterTick();
    // Zero while paused: the cards are read in real seconds, and a player who
    // hits space to think about a raid should still have the raid card there.
    this.hud.tickCards(this.speed > 0 ? dt : 0, this.mode);
    this.driveAmbience(dt, pawn);
    this.render(alpha, dt);
    this.input.endFrame();
  }

  /**
   * Feed the ambient bed the world it is describing.
   *
   * Runs off the render clock rather than the sim tick on purpose: the bed is a
   * view, like the cameras are, and a paused colony should still sound like a
   * place rather than cutting to silence. It starts on the first frame after the
   * player's opening gesture unlocks audio — before that there is no context to
   * hand it.
   */
  private driveAmbience(dt: number, pawn: Pawn | null): void {
    if (!this.ambienceStarted) {
      const out = this.sfx.ambientOutput();
      if (!out) return;
      this.ambience.start(out.ctx, out.bus);
      this.ambienceStarted = true;
    }
    const w = this.world;
    // Where the ear is: the body in first person, and from above wherever the
    // camera is pointed. It used to be the first living colonist, which is the
    // same person all game and is wherever they happen to be standing — so a
    // player looking at the rain on the moor heard the inside of a hut two
    // hundred cells away because somebody was asleep in it, and the roof came
    // off the sound the moment that settler stepped outdoors. The camera is what
    // the player is listening from, and it is already what they are looking
    // from: `render` focuses the same point.
    const ear = pawn ?? this.cam.target;
    this.ambience.update(
      {
        timeOfDay: timeOfDay(w),
        daylight: daylight(w) * (1 - cloudiness(w) * 0.55),
        // Water, not weather: snow falls silently, so a blizzard comes through
        // as the wind alone. That is the sound of one, and it is free.
        rain: rainfall(w),
        wind: windStrength(w),
        threat: this.threatLevel(),
        indoors: indoors(w, Math.round(ear.x), Math.round(ear.y)),
        firstPerson: this.mode === 'fps',
      },
      dt,
    );
  }

  /**
   * How much danger is on the map, 0..1 — what the drone rides.
   *
   * Counts bodies and fires rather than reading a raid flag, because the drone
   * should fade as a raid is beaten down rather than snapping off when the last
   * raider dies, and a colony burning at midnight with nobody attacking is still
   * a colony in trouble.
   */
  private threatLevel(): number {
    let n = 0;
    for (const p of this.world.pawns) {
      if (p.dead || p.downed) continue;
      if (p.faction === 'raider' || p.faction === 'wildlife') n += 1;
    }
    n += this.world.fires.length * 0.5;
    return Math.min(1, n / 5);
  }

  private render(alpha: number, dt: number): void {
    const player = this.mode === 'fps' ? this.playerPawn() : null;
    const focus = player
      ? { x: player.x, y: player.y }
      : this.cam.target;

    if (this.mode === 'manager') this.syncManagerOverlays(alpha);
    else this.view.fx.setSelection(null);

    this.view.sync(this.world, alpha, focus, player ? player.id : null, dt);

    if (player) {
      const at = this.view.pawns.interpolated(player.id, alpha) ?? { x: player.x, y: player.y };
      this.fps.updateCamera(this.world, player, at.x, at.y, 1 / 60);
      this.viewport.render(this.fps.camera);
    } else {
      this.viewport.render(this.cam.camera);
    }

    this.hud.update({
      world: this.world,
      view: this.mode,
      speed: this.speed,
      selection: this.manager.selection,
      tool: this.manager.tool,
      buildKind: this.manager.buildKind,
      quality: this.quality,
      possessed: player,
      fps: this.fpsShown,
      viewQuad: player ? null : this.cam.viewQuad(),
    });
    const covered = anyOverlayUp(this.overlays());
    this.hud.setLockHint(this.mode === 'fps' && !this.input.locked && !this.input.touchSeen && !covered);
    // The thumb pad only exists for a machine that has shown it has no keyboard,
    // and only in the view that needs one. A desktop never sees it. Nor does a
    // tablet with a card up: the body is not taking input, and a stick that
    // moves nobody is worse than no stick.
    this.touch.setVisible(this.mode === 'fps' && this.input.touchSeen && !covered);
    this.hud.setContinueAvailable(this.autosaveExists);
  }

  private syncManagerOverlays(alpha: number): void {
    this.view.fx.setPreview(this.world, this.manager.preview);
    const sel = this.manager.selection;
    if (!sel) {
      this.view.fx.setSelection(null);
    } else if (sel.type === 'pawn') {
      const at = this.view.pawns.interpolated(sel.id, alpha);
      const p = findPawn(this.world, sel.id);
      const pos = at ?? (p ? { x: p.x, y: p.y } : null);
      this.view.fx.setSelection(pos ? { x: pos.x, y: pos.y, radius: 1 } : null);
    } else if (sel.type === 'building') {
      const b = this.world.buildings.find((q) => q.id === sel.id) ?? null;
      this.view.fx.setSelection(b ? { x: b.x, y: b.y, radius: 1.1 } : null);
    } else {
      // Tight to the square, because that is exactly what is selected — a ring
      // the size of a building's would claim the cells either side of it.
      this.view.fx.setSelection({ x: sel.x, y: sel.y, radius: 0.62 });
    }

    const hover = this.manager.hoverCell;
    if (this.manager.tool === 'build' && this.manager.buildKind && hover) {
      const ok = this.manager.preview.some((c) => c.x === hover.x && c.y === hover.y && c.valid);
      this.view.fx.setCursor(this.manager.buildKind, hover.x, hover.y, ok);
    } else {
      this.view.fx.setCursor(null, 0, 0, false);
    }
  }

  /** Sound and view-state reactions to whatever the sim just did. */
  private afterTick(): void {
    for (let i = this.seenMessages; i < this.world.messages.length; i++) {
      const m = this.world.messages[i]!;
      if (m.kind === 'threat') this.sfx.threat();
      else if (m.kind === 'bad') this.sfx.bad();
      else if (m.kind === 'good') this.sfx.good();
      // The sound says something happened; the card says what. Same walk of the
      // same new messages, so the two can never disagree about which are new.
      if (m.headline) this.hud.notify(m);
    }
    this.seenMessages = this.world.messages.length;

    for (const p of this.world.projectiles) {
      if (p.id > this.seenProjectileId) {
        this.seenProjectileId = p.id;
        this.sfx.shot();
      }
    }
    if (this.world.stats.built > this.seenBuilt) {
      this.seenBuilt = this.world.stats.built;
      this.sfx.built();
    }

    // Losing the body you were standing in hands you back the clipboard.
    if (this.mode === 'fps') {
      const p = this.playerPawn();
      if (!p) this.exitFps('Nobody left to inhabit.');
      else if (p.dead) this.exitFps(`${p.name} is dead. Take command.`);
      else if (p.downed) this.exitFps(`${p.name} is down and needs a doctor. Take command.`);
    }
  }

  private trackFps(dt: number): void {
    this.frameTimes += dt;
    this.frameCount++;
    if (this.frameTimes >= 0.5) {
      this.fpsShown = this.frameCount / this.frameTimes;
      this.frameTimes = 0;
      this.frameCount = 0;
    }
  }

  // ---------------------------------------------------------------- input

  /** What the HUD currently has over the world. See `overlays.ts`. */
  private overlays(): Overlays {
    return {
      help: this.hud.helpOpen,
      backup: this.hud.backupOpen,
      setup: this.hud.setupOpen,
      ending: this.hud.endingOpen,
    };
  }

  private globalKeys(): void {
    // Any first contact at all, not a click and not the space bar. Both of those
    // are things a phone does not have, and audio that only a keyboard can turn
    // on is audio no touchscreen player has ever heard. `unlock` is safe to call
    // every frame — it resumes a suspended context and returns.
    if (this.input.hasGestured) this.sfx.unlock();

    if (this.input.pressed('Escape') && this.hud.helpOpen) {
      this.hud.toggleHelp();
      return;
    }
    // Escape closes the backup card too. It is the only overlay a player can be
    // *inside* — cursor in the box, code half-pasted — and the one that most
    // needs an exit that is not a hunt for the right button.
    if (this.input.pressed('Escape') && this.hud.backupOpen) {
      this.hud.closeBackup();
      return;
    }
    // And the setup card. It is the one overlay whose confirm button throws the
    // current colony away, so backing out of it has to be the easiest thing in
    // the game to do — not a hunt for Cancel.
    if (this.input.pressed('Escape') && this.hud.setupOpen) {
      this.hud.closeSetup();
      return;
    }
    // And the ending card, which is the one overlay the player did not open. It
    // refuses on a wipe — see `Hud.closeEnding` — so this falls through to the
    // guard below and the keyboard stays with the card, which is correct: there
    // is nothing left to drive.
    if (this.input.pressed('Escape') && this.hud.endingOpen) {
      this.hud.closeEnding();
      if (!this.hud.endingOpen) return;
    }
    // Help closes on its own key as well as on Escape, and this has to be said
    // before the guard or the guard would eat it.
    if (this.hud.helpOpen && (this.input.pressed('Slash') || this.input.pressed('F1'))) {
      this.hud.toggleHelp();
      return;
    }
    // Nothing below this line reaches the colony while an overlay is over it.
    // Pause, the view swap and every panel key belong to the world behind the
    // card, and the player looking at a card is not looking at the world — most
    // sharply in the backup box, where the colony code is typed and a stray `p`
    // used to open the work tab underneath.
    if (anyOverlayUp(this.overlays())) return;
    if (this.hollowState) {
      if (this.input.pressed('KeyV')) this.toggleHollowView();
      // No `&& !this.input.locked`: the browser eats the first Escape to release
      // the pointer lock, so guarding on it made leaving take two presses with
      // nothing on screen saying so — and between them there is no cursor to
      // click the button with. `leaveHollow` releases the lock itself.
      if (this.input.pressed('Escape')) this.leaveHollow();
      return;
    }
    if (this.input.pressed('Slash') || this.input.pressed('F1')) this.hud.toggleHelp();
    if (this.input.pressed('KeyV')) this.toggleView();
    if (this.input.pressed('Space')) this.setSpeed(this.speed === 0 ? 1 : 0);
    if (this.mode === 'manager') {
      if (this.input.pressed('KeyP')) this.hud.toggleWorkTab();
      // The apostrophe, because every letter on the board is spoken for — the
      // panel keys have already spilled onto punctuation once, and ' sits beside
      // the ; that opens the story. Same row, same hand, same kind of thing.
      if (this.input.pressed('Quote')) this.hud.toggleBoardTab();
      if (this.input.pressed('KeyL')) this.hud.toggleResearchTab();
      // M for merchant. T is the draft key in both views and cannot be shared —
      // one press must not both arm a settler and open a shop. Gated on somebody
      // actually standing there, because a panel onto an empty yard teaches the
      // wrong thing.
      if (this.input.pressed('KeyM') && currentTrader(this.world)) this.hud.toggleTradeTab();
      // J for journey. Not gated on anything: the neighbours are always over
      // there, and the panel is the only place the player can find out who.
      if (this.input.pressed('KeyJ')) this.hud.toggleRoadTab();
      // Semicolon, because every letter on the board is already spoken for — H
      // for history was the obvious pick and H has been the hunt tool since the
      // animals arrived. So the panel row is the mnemonic instead of the letter:
      // J, L and ';' are three keys in a line under the right hand, and all
      // three open a panel. The corner log keeps the last eighty lines and
      // throws the rest away; this is where the colony's actual story lives.
      if (this.input.pressed('Semicolon')) this.hud.toggleChronicleTab();
      // Every digit is a blueprint now that the research bench claimed 0, so speed
      // moved to the two keys next to it — and slower/faster reads better than one
      // key that only ever cycles upward anyway.
      if (this.input.pressed('Minus')) this.setSpeed(Math.max(1, this.speed - 1));
      if (this.input.pressed('Equal')) this.setSpeed(Math.min(3, Math.max(1, this.speed) + 1));
    }
  }

  private fpsFrame(pawn: Pawn, dt: number): void {
    this.fps.applyLook(this.input, dt);
    if (!this.input.locked && this.input.clicked(0)) {
      this.input.requestLock();
      this.sfx.unlock();
    }
    if (this.input.pressed('KeyE')) {
      const line = interact(this.world, pawn);
      if (line) {
        msg(this.world, line, 'info');
        this.sfx.interact();
      } else {
        this.sfx.deny();
      }
    }
    if (this.input.pressed('KeyT')) setDrafted(this.world, pawn.id, !pawn.drafted);
  }

  // ---------------------------------------------------------------- view swap

  // ---------------------------------------------------------------- hollow pocket

  /** Open the Iter 1 mortal hollow. Safe to call twice; the second is a no-op. */
  enterHollow(): void {
    if (this.hollowState) return;
    if (this.hud.helpOpen) this.hud.toggleHelp();
    if (this.mode === 'fps') {
      this.input.releaseLock();
    }
    this.hollowView = new HollowView(this.viewport.scene);
    this.hollowHud = new HollowHud(this.hud.host, {
      leave: () => this.leaveHollow(),
      toggleView: () => this.toggleHollowView(),
    });
    this.hollowState = createHollowState();
    this.view.setVisible(false);
    this.hollowView.mount();
    this.hollowView.resize(window.innerWidth / Math.max(1, window.innerHeight));
    // The pocket is a different place, so the valley has to stop being audible in
    // it. `Ambience` starts its oscillators once and only `update` moves the
    // gains, so simply not calling it — which is what the frame short-circuit
    // below does — freezes rain and threat at whatever they were and silences
    // only the bird chirps, which are scheduled inside `update`. That is the
    // drone without the life. The gate plus a driven frame ramps the whole stage
    // to nothing instead.
    this.ambience.enabled = false;
    this.hud.setPocketChrome(true);
    this.hollowHud.setActive(true);
    this.hollowHud.sync(this.hollowState);
    this.touch.setVisible(false);
  }

  leaveHollow(): void {
    if (!this.hollowState) return;
    this.input.releaseLock();
    this.hollowView?.unmount();
    this.hollowView?.dispose();
    this.hollowHud?.dispose();
    this.hollowView = null;
    this.hollowHud = null;
    this.hollowState = null;
    this.ambience.enabled = true;
    this.view.setVisible(true);
    this.hud.setPocketChrome(false);
    this.onResize();
  }

  private toggleHollowView(): void {
    if (!this.hollowState) return;
    const next = this.hollowState.view === 'inhabit' ? 'manager' : 'inhabit';
    this.hollowState = setHollowView(this.hollowState, next);
    if (next === 'manager') this.input.releaseLock();
    this.hollowHud?.sync(this.hollowState);
  }

  private hollowFrame(dt: number): void {
    const view = this.hollowView;
    const hud = this.hollowHud;
    let state = this.hollowState;
    if (!view || !hud || !state) return;

    if (this.input.clicked(0) || this.input.pressed('Space')) this.sfx.unlock();
    if (state.view === 'inhabit' && !this.input.locked && this.input.clicked(0)) {
      this.input.requestLock();
    }
    if (this.input.pressed('KeyE')) {
      const before = state.cleared;
      state = hollowInteract(state);
      if (state.cleared && !before) this.sfx.good();
      else if (state.line) this.sfx.interact();
      else this.sfx.deny();
    }
    state = view.drive(state, this.input, dt);
    this.hollowState = state;
    // Driven, not skipped: the gate above is only obeyed by a frame that runs.
    this.driveAmbience(dt, null);
    view.sync(state, dt);
    this.viewport.render(view.camera(state));
    hud.sync(state);
  }

  private toggleView(): void {
    if (this.mode === 'manager') {
      const target = inhabitableId(
        this.world,
        this.possessedId,
        this.manager.selection?.type === 'pawn' ? this.manager.selection.id : null,
      );
      if (target === null) {
        msg(this.world, 'There is nobody left to inhabit.', 'bad');
        return;
      }
      this.enterFps(target);
    } else {
      this.exitFps(null);
    }
  }

  private enterFps(pawnId: number): void {
    const p = findPawn(this.world, pawnId);
    if (!p || p.dead || p.faction !== 'colony') {
      msg(this.world, 'That body cannot be inhabited.', 'bad');
      this.sfx.deny();
      return;
    }
    const body = possess(this.world, pawnId);
    if (!body) return;
    this.possessedId = pawnId;
    this.mode = 'fps';
    this.fps.attach(body);
    this.manager.selection = { type: 'pawn', id: pawnId };
    this.manager.setTool('select');
    if (this.speed > 1) this.setSpeed(1); // first person runs at life speed
    this.onResize();
    this.sfx.unlock();
    this.sfx.swap(false);
    msg(this.world, `You are ${body.name}.`, 'info');
  }

  /**
   * Hand control back to the manager. Possession is released so the settler resumes
   * ordinary work, but the id is remembered so V drops you straight back in.
   */
  private exitFps(reason: string | null): void {
    const p = this.playerPawn();
    releasePossession(this.world);
    this.input.releaseLock();
    this.mode = 'manager';
    if (p) {
      this.cam.focusOn(p.x, p.y);
      this.manager.selection = { type: 'pawn', id: p.id };
      this.possessedId = p.dead ? null : p.id;
    }
    if (reason) {
      msg(this.world, reason, 'bad');
      const next = livingColonists(this.world).find((q) => !q.downed);
      if (next) this.manager.selection = { type: 'pawn', id: next.id };
      this.possessedId = next ? next.id : null;
    }
    this.onResize();
    this.sfx.swap(true);
  }

  private playerPawn(): Pawn | null {
    return this.world.pawns.find((q) => q.playerControlled) ?? null;
  }

  // ---------------------------------------------------------------- commands

  private setSpeed(mult: number): void {
    // Time control belongs to the manager. In a body you get 1× or pause.
    this.speed = this.mode === 'fps' ? Math.min(1, mult) : mult;
    this.accumulator = 0;
    this.sfx.click();
  }

  private setResearch(id: ResearchId | null): void {
    if (!setProject(this.world, id)) {
      this.sfx.deny();
      return;
    }
    msg(
      this.world,
      id === null
        ? 'Research set aside.'
        : `Research: ${RESEARCH[id].label}. ${RESEARCH[id].blurb}`,
      'info',
    );
    this.sfx.click();
  }

  private acceptTrade(offerId: number): void {
    const r = acceptOffer(this.world, offerId);
    if (!r.ok) {
      msg(this.world, r.text, 'bad');
      this.sfx.deny();
      return;
    }
    this.sfx.click();
  }

  private setQuality(q: Quality): void {
    this.quality = q;
    const settings = this.viewport.setQuality(q);
    this.view.applyQuality(settings);
    this.onResize();
    this.sfx.click();
  }

  private cancelBuilding(id: number): void {
    const b = this.world.buildings.find((q) => q.id === id);
    if (!b) return;
    // Reuse the manager's own tools so a HUD button cannot do anything the
    // in-world commands cannot.
    this.manager.setTool(b.built ? 'deconstruct' : 'cancel');
    this.manager.selection = { type: 'building', id };
    msg(
      this.world,
      b.built ? 'Deconstruct tool armed — click the structure.' : 'Cancel tool armed — click the blueprint.',
      'info',
    );
    this.sfx.click();
  }

  private save(): void {
    const ok = saveGame(this.world, this.viewState(), this.speed, Date.now());
    msg(this.world, ok ? 'Colony saved.' : 'Save failed — is storage full?', ok ? 'good' : 'bad');
    if (ok) this.sfx.good();
    else this.sfx.bad();
  }

  private viewState(): { mode: ViewMode; possessedId: number | null; camera: CameraState } {
    return { mode: this.mode, possessedId: this.possessedId, camera: this.cam.state };
  }

  /**
   * Quiet, unattended save. No message and no sound: it happens every minute and
   * on the way out of the page, and a colony sim that chirped at you for it would
   * be unbearable. The Continue button is the only thing that shows it happened.
   */
  private autosave(): void {
    this.sinceAutosave = 0;
    if (saveGame(this.world, this.viewState(), this.speed, Date.now(), 'auto')) {
      this.autosaveExists = true;
    }
  }

  /** Leaving the page — a refresh, a closed tab, a dev-server reload — keeps the colony. */
  private readonly onUnload = (): void => {
    this.autosave();
  };

  private load(slot: 'manual' | 'auto' = 'manual'): void {
    const res = loadGame(slot);
    if (!res.ok) {
      msg(this.world, `Load failed: ${res.detail}`, 'bad');
      this.sfx.bad();
      return;
    }
    const { world, view, speed } = res.save;
    this.adopt(world, view.camera);
    this.speed = speed;
    this.possessedId = view.possessedId;
    if (view.mode === 'fps' && view.possessedId !== null) this.enterFps(view.possessedId);
    else {
      releasePossession(this.world);
      this.mode = 'manager';
    }
    msg(this.world, slot === 'auto' ? 'Picked up where you left off.' : 'Colony restored.', 'good');
    this.sfx.good();
  }

  /**
   * Take a colony in from a pasted code. Resolves to null when it worked, or to
   * the sentence to put in front of the player when it did not.
   *
   * Writes the manual slot on the way in, which `load()` has no reason to do.
   * The player is here because a colony went missing when an address changed —
   * landing it in *this* origin's storage is the thing that stops it happening
   * again, and leaving that to the next autosave would mean a closed tab in the
   * next sixty seconds costs them the rescue.
   */
  private async adoptCode(code: string): Promise<string | null> {
    const res = await importColony(code);
    if (!res.ok) {
      this.sfx.bad();
      return res.reason === 'empty' ? 'Paste a colony code into the box first.' : res.detail;
    }
    const { world, view, speed } = res.save;
    this.adopt(world, view.camera);
    this.speed = speed;
    this.possessedId = view.possessedId;
    if (view.mode === 'fps' && view.possessedId !== null) this.enterFps(view.possessedId);
    else {
      releasePossession(this.world);
      this.mode = 'manager';
    }
    // The line goes in before the slots are written, so what a player reads in
    // the log is what a reload gives them back — not a save of the moment just
    // before the confirmation they actually saw.
    msg(this.world, 'The colony is here, and saved to this address.', 'good');
    saveGame(this.world, this.viewState(), this.speed, Date.now());
    this.autosave();
    this.sfx.good();
    return null;
  }

  /**
   * Start over.
   *
   * Options are optional and default to what the button always did — a random
   * valley on the standard setting — so nothing that just wants a fresh world
   * has to know about the setup card. A seed of null means roll one; a seed
   * given means the player typed it, and they get that exact valley.
   */
  private restart(opts?: { difficulty: Difficulty; seed: number | null }): void {
    clearSave(); // both slots: starting over must not leave an autosave to walk back into
    this.autosaveExists = false;
    this.sinceAutosave = 0;
    const seed = opts?.seed ?? Math.floor(Math.random() * 1e9);
    this.adopt(createWorld(seed, opts?.difficulty ?? 'settler'), null);
    this.mode = 'manager';
    this.possessedId = null;
    this.speed = 1;
    msg(this.world, `A new colony lands. Valley ${seed}.`, 'good');
  }

  /** Swap in a different world. The view layer is rebuilt because it is sized to the map. */
  private adopt(world: World, camera: CameraState | null): void {
    this.view.dispose();
    this.world = world;
    this.streams = makeStreams(world);
    this.view = new WorldView(this.viewport, world);
    this.view.applyQuality(QUALITY[this.quality]);
    this.cam = new ManagerCamera(world, camera ?? defaultCamera(world));
    this.manager = new ManagerController(this.cam, { possess: (id) => this.enterFps(id) });
    this.seenMessages = world.messages.length;
    this.hud.clearCards();
    this.seenBuilt = world.stats.built;
    this.seenProjectileId = 0;
    this.accumulator = 0;
    this.view.onTick(world);
    this.onResize();
  }

  // ---------------------------------------------------------------- plumbing

  private readonly onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.viewport.resize(w, h);
    const aspect = w / Math.max(1, h);
    this.cam.resize(aspect);
    this.fps.resize(aspect);
    this.hollowView?.resize(aspect);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeunload', this.onUnload);
    this.input.dispose();
    this.leaveHollow();
    this.view.dispose();
    this.viewport.dispose();
    this.ambience.stop();
    this.sfx.dispose();
  }
}
