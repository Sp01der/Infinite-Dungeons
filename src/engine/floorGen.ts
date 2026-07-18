import type { FloorTheme, Point, RoomKind, TileKind } from "../game/types";

/** Compact work area — chambers are placed tight to keep cropped maps small. */
const WORK_W = 40;
const WORK_H = 28;

export interface GeneratedFloor {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: TileKind[][];
  playerStart: Point;
  roomIds: number[][];
  roomKinds: RoomKind[];
  /** Monster level/HP scaling for spawns on this floor (matches starting danger). */
  spawnDanger: number;
  /** Water tiles that count as land for non-aquatic (bridge overlay). */
  bridgeTiles: Point[];
  /** Theme used to generate this layout. */
  floorTheme: FloorTheme;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Chamber {
  kind: RoomKind;
  idx: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GauntletApproach {
  parentIdx: number;
  tiles: Point[];
}

/** True if interiors overlap (gap 0); touching edges only is NOT overlap. */
function overlapsInterior(a: Chamber, b: Chamber): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function center(ch: Chamber): Point {
  return { x: Math.floor(ch.x + ch.w / 2), y: Math.floor(ch.y + ch.h / 2) };
}

function rollInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function buildChamberList(nNormal: number, theme: FloorTheme, rng: () => number): Chamber[] {
  const list: Chamber[] = [];
  list.push({ kind: "entrance", idx: 0, x: 0, y: 0, w: 0, h: 0 });
  let greenhouseSlot = -1;
  // Greenhouse is the clearest Overgrown tell — keep it common enough to notice.
  if (theme === "overgrown" && rng() < 0.55 && nNormal > 0) {
    greenhouseSlot = rollInt(rng, 0, nNormal - 1);
  }
  for (let i = 0; i < nNormal; i++) {
    const kind: RoomKind = i === greenhouseSlot ? "greenhouse" : "normal";
    list.push({ kind, idx: 1 + i, x: 0, y: 0, w: 0, h: 0 });
  }
  list.push({ kind: "treasure", idx: 1 + nNormal, x: 0, y: 0, w: 0, h: 0 });
  list.push({ kind: "gauntlet", idx: nNormal + 2, x: 0, y: 0, w: 0, h: 0 });
  return list;
}

function assignSize(rng: () => number, kind: RoomKind): { w: number; h: number } {
  switch (kind) {
    case "entrance":
      return { w: rollInt(rng, 4, 7), h: rollInt(rng, 3, 5) };
    case "greenhouse":
      return { w: 5, h: 5 };
    case "normal":
      return { w: rollInt(rng, 3, 7), h: rollInt(rng, 3, 6) };
    case "treasure":
      return { w: rollInt(rng, 3, 6), h: rollInt(rng, 3, 5) };
    case "gauntlet":
      return { w: 8, h: 8 };
    default:
      return { w: 4, h: 4 };
  }
}

/** North / east / south / west: child chamber sits on that side of parent. */
const SIDES = [0, 1, 2, 3] as const;

function chamberInBounds(ch: Chamber): boolean {
  return ch.x >= 1 && ch.y >= 1 && ch.x + ch.w < WORK_W - 1 && ch.y + ch.h < WORK_H - 1;
}

function validAgainstAll(ch: Chamber, placed: Chamber[], ignoreIdx: number): boolean {
  if (!chamberInBounds(ch)) return false;
  for (const p of placed) {
    if (p.idx === ignoreIdx) continue;
    if (p.w === 0 || p.h === 0) continue;
    if (overlapsInterior(ch, p)) return false;
  }
  return true;
}

function pointInsideChamber(p: Point, ch: Chamber): boolean {
  return p.x >= ch.x && p.x < ch.x + ch.w && p.y >= ch.y && p.y < ch.y + ch.h;
}

/**
 * Attach `child` on `side` with a wall gap corridor (`gapLen` tiles) between rooms.
 * Returns approach tiles only when this is used for gauntlet placement.
 */
function tryAttachWithGap(
  parent: Chamber,
  child: Chamber,
  side: (typeof SIDES)[number],
  rng: () => number,
  placed: Chamber[],
  gapLen: number,
): Point[] | null {
  const maxSlide = 6;
  const slides: number[] = [];
  for (let s = -maxSlide; s <= maxSlide; s++) slides.push(s);
  shuffleInPlace(slides, rng);

  for (const offset of slides) {
    const c = { ...child };
    const approach: Point[] = [];
    switch (side) {
      case 0:
        c.y = parent.y - c.h - gapLen;
        c.x = parent.x + offset;
        break;
      case 1:
        c.x = parent.x + parent.w + gapLen;
        c.y = parent.y + offset;
        break;
      case 2:
        c.y = parent.y + parent.h + gapLen;
        c.x = parent.x + offset;
        break;
      case 3:
        c.x = parent.x - c.w - gapLen;
        c.y = parent.y + offset;
        break;
    }
    if (!validAgainstAll(c, placed, -1)) continue;

    if (side === 0 || side === 2) {
      const x0 = Math.max(parent.x, c.x);
      const x1 = Math.min(parent.x + parent.w - 1, c.x + c.w - 1);
      if (x0 > x1) continue;
      const doorX = rollInt(rng, x0, x1);
      for (let i = 1; i <= gapLen; i++) {
        const y = side === 0 ? parent.y - i : parent.y + parent.h - 1 + i;
        approach.push({ x: doorX, y });
      }
    } else {
      const y0 = Math.max(parent.y, c.y);
      const y1 = Math.min(parent.y + parent.h - 1, c.y + c.h - 1);
      if (y0 > y1) continue;
      const doorY = rollInt(rng, y0, y1);
      for (let i = 1; i <= gapLen; i++) {
        const x = side === 3 ? parent.x - i : parent.x + parent.w - 1 + i;
        approach.push({ x, y: doorY });
      }
    }

    let clear = true;
    for (const p of approach) {
      if (p.x <= 0 || p.y <= 0 || p.x >= WORK_W - 1 || p.y >= WORK_H - 1) {
        clear = false;
        break;
      }
      for (const other of placed) {
        if (pointInsideChamber(p, other) || pointInsideChamber(p, c)) {
          clear = false;
          break;
        }
      }
      if (!clear) break;
    }
    if (clear) {
      Object.assign(child, c);
      return approach;
    }
  }
  return null;
}

function shuffleInPlace(xs: number[], rng: () => number): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
}

function shuffledSides(rng: () => number): (typeof SIDES)[number][] {
  const arr: (typeof SIDES)[number][] = [0, 1, 2, 3];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Orthogonal adjacency: some floor of A is Manhattan-1 from some floor of B (through a “door”). */
function chambersOrthAdjacent(a: Chamber, b: Chamber): boolean {
  const ax1 = a.x;
  const ax2 = a.x + a.w - 1;
  const ay1 = a.y;
  const ay2 = a.y + a.h - 1;
  const bx1 = b.x;
  const bx2 = b.x + b.w - 1;
  const by1 = b.y;
  const by2 = b.y + b.h - 1;

  if (ax2 + 1 === bx1 || bx2 + 1 === ax1) {
    const y0 = Math.max(ay1, by1);
    const y1 = Math.min(ay2, by2);
    if (y0 <= y1) return true;
  }
  if (ay2 + 1 === by1 || by2 + 1 === ay1) {
    const x0 = Math.max(ax1, bx1);
    const x1 = Math.min(ax2, bx2);
    if (x0 <= x1) return true;
  }
  return false;
}

function boundaryPoints(ch: Chamber): Point[] {
  const pts: Point[] = [];
  const { x, y, w, h } = ch;
  for (let xi = x; xi < x + w; xi++) {
    pts.push({ x: xi, y });
    pts.push({ x: xi, y: y + h - 1 });
  }
  for (let yi = y + 1; yi < y + h - 1; yi++) {
    pts.push({ x, y: yi });
    pts.push({ x: x + w - 1, y: yi });
  }
  return pts;
}

/** Shortest Manhattan pair on perimeters — keeps corridors minimal when not flush. */
function shortestBoundaryPair(a: Chamber, b: Chamber): [Point, Point] {
  const ba = boundaryPoints(a);
  const bb = boundaryPoints(b);
  let best = 1e9;
  let pa = center(a);
  let pb = center(b);
  for (const p of ba) {
    for (const q of bb) {
      const d = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
      if (d < best) {
        best = d;
        pa = p;
        pb = q;
      }
    }
  }
  return [pa, pb];
}

/** Build tree edges matching growth order: each non-entrance has a parent it successfully attached to. */
function buildPlacementTreeEdges(placementOrder: number[], parents: Map<number, number>): [number, number][] {
  const edges: [number, number][] = [];
  for (const idx of placementOrder) {
    if (idx === 0) continue;
    const p = parents.get(idx);
    if (p !== undefined) edges.push([p, idx]);
  }
  return edges;
}

function carveCell(tiles: TileKind[][], roomMap: number[][], x: number, y: number): void {
  if (x < 0 || y < 0 || x >= WORK_W || y >= WORK_H) return;
  const wasWall = tiles[y][x] === "wall";
  tiles[y][x] = "floor";
  if (wasWall) roomMap[y][x] = -2;
}

function carveL(
  tiles: TileKind[][],
  roomMap: number[][],
  from: Point,
  to: Point,
  horizFirst: boolean,
): void {
  let x = from.x;
  let y = from.y;
  const stepX = () => {
    while (x !== to.x) {
      carveCell(tiles, roomMap, x, y);
      x += Math.sign(to.x - x);
    }
  };
  const stepY = () => {
    while (y !== to.y) {
      carveCell(tiles, roomMap, x, y);
      y += Math.sign(to.y - y);
    }
  };
  if (horizFirst) {
    stepX();
    stepY();
  } else {
    stepY();
    stepX();
  }
  carveCell(tiles, roomMap, to.x, to.y);
}

/** Two tiles wide: horizontal leg uses rows y,y+1; vertical leg uses columns x,x+1. */
function carveTunnel2Wide(
  tiles: TileKind[][],
  roomMap: number[][],
  from: Point,
  to: Point,
  horizFirst: boolean,
): void {
  let x = from.x;
  let y = from.y;
  const carveHStep = () => {
    const s = Math.sign(to.x - x);
    if (s === 0) return false;
    x += s;
    carveCell(tiles, roomMap, x, y);
    carveCell(tiles, roomMap, x, y + 1);
    return true;
  };
  const carveVStep = () => {
    const s = Math.sign(to.y - y);
    if (s === 0) return false;
    y += s;
    carveCell(tiles, roomMap, x, y);
    carveCell(tiles, roomMap, x + 1, y);
    return true;
  };
  if (horizFirst) {
    while (x !== to.x) {
      carveHStep();
    }
    if (to.y !== from.y && x === to.x) {
      carveCell(tiles, roomMap, x + 1, y);
      carveCell(tiles, roomMap, x + 1, y + 1);
    }
    while (y !== to.y) {
      carveVStep();
    }
  } else {
    while (y !== to.y) {
      carveVStep();
    }
    if (to.x !== from.x && y === to.y) {
      carveCell(tiles, roomMap, x, y + 1);
      carveCell(tiles, roomMap, x + 1, y + 1);
    }
    while (x !== to.x) {
      carveHStep();
    }
  }
  carveCell(tiles, roomMap, to.x, to.y);
  carveCell(tiles, roomMap, to.x + 1, to.y);
  carveCell(tiles, roomMap, to.x, to.y + 1);
  carveCell(tiles, roomMap, to.x + 1, to.y + 1);
}

function bridgeKey(p: Point): string {
  return `${p.x},${p.y}`;
}

function landWalkable(tiles: TileKind[][], bridges: Set<string>, x: number, y: number): boolean {
  const t = tiles[y]?.[x];
  if (t === "floor") return true;
  if (t === "water" && bridges.has(`${x},${y}`)) return true;
  return false;
}

function bfsLandReachable(
  tiles: TileKind[][],
  bridges: Set<string>,
  w: number,
  h: number,
  start: Point,
): Set<string> {
  const seen = new Set<string>();
  if (!landWalkable(tiles, bridges, start.x, start.y)) return seen;
  const q: Point[] = [start];
  seen.add(bridgeKey(start));
  while (q.length) {
    const p = q.shift()!;
    for (const o of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const nx = p.x + o.x;
      const ny = p.y + o.y;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!landWalkable(tiles, bridges, nx, ny)) continue;
      const k = `${nx},${ny}`;
      if (seen.has(k)) continue;
      seen.add(k);
      q.push({ x: nx, y: ny });
    }
  }
  return seen;
}

function allLandTilesReachable(
  tiles: TileKind[][],
  bridges: Set<string>,
  w: number,
  h: number,
  start: Point,
): boolean {
  const reach = bfsLandReachable(tiles, bridges, w, h, start);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (landWalkable(tiles, bridges, x, y) && !reach.has(`${x},${y}`)) return false;
    }
  }
  return true;
}

