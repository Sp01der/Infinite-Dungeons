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

/** Tombs and locked gates block walking and knockback. They do not block attacks. */
export function blocksFooting(s: GameState, x: number, y: number): boolean {
  return isTombAt(s, x, y) || isLockedDoorAt(s, x, y);
}

export function addFootingBlocks(s: GameState, occ: Set<string>): void {
  for (const t of s.tombs) {
    for (let y = t.y; y < t.y + t.h; y++) {
      for (let x = t.x; x < t.x + t.w; x++) occ.add(keyOf({ x, y }));
    }
  }
  for (const d of s.lockedDoors) occ.add(keyOf(d));
}
