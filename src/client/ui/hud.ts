/**
 * The HUD. Plain DOM over the canvas: one manager layer, one first-person layer,
 * both reading the same world object the renderer just drew. Nothing here holds
 * game state — if a number appears on screen it was read from the sim this frame,
 * which is why the two views can never show different needs for the same settler.
 */

import { BUILD_GROUPS, defOf, isBed } from '../../sim/buildings';
import { SKILL_NAMES, WORK_TYPES } from '../../sim/types';
import { clockString, dayNumber } from '../../sim/clock';
import { DAYS_PER_SEASON, dayOfSeason, seasonLabel, seasonOf } from '../../sim/seasons';
import {
  countResource,
  findBuilding,
  findItem,
  findPawn,
  livingColonists,
  spendableResource,
} from '../../sim/world';
import { describeTarget } from '../../sim/interact';
import {
  buildingUnlocked,
  RESEARCH,
  RESEARCH_ORDER,
  available,
  researchFraction,
  researchNeeds,
  researchStalled,
} from '../../sim/research';
import type { ResearchDef, ResearchId } from '../../sim/research';
import { weatherLabel } from '../../sim/weather';
import { isBreaking, moodBreakdown } from '../../sim/needs';
import { tediumOf } from '../../sim/tedium';
import { alerts } from '../../sim/alerts';
import { idleReason } from '../../sim/idle';
import { nextObjectives, objectiveScore } from '../../sim/objectives';
import { HOLD_DAYS, charters, foundingLeft, hasWon } from '../../sim/victory';
import { roads } from '../../sim/roads';
import { AILMENTS, COLD_BELOW, comfortAt, worstAilment } from '../../sim/health';
import { currentTrader, ticksLeft } from '../../sim/trade';
import { TICKS_PER_DAY } from '../../sim/types';
import { ticksUntilRipe, yieldOf } from '../../sim/husbandry';
import { animalSex, bodyScale, MATURE_TICKS, maturity } from '../../sim/livestock';
import { ageOf, ANIMALS, lifeStage } from '../../sim/wildlife';
import { isPet, keeperOf, PET_HEEL, petName, petOf } from '../../sim/pets';
import { traitsOf } from '../../sim/traits';
import { courtedFor, partnerOf } from '../../sim/partners';
import { bondLabel, bondsOf, FRIEND, RIVAL } from '../../sim/social';
import { memoriesOf } from '../../sim/lifelog';
import { cellTemp, outdoorTemp, tempLabel } from '../../sim/temperature';
import { roomAt, type Room } from '../../sim/rooms';
import { BEAUTY_GOOD, beautyLabel, roomBeauty, surroundings } from '../../sim/beauty';
import { recLabel } from '../../sim/recreation';
import { STACK_MAX, controlStack } from '../../sim/queue';
import { stewardOn } from '../../sim/steward';
import {
  PACK_SIZES,
  bestTalker,
  CARAVAN_PARTIES_MAX,
  caravanDaysLeft,
  caravansOf,
  partiesCommitted,
  packMultiple,
  quote,
  rateReasons,
  settlementById,
  settlementsOf,
  socialOf,
  specialty,
  roundTripDays,
  withinRange,
} from '../../sim/settlements';
import {
  WAR_PARTY,
  garrisonSize,
  holdingById,
  holdingsOf,
  planCampaign,
  tributeOf,
  warDaysLeft,
  warPartyOf,
} from '../../sim/holdings';
import {
  ENDING_DAYS,
  type EndingId,
  type EndingProgress,
  endingOffer,
  endingProgress,
  endingRecord,
  endingsOpen,
} from '../../sim/endings';
import { commissionDaysLeft, commissionOf, satisfies } from '../../sim/commissions';
import { CRAFT_DEFS, RECIPE_ORDER, bestCrafter, canCraft, craftBlocker, pawnQualified, unlockedBy } from '../../sim/crafting';
import { PASSION_LABEL, SKILL_TITLE, passionOf } from '../../sim/skills';
import { EQUIP, apparelOf, gearOf } from '../../sim/gear';
import {
  BATTERY_CAPACITY,
  DRAW,
  GENERATOR_OUTPUT,
  batteryPercent,
  isElectrical,
  millOutput,
  powerLabel,
  solarOutput,
} from '../../sim/power';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../../sim/difficulty';
import type {
  Building,
  BuildingKind,
  Difficulty,
  Job,
  Message,
  Pawn,
  ResourceKind,
  World,
  WorkType,
} from '../../sim/types';
import { type Box, cardChannel, ToastStack } from './toasts';
import { Minimap } from './minimap';
import type { Quality } from '../render/renderer';
import type { Selection, Tool } from '../manager/controller';
import type { ViewMode } from '../../sim/save';
import { colonyFilename } from '../../sim/transfer';

export interface HudHooks {
  setSpeed(mult: number): void;
  save(): void;
  load(): void;
  /**
   * Start over. Absent options means "the same thing the button always did" —
   * a random seed on `settler` — so the game-over card and anything else that
   * just wants a fresh valley does not have to know the setting exists.
   */
  restart(opts?: { difficulty: Difficulty; seed: number | null }): void;
  setQuality(q: Quality): void;
  select(sel: Selection | null): void;
  possess(pawnId: number): void;
  setDraft(pawnId: number, on: boolean): void;
  setHunted(pawnId: number, on: boolean): void;
  /** Give somebody's bonded animal back to the herd — see `sim/pets.ts`. */
  releaseAnimal(pawnId: number): void;
  setTamed(pawnId: number, on: boolean): void;
  setPriority(pawnId: number, work: WorkType, level: number): void;
  setTool(tool: Tool, kind: BuildingKind | null): void;
  setResearch(id: ResearchId | null): void;
  acceptTrade(offerId: number): void;
  /** Load a pack and walk it over the ridge. See `sim/settlements.ts`. */
  sendCaravan(pawnId: number, settlementId: number, kind: ResourceKind, amount: number): void;
  /**
   * March on a holding. No pawn id, unlike the caravan: the colony does not get
   * to choose who goes to war — `planCampaign` picks the three who are most use
   * in a fight, and a panel that offered the choice would be offering the player
   * a way to send the three it can most afford to lose. See `sim/holdings.ts`.
   */
  sendWarParty(holdingId: number): void;
  /**
   * Commit the colony to how this run ends, or give up the one it committed to.
   * No confirmation dialog on either: the commitment is refusable for twelve
   * days and the abandonment is a link the size of the one that hides the
   * tutorial, which is the same weight the rest of this HUD gives a decision
   * you can walk back. See `sim/endings.ts`.
   */
  commitEnding(id: EndingId): void;
  abandonEnding(): void;
  cancelBuilding(buildingId: number): void;
  switchView(): void;
  loadAutosave(): void;
  /**
   * The colony as text the player can carry to another address. See
   * `sim/transfer.ts` — storage is per-origin, so this is the only way a colony
   * survives the URL changing.
   */
  colonyCode(): Promise<string>;
  /** Take a pasted code. Resolves to null on success, or why it was refused. */
  loadColonyCode(code: string): Promise<string | null>;
  /** Turn the colony's own building plans on or off. See `sim/steward.ts`. */
  setSteward(on: boolean): void;
  /** Take a settler off the work board and drive them by hand. See `sim/orders.ts`. */
  setManual(pawnId: number, on: boolean): void;
  /** Drop one entry from a settler's control stack. See `sim/queue.ts`. */
  cancelStackEntry(pawnId: number, jobId: number): void;
  /** Put the colony camera on a cell — what clicking an alert does. */
  focus(x: number, y: number): void;
  /**
   * Summon a Picky on an errand that needs no target cell — a tour of the
   * colony's own buildings or doors, the hauling chain, or one it picks itself.
   * See `sim/pickies.ts`.
   */
  sendPickyErrand(kind: 'rounds' | 'doors' | 'fetch' | 'surprise'): void;
}

export interface HudState {
  world: World;
  view: ViewMode;
  speed: number;
  selection: Selection | null;
  tool: Tool;
  buildKind: BuildingKind | null;
  quality: Quality;
  possessed: Pawn | null;
  fps: number;
  /**
   * Where the four corners of the screen land on the ground, for the minimap's
   * viewport outline. Null in first person, and null whenever the colony camera
   * has the horizon in shot — see `ManagerCamera.viewQuad`.
   */
  viewQuad?: { x: number; y: number }[] | null;
}

/**
 * The two tabs that are not buildings, split on what the click *does*: a zone is
 * a rectangle you paint on the ground and leave there, an order is a thing you
 * point at once and the colony goes and does. Lumping them together was most of
 * why "chop a tree" and "mark a stockpile" felt like the same button.
 */
/** The errand kinds that need no target cell, so they are a tile you press once. */
type PickyErrand = 'rounds' | 'doors' | 'fetch' | 'surprise';

const TOOL_GROUPS: { name: string; tools: [Tool, string, string, string, PickyErrand?][] }[] = [
  {
    name: 'Zones',
    tools: [
      ['stockpile', 'Z', 'Stockpile', 'Where hauled things get put down.'],
      ['grow', 'B', 'Grow zone', 'Sow, tend and harvest — the renewable food.'],
      ['pen', 'Y', 'Animal pen', 'Tamed animals are kept inside it.'],
      ['till', 'N', 'Till soil', 'Turn rough ground into something that will grow.'],
    ],
  },
  {
    name: 'Floors',
    tools: [
      ['floorPlank', 'I', 'Plank floor', '3 wood a cell. Walk a quarter faster over it.'],
      ['floorPaved', 'O', 'Paved floor', '2 steel a cell. Fastest underfoot, and fire will not cross it.'],
      ['floorBridge', 'U', 'Bridge', '6 wood a cell. Deck the lake over — built outward from the bank.'],
    ],
  },
  {
    name: 'Orders',
    tools: [
      ['harvest', 'C', 'Chop/Mine', 'Drag over trees or rock to take it down.'],
      ['hunt', 'H', 'Hunt', 'Mark an animal. A hunter goes and shoots it.'],
      ['tame', 'K', 'Tame', 'Mark an animal to be kept rather than eaten.'],
      ['deconstruct', 'X', 'Deconstruct', 'Take a building — or a laid floor — back down for half its stuff.'],
      ['cancel', '⌫', 'Cancel', 'Rub out a zone, blueprint or order.'],
      ['select', 'Esc', 'Select', 'Back to clicking on things.'],
    ],
  },
  // Its own tab rather than a fifth entry under Orders, because nothing in here
  // is an order: a Picky does no work, costs nothing and changes nothing. It goes
  // and finds out. Mixing that in with "chop this tree" is how a player concludes
  // the goblins are staff.
  {
    name: 'Check',
    tools: [
      ['picky', '`', 'Send a Picky', 'Click anywhere. A pink goblin runs there and says whether it made it.'],
      ['picky', '`', 'Picky rounds', 'One Picky checks the colony can still reach six of its own buildings.', 'rounds'],
      ['picky', '`', 'Try the doors', 'One Picky walks through six doors. A door walled in on both sides looks fine and is not.', 'doors'],
      ['picky', '`', 'Check hauling', 'One Picky walks from something on the ground to the store it belongs in.', 'fetch'],
      ['picky', '`', 'Surprise me', 'One Picky picks its own errand and goes and finds something you did not think to ask about.', 'surprise'],
    ],
  },
];

/** How big the drag corner is, in px. Matches the grip drawn in the stylesheet. */
const GRIP = 20;
/**
 * Alerts shown at once. A colony in real trouble raises a dozen at a time and a
 * wall of red is the same as no alert at all — the worst six are the ones the
 * player can act on this minute, and the rest follow as those clear.
 */
const MAX_ALERTS = 6;
/** Milestones shown at once. Three is a to-do list; fourteen is wallpaper. */
const MAX_GOALS = 3;
const LAYOUT_KEY = 'aetherhold.hud.v1';

/**
 * Where the player has put their panels. Kept apart from the save file: a colony
 * is a thing you can lose, and nobody wants their window layout to go with it.
 */
interface PanelLayout {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  folded?: boolean;
}

function loadLayout(): Record<string, PanelLayout> {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PanelLayout>) : {};
  } catch {
    // Private browsing, a corrupt entry, a hand-edited value — none of which is
    // worth refusing to draw a HUD over.
    return {};
  }
}

function saveLayout(layout: Record<string, PanelLayout>): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* a layout that cannot be remembered is still a layout that works */
  }
}

/**
 * Whether the player has switched the curriculum off.
 *
 * Its own key rather than a flag on the goals panel's layout, for one reason:
 * "Reset panels" exists for a layout somebody has tied in a knot, and handing
 * the tutorial back to a player who deliberately turned it off would be a reset
 * they did not ask for. It is also not in the save — a player who has played
 * before has played before, whatever colony they start next.
 *
 * Only "Next steps" answers to it. The founding charters stay: they are the win
 * condition, not tutoring, and a player who does not want to be taught still
 * needs to be told what the game is asking of them.
 */
const GUIDE_KEY = 'aetherhold.guide.v1';

function loadGuideOff(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === 'off';
  } catch {
    // Same reasoning as the layout: nothing here is worth refusing to draw over.
    return false;
  }
}

function saveGuideOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(GUIDE_KEY, 'off');
    else localStorage.removeItem(GUIDE_KEY);
  } catch {
    /* it still applies for this session */
  }
}

const SPEEDS = [0, 1, 2, 3];
const RESOURCE_ROW: ResourceKind[] = [
  'wood',
  'steel',
  'rawfood',
  'meal',
  'medicine',
  'hide',
  'components',
  'assemblies',
];
const RESOURCE_LABEL: Record<ResourceKind, string> = {
  wood: 'Wood',
  steel: 'Steel',
  rawfood: 'Raw',
  meal: 'Meals',
  medicine: 'Meds',
  hide: 'Hides',
  components: 'Parts',
  // Short, like every other label in this row — the strip is read at a glance
  // and "Assemblies" is twice the width of anything beside it.
  assemblies: 'Rigs',
};

/**
 * A project's material bill, and how much of it is already in the yard.
 *
 * Counted with `spendableResource` rather than the headline stock, because that
 * is what the bench will actually be able to pay with — a bill that reads
 * "180 / 180" off a number including the crate in a hauler's arms, next to a
 * project that then refuses to finish, is the panel lying to the player.
 */