function shufflePoints(xs: Point[], rng: () => number): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
}

function applyGauntletWaterRingDamp(
  tiles: TileKind[][],
  roomMap: number[][],
  gch: Chamber,
  gauntletRoomIdx: number,
  bridgeWorld: Point[],
  rng: () => number,
): void {
  const x0 = gch.x + 3;
  const x1 = gch.x + 4;
  const y0 = gch.y + 3;
  const y1 = gch.y + 4;
  const ring: Point[] = [];
  for (let y = gch.y + 2; y <= gch.y + 5; y++) {
    for (let x = gch.x + 2; x <= gch.x + 5; x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
      if (roomMap[y]?.[x] !== gauntletRoomIdx) continue;
      if (tiles[y]?.[x] !== "floor") continue;
      ring.push({ x, y });
    }
  }
  if (ring.length === 0) return;
  const bridge = ring[Math.floor(rng() * ring.length)]!;
  for (const p of ring) {
    if (p.x === bridge.x && p.y === bridge.y) continue;
    tiles[p.y][p.x] = "water";
  }
  bridgeWorld.push(bridge);
}

function applyDampRoomWaterFeatures(
  tiles: TileKind[][],
  roomIds: number[][],
  roomKinds: RoomKind[],
  bridges: Point[],
  rng: () => number,
  start: Point,
): void {
  const h = tiles.length;
  const w = tiles[0]!.length;
  const bridgeSet = new Set(bridges.map(bridgeKey));

  const tryPool = (cells: Point[]) => {
    if (cells.length < 6) return;
    shufflePoints(cells, rng);
    const target = rollInt(rng, 3, 8);
    let placed = 0;
    for (const c of cells) {
      if (placed >= target) break;
      const prev = tiles[c.y][c.x];
      if (prev !== "floor") continue;
      tiles[c.y][c.x] = "water";
      if (!allLandTilesReachable(tiles, bridgeSet, w, h, start)) {
        tiles[c.y][c.x] = prev;
      } else {
        placed++;
      }
    }
  };

  const tryRiver = (cells: Point[]) => {
    if (cells.length < 8) return;
    const byx = new Map<number, Point[]>();
    const byy = new Map<number, Point[]>();
    for (const c of cells) {
      if (!byx.has(c.x)) byx.set(c.x, []);
      byx.get(c.x)!.push(c);
      if (!byy.has(c.y)) byy.set(c.y, []);
      byy.get(c.y)!.push(c);
    }
    const vertical = rng() < 0.5;
    if (vertical) {
      const xs = [...byx.keys()].filter((x) => byx.get(x)!.length >= 3);
      if (xs.length === 0) return;
      const colX = xs[Math.floor(rng() * xs.length)]!;
      const col = byx.get(colX)!.sort((a, b) => a.y - b.y);
      if (col.length < 3) return;
      const bridgeI = 1 + Math.floor(rng() * Math.max(1, col.length - 2));
      for (const c of col) {
        const prev = tiles[c.y][c.x];
        if (prev !== "floor") continue;
        tiles[c.y][c.x] = "water";
        if (!allLandTilesReachable(tiles, bridgeSet, w, h, start)) {
          tiles[c.y][c.x] = prev;
          continue;
        }
        const idx = col.indexOf(c);
        if (idx === bridgeI) {
          bridges.push({ x: c.x, y: c.y });
          bridgeSet.add(bridgeKey(c));
        }
      }
    } else {
      const ys = [...byy.keys()].filter((y) => byy.get(y)!.length >= 3);
      if (ys.length === 0) return;
      const rowY = ys[Math.floor(rng() * ys.length)]!;
      const row = byy.get(rowY)!.sort((a, b) => a.x - b.x);
      if (row.length < 3) return;
      const bridgeI = 1 + Math.floor(rng() * Math.max(1, row.length - 2));
      for (const c of row) {
        const prev = tiles[c.y][c.x];
        if (prev !== "floor") continue;
        tiles[c.y][c.x] = "water";
        if (!allLandTilesReachable(tiles, bridgeSet, w, h, start)) {
          tiles[c.y][c.x] = prev;
          continue;
        }
        const idx = row.indexOf(c);
        if (idx === bridgeI) {
          bridges.push({ x: c.x, y: c.y });
          bridgeSet.add(bridgeKey(c));
        }
      }
    }
  };

  for (let rid = 0; rid < roomKinds.length; rid++) {
    const k = roomKinds[rid];
    if (k !== "normal" && k !== "treasure" && k !== "entrance" && k !== "greenhouse") continue;
    const roomCells: Point[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (roomIds[y][x] === rid && tiles[y][x] === "floor") roomCells.push({ x, y });
      }
    }
    if (roomCells.length === 0) continue;
    if (rng() < 0.3) tryPool([...roomCells]);
    if (rng() < 0.2) tryRiver(roomCells);
  }
}

