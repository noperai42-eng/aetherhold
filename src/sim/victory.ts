/**
 * How a run *ends well*.
 *
 * Until now Aetherhold had exactly one ending: everybody dies. That is a real
 * ending, and it is the wrong only one — a colony sim where the best available
 * outcome is "still going" turns into a screensaver somewhere around day fifteen,
 * because there is nothing left to be playing *toward*. `objectives.ts` is the
 * curriculum (here is what a colony needs, roughly in the order it needs it);
 * this is the exam.
 *
 * The shape is five charters and a founding week.
 *
 * **Five charters, each on a different axis.** People, food, guns, knowledge, and
 * a friend over the ridge. They are deliberately not five flavours of the same
 * thing: a colony can brute-force any one of them and will still be short of the
 * others, so the win asks the player to run a colony rather than to farm one
 * number. Every measure reads state the world already keeps, so there is no
 * second set of books to drift.
 *
 * **They must hold at once, and then keep holding.** The last charter is the
 * clock: once all five are true the colony has three days to stay that way. This
 * is the whole design. Without it, victory lands on the tick a wanderer walks in,
 * and the most dramatic moment in the run is a number quietly ticking over. With
 * it, the last three days are the tensest in the game — a raid that drops one
 * settler, a fire in the pantry or a turret lost puts the founding back to zero,
 * and the player knows it is happening because the log says so.
 *
 * Deliberately *not* here: any new building, any new resource, any new job. A
 * capstone the colony has to construct would be a fourth thing to balance and a
 * fifth thing to render; the interesting decisions are already on the map, and
 * this asks the player to get all of them right at the same time.
 */

import { foodDays } from './alerts';
import { caravansOf, settlementsOf } from './settlements';
import { TICKS_PER_DAY, type World } from './types';
import { livingColonists, msg } from './world';

/** Settlers alive and on the books. Prisoners do not count until they join up. */
export const NEED_PEOPLE = 8;

/**
 * Days of food the pantry must cover *at that head count* — so the bar rises as
 * the colony grows, and a bigger colony is a harder colony rather than a free
 * charter. Twelve is two full raid cycles plus the week it takes to re-sow.
 */
export const NEED_FOOD_DAYS = 12;

/**
 * Turrets, built. The Steward never places one (`steward.ts` stops at sandbags),
 * so this is the one charter that is always the player's own decision, and it is
 * priced in the steel every other charter is also competing for.
 */
export const NEED_TURRETS = 2;

/** Research projects finished — over half the tree, so it cannot be stumbled into. */
export const NEED_RESEARCH = 6;

/**
 * Standing with any one neighbour. A near-ring visit is worth 6, so this is five
 * round trips over the ridge to the same place: about twenty days of a colony
 * that can spare a settler for four days at a stretch, which is what makes the
 * road the thing that paces the whole win. It is three trips to a middle-ring
 * place and three to a far one, and both of those roads are longer by more than
 * they pay — twenty days near against thirty-odd and fifty-odd — so the near ring
 * stays the cheapest way to a charter. Standing scaling with distance buys the
 * far country, not the win.
 */
export const NEED_RELATIONS = 30;

/** How long every charter has to hold together before the colony is founded. */
export const HOLD_DAYS = 3;
export const HOLD_TICKS = TICKS_PER_DAY * HOLD_DAYS;

/*
 * Where these five numbers came from, so the next person to "balance" them has
 * the same evidence. Seed 20260729 was run headless with both the in-game
 * foreman and the eval steward driving — an optimistic colony, deliberately, so
 * that anything hard *here* is harder in a real game:
 *
 *   day  5   people 4/8   food 15.6d   turrets 1/2   research 0/6   standing 0
 *   day 10   people 5/8   food 33.9d   turrets 3/2   research 2/6   standing 0
 *   day 15   people 6/8   food 32.6d   turrets 1/2   research 4/6   standing 6
 *
 * Read across: head count and research climb steadily and land somewhere in the
 * twenties, food is never the binding charter, and the turret count *falls* —
 * raiders took two between day 10 and day 15, which is exactly the charter the
 * hold is built to break. The one that paces the run is the road: one round trip
 * to the far settlement cost about eight days, so five of them is most of a
 * season unless the player picks a near neighbour on purpose. That choice is the
 * charter, and it is why the number stayed at thirty.
 */

export interface Charter {
  /** Stable id — saved colonies do not store these, but the HUD keys rows on it. */
  id: string;
  title: string;
  /** Where the work is. A condition with no answer is a scoreboard. */
  hint: string;
  at: number;
  of: number;
  met: boolean;
  /** The numbers behind the bar, already rounded for display. */
  count: string;
}

function builtCount(world: World, kind: string): number {
  let n = 0;
  for (const b of world.buildings) if (b.built && b.kind === kind) n++;
  return n;
}

/** The best standing the colony has with anybody out there. */
export function bestStanding(world: World): number {
  let best = 0;
  for (const s of settlementsOf(world)) best = Math.max(best, s.relations);
  return best;
}