function billHtml(world: World, def: ResearchDef): string {
  const bill = Object.entries(def.materials ?? {}) as Array<[ResourceKind, number]>;
  return bill
    .map(([kind, want]) => {
      const have = Math.min(want, spendableResource(world, kind));
      return `<span class="${have >= want ? 'paid' : 'owed'}">${have} / ${want} ${escapeHtml(RESOURCE_LABEL[kind].toLowerCase())}</span>`;
    })
    .join('');
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly hooks: HudHooks;

  private readonly clock: HTMLElement;
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly resources = new Map<ResourceKind, HTMLElement>();
  private readonly qualityBtn: HTMLButtonElement;
  private readonly continueBtn: HTMLButtonElement;
  private readonly colonists: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly buildbar: HTMLElement;
  private readonly buildTiles = new Map<string, HTMLElement>();
  private readonly groupTabs = new Map<string, HTMLElement>();
  private readonly groupRows = new Map<string, HTMLElement>();
  private readonly log: HTMLElement;
  private readonly alertPanel: HTMLElement;
  private readonly goalPanel: HTMLElement;
  private readonly worktab: HTMLElement;
  private readonly researchtab: HTMLElement;
  private readonly tradetab: HTMLElement;
  private readonly tradeBtn: HTMLButtonElement;
  private readonly roadtab: HTMLElement;
  private readonly roadBtn: HTMLButtonElement;
  private readonly chronicletab: HTMLElement;
  private readonly chronicleBtn: HTMLButtonElement;
  private readonly stewardBtn: HTMLButtonElement;
  private readonly researchPip: HTMLElement;
  private readonly power: HTMLElement;
  private readonly managerLayer: HTMLElement;
  private readonly fpsLayer: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly selfPanel: HTMLElement;
  private readonly lockHint: HTMLElement;
  private readonly helpOverlay: HTMLElement;
  private readonly backupOverlay: HTMLElement;
  private readonly setupOverlay: HTMLElement;
  private readonly overOverlay: HTMLElement;
  private readonly overCard: HTMLElement;
  /**
   * Which ending has already had its card, so a founding is shown once and then
   * gets out of the way. A colony can have all three in one run — found the
   * place on day thirty, sail on day fifty, and lose what stayed behind on day
   * ninety — and each still deserves its card, so this is the ending that was
   * shown rather than a boolean. A terminal counts as its own id, because there
   * is no run in which two of them land.
   */
  private endingShown: 'none' | 'won' | 'lost' | EndingId = 'none';
  private readonly cards: HTMLElement;
  /** The card stack's arithmetic. See `ui/toasts.ts`. */
  private readonly minimap: Minimap;
  private readonly toasts = new ToastStack();
  private readonly cardEls = new Map<number, HTMLElement>();

  private rows = new Map<number, ColonistRow>();
  private rowSig = '';
  private logSig = '';
  private alertSig = '';
  private goalSig = '';
  private workSig = '';
  private cardSig = '';
  /** What the Steward button currently says, so clicking it means "the other one". */
  private stewardShown = true;
  private readonly movable = new Map<string, HTMLElement>();
  private layout = loadLayout();
  private guideOff = loadGuideOff();
  /** Set while `buildHelp` runs, which the constructor calls. */
  private guideBtn!: HTMLButtonElement;
  /** Set while `buildBackup` runs, which the constructor calls. */
  private codeBox!: HTMLTextAreaElement;
  private codeNote!: HTMLElement;
  /** Set while `buildSetup` runs, which the constructor calls. */
  private seedBox!: HTMLInputElement;
  private setupCards!: Map<Difficulty, HTMLElement>;
  /**
   * What the setup card is currently pointing at. Lives on the HUD rather than
   * in the DOM so the card reopens on the setting the player last landed with —
   * a player who has decided the valley is too hard should not have to decide it
   * again every time they lose.
   */
  private setupPick: Difficulty = 'settler';
  /** Kept off the clock so a downloaded backup can be named for the day it holds. */
  private lastDay = 1;
  private activeGroup = BUILD_GROUPS[0]!.name;
  private toolSig = '';
  private worktabOpen = false;
  private researchOpen = false;
  private researchSig = '';
  private tradeOpen = false;
  private tradeSig = '';
  private roadOpen = false;
  private roadSig = '';
  private chronicleOpen = false;
  private chronicleSig = '';

  constructor(root: HTMLElement, hooks: HudHooks) {
    this.root = root;
    this.hooks = hooks;

    this.managerLayer = el('div', 'managerlayer');
    this.fpsLayer = el('div', '', { id: 'fpshud' });
    this.root.append(this.managerLayer, this.fpsLayer);

    // ---- top bar (shared: the clock is the same clock in both views) ----
    const top = el('div', 'panel', { id: 'topbar' });
    this.clock = el('div', '', { id: 'clock' });
    const speeds = el('div', '', { id: 'speeds' });
    for (const s of SPEEDS) {
      const b = el('button', '', {}, s === 0 ? '❙❙' : `${s}×`) as HTMLButtonElement;
      b.title = s === 0 ? 'Pause (Space)' : `${s}× speed`;
      b.onclick = () => this.hooks.setSpeed(s);
      this.speedBtns.push(b);
      speeds.append(b);
    }
    const res = el('div', '', { id: 'resources' });
    for (const k of RESOURCE_ROW) {
      const span = el('span', 'num');
      span.innerHTML = `<i>${RESOURCE_LABEL[k]}</i><b>0</b>`;
      this.resources.set(k, span.querySelector('b')!);
      res.append(span);
    }
    // Watts sit with the resources because that is what they are: a stock the
    // colony spends. Hidden entirely until there is something on the grid, so a
    // colony with no machines is not shown a meter reading nothing.
    this.power = el('span', 'num');
    this.power.innerHTML = '<i>power</i><b>—</b>';
    this.power.title = 'Made / wanted right now, and what the batteries are holding';
    this.power.style.display = 'none';
    res.append(this.power);

    // A thin progress pip beside the resources: a project runs for days, and the
    // player should be able to see it moving without opening a panel to check.
    this.researchPip = el('div', '', { id: 'researchpip' });
    this.researchPip.style.display = 'none';
    res.append(this.researchPip);

    const sys = el('div', '', { id: 'sysbtns' });
    this.qualityBtn = el('button', 'btn', {}, 'Quality: high') as HTMLButtonElement;
    this.qualityBtn.onclick = () => this.cycleQuality();
    const viewBtn = el('button', 'btn strong', {}, 'Step inside (V)') as HTMLButtonElement;
    viewBtn.title = 'Possess a settler and walk the base yourself';
    viewBtn.onclick = () => this.hooks.switchView();
    const workBtn = el('button', 'btn', {}, 'Work (P)') as HTMLButtonElement;
    workBtn.onclick = () => this.toggleWorkTab();
    const techBtn = el('button', 'btn', {}, 'Research (L)') as HTMLButtonElement;
    techBtn.title = 'Choose what the colony is working out at the research bench';
    techBtn.onclick = () => this.toggleResearchTab();
    // Hidden between caravans. A button that is only ever live for half a day
    // every five days is itself the notification that somebody is here.
    this.tradeBtn = el('button', 'btn strong', {}, 'Trade (M)') as HTMLButtonElement;
    this.tradeBtn.title = 'Deal with the caravan standing in the yard';
    this.tradeBtn.style.display = 'none';
    this.tradeBtn.onclick = () => this.toggleTradeTab();
    // Always live, unlike the shop button: the neighbours are there whether or
    // not anybody is standing in the yard, and finding out who they are is half
    // of what the panel is for.
    this.roadBtn = el('button', 'btn', {}, 'Road (J)') as HTMLButtonElement;
    this.roadBtn.title = 'Send a settler over the ridge to trade with the neighbours';
    this.roadBtn.onclick = () => this.toggleRoadTab();
    // The colony's memory. Next to the Road button because both are things you
    // open, read and close, rather than instruments that sit on screen.
    this.chronicleBtn = el('button', 'btn', {}, 'Story (;)') as HTMLButtonElement;
    this.chronicleBtn.title =
      'Everything that has happened to this colony, newest first. Semicolon — the key beside L.';
    this.chronicleBtn.onclick = () => this.toggleChronicleTab();
    // The colony's own foreman. On by default, and a button rather than a buried
    // setting because a player who does not want their yard rearranged has to be
    // able to find the off switch in the same second they notice it happening.
    this.stewardBtn = el('button', 'btn', {}, 'Steward: on') as HTMLButtonElement;
    this.stewardBtn.title = 'Let the colony mark out its own improvements when you have nothing queued';
    this.stewardBtn.onclick = () => this.hooks.setSteward(!this.stewardShown);
    const saveBtn = el('button', 'btn', {}, 'Save') as HTMLButtonElement;
    saveBtn.onclick = () => this.hooks.save();
    const loadBtn = el('button', 'btn', {}, 'Load') as HTMLButtonElement;
    loadBtn.title = 'Restore the colony you last saved by hand';
    loadBtn.onclick = () => this.hooks.load();
    // Hidden until an autosave exists, so a fresh colony has no button that lies.
    this.continueBtn = el('button', 'btn', {}, 'Continue') as HTMLButtonElement;
    this.continueBtn.title = 'Pick up the automatic save (written every minute and when you leave the page)';
    this.continueBtn.style.display = 'none';
    this.continueBtn.onclick = () => this.hooks.loadAutosave();
    // Sits with Save and Load because it belongs to that family, and in the top
    // bar rather than buried in the help card because the day it is needed is
    // the day the colony has already vanished from this address — a player
    // hunting for it then has no reason to believe it exists at all.
    const backupBtn = el('button', 'btn', {}, 'Backup') as HTMLButtonElement;
    backupBtn.title = 'Copy the colony out as text, or paste one in — survives a changed address';
    backupBtn.onclick = () => this.openBackup();
    const helpBtn = el('button', 'btn', {}, '?') as HTMLButtonElement;
    helpBtn.onclick = () => this.toggleHelp();
    sys.append(viewBtn, workBtn, techBtn, this.tradeBtn, this.roadBtn, this.chronicleBtn, this.stewardBtn, this.qualityBtn, saveBtn, loadBtn, this.continueBtn, backupBtn, helpBtn);
    top.append(this.clock, speeds, res, sys);
    this.root.append(top);

    // ---- manager-only furniture ----
    this.colonists = el('div', '', { id: 'colonists' });
    this.inspector = el('div', 'panel', { id: 'inspector' });
    this.buildbar = el('div', 'panel', { id: 'buildbar' });
    this.log = el('div', 'panel', { id: 'log' });
    this.alertPanel = el('div', 'panel', { id: 'alerts' });
    this.goalPanel = el('div', 'panel', { id: 'goals' });
    this.worktab = el('div', 'panel', { id: 'worktab' });
    this.researchtab = el('div', 'panel', { id: 'researchtab' });
    this.tradetab = el('div', 'panel', { id: 'tradetab' });
    this.roadtab = el('div', 'panel', { id: 'roadtab' });
    this.chronicletab = el('div', 'panel', { id: 'chronicletab' });
    this.managerLayer.append(
      this.colonists,
      this.inspector,
      this.buildbar,
      this.log,
      this.alertPanel,
      this.goalPanel,
      this.worktab,
      this.researchtab,
      this.tradetab,
      this.roadtab,
      this.chronicletab,
    );
    this.buildBuildBar();
    // The four panels that sit on top of the world. The bar stays where it is:
    // it is the control surface, and the bottom of the screen is where it belongs.
    this.makeMovable(this.colonists, 'colonists', 'Settlers');
    this.makeMovable(this.inspector, 'inspector', 'Details');
    this.makeMovable(this.log, 'log', 'Log');
    this.makeMovable(this.alertPanel, 'alerts', 'Alerts');
    this.makeMovable(this.goalPanel, 'goals', 'Goals');

    // The one panel that belongs to neither layer. Everything else on screen is
    // either the colony view's instrument or the body's; the map of the valley is
    // the same map from both, and it is worth most in the view where you cannot
    // see over the next ridge. So it hangs off the root and survives the switch.
    this.minimap = new Minimap((x, y) => this.hooks.focus(x, y));
    this.root.append(this.minimap.el);
    this.makeMovable(this.minimap.el, 'minimap', 'Map');
    addEventListener('resize', () => this.reclamp());

    // Every panel that hangs below the top bar used to hard-code the drop at
    // 52px, which is only true while the bar is one row tall. It is not: the
    // clock wraps as soon as the weather word is long or the window is narrow,
    // and at 1280x800 the bar grew past the guess and ate the first settler's
    // name. Publish the height the bar actually has and let the CSS subscribe.
    const publishBarHeight = () => {
      this.root.style.setProperty('--topbar-h', `${Math.round(top.getBoundingClientRect().height)}px`);
    };
    publishBarHeight();
    new ResizeObserver(publishBarHeight).observe(top);

    // Same trick at the other end of the screen. On a tablet the build bar owns
    // the bottom band and the log and alerts sit above it — but the bar is one
    // row taller whenever the tabs wrap, so the gap has to be measured rather
    // than guessed.
    const publishBuildHeight = () => {
      this.root.style.setProperty('--buildbar-h', `${Math.round(this.buildbar.getBoundingClientRect().height)}px`);
    };
    publishBuildHeight();
    new ResizeObserver(publishBuildHeight).observe(this.buildbar);

    // ---- first person furniture ----
    this.crosshair = el('div', '', { id: 'crosshair' });
    this.prompt = el('div', 'panel', { id: 'prompt' });
    this.selfPanel = el('div', 'panel', { id: 'selfpanel' });
    this.lockHint = el('div', 'panel', { id: 'lockhint' });
    // Two ways in, because a player who has not grabbed the mouse yet can still
    // only strafe — and a body that slides sideways but never turns round reads
    // as broken rather than as un-clicked.
    this.lockHint.innerHTML =
      '<b>Click</b> to look with the mouse<span>or turn with ← →   ·   ↑ ↓ to look up and down</span>';
    const note = el('div', 'panel', { id: 'fpsnote' });
    note.innerHTML =
      '<b>WASD</b> walk (A/D step sideways) · <b>Shift</b> run<br><b>Mouse</b> or <b>← →</b> turn · <b>E</b> interact · <b>Click</b> attack (drafted)<br><b>V</b> back to colony view';
    this.fpsLayer.append(this.crosshair, this.prompt, this.selfPanel, this.lockHint, note);

    // ---- overlays ----
    // Above the world in both views: the whole point is that it reaches a player
    // who is inside a body on the far side of the map, not just one reading the
    // colony screen.
    this.cards = el('div', '', { id: 'cards' });
    this.root.append(this.cards);
    this.helpOverlay = this.buildHelp();
    this.backupOverlay = this.buildBackup();
    this.setupOverlay = this.buildSetup();
    this.overOverlay = el('div', 'overlay');
    this.overCard = el('div', 'card');
    this.overOverlay.append(this.overCard);
    // Setup last: it is opened *from* the help card and *from* the game-over
    // card, so it has to paint over both of them. Two overlays at the same
    // z-index resolve by document order, and getting this backwards hides the
    // new card behind the one that asked for it.
    this.root.append(this.helpOverlay, this.backupOverlay, this.overOverlay, this.setupOverlay);
  }

  // -------------------------------------------------------------- movable panels

  /**
   * Drag a panel by the grip in its corner, click the grip to fold it away.
   *
   * The grip is a `::before` rather than a child element on purpose: all three of
   * these panels rewrite their own `innerHTML` whenever the world changes, and a
   * child handle would be thrown away with the last frame's text. A pseudo-element
   * is not a child, so it survives — and because a hit on it is reported against
   * the panel itself, `e.target === panel` is exactly the test for "the player
   * grabbed the handle rather than a colonist card inside it".
   */
  private makeMovable(panel: HTMLElement, id: string, name: string): void {
    panel.classList.add('movable');
    panel.dataset.name = name;
    this.movable.set(id, panel);
    this.applyLayout(id, panel);

    let dragging = false;
    let moved = false;
    let offX = 0;
    let offY = 0;
    let downX = 0;
    let downY = 0;
    panel.addEventListener('pointerdown', (e) => {
      if (e.target !== panel) return;
      const r = panel.getBoundingClientRect();
      // Only the top-right corner drags. The bottom-right corner is the browser's
      // own resize handle on the panels that have one, and it has to stay free.
      if (e.clientX < r.right - GRIP || e.clientY > r.top + GRIP) return;
      dragging = true;
      moved = false;
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      downX = e.clientX;
      downY = e.clientY;
      panel.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    panel.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      // A hand that has barely moved is still a click: fold and drag start the
      // same way, and nobody holds a mouse perfectly still.
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 3) moved = true;
      if (moved) this.place(id, panel, e.clientX - offX, e.clientY - offY);
    });
    const end = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      panel.releasePointerCapture(e.pointerId);
      if (!moved) {
        const folded = panel.classList.toggle('folded');
        this.layout[id] = { ...this.layout[id], folded };
      }
      saveLayout(this.layout);
    };
    panel.addEventListener('pointerup', end);
    panel.addEventListener('pointercancel', end);
    // A panel the player has resized keeps the size it was dropped at. Watching
    // for the corner drag ending is enough — the observer would also fire every
    // time the log printed a line, and would save the text's height as a choice.
    panel.addEventListener('mouseup', () => {
      const r = panel.getBoundingClientRect();
      const set = panel.style.width !== '' || panel.style.height !== '';
      if (!set) return;
      this.layout[id] = { ...this.layout[id], w: Math.round(r.width), h: Math.round(r.height) };
      saveLayout(this.layout);
    });
  }

  /** Move a panel, keeping it inside the window whatever the player does. */
  private place(id: string, panel: HTMLElement, x: number, y: number): void {
    const r = panel.getBoundingClientRect();
    const left = Math.max(0, Math.min(innerWidth - r.width, x));
    const top = Math.max(0, Math.min(innerHeight - r.height, y));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    this.layout[id] = { ...this.layout[id], x: Math.round(left), y: Math.round(top) };
  }

  private applyLayout(id: string, panel: HTMLElement): void {
    const saved = this.layout[id];
    if (!saved) return;
    if (saved.folded) panel.classList.add('folded');
    if (saved.w) panel.style.width = `${saved.w}px`;
    if (saved.h) panel.style.height = `${saved.h}px`;
    if (saved.x !== undefined && saved.y !== undefined) this.place(id, panel, saved.x, saved.y);
  }

  /** A window that got smaller must not leave a panel parked outside it. */
  private reclamp(): void {
    for (const [id, panel] of this.movable) {
      const saved = this.layout[id];
      if (saved?.x === undefined || saved.y === undefined) continue;
      this.place(id, panel, saved.x, saved.y);
    }
  }

  /**
   * Turn the curriculum off, or back on.
   *
   * Two ways in on purpose. The ✕ on the panel header is where somebody who is
   * tired of being told what to do will look, and the button in the help card is
   * the only place they would think to look for it afterwards — an opt-out with
   * no visible way back is a setting the player is afraid to touch.
   */
  private setGuide(off: boolean): void {
    this.guideOff = off;
    saveGuideOff(off);
    // The panel only redraws when its contents change, and this changed them.
    this.goalSig = '';
    this.guideBtn.textContent = off ? 'Show next steps' : 'Hide next steps';
  }

  /** Everything back where it started, for a layout somebody has tied in a knot. */
  resetPanels(): void {
    for (const [id, panel] of this.movable) {
      panel.classList.remove('folded');
      panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = '';
      panel.style.width = panel.style.height = '';
      delete this.layout[id];
    }
    saveLayout(this.layout);
  }

  // ------------------------------------------------------------------ build bar

  /**
   * A row of category tabs over a row of tiles, rather than every tile at once.
   *
   * The flat bar was thirty-two tiles by the time the heaters shipped, which is
   * two metres of screen on a 1440-wide laptop: it was centred, so the overflow
   * went off *both* edges and the first four tiles — wall, fence, door, bed, the
   * four things the game opens by asking you to build — were laid out at negative
   * x, where they are not merely hard to click but impossible. Eight tabs of four
   * or five stays inside any screen the game runs on, and stays that way when the
   * next building lands.
   */
  private buildBuildBar(): void {
    const tabs = el('div', 'bartabs');
    this.buildbar.append(tabs);

    const addGroup = (name: string, fill: (row: HTMLElement) => void): void => {
      const tab = el('div', 'bartab clickable', {}, name);
      tab.onclick = () => this.showGroup(name);
      tabs.append(tab);
      this.groupTabs.set(name, tab);
      const row = el('div', 'barrow');
      fill(row);
      this.buildbar.append(row);
      this.groupRows.set(name, row);
    };

    for (const group of BUILD_GROUPS) {
      addGroup(group.name, (row) => {
        for (const kind of group.kinds) {
          const def = defOf(kind);
          const tile = el('div', 'tile clickable');
          const cost = Object.entries(def.cost)
            .map(([k, v]) => `${v} ${k === 'rawfood' ? 'food' : k}`)
            .join(' ');
          tile.innerHTML = `<span class="key">${def.hotkey ?? ''}</span><span class="lbl">${def.label}</span><span class="cost">${cost || '—'}</span>`;
          tile.title = def.blurb ?? '';
          tile.onclick = () => this.hooks.setTool('build', kind);
          this.buildTiles.set(`build:${kind}`, tile);
          row.append(tile);
        }
      });
    }
    for (const group of TOOL_GROUPS) {
      addGroup(group.name, (row) => {
        for (const [tool, key, label, blurb, act] of group.tools) {
          const tile = el('div', 'tile clickable');
          // An action tile has no key to print — it happens on the click rather
          // than arming something the next click will use.
          tile.innerHTML = `<span class="key">${act ? '▸' : key}</span><span class="lbl">${label}</span><span class="cost">&nbsp;</span>`;
          tile.title = blurb;
          tile.onclick = act
            ? () => this.hooks.sendPickyErrand(act)
            : () => this.hooks.setTool(tool, null);
          // Keyed by what it *is*, so an action tile never fights the armed tool
          // for the highlight — it is never armed, so it is never lit.
          this.buildTiles.set(act ? `act:${act}` : `tool:${tool}`, tile);
          row.append(tile);
        }
      });
    }
    this.showGroup(this.activeGroup);
  }

  private showGroup(name: string): void {
    this.activeGroup = name;
    for (const [n, row] of this.groupRows) row.style.display = n === name ? '' : 'none';
    for (const [n, tab] of this.groupTabs) tab.classList.toggle('on', n === name);
  }

  // ------------------------------------------------------------------- updating

  update(s: HudState): void {
    const { world } = s;
    const isManager = s.view === 'manager';
    this.managerLayer.style.display = isManager ? 'block' : 'none';
    this.fpsLayer.style.display = isManager ? 'none' : 'block';

    // The sky changes what crops, fires and gunfire do, so it belongs next to the
    // clock rather than buried in a panel the player has to go looking for.
    const wk = world.weather.kind;
    const weather = `<span style="color:${wk === 'storm' ? 'var(--bad)' : 'var(--dim)'}">${
      weatherLabel(world)
    }</span>`;
    this.lastDay = dayNumber(world);
    // The season sits beside the day because it is the other half of the same
    // fact: day 12 means nothing on its own, day 12 in winter means the plots are
    // dead and the pantry is what is keeping everybody alive. It goes cold-blue
    // in winter so the one season the player has to plan around is the one that
    // changes colour when it arrives.
    const season = seasonOf(world);
    const tint = season === 'winter' ? '#8fc7e8' : 'var(--dim)';
    const calendar = `<span style="color:${tint}">${seasonLabel(world)} ${dayOfSeason(
      world,
    )}/${DAYS_PER_SEASON}</span>`;
    this.clock.innerHTML = `<span class="day">Day ${dayNumber(world)}</span> · ${calendar} · ${clockString(
      world,
    )} · ${weather} <span style="color:var(--dim)">${tempLabel(outdoorTemp(world))}</span>${
      s.fps > 0 ? ` <span style="color:var(--dim)">${Math.round(s.fps)} fps</span>` : ''
    }`;
    const shown = s.speed;
    for (let i = 0; i < this.speedBtns.length; i++) {
      this.speedBtns[i]!.classList.toggle('on', SPEEDS[i] === shown);
      // Time controls belong to the manager; in person you live at one speed.
      this.speedBtns[i]!.disabled = !isManager && SPEEDS[i]! > 1;
      this.speedBtns[i]!.style.opacity = !isManager && SPEEDS[i]! > 1 ? '0.35' : '1';
    }
    for (const k of RESOURCE_ROW) {
      this.resources.get(k)!.textContent = String(countResource(world, k));
    }
    this.syncPower(world);
    this.qualityBtn.textContent = `Quality: ${s.quality}`;
    // Reads off the world rather than off the click, so a loaded save shows the
    // colony's actual state and not the last button the player pressed.
    this.stewardShown = stewardOn(world);
    this.stewardBtn.textContent = `Steward: ${this.stewardShown ? 'on' : 'off'}`;
    this.stewardBtn.classList.toggle('on', this.stewardShown);
    this.syncResearchPip(world);

    this.syncLog(world);
    // Drawn in both views, and told which one it is in by what it is handed: a
    // rectangle of ground when the player is looking down at the valley, the
    // heading of the body they are standing in when they are not.
    this.minimap.update(world, isManager ? s.viewQuad ?? null : null, isManager ? null : s.possessed);

    if (isManager) {
      this.syncAlerts(world);
      this.syncColonists(s);
      // Before the goals panel, which reads whether this one ended up on screen:
      // they share the top-right corner and only one of them can have it.
      this.syncInspector(s);
      this.syncGoals(world);
      this.syncBuildBar(s);
      this.syncWorkTab(s);
      this.syncResearchTab(s);
      this.syncTradeTab(s);
      // After the shop, which closes this one when a pedlar turns up.
      this.syncRoadTab(s);
      this.syncChronicleTab(world);
      this.roadBtn.style.display = '';
      this.chronicleBtn.style.display = '';
    } else {
      this.tradeBtn.style.display = 'none';
      this.roadBtn.style.display = 'none';
      this.roadtab.style.display = 'none';
      this.chronicleBtn.style.display = 'none';
      this.chronicletab.style.display = 'none';
      this.syncFps(s);
    }

    this.syncEnding(world);
  }

  private syncColonists(s: HudState): void {
    const colonists = s.world.pawns.filter((p) => p.faction === 'colony' && !p.dead);
    const sig = colonists.map((p) => p.id).join(',');
    if (sig !== this.rowSig) {
      this.rowSig = sig;
      this.colonists.innerHTML = '';
      this.rows = new Map();
      for (const p of colonists) {
        const row = new ColonistRow(p, (id) => this.hooks.select({ type: 'pawn', id }));
        this.rows.set(p.id, row);
        this.colonists.append(row.el);
      }
    }
    for (const p of colonists) {
      this.rows.get(p.id)?.update(s.world, p, s.selection?.type === 'pawn' && s.selection.id === p.id);
    }
  }

  private syncInspector(s: HudState): void {
    const sel = s.selection;
    if (!sel) {
      this.inspector.style.display = 'none';
      return;
    }
    this.inspector.style.display = 'block';
    if (sel.type === 'pawn') {
      const p = findPawn(s.world, sel.id);
      if (!p) {
        this.inspector.style.display = 'none';
        return;
      }
      // Animals get their own panel: mood, skills and a draft button mean nothing
      // to a deer, and showing them greyed out would only imply they might.
      if (p.animal) {
        const def = ANIMALS[p.animal];
        const state = p.dead ? 'dead' : (p.fleeUntil ?? 0) > s.world.tick ? 'fleeing' : p.activity;
        const marked = p.hunted
          ? p.tame
            ? 'for slaughter'
            : 'for hunting'
          : p.tameTarget
            ? 'to be tamed'
            : 'no';
        // What keeping it alive is worth, next to what killing it is worth. On a
        // wild animal this row is the entire argument for taming one, so it says
        // the rate even before anybody has a pen — the player should be able to
        // read the trade off the panel rather than off the patch notes.
        const y = yieldOf(p);
        let pen = '';
        if (y && !p.dead) {
          const rate = `${y.amount} ${y.kind === 'rawfood' ? 'raw food' : y.kind} of ${y.label}`;
          if (!p.tame) {
            pen = `<div class="kv"><span>if tamed</span><b>${rate} every ${colonyTime(y.every)}</b></div>`;
          } else {
            const left = ticksUntilRipe(s.world, p) ?? y.every;
            pen =
              `<div class="kv"><span>pen</span><b class="${left <= 0 ? 'good' : ''}">` +
              `${left <= 0 ? `${rate} ready` : `${rate} in ${colonyTime(left)}`}</b></div>`;
          }
        }
        // Somebody's animal is a different panel from the colony's: no yield, no
        // slaughter, and the two rows a player actually wants — whose it is, and
        // whether it is with them right now. See `sim/pets.ts`.
        const keeper = keeperOf(s.world, p);
        const kind = isPet(p) ? 'companion' : p.tame ? 'livestock' : 'wild animal';
        // Sex is on the sub line rather than in a row of its own because on most
        // animals it is trivia — it only becomes a fact the player has to act on
        // when there is a pen, and then it is the first thing they will look for.
        const sex = animalSex(p) === 'f' ? '♀' : '♂';
        // And the clock it is on. A calf is worth a quarter of a body and cannot
        // breed; an old one cannot breed either and will die on its own without
        // leaving anything anybody can eat. Both are decisions the player can only
        // make off this line, so both get said in the same place.
        const grown = maturity(s.world, p);
        const stage = lifeStage(s.world, p);
        const age =
          grown < 1
            ? `<div class="kv"><span>calf</span><b>grown in ${colonyTime(Math.ceil((1 - grown) * MATURE_TICKS))}</b></div>`
            : `<div class="kv"><span>age</span><b class="${stage === 'old' ? 'bad' : ''}">` +
              `${colonyAge(ageOf(s.world, p))}${
                stage === 'old'
                  ? ` · past breeding, dies in ${colonyAge(Math.max(0, ANIMALS[p.animal ?? 'dunhare'].life - ageOf(s.world, p)))}`
                  : ''
              }</b></div>`;
        this.inspector.innerHTML =
          `<h3>${petName(p)}</h3><div class="sub">${isPet(p) ? `${def.label.toLowerCase()} · ` : ''}${sex} ${kind}${grown < 1 ? ' calf' : ''} · ${state}</div>` +
          `<div class="kv"><span>health</span><b>${Math.round(p.hp)} / ${p.maxHp}</b></div>` +
          (isPet(p)
            ? `<div class="kv"><span>follows</span><b style="color:var(--good)">${keeper?.name ?? 'nobody'}</b></div>` +
              `<div class="kv"><span>yields</span><b>nothing — nobody is eating ${petName(p)}</b></div>`
            : `<div class="kv"><span>yields</span><b>${Math.max(1, Math.round(def.meat * bodyScale(s.world, p)))} raw food</b></div>`) +
          age +
          pen +
          `<div class="kv"><span>marked</span><b>${marked}</b></div>`;
        const acts = el('div', 'acts');
        if (isPet(p)) {
          // The handle on the one-way door. Bonding cannot be undone by taming
          // something else, by slaughtering it, or by waiting — so it has to be
          // undoable here, or a player who bonded the wrong animal is stuck with
          // it for the rest of the colony.
          const free = el(
            'button',
            'btn',
            { title: `Give ${petName(p)} back to the herd. ${keeper?.name ?? 'They'} will take it hard.` },
            'Let go',
          ) as HTMLButtonElement;
          free.onclick = () => this.hooks.releaseAnimal(p.id);
          acts.append(free);
        } else {
          const hunt = el(
            'button',
            'btn',
            {},
            p.hunted ? 'Call off' : p.tame ? 'Slaughter (H)' : 'Hunt this (H)',
          ) as HTMLButtonElement;
          hunt.onclick = () => this.hooks.setHunted(p.id, !p.hunted);
          acts.append(hunt);
        }
        // Only on animals still worth coaxing: a "Tame" button on something already
        // in the herd is a button that does nothing, which teaches the player the
        // panel lies to them.
        if (!p.tame && !p.dead) {
          const tame = el(
            'button',
            'btn',
            {},
            p.tameTarget ? 'Leave wild' : 'Tame (K)',
          ) as HTMLButtonElement;
          tame.onclick = () => this.hooks.setTamed(p.id, !p.tameTarget);
          acts.append(tame);
        }
        this.inspector.append(acts);
        return;
      }
      // Floored, not raw: a skill is a whole number to the player, and the
      // fractional part is the progress a settler has made toward the next one.
      // Printing it gives you "construction 5.359999999999999".
      //
      // And the trade name beside it, because the game speaks both and only
      // teaches one. The workbench refuses a recipe with "nobody here is a
      // doctor at 6" and a settler levels up into "a level 5 herbalist", while
      // this panel — the one place anybody goes to look up what they have — said
      // `medicine` and `plants`. The mapping existed solely in the source, so
      // the refusal named a thing the player could not find. Here it is, once,
      // where the numbers it refers to are.
      //
      // The mark after the number is what they *care* about, and it is the one
      // thing on this panel that is about the person rather than the state. A
      // settler who loves the bench learns it more than twice as fast as one who
      // does not, and before this the player had no way to find that out short of
      // watching two numbers move for a week. One mark for interested, two for
      // burning, and nothing at all for the two thirds of trades nobody minds.
      const skills =
        '<div class="sect">skills</div>' +
        SKILL_NAMES.map((k) => {
          const passion = passionOf(s.world, p, k);
          const mark = passion
            ? `<i class="pass" title="${PASSION_LABEL[passion]} — learns ${
                passion === 2 ? 'more than twice' : 'half again'
              } as fast">${passion === 2 ? '••' : '•'}</i>`
            : '';
          return (
            `<div class="kv"><span>${k} (${SKILL_TITLE[k]})</span>` +
            `<b>${Math.floor(p.skills[k])}${mark}</b></div>`
          );
        }).join('');
      // What they have on. Only once there is something to say: a line reading
      // "wearing — nothing" on every settler for the first ten days is ten days
      // of teaching the player to skip this part of the card.
      const worn = apparelOf(p);
      const held = gearOf(p);
      const kit =
        worn || held
          ? (worn
              ? `<div class="kv"><span>wearing</span><b>${escapeHtml(EQUIP[worn].label)}</b></div>`
              : '') +
            (held
              ? `<div class="kv"><span>carrying</span><b>${escapeHtml(EQUIP[held].label)}</b></div>`
              : '')
          : '';
      // What this one can make that the colony would miss. A skill gate is a gate
      // on a person, so "the only herbalist here" is the most important thing on
      // this panel and it was previously spread across eight numbers for the
      // player to cross-reference themselves. Researched recipes only: a settler
      // is not a rifleman because they could be, once somebody works out how.
      const trades =
        p.faction === 'colony'
          ? RECIPE_ORDER.filter((r) => canCraft(s.world, p, r)).map((r) => ({
              r,
              sole: livingColonists(s.world).filter((q) => pawnQualified(q, r)).length === 1,
            }))
          : [];
      const trade = trades.length
        ? '<div class="sect">can make</div>' +
          trades
            .map(
              ({ r, sole }) =>
                `<div class="kv"><span>${escapeHtml(CRAFT_DEFS[r].label)}</span>` +
                `<b class="${sole ? 'bad' : 'good'}">${sole ? 'only them' : 'yes'}</b></div>`,
            )
            .join('')
        : '';
      // Who they get on with, strongest opinion first. Three, because the point
      // is "who should I worry about if this one dies", not a sociogram.
      const near = p.faction === 'colony' ? bondsOf(s.world, p).slice(0, 3) : [];
      // The one person in that list who is not just an opinion. Their bond is
      // above every threshold there is, so they sort to the top on their own —
      // but "inseparable" is what the player reads about a hauling buddy, and
      // this row is the difference between losing a colonist and losing a life.
      const mate = p.faction === 'colony' ? partnerOf(s.world, p) : null;
      // And the pair who are most of the way there. A courtship the game says
      // nothing about until the morning it is announced is indistinguishable
      // from a coin flip, so the ten days show up here as a word — no counter,
      // because a progress bar on two people is the wrong game.
      const label = (r: { pawn: { id: number }; bond: number }): string => {
        if (r.pawn.id === mate?.id) return 'partner';
        return courtedFor(s.world, p.id, r.pawn.id) > 0 ? 'courting' : bondLabel(r.bond);
      };
      const bonds = near.length
        ? '<div class="sect">bonds</div>' +
          near
            .map(
              (r) =>
                `<div class="kv"><span>${escapeHtml(r.pawn.name)}</span><b class="${
                  r.bond >= FRIEND ? 'good' : r.bond <= RIVAL ? 'bad' : ''
                }">${label(r)}</b></div>`,
            )
            .join('')
        : '';
      // What has actually happened to this one, oldest first — the founding, the
      // day they were carried in, the raid they went down in. Everything above
      // this line is a settler's *state*, which is the same shape of information
      // for everybody and tells the player nothing about who they are running.
      // Last on the card because it is the thing you read when you are not in a
      // hurry; the numbers are the thing you read when you are.
      const past = memoriesOf(p);
      const story = past.length
        ? '<div class="sect">their story</div>' +
          past
            .map((m) => `<div class="mem"><b>day ${m.day}</b><span>${escapeHtml(m.text)}</span></div>`)
            .join('')
        : '';
      // What they have had enough of for now. Worth a row because it is the one
      // thing on this card that explains a settler walking away from the top of
      // the board the player set: they are not ignoring the priorities, they
      // have farmed three fields in a row and want an hour of something else.
      // Absent for nearly everybody nearly always — see `tedium.ts`.
      const fedUp = p.faction === 'colony' ? tediumOf(s.world, p) : [];
      const sickOf = fedUp.length
        ? `<div class="kv"><span>sick of</span><b class="bad">${fedUp.join(', ')}</b></div>`
        : '';
      // Labels only, with the explanation on hover. A settler is "Tough" first
      // and "+30% maximum hit points" only if the player goes looking, which is
      // the order somebody actually thinks about the person they are running.
      const chips = traitsOf(p);
      const traits = chips.length
        ? `<div class="traits">${chips
            .map((t) => `<span class="trait" title="${t.blurb}">${t.label}</span>`)
            .join('')}</div>`
        : '';
      this.inspector.innerHTML =
        `<h3>${p.name}</h3><div class="sub">${p.faction === 'colony' ? 'Settler' : p.faction} · ${
          p.downed ? 'DOWNED' : p.activity
        }</div>` +
        traits +
        `<div class="kv"><span>health</span><b>${Math.round(p.hp)} / ${p.maxHp}</b></div>` +
        ailmentRows(s.world, p) +
        `<div class="kv"><span>mood</span><b>${pct(p.mood)}</b></div>` +
        `<div class="kv"><span>food</span><b>${pct(p.needs.food)}</b></div>` +
        `<div class="kv"><span>rest</span><b>${pct(p.needs.rest)}</b></div>` +
        `<div class="kv"><span>recreation</span><b>${pct(p.needs.recreation)}</b></div>` +
        warmthRow(s.world, p) +
        surroundingsRow(s.world, p) +
        petRow(s.world, p) +
        `<div class="kv"><span>weapon</span><b>${p.weapon}</b></div>` +
        kit +
        `<div class="kv"><span>doing</span><b>${jobLabel(s.world, p)}</b></div>` +
        sickOf +
        // Resistance is the only number a prisoner has that the player can act
        // on: it is the answer to "is this working, and how much longer". Without
        // it the cell is a bar chart of somebody who never does anything.
        (p.faction === 'prisoner'
          ? `<div class="kv"><span>resistance</span><b>${p.resistance ?? 0} talk${
              (p.resistance ?? 0) === 1 ? '' : 's'
            }</b></div>`
          : '') +
        moodRows(p) +
        skills +
        trade +
        bonds +
        story;
      if (p.faction === 'colony') {
        this.inspector.append(this.stackPanel(s.world, p));
        const acts = el('div', 'acts');
        const draft = el('button', 'btn', {}, p.drafted ? 'Undraft (T)' : 'Draft (T)') as HTMLButtonElement;
        draft.onclick = () => this.hooks.setDraft(p.id, !p.drafted);
        const hand = el(
          'button',
          p.manual ? 'btn on' : 'btn',
          { title: p.manual ? 'Put them back on the colony work board' : 'Take them off the work board and give the orders yourself' },
          p.manual ? 'On the board' : 'Take over',
        ) as HTMLButtonElement;
        hand.onclick = () => this.hooks.setManual(p.id, !p.manual);
        const poss = el('button', 'btn', {}, 'Possess (G)') as HTMLButtonElement;
        poss.onclick = () => this.hooks.possess(p.id);
        acts.append(draft, hand, poss);
        this.inspector.append(acts);
      }
      return;
    }

    const b = findBuilding(s.world, sel.id);
    if (!b) {
      this.inspector.style.display = 'none';
      return;
    }
    const def = defOf(b.kind);
    const needs = Object.entries(b.needs)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ');
    this.inspector.innerHTML =
      `<h3>${def.label}</h3><div class="sub">${b.built ? 'built' : 'blueprint'} · (${b.x}, ${b.y})</div>` +
      `<div class="kv"><span>integrity</span><b>${Math.round(b.hp)} / ${b.maxHp}</b></div>` +
      (b.built
        ? ''
        : `<div class="kv"><span>work</span><b>${Math.round(b.work)} / ${b.workLeft}</b></div>` +
          `<div class="kv"><span>still needs</span><b>${needs || 'nothing'}</b></div>`) +
      (isBed(b.kind)
        ? `<div class="kv"><span>occupant</span><b>${occupantName(s.world, b.occupant)}</b></div>`
        : '') +
      // The only reason to build a grave rather than let a body rot is that you
      // can come back and read the name off it, so the name is the readout.
      (b.kind === 'grave' && b.built
        ? `<div class="kv"><span>buried here</span><b>${
            b.occupant === null || b.occupant === undefined
              ? 'nobody yet'
              : escapeHtml(occupantName(s.world, b.occupant))
          }</b></div>`
        : '') +
      // Every building reports the air where it stands, because "is this cell cold
      // enough" is a question about a spot on the map, and the buildings are what
      // the player clicks on. On a cooler it doubles as the only readout that says
      // whether the thing is actually running.
      `<div class="kv"><span>temperature</span><b>${tempLabel(cellTemp(s.world, b.x, b.y))}</b></div>` +
      roomRow(s.world, b) +
      (isClimate(b.kind) && b.built
        ? `<div class="kv"><span>running</span><b>${climateStatus(s.world, b)}</b></div>`
        : '') +
      powerRows(s.world, b) +
      recipeRows(s.world, b) +
      `<div class="kv"><span>blocks movement</span><b>${def.solid ? 'yes' : 'no'}</b></div>`;
    const acts = el('div', 'acts');
    const cancel = el('button', 'btn', {}, b.built ? 'Deconstruct (X)' : 'Cancel') as HTMLButtonElement;
    cancel.onclick = () => this.hooks.cancelBuilding(b.id);
    acts.append(cancel);
    this.inspector.append(acts);
  }

  /**
   * What this settler is doing, and what they are doing after that.
   *
   * The same rows whoever filled them in — the difference between a settler the
   * colony is running and one the player has taken over is who chose the work, not
   * what the work is, and a player who can read the auto stack learns what the
   * colony's own priorities actually produce.
   *
   * The ✕ is manual-only on purpose. Cancelling a job the colony picked releases
   * its claims and the picker chooses again on the next assignment tick — nearly
   * always the same job, because nothing about the board has changed. A button
   * whose whole visible effect is to be undone half a second later is worse than
   * no button, so taking over is the way to edit the list.
   */
  private stackPanel(world: World, p: Pawn): HTMLElement {
    const wrap = el('div', 'stack');
    const manual = p.manual ?? false;
    const head = el('div', 'stack-head');
    head.append(
      el('span', '', {}, 'control stack'),
      el('b', manual ? 'hand' : '', {}, manual ? 'BY HAND' : 'AUTO'),
    );
    wrap.append(head);

    const stack = controlStack(world, p);
    if (stack.length === 0) {
      wrap.append(
        el('div', 'stack-empty', {}, manual ? 'No orders. They are waiting.' : jobLabel(world, p)),
      );
    }
    for (let i = 0; i < stack.length; i++) {
      const job = stack[i]!;
      const row = el('div', `stack-row${i === 0 ? ' live' : ''}`);
      row.append(
        el('i', 'stack-n', {}, i === 0 ? 'NOW' : String(i)),
        el('span', 'stack-what', {}, JOB_LABEL[job.kind]),
        el('em', 'stack-at', {}, `${job.tx},${job.ty}`),
      );
      if (manual) {
        const x = el('button', 'stack-x', { title: 'Cancel this order' }, '✕') as HTMLButtonElement;
        x.onclick = (e) => {
          // Or the row's own handler flies the camera to the cell of the order
          // that was just rubbed out.
          e.stopPropagation();
          this.hooks.cancelStackEntry(p.id, job.id);
        };
        row.append(x);
      }
      // Clicking the row puts the camera on the work, which is the question a
      // player asks of a stack row roughly every other time they read one.
      (row as HTMLElement).onclick = () => this.hooks.focus(job.tx, job.ty);
      wrap.append(row);
    }

    // Why the board in front of them is empty, when it is. Under the rows rather
    // than inside the empty branch because the commonest face of "nothing to do"
    // is not an empty stack at all — it is a settler the empty board sent to sit
    // by the fire, with one perfectly innocent row showing. See `sim/idle.ts`,
    // which is careful about which of the two it is looking at.
    const why = idleReason(world, p);
    if (why !== null) wrap.append(el('div', 'stack-why', {}, why));

    if (manual) {
      const room = STACK_MAX - stack.length;
      // Naming the wrong hardware is worse than naming none: an iPad has no
      // right button, and the tap that does work is the one thing the player
      // will not try if the panel has just told them to right-click. Same test
      // the help card uses — a touch laptop is told to tap, and right-click
      // still works there anyway.
      const poke =
        typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 ? 'Tap' : 'Right-click';
      wrap.append(
        el(
          'div',
          'stack-hint',
          {},
          room > 0
            ? `${poke} the map to add an order — ${room} slot${room === 1 ? '' : 's'} left.`
            : 'Stack full. Cancel an order to add another.',
        ),
      );
    }
    return wrap;
  }

  /**
   * The meter. Absent until the colony has a grid at all, red the moment
   * something has been switched off to keep the rest alive.
   */
  private syncPower(world: World): void {
    const r = world.power;
    const live = r !== undefined && (r.supply > 0 || r.demand > 0 || r.capacity > 0);
    this.power.style.display = live ? '' : 'none';
    if (!live) return;
    const pct = batteryPercent(r);
    const b = this.power.querySelector('b')!;
    b.textContent = powerLabel(r) + (pct === null ? '' : ` · ${pct}%`);
    (b as HTMLElement).style.color = r!.shed > 0 ? 'var(--bad)' : '';
  }

  private syncBuildBar(s: HudState): void {
    // A hotkey has to be able to reach a tile the player cannot see, and then
    // show them where it lives — press 2 and the Structure tab comes forward with
    // Door lit, which is how the keyboard teaches the menu instead of bypassing
    // it. Only on a *change*, though: recomputing it every frame would drag the
    // player back out of any tab they opened by hand.
    const sig = `${s.tool}:${s.buildKind ?? ''}`;
    if (sig !== this.toolSig) {
      this.toolSig = sig;
      const home = groupOf(s);
      if (home && home !== this.activeGroup) this.showGroup(home);
    }
    for (const [key, tile] of this.buildTiles) {
      const [kindOrTool, name] = key.split(':') as ['build' | 'tool' | 'act', string];
      const on =
        kindOrTool === 'build'
          ? s.tool === 'build' && s.buildKind === name
          : kindOrTool === 'tool' && s.tool === name;
      tile.classList.toggle('on', on);
      if (kindOrTool === 'build') {
        const kind = name as BuildingKind;
        // A structure nobody has worked out yet is simply absent from the bar
        // rather than greyed out: a locked tile invites clicking, and finishing
        // Stonecutting is more of a moment when a new thing appears.
        const known = buildingUnlocked(s.world, kind);
        tile.style.display = known ? '' : 'none';
        if (!known) continue;
        const def = defOf(kind);
        const short = Object.entries(def.cost).some(
          ([k, v]) => countResource(s.world, k as ResourceKind) < (v ?? 0),
        );
        tile.classList.toggle('no', short);
      }
    }
  }

  private syncWorkTab(s: HudState): void {
    this.worktab.style.display = this.worktabOpen ? 'block' : 'none';
    if (!this.worktabOpen) return;
    const colonists = s.world.pawns.filter((p) => p.faction === 'colony' && !p.dead);
    const sig = colonists.map((p) => `${p.id}:${WORK_TYPES.map((w) => p.priorities[w]).join('')}`).join('|');
    if (sig === this.workSig) return;
    this.workSig = sig;

    const table = el('table');
    const head = el('tr');
    head.append(el('th', '', {}, 'Settler'));
    for (const w of WORK_TYPES) head.append(el('th', '', {}, w));
    table.append(head);
    for (const p of colonists) {
      const tr = el('tr');
      tr.append(el('td', '', {}, p.name));
      for (const w of WORK_TYPES) {
        const level = p.priorities[w];
        const td = el('td', `p p${level} clickable`, {}, level === 0 ? '–' : String(level));
        td.onclick = () => this.hooks.setPriority(p.id, w, (level + 1) % 5);
        tr.append(td);
      }
      table.append(tr);
    }
    this.worktab.innerHTML = '';
    this.worktab.append(table, el('div', 'hint', {}, 'Click a cell to cycle 1 (first) → 4 (last) → off.'));
  }

  private syncResearchPip(world: World): void {
    const id = world.research.current;
    if (id === null) {
      this.researchPip.style.display = 'none';
      return;
    }
    this.researchPip.style.display = '';
    const pct = Math.round(researchFraction(world) * 100);
    // A bar sitting at a hundred per cent with nothing happening is a bug unless
    // the strip says why, and the strip is the only part of this the player sees
    // without opening a panel. So the percentage gives way to the reason.
    const short = researchStalled(world)
      ? researchNeeds(world)
          .map((n) => `${n.amount} ${RESOURCE_LABEL[n.kind].toLowerCase()}`)
          .join(', ')
      : null;
    this.researchPip.innerHTML =
      `<i>${escapeHtml(RESEARCH[id].label)}</i><span class="track"><span style="width:${pct}%"></span></span>` +
      (short ? `<b class="short">needs ${escapeHtml(short)}</b>` : `<b>${pct}%</b>`);
  }

  /**
   * The research panel. Three bands: what is being worked out now, what could be
   * started instead, and what is already known. Everything still locked is listed
   * too, greyed, with the project that opens it — a tree you cannot see the shape
   * of is not a tree, it is a surprise.
   */
  private syncResearchTab(s: HudState): void {
    this.researchtab.style.display = this.researchOpen ? 'block' : 'none';
    if (!this.researchOpen) return;
    const r = s.world.research;
    const openable = new Set(available(s.world).map((d) => d.id));
    const short = researchNeeds(s.world);
    // Redraw only when something actually moved. The progress number changes every
    // tick, so it is deliberately rounded into the signature. The shortfall is in
    // it because a crate landing in the yard changes nothing else on this panel,
    // and a bill that still reads "needs 12 parts" with twelve parts on the floor
    // is worse than not showing the bill at all.
    const sig =
      `${r.current}|${r.done.join(',')}|${Math.round(researchFraction(s.world) * 200)}` +
      `|${short.map((n) => `${n.kind}${n.amount}`).join(',')}`;
    if (sig === this.researchSig) return;
    this.researchSig = sig;

    this.researchtab.innerHTML = '';
    this.researchtab.append(el('h3', '', {}, 'Research'));

    if (r.current === null) {
      this.researchtab.append(
        el('div', 'hint', {}, 'Nothing chosen. Pick a project and a settler will take it to the bench.'),
      );
    } else {
      const def = RESEARCH[r.current];
      const pct = Math.round(researchFraction(s.world) * 100);
      const now = el('div', 'now');
      now.innerHTML =
        `<div class="ttl">${escapeHtml(def.label)}<span>${Math.floor(r.progress)} / ${def.cost}</span></div>` +
        `<div class="track"><span style="width:${pct}%"></span></div>` +
        // The bill, and where the colony stands against it. Shown from the moment
        // the project is chosen rather than when the points run out, because the
        // whole point of the third tier is that somebody should already be on the
        // road by then — and nobody walks for a cost they were not told about.
        (def.materials ? `<div class="bill">${billHtml(s.world, def)}</div>` : '') +
        (researchStalled(s.world)
          ? `<div class="hint">Worked out, and waiting on the delivery. Nothing here makes parts — they come off a road.</div>`
          : '');
      const stop = el('button', 'btn', {}, 'Set aside') as HTMLButtonElement;
      stop.title = 'Stops the project. Progress on it is lost.';
      stop.onclick = () => this.hooks.setResearch(null);
      now.append(stop);
      this.researchtab.append(now);
    }

    const list = el('div', 'projects');
    for (const id of RESEARCH_ORDER) {
      const def = RESEARCH[id];
      const done = r.done.includes(id);
      const open = openable.has(id);
      const row = el('div', `proj${done ? ' done' : open ? ' clickable' : ' locked'}`);
      const gate = def.needs.filter((n) => !r.done.includes(n)).map((n) => RESEARCH[n].label);
      const tag = done
        ? 'known'
        : gate.length > 0
          ? `needs ${gate.join(' + ')}`
          : id === r.current
            ? 'in progress'
            : `${def.cost} pts`;
      // The recipe it opens is worth more to the player than the blurb is — it
      // is the only place a workbench gate is visible before they walk somebody
      // to the bench and get told no.
      const opens = unlockedBy(id);
      row.innerHTML =
        `<div class="ttl">${escapeHtml(def.label)}<span>${escapeHtml(tag)}</span></div>` +
        `<div class="blurb">${escapeHtml(def.blurb)}${opens ? ` <b>${escapeHtml(opens)}</b>` : ''}</div>` +
        // On every row, not just the one on the bench. The third tier costs goods
        // one of which cannot be made here at all, and a player who finds that out
        // by starting the project and waiting has been ambushed by the tree.
        (def.materials && !done ? `<div class="bill">${billHtml(s.world, def)}</div>` : '');
      if (open && id !== r.current) row.onclick = () => this.hooks.setResearch(id);
      list.append(row);
    }
    this.researchtab.append(list);
    this.researchtab.append(
      el('div', 'hint', {}, 'Points come from settlers working at a research bench. Switching project discards progress.'),
    );
  }

  /**
   * The stall. One row per swap: what it costs, what it gets, and whether the
   * colony can cover it. A deal you cannot afford stays on the board greyed
   * rather than disappearing — "you need forty more steel" is information, and
   * a list that silently shortens is not.
   */
  private syncTradeTab(s: HudState): void {
    const trader = currentTrader(s.world);
    this.tradeBtn.style.display = trader ? '' : 'none';
    if (trader && this.tradeOpen) this.roadOpen = false;
    if (!trader && this.tradeOpen) {
      this.tradeOpen = false;
      this.tradeSig = '';
    }
    this.tradetab.style.display = this.tradeOpen && trader ? 'block' : 'none';
    if (!this.tradeOpen || !trader) return;

    const offers = s.world.trade?.offers ?? [];
    const left = ticksLeft(s.world);
    const stocks = offers.map((o) => countResource(s.world, o.give.kind)).join(',');
    // The countdown moves every tick; rounded to the minute it shows in.
    const sig = `${trader.id}|${offers.map((o) => `${o.id}${o.taken ? 'x' : ''}`).join(',')}|${stocks}|${Math.round(left / 100)}`;
    if (sig === this.tradeSig) return;
    this.tradeSig = sig;

    this.tradetab.innerHTML = '';
    this.tradetab.append(el('h3', '', {}, `${trader.name}'s caravan`));
    this.tradetab.append(
      el(
        'div',
        'hint',
        {},
        `Packing up in ${colonyTime(left)}. Goods land on the ground where they stand — someone will haul them in.`,
      ),
    );

    const list = el('div', 'deals');
    for (const o of offers) {
      const have = countResource(s.world, o.give.kind);
      const afford = have >= o.give.amount;
      const row = el('div', `deal${o.taken ? ' done' : afford ? ' clickable' : ' locked'}`);
      const gets =
        'hire' in o.take
          ? 'a pair of hands — they stay for good'
          : `${o.take.amount} ${o.take.kind}`;
      row.innerHTML =
        `<div class="ttl"><span class="cost">${o.give.amount} ${escapeHtml(o.give.kind)}</span>` +
        `<span class="arrow">→</span><span class="gain">${escapeHtml(gets)}</span></div>` +
        `<div class="blurb">${o.taken ? 'struck' : afford ? `you have ${have}` : `you have ${have} of ${o.give.amount}`}</div>`;
      if (!o.taken && afford) row.onclick = () => this.hooks.acceptTrade(o.id);
      list.append(row);
    }
    this.tradetab.append(list);
  }

  /**
   * The neighbours, and what it would take to reach them.
   *
   * Two states, and they are the whole feature. With nobody on the road it is a
   * list of packs the colony could send, priced for the settler who would
   * actually walk it — so the price the player is shown is the price they will
   * get. With a caravan out it is one line about somebody who is not here, which
   * is the cost the feature is built around and the thing the panel exists to
   * keep visible while they are gone.
   */
  private syncRoadTab(s: HudState): void {
    this.roadtab.style.display = this.roadOpen ? 'block' : 'none';
    if (!this.roadOpen) return;

    const places = settlementsOf(s.world);
    const out = caravansOf(s.world);
    // At the cap the panel stops offering roads; below it, a party already
    // walking is news rather than a wall, and the towns stay listed because
    // sending the second one is the decision this tab now exists to put in front
    // of the player.
    const capped = partiesCommitted(s.world) >= CARAVAN_PARTIES_MAX;
    const talker = bestTalker(s.world);
    const com = commissionOf(s.world);
    // The open letter is part of both signatures — the clock on it runs whether
    // or not anybody is on the road, and quarter-days is the same resolution the
    // caravan is drawn at.
    const comSig = com
      ? `${com.settlementId}:${com.kind}:${Math.round(commissionDaysLeft(s.world, com) * 4)}`
      : 'none';
    // Quarter-days and quarter-levels: fine enough that the panel visibly moves,
    // coarse enough that it is not rebuilt twenty times a second.
    // Every party is in the signature, not just the first: with two out, a panel
    // keyed on one of them would freeze the other's clock at whatever it read
    // when the first left.
    const outSig = out
      .map((c) => `${c.id ?? 0}:${c.settlementId}:${c.phase}:${Math.round(caravanDaysLeft(s.world, c) * 4)}`)
      .join(';');
    // The war road turns on things nothing else in this signature watches: how
    // far a party still has to walk, who is standing, and whether there are
    // raiders in the yard. Each of them changes the sentence under a holding —
    // and the last two change it while the caravans and the towns sit perfectly
    // still, which is exactly when a panel keyed on the rest of this would lie.
    const warSig = [
      s.world.war ? `${s.world.war.phase}:${Math.round(warDaysLeft(s.world) * 4)}` : 'home',
      holdingsOf(s.world)
        .map((h) => `${h.id}${h.held ? 'h' : ''}${h.attempts}${planCampaign(s.world, h.id).ok ? '+' : '-'}`)
        .join(','),
      String(livingColonists(s.world).filter((p) => !p.downed).length),
      s.world.storyteller.raidActive ? 'raid' : 'quiet',
    ].join('|');
    // The terminal is in both branches of the signature below, because it is the
    // one section of this tab that is on screen whether or not the colony can
    // send anybody anywhere — a capped colony watching its hull fill up still
    // needs the number to move.
    const end = endingProgress(s.world);
    const endSig = end
      ? `${end.id}:${Math.round(end.daysLeft * 4)}:${end.bill.at}:${end.stalled ?? ''}:${end.landed}`
      : // The offers carry their bills, and two of the three are already partly
        // paid — a signature keyed on which endings are open would freeze the
        // fare at whatever it read on the day the road reached its top rung.
        endingsOpen(s.world)
          .map((id) => `${id}:${endingOffer(s.world, id).bill.at}`)
          .join(',') || 'none';
    const sig = capped
      ? `out|${outSig}|${comSig}|${warSig}|${endSig}`
      : [
          endSig,
          'in',
          outSig,
          warSig,
          talker ? `${talker.id}:${Math.round(socialOf(talker) * 4)}` : 'none',
          PACK_KINDS.map((k) => countResource(s.world, k)).join(','),
          // Headcount rides along because it is the one thing range turns on
          // that nothing else in this signature already moves. Standing and the
          // pantry are both above.
          String(livingColonists(s.world).length),
          places.map((p) => `${p.id}:${Math.round(p.relations)}:${p.visits}`).join(','),
          comSig,
        ].join('|');
    if (sig === this.roadSig) return;
    this.roadSig = sig;

    this.roadtab.innerHTML = '';
    this.appendTerminal(s, end);
    this.roadtab.append(el('h3', '', {}, 'The road'));

    // Above everything, including a party already walking: an open letter is the
    // one thing on this panel with a clock on it, and a player who has to scroll
    // past four towns to find out how long is left has been told nothing.
    if (com) {
      const from = settlementById(s.world, com.settlementId);
      const have = countResource(s.world, com.kind);
      const days = commissionDaysLeft(s.world, com);
      const card = el('div', 'deal asked');
      card.innerHTML =
        `<div class="ttl"><span class="cost">${escapeHtml(from?.name ?? 'Somewhere')} is asking</span>` +
        `<span class="arrow">·</span><span class="gain">${days.toFixed(1)} days left</span></div>` +
        `<div class="blurb">${escapeHtml(com.reason)} — they want ${com.amount} ${escapeHtml(com.kind)} ` +
        `walked to their door. You have ${have}${have >= com.amount ? ', which is enough' : ` of ${com.amount}`}. ` +
        `Answering it is worth more standing than three ordinary runs.</div>`;
      this.roadtab.append(card);
    }

    // A line each. Two parties out is two settlers the colony is doing without,
    // and the panel saying so twice is the cost being visible rather than
    // inferred from a headcount the player is not watching.
    for (const c of out) {
      const dest = settlementById(s.world, c.settlementId);
      const days = caravanDaysLeft(s.world, c);
      const carrying =
        c.phase === 'outbound'
          ? `carrying ${c.give.amount} ${c.give.kind}`
          : c.take
            ? `bringing back ${c.take.amount} ${c.take.kind}`
            : 'walking home with nothing — they were robbed';
      this.roadtab.append(
        el(
          'div',
          'hint',
          {},
          `${c.pawn.name} is on the ${dest?.name ?? 'far'} road, ${carrying}. Home in about ${days.toFixed(1)} days. Nobody can do their work until they are back.`,
        ),
      );
    }
    this.appendWarRoad(s);

    // Only the cap closes the panel. One party out and bodies to spare is a
    // colony that may still send another, and hiding the towns would be the old
    // one-road rule surviving in the interface after it left the simulation.
    if (capped) return;

    // Named now that it is not the only thing on the panel. The war road above it
    // is a list of places with days and a price on them too, and without a
    // heading here the towns read as more of it.
    this.roadtab.append(el('h3', '', {}, 'The neighbours'));
    this.roadtab.append(
      el(
        'div',
        'hint',
        {},
        talker
          ? `${talker.name} would walk it — social ${socialOf(talker).toFixed(0)}, which is most of the price. They are gone for the whole round trip.`
          : 'Nobody can be spared for the road.',
      ),
    );

    const list = el('div', 'deals');
    for (const place of places) {
      // What they are known for is the reason to walk four days rather than
      // shrug — and it reads as an answer when the colony itself cannot make it.
      const trade = specialty(place);
      const known = trade ? ` · ${CRAFT_DEFS[trade].trade}` : '';
      // Out of range is a state of the *place*, not of the pack, so it is said
      // once in the heading and the six rows below it are not drawn at all. A
      // road the colony cannot walk yet still gets a line, because the sentence
      // that says what would open it is the only way the far country reads as
      // somewhere to work towards rather than decoration.
      const reach = withinRange(s.world, place);
      const head = el('div', 'deal locked');
      head.innerHTML =
        `<div class="ttl"><span class="cost">${escapeHtml(place.name)}</span>` +
        `<span class="arrow">·</span><span class="gain">${place.days} days each way</span></div>` +
        `<div class="blurb">short of ${escapeHtml(place.buys)}, pays in ${escapeHtml(place.sells)}${escapeHtml(known)} · ` +
        `${place.visits === 0 ? 'never visited' : `${place.visits} visit${place.visits === 1 ? '' : 's'}, standing ${Math.round(place.relations)}`}` +
        `${reach.ok ? '' : `<br>${escapeHtml(reach.text)}`}</div>`;
      list.append(head);
      if (!talker || !reach.ok) continue;
      // A party three weeks out goes with handcarts and more than one back, so
      // the pack the panel offers is the one that road actually takes.
      const load = packMultiple(place);
      for (const kind of PACK_KINDS) {
        const amount = PACK_SIZES[kind] * load;
        const have = countResource(s.world, kind);
        // Unaffordable packs stay on the board greyed, for the same reason the
        // shop's do: "you have 40 of 80" is the thing worth reading.
        const afford = have >= amount;
        const back = quote(place, talker, { kind, amount });
        // The one row that answers the open letter, called out where the player
        // is already looking rather than left to be cross-referenced by hand
        // against four towns and six pack sizes.
        const asked = satisfies(com, place.id, { kind, amount });
        const row = el('div', `deal${afford ? ' clickable' : ' locked'}${asked ? ' asked' : ''}`);
        row.style.marginLeft = '14px';
        row.innerHTML =
          `<div class="ttl"><span class="cost">${amount} ${escapeHtml(kind)}</span>` +
          `<span class="arrow">→</span><span class="gain">${back.amount} ${escapeHtml(back.kind)}</span></div>` +
          `<div class="blurb">${asked ? 'this is what they asked for · ' : ''}${
            afford ? `you have ${have}` : `you have ${have} of ${amount}`
          }${
            rateReasons(place, kind)
              .map((r) => ` · ${escapeHtml(r)}`)
              .join('')
          }</div>`;
        if (afford) {
          row.onclick = () => this.hooks.sendCaravan(talker.id, place.id, kind, amount);
        }
        list.append(row);
      }
    }
    this.roadtab.append(list);
  }

  /**
   * The other road out of the valley, on the same panel as the one that trades.
   *
   * It is here rather than in a tab of its own because it is the same decision
   * wearing different clothes: somewhere out there, a walk each way, and settlers
   * who are gone while they do it. A player who has learned that a caravan costs
   * a fortnight of one pair of hands can read what a campaign costs without being
   * taught a second interface.
   *
   * Three states per holding and they are the whole feature. Ground the colony
   * holds says what it sends home. Ground it can march on gets a live row with
   * the garrison on it. Ground it cannot march on gets `planCampaign`'s own
   * refusal sentence, greyed and still listed — "you have five on their feet, and
   * it takes seven" is a thing a player can go and fix, and a button that quietly
   * vanishes is not.
   */
  private appendWarRoad(s: HudState): void {
    this.roadtab.append(el('h3', '', {}, 'The war road'));

    const war = warPartyOf(s.world);
    if (war) {
      const where = holdingById(s.world, war.holdingId)?.name ?? 'the moor';
      const names = war.pawns.map((p) => p.name).join(', ');
      const days = warDaysLeft(s.world).toFixed(1);
      this.roadtab.append(
        el(
          'div',
          'hint',
          {},
          war.phase === 'mustering'
            ? `The war party is forming up for ${where}. They leave from the treeline.`
            : war.phase === 'outbound'
              ? `${names} are marching on ${where}. They reach the walls in about ${days} days.`
              : `${names} are walking home from ${where} — about ${days} days out. ` +
                (war.won ? 'The place is yours.' : 'They were thrown back.'),
        ),
      );
    }

    const list = el('div', 'deals');
    for (const h of holdingsOf(s.world)) {
      const each = roundTripDays(h.ring) / 2;
      if (h.held) {
        const row = el('div', 'deal done');
        row.innerHTML =
          `<div class="ttl"><span class="cost">${escapeHtml(h.name)}</span>` +
          `<span class="arrow">·</span><span class="gain">yours</span></div>` +
          `<div class="blurb">${tributeOf(h)} steel comes down off the moor every ` +
          `${roundTripDays(h.ring)} days. ` +
          `${h.attempts === 1 ? 'Taken at the first attempt.' : `Taken after ${h.attempts} attempts.`}</div>`;
        list.append(row);
        continue;
      }
      const plan = planCampaign(s.world, h.id);
      const row = el('div', `deal${plan.ok ? ' clickable' : ' locked'}`);
      row.innerHTML =
        `<div class="ttl"><span class="cost">${escapeHtml(h.name)}</span>` +
        `<span class="arrow">·</span><span class="gain">${each} days each way</span></div>` +
        `<div class="blurb">${garrisonSize(h.ring)} Ashbound behind the wall, and ${tributeOf(h)} steel every ` +
        `${roundTripDays(h.ring)} days if you take it. ` +
        `${h.attempts > 0 ? `Thrown back ${h.attempts === 1 ? 'once' : `${h.attempts} times`} already. ` : ''}` +
        `${plan.ok ? `${WAR_PARTY} march: ${escapeHtml(plan.party.map((p) => p.name).join(', '))}.` : escapeHtml(plan.text)}</div>`;
      if (plan.ok) row.onclick = () => this.hooks.sendWarParty(h.id);
      list.append(row);
    }
    this.roadtab.append(list);
  }

  /**
   * How this run ends, once a road is long enough to end it.
   *
   * Above the letters and the towns, which is a promotion the commission card's
   * own comment argues for and then loses: the letter is the one thing on this
   * panel with a clock on it right up until this appears, and then it is the
   * second. Nothing at all is appended before a road reaches its top rung, so
   * for most of a run the tab is exactly what it was.
   *
   * Committed and offered are drawn as the same card on purpose. The player is
   * being asked to pick one of three and then watch the one they picked, and a
   * choice that redraws itself into a different-looking thing the moment it is
   * made is a choice the player has to re-learn at the worst possible moment.
   */
  private appendTerminal(s: HudState, end: EndingProgress | null): void {
    const open = end ? [] : endingsOpen(s.world);
    if (!end && open.length === 0) return;
    this.roadtab.append(el('h3', '', {}, 'The far end'));

    if (end) {
      const card = el('div', `deal terminal${end.landed ? ' done' : end.stalled ? ' stalled' : ''}`);
      // The days are the headline whichever way it is going: running, they are
      // what is left; stopped, the whole count is what it will cost to start
      // again, and the card says so rather than showing twelve as if it were
      // progress.
      const gain = end.landed
        ? 'done'
        : end.stalled
          ? `stopped · ${ENDING_DAYS} days`
          : `${end.daysLeft.toFixed(1)} days left`;
      card.innerHTML =
        `<div class="ttl"><span class="cost">${escapeHtml(end.title)}</span>` +
        `<span class="arrow">·</span><span class="gain">${escapeHtml(gain)}</span>` +
        (end.landed ? '' : `<a class="off" title="Give it up. What went into it is gone.">give it up</a>`) +
        `</div>` +
        `<div class="blurb">${escapeHtml(end.bill.count)}. ` +
        escapeHtml(
          end.landed
            ? end.blurb
            : end.stalled
              ? `The count is stopped — ${end.stalled}. It starts again from ${ENDING_DAYS} days when that is fixed, and what is already paid stays paid.`
              : end.hint,
        ) +
        `</div>`;
      card
        .querySelector('a.off')
        ?.addEventListener('click', () => this.hooks.abandonEnding());
      this.roadtab.append(card);
      return;
    }

    const list = el('div', 'deals');
    for (const id of open) {
      const o = endingOffer(s.world, id);
      const row = el('div', 'deal terminal clickable');
      // The bill is quoted before the commitment and two of the three are
      // already partly paid, which is the honest number and not a discount: the
      // fare and the moor were bought on the way here.
      row.innerHTML =
        `<div class="ttl"><span class="cost">${escapeHtml(o.title)}</span>` +
        `<span class="arrow">·</span><span class="gain">${ENDING_DAYS} days</span></div>` +
        `<div class="blurb">${escapeHtml(o.blurb)} ${escapeHtml(o.bill.count)}, and the colony has to ` +
        `hold together the whole time. ${escapeHtml(o.hint)}</div>`;
      row.onclick = () => this.hooks.commitEnding(id);
      list.append(row);
    }
    this.roadtab.append(list);
  }

  /**
   * The colony's own history.
   *
   * The log panel in the corner is a window on the last seven lines and it
   * scrolls; that is right for "who is doing what", and it means the game had
   * nowhere at all that remembered the founding, the first winter, or the name of
   * the settler who died in it. `world.chronicle` keeps those — every message
   * raised as a headline — and this panel is where you read them.
   *
   * Newest at the top, which is the opposite of how a story is written and the
   * right way round for how this one is read: a player opens it to find out what
   * just happened, and scrolls *down* into the past only when they want to. Days
   * are printed once as a heading rather than on every line, so a busy day reads
   * as a paragraph about that day instead of a column of repeated numbers.
   */
  private syncChronicleTab(world: World): void {
    this.chronicletab.style.display = this.chronicleOpen ? 'block' : 'none';
    if (!this.chronicleOpen) return;

    const all = world.chronicle ?? [];
    // Length plus the last tick: length alone stops changing the moment the
    // chronicle reaches its cap, and the panel would then freeze on the day it
    // filled up while the colony went on having a history.
    const sig = `${all.length}:${all[all.length - 1]?.tick ?? -1}`;
    if (sig === this.chronicleSig) return;
    this.chronicleSig = sig;

    this.chronicletab.innerHTML = '';
    this.chronicletab.append(el('h3', '', {}, 'The story so far'));

    if (all.length === 0) {
      this.chronicletab.append(
        el(
          'div',
          'hint',
          {},
          'Nothing worth remembering yet. Arrivals, raids, deaths, the first harvest and the day you win all end up here — the corner log forgets after eighty lines, this does not.',
        ),
      );
      return;
    }

    // Newest first, and only the last two hundred: the sim keeps five hundred,
    // but rebuilding a thousand-node list every time a headline lands is a
    // visible hitch, and nobody scrolls a third of a year back through a panel.
    const shown = all.slice(-200).reverse();
    const list = el('div', 'chron');
    let lastDay = -1;
    for (const m of shown) {
      const day = Math.floor(m.tick / TICKS_PER_DAY) + 1;
      if (day !== lastDay) {
        lastDay = day;
        list.append(el('div', 'chronday', {}, `Day ${day}`));
      }
      const row = el('div', `chronline ${m.kind}`);
      row.textContent = m.text;
      // The same click the log gives: a headline with a place is somewhere to
      // go, and a death or a fire is exactly the sentence you want to be able to
      // put the camera on.
      if (m.at) {
        const at = m.at;
        row.classList.add('goto');
        row.onclick = () => this.hooks.focus(at.x, at.y);
      }
      list.append(row);
    }
    this.chronicletab.append(list);
    if (all.length > shown.length) {
      this.chronicletab.append(
        el('div', 'hint', {}, `${all.length - shown.length} older entries are kept but not shown.`),
      );
    }
  }

  private syncFps(s: HudState): void {
    const p = s.possessed;
    if (!p) return;
    const target = describeTarget(s.world, p);
    if (target) {
      this.prompt.style.display = 'block';
      this.prompt.innerHTML = `<kbd>E</kbd>${target.verb}`;
    } else {
      this.prompt.style.display = 'none';
    }
    this.crosshair.classList.toggle('armed', p.drafted);
    this.selfPanel.innerHTML =
      `<div class="who"><b>${p.name}</b><span class="wep">${p.weapon}${p.drafted ? ' · DRAFTED' : ''}</span></div>` +
      bar('hp', p.hp / p.maxHp, 'Health') +
      bar('food', p.needs.food, 'Food') +
      bar('rest', p.needs.rest, 'Rest') +
      bar('rec', p.needs.recreation, 'Fun') +
      `<div class="kv" style="margin-top:5px;color:var(--dim);font-size:11px">${
        p.carryingItemId !== null ? `carrying ${carriedLabel(s.world, p)}` : jobLabel(s.world, p)
      }</div>`;
  }

  setLockHint(show: boolean): void {
    this.lockHint.style.display = show ? 'block' : 'none';
  }

  setContinueAvailable(show: boolean): void {
    this.continueBtn.style.display = show ? '' : 'none';
  }

  private syncLog(world: World): void {
    // The tick of the newest line, not the length of the list. The log is capped
    // at eighty in `sim/world.ts`, so once a colony has said eighty things the
    // length never changes again — keying off it froze this panel permanently on
    // whatever the crew happened to be doing that afternoon.
    const last = world.messages[world.messages.length - 1];
    const sig = `${world.messages.length}:${last?.tick ?? -1}:${last?.text ?? ''}`;
    if (sig === this.logSig) return;
    this.logSig = sig;
    const recent = world.messages.slice(-7);
    this.log.innerHTML = recent
      .map((m) => `<div class="${m.kind}">${escapeHtml(m.text)}</div>`)
      .join('');
  }

  /**
   * The standing list of what is wrong. Rebuilt only when the list itself
   * changes — it is a strip of clickable rows, and re-making them every frame
   * would eat a click that landed between two frames.
   */
  private syncAlerts(world: World): void {
    const list = alerts(world).slice(0, MAX_ALERTS);
    const sig = list.map((a) => `${a.level}:${a.id}:${a.text}`).join('|');
    this.alertPanel.style.display = list.length === 0 ? 'none' : 'flex';
    if (sig === this.alertSig) return;
    this.alertSig = sig;
    this.alertPanel.innerHTML = '';
    for (const a of list) {
      const row = el('div', `alert ${a.level}`);
      row.innerHTML = `<b>${escapeHtml(a.text)}</b><span>${escapeHtml(a.hint)}</span>`;
      // Clicking an alert answers "where?" — select whoever it is about and put
      // the camera on them. An alert you cannot find is barely an alert.
      if (a.pawnId !== undefined || a.at) {
        row.classList.add('go');
        row.onclick = () => {
          if (a.pawnId !== undefined) this.hooks.select({ type: 'pawn', id: a.pawnId });
          if (a.at) this.hooks.focus(a.at.x, a.at.y);
        };
      }
      this.alertPanel.append(row);
    }
  }

  /**
   * What to do next. Three at a time — a fourteen-line checklist is a wall, and
   * a wall is read exactly as often as an empty panel. Rebuilt on change only,
   * same as the alerts, because these rows have a hint that a player is often
   * halfway through reading.
   */
  private syncGoals(world: World): void {
    // Switched off, the curriculum simply has nothing outstanding to say. The
    // milestones still earn, still write their line in the log, and still send
    // back the caravan and the herd — turning off the tutoring must not turn off
    // the world's half of the conversation.
    const list = this.guideOff ? [] : nextObjectives(world, MAX_GOALS);
    const score = objectiveScore(world);
    // The exam under the curriculum, in the same panel on purpose. A win path the
    // player has to go and open is a win path most players never see, and this is
    // the panel they already read between decisions. Only the outstanding
    // charters get a row — the header carries the ones already behind them — so
    // the two lists together never run past six lines.
    const cs = charters(world);
    const short = cs.filter((c) => !c.met);
    const left = foundingLeft(world);
    // It also stands down while something is selected, because the details panel
    // is parked in the same corner and the two of them drew over each other. The
    // contextual panel wins that argument: the checklist is what you read between
    // decisions, and a milestone still says so in the log either way. A player who
    // has dragged the goals panel somewhere of their own keeps both — the default
    // position is the only one that collides, so it is the only one that yields.
    const parked = this.layout.goals?.x === undefined;
    // A founded colony keeps its next steps and loses only the exam it has
    // already passed. This used to hide the whole panel on a win, which was
    // right when a win was the end of the run and is wrong now that the colony
    // carries on — the tutorial goals are the only guidance on screen, and
    // taking them away as a prize is the same mistake `victory.ts` made.
    const won = hasWon(world);
    // …and it trades the exam for the three roads out of the valley, in the same
    // panel and the same rows. A player who learned to read this corner during
    // the founding does not have to learn a second one to see where the rest of
    // the run is going, and the roads are read the same way the charters were:
    // a title, a count, a bar, and where the work is.
    const rs = won ? roads(world) : [];
    const empty = list.length === 0 && !won && short.length === 0 && left === null;
    const hide = empty || (parked && this.inspector.style.display !== 'none');
    this.goalPanel.style.display = hide ? 'none' : 'flex';
    if (empty) return;
    const days = left === null ? '' : (left / TICKS_PER_DAY).toFixed(1);
    const sig =
      `${score.done}|${list.map((o) => `${o.id}:${o.count}`).join('|')}` +
      `|F${cs.length - short.length}|${short.map((c) => `${c.id}:${c.count}`).join('|')}|${days}` +
      // Or the panel keeps the founding section it was showing the tick before
      // the colony was founded, forever: none of the counts above have to move
      // on the tick that wins. The rungs carry that flag now — an unfounded
      // colony has no roads, so the empty string is the "not yet" it used to be.
      `|${rs.map((r) => `${r.id}${r.rung}:${r.count}`).join('|')}`;
    if (sig === this.goalSig) return;
    this.goalSig = sig;
    this.goalPanel.innerHTML = '';
    if (list.length > 0) {
      const head = el('div', 'goalhead');
      head.innerHTML =
        `<b>Next steps</b><span>${score.done}/${score.total} done</span>` +
        `<a class="off" title="Hide the next steps. The ? button puts them back.">✕</a>`;
      // Rewired on every rebuild rather than once, because the panel throws its
      // own contents away whenever a count changes — the same reason the drag
      // grip is a pseudo-element.
      head.querySelector('a.off')?.addEventListener('click', () => this.setGuide(true));
      this.goalPanel.append(head);
      for (const o of list) {
        const row = el('div', 'goal');
        row.innerHTML =
          `<b>${escapeHtml(o.title)}</b>` +
          `<u>${escapeHtml(o.count)}</u>` +
          `<div class="track"><i style="width:${Math.round(o.progress * 100)}%"></i></div>` +
          `<span>${escapeHtml(o.hint)}</span>`;
        this.goalPanel.append(row);
      }
    }
    // Nothing left to examine. The card said it, the chronicle keeps it, and a
    // permanent 5/5 row on the one panel the player reads between decisions is
    // a trophy taking up the space guidance was using. What goes in its place is
    // the part of the run that is still ahead.
    if (won) {
      const rhead = el('div', 'goalhead');
      rhead.innerHTML = `<b>The roads</b><span>where this goes</span>`;
      this.goalPanel.append(rhead);
      for (const r of rs) {
        const row = el('div', 'goal');
        // The ending is the reason to walk the road and it is one sentence too
        // long for a panel this size, so it lives on the hover. The line itself
        // answers the two questions a ladder has to: what am I, and what is next.
        row.title = r.ending;
        row.innerHTML =
          `<b>${escapeHtml(r.standing ? `${r.title} — ${r.standing}` : r.title)}</b>` +
          `<u>${escapeHtml(r.count)}</u>` +
          `<div class="track"><i style="width:${Math.round(r.progress * 100)}%"></i></div>` +
          `<span>${escapeHtml(r.next ? `Next: ${r.next}. ${r.hint}` : r.ending)}</span>`;
        this.goalPanel.append(row);
      }
      return;
    }
    const fhead = el('div', 'goalhead');
    fhead.innerHTML =
      `<b>The founding</b><span>${cs.length - short.length}/${cs.length} charters</span>`;
    this.goalPanel.append(fhead);
    if (left !== null) {
      // Every charter is met and the clock is running. One line, and it is the
      // most important line on the screen — anything that breaks now resets it.
      const row = el('div', 'goal founding');
      const frac = 1 - left / (TICKS_PER_DAY * HOLD_DAYS);
      row.innerHTML =
        `<b>Hold the colony together</b><u>${escapeHtml(days)} days left</u>` +
        `<div class="track"><i style="width:${Math.round(frac * 100)}%"></i></div>` +
        `<span>Lose a settler, a turret or the pantry now and the founding starts over.</span>`;
      this.goalPanel.append(row);
      return;
    }
    for (const c of short.slice(0, MAX_GOALS)) {
      const row = el('div', 'goal');
      row.innerHTML =
        `<b>${escapeHtml(c.title)}</b>` +
        `<u>${escapeHtml(c.count)}</u>` +
        `<div class="track"><i style="width:${Math.round(Math.max(0, Math.min(1, c.at / c.of)) * 100)}%"></i></div>` +
        `<span>${escapeHtml(c.hint)}</span>`;
      this.goalPanel.append(row);
    }
  }

  /**
   * Raise a card for a story beat. Called by the app as messages arrive, rather
   * than read off the tail of the log here — the app is already walking the new
   * messages to play their sounds, and two places counting the same list is how
   * one of them ends up off by one.
   */
  notify(m: Message): void {
    this.toasts.push(m);
  }

  /**
   * Put the card column in the gap the panels have left it.
   *
   * Measured rather than guessed, and measured every frame a card is up rather
   * than once at startup, because the panels move: the roster is taller with six
   * settlers than with three, the inspector only exists while somebody is
   * selected, and the player can drag any of them anywhere. The cost is five
   * rectangles on the frames where there is news, which is a small fraction of
   * them. See `cardChannel` for what the numbers mean.
   */
  private fitCards(): void {
    const top = this.cards.offsetTop;
    const boxes: Box[] = [];
    for (const p of [this.colonists, this.inspector, this.goalPanel, this.log, this.alertPanel]) {
      // A folded or hidden panel is not in the way. `offsetParent` is null for
      // `display: none`, and the rect is empty either way.
      if (!p.offsetParent) continue;
      boxes.push(p.getBoundingClientRect());
    }
    // The band is the column's own height once it has cards in it, and three
    // cards' worth before it does — otherwise the first card of a run would be
    // placed against an empty band and jump sideways as it appeared.
    const height = Math.max(220, this.cards.getBoundingClientRect().height);
    const fit = cardChannel(this.root.clientWidth, { top, bottom: top + height }, boxes);
    this.cards.style.left = `${fit.left}px`;
    this.cards.style.width = `${fit.width}px`;
    this.cards.style.transform = 'none';
  }

  /** Wipe the cards. A loaded save does not inherit the last colony's news. */
  clearCards(): void {
    this.toasts.clear();
    this.cardSig = '';
  }

  /**
   * Age the cards and redraw them if the set changed.
   *
   * Driven by the render clock, and by zero while the game is paused — see
   * `ToastStack.age`. Rebuilt only when the list itself changes, because these
   * carry buttons and re-making the elements every frame would eat a click that
   * landed between two frames. Opacity is set every frame regardless: it changes
   * continuously and it is not something a finger can miss.
   */
  tickCards(dt: number, view: ViewMode): void {
    this.toasts.age(dt);
    const list = this.toasts.list();
    if (list.length > 0) this.fitCards();
    const sig = list.map((t) => `${t.id}:${view === 'manager' && t.at ? 'go' : ''}`).join('|');
    if (sig !== this.cardSig) {
      this.cardSig = sig;
      this.cards.innerHTML = '';
      this.cardEls.clear();
      for (const t of list) {
        const card = el('div', `newscard ${t.kind}`);
        const line = el('div', 'said');
        line.textContent = t.text;
        card.append(line);
        // A place to look is only useful from the view that has a camera to
        // move. Inside a body the button would either yank the player out of it
        // or do nothing, and both are worse than not offering.
        if (t.at && view === 'manager') {
          const look = el('button', 'look');
          look.textContent = 'Look';
          look.onclick = (e: Event) => {
            e.stopPropagation();
            this.hooks.focus(t.at!.x, t.at!.y);
          };
          card.append(look);
        }
        const shut = el('button', 'shut');
        shut.textContent = '×';
        shut.title = 'Dismiss';
        shut.onclick = (e: Event) => {
          e.stopPropagation();
          this.toasts.dismiss(t.id);
          this.cardSig = '';
        };
        card.append(shut);
        this.cards.append(card);
        this.cardEls.set(t.id, card);
      }
    }
    for (const t of list) {
      const elem = this.cardEls.get(t.id);
      if (elem) elem.style.opacity = String(ToastStack.opacity(t));
    }
  }

  // ------------------------------------------------------------------ overlays

  toggleWorkTab(): void {
    this.worktabOpen = !this.worktabOpen;
    this.workSig = '';
  }

  toggleResearchTab(): void {
    this.researchOpen = !this.researchOpen;
    this.researchSig = '';
  }

  toggleTradeTab(): void {
    this.tradeOpen = !this.tradeOpen;
    this.tradeSig = '';
  }

  toggleRoadTab(): void {
    this.roadOpen = !this.roadOpen;
    this.roadSig = '';
    // Two panels in the same place would draw on top of each other.
    if (this.roadOpen) {
      this.tradeOpen = false;
      this.chronicleOpen = false;
    }
  }

  toggleChronicleTab(): void {
    this.chronicleOpen = !this.chronicleOpen;
    this.chronicleSig = '';
    // Same corner as the road and the shop, same rule.
    if (this.chronicleOpen) {
      this.tradeOpen = false;
      this.roadOpen = false;
    }
  }

  toggleHelp(): void {
    this.helpOverlay.classList.toggle('on');
  }

  get helpOpen(): boolean {
    return this.helpOverlay.classList.contains('on');
  }

  // ------------------------------------------------------------------- backup

  /**
   * Open the card with the colony already in the box.
   *
   * Filled on open rather than on a button press because the failure this
   * exists for is silent: nothing warns a player that their address is about to
   * change, so the code has to be *there* the moment they look, not one more
   * click away. Cheap enough — packing 220 kB takes a few milliseconds and the
   * sim is not waiting on it.
   */
  private openBackup(): void {
    this.backupOverlay.classList.add('on');
    this.codeBox.value = '';
    this.codeNote.textContent = 'Packing the colony…';
    void this.hooks
      .colonyCode()
      .then((code) => {
        this.codeBox.value = code;
        this.codeNote.textContent = `${Math.round(code.length / 1024)} kB — this is the whole colony.`;
      })
      .catch(() => {
        this.codeNote.textContent = 'Could not pack the colony. Try Save first.';
      });
  }

  get backupOpen(): boolean {
    return this.backupOverlay.classList.contains('on');
  }

  closeBackup(): void {
    this.backupOverlay.classList.remove('on');
  }

  private async copyCode(): Promise<void> {
    const code = this.codeBox.value;
    if (!code) return;
    // select() first and unconditionally: on iPad the clipboard API can be
    // refused outright, and a player looking at a selected box can still do it
    // by hand. Losing the copy is not the same as losing the colony, but only
    // if the text is still reachable when the button fails.
    this.codeBox.focus();
    this.codeBox.select();
    try {
      await navigator.clipboard.writeText(code);
      this.codeNote.textContent = 'Copied. Paste it somewhere you will find it again.';
    } catch {
      this.codeNote.textContent = 'Copy was blocked — the code is selected, use ⌘C or long-press.';
    }
  }

  /**
   * The same text as a file. Belt and braces: a 20 kB clipboard is fine on a
   * desktop and unreliable on a tablet, and a file is the one route that cannot
   * be truncated by whatever the player pastes it into on the way.
   */
  private downloadCode(day: number): void {
    const code = this.codeBox.value;
    if (!code) return;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
    const a = el('a', '', { href: url, download: colonyFilename(day, new Date()) });
    a.click();
    URL.revokeObjectURL(url);
    this.codeNote.textContent = 'Saved to your downloads.';
  }

  private async pasteCode(): Promise<void> {
    const code = this.codeBox.value;
    const why = await this.hooks.loadColonyCode(code);
    if (why === null) {
      this.backupOverlay.classList.remove('on');
      return;
    }
    this.codeNote.textContent = why;
  }

  private buildBackup(): HTMLElement {
    const overlay = el('div', 'overlay');
    const card = el('div', 'card');
    card.innerHTML =
      `<h1>Carry this colony</h1>` +
      `<p>A browser files a saved game under the exact address it was played at. Change the ` +
      `address — a new port, a new machine, a router handing out a different number — and the ` +
      `colony is still on the disk but the game can no longer see it.</p>` +
      `<p>The text below <i>is</i> the colony. Copy it somewhere safe, and you can paste it back ` +
      `in here from any browser, at any address, and carry on from this exact morning.</p>`;
    this.codeBox = el('textarea', 'codebox', {
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      // Not readonly: the same box is where a code gets pasted back in. One box
      // doing both is the difference between "copy this / paste that" and a card
      // with two identical grey rectangles a player has to tell apart.
      placeholder: 'Paste a colony code here to load it',
    }) as HTMLTextAreaElement;
    this.codeNote = el('p', 'codenote');
    card.append(this.codeBox, this.codeNote);

    const acts = el('div', 'acts');
    const copy = el('button', 'btn', {}, 'Copy') as HTMLButtonElement;
    copy.onclick = () => void this.copyCode();
    const file = el('button', 'btn', {}, 'Download') as HTMLButtonElement;
    file.title = 'Save the code as a file instead — safer than a clipboard on a tablet';
    file.onclick = () => this.downloadCode(this.lastDay);
    const paste = el('button', 'btn', {}, 'Load this code') as HTMLButtonElement;
    paste.title = 'Replace the colony on screen with the one in the box';
    paste.onclick = () => void this.pasteCode();
    const close = el('button', 'btn', {}, 'Close') as HTMLButtonElement;
    close.onclick = () => overlay.classList.remove('on');
    acts.append(copy, file, paste, close);
    card.append(acts);
    overlay.append(card);
    return overlay;
  }

  // -------------------------------------------------------------------- setup

  /**
   * The card that starts a colony on purpose rather than by accident.
   *
   * Reached from the help card and from the game-over card, and deliberately
   * *not* from a thirteenth button in the top bar: the bar already holds twelve
   * and the player who most needs the kind setting is the one who has already
   * told us he cannot find things up there.
   */
  openSetup(): void {
    this.setupOverlay.classList.add('on');
    // The seed box always opens empty. It is an escape hatch for a player who
    // wants a valley back, not a field to be edited — pre-filling it with the
    // current seed would quietly turn "New colony" into "replay this one".
    this.seedBox.value = '';
    this.paintSetup();
  }

  get setupOpen(): boolean {
    return this.setupOverlay.classList.contains('on');
  }

  closeSetup(): void {
    this.setupOverlay.classList.remove('on');
  }

  private paintSetup(): void {
    for (const [id, card] of this.setupCards) card.classList.toggle('on', id === this.setupPick);
  }

  /**
   * Read the seed box.
   *
   * Anything that is not a plain number becomes null, which means "roll one" —
   * a player who types their name in there gets a random valley, not an error
   * message and a card that refuses to close. Digits only, because the number
   * is shown back to them at the end of the run and has to be re-typable.
   */
  private seedFromBox(): number | null {
    const raw = this.seedBox.value.trim();
    if (!/^\d{1,12}$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private buildSetup(): HTMLElement {
    const overlay = el('div', 'overlay');
    const card = el('div', 'card');
    card.innerHTML =
      `<h1>A new colony</h1>` +
      `<p>Pick how hard the valley bites. This changes how often something comes out of the ` +
      `treeline, how many of them there are and how hard they hit — nothing else. Food, cold, ` +
      `wounds and how fast a settler learns are the same on all three.</p>`;

    const picks = el('div', 'picks');
    this.setupCards = new Map();
    for (const id of DIFFICULTY_ORDER) {
      const def = DIFFICULTIES[id];
      const pick = el('button', 'pick') as HTMLButtonElement;
      pick.innerHTML = `<b>${escapeHtml(def.label)}</b><span>${escapeHtml(def.blurb)}</span>`;
      pick.onclick = () => {
        this.setupPick = id;
        this.paintSetup();
      };
      this.setupCards.set(id, pick);
      picks.append(pick);
    }
    card.append(picks);

    const seedRow = el('div', 'seedrow');
    seedRow.append(el('label', '', {}, 'Seed'));
    this.seedBox = el('input', 'seedbox', {
      type: 'text',
      inputmode: 'numeric',
      spellcheck: 'false',
      autocomplete: 'off',
      maxlength: '12',
      placeholder: 'leave blank for a new valley',
    }) as HTMLInputElement;
    seedRow.append(this.seedBox);
    card.append(seedRow);
    card.append(
      el(
        'p',
        'codenote',
        {},
        'A seed is the number the whole valley is grown from — the same seed is the same map, ' +
          'the same ore and the same three settlers on every difficulty. The one you just ' +
          'played is on the final tally.',
      ),
    );

    const acts = el('div', 'acts');
    const go = el('button', 'btn', {}, 'Land here') as HTMLButtonElement;
    go.onclick = () => {
      overlay.classList.remove('on');
      // The HUD outlives the world it is showing, so the new valley has to be
      // handed back its endings — otherwise a colony started from the founded
      // card would go its whole life unable to show one.
      this.resetEnding();
      this.hooks.restart({ difficulty: this.setupPick, seed: this.seedFromBox() });
    };
    const cancel = el('button', 'btn', {}, 'Cancel') as HTMLButtonElement;
    cancel.onclick = () => overlay.classList.remove('on');
    acts.append(go, cancel);
    card.append(acts);
    overlay.append(card);
    return overlay;
  }

  private cycleQuality(): void {
    const order: Quality[] = ['high', 'medium', 'low'];
    const cur = this.qualityBtn.textContent?.split(': ')[1] as Quality | undefined;
    const next = order[(order.indexOf(cur ?? 'high') + 1) % order.length]!;
    this.hooks.setQuality(next);
  }

  /**
   * Which ending card the world is owed, if any.
   *
   * There are five endings now and only one of them stops the game: a wipe is
   * final, a founding is a headline the colony carries on past, and a terminal
   * is the far end of a road the valley outlives. So this can't be the old
   * `if (over) show(); else hide();` — that reopened the card on the very next
   * frame after the player dismissed it, for the rest of the run. It shows each
   * ending once, remembers which, and otherwise keeps its hands off an overlay
   * the player has already closed.
   *
   * A colony can earn three in one run — founded on day thirty, sailed on day
   * fifty, and whoever stayed overrun on day ninety — and each still deserves
   * its card, which is why this is the ending shown rather than a boolean.
   */
  private syncEnding(world: World): void {
    if (world.gameOver) {
      if (this.endingShown === 'lost') return;
      this.endingShown = 'lost';
      this.showEnding(world, 'lost');
      return;
    }
    // Before the founding, because by the time a terminal lands the founding
    // card has long since been shown and dismissed, and the terminal is the
    // bigger news. Gated on the id rather than on `'none'` for the same reason:
    // the state here is already `'won'` and will be for the rest of the run.
    const end = world.ending;
    if (end && end.landed !== null && this.endingShown !== end.id) {
      this.endingShown = end.id;
      this.showEnding(world, end.id);
      return;
    }
    if (hasWon(world) && this.endingShown === 'none') {
      this.endingShown = 'won';
      this.showEnding(world, 'won');
    }
  }

  /** Wipe the memory of a shown card, so a fresh colony gets its own endings. */
  private resetEnding(): void {
    this.endingShown = 'none';
    this.overOverlay.classList.remove('on');
  }

  private showEnding(world: World, outcome: 'won' | 'lost' | EndingId): void {
    this.overOverlay.classList.add('on');
    // A terminal reads its tally off the record rather than off the world, and
    // the other two off the world because for them there is no difference — a
    // wipe stops the clock and a founding is shown on the tick it happens. A
    // terminal is the one card the player can be looking at twenty days after
    // the moment it is about. See `EndingRecord`.
    const rec = outcome === 'won' || outcome === 'lost' ? null : endingRecord(world);
    const stats = rec?.stats ?? world.stats;
    // The same card every time, because a run that ends in a founding deserves
    // the same tally a run that ends in a wipe gets — it is the only place the
    // whole colony is summed up, and a win with no numbers behind it reads as an
    // achievement popup rather than an ending.
    const term = rec ? endingProgress(world) : null;
    const head = term
      ? `<h1>${escapeHtml(term.title)}</h1><p>${escapeHtml(term.blurb)} ` +
        `${rec!.standing} settler${rec!.standing === 1 ? '' : 's'} saw it through.</p>`
      : outcome === 'won'
        ? `<h1>Aetherhold stands</h1><p>Every charter held for ${HOLD_DAYS} days. ` +
          `The colony is founded — a place on the map with a name, a wall and friends over the ridge.</p>`
        : `<h1>Aetherhold has fallen</h1><p>${escapeHtml(
            world.messages.filter((m) => m.kind === 'bad').slice(-1)[0]?.text ??
              'The colony is gone.',
          )}</p>`;
    this.overCard.innerHTML =
      head +
      `<h2>Final tally</h2><dl><dt>Days survived</dt><dd>${rec?.day ?? dayNumber(world)}</dd>` +
      `<dt>Structures built</dt><dd>${stats.built}</dd>` +
      `<dt>Meals cooked</dt><dd>${stats.mealsCooked}</dd>` +
      `<dt>Raiders killed</dt><dd>${stats.raidersKilled}</dd>` +
      `<dt>Caravans returned</dt><dd>${stats.caravans ?? 0}</dd>` +
      `<dt>Settlers lost</dt><dd>${stats.colonistsLost}</dd>` +
      // Named here and nowhere else, because this is the one moment a player
      // wants both: the difficulty says what the tally above was worth, and the
      // seed is the only way to hand this exact valley to somebody else — or to
      // come back and take it on harder terms.
      `<dt>Valley</dt><dd>${escapeHtml(DIFFICULTIES[world.difficulty ?? 'settler'].label)}</dd>` +
      `<dt>Seed</dt><dd>${world.seed}</dd></dl>`;
    const acts = el('div', 'acts');
    // First, and on anything but a wipe, because it is the one the player
    // actually wants: the charters are met, or the ship is away, and the reward
    // for all of that should not be a card that only offers to throw the place
    // away. The colony is still running behind this overlay — dismissing it is
    // the whole action.
    if (outcome !== 'lost') {
      const on = el('button', 'btn strong', {}, 'Keep playing') as HTMLButtonElement;
      on.onclick = () => this.overOverlay.classList.remove('on');
      acts.append(on);
    }
    const again = el('button', 'btn', {}, 'New colony…') as HTMLButtonElement;
    // Straight to the setup card rather than straight to a new valley: the
    // player who just lost is the one with an opinion about the difficulty.
    again.onclick = () => {
      this.setupPick = world.difficulty ?? 'settler';
      this.openSetup();
    };
    acts.append(again);
    this.overCard.append(acts);
  }

  private buildHelp(): HTMLElement {
    const overlay = el('div', 'overlay');
    const card = el('div', 'card');
    // Every line below this point names a key or a mouse button, which on a
    // tablet is a manual for hardware the reader does not have. Asked at build
    // time rather than waiting for `Input.touchSeen`, because the card is the
    // first thing on screen and by then it is too late to be useful. A touch
    // laptop gets both sections, which is correct — both work there.
    const touchy = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
    const glass = touchy
      ? `<h2>On glass</h2><dl>` +
        `<dt>One finger</dt><dd>tap to select · drag to move the map — or to paint, when a tool is picked</dd>` +
        `<dt>Two fingers</dt><dd>drag to pan · pinch to zoom — always the camera, whatever is armed</dd>` +
        `<dt>The bottom bar</dt><dd>every order lives there; <b>Select</b> and <b>Cancel</b> are under <b>Orders</b></dd>` +
        `<dt>Inside a body</dt><dd>the thumb pad walks · drag the world to look · <b>E</b>, <b>Fire</b>, ` +
        `<b>T</b> and <b>Colony</b> run down the right</dd>` +
        `</dl>`
      : '';
    card.innerHTML =
      `<h1>AETHERHOLD</h1><p>Three settlers, one clearing, and whatever comes out of the treeline. ` +
      `You can run the colony from above or step inside any settler's body — it is the same world either way.</p>` +
      `<h2>Colony view</h2><dl>` +
      `<dt>WASD / arrows</dt><dd>pan · <b>wheel</b> zoom · <b>Q/E</b> rotate · <b>R/F</b> tilt</dd>` +
      `<dt>Left click</dt><dd>select settler or building</dd>` +
      `<dt>Right click</dt><dd>order the selected settler to move (drafts them)</dd>` +
      `<dt>1 – 9, 0</dt><dd>pick a blueprint, then drag to place</dd>` +
      `<dt>Z / C / X / ⌫</dt><dd>stockpile · chop/mine · deconstruct · cancel (hold Shift to erase)</dd>` +
      `<dt>B / N</dt><dd>grow zone · till soil — broken ground ripens a crop a quarter faster</dd>` +
      `<dt>H / K / Y</dt><dd>hunt · tame · pen — a pen holds one animal per six cells, breeds, and pays out milk and down to your farmhands</dd>` +
      `<dt>U / I / O</dt><dd>bridge · plank floor · paved floor — settlers walk quicker on all three, fire will not cross paving, and a bridge is the only one that goes over water</dd>` +
      `<dt>T</dt><dd>draft or undraft · <b>Tab</b> cycle settlers · <b>P</b> work priorities · <b>L</b> research</dd>` +
      `<dt>M</dt><dd>trade — only while a caravan is standing in the yard</dd>` +
      `<dt>J</dt><dd>the road — send a settler over the ridge to the neighbours</dd>` +
      `<dt>;</dt><dd>the story — everything that has happened here, by day. The corner log only keeps the last few minutes; this keeps the rest.</dd>` +
      `<dt>\`</dt><dd>send a Picky — a little pink goblin runs to the cell you click and says whether it got there. Nobody going somewhere? Ask one.</dd>` +
      `<dt>Space</dt><dd>pause · <b>-</b> and <b>=</b> slow down / speed up — manager only</dd>` +
      `<dt>G</dt><dd>possess the selected settler</dd>` +
      `</dl><h2>First person</h2><dl>` +
      `<dt>V</dt><dd>switch view, any time, no reload</dd>` +
      `<dt>WASD / Shift</dt><dd>walk / run — <b>A</b> and <b>D</b> step sideways, they do not turn</dd>` +
      `<dt>Mouse or ← →</dt><dd>turn · <b>↑ ↓</b> look up and down · click once to grab the mouse</dd>` +
      `<dt>E</dt><dd>interact: mine rock, chop trees, beds, food, stoves, blueprints, fires, wounded</dd>` +
      `<dt>Click</dt><dd>attack — only while drafted</dd>` +
      `<dt>Esc</dt><dd>release the mouse</dd>` +
      `</dl>` +
      glass +
      `<h2>How a run ends</h2>` +
      `<p>Badly, if everybody dies. Well, if you can meet all five <b>charters</b> at once — eight ` +
      `settlers, twelve days of food, two turrets, six research projects, and an ally over the ridge ` +
      `— and then hold every one of them for three days. They are listed under <b>The founding</b> ` +
      `in the goals panel from your first morning, so you can see where you are going long before ` +
      `you can get there.</p>` +
      `<p><b>New colony…</b> below starts over and lets you say how hard the valley bites first. ` +
      `The <b>Quiet valley</b> gives you time to get a wall up; <b>Hard country</b> does not. It ` +
      `changes what comes out of the treeline and nothing else — food, cold and wounds cost the ` +
      `same on all three.</p>` +
      `<p style="margin-top:12px">Orders you give from above become jobs your body can carry out. ` +
      `Walk somewhere yourself and you have overridden the order — that is intended.</p>` +
      `<p><b>Save</b> keeps a colony you choose to keep. The game also autosaves every minute and ` +
      `whenever you close the tab — <b>Continue</b> in the top bar picks that one up.</p>` +
      `<p>Saves live in the browser, filed under the exact address you played at, so a colony ` +
      `does not follow you to a different link or a different device. <b>Backup</b> hands you the ` +
      `whole colony as text — copy it, keep it, and paste it back in anywhere to carry on from ` +
      `that morning.</p>` +
      `<p><b>Next steps</b> in the goals panel is the game teaching you the order colonies ` +
      `usually die in — and a few of those steps send something back: bank enough steel and a ` +
      `pedlar is already on the road, search a ruin and somebody may come out of the trees. ` +
      `If you would rather work it out yourself, the <b>✕</b> on that header hides the list, ` +
      `and <b>Hide / Show next steps</b> below does the same thing from here. The charters, ` +
      `the milestones in the log and everything they send stay either way.</p>` +
      `<p>The settler list, the details panel and the log all have a <b>⠿</b> in the corner: ` +
      `drag it to move the panel, click it to fold the panel away, and drag the bottom-right ` +
      `corner of the details panel or the log to resize it. Where you leave them is remembered.</p>`;
    const acts = el('div', 'acts');
    const close = el('button', 'btn', {}, 'Play') as HTMLButtonElement;
    close.onclick = () => overlay.classList.remove('on');
    const reset = el('button', 'btn', {}, 'Reset panels') as HTMLButtonElement;
    reset.onclick = () => this.resetPanels();
    this.guideBtn = el(
      'button',
      'btn',
      {},
      this.guideOff ? 'Show next steps' : 'Hide next steps',
    ) as HTMLButtonElement;
    this.guideBtn.onclick = () => this.setGuide(!this.guideOff);
    const fresh = el('button', 'btn', {}, 'New colony…') as HTMLButtonElement;
    fresh.title = 'Start over — pick how hard the valley bites, and a seed if you want one';
    fresh.onclick = () => {
      overlay.classList.remove('on');
      this.openSetup();
    };
    acts.append(close, reset, this.guideBtn, fresh);
    card.append(acts);
    overlay.append(card);
    return overlay;
  }
}

// ---------------------------------------------------------------- colonist row

class ColonistRow {
  readonly el: HTMLElement;
  private readonly name: HTMLElement;
  private readonly act: HTMLElement;
  private readonly bars: Record<string, HTMLElement> = {};
  private readonly tags: HTMLElement;

  constructor(pawn: Pawn, onClick: (id: number) => void) {
    this.el = el('div', 'panel colonist');
    this.el.onclick = () => onClick(pawn.id);
    const row1 = el('div', 'row1');
    this.name = el('span', 'name', {}, pawn.name);
    this.act = el('span', 'act');
    row1.append(this.name, this.act);
    const bars = el('div', 'bars');
    for (const key of ['hp', 'food', 'rest', 'rec', 'mood']) {
      const b = el('div', `bar ${key}`);
      const fill = el('i');
      b.append(fill);
      this.bars[key] = fill;
      bars.append(b);
    }
    this.tags = el('div', 'taglist');
    this.el.append(row1, bars, this.tags);
  }

  update(world: World, p: Pawn, selected: boolean): void {
    this.el.classList.toggle('sel', selected);
    this.el.classList.toggle('downed', p.downed);
    this.act.textContent = p.downed ? 'downed' : jobLabel(world, p);
    this.bars.hp!.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    this.bars.food!.style.width = `${p.needs.food * 100}%`;
    this.bars.rest!.style.width = `${p.needs.rest * 100}%`;
    this.bars.rec!.style.width = `${p.needs.recreation * 100}%`;
    this.bars.mood!.style.width = `${p.mood * 100}%`;
    const tags: string[] = [];
    if (p.playerControlled) tags.push('<span class="tag you">YOU</span>');
    // Ahead of the needs tags: hungry and tired are the cause, the break is the
    // consequence, and the player wants to see the consequence first.
    if (isBreaking(p)) tags.push('<span class="tag broke">BREAK</span>');
    if (p.drafted) tags.push('<span class="tag draft">DRAFTED</span>');
    // A settler taken off the work board and then forgotten stands in the yard
    // doing nothing, and the colonist list is the only place the player looks to
    // find out why the fence is not going up.
    if (p.manual) tags.push('<span class="tag hand">BY HAND</span>');
    // Beside the break tag and above the needs, because an untended fever is the
    // one thing on this card that kills somebody while the player is not looking.
    const ill = worstAilment(p);
    if (ill) {
      const tended = world.tick < ill.tendedUntil;
      tags.push(
        `<span class="tag ${tended ? '' : 'broke'}">${AILMENTS[ill.kind].label.replace(
          /^(a|an|the) /,
          '',
        )}${tended ? '' : ' — untended'}</span>`,
      );
    }
    if (p.needs.food < 0.25) tags.push('<span class="tag">hungry</span>');
    if (p.needs.rest < 0.25) tags.push('<span class="tag">tired</span>');
    if (p.hp < p.maxHp * 0.7) tags.push('<span class="tag">hurt</span>');
    this.tags.innerHTML = tags.join('');
  }
}

// --------------------------------------------------------------------- helpers

/**
 * Which tab the current tool lives under, or null if it does not belong to one.
 *
 * `select` is deliberately null: it is the resting state the player returns to
 * after every order, and following it would slam the bar back to the Orders tab
 * each time somebody finished placing a wall.
 */
function groupOf(s: HudState): string | null {
  if (s.tool === 'build' && s.buildKind !== null) {
    const kind = s.buildKind;
    return BUILD_GROUPS.find((g) => g.kinds.includes(kind))?.name ?? null;
  }
  if (s.tool === 'select') return null;
  return TOOL_GROUPS.find((g) => g.tools.some(([tool]) => tool === s.tool))?.name ?? null;
}

function el(
  tag: string,
  cls = '',
  attrs: Record<string, string> = {},
  text = '',
): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * The two-bar race, one block per illness.
 *
 * Severity and immunity are shown against each other rather than as percentages,
 * because the only question a player has is "which one is winning" — and a pair
 * of numbers makes you do arithmetic to answer it. The tended flag is on the row
 * because the answer to "it is losing" is almost always "nobody has tended it".
 */
function ailmentRows(world: World, p: Pawn): string {
  const list = p.ailments ?? [];
  if (list.length === 0) return '';
  return list
    .map((a) => {
      const def = AILMENTS[a.kind];
      const winning = a.immunity >= a.severity;
      const tended = world.tick < a.tendedUntil;
      return (
        `<div class="kv"><span>${def.label}</span><b style="color:${
          winning ? 'var(--good)' : 'var(--bad)'
        }">${tended ? 'tended' : 'untended'}</b></div>` +
        bar('hp', a.severity, 'illness') +
        bar('mood', a.immunity, 'immunity')
      );
    })
    .join('');
}

function bar(kind: string, value: number, label: string): string {
  return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><span style="width:44px;color:var(--dim);font-size:11px">${label}</span><div class="bar ${kind}" style="flex:1"><i style="width:${Math.max(
    0,
    Math.min(1, value) * 100,
  )}%"></i></div></div>`;
}

