/**
 * What to do next, for someone who has never played one of these.
 *
 * `alerts.ts` says what is *wrong*. That is the right thing to show a player who
 * already knows what a colony is supposed to look like, and the wrong thing to
 * show one who does not: "2 settlers unarmed" only helps if you already know a
 * workbench turns steel into rifles. This is the other half — an ordered list of
 * the things a colony needs, in roughly the order it needs them, each with the
 * one sentence that says where the button is.
 *
 * Two deliberate differences from an alert:
 *
 * - **A milestone is sticky.** Alerts are derived fresh and vanish with the state
 *   that caused them, which is exactly right for a nag and exactly wrong for a
 *   curriculum: a fire that takes the beds should put "beds" back in the *alert*
 *   panel, not un-teach the player what a bed is. The earned ids are the only
 *   thing stored, and once an id is in that list it stays.
 * - **Only the next few show.** Fourteen goals at once is a wall, and a wall is
 *   the same as nothing. The panel asks for three.
 *
 * Everything else is derived on the spot from the same counters the HUD already
 * reads, so there is no second bookkeeping to drift out of step with the world.
 */

import { startHerdMigration } from './encounters';
import { hastenArrival } from './events';
import { livestock } from './livestock';
import { RESEARCH_ORDER } from './research';
import { Rng } from './rng';
import { summonCaravan } from './trade';
import { TERRAIN_LIST, TICKS_PER_DAY, type Terrain, type World } from './types';
import { hasWon } from './victory';
import { countResource, livingColonists, msg } from './world';

export interface Objective {
  /** Stable across ticks and across saves — this is what gets stored when earned. */
  id: string;
  /** Imperative and short: the thing to go and do. */
  title: string;
  /** Where the button is. A goal with no answer is just a scoreboard. */
  hint: string;
  /** 0..1 right now. An earned goal always reads 1, whatever the world says. */
  progress: number;
  /** The numbers behind the bar, e.g. "2/3". */
  count: string;
  done: boolean;
}

interface Goal {
  id: string;
  title: string;
  hint: string;
  /** Past tense, for the line in the log the moment it lands. */
  earned: string;
  /**
   * Where the colony stands against the goal. `of` is the target; `at` is
   * whatever counts toward it. Both are shown, so a goal must be countable —
   * "build a stove" is not a goal here, "cook ten meals" is, because the second
   * one can draw a bar and the first one can only be on or off.
   */
  measure(world: World): { at: number; of: number; label?: string };
  /**
   * What the world sends back, for the few goals that answer.
   *
   * Returns false when the map cannot stage it — no room at the edge, a trader
   * already in the yard — and the milestone is simply earned quietly, exactly as
   * every milestone was before this existed. A grant is a bonus on top of the
   * tick, never the point of it.
   */
  grant?(world: World, rng: Rng): boolean;
}

function builtCount(world: World, kind: string): number {
  let n = 0;
  for (const b of world.buildings) if (b.built && b.kind === kind) n++;
  return n;
}

/** Cells inside zones of one kind. Grow zones are what a field *is* — see below. */
function zoneCells(world: World, kind: 'growing' | 'stockpile' | 'pen'): number {
  let n = 0;
  for (const z of world.zones) if (z.kind === kind) n += z.cells.length;
  return n;
}

/**
 * Paved cells. Not plank, and not "any laid floor".
 *
 * The Steward boards the cabin out of the colony's own wood without being asked
 * (`steward.ts`, the `floors` ambition), so a goal counting both floors is a goal
 * that ticks itself off while the player watches. Paving is the half of the
 * lesson that stays a decision: it is priced in steel, which is the resource
 * everything else on this list is also competing for.
 */
const PAVED = TERRAIN_LIST.indexOf('paved' as Terrain);

function pavedCells(world: World): number {
  let n = 0;
  for (const t of world.terrain) if (t === PAVED) n++;
  return n;
}