function applyBrownstoneInteriorWalls(
  tiles: TileKind[][],
  roomIds: number[][],
  roomKinds: RoomKind[],
  bridges: Point[],
  rng: () => number,
  start: Point,
): void {
  const h = tiles.length;
  const w = tiles[0]!.length;
  const bridgeSet = new Set(bridges.map(bridgeKey));
  const orth = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  for (let rid = 0; rid < roomKinds.length; rid++) {
    const k = roomKinds[rid];
    if (k !== "entrance" && k !== "normal" && k !== "treasure" && k !== "gauntlet") continue;
    const nWalls = rollInt(rng, 1, 3);
    const candidates: Point[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (roomIds[y][x] !== rid || tiles[y][x] !== "floor") continue;
        let touchesWall = false;
        let foreign = false;
        for (const o of orth) {
          const nx = x + o.x;
          const ny = y + o.y;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            touchesWall = true;
            continue;
          }
          const t = tiles[ny][nx];
          if (t === "wall") touchesWall = true;
          if (t === "floor" && roomIds[ny][nx] !== rid) foreign = true;
        }
        if (touchesWall && !foreign) candidates.push({ x, y });
      }
    }
    shufflePoints(candidates, rng);
    let added = 0;
    for (const c of candidates) {
      if (added >= nWalls) break;
      tiles[c.y][c.x] = "wall";
      if (!allLandTilesReachable(tiles, bridgeSet, w, h, start)) {
        tiles[c.y][c.x] = "floor";
      } else {
        added++;
      }
    }
  }
}

