import { keyOf } from "../../engine/grid";
import { manhattan } from "../../engine/movement";
import { monsterDamageBonus } from "../../engine/combat";
import type {
  AtbmbAbilityDef,
  AtbmbDef,
  AtbmbTilePref,
  AtbmbTilePrefs,
  GameState,
  MonsterInstance,
  Point,
  SkeletonWeapon,
} from "../types";
import type { AtbmbAbilityBudget, AtbmbHost, AtbmbTurnCtx } from "./abilities";
import { dirsForMoveStyle } from "./dirs";
import { findShortestPath, stablePathRng, type ShortestPathResult } from "./pathfind";
import {
  collectPrefTiles,
  isDislikedTile,
  tileMatchesAnyPref,
} from "./tilePrefs";
import { skeletonWeaponCanHit, skeletonWeaponRollDamage } from "./skeletonWeapon";

const ATTACK_BAD: AtbmbTilePref[] = [
  { kind: "slime_leap_path" },
  { kind: "pending_collapse" },
  { kind: "pending_targeted_collapse" },
  { kind: "flooding_room" },
];

export function eliteSkeletonAttackPrefs(): AtbmbTilePrefs {
  return { bad: ATTACK_BAD };
}

type EliteOptionId = "scimitar" | "spear" | "sword";

type EliteOptionDef = {
  id: EliteOptionId;
  weapon: SkeletonWeapon;
  favored: AtbmbTilePref[];
  basePenalty: number;
  tieRank: number;
};

const ELITE_OPTIONS: EliteOptionDef[] = [
  {
    id: "scimitar",
    weapon: "scimitar",
    favored: [{ kind: "diagonal_adjacent_to_player" }],
    basePenalty: 0,
    tieRank: 0,
  },
  {
    id: "spear",
    weapon: "spear",
    favored: [{ kind: "plus_from_player", min: 2, max: 2 }],
    basePenalty: 2,
    tieRank: 2,
  },
  {
    id: "sword",
    weapon: "sword",
    favored: [{ kind: "adjacent_to_player", metric: "manhattan" }],
    basePenalty: 1,
    tieRank: 1,
  },
];

export type EliteSkeletonOptionEval = {
  id: EliteOptionId;
  weapon: SkeletonWeapon;
  penalty: number;
  pathSteps: number;
  weighted: number;
  goals: Point[];
  chosen: boolean;
  plan: ShortestPathResult | null;
};

function spearPenalty(m: MonsterInstance): number {
  return m.eliteTeleported ? 0 : 2;
}

function makeCanEnter(
  s: GameState,
  m: MonsterInstance,
  prefs: AtbmbTilePrefs,
  occ: Set<string>,
  tileOk: (p: Point) => boolean,
): (p: Point) => boolean {
  const startKey = keyOf(m);
  const onDisliked = isDislikedTile(s, m, { x: m.x, y: m.y }, prefs);
  return (p: Point) => {
    if (keyOf(p) === startKey) return true;
    if (occ.has(keyOf(p))) return false;
    if (!tileOk(p)) return false;
    const destDisliked = isDislikedTile(s, m, p, prefs);
    if (destDisliked && !onDisliked) return false;
    return true;
  };
}

function planToOptionGoals(
  s: GameState,
  m: MonsterInstance,
  prefs: AtbmbTilePrefs,
  option: EliteOptionDef,
  host: AtbmbHost,
  rng: () => number,
): { steps: number; goals: Point[]; plan: ShortestPathResult | null } {
  const occ = host.occupancy(s, m.id);
  const from: Point = { x: m.x, y: m.y };
  const tileOk = (p: Point) => host.tilePassable(s, m, p);
  const passableGoal = (p: Point) => tileOk(p) && !isDislikedTile(s, m, p, prefs);
  const goals = collectPrefTiles(s, m, option.favored, prefs, passableGoal, occ);
  if (!goals.length) {
    return { steps: Infinity, goals: [], plan: null };
  }
  const canEnter = makeCanEnter(s, m, prefs, occ, tileOk);
  const dirs = dirsForMoveStyle("ortho");
  const plan = findShortestPath(from, goals, dirs, canEnter, rng);
  const steps = plan ? plan.path.length - 1 : Infinity;
  return { steps, goals, plan };
}