/**
 * The curriculum, in order.
 *
 * Two rules decided this list, and both came out of measuring rather than taste.
 *
 * **Every goal measures a decision the player made.** The first draft asked for
 * beds, four days of food, a sown field, ten meals and a weapon in every hand —
 * and a colony left completely alone ticked seven of those off inside the first
 * game day, because the settler AI does all of them unprompted. A panel that
 * congratulates you for what happened while you watched is worse than no panel:
 * it teaches the player that the game plays itself. So what is left is what the
 * AI provably never does on its own — blueprints, zones, designations, research
 * — measured against the values a fresh colony actually starts with (a twelve
 * cell field, ninety steel, no floors, no batteries, no sandbags, no bench).
 *
 * **The order is "what kills a colony next".** Food and steel before the first
 * raid lands around day three, a wall of sandbags before a turret because
 * sandbags are cheap and a turret is thirty steel, comfort after survival, the
 * long tail after that. Twenty days at the end is the capstone: by the time a
 * colony has done everything above it, twenty days is a formality, and that is
 * exactly the point of putting it last.
 *
 * Ids are permanent. A saved colony stores the ones it has earned by id, so a
 * goal may be reworded or retargeted but never renamed.
 *
 * ## Three of them send something back
 *
 * A checklist that only ever ticks itself off is homework. Three goals answer:
 * bank two hundred steel and the next pedlar is already on the road, search a
 * ruin and word comes back with somebody walking behind it, put up a pen and a
 * herd crosses the valley a few hours later. Each is the thing the hint already
 * promised — "there is steel out there, and sometimes a survivor" — arriving
 * because the player did the work, which is the difference between a tutorial
 * and a world that noticed.
 *
 * Three rules kept the list at three, and they are the whole design:
 *
 * **A grant is never a punishment.** The obvious fourth is a raid the moment the
 * sandbags go down, or a flare the morning the solar panel is wired, and both
 * read as the game slapping the player for following its own instructions. The
 * storyteller already sends those on its own clock; it does not need the
 * curriculum to aim them.
 *
 * **A grant never escalates.** `threatsFired` is untouched, so a player who
 * works quickly does not meet bigger raids for it, and the scheduled beat is
 * pushed out rather than allowed to land on top of the granted one.
 *
 * **A grant moves a clock, it does not conjure.** Two of the three bring
 * forward something that was already coming, so nothing here can be farmed and
 * the colony's growth still runs on the storyteller's own rules — including its
 * crowding cap. The herd is the exception because a herd is scenery that walks
 * away again.
 */