/**
 * What the road panel offers to load, in the order it offers it.
 *
 * Not every resource: meals and medicine are on the list because a colony that
 * has spare ones has genuinely got somewhere, and putting them beside the raw
 * materials is how the panel says so. The order runs cheapest first so the row a
 * new colony can actually afford is the row at the top.
 */
const PACK_KINDS: ResourceKind[] = ['wood', 'rawfood', 'steel', 'meal', 'medicine', 'hide'];

const JOB_LABEL: Record<Job['kind'], string> = {
  haulToStockpile: 'hauling',
  haulToBlueprint: 'fetching materials',
  build: 'building',
  deconstruct: 'deconstructing',
  mine: 'mining',
  chop: 'chopping',
  cook: 'cooking',
  fish: 'fishing',
  till: 'breaking ground',
  floor: 'laying floor',
  sow: 'sowing',
  harvestCrop: 'harvesting crops',
  forage: 'foraging',
  eat: 'eating',
  sleep: 'sleeping',
  recreate: 'relaxing',
  doctor: 'treating the wounded',
  feedPatient: 'feeding a patient',
  craft: 'crafting',
  research: 'researching',
  firefight: 'fighting the fire',
  hunt: 'hunting',
  tame: 'taming an animal',
  gatherAnimal: 'working the pen',
  scout: 'scouting',
  capture: 'carrying a captive',
  feedPrisoner: 'feeding a prisoner',
  recruit: 'talking to a prisoner',
  flee: 'running from the fire',
  rescue: 'carrying someone clear',
  bury: 'burying the dead',
  caravan: 'leaving with a caravan',
  campaign: 'marching to war',
  moveTo: 'walking there',
};

