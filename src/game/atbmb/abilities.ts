import { magicMissilePathClearToPlayer, lineOfSightClear } from "../../engine/grid";
import { monsterDamageBonus, rollInt } from "../../engine/combat";
import { manhattan } from "../../engine/movement";
import type {
  AtbmbAbilityDef,
  AtbmbAbilityKind,
  AtbmbAction,
  AtbmbAttackRange,
  AtbmbDef,
  AtbmbMoveSeek,
  AtbmbStateDef,
  AtbmbTilePrefs,
  GameState,
  HitVisual,
  MonsterInstance,
  Point,
} from "../types";
import { inAttackRange } from "./conditions";
import { skeletonWeaponCanHit, skeletonWeaponRollDamage } from "./skeletonWeapon";
import { pickPathStep } from "./planPath";
import { resolveTilePrefs } from "./tilePrefs";
import { runEliteSkeletonAttacking } from "./eliteSkeleton";

/** Host adapters supplied by monsterAi so ATBMB stays free of phase/anim coupling. */
export type AtbmbHost = {
  hits: HitVisual[];
  tilePassable: (s: GameState, m: MonsterInstance, p: Point) => boolean;
  occupancy: (s: GameState, excludeMonsterId: string) => Set<string>;
  moveTo: (s: GameState, m: MonsterInstance, dest: Point) => GameState;
  damagePlayer: (
    s: GameState,
    raw: number,
    monName: string,
    from: Point,
  ) => { state: GameState; dead: boolean };
  prepareLeap: (
    s: GameState,
    m: MonsterInstance,
    dir: Point,
    nextState: string,
  ) => GameState;
  executeLeap: (
    s: GameState,
    m: MonsterInstance,
    maxSteps: number,
    minDamage: number,
    maxDamage: number,
    knockback: number,
  ) => { state: GameState; dead: boolean };
  /** Magic missile / queen-ray hit — typically ignores defense. */
  magicMissile: (
    s: GameState,
    m: MonsterInstance,
    minDamage: number,
    maxDamage: number,
  ) => { state: GameState; dead: boolean };
  /** Skeleton archer: load bow (sets bowLoaded + optional state). */
  loadBow: (s: GameState, m: MonsterInstance, nextState: string) => GameState;
  /** Skeleton archer: fire arrow (defense applies), then enter nextState. */
  fireArrow: (
    s: GameState,
    m: MonsterInstance,
    minDamage: number,
    maxDamage: number,
    nextState: string,
  ) => { state: GameState; dead: boolean };
  /** Vineshon: pull player along queen-line to adjacent (anim + enter resolve). */
  vineWhip: (
    s: GameState,
    m: MonsterInstance,
    maxManhattan: number,
  ) => { state: GameState; dead: boolean; used: boolean };
  /** Mimic: appear as a chest again and enter the given state. */
  disguise: (s: GameState, m: MonsterInstance, nextState: string) => GameState;
};

/** Mutable per-turn counters shared across decision phases. */
export type AtbmbTurnCtx = {
  movesSpent: number;
  /** When set, runAtbmbTurn should continue into this state same turn. */
  continueInStateId: string | null;
  /** First successful ability kind this turn (for oneAbilityKindPerTurn). */
  usedAbilityKind: AtbmbAbilityKind | null;
};

export type AtbmbAbilityBudget = Map<string, number>;

export function initAbilityBudget(ai: AtbmbDef): AtbmbAbilityBudget {
  const budget = new Map<string, number>();
  for (const a of ai.abilities) {
    budget.set(a.id, a.uses ?? 1);
  }
  return budget;
}

function abilityById(ai: AtbmbDef, id: string): AtbmbAbilityDef | undefined {
  return ai.abilities.find((a) => a.id === id);
}

function remaining(budget: AtbmbAbilityBudget, id: string): number {
  return budget.get(id) ?? 0;
}

function consume(budget: AtbmbAbilityBudget, id: string): void {
  budget.set(id, Math.max(0, remaining(budget, id) - 1));
}

function noteAbilityUsed(turnCtx: AtbmbTurnCtx, kind: AtbmbAbilityKind): void {
  if (turnCtx.usedAbilityKind == null) turnCtx.usedAbilityKind = kind;
}

function consumeAndNote(
  budget: AtbmbAbilityBudget,
  turnCtx: AtbmbTurnCtx,
  def: AtbmbAbilityDef,
): void {
  consume(budget, def.id);
  noteAbilityUsed(turnCtx, def.kind);
}

/** Orthogonal unit step toward `to` (dominant axis). */
export function cardinalDirToward(from: Point, to: Point): Point | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: Math.sign(dx), y: 0 };
  return { x: 0, y: Math.sign(dy) };
}

