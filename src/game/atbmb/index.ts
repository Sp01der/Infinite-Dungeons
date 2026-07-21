import type { AtbmbDef, GameState, MonsterInstance } from "../types";
import { tileAt } from "../../engine/grid";
import { monsterMaxHp } from "../../engine/combat";
import { manhattan } from "../../engine/movement";
import { initAbilityBudget, type AtbmbHost, type AtbmbTurnCtx } from "./abilities";
import { runDecisionTree } from "./decide";

export type { AtbmbHost, AtbmbTurnCtx } from "./abilities";
export {
  scoreTile,
  isOnFavoredTile,
  isOnBadTile,
  isDislikedTile,
  dislikedBlocksEntry,
  collectFavoredTiles,
  tileMatchesPref,
  tileMatchesAnyPref,
  resolveTilePrefs,
} from "./tilePrefs";
export { cardinalDirToward } from "./abilities";
export { inAttackRange, whenMatches } from "./conditions";
export {
  planAtbmbPath,
  pickPathStep,
  stablePathRng,
  type AtbmbPathContext,
} from "./planPath";
export type { ShortestPathResult } from "./pathfind";
export {
  evaluateEliteSkeletonOptions,
  eliteSkeletonAttackPrefs,
  type EliteSkeletonOptionEval,
} from "./eliteSkeleton";

function applyStateId(
  s: GameState,
  m: MonsterInstance,
  stateId: string,
): { state: GameState; mon: MonsterInstance; stateId: string } {
  if (m.aiStateId === stateId) {
    return { state: s, mon: m, stateId };
  }
  const state = {
    ...s,
    monsters: s.monsters.map((x) =>
      x.id === m.id ? { ...x, aiStateId: stateId } : x,
    ),
  };
  return {
    state,
    mon: state.monsters.find((x) => x.id === m.id) ?? m,
    stateId,
  };
}

function syncStateByPlayerDistance(
  s: GameState,
  m: MonsterInstance,
  ai: AtbmbDef,
): { state: GameState; mon: MonsterInstance; stateId: string } {
  const rule = ai.stateByPlayerDistance!;
  const d = manhattan({ x: m.x, y: m.y }, { x: s.player.x, y: s.player.y });
  const closeMax = rule.closeMax ?? 2;
  const stateId = d <= closeMax ? rule.closeState : rule.distantState;
  return applyStateId(s, m, stateId);
}

function syncStateByTerrain(
  s: GameState,
  m: MonsterInstance,
  ai: AtbmbDef,
): { state: GameState; mon: MonsterInstance; stateId: string } {
  const rule = ai.stateByTerrain!;
  const onWater = tileAt(s.tiles, { x: m.x, y: m.y }) === "water";
  const stateId = onWater ? rule.waterState : rule.dryState;
  return applyStateId(s, m, stateId);
}

function syncStateByHpFraction(
  s: GameState,
  m: MonsterInstance,
  ai: AtbmbDef,
): { state: GameState; mon: MonsterInstance; stateId: string } {
  const rule = ai.stateByHpFraction!;
  const base = s.monsterDefs.get(m.defId)?.hp ?? m.hp;
  const max = monsterMaxHp(base, m.level);
  const frac = max > 0 ? m.hp / max : 0;
  const threshold = rule.fleeingAtOrBelow ?? 0.5;
  const stateId = frac <= threshold ? rule.fleeingState : rule.attackingState;
  return applyStateId(s, m, stateId);
}

function syncDynamicState(
  s: GameState,
  m: MonsterInstance,
  ai: AtbmbDef,
): { state: GameState; mon: MonsterInstance; stateId: string } | null {
  if (ai.stateByPlayerDistance) return syncStateByPlayerDistance(s, m, ai);
  if (ai.stateByTerrain) return syncStateByTerrain(s, m, ai);
  if (ai.stateByHpFraction) return syncStateByHpFraction(s, m, ai);
  return null;
}

