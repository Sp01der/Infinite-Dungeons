import type { Point, RoomKind, TileKind, TombInstance, TrinketId } from "../game/types";

/**
 * Pixel-map room templates. One character = one tile.
 * `#` wall (no pixel), `.` floor, `e` light-blue entrance,
 * `p` brown pot spot, `t` dark-blue tomb, `c` yellow chest, `g` gold tomb.
 * Rooms may be rotated or mirrored when placed.
 */
const TEMPLATES: { id: string; rows: string[]; scatterPots?: boolean; fancy?: boolean }[] = [
  {
    id: "cross_pots",
    rows: ["#pep#", "p...p", "e...e", "p...p", "#pep#"],
  },
  {
    id: "twin_tombs",
    rows: [".t.##.t.", ".t.##.t.", "...##...", "e......e", "........", "........", "ppp.eppp"],
  },
  {
    id: "tomb_hall",
    rows: [
      ".t.#.t.#.t.",
      ".t.#.t.#.t.",
      "...#...#...",
      "e.........e",
      "...#...#...",
      ".t.#.t.#.t.",
      ".t.#.t.#.t.",
    ],
  },
  {
    id: "open_cross",
    rows: ["..e..", ".....", "e...e", ".....", "..e.."],
  },
  {
    id: "well",
    rows: ["#p.e.p#", "p.....p", "...#...", "e.###.e", "...#...", "p.....p", "#p.e.p#"],
  },
  {
    id: "scatter",
    scatterPots: true,
    rows: ["#..e..#", ".......", ".......", "e.....e", ".......", ".......", "#..e..#"],
  },
  {
    id: "brown_cross",
    rows: ["p..e..p", "...#...", "..p#p..", "e#####e", "..p#p..", "...#...", "p..e..p"],
  },
  {
    id: "side_tomb",
    rows: ["..e.###", "p...###", "p......", "e...tt.", "p......", "p...###", "..e.###"],
  },
  {
    id: "fancy",
    fancy: true,
    rows: ["#ppepp#", "p.....p", "p..g..p", "e..g..e", "p.c.c.p", "p.....p", "#ppepp#"],
  },
];

const COLS = 5;
const ROWS = 4;
/** Chance a spawned pot is magic. */
const MAGIC_POT_CHANCE = 0.1;
/** Floor tiles carved between two facing light-blue doors. */
const GAP = 2;

export interface CatacombLayout {
  id: string;
  width: number;
  height: number;
  tiles: TileKind[][];
  roomIds: number[][];
  roomKinds: RoomKind[];
  playerStart: Point;
  tombs: TombInstance[];
  lockedDoors: Point[];
  catacombStair: Point;
  pots: { x: number; y: number; magic: boolean; golden: boolean }[];
  chests: Point[];
  bonelings: Point[];
  skeletons: Point[];
  elites: Point[];
  gravePiles: Point[];
  coins: Point[];
  cards: Point[];
  trinkets: { x: number; y: number; trinket: TrinketId }[];
  gems: Point[];
  keys: Point[];
  /** Wall tiles of the ultra-fancy locked room, drawn with a warm tint. */
  goldWalls: Point[];
  summary: string;
}

type CellCode = "#" | "." | "e" | "p" | "t" | "c" | "g";

interface Placed {
  index: number;
  col: number;
  row: number;
  role: "start" | "gauntlet" | "grave" | "treasure" | "locked" | "normal";
  scatter: boolean;
  fancy: boolean;
  origin: Point;
  cells: { x: number; y: number; code: CellCode }[];
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function rotateCW(rows: string[]): string[] {
  const h = rows.length;
  const w = rows[0]!.length;
  const out: string[] = [];
  for (let x = 0; x < w; x++) {
    let line = "";
    for (let y = h - 1; y >= 0; y--) line += rows[y]![x];
    out.push(line);
  }
  return out;
}

function flipH(rows: string[]): string[] {
  return rows.map((r) => [...r].reverse().join(""));
}

function orientations(rows: string[]): string[][] {
  const out: string[][] = [];
  let cur = rows;
  for (let i = 0; i < 4; i++) {
    out.push(cur);
    out.push(flipH(cur));
    cur = rotateCW(cur);
  }
  return out;
}

function gridNeighbors(i: number): number[] {
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  const n: number[] = [];
  if (c > 0) n.push(i - 1);
  if (c < COLS - 1) n.push(i + 1);
  if (r > 0) n.push(i - COLS);
  if (r < ROWS - 1) n.push(i + COLS);
  return n;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function dirOf(from: number, to: number): Point {
  const fc = from % COLS;
  const fr = Math.floor(from / COLS);
  const tc = to % COLS;
  const tr = Math.floor(to / COLS);
  return { x: Math.sign(tc - fc), y: Math.sign(tr - fr) };
}

function parseGrid(rows: string[]): { x: number; y: number; code: CellCode }[] {
  const cells: { x: number; y: number; code: CellCode }[] = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      cells.push({ x, y, code: row[x] as CellCode });
    }
  }
  return cells;
}