function floodCorridors(roomMap: number[][], tiles: TileKind[][], startId: number): number {
  let nextId = startId;
  for (let y = 0; y < WORK_H; y++) {
    for (let x = 0; x < WORK_W; x++) {
      if (tiles[y][x] !== "floor" || roomMap[y][x] !== -2) continue;
      const id = nextId++;
      const stack: Point[] = [{ x, y }];
      while (stack.length) {
        const p = stack.pop()!;
        if (roomMap[p.y][p.x] !== -2) continue;
        roomMap[p.y][p.x] = id;
        for (const o of [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: -1 },
        ]) {
          const q = { x: p.x + o.x, y: p.y + o.y };
          if (q.x < 0 || q.y < 0 || q.x >= WORK_W || q.y >= WORK_H) continue;
          if (tiles[q.y][q.x] === "floor" && roomMap[q.y][q.x] === -2) stack.push(q);
        }
      }
    }
  }
  return nextId;
}

function cropMap(
  tiles: TileKind[][],
  roomMap: number[][],
): {
  tilesOut: TileKind[][];
  roomIdsOut: number[][];
  ox: number;
  oy: number;
} {
  let minX = WORK_W;
  let minY = WORK_H;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < WORK_H; y++) {
    for (let x = 0; x < WORK_W; x++) {
      if (tiles[y][x] === "floor" || tiles[y][x] === "water") {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (minX > maxX || minY > maxY) {
    throw new Error("cropMap: no floor tiles");
  }
  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(WORK_W - 1, maxX + 1);
  maxY = Math.min(WORK_H - 1, maxY + 1);

  const nw = maxX - minX + 1;
  const nh = maxY - minY + 1;
  const tilesOut: TileKind[][] = [];
  const roomIdsOut: number[][] = [];
  for (let y = 0; y < nh; y++) {
    const row: TileKind[] = [];
    const rrow: number[] = [];
    for (let x = 0; x < nw; x++) {
      row.push(tiles[minY + y][minX + x]);
      rrow.push(roomMap[minY + y][minX + x]);
    }
    tilesOut.push(row);
    roomIdsOut.push(rrow);
  }
  return { tilesOut, roomIdsOut, ox: minX, oy: minY };
}

/** Exported for sanity checks / tooling. */
export function verifyGeneratedFloor(f: GeneratedFloor): string | null {
  const { width: w, height: h, tiles, playerStart: p, roomIds, roomKinds, bridgeTiles } = f;
  const bridgeSet = new Set(bridgeTiles.map(bridgeKey));
  if (!landWalkable(tiles, bridgeSet, p.x, p.y)) return "player not on walkable tile";
  const reach = bfsLandReachable(tiles, bridgeSet, w, h, p);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (landWalkable(tiles, bridgeSet, x, y) && !reach.has(`${x},${y}`)) return "disconnected floor";
      if (tiles[y][x] === "floor" || tiles[y][x] === "water") {
        const rid = roomIds[y][x];
        if (rid < 0 || rid >= roomKinds.length) return "invalid room id";
      }
    }
  }
  const kinds = new Set(roomKinds);
  if (!kinds.has("entrance") || !kinds.has("treasure") || !kinds.has("gauntlet")) {
    return "missing special room kind";
  }
  const present = new Set<number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y][x] !== "floor" && tiles[y][x] !== "water") continue;
      present.add(roomIds[y][x]);
    }
  }
  const countKind = (k: RoomKind) => {
    let n = 0;
    for (const rid of present) {
      if (roomKinds[rid] === k) n++;
    }
    return n;
  };
  const corridorCount = countKind("corridor");
  if (corridorCount < 4 || corridorCount > 14) return "corridor count out of bounds";
  const nonCorrCount = roomKinds.filter((k) =>
    k === "entrance" || k === "normal" || k === "treasure" || k === "gauntlet" || k === "greenhouse",
  ).length;
  if (nonCorrCount < 9 || nonCorrCount > 13) return "non-corridor room count out of bounds";
  if (countKind("entrance") !== 1) return "invalid entrance count";
  if (countKind("gauntlet") !== 1) return "invalid gauntlet count";
  const gauntletRid = roomKinds.findIndex((k) => k === "gauntlet");
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (roomIds[y][x] !== gauntletRid) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return "missing gauntlet tiles";
  if (maxX - minX + 1 !== 8 || maxY - minY + 1 !== 8) return "gauntlet room must be 8x8";
  const gauntletCorrRid = roomKinds.findIndex((k) => k === "gauntlet_corridor");
  if (gauntletCorrRid < 0) return "missing gauntlet approach corridor";
  let approachCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (roomIds[y][x] === gauntletCorrRid) approachCount++;
  }
  if (approachCount < 1 || approachCount > 3) return "gauntlet approach length out of bounds";

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (roomIds[y][x] !== gauntletRid) continue;
      if (tiles[y][x] !== "floor" && tiles[y][x] !== "water") continue;
      for (const o of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        const nx = x + o.x;
        const ny = y + o.y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nt = tiles[ny][nx];
        if (nt !== "floor" && nt !== "water") continue;
        const nr = roomIds[ny][nx];
        if (nr === gauntletRid || nr === gauntletCorrRid) continue;
        return "gauntlet borders a room or corridor other than its approach";
      }
    }
  }
  return null;
}

