import type { MonsterInstance } from "./types";

/** Douvlon pair members share the same HP value. */
export function setMonsterHpWithDouvlonSync(
  monsters: MonsterInstance[],
  id: string,
  newHp: number,
): MonsterInstance[] {
  const t = Math.max(0, newHp);
  const mon = monsters.find((m) => m.id === id);
  if (!mon) return monsters;
  if (mon.defId === "douvlon" && mon.douvlonPairId) {
    const pid = mon.douvlonPairId;
    return monsters.map((m) =>
      m.defId === "douvlon" && m.douvlonPairId === pid ? { ...m, hp: t } : m,
    );
  }
  return monsters.map((m) => (m.id === id ? { ...m, hp: t } : m));
}

export function cullMonstersWithDouvlonPairs(monsters: MonsterInstance[]): MonsterInstance[] {
  const deadPairs = new Set<string>();
  for (const m of monsters) {
    if (m.hp <= 0 && m.defId === "douvlon" && m.douvlonPairId) deadPairs.add(m.douvlonPairId);
  }
  if (deadPairs.size === 0) return monsters.filter((m) => m.hp > 0);
  return monsters.filter(
    (m) =>
      !(
        m.defId === "douvlon" &&
        m.douvlonPairId &&
        deadPairs.has(m.douvlonPairId)
      ),
  );
}