function jobLabel(world: World, p: Pawn): string {
  if (p.dead) return 'dead';
  if (p.downed) return 'downed';
  if (p.jobId !== null) {
    const job = world.jobs.find((j) => j.id === p.jobId);
    // Recreation is the one job whose label depends on where it is being done:
    // "relaxing" is true of all three spots and tells the player nothing, while
    // "sitting by the fire" tells them the campfire is still lit and worth the
    // wood. Everything else has one label because everything else has one shape.
    if (job && job.kind === 'recreate') {
      const spot = findBuilding(world, job.buildingId);
      return spot ? recLabel(spot.kind) : JOB_LABEL.recreate;
    }
    if (job) return JOB_LABEL[job.kind];
  }
  if (p.drafted) return 'drafted';
  // Ahead of the raw activity because "breaking" on its own reads as a state the
  // settler is in rather than as the thing the player has to go and fix.
  if (p.activity === 'breaking') return 'stopped working';
  return p.activity;
}

function carriedLabel(world: World, p: Pawn): string {
  const it = findItem(world, p.carryingItemId);
  return it ? `${it.amount} ${it.kind}` : 'nothing';
}

function occupantName(world: World, id: number | null | undefined): string {
  if (id === null || id === undefined) return 'empty';
  return findPawn(world, id)?.name ?? 'empty';
}

