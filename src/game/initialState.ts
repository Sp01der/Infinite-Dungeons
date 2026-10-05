import type {
  CardDef,
  ChestInstance,
  FloorDef,
  FloorTheme,
  GameState,
  GroundLootInstance,
  MonsterDef,
  MonsterInstance,
  Point,
  PotInstance,
  RoomKind,
  TileKind,
} from "./types";
import { rollInt } from "../engine/combat";
import { addRoomsToDiscovered, collectRoomIdsAdjacentToPlayer } from "../engine/discovery";
import { generateFloor } from "../engine/floorGen";
import { generateCatacombs } from "../engine/catacombsGen";
import { keyOf, parseFloor } from "../engine/grid";
import { buildFreshDungeonDeck } from "./dungeonDeck";
import { loadCardDefs, loadDungeonCardDefs, loadMonsterDefs } from "./loadContent";
import {
  bonelingLeaderForRoom,
  createMonsterInstance,
  withBonelingLeaderFlag,
} from "./monsterSpawn";
import { rollGroundLootPiece } from "./loot";

const ORTHO_NEIGHBORS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function shuffleInPlace<T>(xs: T[]): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
}

const GOLD_SEEKER_SKILL = "mob_gold_seeker";

/** +1 ground gold on each new floor (Gold Seeker). */
function appendGoldSeekerIfSkill(
  prev: GameState,
  groundLoot: GroundLootInstance[],
  tiles: TileKind[][],
  roomIds: number[][],
  roomKinds: RoomKind[],
  width: number,
  height: number,
  playerStart: Point,
  pots: PotInstance[],
  chests: ChestInstance[],
  depth: number,
): GroundLootInstance[] {
  if (!prev.player.skillsUnlocked.includes(GOLD_SEEKER_SKILL)) return groundLoot;
  const blocked = new Set<string>();
  for (const g of groundLoot) blocked.add(keyOf(g));
  blocked.add(keyOf(playerStart));
  for (const p of pots) blocked.add(keyOf(p));
  for (const c of chests) blocked.add(keyOf(c));
  const candidates: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] !== "floor") continue;
      const rid = roomIds[y][x];
      if (rid < 0) continue;
      const rk = roomKinds[rid];
      if (rk === "gauntlet" || rk === "gauntlet_corridor") continue;
      const pt: Point = { x, y };
      if (blocked.has(keyOf(pt))) continue;
      candidates.push(pt);
    }
  }
  if (candidates.length === 0) return groundLoot;
  shuffleInPlace(candidates);
  const p = candidates[0]!;
  const id = `gloot_gs_${depth}_${groundLoot.length}`;
  return [...groundLoot, { id, x: p.x, y: p.y, kind: "coin", amount: 1 }];
}

/** Gold Seeker: place one coin on the current floor (e.g. right after unlocking the skill). */
export function appendGoldSeekerBonusCoin(s: GameState): GameState {
  if (!s.player.skillsUnlocked.includes(GOLD_SEEKER_SKILL)) return s;
  const groundLoot = appendGoldSeekerIfSkill(
    s,
    s.groundLoot,
    s.tiles,
    s.roomIds,
    s.roomKinds,
    s.width,
    s.height,
    { x: s.player.x, y: s.player.y },
    s.pots,
    s.chests,
    s.depth,
  );
  return { ...s, groundLoot };
}

const STARTER_COMMONS = ["spear", "knife", "axe", "quickstep"] as const;

export function buildStartingDeck(): string[] {
  const pool = [...STARTER_COMMONS];
  shuffleInPlace(pool);
  const pickA = pool[0]!;
  const pickB = pool.find((c) => c !== pickA) ?? pool[1]!;

  const deck: string[] = [];
  for (let i = 0; i < 4; i++) deck.push("move");
  for (let i = 0; i < 3; i++) deck.push("copper_sword");
  deck.push(pickA, pickB);
  shuffleInPlace(deck);
  return deck;
}


function defaultRoomIdsForJsonFloor(tiles: TileKind[][]): number[][] {
  return tiles.map((row) => row.map((t) => (t === "floor" ? 0 : -1)));
}

function countMonstersInRoom(monsters: MonsterInstance[], roomIds: number[][], rid: number): number {
  let n = 0;
  for (const m of monsters) {
    if (m.hp <= 0) continue;
    if (roomIds[m.y]?.[m.x] === rid) n++;
  }
  return n;
}

