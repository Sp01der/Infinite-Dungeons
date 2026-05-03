import type { FloorDef, MonsterInstance, Point, TileKind } from "../game/types";

export function parseFloor(def: FloorDef): {
  width: number;
  height: number;
  tiles: TileKind[][];
  playerStart: Point;
} {
  const height = def.rows.length;
  const width = def.rows[0]?.length ?? 0;
  const tiles: TileKind[][] = [];
  let playerStart: Point | null = null;

  for (let y = 0; y < height; y++) {
    const row = def.rows[y];
    const line: TileKind[] = [];
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? "#";
      if (ch === "#") {
        line.push("wall");
      } else if (ch === "P") {
        line.push("floor");
        playerStart = { x, y };
      } else {
        line.push("floor");
      }
    }
    tiles.push(line);
  }

  if (!playerStart) {
    throw new Error("Floor missing P (player start)");
  }

  return { width, height, tiles, playerStart };
}

export function inBounds(p: Point, width: number, height: number): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
}

export function tileAt(tiles: TileKind[][], p: Point): TileKind | undefined {
  return tiles[p.y]?.[p.x];
}

export function keyOf(p: Point): string {
  return `${p.x},${p.y}`;
}

/** Queen ray from `from` to monster; walls and other living monsters block the path to the target. */
export function magicMissilePathClear(
  tiles: TileKind[][],
  monsters: readonly MonsterInstance[],
  from: Point,
  targetMon: MonsterInstance,
): boolean {
  const px = from.x;
  const py = from.y;
  const tx = targetMon.x;
  const ty = targetMon.y;
  const dx = tx - px;
  const dy = ty - py;
  if (dx === 0 && dy === 0) return false;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (!(dx === 0 || dy === 0 || adx === ady)) return false;
  const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
  let x = px + stepX;
  let y = py + stepY;
  while (x !== tx || y !== ty) {
    if (tileAt(tiles, { x, y }) !== "floor") return false;
    if (monsters.some((m) => m.hp > 0 && m.x === x && m.y === y)) return false;
    x += stepX;
    y += stepY;
  }
  return tileAt(tiles, { x: tx, y: ty }) === "floor";
}

/** Same as magic missile to a monster, but targets an arbitrary floor tile (e.g. pot). Pots block intermediate tiles. */
export function magicMissilePathClearToPoint(
  tiles: TileKind[][],
  monsters: readonly MonsterInstance[],
  pots: readonly { x: number; y: number }[],
  from: Point,
  tx: number,
  ty: number,
): boolean {
  const px = from.x;
  const py = from.y;
  const dx = tx - px;
  const dy = ty - py;
  if (dx === 0 && dy === 0) return false;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (!(dx === 0 || dy === 0 || adx === ady)) return false;
  const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
  let x = px + stepX;
  let y = py + stepY;
  while (x !== tx || y !== ty) {
    if (tileAt(tiles, { x, y }) !== "floor") return false;
    if (monsters.some((m) => m.hp > 0 && m.x === x && m.y === y)) return false;
    if (pots.some((p) => p.x === x && p.y === y)) return false;
    x += stepX;
    y += stepY;
  }
  return tileAt(tiles, { x: tx, y: ty }) === "floor";
}

/** Chebyshev distance (chessboard distance) between two points. */
export function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * General line-of-sight check for any angle (e.g. Bow).
 * Steps along the ray using floating-point interpolation; walls block.
 * Unlike magicMissilePathClear, other monsters do NOT block this ray.
 */
export function lineOfSightClear(tiles: TileKind[][], from: Point, to: Point): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return false;
  for (let i = 1; i < steps; i++) {
    const x = Math.round(from.x + (dx * i) / steps);
    const y = Math.round(from.y + (dy * i) / steps);
    if (tileAt(tiles, { x, y }) !== "floor") return false;
  }
  return tileAt(tiles, to) === "floor";
}

/** Magic missile from a monster toward the player: straight/diagonal ray; walls and other living monsters block; player tile is the endpoint. */
export function magicMissilePathClearToPlayer(
  tiles: TileKind[][],
  monsters: readonly MonsterInstance[],
  from: Point,
  player: Point,
  excludeMonsterId: string,
): boolean {
  const px = player.x;
  const py = player.y;
  const fx = from.x;
  const fy = from.y;
  const dx = px - fx;
  const dy = py - fy;
  if (dx === 0 && dy === 0) return false;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (!(dx === 0 || dy === 0 || adx === ady)) return false;
  const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
  let x = fx + stepX;
  let y = fy + stepY;
  while (x !== px || y !== py) {
    if (tileAt(tiles, { x, y }) !== "floor") return false;
    if (monsters.some((m) => m.hp > 0 && m.id !== excludeMonsterId && m.x === x && m.y === y)) {
      return false;
    }
    x += stepX;
    y += stepY;
  }
  return tileAt(tiles, { x: px, y: py }) === "floor";
}
