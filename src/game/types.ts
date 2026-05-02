export type Phase = "player" | "dungeon_resolve" | "monsters" | "defeat" | "peace";

export type TileKind = "floor" | "wall";

export interface Point {
  x: number;
  y: number;
}

export interface CardDef {
  id: string;
  name: string;
  rarity: string;
  description: string;
  effect:
    | { type: "move"; range: number }
    | { type: "melee_attack"; minDamage: number; maxDamage: number }
    | { type: "draw"; amount: number }
    | { type: "spear_line"; minDamage: number; maxDamage: number }
    | { type: "knife"; minDamage: number; maxDamage: number }
    | { type: "axe"; minDamage: number; maxDamage: number }
    | { type: "quickstep"; draw: number; move: number }
    | { type: "tactical_approach"; draw: number; bonusCount: number }
    | { type: "bonus_chit" }
    | { type: "parry"; defenseBonus: number }
    | { type: "flurry" }
    | { type: "magic_missile"; minDamage: number; maxDamage: number }
    | { type: "card_seeker"; move: number };
}

export type SkeletonWeapon = "sword" | "spear" | "axe" | "scimitar";

export interface MonsterDef {
  id: string;
  name: string;
  spriteId: string;
  hp: number;
  defense: number;
  damage: number;
  /** Gauntlet / scaling budget (bats 2, most 3, skeletons 4). */
  power: number;
  description: string;
}

export type DungeonCardEffect =
  | { type: "noop" }
  | { type: "add_noise"; amount: number }
  | { type: "trap" }
  | { type: "falling_rocks" }
  | { type: "monsters_from_deep" }
  | { type: "danger_and_reshuffle" }
  /** Next dungeon draw (except Deadlier) has a 50% chance to do nothing. */
  | { type: "stability" }
  /** This floor theme (basic): cannot investigate/scout until next player turn. */
  | { type: "dust_settles" };

export interface DungeonCardDef {
  id: string;
  name: string;
  description: string;
  effect: DungeonCardEffect;
}

export interface FloorDef {
  id: string;
  name: string;
  width: number;
  height: number;
  rows: string[];
  fogOfWar?: boolean;
}

export interface MonsterInstance {
  id: string;
  defId: string;
  x: number;
  y: number;
  hp: number;
  active: boolean;
  /** Danger at spawn; scales outgoing damage (+1 per level above 1). */
  level: number;
  /** Rockling only: rolled 1–2 at spawn; overrides MonsterDef.defense for incoming hits. */
  defenseOverride?: number;
  /** Slime only: null = not preparing; Point = leaps here next turn. */
  leapTarget?: Point | null;
  skeletonWeapon?: SkeletonWeapon;
}

export interface PotInstance {
  id: string;
  x: number;
  y: number;
}

export interface RockInstance {
  id: string;
  x: number;
  y: number;
}

/** Room topology for fog, spawns, and future gauntlet/treasure rules. */
export type RoomKind =
  | "entrance"
  | "normal"
  | "corridor"
  | "treasure"
  | "gauntlet"
  | "gauntlet_corridor"
  | "stair_room";

export interface ChestInstance {
  id: string;
  x: number;
  y: number;
  /** Higher tier rolls better gold (and future loot). */
  tier: number;
}

export type GroundLootKind = "coin" | "bread" | "card";

/** Dropped loot; may share a tile with monsters (not with pots/chests). */
export interface GroundLootInstance {
  id: string;
  x: number;
  y: number;
  kind: GroundLootKind;
  /** Gold amount when kind === "coin". */
  amount?: number;
  /** Card id when kind === "card". */
  cardId?: string;
}

export type PendingIntent =
  | { kind: "play_move"; cardHandIndex: number; range: number }
  | { kind: "play_melee"; cardHandIndex: number; minDamage: number; maxDamage: number }
  | { kind: "play_spear"; cardHandIndex: number; minDamage: number; maxDamage: number }
  | { kind: "play_knife"; cardHandIndex: number; minDamage: number; maxDamage: number }
  | { kind: "play_axe"; cardHandIndex: number; minDamage: number; maxDamage: number }
  | { kind: "discard_move1" }
  | { kind: "discard_punch" }
  | { kind: "play_magic_missile"; cardHandIndex: number; minDamage: number; maxDamage: number }
  | { kind: "play_card_seeker"; cardHandIndex: number };

export interface StairFeaturePositions {
  pedestal: Point;
  merchant: Point;
  exitDoorCells: Point[];
  cornerTile: Point;
}

