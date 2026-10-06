import type { Point, TileKind } from "../game/types";
import { inBounds, keyOf, tileAt } from "./grid";

const ORTHO: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isWalkable(
  tiles: TileKind[][],
  width: number,
  height: number,
  p: Point,
  occupied: Set<string>,
  bridgeTileKeys?: Set<string>,
): boolean {
  if (!inBounds(p, width, height)) return false;
  const t = tileAt(tiles, p);
  const bridges = bridgeTileKeys ?? new Set<string>();
  if (t === "floor") {
    if (occupied.has(keyOf(p))) return false;
    return true;
  }
  if (t === "water" && bridges.has(keyOf(p))) {
    if (occupied.has(keyOf(p))) return false;
    return true;
  }
  return false;
}

/** Reachable tiles in <= maxSteps orthogonal moves from `from`, excluding blocked. */
export function reachableOrthogonal(
  tiles: TileKind[][],
  width: number,
  height: number,
  from: Point,
  maxSteps: number,
  occupied: Set<string>,
  rockTileKeys?: Set<string>,
  bridgeTileKeys?: Set<string>,
  haltTiles?: Set<string>,
): Set<string> {
  const rocks = rockTileKeys ?? new Set<string>();
  const halt = haltTiles ?? new Set<string>();
  if (rocks.size === 0) {
    const reachable = new Set<string>();
    const queue: { p: Point; d: number }[] = [{ p: from, d: 0 }];
    const seen = new Set<string>([keyOf(from)]);

    while (queue.length) {
      const cur = queue.shift()!;
      if (cur.d > 0) reachable.add(keyOf(cur.p));
      if (cur.d >= maxSteps) continue;
      if (halt.has(keyOf(cur.p)) && cur.d > 0) continue;
      for (const o of ORTHO) {
        const np = { x: cur.p.x + o.x, y: cur.p.y + o.y };
        const nk = keyOf(np);
        if (seen.has(nk)) continue;
        if (!isWalkable(tiles, width, height, np, occupied, bridgeTileKeys)) continue;
        seen.add(nk);
        queue.push({ p: np, d: cur.d + 1 });
      }
    }
    return reachable;
  }

  /**
   * Landing on rock stops further expansion this turn. Leaving rock: if the move allows only 1 step,
   * exit costs 1 (next card can get you out). If the move allows 2+ steps, the first step off rock
   * costs 2 from that card’s budget (extra movement once for that play).
   */
  const dist = new Map<string, number>();
  dist.set(keyOf(from), 0);
  const visited = new Set<string>();

  for (let iter = 0; iter < width * height * 8; iter++) {
    let bestK: string | null = null;
    let bestD = Infinity;
    for (const [k, d] of dist) {
      if (visited.has(k)) continue;
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    if (bestK === null || bestD > maxSteps) break;
    visited.add(bestK);
    const [sx, sy] = bestK.split(",").map(Number) as [number, number];
    const p: Point = { x: sx!, y: sy! };
    if ((rocks.has(bestK) || halt.has(bestK)) && (p.x !== from.x || p.y !== from.y)) continue;

    for (const o of ORTHO) {
      const np = { x: p.x + o.x, y: p.y + o.y };
      const nk = keyOf(np);
      if (!isWalkable(tiles, width, height, np, occupied, bridgeTileKeys)) continue;
      const stepCost =
        rocks.has(bestK) && maxSteps > 1 ? 2 : 1;
      const nd = bestD + stepCost;
      if (nd > maxSteps) continue;
      const prev = dist.get(nk);
      if (prev === undefined || nd < prev) dist.set(nk, nd);
    }
  }

  const reachable = new Set<string>();
  for (const [k, d] of dist) {
    if (d > 0 && d <= maxSteps) reachable.add(k);
  }
  return reachable;
}

/** Adds ortho-adjacent `blocked` tiles when the player can pay an extra discard to enter. */
export function extendReachableWithBlockedDestinations(
  baseReach: Set<string>,
  from: Point,
  tiles: TileKind[][],
  width: number,
  height: number,
  canEnterBlocked: boolean,
  occupied: Set<string>,
): Set<string> {
  if (!canEnterBlocked) return baseReach;
  const out = new Set(baseReach);
  const tryAdd = (np: Point): void => {
    if (!inBounds(np, width, height)) return;
    if (tileAt(tiles, np) !== "blocked") return;
    if (occupied.has(keyOf(np))) return;
    out.add(keyOf(np));
  };
  for (const k of baseReach) {
    const [sx, sy] = k.split(",").map(Number) as [number, number];
    for (const o of ORTHO) tryAdd({ x: sx + o.x, y: sy + o.y });
  }
  for (const o of ORTHO) tryAdd({ x: from.x + o.x, y: from.y + o.y });
  return out;
}
