import type {
  AtbmbAction,
  AtbmbDef,
  AtbmbStateDef,
  GameState,
  MonsterInstance,
} from "../types";
import {
  tryExecuteAction,
  type AtbmbAbilityBudget,
  type AtbmbHost,
  type AtbmbTurnCtx,
} from "./abilities";
import { whenMatches } from "./conditions";
import { resolveTilePrefs } from "./tilePrefs";

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/**
 * Walk the state's decision tree: each matching rule tries its actions in order
 * (or shuffled). Abilities that are blocked or out of uses are skipped.
 * Stops after `ai.maxActionsPerTurn` successful ability uses when set.
 * After a successful action, re-checks `when` so approach stops once on favored.
 * Stops early if the monster's aiStateId changes (state switch).
 */
export function runDecisionTree(
  s: GameState,
  m: MonsterInstance,
  ai: AtbmbDef,
  stateDef: AtbmbStateDef,
  budget: AtbmbAbilityBudget,
  host: AtbmbHost,
  turnCtx: AtbmbTurnCtx,
): { state: GameState; dead: boolean } {
  let next = s;
  let cur = m;
  let actionsUsed = 0;
  const maxActions = ai.maxActionsPerTurn ?? Infinity;
  const prefs = () => resolveTilePrefs(stateDef, cur);
  const stillInThisState = () => (cur.aiStateId ?? stateDef.id) === stateDef.id;

  for (const rule of stateDef.decide) {
    if (actionsUsed >= maxActions) break;
    if (!stillInThisState()) break;

    const live = next.monsters.find((x) => x.id === m.id && x.hp > 0);
    if (!live) return { state: next, dead: false };
    cur = live;
    if (!stillInThisState()) break;

    if (!whenMatches(next, cur, rule.when, prefs(), stateDef.attackRange, turnCtx)) {
      continue;
    }

    const actions: AtbmbAction[] = [...rule.actions];
    if (rule.shuffleActions) shuffleInPlace(actions);

    for (const action of actions) {
      if (actionsUsed >= maxActions) break;
      if (!stillInThisState()) break;

      const live2 = next.monsters.find((x) => x.id === m.id && x.hp > 0);
      if (!live2) return { state: next, dead: false };
      cur = live2;
      if (!stillInThisState()) break;

      // Stop mid-rule if the gate no longer holds (e.g. reached favored while approaching).
      if (!whenMatches(next, cur, rule.when, prefs(), stateDef.attackRange, turnCtx)) {
        break;
      }

      const result = tryExecuteAction(next, cur, ai, stateDef, action, budget, host, turnCtx);
      next = result.state;
      cur = result.mon;
      if (result.dead) return { state: next, dead: true };
      if (result.used) {
        actionsUsed += 1;
        // State switched (e.g. Attack → Retreat) — leave this tree.
        if (!stillInThisState()) {
          return { state: next, dead: false };
        }
        if (rule.stopAfterFirstSuccess) break;
      } else if (!action.optional) {
        continue;
      }
    }
  }

  return { state: next, dead: false };
}