function applyAbilityNextState(
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

function pickStepTowardScore(
  s: GameState,
  m: MonsterInstance,
  ai: AtbmbDef,
  prefs: AtbmbTilePrefs | undefined,
  host: AtbmbHost,
  seek: AtbmbMoveSeek,
  moveUsesRemaining: number,
  waterOnly = false,
): Point | null {
  return pickPathStep(
    s,
    m,
    ai,
    prefs,
    seek,
    { tilePassable: host.tilePassable, occupancy: host.occupancy },
    moveUsesRemaining,
    waterOnly,
    Math.random,
  );
}

export function tryExecuteAction(
  s: GameState,
  m: MonsterInstance,
  ai: AtbmbDef,
  stateDef: AtbmbStateDef,
  action: AtbmbAction,
  budget: AtbmbAbilityBudget,
  host: AtbmbHost,
  turnCtx: AtbmbTurnCtx,
): { state: GameState; mon: MonsterInstance; dead: boolean; used: boolean } {
  if (remaining(budget, action.ability) <= 0) {
    return { state: s, mon: m, dead: false, used: false };
  }
  const def = abilityById(ai, action.ability);
  if (!def) return { state: s, mon: m, dead: false, used: false };
  if (
    ai.oneAbilityKindPerTurn &&
    turnCtx.usedAbilityKind != null &&
    turnCtx.usedAbilityKind !== def.kind
  ) {
    return { state: s, mon: m, dead: false, used: false };
  }

  const prefs = resolveTilePrefs(stateDef, m);
  const name = s.monsterDefs.get(m.defId)?.name ?? m.defId;
  const player: Point = { x: s.player.x, y: s.player.y };
  const monPos: Point = { x: m.x, y: m.y };
  const attackRange: AtbmbAttackRange | undefined =
    stateDef.attackRange ??
    (def.kind === "melee"
      ? {
          metric: def.params?.rangeMetric ?? "manhattan",
          min: def.params?.rangeMin ?? 1,
          max: def.params?.rangeMax ?? 1,
        }
      : undefined);

  if (def.kind === "move" || def.kind === "swim") {
    const steps = def.params?.steps ?? (def.kind === "swim" ? 3 : 1);
    const seek = action.seek ?? "favored";
    const waterOnly = def.kind === "swim";
    let next = s;
    let cur = m;
    let moved = false;
    for (let i = 0; i < steps; i++) {
      const live = next.monsters.find((x) => x.id === m.id && x.hp > 0);
      if (!live) break;
      cur = live;
      const step = pickStepTowardScore(
        next,
        cur,
        ai,
        prefs,
        host,
        seek,
        remaining(budget, def.id),
        waterOnly,
      );
      if (!step) break;
      next = host.moveTo(next, cur, step);
      moved = true;
      turnCtx.movesSpent += 1;
      const after = next.monsters.find((x) => x.id === m.id);
      if (!after || after.hp <= 0) {
        consumeAndNote(budget, turnCtx, def);
        return { state: next, mon: after ?? cur, dead: false, used: true };
      }
      cur = after;
    }
    if (!moved) return { state: s, mon: m, dead: false, used: false };
    consumeAndNote(budget, turnCtx, def);
    return { state: next, mon: cur, dead: false, used: true };
  }

  if (def.kind === "melee") {
    const range =
      attackRange ??
      ({
        metric: def.params?.rangeMetric ?? "manhattan",
        min: def.params?.rangeMin ?? 1,
        max: def.params?.rangeMax ?? 1,
      } satisfies AtbmbAttackRange);
    if (!inAttackRange(monPos, player, range)) {
      return { state: s, mon: m, dead: false, used: false };
    }
    const minD = def.params?.minDamage ?? 1;
    const maxD = def.params?.maxDamage ?? minD;
    const raw = rollInt(minD, maxD) + monsterDamageBonus(m.level);
    const hit = host.damagePlayer(s, raw, name, monPos);
    consumeAndNote(budget, turnCtx, def);
    if (hit.dead) {
      const mon = hit.state.monsters.find((x) => x.id === m.id) ?? m;
      return { state: hit.state, mon, dead: true, used: true };
    }
    const applied = applyAbilityNextState(
      hit.state,
      m,
      def.params?.nextState,
      def.params?.continueInNewState,
      turnCtx,
    );
    return { state: applied.state, mon: applied.mon, dead: false, used: true };
  }

  if (def.kind === "weapon_melee") {
    const w = m.skeletonWeapon ?? "sword";
    if (!skeletonWeaponCanHit(w, monPos, player, turnCtx.movesSpent > 0)) {
      return { state: s, mon: m, dead: false, used: false };
    }
    const raw = skeletonWeaponRollDamage(w, monsterDamageBonus(m.level));
    const hit = host.damagePlayer(s, raw, name, monPos);
    consumeAndNote(budget, turnCtx, def);
    if (hit.dead) {
      const mon = hit.state.monsters.find((x) => x.id === m.id) ?? m;
      return { state: hit.state, mon, dead: true, used: true };
    }
    const applied = applyAbilityNextState(
      hit.state,
      m,
      def.params?.nextState,
      def.params?.continueInNewState,
      turnCtx,
    );
    return { state: applied.state, mon: applied.mon, dead: false, used: true };
  }

  if (def.kind === "prepare_leap") {
    const dir = cardinalDirToward(monPos, player);
    if (!dir) return { state: s, mon: m, dead: false, used: false };
    const nextState = def.params?.nextState ?? "leap";
    const next = host.prepareLeap(s, m, dir, nextState);
    consumeAndNote(budget, turnCtx, def);
    // Default: enter leap next turn (do not continue this turn).
    if (def.params?.continueInNewState) {
      turnCtx.continueInStateId = nextState;
    }
    const mon = next.monsters.find((x) => x.id === m.id) ?? m;
    return { state: next, mon, dead: false, used: true };
  }

  if (def.kind === "leap") {
    const steps = def.params?.steps ?? 2;
    const minD = def.params?.minDamage ?? 2;
    const maxD = def.params?.maxDamage ?? 4;
    const knock = def.params?.knockback ?? 1;
    const result = host.executeLeap(s, m, steps, minD, maxD, knock);
    consumeAndNote(budget, turnCtx, def);
    const mon = result.state.monsters.find((x) => x.id === m.id) ?? m;
    return { state: result.state, mon, dead: result.dead, used: true };
  }

  if (def.kind === "ranged_queen") {
    if (!magicMissilePathClearToPlayer(s.tiles, s.monsters, monPos, player, m.id)) {
      return { state: s, mon: m, dead: false, used: false };
    }
    const minD = def.params?.minDamage ?? 1;
    const maxD = def.params?.maxDamage ?? minD;
    const result = host.magicMissile(s, m, minD, maxD);
    consumeAndNote(budget, turnCtx, def);
    const mon = result.state.monsters.find((x) => x.id === m.id) ?? m;
    return { state: result.state, mon, dead: result.dead, used: true };
  }

  if (def.kind === "load_bow") {
    const nextState = def.params?.nextState ?? "aiming";
    const next = host.loadBow(s, m, nextState);
    consumeAndNote(budget, turnCtx, def);
    if (def.params?.continueInNewState) {
      turnCtx.continueInStateId = nextState;
    }
    const mon = next.monsters.find((x) => x.id === m.id) ?? m;
    return { state: next, mon, dead: false, used: true };
  }

  if (def.kind === "fire_arrow") {
    const range =
      attackRange ??
      ({
        metric: def.params?.rangeMetric ?? "chebyshev",
        min: def.params?.rangeMin ?? 1,
        max: def.params?.rangeMax ?? 8,
      } satisfies AtbmbAttackRange);
    // Match Bow card: Chebyshev range, not ortho-adjacent, any-angle LOS.
    if (manhattan(monPos, player) <= 1) {
      return { state: s, mon: m, dead: false, used: false };
    }
    if (!inAttackRange(monPos, player, range)) {
      return { state: s, mon: m, dead: false, used: false };
    }
    if (!lineOfSightClear(s.tiles, monPos, player)) {
      return { state: s, mon: m, dead: false, used: false };
    }
    const minD = def.params?.minDamage ?? 2;
    const maxD = def.params?.maxDamage ?? 4;
    const nextState = def.params?.nextState ?? "basic";
    const result = host.fireArrow(s, m, minD, maxD, nextState);
    consumeAndNote(budget, turnCtx, def);
    if (def.params?.continueInNewState) {
      turnCtx.continueInStateId = nextState;
    }
    const mon = result.state.monsters.find((x) => x.id === m.id) ?? m;
    return { state: result.state, mon, dead: result.dead, used: true };
  }

  if (def.kind === "vine_whip") {
    const maxM = def.params?.rangeMax ?? 4;
    const result = host.vineWhip(s, m, maxM);
    if (!result.used) {
      return { state: s, mon: m, dead: false, used: false };
    }
    consumeAndNote(budget, turnCtx, def);
    const applied = applyAbilityNextState(
      result.state,
      m,
      def.params?.nextState,
      def.params?.continueInNewState,
      turnCtx,
    );
    return { state: applied.state, mon: applied.mon, dead: result.dead, used: true };
  }

  if (def.kind === "disguise") {
    const nextState = def.params?.nextState ?? "asleep";
    const next = host.disguise(s, m, nextState);
    consumeAndNote(budget, turnCtx, def);
    if (def.params?.continueInNewState) {
      turnCtx.continueInStateId = nextState;
    }
    const mon = next.monsters.find((x) => x.id === m.id) ?? m;
    return { state: next, mon, dead: false, used: true };
  }

  if (def.kind === "custom") {
    if (def.params?.customId === "elite_skeleton_attack") {
      return runEliteSkeletonAttacking(s, m, ai, def, host, budget, turnCtx);
    }
    return { state: s, mon: m, dead: false, used: false };
  }

  return { state: s, mon: m, dead: false, used: false };
}