const GOALS: Goal[] = [
  {
    id: 'field',
    // Grow-zone *cells*, not sown crops. The sown count swings between two and
    // twelve as the field is harvested and re-sown, so a goal measured on it
    // ticks off on whichever second you happened to look. The zone is the
    // decision; the crops in it are the weather.
    title: 'Widen the field to thirty squares',
    hint: 'Zones tab → Grow zone, dragged over soil. The starting patch feeds three settlers, not six.',
    earned: 'the field is thirty squares',
    measure: (w) => ({ at: zoneCells(w, 'growing'), of: 30 }),
  },
  {
    id: 'steel',
    title: 'Bank two hundred steel',
    hint: 'Orders tab → Mine, then drag over a rock face. Steel is what everything after this costs.',
    earned: 'two hundred steel in the stockpile',
    measure: (w) => ({ at: countResource(w, 'steel'), of: 200 }),
    // A colony with a stockpile is a colony worth walking to. It also lands the
    // trade lesson at the one moment the player can afford to take it — the
    // `trade` milestone further down is otherwise the goal most colonies stare
    // at for a week waiting for the five-day caravan clock to come round.
    grant: (w) => summonCaravan(w),
  },
  {
    id: 'sandbags',
    title: 'Lay ten sandbags across the approach',
    hint: 'Defence tab → Sandbag. Half the bullets aimed at somebody behind one stop at it.',
    earned: 'there is a sandbag line to fight from',
    measure: (w) => ({ at: builtCount(w, 'sandbag'), of: 10 }),
  },
  {
    id: 'raider',
    title: 'Drop your first raider',
    hint: 'Draft with T, put settlers behind the sandbags, and let them come to you.',
    earned: 'the first raider is down for good',
    measure: (w) => ({ at: w.stats.raidersKilled, of: 1 }),
  },
  {
    id: 'battery',
    // A generator is not the goal — the colony is handed one at the start, and a
    // milestone that is already ticked the first time you look at the panel
    // teaches nothing. A battery is the lesson: the wood runs out, and what keeps
    // the cooler cold through that hour is the charge you banked.
    title: 'Bank some charge in a battery',
    hint: 'Power tab → Battery, on the same conduit as the generator. It carries the grid when the wood runs out.',
    earned: 'the grid has a battery behind it',
    measure: (w) => ({ at: builtCount(w, 'battery'), of: 1 }),
  },
  {
    id: 'coldstore',
    title: 'Build a cold store for the food',
    hint: 'Power tab → Cooler, in a walled room with the stockpile. Meals keep for days in the cold and hours in the sun.',
    earned: 'the food is in the cold',
    measure: (w) => ({ at: builtCount(w, 'cooler'), of: 1 }),
  },
  {
    id: 'turret',
    // This counted one gun until the Steward learnt to set them itself, and then
    // it was narrating the AI instead of the player — the same thing that happened
    // to `floor` when the Steward learnt to board the cabin. The Steward's ladder
    // stops hard at four (`sim/steward.ts`, the `defence` ambition), so five is the
    // first gun the colony will never buy for you, and the goal is a decision again.
    title: 'Stand five turrets over the approach',
    hint: 'Defence tab → Turret, wired to a generator. The colony sets the first few itself; the line that holds a real raid is yours.',
    earned: 'five turrets are watching the approach',
    measure: (w) => ({ at: builtCount(w, 'turret'), of: 5 }),
  },
  {
    id: 'research',
    title: 'Finish two research projects',
    hint: 'Build a research bench, then press L to choose what the colony works on.',
    earned: 'the colony has finished two projects',
    measure: (w) => ({ at: w.research.done.length, of: 2 }),
  },
  {
    id: 'floor',
    // Id kept from when this counted boards too — see the note on ids above.
    title: 'Pave twenty squares',
    hint: 'Build tab → Paved floor. Twice the walking speed of grass, it does not burn, and it costs steel.',
    earned: 'the colony walks on stone',
    measure: (w) => ({ at: pavedCells(w), of: 20 }),
  },
  {
    id: 'scout',
    title: 'Search a ruin out on the map',
    hint: 'Orders tab → Scout, then click a site. There is steel out there, and sometimes a survivor.',
    earned: 'a site out on the map has been searched',
    measure: (w) => ({ at: w.stats.sitesScouted, of: 1 }),
    // The hint says "and sometimes a survivor", so sometimes there is one: the
    // scouts carry word of the colony back down the road and whoever was already
    // walking this way walks a little faster.
    //
    // The first draft sent the slaver flight — a refugee sprinting in with two
    // armed men behind them — and it was the wrong answer twice over. It is a
    // fight handed to a player for exploring, which breaks the rule above it;
    // and on seed 23 the colony scouted a ruin inside its first day, so the
    // reward for curiosity was two corpses in the yard before anybody had built
    // a grave. An arrival that walks in on its own is the same promise kept
    // without the ambush.
    grant: (w) => hastenArrival(w),
  },
  {
    id: 'pen',
    title: 'Tame an animal into a pen',
    hint: 'Zones tab → Pen, then Orders tab → Tame on a grazing animal. Penned animals breed.',
    earned: 'there is livestock in the pen',
    measure: (w) => ({ at: livestock(w).length, of: 1 }),
    // An empty pen with one hare in it is the least convincing thing on the map.
    // A herd crossing the valley the same afternoon is the answer to "what is
    // this fence for" — and it is a gift with a decision in it, because the
    // hunters want the same animals the handlers do.
    grant: (w, rng) => startHerdMigration(w, rng),
  },
  {
    id: 'trade',
    title: 'Strike a deal with a caravan',
    hint: 'A pedlar walks in every few days and stands half a day. Click them to open the stall.',
    earned: 'the colony has traded',
    measure: (w) => ({ at: w.stats.trades ?? 0, of: 1 }),
  },
  {
    id: 'solar',
    title: 'Put up a solar panel',
    hint: 'Research solar cells first, then Power tab → Solar. It burns no wood and it stops at dusk.',
    earned: 'the grid runs on sunlight',
    measure: (w) => ({ at: builtCount(w, 'solar'), of: 1 }),
  },
  {
    id: 'tenDays',
    // Id kept from when this was ten days: renaming an id would hand every saved
    // colony its capstone back to earn again.
    title: 'Keep the colony twenty days',
    hint: 'Everything above, held together. Day counter is top left.',
    earned: 'the colony is twenty days old',
    measure: (w) => {
      const day = Math.floor(w.tick / TICKS_PER_DAY);
      return { at: day, of: 20, label: `day ${day}/20` };
    },
  },
];