/** Higher `power` monsters get lower weight (less likely). */
export function pickWeightedDefId(
  candidates: string[],
  monsterDefs: Map<string, MonsterDef>,
): string {
  if (candidates.length === 0) return "slime";
  if (candidates.length === 1) return candidates[0]!;
  let wsum = 0;
  const weights: number[] = [];
  for (const id of candidates) {
    const pow = monsterDefs.get(id)?.power ?? 3;
    const w = 1 / pow;
    weights.push(w);
    wsum += w;
  }
  let r = Math.random() * wsum;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

export function themeDisplayName(theme: FloorTheme): string {
  switch (theme) {
    case "overgrown":
      return "Overgrown";
    case "damp":
      return "Damp";
    case "brownstone":
      return "Brownstone Tunnels";
    case "catacombs":
      return "Catacombs";
    default:
      return "Normal";
  }
}

export function pickFloorTheme(
  history: Partial<Record<FloorTheme, number>>,
  depth: number,
): FloorTheme {
  if (depth > 5) return "normal";
  const themes: FloorTheme[] = ["normal", "overgrown", "damp", "brownstone"];
  const baseWeights: Record<FloorTheme, number> = {
    normal: 1.5,
    overgrown: 1.0,
    damp: 1.0,
    brownstone: 1.0,
    catacombs: 0,
  };
  const weights = themes.map((t) => Math.max(0.1, baseWeights[t] - (history[t] ?? 0) * 0.2));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < themes.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return themes[i]!;
  }
  return themes[themes.length - 1]!;
}

function bumpThemeHistory(
  h: Partial<Record<FloorTheme, number>>,
  t: FloorTheme,
): Partial<Record<FloorTheme, number>> {
  return { ...h, [t]: (h[t] ?? 0) + 1 };
}

export function pickMonsterId(
  kind: RoomKind,
  monsterDefs: Map<string, MonsterDef>,
  floorDepth: number,
  floorTheme: FloorTheme,
): string {
  if (floorDepth >= 4 && (kind === "normal" || kind === "treasure") && Math.random() < 0.035) {
    return "mimic";
  }
  const rat = floorDepth >= 5 ? "shadow_rodent" : "dune_rat";
  const ratOrVine = floorTheme === "overgrown" ? "vineshon" : rat;
  switch (kind) {
    case "entrance":
      return "slime";
    case "corridor": {
      const pool: string[] =
        floorDepth >= 2 ? ["slime", ratOrVine, "skeleton_archer"] : ["slime", ratOrVine];
      if (floorDepth >= 5) pool.push("elite_skeleton");
      if (floorTheme === "brownstone") pool.push("beetle");
      return pickWeightedDefId(pool, monsterDefs);
    }
    case "normal": {
      const pool = ["slime", ratOrVine, "skeleton", "mystic_core", "rockling"];
      if (floorDepth >= 2) pool.push("skeleton_archer");
      if (floorDepth >= 5) pool.push("elite_skeleton");
      if (floorTheme === "brownstone") pool.push("beetle");
      if (floorTheme === "overgrown" && Math.random() < 0.08) return "tangleweed_bloom";
      return pickWeightedDefId(pool, monsterDefs);
    }
    case "treasure": {
      const pool = ["skeleton", "mystic_core", "rockling", "slime", ratOrVine];
      if (floorDepth >= 2) pool.push("skeleton_archer");
      if (floorDepth >= 5) pool.push("elite_skeleton");
      if (floorTheme === "brownstone") pool.push("beetle");
      return pickWeightedDefId(pool, monsterDefs);
    }
    case "greenhouse":
      return Math.random() < 0.35 ? "tangleweed_bloom" : "vineshon";
    case "gauntlet": {
      const pool = ["skeleton", "mystic_core", "slime", ratOrVine, "rockling"];
      if (floorDepth >= 2) pool.push("skeleton_archer");
      if (floorDepth >= 5) pool.push("elite_skeleton");
      return pickWeightedDefId(pool, monsterDefs);
    }
    default:
      return "slime";
  }
}