/**
 * Whether a climate machine is doing anything, in the order the player can fix it.
 *
 * Walls first, then fuel or watts: a cooler in the open yard cannot be rescued by
 * a generator, so telling somebody about the power before the room would send
 * them off to solve the wrong problem. The room size is on the end because it is
 * the number that decides whether the machine is winning — the same cooler is a
 * freezer in a larder and a draught in a hall.
 */
function climateStatus(world: World, b: Building): string {
  const room = roomAt(world, b.x, b.y);
  if (!room) return 'no — needs a walled room';
  if (b.kind === 'campfire') {
    return (b.fuel ?? 0) > 0 ? `yes · ${room.size} cells` : 'no — out of wood';
  }
  if (b.powered !== true) return b.unwired ? 'no — not wired' : 'no — no power';
  return `yes · ${room.size} cells`;
}

/**
 * The air where a settler is standing, and what it is doing to them.
 *
 * Two numbers in one row on purpose. The temperature alone does not tell the
 * player whether to worry — 4°C is a bad night outdoors and a well-run larder —
 * and the word alone hides the fact that the fire is winning. "cold" appears at
 * the exact point the immune system starts paying for it, so a player who reads
 * this row and lights a fire has fixed the thing the row was warning about.
 */
function warmthRow(world: World, p: Pawn): string {
  const air = cellTemp(world, Math.round(p.x), Math.round(p.y));
  const c = p.comfort ?? comfortAt(air);
  const word =
    c <= -0.75
      ? 'freezing'
      : c < COLD_BELOW
        ? 'cold'
        : c < 0
          ? 'chilly'
          : c === 0
            ? 'comfortable'
            : c < 0.5
              ? 'warm'
              : 'sweltering';
  const alarm = c < COLD_BELOW || c > 0.5 ? ' style="color:var(--bad)"' : '';
  return `<div class="kv"><span>warmth</span><b${alarm}>${tempLabel(air)} · ${word}</b></div>`;
}

