/**
 * The one and only simulation step.
 *
 * `stepWorld` is a pure-ish function of (world, rng streams) → mutated world.
 * It never touches three.js, the DOM or rAF, which is what lets the headless
 * tests in tests/ drive thousands of ticks in milliseconds.
 */

import { checkGameOver, igniteFire, tickFires, tickStoryteller } from './events';
import { tickCombat, tickMaulings } from './combat';
import { tickBushes } from './berries';
import { tickCrops } from './farming';
import { tickExplore } from './explore';
import { tickFireSafety } from './firesafety';
import { tickHealth } from './health';
import {
  assignJob,
  assignNeedsOnly,
  sendSomebodyToFeed,
  planAhead,
  startQueued,
  tickGroundSleep,
  tickJob,
  tickMoraleBreak,
} from './jobs';
import { tickDoors } from './movement';
import { isBreaking, tickNeeds } from './needs';
import { tickPower } from './power';
import { tickPrisoners } from './prison';
import { tickObjectives } from './objectives';
import { tickPartners } from './partners';
import { tickPets } from './pets';
import { tickAlarm, tickPackLeaving } from './predators';
import { tickPickies } from './pickies';
import { tickConnectivity } from './connectivity';
import { tickRebuild } from './rebuild';
import { tickStranded } from './stranded';
import { tickSteward } from './steward';
import { tickFumes } from './fumes';
import { Rng } from './rng';
import { tickSnowpack } from './snowpack';
import { tickIce } from './ice';
import { tickFishing } from './fishing';
import { tickForest } from './forest';
import { tickSocial } from './social';
import { tickGraves } from './graves';
import { tickKnowhow } from './knowhow';
import { tickBeauty } from './beauty';
import { tickSpoilage } from './spoilage';
import { tickHusbandry } from './husbandry';
import { SEASON_NEWS, seasonOf, seasonTurned } from './seasons';
import { tickTemperature } from './temperature';
import { tickTrade } from './trade';
import { tickVictory } from './victory';
import { tickEndings } from './endings';
import { tickCaravan } from './settlements';
import { tickWar } from './holdings';
import { tickCommissions } from './commissions';
import { tickTraps } from './traps';
import { tickWeather } from './weather';
import { msg } from './world';
import { tickBreeding, tickHerdHint, tickWildlife } from './wildlife';
import type { World } from './types';

export interface Streams {
  main: Rng;
  combat: Rng;
  story: Rng;
  health: Rng;
  social: Rng;
  forest: Rng;
}

export function makeStreams(world: World): Streams {
  return {
    main: new Rng(world.rng.main),
    combat: new Rng(world.rng.combat),
    story: new Rng(world.rng.story),
    // Illness gets its own stream for the same reason everything else does: a
    // wound that festers must not shift the tick a raid arrives on.
    health: new Rng(world.rng.health ?? (world.rng.main ^ 0x27d4eb2f) >>> 0),
    // Same argument again: who gets on with whom must not shift the tick a raid
    // arrives on, and a settler stopping for a word must not move the weather.
    social: new Rng(world.rng.social ?? (world.rng.main ^ 0x165667b1) >>> 0),
    // And once more for the trees. This one matters most of the five: the forest
    // pass draws a die eighty times a day for the whole life of a colony, so
    // taking it from `main` would put every wildlife decision in the game on a
    // different footing depending on how much of the valley had been logged.
    forest: new Rng(world.rng.forest ?? (world.rng.main ^ 0x6d2b79f5) >>> 0),
  };
}

export function storeStreams(world: World, s: Streams): void {
  world.rng.main = s.main.state;
  world.rng.combat = s.combat.state;
  world.rng.story = s.story.state;
  world.rng.health = s.health.state;
  world.rng.social = s.social.state;
  world.rng.forest = s.forest.state;
}

/** How often an idle settler re-evaluates what to do (ticks). Staggered by id. */
const ASSIGN_INTERVAL = 12;
/**
 * How often a settler who is already working looks for what to do next.
 *
 * Four times slower than the assignment cadence on purpose. This scan costs the
 * same as an assignment but nothing is waiting on the answer — the settler is
 * busy — and it would otherwise double the work-board traffic of a full colony.
 */
const PLAN_INTERVAL = ASSIGN_INTERVAL * 4;