function placePropsByRoom(
  tiles: TileKind[][],
  roomIds: number[][],
  roomKinds: RoomKind[],
  width: number,
  height: number,
  playerStart: Point,
  monsterDefs: Map<string, MonsterDef>,
  dangerLevel: number,
  floorDepth: number,
  floorTheme: FloorTheme,
  testBonelingSpawns = false,
): { monsters: MonsterInstance[]; pots: PotInstance[]; chests: ChestInstance[] } {
  const cellsByRoom = new Map<number, Point[]>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] !== "floor") continue;
      if (x === playerStart.x && y === playerStart.y) continue;
      const rid = roomIds[y][x];
      if (rid < 0) continue;
      if (!cellsByRoom.has(rid)) cellsByRoom.set(rid, []);
      cellsByRoom.get(rid)!.push({ x, y });
    }
  }

  const monsters: MonsterInstance[] = [];
  const pots: PotInstance[] = [];
  const chests: ChestInstance[] = [];
  let mi = 0;
  let pi = 0;
  let ci = 0;

  const pushMonster = (p: Point, defId: string) => {
    monsters.push(
      createMonsterInstance(`monster_${mi++}`, defId, p.x, p.y, monsterDefs, dangerLevel),
    );
  };
  const pushBoneling = (p: Point) => {
    const leader = bonelingLeaderForRoom(monsters, roomIds, p.x, p.y);
    monsters.push(
      withBonelingLeaderFlag(
        createMonsterInstance(`monster_${mi++}`, "boneling", p.x, p.y, monsterDefs, dangerLevel),
        leader,
      ),
    );
  };
  const pickId = (k: RoomKind) => pickMonsterId(k, monsterDefs, floorDepth, floorTheme);
  const pushPot = (p: Point) => {
    const magic = floorDepth >= 3 && Math.random() < 0.05;
    pots.push({ id: `pot_${pi++}`, x: p.x, y: p.y, magic: magic || undefined });
  };

  for (const [rid, cells] of cellsByRoom) {
    if (cells.length === 0) continue;
    shuffleInPlace(cells);
    const kind = roomKinds[rid] ?? "normal";
    let idx = 0;
    const take = (n: number): Point[] => {
      const out = cells.slice(idx, idx + n);
      idx += n;
      return out;
    };

    switch (kind) {
      case "entrance": {
        const n = rollInt(0, 2);
        for (const p of take(n)) pushPot(p);
        break;
      }
      case "corridor": {
        const nPot = rollInt(0, 1);
        for (const p of take(nPot)) pushPot(p);
        if (testBonelingSpawns) {
          if (cells.length - idx >= 3 && Math.random() < 0.45) {
            const n = Math.min(rollInt(3, 5), cells.length - idx);
            for (const p of take(n)) pushBoneling(p);
          }
        } else if (cells.length - idx > 0 && Math.random() < 0.38) {
          const [p] = take(1);
          if (p) pushMonster(p, pickId("corridor"));
        }
        break;
      }
      case "gauntlet_corridor":
        // Intentional empty lead-in corridor to the gauntlet.
        break;
      case "normal": {
        const nPot = rollInt(1, 3);
        for (const p of take(nPot)) pushPot(p);
        if (testBonelingSpawns) {
          const n = Math.min(rollInt(3, 5), Math.max(0, cells.length - idx));
          for (const p of take(n)) pushBoneling(p);
        } else {
          const nMon = Math.random() < 0.68 ? 1 : 2;
          for (let k = 0; k < nMon; k++) {
            const [p] = take(1);
            if (p) pushMonster(p, pickId("normal"));
          }
        }
        break;
      }
      case "treasure": {
        const nPot = rollInt(0, 2);
        for (const p of take(nPot)) pushPot(p);
        if (testBonelingSpawns) {
          const n = Math.min(rollInt(3, 5), Math.max(0, cells.length - idx));
          for (const p of take(n)) pushBoneling(p);
        } else {
          const nMon = Math.random() < 0.65 ? 1 : 2;
          for (let k = 0; k < nMon; k++) {
            const [p] = take(1);
            if (p) pushMonster(p, pickId("treasure"));
          }
        }
        break;
      }
      case "gauntlet":
        // Populated when the player first enters the gauntlet.
        break;
      case "greenhouse": {
        // Only blooms / Vineshons — no pots. Ground loot is always Healing Herb.
        const nMon = rollInt(1, 2);
        for (let k = 0; k < nMon; k++) {
          const [p] = take(1);
          if (p) pushMonster(p, pickId("greenhouse"));
        }
        break;
      }
      default:
        break;
    }
  }

  const occ = new Set<string>();
  occ.add(keyOf(playerStart));
  for (const m of monsters) occ.add(keyOf(m));
  for (const p of pots) occ.add(keyOf(p));

  for (const [rid, cells] of cellsByRoom) {
    const kind = roomKinds[rid] ?? "normal";
    if (kind === "gauntlet" || kind === "gauntlet_corridor") continue;
    const nMon = countMonstersInRoom(monsters, roomIds, rid);

    if (kind === "treasure") {
      const free = cells.filter((c) => !occ.has(keyOf(c)));
      if (free.length > 0) {
        shuffleInPlace(free);
        const p = free[0]!;
        chests.push({ id: `chest_${ci++}`, x: p.x, y: p.y, tier: 2 });
        occ.add(keyOf(p));
      }
    }

    if (nMon >= 2 && Math.random() < 0.12) {
      const free = cells.filter((c) => !occ.has(keyOf(c)));
      if (free.length > 0) {
        shuffleInPlace(free);
        const p = free[0]!;
        chests.push({ id: `chest_${ci++}`, x: p.x, y: p.y, tier: 1 });
        occ.add(keyOf(p));
      }
    }
  }

  if (floorDepth >= 4 && Math.random() < 0.04) {
    const pairId = `douvlon_${mi}_${Math.floor(Math.random() * 1e9)}`;
    outer: for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (tiles[y][x] !== "floor") continue;
        const rid = roomIds[y][x];
        if (rid < 0) continue;
        const rk = roomKinds[rid];
        if (rk === "gauntlet" || rk === "gauntlet_corridor") continue;
        for (const o of ORTHO_NEIGHBORS) {
          const x2 = x + o.x;
          const y2 = y + o.y;
          if (x2 < 0 || y2 < 0 || x2 >= width || y2 >= height) continue;
          if (tiles[y2][x2] !== "floor") continue;
          const k1 = keyOf({ x, y });
          const k2 = keyOf({ x: x2, y: y2 });
          if (occ.has(k1) || occ.has(k2)) continue;
          monsters.push(
            createMonsterInstance(`monster_${mi++}`, "douvlon", x, y, monsterDefs, dangerLevel, {
              douvlonColor: "red",
              douvlonPairId: pairId,
            }),
          );
          monsters.push(
            createMonsterInstance(`monster_${mi++}`, "douvlon", x2, y2, monsterDefs, dangerLevel, {
              douvlonColor: "blue",
              douvlonPairId: pairId,
            }),
          );
          occ.add(k1);
          occ.add(k2);
          break outer;
        }
      }
    }
  }

  if (floorTheme === "damp") {
    const waterByRoom = new Map<number, Point[]>();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (tiles[y][x] !== "water") continue;
        const rid = roomIds[y][x];
        if (rid < 0) continue;
        if (!waterByRoom.has(rid)) waterByRoom.set(rid, []);
        waterByRoom.get(rid)!.push({ x, y });
      }
    }
    for (const [, ws] of waterByRoom) {
      if (ws.length === 0 || Math.random() >= 0.45) continue;
      shuffleInPlace(ws);
      for (const p of ws) {
        if (occ.has(keyOf(p))) continue;
        pushMonster(p, "drosir");
        occ.add(keyOf(p));
        break;
      }
    }
  }

  return { monsters, pots, chests };
}