/**
 * What a founded colony does with the rest of its life.
 *
 * The curriculum above ends at twenty days, and research runs dry around day
 * fifty-five — measured, on seed 20260729: `res 15` from day forty-five straight
 * through to day one hundred and twenty, every project in the tree finished and
 * seventy-five days still to run. A colony that has won is a colony with nothing
 * left on its list, and the panel that had been telling the player what to do
 * next goes blank at exactly the moment they finally have the settlers and the
 * steel to do something ambitious.
 *
 * So the list gets a second half, and it appears only once the charter is
 * founded. Two reasons for gating it rather than simply appending it:
 *
 * - **A wall is the same as nothing.** The early list is already fourteen long
 *   and the panel shows three. Twenty goals on day one would push "pave twenty
 *   squares" in behind "pave a hundred", which is a curriculum that teaches the
 *   wrong lesson first.
 * - **These are not survival, they are ambition.** Every goal above is something
 *   a colony that skips it might die of. Nothing down here will kill anybody.
 *   Showing the two as one list would say they were the same kind of thing.
 *
 * None of them grant. The three grants above fire inside a colony's first
 * fortnight, where a beat a week is a rhythm; these are measured in weeks each,
 * and an encounter that arrives once a fortnight because of a checklist is not a
 * rhythm, it is a coincidence. The storyteller is still running its own clock,
 * and by now it has raids worth watching.
 */
const LATE: Goal[] = [
  {
    id: 'lateStone',
    title: 'Rebuild in stone — forty stone walls',
    hint: 'Research stonecutting, then Build tab → Stone wall. Stone does not burn.',
    earned: 'the colony is walled in stone',
    measure: (w) => ({ at: builtCount(w, 'stonewall'), of: 40 }),
  },
  {
    id: 'lateArmoury',
    // Measured against the headcount rather than a fixed number: a colony of six
    // that arms everybody has done the thing, and so has a colony of eighteen.
    // The target moving as the colony grows is the goal, not a flaw in it.
    title: 'Put a rifle in every hand',
    hint: 'Workbench → Rifle. An unarmed settler is a casualty waiting for a raid.',
    earned: 'every settler is armed',
    measure: (w) => {
      const all = livingColonists(w);
      return { at: all.filter((p) => p.weapon === 'rifle').length, of: Math.max(1, all.length) };
    },
  },
  {
    id: 'lateLarder',
    title: 'Lay in a hundred meals',
    hint: 'A cold store and a cook who never stops. Winter is five days and it does not negotiate.',
    earned: 'the larder is a hundred meals deep',
    measure: (w) => ({ at: countResource(w, 'meal'), of: 100 }),
  },
  {
    id: 'lateRoads',
    title: 'Pave a hundred squares',
    hint: 'Build tab → Paved floor, out along the ways people already walk.',
    earned: 'the colony has roads',
    measure: (w) => ({ at: pavedCells(w), of: 100 }),
  },
  {
    id: 'lateScholars',
    title: 'Finish every research project',
    hint: 'Press L. There are fifteen, and the last of them are not cheap.',
    earned: 'there is nothing left to learn',
    measure: (w) => ({ at: w.research.done.length, of: RESEARCH_ORDER.length }),
  },
  {
    id: 'lateNeighbours',
    // Visits, not trades. A settlement the colony has walked to is one it has a
    // relationship with, and a caravan that came home empty still went.
    title: 'Call on every settlement in the valley',
    hint: 'Click a settlement out on the map and send a caravan. Distant neighbours pay better.',
    earned: 'the colony has called on every neighbour',
    measure: (w) => {
      const all = w.settlements ?? [];
      return { at: all.filter((s) => (s.visits ?? 0) > 0).length, of: Math.max(1, all.length) };
    },
  },
  {
    id: 'lateCentury',
    title: 'Keep the colony a hundred days',
    hint: 'Everything above, held together, five times over.',
    earned: 'the colony is a hundred days old',
    measure: (w) => {
      const day = Math.floor(w.tick / TICKS_PER_DAY);
      return { at: day, of: 100, label: `day ${day}/100` };
    },
  },
];

/**
 * The list this colony is actually working from.
 *
 * One function, and every reader goes through it — the panel, the score, and the
 * pass that banks them. The alternative was three call sites that each remembered
 * to append `LATE`, which is three places to forget in the same way: a score out
 * of fourteen printed next to a panel showing a fifteenth goal.
 */
function activeGoals(world: World): Goal[] {
  return hasWon(world) ? [...GOALS, ...LATE] : GOALS;
}