/**
 * Run one monster's turn via ATBMB (abilities + state decision tree + tile prefs).
 * Returns null if the monster has no usable AI profile.
 *
 * State flow:
 * - Optional `turnStartState` forces a state at the start of the turn only when set.
 * - Optional `stateByPlayerDistance` / `stateByTerrain` / `stateByHpFraction` sync each phase.
 * - Otherwise the monster keeps its current `aiStateId` across turns (e.g. slime Leap).
 * - Mid-turn: if an ability sets `nextState` with `continueInNewState`, keep resolving
 *   that new state's tree with the same ability budget.
 * - `stateDef.nextState` applies after that state's tree finishes and does not run the
 *   new state's tree this turn (deferred to the next turn / display).
 */
export function runAtbmbTurn(
  s: GameState,
  m: MonsterInstance,
  host: AtbmbHost,
): { state: GameState; dead: boolean } | null {
  const def = s.monsterDefs.get(m.defId);
  const ai = def?.ai;
  if (!ai) return null;

  let state = s;
  let mon: MonsterInstance = m;

  const dynamic = syncDynamicState(state, mon, ai);
  if (dynamic) {
    state = dynamic.state;
    mon = dynamic.mon;
  } else if (ai.turnStartState !== undefined) {
    // Only force a turn-start state when explicitly configured (e.g. skeleton Attack).
    // Do NOT fall back to initialState — that wiped deferred states like slime Leap.
    if (mon.aiStateId !== ai.turnStartState) {
      state = {
        ...state,
        monsters: state.monsters.map((x) =>
          x.id === m.id ? { ...x, aiStateId: ai.turnStartState } : x,
        ),
      };
      mon = state.monsters.find((x) => x.id === m.id)!;
    }
  } else if (mon.aiStateId === undefined) {
    state = {
      ...state,
      monsters: state.monsters.map((x) =>
        x.id === m.id ? { ...x, aiStateId: ai.initialState } : x,
      ),
    };
    mon = state.monsters.find((x) => x.id === m.id)!;
  }

  const budget = initAbilityBudget(ai);
  const turnCtx: AtbmbTurnCtx = {
    movesSpent: 0,
    continueInStateId: null,
    usedAbilityKind: null,
  };
  const ranStates = new Set<string>();

  while (true) {
    turnCtx.continueInStateId = null;

    const synced = syncDynamicState(state, mon, ai);
    if (synced) {
      state = synced.state;
      mon = synced.mon;
    }

    const stateId = mon.aiStateId ?? ai.initialState;
    const stateDef = ai.states.find((st) => st.id === stateId) ?? ai.states[0];
    if (!stateDef) return { state, dead: false };
    if (ranStates.has(stateId)) break;
    ranStates.add(stateId);

    const result = runDecisionTree(state, mon, ai, stateDef, budget, host, turnCtx);
    state = result.state;
    if (result.dead) return { state, dead: true };

    const after = state.monsters.find((x) => x.id === m.id && x.hp > 0);
    if (!after) return { state, dead: false };
    mon = after;

    // Mid-turn continue only when an ability explicitly requested it.
    const continueId = turnCtx.continueInStateId;
    if (
      continueId &&
      mon.aiStateId === continueId &&
      !ranStates.has(continueId)
    ) {
      continue;
    }

    // Dynamic state: whip pull → Close, swim onto water, HP threshold, etc.
    const afterDyn = syncDynamicState(state, mon, ai);
    if (afterDyn) {
      if (afterDyn.stateId !== stateId && !ranStates.has(afterDyn.stateId)) {
        state = afterDyn.state;
        mon = afterDyn.mon;
        continue;
      }
      state = afterDyn.state;
      mon = afterDyn.mon;
    }

    // End-of-phase deferred transition — do not run the new state's tree this turn.
    if (stateDef.nextState && mon.aiStateId === stateId) {
      state = {
        ...state,
        monsters: state.monsters.map((x) =>
          x.id === m.id ? { ...x, aiStateId: stateDef.nextState } : x,
        ),
      };
      mon = state.monsters.find((x) => x.id === m.id)!;
    }
    break;
  }

  return { state, dead: false };
}

export function hasAtbmb(ai: AtbmbDef | undefined): ai is AtbmbDef {
  return !!ai?.states?.length && !!ai.abilities?.length;
}