/**
 * The sum behind the mood number.
 *
 * The card printed `mood 41%` and stopped, which is the one reading on it a
 * player cannot act on: forty-one percent of *what*, dragged down by which of
 * hunger, cold, an ugly bunkhouse, generator fumes, a friend buried yesterday,
 * or a pessimist having an ordinary week. Every one of those has a different
 * answer and several of them are invisible from the colony view.
 *
 * So: the whole sum, worst first, signed against a settler with nothing wrong
 * with them. Nothing is summarised and nothing is ranked by the panel — this is
 * `moodBreakdown` printed in the order it comes back, because the moment the UI
 * starts choosing what matters it starts being wrong about it.
 *
 * Rows under half a percent are dropped: they would print as `+0%`, which reads
 * as a bug rather than as a rounding. The remaining rows add up to the mood
 * except where it is pinned at 0 or 100 — a settler at 100% with a `+10%` trait
 * row really does have ten points of slack, and saying so is the point.
 */
function moodRows(p: Pawn): string {
  const rows = moodBreakdown(p)
    .filter((f) => Math.abs(f.amount) >= 0.005)
    .map((f) => {
      const n = Math.round(Math.abs(f.amount) * 100);
      return `<div class="kv why"><span>${escapeHtml(f.label)}</span><b class="${
        f.amount < 0 ? 'bad' : 'good'
      }">${f.amount < 0 ? '-' : '+'}${n}%</b></div>`;
    })
    .join('');
  return rows ? `<div class="sect">why that mood</div>${rows}` : '';
}