/** ~65% per room: 1–2 small drops; monsters may stand on loot tiles. */
function spawnGroundLoot(
  tiles: TileKind[][],
  roomIds: number[][],
  roomKinds: RoomKind[],
  width: number,
  height: number,
  playerStart: Point,
  pots: PotInstance[],
  chests: ChestInstance[],
  cardDefs: Map<string, CardDef>,
  floorDepth: number,
): GroundLootInstance[] {
  const cellsByRoom = new Map<number, Point[]>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] !== "floor") continue;
      const rid = roomIds[y][x];
      if (rid < 0) continue;
      if (!cellsByRoom.has(rid)) cellsByRoom.set(rid, []);
      cellsByRoom.get(rid)!.push({ x, y });
    }
  }

  const blocked = new Set<string>();
  blocked.add(keyOf(playerStart));
  for (const p of pots) blocked.add(keyOf(p));
  for (const c of chests) blocked.add(keyOf(c));

  const out: GroundLootInstance[] = [];
  let li = 0;
  for (const [, cells] of cellsByRoom) {
    if (cells.length === 0) continue;
    const rid = roomIds[cells[0]!.y]?.[cells[0]!.x] ?? -1;
    if (rid >= 0 && (roomKinds[rid] === "gauntlet_corridor" || roomKinds[rid] === "gauntlet")) continue;
    if (Math.random() >= 0.65) continue;
    const candidates = cells.filter((c) => !blocked.has(keyOf(c)));
    if (candidates.length === 0) continue;
    shuffleInPlace(candidates);
    const nDrops = Math.random() < 0.7 ? 1 : 2;
    const rk = rid >= 0 ? roomKinds[rid] : "normal";
    for (let k = 0; k < nDrops && k < candidates.length; k++) {
      const p = candidates[k]!;
      if (rk === "greenhouse") {
        out.push({ id: `gloot_${li++}`, x: p.x, y: p.y, kind: "herb" });
        continue;
      }
      const piece = rollGroundLootPiece(cardDefs, floorDepth);
      if (piece.kind === "coin") {
        out.push({ id: `gloot_${li++}`, x: p.x, y: p.y, kind: "coin", amount: piece.amount });
      } else if (piece.kind === "bread") {
        out.push({ id: `gloot_${li++}`, x: p.x, y: p.y, kind: "bread" });
      } else if (piece.kind === "herb") {
        out.push({ id: `gloot_${li++}`, x: p.x, y: p.y, kind: "herb" });
      } else if (piece.kind === "cheese") {
        out.push({ id: `gloot_${li++}`, x: p.x, y: p.y, kind: "cheese" });
      } else if (piece.kind === "gem") {
        out.push({
          id: `gloot_${li++}`,
          x: p.x,
          y: p.y,
          kind: "gem",
          gemId: piece.gemId,
        });
      } else {
        out.push({ id: `gloot_${li++}`, x: p.x, y: p.y, kind: "card", cardId: piece.cardId });
      }
    }
  }
  return out;
}

function buildDiscovered(
  fogOfWar: boolean,
  tiles: TileKind[][],
  roomIds: number[][],
  width: number,
  height: number,
  playerStart: Point,
): Set<string> {
  const discovered = new Set<string>();
  if (!fogOfWar) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (tiles[y][x] === "floor" || tiles[y][x] === "water") discovered.add(keyOf({ x, y }));
      }
    }
    return discovered;
  }

  const rooms = collectRoomIdsAdjacentToPlayer({
    width,
    height,
    tiles,
    roomIds,
    player: playerStart,
  });
  if (rooms.size === 0) {
    discovered.add(keyOf(playerStart));
    return discovered;
  }
  addRoomsToDiscovered(discovered, tiles, roomIds, width, height, rooms);
  return discovered;
}

