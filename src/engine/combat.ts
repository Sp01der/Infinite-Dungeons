export function rollInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
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