/** Kinds whose whole job is the air in the room they stand in. */
function isClimate(kind: Building['kind']): boolean {
  return kind === 'cooler' || kind === 'heater' || kind === 'campfire';
}

/**
 * The room a building stands in, said the way the player would say it.
 *
 * Walls and doors are boundaries rather than floor, so they read "outdoors" —
 * which is right, and is also the fastest way to learn that the room is the
 * space, not the shell.
 */
function roomRow(world: World, b: Building): string {
  const room = roomAt(world, b.x, b.y);
  if (!room) return `<div class="kv"><span>room</span><b>outdoors</b></div>`;
  const doors = room.doorEdges === 1 ? '1 door' : `${room.doorEdges} doors`;
  return (
    `<div class="kv"><span>room</span><b>${room.size} cells · ${doors}</b></div>` +
    beautyRow(world, room)
  );
}

/**
 * What the room is worth to look at.
 *
 * On the building panel rather than only the settler panel because beauty is a
 * property of the room, and the room is what you are clicking when you click the
 * lamp in it. The number rides along with the word for the same reason the
 * temperature row carries both: the word tells you whether to care and the number
 * tells you whether the last thing you built helped.
 */
function beautyRow(world: World, room: Room): string {
  const score = roomBeauty(world, room);
  const n = Math.round(score);
  const alarm = score <= -2 ? ' style="color:var(--bad)"' : score >= BEAUTY_GOOD ? ' style="color:var(--good)"' : '';
  return `<div class="kv"><span>beauty</span><b${alarm}>${n > 0 ? '+' : ''}${n} · ${beautyLabel(score)}</b></div>`;
}

