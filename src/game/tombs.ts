import { keyOf } from "../engine/grid";
import type { GameState, TombInstance } from "./types";

export function tombCovers(t: TombInstance, x: number, y: number): boolean {
  return x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h;
}

export function isTombAt(s: GameState, x: number, y: number): boolean {
  return s.tombs.some((t) => tombCovers(t, x, y));
}

export function isLockedDoorAt(s: GameState, x: number, y: number): boolean {
  return s.lockedDoors.some((d) => d.x === x && d.y === y);
}

export function isGravePileAt(s: GameState, x: number, y: number): boolean {
  return s.graveBonePiles.some((g) => g.hp > 0 && g.x === x && g.y === y);
}

/** Tombs, locked gates, and grave piles block walking and knockback. They do not block attacks. */
export function blocksFooting(s: GameState, x: number, y: number): boolean {
  return isTombAt(s, x, y) || isLockedDoorAt(s, x, y) || isGravePileAt(s, x, y);
}

export function addFootingBlocks(s: GameState, occ: Set<string>): void {
  for (const t of s.tombs) {
    for (let y = t.y; y < t.y + t.h; y++) {
      for (let x = t.x; x < t.x + t.w; x++) occ.add(keyOf({ x, y }));
    }
  }
  for (const d of s.lockedDoors) occ.add(keyOf(d));
  for (const g of s.graveBonePiles) if (g.hp > 0) occ.add(keyOf(g));
}

/** Locked doors the player can step onto, but not through, while they hold a key. */
export function keyDoorHaltTiles(s: GameState): Set<string> | undefined {
  if (s.player.keys <= 0 || s.lockedDoors.length === 0) return undefined;
  const halt = new Set<string>();
  for (const d of s.lockedDoors) halt.add(keyOf(d));
  return halt;
}

export function unlockLockedDoorsInOccupancy(s: GameState, occ: Set<string>): void {
  const halt = keyDoorHaltTiles(s);
  if (!halt) return;
  for (const k of halt) occ.delete(k);
}