/** Distinct corridor regions (flood-filled), excluding gauntlet approach. */
export function countCorridorRegions(f: GeneratedFloor): number {
  const { width: w, height: h, tiles, roomIds, roomKinds } = f;
  const present = new Set<number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y][x] === "floor" || tiles[y][x] === "water") present.add(roomIds[y][x]);
    }
  }
  let n = 0;
  for (const rid of present) {
    if (roomKinds[rid] === "corridor") n++;
  }
  return n;
}

function normalChamberCountTarget(depth: number, rng: () => number): number {
  if (depth <= 1) return rollInt(rng, 6, 7);
  if (depth === 2) return 7;
  if (depth === 3) return rollInt(rng, 7, 8);
  if (depth === 4) return rollInt(rng, 8, 9);
  if (depth === 5) return 10;
  return rollInt(rng, 8, 9);
}

function corridorCountTarget(depth: number): { lo: number; hi: number } {
  if (depth <= 1) return { lo: 6, hi: 7 };
  if (depth === 2) return { lo: 7, hi: 7 };
  if (depth === 3) return { lo: 7, hi: 8 };
  if (depth === 4) return { lo: 8, hi: 9 };
  if (depth === 5) return { lo: 9, hi: 9 };
  return { lo: 8, hi: 9 };
}

