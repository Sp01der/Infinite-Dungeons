import type { ChanceMode, GameState } from "../game/types";

export type RollChanceOrigin = "player" | "world";

const rollChanceStack: Array<{ state: GameState; origin: RollChanceOrigin }> = [];

/** Push RNG context for nested resolution (e.g. dungeon/monster phase uses `world` on top of `player`). */
export function pushRollChanceContext(state: GameState, origin: RollChanceOrigin): void {
  rollChanceStack.push({ state, origin });
}

export function popRollChanceContext(): void {
  rollChanceStack.pop();
}

function rollIntRaw(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function applyChanceToIntRoll(min: number, max: number): number | null {
  const top = rollChanceStack[rollChanceStack.length - 1];
  if (!top) return null;
  const mode: ChanceMode = top.state.chanceMode;
  if (mode === "normal") return null;
  if (top.state.chancePlayerOnly && top.origin === "world") return null;
  if (mode === "highest") return max;
  if (mode === "lowest") return min;
  return null;
}

/**
 * Integer rolls respect `GameState.chanceMode` when inside a `dispatch` scope
 * (`pushRollChanceContext`); otherwise uniform random in [min, max].
 */
export function rollInt(min: number, max: number): number {
  const forced = applyChanceToIntRoll(min, max);
  if (forced !== null) return forced;
  return rollIntRaw(min, max);
}

export function applyDefense(raw: number, defense: number): number {
  return Math.max(0, raw - defense);
}

export function monsterMaxHp(baseHp: number, level: number): number {
  return baseHp + 2 * Math.max(0, level - 1);
}

/** Added to each damage roll for attacks originating from this monster. */
export function monsterDamageBonus(level: number): number {
  return Math.max(0, level - 1);
}

/** Level bonus plus Strength (each level adds 1 damage). */
export function monsterOutgoingBonus(m: { level: number; strengthLevels?: number }): number {
  return monsterDamageBonus(m.level) + Math.max(0, m.strengthLevels ?? 0);
}