/** Hand-authored floor from JSON (`rows`, optional `fogOfWar`). */
export function createInitialState(floorDef: FloorDef): GameState {
  const monsterDefs = loadMonsterDefs();
  const { width, height, tiles, playerStart } = parseFloor(floorDef);
  const fogOfWar = floorDef.fogOfWar === true;
  const roomIds = defaultRoomIdsForJsonFloor(tiles);
  const roomKinds: RoomKind[] = ["entrance"];
  const discovered = buildDiscovered(fogOfWar, tiles, roomIds, width, height, playerStart);
  const { monsters, pots, chests } = placePropsByRoom(
    tiles,
    roomIds,
    roomKinds,
    width,
    height,
    playerStart,
    monsterDefs,
    1,
    1,
    "normal",
    false,
  );
  const cardDefs = loadCardDefs();
  const groundLoot = spawnGroundLoot(
    tiles,
    roomIds,
    roomKinds,
    width,
    height,
    playerStart,
    pots,
    chests,
    cardDefs,
    1,
  );

  return {
    phase: "player",
    floorId: floorDef.id,
    floorName: floorDef.name,
    floorTheme: "normal",
    width,
    height,
    tiles,
    fogOfWar,
    discovered,
    player: {
      x: playerStart.x,
      y: playerStart.y,
      hp: 10,
      maxHp: 10,
      gold: 0,
      bread: 0,
      herb: 0,
      cheese: 0,
      stew: 0,
      flameOfDestruction: 0,
      unboundTomes: 0,
      boundTomes: [],
      gems: { strength: 0, speed: 0, luck: 0, cards: 0, healing: 0, defense: 0 },
      nextPhysicalAttackMultiplier: 1,
      nextMoveDoubled: false,
      gemLuckRestore: null,
      drawPile: buildStartingDeck(),
      discardPile: [],
      hand: [],
      equipped: null,
      defenseBonusThisTurn: 0,
      defenseUntilHit: 0,
      doublePunchThisTurn: false,
      level: 1,
      exp: 0,
      skillPoints: 0,
      skillsUnlocked: [],
      moveTokens: 0,
      knockbackTokens: 0,
      knockbackPrimed: 0,
      movementCardsPlayedThisTurn: 0,
      scoutUsesThisTurn: 0,
      hasteThisTurn: false,
      arcaneChargeActive: false,
      resistance: 0,
      fortifyThisTurn: false,
      cardsPlayedThisTurn: 0,
      noMoreCardsThisTurn: false,
      guardDestroyerTargetId: null,
      guardDestroyerStacks: 0,
      damageTakenThisTurn: 0,
      knockbackedMonsterIdsThisTurn: [],
      fireLevels: 0,
    },
    depth: 1,
    danger: 1,
    noise: 0,
    monsters,
    pots,
    chests,
    rocks: [],
    groundLoot,
    bridgeTiles: [],
    floodingRoomId: null,
    pendingStalactites: [],
    harmingClouds: [],
    tangleweeds: [],
    bonePiles: [],
    tombs: [],
    lockedDoors: [],
    catacombStair: null,
    themePickHistory: {},
    roomIds,
    roomKinds,
    dungeonDraw: buildFreshDungeonDeck(1, "normal"),
    dungeonDiscard: [],
    cardDefs,
    monsterDefs,
    dungeonCardDefs: loadDungeonCardDefs(),
    pending: null,
    dualWieldStage: null,
    senseiOffer: null,
    chestOffer: null,
    cardPickupOffer: null,
    deckBuilderOffer: null,
    gauntletCommenced: false,
    stairFeatures: null,
    shiftyMet: false,
    obamlyMet: false,
    obamlyRestockKeys: [],
    sennisMet: false,
    sennisTomeExplained: false,
    senseiMet: false,
    merchantState: null,
    pedestalUsed: false,
    pedestalOffer: null,
    deckDestroyPending: false,
    flameDestroyPending: false,
    bindTomePending: false,
    tomeCast: null,
    stabilityBuffActive: false,
    scoutBlockedThisTurn: false,
    dungeonCardReveal: null,
    pendingCollapse: null,
    pendingTargetedCollapse: null,
    lightsOutTurns: 0,
    chanceMode: "normal",
    chancePlayerOnly: false,
    editorMode: false,
    editorModeBackup: null,
    testBonelingSpawns: false,
    log: [
      "Welcome to the dungeon.",
      `${monsters.length} monster(s), ${pots.length} pot(s), ${chests.length} chest(s), ${groundLoot.length} ground loot spot(s).`,
    ],
    turn: 0,
  };
}