export function generateFloor(opts?: { seed?: number; depth?: number; theme?: FloorTheme }): GeneratedFloor {
  const depth = opts?.depth ?? 1;
  const theme: FloorTheme = opts?.theme ?? "normal";
  let seed = opts?.seed ?? Math.floor(Math.random() * 0x7fffffff);
  let attempts = 0;
  while (attempts < 520) {
    attempts++;
    const rng = mulberry32(seed);
    const nNormal = normalChamberCountTarget(depth, rng);
    const { lo: corrLo, hi: corrHi } = corridorCountTarget(depth);
    const chambers = buildChamberList(nNormal, theme, rng);

    const parents = new Map<number, number>();
    const placementOrder: number[] = [];
    const gauntletApproach: GauntletApproach = { parentIdx: -1, tiles: [] };
    if (!tryPlaceChambersGrownWithParents(chambers, rng, parents, placementOrder, gauntletApproach)) {
      seed = (seed + 9973) | 0;
      continue;
    }

    const treeEdges = buildPlacementTreeEdges(placementOrder, parents);
    const C = chambers.length;
    const edges: [number, number][] = [...treeEdges];

    const redundantTarget =
      depth <= 1 ? rollInt(rng, 2, 4) : depth === 2 ? rollInt(rng, 3, 4) : rollInt(rng, 3, 5);
    let redundant = 0;
    let extraGuard = 0;
    const gauntletIdx = C - 1;
    while (redundant < redundantTarget && extraGuard++ < 220) {
      let a = rollInt(rng, 0, C - 1);
      let b = rollInt(rng, 0, C - 1);
      let inner = 0;
      while ((a === b || edges.some(([u, v]) => (u === a && v === b) || (u === b && v === a))) && inner++ < 36) {
        a = rollInt(rng, 0, C - 1);
        b = rollInt(rng, 0, C - 1);
      }
      if (
        a !== b &&
        !edges.some(([u, v]) => (u === a && v === b) || (u === b && v === a)) &&
        a !== gauntletIdx &&
        b !== gauntletIdx
      ) {
        edges.push([a, b]);
        redundant++;
      }
    }

    const tiles: TileKind[][] = Array.from({ length: WORK_H }, () =>
      Array.from({ length: WORK_W }, () => "wall" as TileKind),
    );
    const roomMap: number[][] = Array.from({ length: WORK_H }, () =>
      Array.from({ length: WORK_W }, () => -1),
    );

    for (const ch of chambers) {
      for (let y = ch.y; y < ch.y + ch.h; y++) {
        for (let x = ch.x; x < ch.x + ch.w; x++) {
          if (x < 0 || y < 0 || x >= WORK_W || y >= WORK_H) continue;
          if (ch.kind === "greenhouse") {
            const lx = x - ch.x;
            const ly = y - ch.y;
            if ((lx === 0 || lx === 4) && (ly === 0 || ly === 4)) continue;
          }
          tiles[y][x] = "floor";
          roomMap[y][x] = ch.idx;
        }
      }
    }

    for (const [ai, bi] of edges) {
      if (
        gauntletApproach.parentIdx >= 0 &&
        ((ai === gauntletApproach.parentIdx && bi === C - 1) || (bi === gauntletApproach.parentIdx && ai === C - 1))
      ) {
        continue;
      }
      const ca = chambers[ai]!;
      const cb = chambers[bi]!;
      if (chambersOrthAdjacent(ca, cb)) continue;
      const [pa, pb] = shortestBoundaryPair(ca, cb);
      const horizFirst = rng() < 0.5;
      if (theme === "brownstone") {
        carveTunnel2Wide(tiles, roomMap, pa, pb, horizFirst);
      } else {
        carveL(tiles, roomMap, pa, pb, horizFirst);
      }
    }

    for (const p of gauntletApproach.tiles) {
      carveCell(tiles, roomMap, p.x, p.y);
    }

    const bridgeWorld: Point[] = [];
    if (theme === "damp") {
      const gch = chambers[C - 1]!;
      applyGauntletWaterRingDamp(tiles, roomMap, gch, gch.idx, bridgeWorld, rng);
    }

    const corridorStart = C;
    const nextAfterCorridors = floodCorridors(roomMap, tiles, corridorStart);

    const { tilesOut, roomIdsOut, ox, oy } = cropMap(tiles, roomMap);

    let maxRid = -1;
    for (const row of roomIdsOut) {
      for (const v of row) maxRid = Math.max(maxRid, v);
    }
    const roomKinds: RoomKind[] = chambers.map((c) => c.kind);
    while (roomKinds.length <= maxRid) {
      roomKinds.push("corridor");
    }
    if (gauntletApproach.tiles.length > 0) {
      const gauntletCorridorRid = Math.max(nextAfterCorridors, maxRid + 1);
      while (roomKinds.length <= gauntletCorridorRid) roomKinds.push("corridor");
      roomKinds[gauntletCorridorRid] = "gauntlet_corridor";
      for (const p of gauntletApproach.tiles) {
        const x = p.x - ox;
        const y = p.y - oy;
        if (x < 0 || y < 0 || x >= roomIdsOut[0]!.length || y >= roomIdsOut.length) continue;
        roomIdsOut[y][x] = gauntletCorridorRid;
      }
    }

    const ch0 = chambers[0]!;
    const px = rollInt(rng, ch0.x, ch0.x + ch0.w - 1) - ox;
    const py = rollInt(rng, ch0.y, ch0.y + ch0.h - 1) - oy;

    const bridgeTiles: Point[] = bridgeWorld.map((p) => ({ x: p.x - ox, y: p.y - oy }));
    if (theme === "damp") {
      applyDampRoomWaterFeatures(tilesOut, roomIdsOut, roomKinds, bridgeTiles, rng, { x: px, y: py });
    }
    if (theme === "brownstone") {
      applyBrownstoneInteriorWalls(tilesOut, roomIdsOut, roomKinds, bridgeTiles, rng, { x: px, y: py });
    }

    const floor: GeneratedFloor = {
      id: `gen_${(seed >>> 0).toString(16)}`,
      name: "Generated dungeon",
      width: tilesOut[0]!.length,
      height: tilesOut.length,
      tiles: tilesOut,
      playerStart: { x: px, y: py },
      roomIds: roomIdsOut,
      roomKinds,
      spawnDanger: depth,
      bridgeTiles,
      floorTheme: theme,
    };

    const err = verifyGeneratedFloor(floor);
    if (err) {
      seed = (seed + 10007) | 0;
      continue;
    }
    const cr = countCorridorRegions(floor);
    if (cr < corrLo || cr > corrHi) {
      seed = (seed + 10007) | 0;
      continue;
    }
    return floor;
  }

  throw new Error("generateFloor: failed after retries");
}