export interface GameState {
  phase: Phase;
  floorId: string;
  floorName: string;
  /** Dungeon deck theme cards (e.g. basic → The Dust Settles). */
  floorTheme: string;
  width: number;
  height: number;
  tiles: TileKind[][];
  fogOfWar: boolean;
  /** "x,y" keys for revealed floor tiles */
  discovered: Set<string>;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    gold: number;
    bread: number;
    drawPile: string[];
    discardPile: string[];
    hand: string[];
    equipped: string | null;
    /** After playing Axe: next move (Move card or bonus 1-step) is cancelled. */
    suppressNextMove: boolean;
    /** Parry and similar: subtracts from incoming monster damage this turn (until your next draw). */
    defenseBonusThisTurn: number;
    /** Flurry of Blows: bonus punches this turn hit twice. */
    doublePunchThisTurn: boolean;
    /** 1-based; XP bar uses expToNextLevel(level). */
    level: number;
    /** Experience toward the next level. */
    exp: number;
    skillPoints: number;
    skillsUnlocked: string[];
  };
  /** 1-based floor index; dungeon card formulas use this. */
  depth: number;
  danger: number;
  noise: number;
  monsters: MonsterInstance[];
  pots: PotInstance[];
  chests: ChestInstance[];
  /** Falling rocks block movement continuation and cost extra to leave. */
  rocks: RockInstance[];
  groundLoot: GroundLootInstance[];
  /** -1 wall; else index into roomKinds */
  roomIds: number[][];
  roomKinds: RoomKind[];
  dungeonDraw: string[];
  dungeonDiscard: string[];
  cardDefs: Map<string, CardDef>;
  monsterDefs: Map<string, MonsterDef>;
  dungeonCardDefs: Map<string, DungeonCardDef>;
  pending: PendingIntent | null;
  /** Chest opened: pick one of three cards to add to discard, or resolve with neither. */
  chestOffer: null | { cards: [string, string, string] };
  /** Pot / ground card finds: take into discard or decline (queue if several). */
  cardPickupOffer: null | { queue: string[] };
  /** First time the player steps into the gauntlet chamber: seal approach, spawn gauntlet wave. */
  gauntletCommenced: boolean;
  /** Set when the last gauntlet monster dies: stair room attached, peace mode, deck shuffled. */
  stairFeatures: null | StairFeaturePositions;
  /** Card pedestal in the stair room (after peace). */
  pedestalUsed: boolean;
  pedestalOffer: null | { cards: [string, string, string] };
  /** After taking/skipping pedestal cards, pick one deck card to destroy. */
  deckDestroyPending: boolean;
  /** After Stability resolves; next dungeon draw may fizzle (Deadlier always applies). */
  stabilityBuffActive: boolean;
  /** Basic theme — The Dust Settles blocks investigate/scout until next turn start. */
  scoutBlockedThisTurn: boolean;
  /** Shown at top when a dungeon card resolves; cleared next player turn start or dismiss. */
  dungeonCardReveal: null | { title: string; summary: string };
  log: string[];
  turn: number;
}

/** One combat hit for UI (flash + floating damage number at grid cell). */
export interface HitVisual {
  gridX: number;
  gridY: number;
  damage: number;
}

export type DispatchResult = { state: GameState; hits: HitVisual[] };

export type GameCommand =
  | { type: "BEGIN_FIRST_TURN" }
  | { type: "REQUEST_PLAY_CARD"; handIndex: number }
  | { type: "REQUEST_DISCARD_BONUS"; handIndex: number; bonus: "move1" | "punch" | "investigate" }
  | { type: "REQUEST_EQUIP"; handIndex: number }
  | { type: "UNEQUIP" }
  | { type: "CONFIRM_TARGET_TILE"; x: number; y: number }
  | { type: "CONFIRM_TARGET_MONSTER"; monsterInstanceId: string }
  | { type: "CONFIRM_TARGET_POT"; potId: string }
  | { type: "CANCEL_PENDING" }
  | { type: "USE_BREAD" }
  | { type: "END_TURN" }
  | { type: "RESOLVE_CHEST_OFFER"; pickIndex: number | null }
  | { type: "RESOLVE_CARD_PICKUP"; accept: boolean }
  | { type: "DISMISS_DUNGEON_TOAST" }
  | { type: "PEACE_MOVE_TO"; x: number; y: number }
  | { type: "RESOLVE_PEDESTAL_PICK"; pickIndex: number | null }
  | { type: "RESOLVE_DECK_DESTROY"; cardId: string }
  | { type: "UNLOCK_SKILL"; skillId: string };