/** Procedurally generated multi-room floor (fog on by default). */
export function createInitialStateGenerated(depth = 1): GameState {
  const theme = pickFloorTheme({}, depth);
  const gen = generateFloor({ depth, theme });
  const monsterDefs = loadMonsterDefs();
  const { width, height, tiles, playerStart, roomIds, roomKinds } = gen;
  const fogOfWar = true;
  const discovered = buildDiscovered(fogOfWar, tiles, roomIds, width, height, playerStart);
  const { monsters, pots, chests } = placePropsByRoom(
    tiles,
    roomIds,
    roomKinds,
    width,
    height,
    playerStart,
    monsterDefs,
    gen.spawnDanger,
    1,
    gen.floorTheme,
    false,
  );
  const cardDefs = loadCardDefs();
  const groundLoot = spawnGroundLoot(
    tiles,
    roomIds,
    roomKinds,
    width,
    height,
    playerStart,
    pots,
    chests,
    cardDefs,
    1,
  );

  return {
    phase: "player",
    floorId: gen.id,
    floorName: `Floor 1 · ${themeDisplayName(gen.floorTheme)}`,
    floorTheme: gen.floorTheme,
    width,
    height,
    tiles,
    fogOfWar,
    discovered,
    player: {
      x: playerStart.x,
      y: playerStart.y,
      hp: 10,
      maxHp: 10,
      gold: 0,
      bread: 0,
      herb: 0,
      cheese: 0,
      stew: 0,
      flameOfDestruction: 0,
      unboundTomes: 0,
      boundTomes: [],
      gems: { strength: 0, speed: 0, luck: 0, cards: 0, healing: 0, defense: 0 },
      nextPhysicalAttackMultiplier: 1,
      nextMoveDoubled: false,
      gemLuckRestore: null,
      drawPile: buildStartingDeck(),
      discardPile: [],
      hand: [],
      equipped: null,
      defenseBonusThisTurn: 0,
      defenseUntilHit: 0,
      doublePunchThisTurn: false,
      level: 1,
      exp: 0,
      skillPoints: 0,
      skillsUnlocked: [],
      moveTokens: 0,
      knockbackTokens: 0,
      knockbackPrimed: 0,
      movementCardsPlayedThisTurn: 0,
      scoutUsesThisTurn: 0,
      hasteThisTurn: false,
      arcaneChargeActive: false,
      resistance: 0,
      fortifyThisTurn: false,
      cardsPlayedThisTurn: 0,
      noMoreCardsThisTurn: false,
      guardDestroyerTargetId: null,
      guardDestroyerStacks: 0,
      damageTakenThisTurn: 0,
      knockbackedMonsterIdsThisTurn: [],
      fireLevels: 0,
    },
    depth: 1,
    danger: 1,
    noise: 0,
    monsters,
    pots,
    chests,
    rocks: [],
    groundLoot,
    bridgeTiles: [...gen.bridgeTiles],
    floodingRoomId: null,
    pendingStalactites: [],
    harmingClouds: [],
    tangleweeds: [],
    bonePiles: [],
    tombs: [],
    lockedDoors: [],
    catacombStair: null,
    themePickHistory: bumpThemeHistory({}, gen.floorTheme),
    roomIds,
    roomKinds,
    dungeonDraw: buildFreshDungeonDeck(1, gen.floorTheme),
    dungeonDiscard: [],
    cardDefs,
    monsterDefs,
    dungeonCardDefs: loadDungeonCardDefs(),
    pending: null,
    dualWieldStage: null,
    senseiOffer: null,
    chestOffer: null,
    cardPickupOffer: null,
    deckBuilderOffer: null,
    gauntletCommenced: false,
    stairFeatures: null,
    shiftyMet: false,
    obamlyMet: false,
    obamlyRestockKeys: [],
    sennisMet: false,
    sennisTomeExplained: false,
    senseiMet: false,
    merchantState: null,
    pedestalUsed: false,
    pedestalOffer: null,
    deckDestroyPending: false,
    flameDestroyPending: false,
    bindTomePending: false,
    tomeCast: null,
    stabilityBuffActive: false,
    scoutBlockedThisTurn: false,
    dungeonCardReveal: null,
    pendingCollapse: null,
    pendingTargetedCollapse: null,
    lightsOutTurns: 0,
    chanceMode: "normal",
    chancePlayerOnly: false,
    editorMode: false,
    editorModeBackup: null,
    testBonelingSpawns: false,
    log: [
      "Welcome to the dungeon.",
      `Theme: ${themeDisplayName(gen.floorTheme)}.`,
      `${monsters.length} monster(s), ${pots.length} pot(s), ${chests.length} chest(s), ${groundLoot.length} ground loot spot(s).`,
    ],
    turn: 0,
  };
}