export function evaluateEliteSkeletonOptions(
  s: GameState,
  m: MonsterInstance,
  host: Pick<AtbmbHost, "tilePassable" | "occupancy">,
  rng: () => number = stablePathRng,
): EliteSkeletonOptionEval[] {
  const prefs = eliteSkeletonAttackPrefs();
  const evals: EliteSkeletonOptionEval[] = ELITE_OPTIONS.map((opt) => {
    const penalty = opt.id === "spear" ? spearPenalty(m) : opt.basePenalty;
    const { steps, goals, plan } = planToOptionGoals(s, m, prefs, opt, host as AtbmbHost, rng);
    return {
      id: opt.id,
      weapon: opt.weapon,
      penalty,
      pathSteps: steps,
      weighted: steps === Infinity ? Infinity : steps + penalty,
      goals,
      chosen: false,
      plan,
    };
  });

  let bestWeighted = Infinity;
  let bestTie = Infinity;
  for (const ev of evals) {
    if (ev.weighted < bestWeighted || (ev.weighted === bestWeighted && ELITE_OPTIONS.find((o) => o.id === ev.id)!.tieRank < bestTie)) {
      bestWeighted = ev.weighted;
      bestTie = ELITE_OPTIONS.find((o) => o.id === ev.id)!.tieRank;
    }
  }
  for (const ev of evals) {
    const tieRank = ELITE_OPTIONS.find((o) => o.id === ev.id)!.tieRank;
    ev.chosen = ev.weighted === bestWeighted && tieRank === bestTie;
  }
  return evals;
}

function pickChosenOption(evals: EliteSkeletonOptionEval[]): EliteSkeletonOptionEval | null {
  const chosen = evals.filter((e) => e.chosen);
  if (!chosen.length) return null;
  return chosen[0] ?? null;
}

function isOnOptionGoal(
  s: GameState,
  m: MonsterInstance,
  option: EliteOptionDef,
): boolean {
  const pos = { x: m.x, y: m.y };
  return tileMatchesAnyPref(s, m, pos, option.favored);
}

function applyNextState(
  state: GameState,
  m: MonsterInstance,
  nextState: string | undefined,
  continueInNewState: boolean | undefined,
  turnCtx: AtbmbTurnCtx,
): { state: GameState; mon: MonsterInstance } {
  if (!nextState) {
    return { state, mon: state.monsters.find((x) => x.id === m.id) ?? m };
  }
  const next = {
    ...state,
    monsters: state.monsters.map((x) =>
      x.id === m.id ? { ...x, aiStateId: nextState } : x,
    ),
  };
  if (continueInNewState) {
    turnCtx.continueInStateId = nextState;
  }
  return { state: next, mon: next.monsters.find((x) => x.id === m.id) ?? m };
}

function tryWeaponAttack(
  s: GameState,
  m: MonsterInstance,
  weapon: SkeletonWeapon,
  movedThisTurn: boolean,
  host: AtbmbHost,
  name: string,
): { state: GameState; mon: MonsterInstance; dead: boolean; hit: boolean } {
  const player: Point = { x: s.player.x, y: s.player.y };
  const monPos: Point = { x: m.x, y: m.y };
  if (!skeletonWeaponCanHit(weapon, monPos, player, movedThisTurn)) {
    return { state: s, mon: m, dead: false, hit: false };
  }
  const raw = skeletonWeaponRollDamage(weapon, monsterDamageBonus(m.level));
  const result = host.damagePlayer(s, raw, name, monPos);
  const mon = result.state.monsters.find((x) => x.id === m.id) ?? m;
  return { state: result.state, mon, dead: result.dead, hit: true };
}

