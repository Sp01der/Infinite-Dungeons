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
  const withAi =
    def?.ai?.initialState !== undefined
      ? { ...base, aiStateId: def.ai.initialState, aiFlags: {} }
      : base;
  if (defId === "slime") return { ...withAi, leapTarget: null, leapDir: null };
  if (defId === "skeleton") return { ...withAi, skeletonWeapon: rollSkeletonWeapon() };
  if (defId === "rockling") return { ...withAi, defenseOverride: rollInt(1, 2) };
  if (defId === "skeleton_archer") return { ...withAi, bowLoaded: false };
  if (defId === "mimic") return { ...withAi, mimicAsleep: true };
  if (defId === "elite_skeleton") {
    return {
      ...withAi,
      level: dangerLevel + 1,
      spawnedInGauntlet: opts?.spawnedInGauntlet ?? false,
      eliteTeleported: false,
    };
  }
  if (defId === "corrupted_shade") {
    return {
      ...withAi,
      shadeDeck: shuffleShadeDeck(SHADE_DECK_TEMPLATE),
      shadeDiscard: [],
      darkBoltReady: false,
      blackShieldActive: false,
    };
  }
  if (defId === "drosir") {
    return { ...withAi, aquatic: true };
  }
  if (defId === "boneling") {
    return {
      ...withAi,
      aiFlags: {
        ...(withAi.aiFlags ?? {}),
        spriteVariant: Math.floor(Math.random() * 6),
      },
    };
  }
  if (defId === "douvlon" && opts?.douvlonColor && opts?.douvlonPairId) {
    return {
      ...withAi,
      douvlonColor: opts.douvlonColor,
      douvlonPairId: opts.douvlonPairId,
    };
  }
  return withAi;
}

export function monsterDefenseForIncoming(m: MonsterInstance, def: MonsterDef | undefined): number {
  const base = m.defenseOverride ?? def?.defense ?? 0;
  const frozen = (m.freezeLevels ?? 0) > 0 ? 2 : 0;
  return base + (m.blackShieldActive ? 5 : 0) + frozen;
}

export function monsterBlocksMovement(m: MonsterInstance): boolean {
  return m.hp > 0;
}

/** Leader only when this room has no other living Boneling (and thus no leader). */
export function bonelingLeaderForRoom(
  monsters: readonly MonsterInstance[],
  roomIds: number[][],
  x: number,
  y: number,
): boolean {
  const rid = roomIds[y]?.[x] ?? -1;
  if (rid < 0) {
    return !monsters.some((m) => m.hp > 0 && m.defId === "boneling");
  }
  const roomBonelings = monsters.filter(
    (m) => m.hp > 0 && m.defId === "boneling" && (roomIds[m.y]?.[m.x] ?? -1) === rid,
  );
  if (roomBonelings.some((m) => !!m.aiFlags?.leader)) return false;
  return roomBonelings.length === 0;
}

export function withBonelingLeaderFlag(
  inst: MonsterInstance,
  leader: boolean,
): MonsterInstance {
  if (!leader) return inst;
  return {
    ...inst,
    aiFlags: { ...(inst.aiFlags ?? {}), leader: true },
  };
}