/** New procedural floor after descending stairs: keeps player stats & full deck, new layout & props. */
export function createNextFloorState(
  prev: GameState,
  opts?: { depth?: number; theme?: FloorTheme; danger?: number },
): GameState {
  const depth = opts?.depth ?? prev.depth + 1;
  const danger =
    opts?.danger ?? (opts?.depth != null ? Math.max(1, opts.depth) : prev.danger + 1);
  const theme = opts?.theme ?? pickFloorTheme(prev.themePickHistory, depth);
  const gen = generateFloor({ depth, theme });
  const monsterDefs = prev.monsterDefs;
  const { width, height, tiles, playerStart, roomIds, roomKinds } = gen;
  const fogOfWar = !prev.editorMode;
  const discovered = buildDiscovered(true, tiles, roomIds, width, height, playerStart);
  const { monsters, pots, chests } = placePropsByRoom(
    tiles,
    roomIds,
    roomKinds,
    width,
    height,
    playerStart,
    monsterDefs,
    danger,
    depth,
    gen.floorTheme,
    prev.testBonelingSpawns,
  );
  const cardDefs = prev.cardDefs;
  let groundLoot = spawnGroundLoot(
    tiles,
    roomIds,
    roomKinds,
    width,
    height,
    playerStart,
    pots,
    chests,
    cardDefs,
    depth,
  );
  groundLoot = appendGoldSeekerIfSkill(
    prev,
    groundLoot,
    tiles,
    roomIds,
    roomKinds,
    width,
    height,
    playerStart,
    pots,
    chests,
    depth,
  );

  const drawPile = [...prev.player.drawPile, ...prev.player.discardPile, ...prev.player.hand];

  return {
    phase: "player",
    floorId: gen.id,
    floorName: `Floor ${depth} · ${themeDisplayName(gen.floorTheme)}`,
    floorTheme: gen.floorTheme,
    width,
    height,
    tiles,
    fogOfWar,
    discovered,
    player: {
      ...prev.player,
      x: playerStart.x,
      y: playerStart.y,
      drawPile,
      discardPile: [],
      hand: [],
      defenseBonusThisTurn: 0,
      defenseUntilHit: 0,
      doublePunchThisTurn: false,
      moveTokens: 0,
      knockbackTokens: 0,
      knockbackPrimed: 0,
      movementCardsPlayedThisTurn: 0,
      scoutUsesThisTurn: 0,
      hasteThisTurn: false,
      arcaneChargeActive: false,
      resistance: 0,
      fortifyThisTurn: false,
      cardsPlayedThisTurn: 0,
      noMoreCardsThisTurn: false,
      guardDestroyerTargetId: null,
      guardDestroyerStacks: 0,
      damageTakenThisTurn: 0,
      knockbackedMonsterIdsThisTurn: [],
      fireLevels: 0,
      nextPhysicalAttackMultiplier: 1,
      nextMoveDoubled: false,
      gemLuckRestore: null,
    },
    depth,
    danger,
    noise: 0,
    monsters,
    pots,
    chests,
    rocks: [],
    groundLoot,
    bridgeTiles: [...gen.bridgeTiles],
    floodingRoomId: null,
    pendingStalactites: [],
    harmingClouds: [],
    tangleweeds: [],
    bonePiles: [],
    tombs: [],
    lockedDoors: [],
    catacombStair: null,
    themePickHistory: bumpThemeHistory(prev.themePickHistory, gen.floorTheme),
    roomIds,
    roomKinds,
    dungeonDraw: buildFreshDungeonDeck(depth, gen.floorTheme),
    dungeonDiscard: [],
    cardDefs,
    monsterDefs,
    dungeonCardDefs: prev.dungeonCardDefs,
    pending: null,
    dualWieldStage: null,
    senseiOffer: null,
    chestOffer: null,
    cardPickupOffer: null,
    deckBuilderOffer: prev.deckBuilderOffer,
    gauntletCommenced: false,
    stairFeatures: null,
    shiftyMet: prev.shiftyMet,
    obamlyMet: prev.obamlyMet,
    obamlyRestockKeys: prev.obamlyRestockKeys,
    sennisMet: prev.sennisMet,
    sennisTomeExplained: prev.sennisTomeExplained,
    senseiMet: prev.senseiMet,
    merchantState: null,
    pedestalUsed: false,
    pedestalOffer: null,
    deckDestroyPending: false,
    flameDestroyPending: false,
    bindTomePending: false,
    tomeCast: null,
    stabilityBuffActive: false,
    scoutBlockedThisTurn: false,
    dungeonCardReveal: null,
    pendingCollapse: null,
    pendingTargetedCollapse: null,
    lightsOutTurns: 0,
    chanceMode: prev.chanceMode,
    chancePlayerOnly: prev.chancePlayerOnly,
    editorMode: prev.editorMode,
    editorModeBackup: prev.editorModeBackup,
    testBonelingSpawns: prev.testBonelingSpawns,
    log: [
      ...prev.log.slice(-48),
      `You descend to Floor ${depth} · ${themeDisplayName(gen.floorTheme)}.`,
      `${monsters.length} monster(s), ${pots.length} pot(s), ${chests.length} chest(s), ${groundLoot.length} ground loot spot(s).`,
    ],
    turn: prev.turn + 1,
  };
}