/**
 * Same as growth placement but records parent index for each attached chamber for tree edges.
 */
function tryPlaceChambersGrownWithParents(
  chambers: Chamber[],
  rng: () => number,
  parents: Map<number, number>,
  placementOrder: number[],
  gauntletApproach: GauntletApproach,
): boolean {
  parents.clear();
  placementOrder.length = 0;
  gauntletApproach.parentIdx = -1;
  gauntletApproach.tiles = [];

  const first = chambers[0]!;
  const sz0 = assignSize(rng, "entrance");
  first.w = sz0.w;
  first.h = sz0.h;
  first.x = 4;
  first.y = 4;

  const placed: Chamber[] = [first];
  placementOrder.push(0);

  const order: number[] = [];
  for (let i = 1; i < chambers.length - 1; i++) order.push(i);
  shuffleInPlace(order, rng);
  order.push(chambers.length - 1);

  for (const idx of order) {
    const ch = chambers[idx]!;
    const sz = assignSize(rng, ch.kind);
    ch.w = sz.w;
    ch.h = sz.h;

    let ok = false;
    const parentOrder = placed.map((_, i) => i);
    shuffleInPlace(parentOrder, rng);

    for (let attempt = 0; attempt < 100 && !ok; attempt++) {
      const pi = parentOrder[attempt % parentOrder.length]!;
      const parent = placed[pi]!;
      const sides = shuffledSides(rng);
      for (const side of sides) {
        const isGauntlet = ch.kind === "gauntlet";
        const gapLen = isGauntlet ? rollInt(rng, 1, 3) : rollInt(rng, 1, 2);
        const approachTiles = tryAttachWithGap(parent, ch, side, rng, placed, gapLen);
        if (approachTiles) {
          parents.set(idx, parent.idx);
          if (isGauntlet) {
            gauntletApproach.parentIdx = parent.idx;
            gauntletApproach.tiles = approachTiles;
          }
          ok = true;
          break;
        }
      }
    }

    if (!ok) return false;
    placed.push(ch);
    placementOrder.push(idx);
  }

  return true;
}