/**
 * The earned list, created on first use.
 *
 * Optional on the world for the usual reason: a colony saved before milestones
 * existed has to load, and it loads with nothing earned — which is honest. It
 * will re-earn whatever it has already done within a second of being unpaused,
 * because every measure reads state that colony still has.
 */
export function earnedObjectives(world: World): string[] {
  if (!world.objectives) world.objectives = [];
  return world.objectives;
}

/** Every goal, with where the colony stands against each. Pure. */
export function objectives(world: World): Objective[] {
  const earned = world.objectives ?? [];
  return activeGoals(world).map((g) => {
    const done = earned.includes(g.id);
    const m = g.measure(world);
    const at = Math.min(m.at, m.of);
    return {
      id: g.id,
      title: g.title,
      hint: g.hint,
      progress: done ? 1 : m.of <= 0 ? 1 : Math.max(0, Math.min(1, m.at / m.of)),
      count: m.label ?? `${Math.floor(at)}/${m.of}`,
      done,
    };
  });
}

/** The next few things to go and do, nearest first. */
export function nextObjectives(world: World, n = 3): Objective[] {
  return objectives(world)
    .filter((o) => !o.done)
    .slice(0, n);
}

/** How many are behind them, and how many there are in total. */
export function objectiveScore(world: World): { done: number; total: number } {
  return { done: (world.objectives ?? []).length, total: activeGoals(world).length };
}

/**
 * Quiet bought by a granted beat, before the storyteller's own clock may fire.
 *
 * A little under half a day. The point is only that a herd and a raid do not
 * walk in together — long enough that the two are separate events, short enough
 * that a colony cannot stall the storyteller by earning milestones on purpose.
 */
const GRANT_QUIET = Math.round(TICKS_PER_DAY * 0.4);

/**
 * A milestone's own dice, seeded off the map and the goal it belongs to.
 *
 * Deliberately not one of the three shared streams, and this cost a suite to
 * learn: the first version drew the herd out of `streams.story`, which shifts
 * every storyteller roll after it, and three seed-tuned tests that had nothing
 * to do with milestones started failing — a colony's raids moved because it
 * built a pen. Seeded off the map and the goal id instead, so the same colony
 * always meets the same herd and nothing else in the sim moves.
 */
function grantRng(world: World, id: string): Rng {
  let h = (0x811c9dc5 ^ world.seed) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return new Rng(h >>> 0);
}

/**
 * Bank anything the colony has just managed.
 *
 * Called from the tick, cheaply and not every tick — the measures walk the
 * building list and the crop grid, and nothing here changes fast enough to be
 * worth twenty checks a second. A goal earned mid-second is announced a fraction
 * of a second late and nobody has ever noticed.
 */
export function tickObjectives(world: World): void {
  if (world.gameOver) return;
  if (world.tick % 20 !== 0) return;
  // Has this colony ever banked a milestone? Read *before* the list is created,
  // because the answer stops being available a line later.
  //
  // A colony saved before milestones existed loads with nothing earned and
  // re-earns everything it has already done on its first pass — nine of them in
  // one tick — and if that pass could grant, opening an old save would drop a
  // herd, a refugee and a caravan on the yard at once for work done a week ago.
  // The first pass of a genuinely new colony banks nothing, because day zero
  // cannot meet any of these, so the guard costs one silent pass and nothing
  // else.
  const knew = world.objectives !== undefined;
  const earned = earnedObjectives(world);
  // One beat per pass, however many milestones land together. Two goals earned
  // inside the same second is already unusual; two encounters arriving on the
  // same tick because of it would read as the map malfunctioning. The others are
  // still earned — they just come without the parade.
  let sent = false;
  for (const g of activeGoals(world)) {
    if (earned.includes(g.id)) continue;
    const m = g.measure(world);
    if (m.of <= 0 || m.at < m.of) continue;
    earned.push(g.id);
    msg(world, `Milestone — ${g.earned}.`, 'good');
    if (!knew || sent || !g.grant) continue;
    if (!g.grant(world, grantRng(world, g.id))) continue;
    sent = true;
    // Whatever the storyteller had queued gets out of the way. Not
    // `threatsFired` — that is the escalation ladder, and earning milestones
    // quickly must not buy the colony bigger raids.
    world.storyteller.nextThreat = Math.max(world.storyteller.nextThreat, GRANT_QUIET);
  }
}
