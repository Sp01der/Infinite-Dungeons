import { keyOf } from "./grid";
import type { Point, TileKind } from "../game/types";

/** Room ids for the tile you stand on and any floor tile orthogonally adjacent (see into neighboring rooms). */
export function collectRoomIdsAdjacentToPlayer(opts: {
  width: number;
  height: number;
  tiles: TileKind[][];
  roomIds: number[][];
  player: Point;
}): Set<number> {
  const { width, height, tiles, roomIds, player } = opts;
  const rooms = new Set<number>();
  const tryAdd = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (tiles[y][x] !== "floor" && tiles[y][x] !== "water") return;
    const rid = roomIds[y][x];
    if (rid >= 0) rooms.add(rid);
  };
  tryAdd(player.x, player.y);
  tryAdd(player.x + 1, player.y);
  tryAdd(player.x - 1, player.y);
  tryAdd(player.x, player.y + 1);
  tryAdd(player.x, player.y - 1);
  return rooms;
}

/** Add every floor tile belonging to `rooms` into `into` (mutates). */
export function addRoomsToDiscovered(
  into: Set<string>,
  tiles: TileKind[][],
  roomIds: number[][],
  width: number,
  height: number,
  rooms: Set<number>,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] !== "floor" && tiles[y][x] !== "water") continue;
      if (rooms.has(roomIds[y][x])) into.add(keyOf({ x, y }));
    }
  }
}
