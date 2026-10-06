import { chebyshev, inBounds, lineOfSightClear, tileAt } from "../../engine/grid";
import { addExp } from "../progression";
import { rollGoldenPotLoot, trinketLabel } from "../loot";
import {
  createMonsterInstance,
  isSkeletalDefId,
  spawnDangerFor,
  withBonelingLeaderFlag,
} from "../monsterSpawn";
import { convertBonelingToBonePile } from "../boneling";
import { blocksFooting } from "../tombs";
import type { AtbmbAbilityDef, GameState, GroundLootInstance, MonsterInstance, Point } from "../types";
import type { AtbmbHost } from "./abilities";

/** Turns the raised-arms pose lasts after a move, including the move's own turn. */
const MAGE_RAISED_TURNS = 3;

function withRaisedTurns(m: MonsterInstance, turns: number): MonsterInstance {
  const flags = { ...(m.aiFlags ?? {}) };
  if (turns <= 0) delete flags.raisedTurns;
  else flags.raisedTurns = turns;
  return { ...m, aiFlags: flags };
}

/** Wear the pose down by one turn. No change while the mage is already idle. */
export function ageMagePose(m: MonsterInstance): MonsterInstance {
  const raised = Number(m.aiFlags?.raisedTurns ?? 0);
  if (raised <= 0) return m;
  return withRaisedTurns(m, raised - 1);
}

/** Switch to the casting sprite after moving, and hold it for a few turns. */
export function raiseMageAfterMove(m: MonsterInstance): MonsterInstance {
  return withRaisedTurns(m, MAGE_RAISED_TURNS);
}

const NEIGHBORS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

function pushLog(state: GameState, line: string): GameState {
  return { ...state, log: [...state.log.slice(-49), line] };
}

function nextMonsterId(s: GameState): string {
  let n = 0;
  for (const m of s.monsters) {
    const match = /^monster_(\d+)$/.exec(m.id);
    if (match) n = Math.max(n, Number.parseInt(match[1]!, 10) + 1);
  }
  return `monster_${n}`;
}

function nextLootId(groundLoot: GroundLootInstance[]): string {
  let serial = 0;
  for (const loot of groundLoot) {
    const match = /^gloot_(\d+)$/.exec(loot.id);
    if (match) serial = Math.max(serial, Number.parseInt(match[1]!, 10) + 1);
  }
  return `gloot_${serial}`;
}

function summonTileFree(s: GameState, p: Point): boolean {
  if (!inBounds(p, s.width, s.height)) return false;
  if (tileAt(s.tiles, p) !== "floor") return false;
  if (s.player.x === p.x && s.player.y === p.y) return false;
  if (s.monsters.some((m) => m.hp > 0 && m.x === p.x && m.y === p.y)) return false;
  if (s.pots.some((pot) => pot.x === p.x && pot.y === p.y)) return false;
  if (s.chests.some((c) => c.x === p.x && c.y === p.y)) return false;
  if (s.rocks.some((r) => r.x === p.x && r.y === p.y)) return false;
  if (blocksFooting(s, p.x, p.y)) return false;
  return true;
}

function skeletalWithin(s: GameState, origin: Point, range: number, excludeId: string): MonsterInstance[] {
  return s.monsters.filter(
    (o) =>
      o.hp > 0 &&
      o.id !== excludeId &&
      isSkeletalDefId(o.defId) &&
      chebyshev(origin, o) <= range,
  );
}

function summonMinions(
  s: GameState,
  mage: MonsterInstance,
): { state: GameState; used: boolean } {
  const spots = NEIGHBORS.map((o) => ({ x: mage.x + o.x, y: mage.y + o.y })).filter((p) =>
    summonTileFree(s, p),
  );
  if (spots.length < 2) return { state: s, used: false };
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spots[i], spots[j]] = [spots[j]!, spots[i]!];
  }
  let next = s;
  const monsters = [...next.monsters];
  for (let i = 0; i < 2; i++) {
    const spot = spots[i]!;
    let inst = createMonsterInstance(
      nextMonsterId({ ...next, monsters }),
      "boneling",
      spot.x,
      spot.y,
      next.monsterDefs,
      spawnDangerFor(next.floorTheme, "boneling", next.danger),
    );
    inst = withBonelingLeaderFlag(inst, true);
    inst = {
      ...inst,
      summonerId: mage.id,
      aiFlags: { ...(inst.aiFlags ?? {}), leader: true, mageMinion: true },
    };
    monsters.push(inst);
  }
  next = pushLog(
    { ...next, monsters },
    "The Skeleton Mage raises two boneling minions.",
  );
  return { state: next, used: true };
}