/**
 * The room a settler is standing in, from their side of it.
 *
 * Sits directly under `warmthRow` because they are the same question asked twice
 * — what is it like to be here — and a player reading a miserable colonist should
 * find the cold and the squalor next to each other rather than a screen apart.
 * Outdoors says so and stops: a field is not somewhere you failed to decorate.
 */
/**
 * The animal that follows this settler about, if one does.
 *
 * Prints nothing at all for the settlers who have none, rather than an "animal:
 * none" row — the point of the row is the name, and a colony of six with one dog
 * between them should not be shown five reminders that they are dogless. The
 * mood breakdown below carries the number; this carries who.
 */
function petRow(world: World, p: Pawn): string {
  const pet = petOf(world, p);
  if (!pet) return '';
  const species = pet.animal ? ANIMALS[pet.animal].label.toLowerCase() : 'animal';
  const far = Math.round(Math.hypot(p.x - pet.x, p.y - pet.y));
  return (
    `<div class="kv"><span>their animal</span><b style="color:var(--good)">${petName(pet)}</b></div>` +
    `<div class="kv"><span></span><b>${species} · ${far <= PET_HEEL ? 'at their heel' : `${far} cells away`}</b></div>`
  );
}

function surroundingsRow(world: World, p: Pawn): string {
  const s = surroundings(world, p);
  if (!s) return `<div class="kv"><span>surroundings</span><b>outdoors</b></div>`;
  const n = Math.round(s.score);
  const alarm =
    s.score <= -2 ? ' style="color:var(--bad)"' : s.score >= BEAUTY_GOOD ? ' style="color:var(--good)"' : '';
  return `<div class="kv"><span>surroundings</span><b${alarm}>${n > 0 ? '+' : ''}${n} · ${s.label}</b></div>`;
}

/**
 * What a machine on the grid has to say for itself.
 *
 * Producers report what they are making and how long they can keep making it;
 * consumers report what they take and whether they are getting it. Both matter
 * for the same reason — when the lights go out the player needs to be able to
 * click two things and know whether to fell a tree or build a second generator.
 */
function powerRows(world: World, b: Building): string {
  if (!isElectrical(b.kind) || !b.built) return '';
  const row = (k: string, v: string): string => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  if (b.kind === 'generator') {
    const hours = (b.fuel ?? 0) / (TICKS_PER_DAY / 24);
    return (
      row('output', b.powered === true ? `${GENERATOR_OUTPUT} W` : 'idle') +
      row('firebox', (b.fuel ?? 0) > 0 ? `about ${hours.toFixed(1)} h of wood` : 'cold')
    );
  }
  if (b.kind === 'solar') return row('output', `${solarOutput(world)} W`);
  if (b.kind === 'watermill') {
    // Two rows rather than one, because "0 W" on its own is a fault report. The
    // second line is the difference between a mill that is broken and a mill
    // that is waiting for spring, and only one of those is worth doing anything
    // about.
    return (
      row('output', `${millOutput(world)} W`) +
      row('wheel', b.iced === true ? 'locked in the ice' : 'turning')
    );
  }
  if (b.kind === 'battery') {
    return row('charge', `${Math.round(((b.charge ?? 0) / BATTERY_CAPACITY) * 100)}%`);
  }
  const draw = DRAW[b.kind];
  if (draw === undefined) return '';
  const state = b.powered === true ? 'on' : b.unwired ? 'not wired — run conduit' : 'none';
  return row('draws', `${draw} W`) + row('power', state);
}

/**
 * The recipe book, on the bench it belongs to.
 *
 * A gate the player cannot see is indistinguishable from a bug — a settler walks
 * to the bench, stands there, and wanders off, and nothing anywhere says why. So
 * every recipe is listed whether or not the colony can make it, and the ones it
 * cannot say what is missing in the same words the E-key refusal uses: a project
 * name they can go and research, or a trade they can go and train, hire or buy
 * from a neighbour. The locked rows are the interesting ones; they are the map of
 * what this colony is not yet.
 */
function recipeRows(world: World, b: Building): string {
  if (b.kind !== 'bench' || !b.built) return '';
  // Stacked, not a key/value row. These answers are sentences on purpose and the
  // panel is 214 pixels wide: "nobody here is a herbalist at 5 or a doctor at 4"
  // measures 398 of them, so as a flex row it wraps into four ragged lines
  // crushed against a squashed label. The name reads first and the answer under
  // it, which is the order somebody reads them in anyway.
  //
  // And the ready rows say what they mean. A green name on its own in the value
  // column is a riddle — the row above it says "needs Toolmaking", so what does
  // "Ozias Emberly" want from you? Naming the verb costs a line nobody is short of.
  const rows = RECIPE_ORDER.map((r) => {
    const why = craftBlocker(world, null, r);
    const who = why ? null : bestCrafter(world, r);
    const answer = why ?? (who ? `${who.name} can make this` : 'ready');
    return (
      `<div class="recipe"><span>${escapeHtml(CRAFT_DEFS[r].label)}</span>` +
      `<em class="${why ? 'bad' : 'good'}">${escapeHtml(answer)}</em></div>`
    );
  }).join('');
  return `<div class="sect">recipes</div>${rows}`;
}

/**
 * A span of ticks as a settler would say it. "638 minutes" is technically what
 * the caravan has left and tells the player nothing; "about 10 hours" is the
 * same fact in the unit the decision is actually made in, and it drops to
 * minutes only once minutes are what is left.
 */
/**
 * An age, in days, where `colonyTime` is a countdown in hours.
 *
 * A lifespan given in hours — "about 960 hours" — reads as noise on a card whose
 * whole job is to answer "is this animal old". Only ever used on grown animals,
 * which are three days old at the youngest, so whole days never round to zero.
 */
function colonyAge(ticks: number): string {
  const days = Math.max(1, Math.round(ticks / TICKS_PER_DAY));
  return `${days} day${days === 1 ? '' : 's'}`;
}

function colonyTime(ticks: number): string {
  const minutes = Math.max(1, Math.round((ticks / TICKS_PER_DAY) * 24 * 60));
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hours`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
