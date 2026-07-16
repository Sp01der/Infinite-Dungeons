export type Phase = "player" | "dungeon_resolve" | "monsters" | "defeat" | "peace";

/** Dev / future effects: bias integer rolls from `rollInt`. Shuffles still use `Math.random`. */
export type ChanceMode = "normal" | "highest" | "lowest";

export type TileKind = "floor" | "wall" | "blocked" | "water";

/** Procedural floor visual / spawn theme (floors 1–5). */
export type FloorTheme = "normal" | "overgrown" | "damp" | "brownstone";

export interface Point {
  x: number;
  y: number;
}

export interface CardDef {
  id: string;
  name: string;
  rarity: string;
  description: string;
  types: CardType[];
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
    | { type: "card_seeker"; move: number }
    | { type: "knockback_punch"; minDamage: number; maxDamage: number; knockback: number }
    | { type: "bow_attack"; minDamage: number; maxDamage: number; range: number }
    | { type: "lightning_bolt"; startDamage: number; startRange: number; chainRange: number }
    | { type: "haste" }
    | { type: "stealthy_advance"; move: number; noiseReduction: number; defenseBonus: number }
    | { type: "fireball"; minDamage: number; maxDamage: number; range: number; minFire: number; maxFire: number };
}

export type CardType =
  | "Move"
  | "Attack"
  | "Deck"
  | "Aid"
  | "Skill"
  | "Protection"
  | "Magic";

/** UI / Deck Builder: pick a type from this list. */
export const CARD_TYPE_ORDER: CardType[] = [
  "Move",
  "Attack",
  "Deck",
  "Aid",
  "Skill",
  "Protection",
  "Magic",
];

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
  | { type: "dust_settles" }
  | { type: "collapse" }
  | { type: "lights_out" }
  | { type: "targeted_collapse" }
  | { type: "you_are_not_alone" }
  | { type: "overgrowth" }
  | { type: "flooding" }
  | { type: "stalactites_fall" };

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
  bowLoaded?: boolean;
  mimicAsleep?: boolean;
  douvlonColor?: "red" | "blue";
  douvlonPairId?: string;
  /** Stacked Fire levels; decremented each turn after the monster acts, dealing 20% max HP damage. */
  fireLevels?: number;
  /** Elite Skeleton only: true once the low-HP teleport has already fired (prevents repeat). */
  eliteTeleported?: boolean;
  /** Elite Skeleton only: true when spawned inside the gauntlet wave (constrains teleport destination). */
  spawnedInGauntlet?: boolean;
  /** Corrupted Shade only: remaining draw pile of shade cards. */
  shadeDeck?: string[];
  /** Corrupted Shade only: discard pile of shade cards. */
  shadeDiscard?: string[];
  /** Corrupted Shade only: dark bolt charged — fires at magic-missile range at start of next turn. */
  darkBoltReady?: boolean;
  /** Corrupted Shade only: +5 defense until start of next shade turn. */
  blackShieldActive?: boolean;
  /** Drosir and other aquatic monsters: only move on water; treat bridges as water. */
  aquatic?: boolean;
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
  | "stair_room"
  | "greenhouse";

export interface ChestInstance {
  id: string;
  x: number;
  y: number;
  /** Higher tier rolls better gold (and future loot). */
  tier: number;
}

export type GroundLootKind = "coin" | "bread" | "card" | "herb";

/** Tangleweed obstacle: blocks movement; can be attacked like a monster. */
export interface TangleweedPropInstance {
  id: string;
  x: number;
  y: number;
  hp: number;
  /** Monster instance id of the owning tangleweed_bloom. */
  bloomId: string;
}

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

export type EnterBlockedResume =
  | { kind: "play_move"; cardHandIndex: number; range: number }
  | { kind: "discard_move1"; maxRange: number; fromQuickstep: boolean }
  | { kind: "play_card_seeker"; cardHandIndex: number }
  | { kind: "move_token_step" };

