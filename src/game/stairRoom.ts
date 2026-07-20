import type { GameState, Point, RoomKind, StairFeaturePositions, TileKind } from "./types";
import { keyOf } from "../engine/grid";

/** Stair chamber size in tiles (width × height). */
const STAIR_W = 5;
const STAIR_H = 4;

function boundsOfRoom(
  roomIds: number[][],
  rid: number,
  w: number,
  h: number,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = w,
    maxX = -1,
    minY = h,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (roomIds[y][x] === rid) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX) return null;
  return { minX, maxX, minY, maxY };
}

type Pack = { tiles: TileKind[][]; roomIds: number[][]; width: number; height: number };

function padRightBottom(pack: Pack, padR: number, padB: number): Pack {
  if (padR <= 0 && padB <= 0) return pack;
  const nw = pack.width + padR;
  const nh = pack.height + padB;
  const tiles: TileKind[][] = [];
  const roomIds: number[][] = [];
  for (let y = 0; y < nh; y++) {
    const tr: TileKind[] = [];
    const rr: number[] = [];
    for (let x = 0; x < nw; x++) {
      if (x >= pack.width || y >= pack.height) {
        tr.push("wall");
        rr.push(-1);
      } else {
        tr.push(pack.tiles[y][x]!);
        rr.push(pack.roomIds[y][x]!);
      }
    }
    tiles.push(tr);
    roomIds.push(rr);
  }
  return { tiles, roomIds, width: nw, height: nh };
}

function stairTiles(x0: number, y0: number): Point[] {
  const out: Point[] = [];
  for (let y = y0; y < y0 + STAIR_H; y++) {
    for (let x = x0; x < x0 + STAIR_W; x++) {
      out.push({ x, y });
    }
  }
  return out;
}

/** Carve stair floor; wall off any ortho-adjacent foreign room floor (except gauntlet along shared west edge). */
function carve(
  pack: Pack,
  gauntletRid: number,
  stairRid: number,
  x0: number,
  y0: number,
): Pack {
  const tiles = pack.tiles.map((row) => [...row]);
  const roomIds = pack.roomIds.map((row) => [...row]);
  const w = pack.width;
  const h = pack.height;
  const stairKeys = new Set(stairTiles(x0, y0).map((p) => keyOf(p)));

  for (const p of stairTiles(x0, y0)) {
    tiles[p.y][p.x] = "floor";
    roomIds[p.y][p.x] = stairRid;
  }

  const ORTHO = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (const p of stairTiles(x0, y0)) {
    for (const o of ORTHO) {
      const nx = p.x + o.x;
      const ny = p.y + o.y;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (stairKeys.has(keyOf({ x: nx, y: ny }))) continue;
      if (nx === x0 - 1 && roomIds[ny][nx] === gauntletRid) continue;
      const rid = roomIds[ny][nx];
      if (tiles[ny][nx] === "floor" && rid >= 0 && rid !== gauntletRid) {
        tiles[ny][nx] = "wall";
        roomIds[ny][nx] = -1;
      }
    }
  }

  return { tiles, roomIds, width: w, height: h };
}

/**
 * Pedestal at NW. Merchant on the east (back) column, second row down.
 * Stairway on the bottom row spanning columns 4–5.
 */
function featuresEast(x0: number, y0: number): StairFeaturePositions {
  return {
    pedestal: { x: x0, y: y0 },
    merchant: { x: x0 + STAIR_W - 1, y: y0 + 1 },
    exitDoorCells: [
      { x: x0 + 3, y: y0 + STAIR_H - 1 },
      { x: x0 + 4, y: y0 + STAIR_H - 1 },
    ],
    cornerTile: { x: x0 + STAIR_W - 1, y: y0 + STAIR_H - 1 },
  };
}

/**
 * Places a 5×4 stair room flush to the east of the gauntlet (top-aligned). Expands the grid with
 * walls if needed. Neighboring non-gauntlet rooms are walled off where they touch the stair.
 */
export function attachStairRoom(s: GameState): GameState {
  if (s.roomKinds.includes("stair_room")) return s;
  const gauntletRid = s.roomKinds.findIndex((k) => k === "gauntlet");
  if (gauntletRid < 0) return s;

  const b = boundsOfRoom(s.roomIds, gauntletRid, s.width, s.height);
  if (!b) return s;

  let pack: Pack = {
    tiles: s.tiles.map((r) => [...r]),
    roomIds: s.roomIds.map((r) => [...r]),
    width: s.width,
    height: s.height,
  };

  const y0 = b.minY;
  const x0 = b.maxX + 1;
  const padR = Math.max(0, x0 + STAIR_W - pack.width);
  const padB = Math.max(0, y0 + STAIR_H - pack.height);
  pack = padRightBottom(pack, padR, padB);

  const stairRid = s.roomKinds.length;
  const roomKinds: RoomKind[] = [...s.roomKinds, "stair_room"];
  pack = carve(pack, gauntletRid, stairRid, x0, y0);

  return {
    ...s,
    width: pack.width,
    height: pack.height,
    tiles: pack.tiles,
    roomIds: pack.roomIds,
    roomKinds,
    stairFeatures: featuresEast(x0, y0),
  };
}