/**
 * Where the colony stands against every charter. Pure — safe to call from the
 * HUD every frame.
 *
 * Settlers on the road count toward the head count: they are alive and they are
 * yours, and a founding that fell over because somebody was four days out buying
 * medicine would read as a bug rather than a rule. Plural since the colony can
 * field two — a charter that came apart because the *second* party was out would
 * be the same bug, found later and by a player.
 */
export function charters(world: World): Charter[] {
  const away = caravansOf(world).filter((c) => !c.pawn.dead).length;
  const people = livingColonists(world).length + away;
  const days = foodDays(world);
  const turrets = builtCount(world, 'turret');
  const done = world.research.done.length;
  const standing = bestStanding(world);
  return [
    {
      id: 'hearth',
      title: 'Eight settlers under the roof',
      hint: 'Wanderers, prisoners talked round, and whoever the road brings home.',
      at: people,
      of: NEED_PEOPLE,
      met: people >= NEED_PEOPLE,
      count: `${people}/${NEED_PEOPLE}`,
    },
    {
      id: 'larder',
      title: 'Twelve days of food in the store',
      hint: 'A wider field and a stove — and a cooler, or half of it rots first.',
      at: days,
      of: NEED_FOOD_DAYS,
      met: days >= NEED_FOOD_DAYS,
      count: `${days.toFixed(1)}/${NEED_FOOD_DAYS} days`,
    },
    {
      id: 'guns',
      title: 'Two turrets on the approach',
      hint: 'Defence tab → Turret, wired to a generator. Nobody builds these for you.',
      at: turrets,
      of: NEED_TURRETS,
      met: turrets >= NEED_TURRETS,
      count: `${turrets}/${NEED_TURRETS}`,
    },
    {
      id: 'knowledge',
      title: 'Six projects finished',
      hint: 'A research bench, somebody on it, and L to choose the work.',
      at: done,
      of: NEED_RESEARCH,
      met: done >= NEED_RESEARCH,
      count: `${done}/${NEED_RESEARCH}`,
    },
    {
      id: 'ally',
      title: 'An ally over the ridge',
      hint: 'J to send a caravan. Five visits to the same neighbour makes a friend.',
      at: standing,
      of: NEED_RELATIONS,
      met: standing >= NEED_RELATIONS,
      count: `${Math.floor(standing)}/${NEED_RELATIONS}`,
    },
  ];
}

/**
 * The founding clock, created on first use.
 *
 * Optional on the world for the usual reason — a colony saved before there was a
 * way to win has to load, and it loads with the clock stopped, which is honest:
 * it will start it again on the first tick if it already qualifies.
 */
export function charterState(world: World): { since: number | null; won: boolean } {
  if (!world.charter) world.charter = { since: null, won: false };
  return world.charter;
}

/** Ticks left on the founding, or null when the clock is not running. */
export function foundingLeft(world: World): number | null {
  const st = world.charter;
  if (!st || st.since === null) return null;
  return Math.max(0, HOLD_TICKS - (world.tick - st.since));
}

/**
 * One check of the exam. Cheap, but not free — it walks the building list and the
 * item list — so it runs on the same once-a-second cadence as the milestones.
 *
 * Winning sets `st.won` and nothing else. It used to set `world.gameOver` too,
 * on the reading that a founding is an ending — and `gameOver` is read by nine
 * other passes, every one of which takes it to mean *the colony is gone*. So the
 * prize for winning was that the Steward stopped planning, the events stopped
 * firing, the caravans stopped coming, nobody scouted, nobody wandered in, and
 * the colony stood there burning its woodpile in the generator until it hit zero.
 * Measured on seed 20260729: founded around day thirty, four hundred and forty
 * five steel and three hundred and twenty wood in the yard, and by day sixty the
 * wood was gone with thirty-two reachable trees still standing inside the
 * harvest radius. Nothing was broken. The foreman had simply been switched off
 * as a reward.
 *
 * `gameOver` now means only what `checkGameOver` means by it: nobody is left.
 * The founding is a headline, a card and a tally, and then the colony carries on
 * being a colony — which is the thing the player spent forty days building.
 */
export function tickVictory(world: World): void {
  if (world.gameOver) return;
  if (world.tick % 20 !== 0) return;
  const st = charterState(world);
  if (st.won) return;

  const list = charters(world);
  const short = list.filter((c) => !c.met);

  if (short.length > 0) {
    // Fell out of the running. Say which one went, because "the founding
    // falters" with no cause is the same as no message at all.
    if (st.since !== null) {
      st.since = null;
      msg(world, `The founding falters — ${short[0].title.toLowerCase()}.`, 'bad', {
        headline: true,
      });
    }
    return;
  }

  if (st.since === null) {
    st.since = world.tick;
    msg(
      world,
      `Every charter is met. Hold the colony together ${HOLD_DAYS} days and Aetherhold stands for good.`,
      'good',
      { headline: true },
    );
    return;
  }

  if (world.tick - st.since >= HOLD_TICKS) {
    st.won = true;
    msg(world, 'Aetherhold is founded. The colony stands — and goes on standing.', 'good', {
      headline: true,
    });
  }
}

/** True when the run ended in a win rather than a wipe. */
export function hasWon(world: World): boolean {
  return world.charter?.won === true;
}
