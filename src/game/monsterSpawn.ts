import { rollInt, monsterMaxHp } from "../engine/combat";
import type { MonsterDef, MonsterInstance, SkeletonWeapon } from "./types";

export const SHADE_DECK_TEMPLATE: string[] = [
  "shade_move", "shade_move", "shade_move",
  "shade_blade", "shade_blade",
  "shade_dark_bolt",
  "shade_shadow_step",
  "shade_black_shield",
];

function shuffleShadeDeck(arr: string[]): string[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function rollSkeletonWeapon(): SkeletonWeapon {
  const r = Math.random();
  if (r < 0.5) return "sword";
  if (r < 0.7) return "spear";
  if (r < 0.9) return "axe";
  return "scimitar";
}

export type CreateMonsterOpts = {
  douvlonColor?: "red" | "blue";
  douvlonPairId?: string;
  spawnedInGauntlet?: boolean;
};

export function createMonsterInstance(
  id: string,
  defId: string,
  x: number,
  y: number,
  monsterDefs: Map<string, MonsterDef>,
  dangerLevel: number,
  opts?: CreateMonsterOpts,
): MonsterInstance {
  const def = monsterDefs.get(defId);
  const baseHp = def?.hp ?? 5;
  const hp = monsterMaxHp(baseHp, dangerLevel);
  const level = dangerLevel;
  const base: MonsterInstance = { id, defId, x, y, hp, active: true, level };
  if (defId === "slime") return { ...base, leapTarget: null };
  if (defId === "skeleton") return { ...base, skeletonWeapon: rollSkeletonWeapon() };
  if (defId === "rockling") return { ...base, defenseOverride: rollInt(1, 2) };
  if (defId === "skeleton_archer") return { ...base, bowLoaded: false };
  if (defId === "mimic") return { ...base, mimicAsleep: true };
  if (defId === "elite_skeleton") {
    return {
      ...base,
      level: dangerLevel + 1,
      spawnedInGauntlet: opts?.spawnedInGauntlet ?? false,
      eliteTeleported: false,
    };
  }
  if (defId === "corrupted_shade") {
    return {
      ...base,
      shadeDeck: shuffleShadeDeck(SHADE_DECK_TEMPLATE),
      shadeDiscard: [],
      darkBoltReady: false,
      blackShieldActive: false,
    };
  }
  if (defId === "drosir") {
    return { ...base, aquatic: true };
  }
  if (defId === "douvlon" && opts?.douvlonColor && opts?.douvlonPairId) {
    return {
      ...base,
      douvlonColor: opts.douvlonColor,
      douvlonPairId: opts.douvlonPairId,
    };
  }
  return base;
}

export function monsterDefenseForIncoming(m: MonsterInstance, def: MonsterDef | undefined): number {
  const base = m.defenseOverride ?? def?.defense ?? 0;
  return base + (m.blackShieldActive ? 5 : 0);
}