type LocalCell = { x: number; y: number; code: CellCode };

const ORTHO: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Light-blue tiles whose outward neighbor is not this room's floor. */
function facingEntrances(cells: LocalCell[], dir: Point): LocalCell[] {
  const floors = new Set(cells.filter((c) => c.code !== "#").map((c) => key(c.x, c.y)));
  return cells.filter((c) => c.code === "e" && !floors.has(key(c.x + dir.x, c.y + dir.y)));
}

function entranceDirs(cells: LocalCell[]): Point[] {
  return ORTHO.filter((d) => facingEntrances(cells, d).length > 0);
}

interface Draft {
  index: number;
  role: Placed["role"];
  scatter: boolean;
  fancy: boolean;
  origin: Point;
  local: LocalCell[];
}

interface DoorLink {
  a: number;
  b: number;
  doorA: Point;
  doorB: Point;
  locked: boolean;
}

function worldOf(d: Draft, c: LocalCell): Point {
  return { x: d.origin.x + c.x, y: d.origin.y + c.y };
}

function floorKeysOf(origin: Point, cells: LocalCell[]): string[] {
  const out: string[] = [];
  for (const c of cells) {
    if (c.code === "#") continue;
    out.push(key(origin.x + c.x, origin.y + c.y));
  }
  return out;
}

function cellsBetween(a: Point, b: Point): Point[] | null {
  if (a.x !== b.x && a.y !== b.y) return null;
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  if (dx === 0 && dy === 0) return null;
  const out: Point[] = [];
  let x = a.x + dx;
  let y = a.y + dy;
  let guard = 0;
  while ((x !== b.x || y !== b.y) && guard++ < 64) {
    out.push({ x, y });
    x += dx;
    y += dy;
  }
  return x === b.x && y === b.y ? out : null;
}

function corridorOk(
  between: Point[],
  floors: Set<string>,
  corridors: Set<string>,
  doorA: Point,
  doorB: Point,
): boolean {
  const allow = new Set([key(doorA.x, doorA.y), key(doorB.x, doorB.y)]);
  for (const c of between) {
    const k = key(c.x, c.y);
    if (floors.has(k) || corridors.has(k)) return false;
    for (const o of ORTHO) {
      const n = key(c.x + o.x, c.y + o.y);
      if (floors.has(n) && !allow.has(n)) return false;
      if (corridors.has(n)) return false;
    }
  }
  return true;
}

function nearFloors(keys: string[], floors: Set<string>): boolean {
  for (const k of keys) {
    if (floors.has(k)) return true;
    const [xs, ys] = k.split(",");
    const x = Number(xs);
    const y = Number(ys);
    for (const o of ORTHO) {
      if (floors.has(key(x + o.x, y + o.y))) return true;
    }
  }
  return false;
}

function matchDoors(
  da: Draft,
  db: Draft,
  dir: Point,
  floors: Set<string>,
  corridors: Set<string>,
): { doorA: Point; doorB: Point } | null {
  let best: { doorA: Point; doorB: Point; gap: number } | null = null;
  for (const la of facingEntrances(da.local, dir)) {
    for (const lb of facingEntrances(db.local, { x: -dir.x, y: -dir.y })) {
      const wa = worldOf(da, la);
      const wb = worldOf(db, lb);
      if (dir.x !== 0) {
        if (wa.y !== wb.y || Math.sign(wb.x - wa.x) !== dir.x) continue;
      } else if (wa.x !== wb.x || Math.sign(wb.y - wa.y) !== dir.y) continue;
      const between = cellsBetween(wa, wb);
      if (!between || between.length < GAP) continue;
      if (!corridorOk(between, floors, corridors, wa, wb)) continue;
      if (!best || between.length < best.gap) best = { doorA: wa, doorB: wb, gap: between.length };
    }
  }
  return best ? { doorA: best.doorA, doorB: best.doorB } : null;
}

