import { inBounds, tileAt } from "../engine/grid";
import {
  bonelingLeaderForRoom,
  createMonsterInstance,
  withBonelingLeaderFlag,
} from "./monsterSpawn";
import { blocksFooting } from "./tombs";
import type { GameState, Point } from "./types";

export const GRAVE_BONE_PILE_HP = 10;

const ORTHO: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function nextMonsterId(s: GameState): string {
  let n = s.monsters.length;
  const used = new Set(s.monsters.map((m) => m.id));
  while (used.has(`monster_${n}`)) n++;
  return `monster_${n}`;
}

function spawnTileFree(s: GameState, p: Point): boolean {
  if (!inBounds(p, s.width, s.height)) return false;
  if (tileAt(s.tiles, p) !== "floor") return false;
  if (s.player.x === p.x && s.player.y === p.y) return false;
  if (s.monsters.some((m) => m.hp > 0 && m.x === p.x && m.y === p.y)) return false;
  if (s.pots.some((pot) => pot.x === p.x && pot.y === p.y)) return false;
  if (s.chests.some((c) => c.x === p.x && c.y === p.y)) return false;
  if (s.rocks.some((r) => r.x === p.x && r.y === p.y)) return false;
  if (s.graveBonePiles.some((g) => g.hp > 0 && g.x === p.x && g.y === p.y)) return false;
  if (blocksFooting(s, p.x, p.y)) return false;
  return true;
}

/** Each living grave pile births one Boneling on a free adjacent floor. */
export function tickGraveBonePiles(state: GameState): GameState {
  if (state.graveBonePiles.every((g) => g.hp <= 0)) return state;
  let s = state;
  let spawned = 0;
  for (const pile of state.graveBonePiles) {
    if (pile.hp <= 0) continue;
    const spots = ORTHO.map((o) => ({ x: pile.x + o.x, y: pile.y + o.y })).filter((p) =>
      spawnTileFree(s, p),
    );
    if (spots.length === 0) continue;
    const spot = spots[Math.floor(Math.random() * spots.length)]!;
    const leader = bonelingLeaderForRoom(s.monsters, s.roomIds, spot.x, spot.y);
    const inst = withBonelingLeaderFlag(
      createMonsterInstance(
        nextMonsterId(s),
        "boneling",
        spot.x,
        spot.y,
        s.monsterDefs,
        s.danger,
      ),
      leader,
    );
    s = { ...s, monsters: [...s.monsters, inst] };
    spawned++;
  }
  if (spawned === 0) return s;
  const line =
    spawned === 1
      ? "A boneling claws free of a bone pile."
      : `${spawned} bonelings claw free of the bone piles.`;
  return { ...s, log: [...s.log.slice(-49), line] };
}