function empowerAllies(
  s: GameState,
  mage: MonsterInstance,
): { state: GameState; used: boolean } {
  const allies = skeletalWithin(s, mage, 5, mage.id);
  if (allies.length < 2) return { state: s, used: false };
  const ids = new Set(allies.map((a) => a.id));
  const monsters = s.monsters.map((m) =>
    ids.has(m.id)
      ? {
          ...m,
          strengthLevels: (m.strengthLevels ?? 0) + 2,
          resistanceLevels: (m.resistanceLevels ?? 0) + 2,
        }
      : m,
  );
  return {
    state: pushLog(
      { ...s, monsters },
      `The Skeleton Mage empowers ${allies.length} undead (+2 Strength, +2 Resistance).`,
    ),
    used: true,
  };
}

function castUnhealing(
  s: GameState,
  mage: MonsterInstance,
  host: AtbmbHost,
): { state: GameState; dead: boolean; used: boolean } {
  const player: Point = { x: s.player.x, y: s.player.y };
  const from: Point = { x: mage.x, y: mage.y };
  if (chebyshev(from, player) > 6) return { state: s, dead: false, used: false };
  if (!lineOfSightClear(s.tiles, from, player)) return { state: s, dead: false, used: false };
  const poison = skeletalWithin(s, from, 3, mage.id).length;
  const hit = host.unhealing(s, mage, 1, poison);
  return { state: hit.state, dead: hit.dead, used: true };
}

/**
 * Pick one spell at random, then try the remaining options only if that one
 * cannot be cast. Casts at most one spell; if none are legal, casts nothing.
 */
export function runSkeletonMageSpell(
  s: GameState,
  m: MonsterInstance,
  _def: AtbmbAbilityDef,
  host: AtbmbHost,
): { state: GameState; mon: MonsterInstance; dead: boolean; used: boolean } {
  const order: Array<"summon_boneling_minions" | "empower_skeletal" | "unhealing"> = [
    "summon_boneling_minions",
    "empower_skeletal",
    "unhealing",
  ];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (const id of order) {
    if (id === "summon_boneling_minions") {
      const result = summonMinions(s, m);
      if (!result.used) continue;
      const mon = result.state.monsters.find((x) => x.id === m.id) ?? m;
      return { state: result.state, mon, dead: false, used: true };
    }
    if (id === "empower_skeletal") {
      const result = empowerAllies(s, m);
      if (!result.used) continue;
      const mon = result.state.monsters.find((x) => x.id === m.id) ?? m;
      return { state: result.state, mon, dead: false, used: true };
    }
    const result = castUnhealing(s, m, host);
    if (!result.used) continue;
    const mon = result.state.monsters.find((x) => x.id === m.id) ?? m;
    return { state: result.state, mon, dead: result.dead, used: true };
  }
  return { state: s, mon: m, dead: false, used: false };
}

function hoardLabel(state: GameState, x: number, y: number): { loot: GroundLootInstance; label: string } {
  const rolled = rollGoldenPotLoot(state.cardDefs, state.depth);
  const id = nextLootId(state.groundLoot);
  if (rolled.kind === "coin") {
    return {
      loot: { id, x, y, kind: "coin", amount: rolled.amount },
      label: `${rolled.amount} gold`,
    };
  }
  if (rolled.kind === "gem") {
    return { loot: { id, x, y, kind: "gem", gemId: rolled.gemId }, label: "a gem" };
  }
  if (rolled.kind === "trinket") {
    return {
      loot: { id, x, y, kind: rolled.trinket },
      label: trinketLabel(rolled.trinket),
    };
  }
  const name = state.cardDefs.get(rolled.cardId)?.name ?? "a card";
  return { loot: { id, x, y, kind: "card", cardId: rolled.cardId }, label: name };
}

/** Guaranteed drop, and boneling minions die with their mage. */
export function applySkeletonMageDeath(state: GameState, x: number, y: number): GameState {
  const hoard = hoardLabel(state, x, y);
  let next = pushLog(
    { ...state, groundLoot: [...state.groundLoot, hoard.loot] },
    `The Skeleton Mage drops ${hoard.label}.`,
  );
  const livingMages = new Set(
    next.monsters.filter((m) => m.hp > 0 && m.defId === "skeleton_mage").map((m) => m.id),
  );
  const orphans = next.monsters.filter(
    (m) => m.hp > 0 && m.summonerId != null && !livingMages.has(m.summonerId),
  );
  for (const minion of orphans) {
    next = addExp(next, next.monsterDefs.get(minion.defId)?.power ?? 1);
    next = convertBonelingToBonePile(next, minion.x, minion.y, minion.id);
  }
  return next;
}