export type PendingIntent =
  | { kind: "play_move"; cardHandIndex: number; range: number }
  | { kind: "play_melee"; cardHandIndex: number; minDamage: number; maxDamage: number }
  | { kind: "play_spear"; cardHandIndex: number; minDamage: number; maxDamage: number }
  | { kind: "play_knife"; cardHandIndex: number; minDamage: number; maxDamage: number }
  | { kind: "play_axe"; cardHandIndex: number; minDamage: number; maxDamage: number }
  | { kind: "discard_move1"; maxRange: number; fromQuickstep: boolean }
  | { kind: "discard_punch" }
  | { kind: "play_magic_missile"; cardHandIndex: number; minDamage: number; maxDamage: number }
  | { kind: "play_card_seeker"; cardHandIndex: number }
  | { kind: "move_token_step" }
  | { kind: "enter_blocked_tile"; dest: Point; resume: EnterBlockedResume }
  | { kind: "water_escape"; waterX: number; waterY: number }
  | { kind: "play_knockback_punch"; cardHandIndex: number; minDamage: number; maxDamage: number; knockback: number }
  | { kind: "play_bow_attack"; cardHandIndex: number; minDamage: number; maxDamage: number; range: number }
  | {
      kind: "play_lightning_bolt";
      cardHandIndex: number;
      nextDamage: number;
      chainRange: number;
      hitIds: string[];
    }
  | { kind: "play_fireball"; cardHandIndex: number; minDamage: number; maxDamage: number; range: number; minFire: number; maxFire: number };

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
  /** Dungeon deck theme cards + floor generation theme. */
  floorTheme: FloorTheme;
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
    /** Healing Herb: use for +1 HP (held like bread). */
    herb: number;
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
    /** Spend to step 1 orthogonal space (cleared at end of turn). */
    moveTokens: number;
    knockbackTokens: number;
    /** After spending a knockback token; next weapon hit pushes if possible. */
    knockbackPrimed: boolean;
    movementCardsPlayedThisTurn: number;
    scoutUsesThisTurn: number;
    /** Haste card: all movement this turn moves twice as far; Attack/Protection/Aid/Deck cards are blocked. */
    hasteThisTurn: boolean;
    /** Fire levels on the player (for future use). */
    fireLevels: number;
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
  /** Bridge cells on water: walkable for non-aquatic; aquatic treats as water. */
  bridgeTiles: Point[];
  /** Flooding dungeon card: room id whose floor tiles convert to water each turn. */
  floodingRoomId: number | null;
  /** Stalactites Fall: tiles that deal damage at start of next player turn. */
  pendingStalactites: Point[];
  /** Tangleweed obstacles (Overgrown). */
  tangleweeds: TangleweedPropInstance[];
  /** Count of times each theme was picked this run (weighted re-roll). */
  themePickHistory: Partial<Record<FloorTheme, number>>;
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
  /** Deck Builder skill: choose a card type, then one of three cards to add to discard. */
  deckBuilderOffer:
    | null
    | { step: "choose_type" }
    | { step: "choose_card"; cardType: CardType; options: [string, string, string] };
  /** First time the player steps into the gauntlet chamber: seal approach, spawn gauntlet wave. */
  gauntletCommenced: boolean;
  /** Set when the last gauntlet monster dies: stair room attached, peace mode, deck shuffled. */
  stairFeatures: null | StairFeaturePositions;
  /** Card pedestal in the stair room (after peace). */
  pedestalUsed: boolean;
  pedestalOffer: null | { cards: [string, string, string] };
  /** After taking/skipping pedestal cards, optionally destroy one deck card (or skip). */
  deckDestroyPending: boolean;
  /** After Stability resolves; next dungeon draw may fizzle (Deadlier always applies). */
  stabilityBuffActive: boolean;
  /** Basic theme — The Dust Settles blocks investigate/scout until next turn start. */
  scoutBlockedThisTurn: boolean;
  /** Shown at top when a dungeon card resolves; cleared next player turn start or dismiss. */
  dungeonCardReveal: null | { title: string; summary: string };
  /** Room tiles marked for collapse — applied at end of your next turn. */
  pendingCollapse: null | { tiles: Point[] };
  /** Player cell + ortho neighbors marked for collapse — applied at end of your next turn. */
  pendingTargetedCollapse: Point[] | null;
  /** While > 0, Lights Out darkness is active; decremented when you end your turn. */
  lightsOutTurns: number;
  /** Integer roll bias for testing (see `rollInt` + `Chance` command). */
  chanceMode: ChanceMode;
  /** If true, only player-origin rolls use `chanceMode`; world rolls (dungeon, monsters) stay random. */
  chancePlayerOnly: boolean;
  log: string[];
  turn: number;
}

