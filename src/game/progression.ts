import type { GameState } from "./types";

/** XP needed to advance from `level` to `level + 1`. From level 5 onward, requirements scale faster. */
export function expToNextLevel(level: number): number {
  if (level >= 5) return level * 10 + 5;
  return level * 5 + 5;
}

/** Add experience and process any level-ups (each: +5 max HP, heal 5 HP capped, +skill points = new level). */
export function addExp(state: GameState, amount: number): GameState {
  let level = state.player.level;
  let exp = state.player.exp + amount;
  let maxHp = state.player.maxHp;
  let hp = state.player.hp;
  let skillPoints = state.player.skillPoints;
  const logLines: string[] = [];

  while (exp >= expToNextLevel(level)) {
    exp -= expToNextLevel(level);
    level += 1;
    maxHp += 5;
    hp = Math.min(maxHp, hp + 5);
    skillPoints += level;
    logLines.push(`You reached level ${level}!`);
  }

  return {
    ...state,
    player: { ...state.player, level, exp, maxHp, hp, skillPoints },
    log: [...state.log.slice(-50), ...logLines],
  };
}