function pickStepTowardGoals(
  s: GameState,
  m: MonsterInstance,
  prefs: AtbmbTilePrefs,
  goals: Point[],
  host: AtbmbHost,
  rng: () => number,
): Point | null {
  if (!goals.length) return null;
  const occ = host.occupancy(s, m.id);
  const from: Point = { x: m.x, y: m.y };
  const tileOk = (p: Point) => host.tilePassable(s, m, p);
  const canEnter = makeCanEnter(s, m, prefs, occ, tileOk);
  const dirs = dirsForMoveStyle("ortho");
  const plan = findShortestPath(from, goals, dirs, canEnter, rng);
  return plan?.nextStep ?? null;
}

export function runEliteSkeletonAttacking(
  s: GameState,
  m: MonsterInstance,
  _ai: AtbmbDef,
  def: AtbmbAbilityDef,
  host: AtbmbHost,
  budget: AtbmbAbilityBudget,
  turnCtx: AtbmbTurnCtx,
): { state: GameState; mon: MonsterInstance; dead: boolean; used: boolean } {
  const name = s.monsterDefs.get(m.defId)?.name ?? "Elite Skeleton";
  const player: Point = { x: s.player.x, y: s.player.y };
  const prefs = eliteSkeletonAttackPrefs();
  let state = s;
  let mon = m;
  let movedThisTurn = false;

  const consume = () => {
    budget.set(def.id, Math.max(0, (budget.get(def.id) ?? 0) - 1));
    if (turnCtx.usedAbilityKind == null) turnCtx.usedAbilityKind = def.kind;
  };

  // Ortho-adjacent: axe first, no simulation.
  if (manhattan({ x: mon.x, y: mon.y }, player) === 1) {
    const axe = tryWeaponAttack(state, mon, "axe", false, host, name);
    if (!axe.hit) {
      consume();
      return { state, mon, dead: false, used: true };
    }
    if (axe.dead) {
      consume();
      return { state: axe.state, mon: axe.mon, dead: true, used: true };
    }
    const applied = applyNextState(
      axe.state,
      mon,
      def.params?.nextState,
      def.params?.continueInNewState,
      turnCtx,
    );
    consume();
    return { state: applied.state, mon: applied.mon, dead: false, used: true };
  }

  const evals = evaluateEliteSkeletonOptions(state, mon, host, Math.random);
  const chosen = pickChosenOption(evals);
  if (!chosen || chosen.weighted === Infinity) {
    consume();
    return { state, mon, dead: false, used: true };
  }

  const optionDef = ELITE_OPTIONS.find((o) => o.id === chosen.id)!;

  // Already on goal tile — strike without moving.
  if (isOnOptionGoal(state, mon, optionDef)) {
    const strike = tryWeaponAttack(state, mon, chosen.weapon, false, host, name);
    if (strike.hit) {
      if (strike.dead) {
        consume();
        return { state: strike.state, mon: strike.mon, dead: true, used: true };
      }
      const applied = applyNextState(
        strike.state,
        mon,
        def.params?.nextState,
        def.params?.continueInNewState,
        turnCtx,
      );
      consume();
      return { state: applied.state, mon: applied.mon, dead: false, used: true };
    }
  }

  let moveBudget = 3;
  while (moveBudget > 0) {
    mon = state.monsters.find((x) => x.id === m.id && x.hp > 0) ?? mon;
    if (!mon || mon.hp <= 0) break;

    const step = pickStepTowardGoals(state, mon, prefs, chosen.goals, host, Math.random);
    if (!step) break;

    state = host.moveTo(state, mon, step);
    mon = state.monsters.find((x) => x.id === m.id)!;
    movedThisTurn = true;
    turnCtx.movesSpent += 1;
    moveBudget -= 1;

    if (!isOnOptionGoal(state, mon, optionDef)) continue;

    const strike = tryWeaponAttack(state, mon, chosen.weapon, movedThisTurn, host, name);
    if (!strike.hit) break;
    if (strike.dead) {
      consume();
      return { state: strike.state, mon: strike.mon, dead: true, used: true };
    }
    const applied = applyNextState(
      strike.state,
      mon,
      def.params?.nextState,
      def.params?.continueInNewState,
      turnCtx,
    );
    consume();
    return { state: applied.state, mon: applied.mon, dead: false, used: true };
  }

  consume();
  return { state, mon, dead: false, used: true };
}
