import { rollInt, monsterMaxHp } from "../engine/combat";
import type { MonsterDef, MonsterInstance, SkeletonWeapon } from "./types";

export function rollSkeletonWeapon(): SkeletonWeapon {
  const r = Math.random();
  if (r < 0.5) return "sword";
  if (r < 0.7) return "spear";
  if (r < 0.8) return "axe";
  return "scimitar";
}

export function createMonsterInstance(
  id: string,
  defId: string,
  x: number,
  y: number,
  monsterDefs: Map<string, MonsterDef>,
  dangerLevel: number,
): MonsterInstance {
  const def = monsterDefs.get(defId);
  const baseHp = def?.hp ?? 5;
  const hp = monsterMaxHp(baseHp, dangerLevel);
  const level = dangerLevel;
  const base: MonsterInstance = { id, defId, x, y, hp, active: true, level };
  if (defId === "slime") return { ...base, leapTarget: null };
  if (defId === "skeleton") return { ...base, skeletonWeapon: rollSkeletonWeapon() };
  if (defId === "rockling") return { ...base, defenseOverride: rollInt(1, 2) };
  return base;
}

export function monsterDefenseForIncoming(m: MonsterInstance, def: MonsterDef | undefined): number {
  return m.defenseOverride ?? def?.defense ?? 0;
}