function pairBlockers(
  cells: { x: number; y: number; code: CellCode }[],
  code: "t" | "g",
  special: boolean,
  nextId: () => string,
): TombInstance[] {
  const pts = cells.filter((c) => c.code === code);
  const used = new Set<string>();
  const tombs: TombInstance[] = [];
  for (const p of pts) {
    const k = key(p.x, p.y);
    if (used.has(k)) continue;
    used.add(k);
    const east = pts.find((o) => o.x === p.x + 1 && o.y === p.y && !used.has(key(o.x, o.y)));
    const south = pts.find((o) => o.x === p.x && o.y === p.y + 1 && !used.has(key(o.x, o.y)));
    if (east) {
      used.add(key(east.x, east.y));
      tombs.push({ id: nextId(), x: p.x, y: p.y, w: 2, h: 1, special });
    } else if (south) {
      used.add(key(south.x, south.y));
      tombs.push({ id: nextId(), x: p.x, y: p.y, w: 1, h: 2, special });
    } else {
      tombs.push({ id: nextId(), x: p.x, y: p.y, w: 1, h: 1, special });
    }
  }
  return tombs;
}

function layoutRooms(
  rng: () => number,
  edges: [number, number][],
  lockedBridge: string,
  lockedSet: Set<number>,
  start: number,
  gauntlet: number,
  fancyIndex: number,
  roles: Map<number, Placed["role"]>,
): { placed: Placed[]; links: DoorLink[] } | null {
  const n = COLS * ROWS;
  const adj = new Map<number, number[]>();
  for (let i = 0; i < n; i++) adj.set(i, []);
  for (const [a, b] of edges) {
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const parent = new Map<number, number | null>();
  const order: number[] = [];
  const queue = [start];
  parent.set(start, null);
  while (queue.length) {
    const i = queue.shift()!;
    order.push(i);
    for (const j of adj.get(i) ?? []) {
      if (parent.has(j)) continue;
      parent.set(j, i);
      queue.push(j);
    }
  }
  if (order.length !== n) return null;
  const chords = edges.filter(([a, b]) => parent.get(a) !== b && parent.get(b) !== a);
  const connectable = TEMPLATES.filter((t) => !t.fancy && t.rows.some((r) => r.includes("e")));
  const fancyT = TEMPLATES.filter((t) => t.fancy);
  const drafts = new Map<number, Draft>();
  const floors = new Set<string>();
  const corridors = new Set<string>();
  const links: DoorLink[] = [];
  let budget = 120;
  let aborted = false;

  const requiredDirs = (i: number): Point[] => {
    const dirs: Point[] = [];
    for (const j of adj.get(i) ?? []) {
      const d = dirOf(i, j);
      if (!dirs.some((o) => o.x === d.x && o.y === d.y)) dirs.push(d);
    }
    return dirs;
  };

  const dfs = (oi: number): boolean => {
    if (aborted || budget-- <= 0) {
      aborted = true;
      return false;
    }
    if (oi === order.length) return true;
    const i = order[oi]!;
    const p = parent.get(i) ?? null;
    const need = requiredDirs(i);
    const options = i === fancyIndex ? fancyT : shuffle(connectable, rng);
    for (const tmpl of options) {
      if (aborted) return false;
      for (const grid of shuffle(orientations(tmpl.rows), rng)) {
        if (aborted) return false;
        const local = parseGrid(grid);
        if (need.some((d) => facingEntrances(local, d).length === 0)) continue;
        if ((i === start || i === gauntlet) && entranceDirs(local).length < 2) continue;

        const commit = (
          origin: Point,
          treeBetween: Point[],
          doorA: Point | null,
          doorB: Point | null,
        ): boolean => {
          const fkeys = floorKeysOf(origin, local);
          const doorKey = doorB ? key(doorB.x, doorB.y) : "";
          if (nearFloors(fkeys, floors)) return false;
          for (const fk of fkeys) {
            if (corridors.has(fk)) return false;
            const [xs, ys] = fk.split(",");
            const x = Number(xs);
            const y = Number(ys);
            for (const o of ORTHO) {
              const nk = key(x + o.x, y + o.y);
              if (!corridors.has(nk) && !treeBetween.some((c) => key(c.x, c.y) === nk)) continue;
              if (fk !== doorKey) return false;
            }
          }
          const draft: Draft = {
            index: i,
            role: roles.get(i)!,
            scatter: !!tmpl.scatterPots,
            fancy: i === fancyIndex,
            origin,
            local,
          };
          for (const fk of fkeys) floors.add(fk);
          const addedC: string[] = [];
          const takeCorridor = (pts: Point[]) => {
            for (const c of pts) {
              const k = key(c.x, c.y);
              if (corridors.has(k)) continue;
              corridors.add(k);
              addedC.push(k);
            }
          };
          takeCorridor(treeBetween);
          const linkCount = links.length;
          if (doorA && doorB && p != null) {
            links.push({
              a: p,
              b: i,
              doorA,
              doorB,
              locked: edgeKey(p, i) === lockedBridge,
            });
          }
          let chordsOk = true;
          for (const [a, b] of chords) {
            if (a !== i && b !== i) continue;
            const other = a === i ? b : a;
            const otherDraft = drafts.get(other);
            if (!otherDraft) continue;
            const matched = matchDoors(draft, otherDraft, dirOf(i, other), floors, corridors);
            if (!matched) {
              chordsOk = false;
              break;
            }
            const between = cellsBetween(matched.doorA, matched.doorB);
            if (!between) {
              chordsOk = false;
              break;
            }
            takeCorridor(between);
            links.push({
              a: i,
              b: other,
              doorA: matched.doorA,
              doorB: matched.doorB,
              locked: edgeKey(i, other) === lockedBridge,
            });
          }
          if (chordsOk) {
            drafts.set(i, draft);
            if (dfs(oi + 1)) return true;
            drafts.delete(i);
          }
          links.length = linkCount;
          for (const k of addedC) corridors.delete(k);
          for (const fk of fkeys) floors.delete(fk);
          return false;
        };

        if (p == null) {
          if (commit({ x: 0, y: 0 }, [], null, null)) return true;
          continue;
        }
        const parentDraft = drafts.get(p);
        if (!parentDraft) continue;
        const dir = dirOf(p, i);
        let placedChild = false;
        for (const pd of shuffle(facingEntrances(parentDraft.local, dir), rng)) {
          if (aborted) return false;
          for (const cd of shuffle(facingEntrances(local, { x: -dir.x, y: -dir.y }), rng)) {
            if (aborted) return false;
            const wa = worldOf(parentDraft, pd);
            const origin = {
              x: wa.x + dir.x * (GAP + 1) - cd.x,
              y: wa.y + dir.y * (GAP + 1) - cd.y,
            };
            const wb = { x: origin.x + cd.x, y: origin.y + cd.y };
            const between = cellsBetween(wa, wb);
            if (!between || !corridorOk(between, floors, corridors, wa, wb)) continue;
            if (commit(origin, between, wa, wb)) {
              placedChild = true;
              break;
            }
          }
          if (placedChild) break;
        }
        if (placedChild) return true;
      }
    }
    return false;
  };

  if (!dfs(0)) return null;
  const degree = (i: number) => links.filter((l) => l.a === i || l.b === i).length;
  if (degree(start) < 2 || degree(gauntlet) < 2) return null;

  const linked = new Set(links.map((l) => edgeKey(l.a, l.b)));
  const extras: DoorLink[] = [];
  for (let i = 0; i < n; i++) {
    for (const j of gridNeighbors(i)) {
      if (j < i || linked.has(edgeKey(i, j))) continue;
      if (lockedSet.has(i) !== lockedSet.has(j)) continue;
      const matched = matchDoors(drafts.get(i)!, drafts.get(j)!, dirOf(i, j), floors, corridors);
      if (!matched) continue;
      extras.push({ a: i, b: j, doorA: matched.doorA, doorB: matched.doorB, locked: false });
    }
  }
  for (const extra of shuffle(extras, rng).slice(0, rollInt(rng, 2, 4))) {
    const between = cellsBetween(extra.doorA, extra.doorB);
    if (!between || !corridorOk(between, floors, corridors, extra.doorA, extra.doorB)) continue;
    for (const c of between) corridors.add(key(c.x, c.y));
    links.push(extra);
  }

  let minX = Infinity;
  let minY = Infinity;
  for (const d of drafts.values()) {
    for (const c of d.local) {
      if (c.code === "#") continue;
      minX = Math.min(minX, d.origin.x + c.x);
      minY = Math.min(minY, d.origin.y + c.y);
    }
  }
  const sx = 1 - minX;
  const sy = 1 - minY;
  const placed: Placed[] = [];
  for (const d of drafts.values()) {
    d.origin = { x: d.origin.x + sx, y: d.origin.y + sy };
    placed.push({
      index: d.index,
      col: d.index % COLS,
      row: Math.floor(d.index / COLS),
      role: d.role,
      scatter: d.scatter,
      fancy: d.fancy,
      origin: d.origin,
      cells: d.local.map((c) => ({ x: d.origin.x + c.x, y: d.origin.y + c.y, code: c.code })),
    });
  }
  for (const l of links) {
    l.doorA = { x: l.doorA.x + sx, y: l.doorA.y + sy };
    l.doorB = { x: l.doorB.x + sx, y: l.doorB.y + sy };
  }
  return { placed, links };
}

function tryBuild(rng: () => number): CatacombLayout | null {
  const n = COLS * ROWS;
  const start = rollInt(rng, 0, n - 1);
  let gauntlet = rollInt(rng, 0, n - 1);
  let guard = 0;
  while (gauntlet === start && guard++ < 20) gauntlet = rollInt(rng, 0, n - 1);
  if (gauntlet === start) return null;

  const forbidden = new Set<number>([start, gauntlet, ...gridNeighbors(start), ...gridNeighbors(gauntlet)]);
  const corners = [0, COLS - 1, (ROWS - 1) * COLS, COLS * ROWS - 1].filter(
    (i) => !forbidden.has(i),
  );
  const lockedSeeds = shuffle(
    (corners.length > 0 ? corners : Array.from({ length: n }, (_, i) => i)).filter(
      (i) => !forbidden.has(i),
    ),
    rng,
  );
  if (lockedSeeds.length === 0) return null;
  const locked: number[] = [lockedSeeds[0]!];
  const lockedTarget = rollInt(rng, 1, 3);
  const lockedSet = new Set(locked);
  let grew = true;
  while (locked.length < lockedTarget && grew) {
    grew = false;
    const options = shuffle(
      locked.flatMap((i) => gridNeighbors(i)).filter((j) => !lockedSet.has(j) && !forbidden.has(j)),
      rng,
    );
    if (options.length === 0) break;
    locked.push(options[0]!);
    lockedSet.add(options[0]!);
    grew = true;
  }
  const fancyIndex = locked[0]!;

  const outside = Array.from({ length: n }, (_, i) => i).filter((i) => !lockedSet.has(i));
  const edges: [number, number][] = [];
  const edgeDegree = new Map<number, number>();
  const connect = (i: number, j: number) => {
    edges.push([i, j]);
    edgeDegree.set(i, (edgeDegree.get(i) ?? 0) + 1);
    edgeDegree.set(j, (edgeDegree.get(j) ?? 0) + 1);
  };
  const grow = (nodes: number[], prefer: number[]): boolean => {
    if (nodes.length === 0) return true;
    const allow = new Set(nodes);
    const root = prefer.find((p) => allow.has(p)) ?? nodes[0]!;
    const inTree = new Set<number>([root]);
    const raise = (hub: number): boolean => {
      let guard = 0;
      while ((edgeDegree.get(hub) ?? 0) < 2 && guard++ < 4) {
        const opts = shuffle(
          gridNeighbors(hub).filter((j) => allow.has(j) && !inTree.has(j)),
          rng,
        );
        if (opts.length === 0) return false;
        connect(hub, opts[0]!);
        inTree.add(opts[0]!);
      }
      return (edgeDegree.get(hub) ?? 0) >= 2;
    };
    if (prefer.includes(root) && !raise(root)) return false;
    let safety = 0;
    while (inTree.size < nodes.length && safety++ < 400) {
      const needy = prefer.find((h) => allow.has(h) && inTree.has(h) && (edgeDegree.get(h) ?? 0) < 2);
      if (needy != null) {
        if (!raise(needy)) return false;
        continue;
      }
      const options: [number, number][] = [];
      for (const i of inTree) {
        for (const j of gridNeighbors(i)) {
          if (!allow.has(j) || inTree.has(j)) continue;
          options.push([i, j]);
        }
      }
      if (options.length === 0) return false;
      const pick = options[Math.floor(rng() * options.length)]!;
      connect(pick[0], pick[1]);
      inTree.add(pick[1]);
      if (prefer.includes(pick[1]) && (edgeDegree.get(pick[1]) ?? 0) < 2 && !raise(pick[1])) return false;
    }
    return inTree.size === nodes.length && prefer.every((h) => !allow.has(h) || (edgeDegree.get(h) ?? 0) >= 2);
  };
  if (!grow(outside, [start, gauntlet]) || !grow(locked, [])) return null;

  const bridgeOpts: [number, number][] = [];
  for (const i of locked) {
    for (const j of gridNeighbors(i)) {
      if (!lockedSet.has(j)) bridgeOpts.push([i, j]);
    }
  }
  if (bridgeOpts.length === 0) return null;
  const bridge = bridgeOpts[Math.floor(rng() * bridgeOpts.length)]!;
  connect(bridge[0], bridge[1]);
  const lockedBridge = edgeKey(bridge[0], bridge[1]);

  const roles = new Map<number, Placed["role"]>();
  roles.set(start, "start");
  roles.set(gauntlet, "gauntlet");
  for (const i of locked) roles.set(i, "locked");
  const pool = shuffle(
    outside.filter((i) => i !== start && i !== gauntlet),
    rng,
  );
  const graveCount = Math.min(2, pool.length);
  for (let i = 0; i < graveCount; i++) roles.set(pool[i]!, "grave");
  const treasureCount = Math.min(rollInt(rng, 2, 4), pool.length - graveCount);
  for (let i = 0; i < treasureCount; i++) roles.set(pool[graveCount + i]!, "treasure");
  for (let i = 0; i < n; i++) if (!roles.has(i)) roles.set(i, "normal");

  const laid = layoutRooms(rng, edges, lockedBridge, lockedSet, start, gauntlet, fancyIndex, roles);
  if (!laid) return null;
  const placed = laid.placed;
  const links = laid.links;

  let maxX = 0;
  let maxY = 0;
  for (const room of placed) {
    for (const c of room.cells) {
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    }
  }
  const width = maxX + 2;
  const height = maxY + 2;
  const tiles: TileKind[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => "wall" as TileKind),
  );
  const roomIds: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => -1),
  );
  for (const room of placed) {
    for (const c of room.cells) {
      if (c.code === "#") continue;
      tiles[c.y]![c.x] = "floor";
      roomIds[c.y]![c.x] = room.index;
    }
  }

  const roomByIndex = new Map(placed.map((r) => [r.index, r]));
  let corridorId = n;
  const lockedDoors: Point[] = [];

  for (const link of links) {
    const between = cellsBetween(link.doorA, link.doorB);
    if (!between || between.length === 0) return null;
    const doorCode = (p: Point): CellCode | null => {
      for (const room of placed) {
        const cell = room.cells.find((c) => c.x === p.x && c.y === p.y);
        if (cell) return cell.code;
      }
      return null;
    };
    if (doorCode(link.doorA) !== "e" || doorCode(link.doorB) !== "e") return null;
    const path: Point[] = [];
    for (const c of between) {
      if (c.y < 0 || c.x < 0 || c.y >= height || c.x >= width) return null;
      if (tiles[c.y]![c.x] !== "wall") return null;
      tiles[c.y]![c.x] = "floor";
      roomIds[c.y]![c.x] = corridorId;
      path.push(c);
    }
    if (link.locked && path.length > 0) lockedDoors.push(path[Math.floor(path.length / 2)]!);
    corridorId++;
  }

  const startRoom = roomByIndex.get(start)!;
  const startFloors = startRoom.cells.filter((c) => c.code === "." || c.code === "e");
  if (startFloors.length === 0) return null;
  const prefer = startFloors.filter((c) => c.code === ".");
  const playerStart = (prefer.length > 0 ? prefer : startFloors)[
    Math.floor(rng() * (prefer.length > 0 ? prefer.length : startFloors.length))
  ]!;

  const seen = new Set<string>([key(playerStart.x, playerStart.y)]);
  const queue: Point[] = [{ x: playerStart.x, y: playerStart.y }];
  let floors = 0;
  for (const row of tiles) for (const t of row) if (t === "floor") floors++;
  while (queue.length) {
    const p = queue.pop()!;
    for (const o of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const nx = p.x + o.x;
      const ny = p.y + o.y;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (tiles[ny]![nx] !== "floor") continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  if (seen.size !== floors) return null;

  let tombSerial = 0;
  const nextTomb = () => `tomb_${tombSerial++}`;
  const tombs: TombInstance[] = [];
  for (const room of placed) {
    const local = room.cells.map((c) => ({
      x: c.x - room.origin.x,
      y: c.y - room.origin.y,
      code: c.code,
    }));
    for (const tomb of [
      ...pairBlockers(local, "t", false, nextTomb),
      ...pairBlockers(local, "g", true, nextTomb),
    ]) {
      tombs.push({
        ...tomb,
        x: tomb.x + room.origin.x,
        y: tomb.y + room.origin.y,
      });
    }
  }
  const tombKeys = new Set<string>();
  const markedTombs = new Set<string>();
  for (const room of placed) {
    for (const c of room.cells) {
      if (c.code === "t" || c.code === "g") markedTombs.add(key(c.x, c.y));
    }
  }
  for (const t of tombs) {
    for (let y = t.y; y < t.y + t.h; y++) {
      for (let x = t.x; x < t.x + t.w; x++) tombKeys.add(key(x, y));
    }
  }
  if (tombKeys.size !== markedTombs.size) return null;
  for (const k of tombKeys) if (!markedTombs.has(k)) return null;

  const gauntletRoom = roomByIndex.get(gauntlet)!;
  const stairOpts = gauntletRoom.cells.filter(
    (c) => c.code === "." && !tombKeys.has(key(c.x, c.y)),
  );
  const stairPool = stairOpts.length > 0 ? stairOpts : gauntletRoom.cells.filter((c) => c.code !== "#" && c.code !== "t" && c.code !== "g");
  if (stairPool.length === 0) return null;
  const catacombStair = stairPool[Math.floor(rng() * stairPool.length)]!;

  const pots: { x: number; y: number; magic: boolean; golden: boolean }[] = [];
  const chests: Point[] = [];
  const occupied = new Set<string>([key(playerStart.x, playerStart.y), key(catacombStair.x, catacombStair.y)]);
  for (const k of tombKeys) occupied.add(k);

  const take = (p: Point) => {
    const k = key(p.x, p.y);
    if (occupied.has(k)) return false;
    occupied.add(k);
    return true;
  };

  for (const room of placed) {
    const noPots = rng() < 0.1;
    const rich = room.role === "treasure" || (room.role === "locked" && !room.fancy);
    const chestCap = room.role === "treasure" || room.role === "locked" ? 2 : Number.POSITIVE_INFINITY;
    let roomChests = 0;
    const addChest = (p: Point): boolean => {
      if (roomChests >= chestCap || !take(p)) return false;
      chests.push({ x: p.x, y: p.y });
      roomChests++;
      return true;
    };
    const addPot = (p: Point) => {
      if (noPots || !take(p)) return;
      let magic = false;
      let golden = false;
      if (room.role === "locked") {
        const roll = rng();
        if (roll < 0.8) golden = true;
        else if (roll < 0.9) magic = true;
      } else if (rng() < MAGIC_POT_CHANCE) {
        if (rng() < 0.5) magic = true;
        else golden = true;
      }
      pots.push({ x: p.x, y: p.y, magic, golden });
    };
    for (const c of room.cells) {
      if (c.code === "c") addChest(c);
    }
    if (room.scatter) {
      for (const c of room.cells) {
        if (c.code !== "." && c.code !== "p") continue;
        if (rich && rng() < 0.18 && addChest(c)) continue;
        if (rng() < 0.28) addPot(c);
      }
    } else {
      for (const c of room.cells) {
        if (c.code !== "p") continue;
        if (rich && rng() < 0.5 && addChest(c)) continue;
        if (rng() < 0.75) addPot(c);
      }
    }
    if (room.role === "locked" && !room.fancy && roomChests < chestCap) {
      const free = room.cells.filter((c) => (c.code === "." || c.code === "p") && !occupied.has(key(c.x, c.y)));
      if (free.length > 0 && rng() < 0.85) {
        const spot = free[Math.floor(rng() * free.length)]!;
        addChest(spot);
      }
    }
  }

  const bonelings: Point[] = [];
  const skeletons: Point[] = [];
  const elites: Point[] = [];
  const gravePiles: Point[] = [];
  const coins: Point[] = [];
  const cards: Point[] = [];
  const trinkets: { x: number; y: number; trinket: TrinketId }[] = [];
  const gems: Point[] = [];
  const keys: Point[] = [];
  const trinketIds: TrinketId[] = ["throwing_knife", "healing_pendant", "shielding_ring"];
  const freeOf = (room: Placed) =>
    room.cells.filter((c) => c.code !== "#" && c.code !== "e" && !occupied.has(key(c.x, c.y)));

  for (const room of placed) {
    const free = shuffle(freeOf(room), rng);
    let cursor = 0;
    const claim = (): Point | null => {
      while (cursor < free.length) {
        const p = free[cursor++]!;
        if (take(p)) return p;
      }
      return null;
    };
    const claimN = (n: number, into: Point[]) => {
      for (let i = 0; i < n; i++) {
        const p = claim();
        if (p) into.push(p);
      }
    };
    if (room.role === "grave") {
      const pile = claim();
      if (pile) gravePiles.push(pile);
      claimN(rollInt(rng, 7, 10), bonelings);
      claimN(2, skeletons);
    } else {
      claimN(rollInt(rng, 3, 5), bonelings);
      if (room.role === "gauntlet") claimN(1, skeletons);
    }
    if (room.role === "treasure" || room.role === "locked") {
      claimN(1, elites);
      claimN(3, coins);
      claimN(room.role === "locked" ? 4 : 2, cards);
      claimN(room.role === "locked" ? 2 : 1, gems);
      const trinketSpot = claim();
      if (trinketSpot) {
        trinkets.push({
          x: trinketSpot.x,
          y: trinketSpot.y,
          trinket: trinketIds[Math.floor(rng() * trinketIds.length)]!,
        });
      }
    }
  }

  const keyRooms = placed.filter((room) => room.role !== "locked" && room.role !== "start");
  const keyPool = shuffle(
    keyRooms.flatMap((room) =>
      room.cells.filter((c) => c.code !== "#" && c.code !== "e" && !occupied.has(key(c.x, c.y))),
    ),
    rng,
  );
  for (const p of keyPool) {
    if (keys.length >= 2) break;
    if (take(p)) keys.push({ x: p.x, y: p.y });
  }

  const roomKinds: RoomKind[] = [];
  for (let i = 0; i < corridorId; i++) {
    if (i >= n) {
      roomKinds.push("corridor");
      continue;
    }
    const role = roles.get(i);
    if (role === "start") roomKinds.push("entrance");
    else if (role === "treasure" || role === "locked") roomKinds.push("treasure");
    else roomKinds.push("normal");
  }

  const goldWalls: Point[] = [];
  const fancyRoom = placed.find((r) => r.fancy);
  if (fancyRoom) {
    const seen = new Set<string>();
    const addWall = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      if (tiles[y]![x] !== "wall") return;
      const k = key(x, y);
      if (seen.has(k)) return;
      seen.add(k);
      goldWalls.push({ x, y });
    };
    for (const c of fancyRoom.cells) {
      if (c.code === "#") addWall(c.x, c.y);
      else {
        for (const o of ORTHO) addWall(c.x + o.x, c.y + o.y);
      }
    }
  }

  const summary = [
    `Catacombs test: ${COLS}×${ROWS} rooms.`,
    `${locked.length} locked (fancy room included), bridge sealed.`,
    `${graveCount} grave rooms, ${treasureCount} treasure rooms.`,
    "Staircase marks the Gauntlet descent (chamber not linked yet).",
  ].join(" ");

  return {
    id: `catacombs_${Math.floor(rng() * 1e9)}`,
    width,
    height,
    tiles,
    roomIds,
    roomKinds,
    playerStart: { x: playerStart.x, y: playerStart.y },
    tombs,
    lockedDoors,
    catacombStair: { x: catacombStair.x, y: catacombStair.y },
    pots,
    chests,
    bonelings,
    skeletons,
    elites,
    gravePiles,
    coins,
    cards,
    trinkets,
    gems,
    keys,
    goldWalls,
    summary,
  };
}

export function generateCatacombs(seed?: number): CatacombLayout {
  let s = seed ?? Math.floor(Math.random() * 0x7fffffff);
  for (let attempt = 0; attempt < 200; attempt++) {
    const layout = tryBuild(mulberry32(s));
    if (layout) return layout;
    s = (s + 9973) | 0;
  }
  throw new Error("generateCatacombs: failed after retries");
}