/** One combat hit for UI (flash + floating damage number at grid cell). */
export type AttackFxKind =
  | "magic_missile"
  | "arrow"
  | "fireball"
  | "douvlon_orb"
  | "melee_slash";

export interface AttackFx {
  kind: AttackFxKind;
  fromX: number;
  fromY: number;
}

export interface HitVisual {
  gridX: number;
  gridY: number;
  damage: number;
  /** Optional attack animation from attacker → this cell. */
  fx?: AttackFx;
}

export type DispatchResult = { state: GameState; hits: HitVisual[] };

export type GameCommand =
  | { type: "BEGIN_FIRST_TURN" }
  | {
      type: "DEV_SET_VARIABLE";
      variable:
        | "level"
        | "danger"
        | "maxHp"
        | "hp"
        | "gold"
        | "bread"
        | "herb"
        | "noise"
        | "exp"
        | "skillPoints";
      value: number;
    }
  | { type: "DEV_CARD"; cardId: string; action: "add" | "remove" }
  | { type: "DEV_DUNGEON_TOP"; cardId: string }
  | { type: "DEV_GOTO_FLOOR"; depth: number }
  | { type: "DEV_SET_THEME"; theme: FloorTheme }
  | { type: "DEV_SUMMON"; defId: string; level: number }
  | { type: "DEV_CHANCE"; mode: ChanceMode; playerOnly: boolean }
  | { type: "REQUEST_PLAY_CARD"; handIndex: number }
  | { type: "REQUEST_DISCARD_BONUS"; handIndex: number; bonus: "move1" | "punch" | "investigate" }
  | { type: "REQUEST_EQUIP"; handIndex: number }
  | { type: "UNEQUIP" }
  | { type: "CONFIRM_TARGET_TILE"; x: number; y: number }
  | { type: "CONFIRM_ENTER_BLOCKED"; handIndex: number }
  | { type: "CONFIRM_TARGET_MONSTER"; monsterInstanceId: string }
  | { type: "CONFIRM_TARGET_TANGLEWEED"; tangleweedId: string }
  | { type: "CONFIRM_TARGET_POT"; potId: string }
  | { type: "CANCEL_PENDING" }
  | { type: "USE_BREAD" }
  | { type: "USE_HERB" }
  | { type: "CONFIRM_WATER_ESCAPE"; destX: number; destY: number; handIndex: number }
  | { type: "CANCEL_WATER_ESCAPE" }
  | { type: "END_TURN" }
  | { type: "RESOLVE_CHEST_OFFER"; pickIndex: number | null }
  | { type: "RESOLVE_CARD_PICKUP"; accept: boolean }
  | { type: "DISMISS_DUNGEON_TOAST" }
  | { type: "PEACE_MOVE_TO"; x: number; y: number }
  | { type: "RESOLVE_PEDESTAL_PICK"; pickIndex: number | null }
  | { type: "RESOLVE_DECK_DESTROY"; cardId: string | null }
  | { type: "UNLOCK_SKILL"; skillId: string }
  | { type: "USE_MOVE_TOKEN" }
  | { type: "USE_KNOCKBACK_TOKEN" }
  | { type: "RESOLVE_DECK_BUILDER_TYPE"; cardType: CardType }
  | { type: "RESOLVE_DECK_BUILDER_PICK"; pickIndex: number | null }
  | { type: "RESOLVE_DECK_BUILDER_CANCEL" };