/** Prototype catacomb floor from the pixel room maps. Keeps the player and rebuilds the floor. */
export function createCatacombsTestState(prev: GameState): GameState {
  const layout = generateCatacombs();
  const fogOfWar = !prev.editorMode;
  const discovered = buildDiscovered(
    true,
    layout.tiles,
    layout.roomIds,
    layout.width,
    layout.height,
    layout.playerStart,
  );
  const monsters: MonsterInstance[] = [];
  let mi = 0;
  for (const p of layout.bonelings) {
    const leader = bonelingLeaderForRoom(monsters, layout.roomIds, p.x, p.y);
    monsters.push(
      withBonelingLeaderFlag(
        createMonsterInstance(
          `monster_${mi++}`,
          "boneling",
          p.x,
          p.y,
          prev.monsterDefs,
          prev.danger,
        ),
        leader,
      ),
    );
  }
  for (const p of layout.skeletons) {
    monsters.push(
      createMonsterInstance(`monster_${mi++}`, "skeleton", p.x, p.y, prev.monsterDefs, prev.danger),
    );
  }
  const pots: PotInstance[] = layout.pots.map((p, i) => ({
    id: `pot_${i}`,
    x: p.x,
    y: p.y,
    magic: p.magic || undefined,
  }));
  const chests: ChestInstance[] = layout.chests.map((p, i) => ({
    id: `chest_${i}`,
    x: p.x,
    y: p.y,
    tier: layout.roomKinds[layout.roomIds[p.y]?.[p.x] ?? -1] === "treasure" ? 2 : 1,
  }));
  const groundLoot: GroundLootInstance[] = layout.coins.map((p, i) => ({
    id: `loot_${i}`,
    x: p.x,
    y: p.y,
    kind: "coin",
    amount: 1,
  }));
  const drawPile = [...prev.player.drawPile, ...prev.player.discardPile, ...prev.player.hand];
  return {
    phase: "player",
    floorId: layout.id,
    floorName: `Floor ${prev.depth} · Catacombs`,
    floorTheme: "catacombs",
    width: layout.width,
    height: layout.height,
    tiles: layout.tiles,
    fogOfWar,
    discovered,
    player: {
      ...prev.player,
      x: layout.playerStart.x,
      y: layout.playerStart.y,
      drawPile,
      discardPile: [],
      hand: [],
      defenseBonusThisTurn: 0,
      defenseUntilHit: 0,
      doublePunchThisTurn: false,
      moveTokens: 0,
      knockbackTokens: 0,
      knockbackPrimed: 0,
      movementCardsPlayedThisTurn: 0,
      scoutUsesThisTurn: 0,
      hasteThisTurn: false,
      arcaneChargeActive: false,
      resistance: 0,
      fortifyThisTurn: false,
      cardsPlayedThisTurn: 0,
      noMoreCardsThisTurn: false,
      guardDestroyerTargetId: null,
      guardDestroyerStacks: 0,
      damageTakenThisTurn: 0,
      knockbackedMonsterIdsThisTurn: [],
      fireLevels: 0,
      nextPhysicalAttackMultiplier: 1,
      nextMoveDoubled: false,
      gemLuckRestore: null,
    },
    depth: prev.depth,
    danger: prev.danger,
    noise: 0,
    monsters,
    pots,
    chests,
    rocks: [],
    groundLoot,
    bridgeTiles: [],
    floodingRoomId: null,
    pendingStalactites: [],
    harmingClouds: [],
    tangleweeds: [],
    bonePiles: [],
    tombs: layout.tombs,
    lockedDoors: layout.lockedDoors,
    catacombStair: layout.catacombStair,
    themePickHistory: prev.themePickHistory,
    roomIds: layout.roomIds,
    roomKinds: layout.roomKinds,
    dungeonDraw: buildFreshDungeonDeck(prev.depth, "catacombs"),
    dungeonDiscard: [],
    cardDefs: prev.cardDefs,
    monsterDefs: prev.monsterDefs,
    dungeonCardDefs: prev.dungeonCardDefs,
    pending: null,
    dualWieldStage: null,
    senseiOffer: null,
    chestOffer: null,
    cardPickupOffer: null,
    deckBuilderOffer: prev.deckBuilderOffer,
    gauntletCommenced: false,
    stairFeatures: null,
    shiftyMet: prev.shiftyMet,
    obamlyMet: prev.obamlyMet,
    obamlyRestockKeys: prev.obamlyRestockKeys,
    sennisMet: prev.sennisMet,
    sennisTomeExplained: prev.sennisTomeExplained,
    senseiMet: prev.senseiMet,
    merchantState: null,
    pedestalUsed: false,
    pedestalOffer: null,
    deckDestroyPending: false,
    flameDestroyPending: false,
    bindTomePending: false,
    tomeCast: null,
    stabilityBuffActive: false,
    scoutBlockedThisTurn: false,
    dungeonCardReveal: null,
    pendingCollapse: null,
    pendingTargetedCollapse: null,
    lightsOutTurns: 0,
    chanceMode: prev.chanceMode,
    chancePlayerOnly: prev.chancePlayerOnly,
    editorMode: prev.editorMode,
    editorModeBackup: prev.editorModeBackup,
    testBonelingSpawns: prev.testBonelingSpawns,
    log: [
      ...prev.log.slice(-40),
      layout.summary,
      `${monsters.length} monster(s), ${pots.length} pot(s), ${chests.length} chest(s), ${layout.tombs.length} tomb(s).`,
    ],
    turn: prev.turn + 1,
  };
}