export function stepWorld(world: World, streams: Streams): void {
  world.tick++;

  // Before the weather, because a season turning is the largest thing that can
  // happen to the sky and the player should read it in that order. It draws no
  // dice of its own — the calendar is `world.tick` and nothing else — so its
  // place in this sequence cannot move any other system's rolls.
  if (seasonTurned(world)) msg(world, SEASON_NEWS[seasonOf(world)]);

  // Weather first: the fire pass and the crop pass both read the sky this tick,
  // and a front that arrived half a tick ago should already be raining on them.
  tickWeather(world, streams.story, (x, y) => igniteFire(world, x, y));
  // And straight after it, because the pack is the sky's leavings: everybody who
  // walks this tick should be wading through what fell last tick, not what is
  // falling now. Draws no dice, so its place in the sequence is free.
  tickSnowpack(world);
  // And the lake with it, ahead of everything that plans a route: the tick the
  // ice goes is the tick the pathfinder should stop offering the crossing, not
  // the tick after, or somebody sets off across a lake that is already open.
  tickIce(world);
  // The fish grow back beside the ice because they are the same lake, and because
  // this has to run before the work pass decides whether the shore is worth
  // walking to. Draws no dice either.
  tickFishing(world);
  tickStoryteller(world, streams.story);
  tickFires(world, streams.story);
  // Immediately after the burn pass, so a settler the fire has just reached is
  // running on the same tick it first touched them rather than the next one. It
  // reads flames and writes jobs, so it has to sit ahead of the per-pawn loop
  // below — the flee job it forms is executed further down this same tick.
  tickFireSafety(world);
  // The other emergency that pulls a settler off whatever they were doing, and
  // it sits here for the same reason: it reads the colony and writes a job, and
  // the job it writes is executed further down this same tick. After the fire
  // pass rather than before, because a settler running out of the flames is not
  // the one to send for a meal — `sendSomebodyToFeed` skips a live `flee`, and
  // it can only skip one that has already been formed.
  sendSomebodyToFeed(world);
  // Straight after the fires, so a cell that stopped burning this tick is already
  // clear to build on, and before the combat pass, so a wall the colony means to
  // put back is not laid down under a raider who has not moved yet.
  tickRebuild(world);
  // Then throw out whatever nobody can get to, before the Steward looks at the
  // board: a plan on the far side of a lake is not work, it is a colony with its
  // foreman permanently silenced, waiting on two fence posts in a rock pocket.
  tickStranded(world);
  // The colony's own plans, immediately after the ones it is putting back. Order
  // matters both ways: rebuild first so a wall the colony lost is re-marked before
  // the Steward looks at the board and sees it clear, and the Steward before the
  // per-pawn loop so a blueprint marked this tick is available to the assignment
  // pass on this tick rather than the next.
  tickSteward(world);
  // Right behind the two passes that put walls on the map, and ahead of the
  // per-pawn loop that has to live with them: if the colony has just cut itself
  // in half, the order to open it up again is on the board before anybody looks
  // for work this tick.
  tickConnectivity(world);
  // The grid, after the fires that can burn a generator down and before the two
  // systems that ask it questions: spoilage wants to know whether the cooler is
  // cold, and the combat pass wants to know whether the turrets are live.
  tickPower(world);
  // Warmth after the watts and before anything that reads a thermometer: a heater
  // that lost its network this tick is already going cold, and the rooms are
  // stepped once so spoilage, illness and the HUD all read the same air.
  tickTemperature(world);
  // Straight after the thermometer and off the same room index: both passes ask
  // "what is shut in this room with you", and the fumes pass needs the power one
  // to have already decided which generators are actually burning this tick.
  tickFumes(world);
  tickCrops(world);
  // The wild plants next to the sown ones, because they answer to the same three
  // terms — daylight, weather, season — and reading them off the same tick keeps
  // a bramble and a furrow in the same field from disagreeing about what day it
  // is. Before `tickWildlife`, so a brambletail that walks up to a bush this tick
  // finds the ripeness the renderer is about to draw.
  tickBushes(world);
  // And the trees beside the brambles, for the same reason they sit beside the
  // crops: all three answer to the season, and reading them off one tick keeps a
  // sapling and a furrow in the same field from disagreeing about what month it
  // is. It puts solid things on the map, so it has to be ahead of the per-pawn
  // loop — a settler must never plan a route through a cell that grew a tree
  // half a tick ago.
  tickForest(world, streams.forest);
  // After the crops, before anybody eats: a harvest pulled this tick is fresh for
  // the whole of this tick, and a stack that has just gone off is gone before a
  // settler can walk to it.
  tickSpoilage(world);

  const player = world.pawns.find((p) => p.playerControlled && !p.dead) ?? null;
  tickCombat(world, streams.combat, player ? player.id : null);
  // Directly on the heels of the combat pass, because that is where raiders take
  // their step: a hostile who moved onto a deadfall this tick springs it now and
  // not after a free tick of shooting from on top of it.
  tickTraps(world, streams.combat);
  // The caravan, after the bullets: a trader who arrived into a raid that ended
  // this tick is standing in a colony that is no longer at arms.
  tickTrade(world, player ? player.id : null);
  // And the party on the road, beside the trader who walks in — same business,
  // opposite direction. It has to run before the settler loop below, because a
  // traveller who gets home this tick should be looking for work this tick and
  // not standing at the map edge for one.
  tickCaravan(world);
  // The other party off the map, on the same beat and for the same reason: a war
  // party that walks in this tick should be looking for work this tick. It is
  // behind the caravan rather than in front of it because a homecoming drops
  // goods on the ground and the tribute pass does too — one order, so two carts
  // arriving on the same tick always land in the same order.
  tickWar(world);
  // Immediately behind it, and that adjacency is a contract rather than a
  // preference: a deal struck on the road stamps the caravan with this tick, and
  // this is the pass that reads the stamp and settles the request it answered.
  // Anything between the two that could clear the caravan would silently lose a
  // commission the colony had walked three days to fill.
  tickCommissions(world);
  // Herds move after the bullets, so an animal that was shot this tick is already
  // running on the next one. `main` is the only stream nothing else in the loop
  // touches, which is why wildlife cannot perturb a raid or a storm.
  tickWildlife(world, streams.main);
  // And the teeth immediately behind the paws. A bite is resolved once every
  // animal on the map has finished this tick's step, so it is never decided from
  // a cell the prey has already left — see the note on `tickMaulings`.
  tickMaulings(world);
  // Then the two passes that make a pack a beat rather than a permanent tax: one
  // that puts a wolf on the hunters' list the moment it is somewhere a colony
  // would have noticed it, and one that sends the survivors off the map when
  // their stay is up. Both after the kill, so a wolf that ate this tick is
  // already fed when it is marked, and a pack whose clock ran out this tick
  // leaves with the meal it just took rather than one tick's worth later.
  tickAlarm(world);
  tickPackLeaving(world);
  // Births after the herd has moved, so a calf is placed beside where its dam
  // actually ended up standing rather than where it started the tick.
  tickBreeding(world, streams.main);
  // And immediately after, the reason there was no birth. A pen of two males is a
  // colony waiting on something that will never happen, so the check runs right
  // where the birth would have been, on the same herd that was just passed over.
  tickHerdHint(world);
  // And the newborn gets its yield clock on the same tick it is placed, so it is
  // never a head of livestock the pen sweep has not seen.
  tickHusbandry(world);
  // Prisoners before the settler loop, so a bunk that emptied this tick — either
  // because somebody joined up or because somebody starved — is already free
  // when a warden goes looking for work below.
  tickPrisoners(world);
  // Illness after the bullets, so a wound taken this tick can already start to
  // fester, and before the settler loop, so somebody whose fever broke through
  // this tick goes to bed on this tick rather than the next one.
  tickHealth(world, streams.health);
  // The dead before opinions, because how the colony feels about the bodies in
  // the yard is part of what `tickSocial` prices below — and a body that rots
  // away on this tick must be gone before anybody is charged for it again.
  tickGraves(world);
  // Opinions before the settler loop, so the mood the needs pass computes this
  // tick already knows who is standing next to whom. It reads positions from the
  // end of the last tick, which is where everybody is right now.
  tickSocial(world, streams.social);
  // And where they are standing, which is the same kind of term and wants the
  // same timing: after the dead are counted, because a body on the bunkhouse
  // floor is part of what the bunkhouse is worth.
  tickBeauty(world);
  // And who has an animal of their own. Third term of the same shape as the two
  // above, and it wants to be after `tickWildlife` as well as before the settler
  // loop: a pet that died this tick has already been mourned and taken off the
  // map by then, so this pass finds a bond with nobody on the end of it and
  // charges the mood accordingly on the very tick the player reads the message.
  tickPets(world);
  // And who has a person of their own. Deliberately *after* `tickSocial`, which
  // is the pass that moves the bonds this one reads: a pairing should be the
  // consequence of the day the colony just had, not of the day before it. Takes
  // no stream — nothing in here rolls, on purpose. See `partners.ts`.
  tickPartners(world);
  tickDoors(world);

  for (const pawn of world.pawns) {
    if (pawn.dead) continue;
    if (pawn.faction === 'colony') tickNeeds(world, pawn);
    if (pawn.dead || pawn.downed) continue;
    if (pawn.faction !== 'colony') continue;

    // The player's body. Needs and combat apply as normal. It executes jobs the
    // player created with E (that is the spec's "auto-follow job target"), but the
    // AI never *picks* work for it — moving cancels the job, which is the override.
    if (pawn.playerControlled) {
      if (pawn.jobId !== null) tickJob(world, pawn, streams.combat);
      else if (pawn.activity === 'sleeping') tickGroundSleep(pawn);
      continue;
    }
    // Drafted settlers are driven by the combat pass.
    if (pawn.drafted) continue;

    if (pawn.jobId !== null) {
      tickJob(world, pawn, streams.combat);
      // Line the next one up while this one runs, so a settler steps straight
      // from a felled tree to the next task instead of standing in the yard
      // waiting for an assignment tick. Slower than the assignment cadence
      // because it costs a full work-board scan and nothing is waiting on it.
      if ((world.tick + pawn.id) % PLAN_INTERVAL === 0) planAhead(world, pawn);
      continue;
    }
    if (pawn.activity === 'sleeping') {
      tickGroundSleep(pawn);
      continue;
    }
    // Looking after themselves outranks the stack, and is checked here rather
    // than on the assignment cadence below because the stack is checked here.
    // Otherwise a settler with work lined up steps straight from one job to the
    // next for ever and never eats: the need check only ever ran on an *idle*
    // settler, and a primed stack means they are never idle. That is not a
    // hypothetical — it starved seed 20260729 flat to zero.
    if (pawn.queue && pawn.queue.length > 0 && assignNeedsOnly(world, pawn)) continue;
    // Then the stack, every tick rather than on the assignment cadence: the next
    // job is already chosen and already claimed, so making the settler wait for
    // it would be waiting on nothing.
    if (startQueued(world, pawn)) continue;
    // Hand-driven settlers still look after themselves — taking somebody off the
    // work board is not a licence to starve them — but the colony never picks
    // work for them again. An empty stack means they stand there, which is the
    // whole point of the switch.
    if (pawn.manual) {
      if ((world.tick + pawn.id) % ASSIGN_INTERVAL === 0) assignNeedsOnly(world, pawn);
    } else if ((world.tick + pawn.id) % ASSIGN_INTERVAL === 0) {
      assignJob(world, pawn);
    }
    // Still nothing to do and refusing work: they are on a break, so give them
    // somewhere to put their feet. Checked after the assignment because eating
    // and sleeping outrank sulking.
    if (pawn.jobId === null && isBreaking(pawn)) {
      tickMoraleBreak(world, pawn, streams.main);
      continue;
    }
    if (pawn.jobId === null && pawn.activity === 'walking') pawn.activity = 'idle';
  }

  // After the settlers, so a Picky reads the map as this tick left it — a wall
  // raised on this tick is a wall it cannot walk through. Before `tickExplore`,
  // so it can never reveal ground: a Picky is a spectator, and what it walks past
  // does not become somewhere the colony has been.
  tickPickies(world);
  // Immediately after the settler loop, because that is where everybody took
  // their step: the map is drawn from where the colony is standing at the end of
  // this tick, not from where it stood at the start of it. A settler who walked
  // into new ground has already seen it by the time the frame is rendered.
  tickExplore(world);
  // After the deaths and the level-ups of this tick, so "nobody here can brew
  // balm any more" lands in the same breath as the raid that caused it.
  tickKnowhow(world);
  // Last, so a milestone is measured against the world as the tick leaves it —
  // the meal cooked on this tick counts on this tick. Before the wipe check only
  // because a colony that just lost its last settler should not be congratulated
  // on its research in the same breath.
  tickObjectives(world);
  // The exam after the curriculum, and before the wipe check for the same reason
  // the milestones are: a colony that just lost its last settler is not founded.
  tickVictory(world);
  // And the terminal after the exam, because the exam is half of what keeps a
  // terminal running — an ending stalls the moment the colony stops being a
  // colony, and it should read the charters as this tick left them rather than
  // as they stood a tick ago.
  tickEndings(world);
  checkGameOver(world);
  storeStreams(world, streams);
}

/** Run N ticks. Used by tests and by the fixed-timestep loop's catch-up path. */
export function stepWorldN(world: World, streams: Streams, n: number): void {
  for (let i = 0; i < n; i++) stepWorld(world, streams);
}
