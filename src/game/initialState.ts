import type {
  CardDef,
  ChestInstance,
  FloorDef,
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
import type { GeneratedFloor } from "../engine/floorGen";
import { keyOf, parseFloor } from "../engine/grid";
import { buildFreshDungeonDeck } from "./dungeonDeck";
import { loadCardDefs, loadDungeonCardDefs, loadMonsterDefs } from "./loadContent";
import { createMonsterInstance } from "./monsterSpawn";

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

function buildStartingDeck(): string[] {
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

export function pickMonsterId(kind: RoomKind, monsterDefs: Map<string, MonsterDef>): string {
  switch (kind) {
    case "entrance":
      return "slime";
    case "corridor":
      return pickWeightedDefId(["slime", "dune_rat"], monsterDefs);
    case "normal":
      return pickWeightedDefId(
        ["slime", "dune_rat", "skeleton", "mystic_core", "rockling"],
        monsterDefs,
      );
    case "treasure":
      return pickWeightedDefId(
        ["skeleton", "mystic_core", "rockling", "slime", "dune_rat"],
        monsterDefs,
      );
    case "gauntlet":
      return pickWeightedDefId(["skeleton", "mystic_core", "slime", "dune_rat", "rockling"], monsterDefs);
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

    const pushMonster = (p: Point, defId: string) => {
      monsters.push(
        createMonsterInstance(`monster_${mi++}`, defId, p.x, p.y, monsterDefs, dangerLevel),
      );
    };

    switch (kind) {
      case "entrance": {
        const n = rollInt(0, 2);
        for (const p of take(n)) pots.push({ id: `pot_${pi++}`, x: p.x, y: p.y });
        break;
      }
      case "corridor": {
        const nPot = rollInt(0, 1);
        for (const p of take(nPot)) pots.push({ id: `pot_${pi++}`, x: p.x, y: p.y });
        if (cells.length - idx > 0 && Math.random() < 0.38) {
          const [p] = take(1);
          if (p) pushMonster(p, pickMonsterId("corridor", monsterDefs));
        }
        break;
      }
      case "gauntlet_corridor":
        // Intentional empty lead-in corridor to the gauntlet.
        break;
      case "normal": {
        const nPot = rollInt(1, 3);
        for (const p of take(nPot)) pots.push({ id: `pot_${pi++}`, x: p.x, y: p.y });
        const nMon = Math.random() < 0.68 ? 1 : 2;
        for (let k = 0; k < nMon; k++) {
          const [p] = take(1);
          if (p) pushMonster(p, pickMonsterId("normal", monsterDefs));
        }
        break;
      }
      case "treasure": {
        const nPot = rollInt(0, 2);
        for (const p of take(nPot)) pots.push({ id: `pot_${pi++}`, x: p.x, y: p.y });
        const nMon = Math.random() < 0.65 ? 1 : 2;
        for (let k = 0; k < nMon; k++) {
          const [p] = take(1);
          if (p) pushMonster(p, pickMonsterId("treasure", monsterDefs));
        }
        break;
      }
      case "gauntlet":
        // Populated when the player first enters the gauntlet.
        break;
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

  return { monsters, pots, chests };
}

function rollGroundLootPiece(
  cardDefs: Map<string, CardDef>,
): { kind: "coin"; amount: number } | { kind: "bread" } | { kind: "card"; cardId: string } {
  const r = Math.random();
  if (r < 0.48) return { kind: "coin", amount: rollInt(1, 3) };
  if (r < 0.9) return { kind: "bread" };
  const pool = [...cardDefs.entries()]
    .filter(
      ([, d]) => ["Basic", "Common", "Uncommon"].includes(d.rarity) && d.effect.type !== "bonus_chit",
    )
    .map(([id]) => id);
  if (pool.length === 0) return { kind: "bread" };
  return { kind: "card", cardId: pool[rollInt(0, pool.length - 1)]! };
}

/** ~50% per room: 1–2 small drops; monsters may stand on loot tiles. */
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
    if (Math.random() >= 0.5) continue;
    const candidates = cells.filter((c) => !blocked.has(keyOf(c)));
    if (candidates.length === 0) continue;
    shuffleInPlace(candidates);
    const nDrops = Math.random() < 0.82 ? 1 : 2;
    for (let k = 0; k < nDrops && k < candidates.length; k++) {
      const p = candidates[k]!;
      const piece = rollGroundLootPiece(cardDefs);
      if (piece.kind === "coin") {
        out.push({ id: `gloot_${li++}`, x: p.x, y: p.y, kind: "coin", amount: piece.amount });
      } else if (piece.kind === "bread") {
        out.push({ id: `gloot_${li++}`, x: p.x, y: p.y, kind: "bread" });
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
        if (tiles[y][x] === "floor") discovered.add(keyOf({ x, y }));
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
  );

  return {
    phase: "player",
    floorId: floorDef.id,
    floorName: floorDef.name,
    floorTheme: "basic",
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
      drawPile: buildStartingDeck(),
      discardPile: [],
      hand: [],
      equipped: null,
      suppressNextMove: false,
      defenseBonusThisTurn: 0,
      doublePunchThisTurn: false,
      level: 1,
      exp: 0,
      skillPoints: 0,
      skillsUnlocked: [],
      moveTokens: 0,
      knockbackTokens: 0,
      knockbackPrimed: false,
      movementCardsPlayedThisTurn: 0,
      scoutUsesThisTurn: 0,
    },
    depth: 1,
    danger: 1,
    noise: 0,
    monsters,
    pots,
    chests,
    rocks: [],
    groundLoot,
    roomIds,
    roomKinds,
    dungeonDraw: buildFreshDungeonDeck(1, "basic"),
    dungeonDiscard: [],
    cardDefs,
    monsterDefs,
    dungeonCardDefs: loadDungeonCardDefs(),
    pending: null,
    chestOffer: null,
    cardPickupOffer: null,
    deckBuilderOffer: null,
    gauntletCommenced: false,
    stairFeatures: null,
    pedestalUsed: false,
    pedestalOffer: null,
    deckDestroyPending: false,
    stabilityBuffActive: false,
    scoutBlockedThisTurn: false,
    dungeonCardReveal: null,
    log: [
      "Welcome to the dungeon.",
      `${monsters.length} monster(s), ${pots.length} pot(s), ${chests.length} chest(s), ${groundLoot.length} ground loot spot(s).`,
    ],
    turn: 0,
  };
}

/** Procedurally generated multi-room floor (fog on by default). */
export function createInitialStateGenerated(gen: GeneratedFloor): GameState {
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
  );

  return {
    phase: "player",
    floorId: gen.id,
    floorName: "Floor 1",
    floorTheme: "basic",
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
      drawPile: buildStartingDeck(),
      discardPile: [],
      hand: [],
      equipped: null,
      suppressNextMove: false,
      defenseBonusThisTurn: 0,
      doublePunchThisTurn: false,
      level: 1,
      exp: 0,
      skillPoints: 0,
      skillsUnlocked: [],
      moveTokens: 0,
      knockbackTokens: 0,
      knockbackPrimed: false,
      movementCardsPlayedThisTurn: 0,
      scoutUsesThisTurn: 0,
    },
    depth: 1,
    danger: 1,
    noise: 0,
    monsters,
    pots,
    chests,
    rocks: [],
    groundLoot,
    roomIds,
    roomKinds,
    dungeonDraw: buildFreshDungeonDeck(1, "basic"),
    dungeonDiscard: [],
    cardDefs,
    monsterDefs,
    dungeonCardDefs: loadDungeonCardDefs(),
    pending: null,
    chestOffer: null,
    cardPickupOffer: null,
    deckBuilderOffer: null,
    gauntletCommenced: false,
    stairFeatures: null,
    pedestalUsed: false,
    pedestalOffer: null,
    deckDestroyPending: false,
    stabilityBuffActive: false,
    scoutBlockedThisTurn: false,
    dungeonCardReveal: null,
    log: [
      "Welcome to the dungeon.",
      `${monsters.length} monster(s), ${pots.length} pot(s), ${chests.length} chest(s), ${groundLoot.length} ground loot spot(s).`,
    ],
    turn: 0,
  };
}

/** New procedural floor after descending stairs: keeps player stats & full deck, new layout & props. */
export function createNextFloorState(prev: GameState, gen: GeneratedFloor): GameState {
  const depth = prev.depth + 1;
  const danger = prev.danger + 1;
  const monsterDefs = prev.monsterDefs;
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
    danger,
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
    floorName: `Floor ${depth}`,
    floorTheme: prev.floorTheme,
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
      suppressNextMove: false,
      defenseBonusThisTurn: 0,
      doublePunchThisTurn: false,
      moveTokens: 0,
      knockbackTokens: 0,
      knockbackPrimed: false,
      movementCardsPlayedThisTurn: 0,
      scoutUsesThisTurn: 0,
    },
    depth,
    danger,
    noise: 0,
    monsters,
    pots,
    chests,
    rocks: [],
    groundLoot,
    roomIds,
    roomKinds,
    dungeonDraw: buildFreshDungeonDeck(depth, prev.floorTheme),
    dungeonDiscard: [],
    cardDefs,
    monsterDefs,
    dungeonCardDefs: prev.dungeonCardDefs,
    pending: null,
    chestOffer: null,
    cardPickupOffer: null,
    deckBuilderOffer: prev.deckBuilderOffer,
    gauntletCommenced: false,
    stairFeatures: null,
    pedestalUsed: false,
    pedestalOffer: null,
    deckDestroyPending: false,
    stabilityBuffActive: false,
    scoutBlockedThisTurn: false,
    dungeonCardReveal: null,
    log: prev.log.slice(-50),
    turn: prev.turn + 1,
  };
}
