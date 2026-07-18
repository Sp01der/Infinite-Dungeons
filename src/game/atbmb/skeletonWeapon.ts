import { rollInt } from "../../engine/combat";
import type { Point, SkeletonWeapon } from "../types";

export function skeletonWeaponCanHit(
  w: SkeletonWeapon,
  mon: Point,
  player: Point,
  movedThisTurn: boolean,
): boolean {
  if (w === "axe" && movedThisTurn) return false;
  const dx = player.x - mon.x;
  const dy = player.y - mon.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  switch (w) {
    case "sword":
    case "axe":
      return adx + ady === 1;
    case "spear":
      if (dx !== 0 && dy !== 0) return false;
      return adx + ady === 1 || adx + ady === 2;
    case "scimitar":
      return adx === 1 && ady === 1;
    default:
      return false;
  }
}

export function skeletonWeaponRollDamage(w: SkeletonWeapon, bonus: number): number {
  switch (w) {
    case "sword":
      return rollInt(2, 4) + bonus;
    case "spear":
      return rollInt(2, 3) + bonus;
    case "axe":
      return rollInt(3, 6) + bonus;
    case "scimitar":
      return rollInt(2, 5) + bonus;
  }
}
