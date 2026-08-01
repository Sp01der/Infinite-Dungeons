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
  /** Internal gameplay traits used across effects and skills; not player-facing card types. */
  tags?: CardTag[];
  /**
   * Special cards are excluded from normal loot pools (chests/pots/pedestals)
   * but remain available to Deck Builder and merchants.
   */
  special?: boolean;
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
    | { type: "fireball"; minDamage: number; maxDamage: number; range: number; minFire: number; maxFire: number }
    | { type: "mace_smash"; minDamage: number; maxDamage: number; defensePierce: number }
    | { type: "penalty_destroy" }
    | { type: "poisoned_blade"; minDamage: number; maxDamage: number; poisonLevels: number }
    | { type: "loot_and_scoot"; move: number; maxCoins: number }
    | { type: "dual_wield" }
    | { type: "flying_kick"; move: number; minDamage: number; maxDamage: number; knockback: number }
    | {
        type: "great_sword";
        minDamage: number;
        maxDamage: number;
        secondaryMinDamage: number;
        secondaryMaxDamage: number;
      }
    | { type: "potion_of_harming"; range: number; damage: number; cloudTurns: number }
    | { type: "arcane_charge"; draw: number }
    | { type: "shining_blade"; minDamage: number; maxDamage: number; diagonals: boolean }
    | { type: "arcane_shield"; resistance: number }
    | { type: "perfected_strike" }
    | { type: "fortify" }
    | { type: "stay_on_the_move" }
    | { type: "heal" }
    | { type: "evaluate" }
    | { type: "reckless_assault"; minDamage: number; maxDamage: number }
    | { type: "thieving_strike"; minDamage: number; maxDamage: number };
}

export type CardTag = "punch" | "physical attack" | "ranged" | "melee";

export type CardType =
  | "Move"
  | "Attack"
  | "Deck"
  | "Aid"
  | "Skill"
  | "Protection"
  | "Magic"
  | "Alchemy"
  | "Penalty";

/** UI / Deck Builder: pick a type from this list. */
export const CARD_TYPE_ORDER: CardType[] = [
  "Move",
  "Attack",
  "Deck",
  "Aid",
  "Skill",
  "Protection",
  "Magic",
  "Alchemy",
];

export type SkeletonWeapon = "sword" | "spear" | "axe" | "scimitar";

/** Distance metric for ATBMB attack range and tile prefs. */
export type AtbmbMetric = "manhattan" | "chebyshev";

/** Movement neighborhood for ATBMB move abilities. */
export type AtbmbMoveStyle = "ortho" | "any8";

/**
 * How a tile preference set is derived from the world.
 * Prefs are evaluated at runtime — they are not floor-gen stamps.
 */
export type AtbmbTilePref =
  | { kind: "adjacent_to_player"; metric: AtbmbMetric }
  | { kind: "distance_to_player"; metric: AtbmbMetric; min: number; max: number }
  /** Cardinal + shape from the player (same row or column), inclusive distance band. */
  | { kind: "plus_from_player"; min: number; max: number }
  /** Queen-line from the player (row, column, or diagonal). */
  | {
      kind: "queen_line_from_player";
      /** Require clear projectile path (default true). */
      requireClear?: boolean;
      /** Minimum Chebyshev distance (default 1). Use 2 to exclude adjacency. */
      minChebyshev?: number;
      /** Maximum Chebyshev distance (inclusive). */
      maxChebyshev?: number;
      /** Maximum Manhattan distance (inclusive). */
      maxManhattan?: number;
    }
  /**
   * Bow / fireball style: Chebyshev (or Manhattan) radius with any-angle LOS.
   * Walls block; other monsters do not (same as `lineOfSightClear`).
   */
  | {
      kind: "los_in_radius_from_player";
      metric: AtbmbMetric;
      max: number;
      /** Minimum distance (default 1). Bow uses Manhattan > 1 via minManhattan. */
      min?: number;
      /** If set, also require Manhattan distance ≥ this (Bow excludes ortho-adjacent). */
      minManhattan?: number;
    }
  | { kind: "water" }
  | { kind: "floor" }
  /** Any tile that is not water (bridges count as water). */
  | { kind: "not_water" }
  | { kind: "same_room_as_player" }
  | { kind: "clear_queen_ray_to_player" }
  | { kind: "harming_cloud" }
  /** Tiles on a coiled slime's leap path (leapDir × up to 2 steps). */
  | { kind: "slime_leap_path" }
  /** Diagonally adjacent to the player (Chebyshev corner). */
  | { kind: "diagonal_adjacent_to_player" }
  /** Room tiles marked by a pending Collapse dungeon card. */
  | { kind: "pending_collapse" }
  /** Cells marked by Targeted Collapse. */
  | { kind: "pending_targeted_collapse" }
  /** Floor tiles in the room currently marked for Flooding. */
  | { kind: "flooding_room" }
  /**
   * Tile from which vine whip can reach the player (Manhattan band + queen-line
   * clear path; same rules as Vineshon's whip).
   */
  | { kind: "vine_whip_range_to_player"; maxManhattan?: number }
  /**
   * Orthogonally or diagonally adjacent to any living entity with fireLevels ≥ 1
   * (player or monster).
   */
  | { kind: "adjacent_to_fire" }
  /**
   * Orthogonally adjacent to another living monster with the same defId
   * (or `allyDefId` if set). When `preferLeader` is true, only leaders count.
   */
  | { kind: "adjacent_to_ally"; allyDefId?: string; preferLeader?: boolean };

export interface AtbmbTilePrefs {
  favored?: AtbmbTilePref[];
  secondary?: AtbmbTilePref[];
  tertiary?: AtbmbTilePref[];
  bad?: AtbmbTilePref[];
}

export type AtbmbAbilityKind =
  | "move"
  | "melee"
  | "weapon_melee"
  | "ranged_queen"
  | "fire_arrow"
  | "load_bow"
  | "vine_whip"
  | "swim"
  | "prepare_leap"
  | "leap"
  | "disguise"
  | "custom";

/** Seek target when executing a move ability. */
export type AtbmbMoveSeek =
  | "favored"
  | "secondary"
  | "tertiary"
  | "away_from_bad"
  | "toward_player"
  | "away_from_player";

export interface AtbmbAbilityDef {
  id: string;
  kind: AtbmbAbilityKind;
  /** Max uses this turn (default 1). */
  uses?: number;
  params?: {
    steps?: number;
    minDamage?: number;
    maxDamage?: number;
    rangeMetric?: AtbmbMetric;
    rangeMin?: number;
    rangeMax?: number;
    knockback?: number;
    /** For prepare_leap / weapon_melee — state id to enter. */
    nextState?: string;
    /**
     * When true with `nextState`, keep resolving this turn in the new state's
     * decision tree (same ability budget). When false/omitted, only switch state
     * for next turn (e.g. slime prepare → leap next turn).
     */
    continueInNewState?: boolean;
    /** For kind "custom" — handler lookup key. */
    customId?: string;
  };
}

export interface AtbmbWhen {
  onFavoredTile?: boolean;
  /** True when standing on a disliked / bad tile. */
  onBadTile?: boolean;
  /** True when standing on a secondary preference tile. */
  onSecondaryTile?: boolean;
  inAttackRange?: boolean;
  /** Clear queen-ray magic-missile shot to the player. */
  clearQueenRayToPlayer?: boolean;
  /** Clear any-angle LOS to the player (Bow / fireball style). */
  clearLosToPlayer?: boolean;
  /** Skeleton weapon (or generic) can currently melee the player. */
  canWeaponMelee?: boolean;
  /**
   * True when standing in a non-corridor room that the player has not discovered
   * (no floor tiles of that room are in `discovered`).
   */
  inUndiscoveredNonCorridorRoom?: boolean;
  hpFractionBelow?: number;
  hpFractionAbove?: number;
  flagTrue?: string;
  flagFalse?: string;
}

export interface AtbmbAction {
  ability: string;
  /** Move abilities: which preference tier to approach (default favored). */
  seek?: AtbmbMoveSeek;
  /** If true, failure does not stop the rule's remaining actions. */
  optional?: boolean;
}

/**
 * One node in a state's decision tree.
 * Rules are evaluated in order; each matching rule tries its actions
 * until abilities are exhausted or blocked.
 */
export interface AtbmbRule {
  id?: string;
  when?: AtbmbWhen;
  actions: AtbmbAction[];
  /** Shuffle action order before trying (e.g. Dust Rat adjacent move/attack). */
  shuffleActions?: boolean;
}

export interface AtbmbAttackRange {
  metric: AtbmbMetric;
  min?: number;
  max: number;
}

export interface AtbmbStateDef {
  id: string;
  /** Used by `inAttackRange` and default melee checks. */
  attackRange?: AtbmbAttackRange;
  tilePrefs?: AtbmbTilePrefs;
  /** Per-weapon overrides merged onto `tilePrefs` (favored/secondary replace; bad concatenates). */
  weaponTilePrefs?: Partial<Record<SkeletonWeapon, AtbmbTilePrefs>>;
  decide: AtbmbRule[];
  /** Optional state transition after this state's decision phase finishes. */
  nextState?: string;
}

/** Data-driven ATBMB profile attached to a MonsterDef. */
export interface AtbmbDef {
  initialState: string;
  /**
   * Forced state at the start of each turn (e.g. skeleton always begins in Attack).
   * Applied before the decision tree runs.
   */
  turnStartState?: string;
  /**
   * Derive state from Manhattan distance to the player at turn start and again
   * after each decision phase (so a mid-turn pull can switch Distant → Close).
   */
  stateByPlayerDistance?: {
    /** Inclusive max Manhattan for `closeState` (default 2). */
    closeMax?: number;
    closeState: string;
    distantState: string;
  };
  /**
   * Derive state from whether the monster stands on water (checked each phase).
   */
  stateByTerrain?: {
    waterState: string;
    dryState: string;
  };
  /**
   * Derive state from current HP fraction (checked each phase).
   * Fleeing when `hp / maxHp <= fleeingAtOrBelow` (default 0.5).
   */
  stateByHpFraction?: {
    fleeingAtOrBelow?: number;
    attackingState: string;
    fleeingState: string;
  };
  moveStyle: AtbmbMoveStyle;
  /**
   * Cap on successful ability uses this turn (e.g. 1 = move OR attack, not both).
   * Omit for unlimited (each ability still has its own `uses` budget).
   */
  maxActionsPerTurn?: number;
  /**
   * When true, only one ability kind may succeed per turn (e.g. move×2 OR load OR fire).
   */
  oneAbilityKindPerTurn?: boolean;
  abilities: AtbmbAbilityDef[];
  states: AtbmbStateDef[];
}

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
  /** Advanced Tile-Based Monster Behavior (optional; falls back to legacy AI). */
  ai?: AtbmbDef;
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
  /** Slime: orthogonal unit vector for a prepared leap (telegraph arrow). */
  leapDir?: Point | null;
  /** @deprecated Prefer leapDir; kept for older leap telegraphs. */
  leapTarget?: Point | null;
  skeletonWeapon?: SkeletonWeapon;
  bowLoaded?: boolean;
  mimicAsleep?: boolean;
  douvlonColor?: "red" | "blue";
  douvlonPairId?: string;
  /** Stacked Fire levels; decremented each turn after the monster acts, dealing 20% max HP damage. */
  fireLevels?: number;
  /** Poison ticks after this creature acts; moving increases its nonlethal damage. */
  poisonLevels?: number;
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
  /** ATBMB: current behavior state id (from MonsterDef.ai.states). */
  aiStateId?: string;
  /** ATBMB: generic flags / counters (bow loaded, telegraph, etc.). */
  aiFlags?: Record<string, boolean | number>;
}

export interface PotInstance {
  id: string;
  x: number;
  y: number;
  /** Glowing magic pot — equal chance of each gem, Flame of Destruction, or Magic Tome. */
  magic?: boolean;
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

export type ShiftyGemId = "strength" | "speed" | "luck" | "cards" | "healing" | "defense";

export type GroundLootKind =
  | "coin"
  | "bread"
  | "card"
  | "herb"
  | "cheese"
  | "gem"
  | "flame_of_destruction"
  | "magic_tome";

/** Bound Magic Tome instance (does not stack). */
export type BoundMagicTome = {
  id: string;
  /** Spell card id bound into this tome. */
  cardId: string;
  /** Remaining uses (starts at 3). */
  charges: number;
};

/** Tangleweed obstacle: blocks movement; can be attacked like a monster. */
export interface TangleweedPropInstance {
  id: string;
  x: number;
  y: number;
  hp: number;
  /** Monster instance id of the owning tangleweed_bloom. */
  bloomId: string;
  /** True when no orthogonal vine path connects this segment to its living bloom. */
  withered?: boolean;
}

/** Bone pile remnant: walkable, no name/HP UI; merges after settling. */
export interface BonePilePropInstance {
  id: string;
  x: number;
  y: number;
  hp: number;
  /** Monster phases left before this pile may merge (starts at 2). */
  settleTurnsRemaining: number;
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
  /** Gem type when kind === "gem". */
  gemId?: ShiftyGemId;
}

export type EnterBlockedResume =
  | { kind: "play_move"; cardHandIndex: number; range: number }
  | { kind: "discard_move1"; maxRange: number; fromQuickstep: boolean }
  | { kind: "play_card_seeker"; cardHandIndex: number; range: number }
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
  | { kind: "play_card_seeker"; cardHandIndex: number; range: number }
  | { kind: "play_loot_and_scoot"; cardHandIndex: number; range: number; maxCoins: number }
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
  | { kind: "play_fireball"; cardHandIndex: number; minDamage: number; maxDamage: number; range: number; minFire: number; maxFire: number }
  | {
      kind: "play_mace_smash";
      cardHandIndex: number;
      minDamage: number;
      maxDamage: number;
      defensePierce: number;
    }
  | {
      kind: "play_poisoned_blade";
      cardHandIndex: number;
      minDamage: number;
      maxDamage: number;
      poisonLevels: number;
    }
  | {
      kind: "play_flying_kick";
      cardHandIndex: number;
      move: number;
      minDamage: number;
      maxDamage: number;
      knockback: number;
    }
  | {
      kind: "play_great_sword";
      cardHandIndex: number;
      minDamage: number;
      maxDamage: number;
      secondaryMinDamage: number;
      secondaryMaxDamage: number;
    }
  | {
      kind: "play_potion_of_harming";
      cardHandIndex: number;
      range: number;
      damage: number;
      cloudTurns: number;
    }
  | {
      kind: "play_perfected_strike";
      cardHandIndex: number;
      damage: number;
    }
  | {
      kind: "play_reckless_assault";
      cardHandIndex: number;
      minDamage: number;
      maxDamage: number;
      hpLost: number;
    }
  | {
      kind: "play_thieving_strike";
      cardHandIndex: number;
      minDamage: number;
      maxDamage: number;
    };

export interface StairFeaturePositions {
  pedestal: Point;
  merchant: Point;
  exitDoorCells: Point[];
  cornerTile: Point;
}

export type MerchantId = "shifty" | "obamly" | "sennis" | "sensei";

export type ShiftyListingKind =
  | "card"
  | "bread"
  | "herb"
  | "gem"
  | "cheese"
  | "stew"
  | "flame"
  | "skill";

export interface ShiftyListing {
  id: string;
  kind: ShiftyListingKind;
  name: string;
  basePrice: number;
  price: number;
  stock: number;
  cardId?: string;
  gemId?: ShiftyGemId;
  /** Stable key for Obamly sell-out restock tracking. */
  catalogKey?: string;
  /** Sensei (and similar): skill unlock for sale. */
  skillId?: string;
}

export type ShiftyDialogueChoice = { id: string; label: string };

export type ShiftyMerchantState = {
  merchantId: MerchantId;
  leftShopThisFloor: boolean;
  phase:
    | "idle"
    | "dialogue"
    | "shop"
    | "confirm"
    | "tome_hub"
    | "tome_buy"
    | "tome_bind"
    | "tome_sell"
    | "branch_menu";
  dialogueText: string;
  dialogueChoices: ShiftyDialogueChoice[];
  listings: ShiftyListing[];
  selectedListingId: string | null;
  /** Sensei Tenori sprite pose. */
  pose?: "meditating" | "sitting" | "standing";
  /** Sensei branch currently being taught. */
  senseiBranch?: "Attack" | "Defense" | "Mobility" | "Vitality" | "Deck" | null;
};

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
    /** Cheese: use to restore 3 HP. */
    cheese: number;
    /** Obamly's Special Stew: heal 6 HP and +1 max HP. */
    stew: number;
    /** Flame of Destruction: destroy one card from discard. */
    flameOfDestruction: number;
    /** Unbound Magic Tomes (stack). */
    unboundTomes: number;
    /** Bound Magic Tomes — each is unique; do not stack. */
    boundTomes: BoundMagicTome[];
    /** Consumable gems from merchants / loot. */
    gems: {
      strength: number;
      speed: number;
      luck: number;
      cards: number;
      healing: number;
      defense: number;
    };
    /** Gem of Strength: next physical attack damage ×1.5 (floored). */
    nextPhysicalAttackMultiplier: number;
    /** Gem of Speed: next movement range is doubled. */
    nextMoveDoubled: boolean;
    /** Gem of Luck: restore chanceMode at end of turn. */
    gemLuckRestore: ChanceMode | null;
    drawPile: string[];
    discardPile: string[];
    hand: string[];
    equipped: string | null;
    /** After playing Axe: next move (Move card or bonus 1-step) is cancelled. */
    suppressNextMove: boolean;
    /** Parry and similar: subtracts from incoming monster damage this turn (until your next draw). */
    defenseBonusThisTurn: number;
    /** Flurry of Blows: discard punches and played cards tagged `punch` hit twice this turn. */
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
    /** Tokens committed to the next melee attack; each adds one tile of knockback. */
    knockbackPrimed: number;
    movementCardsPlayedThisTurn: number;
    scoutUsesThisTurn: number;
    /** Haste card: all movement this turn moves twice as far; Attack/Protection/Aid/Deck cards are blocked. */
    hasteThisTurn: boolean;
    /**
     * Arcane Charge: only Magic cards may be played; Magic cards in hand were
     * physically upgraded for this turn.
     */
    arcaneChargeActive: boolean;
    /**
     * Resistance status: absorbs raw incoming damage (ignores defense) until
     * depleted. Cleared at next turn start unless Keep up your Guard is unlocked.
     */
    resistance: number;
    /** Fortify: defense bonus and resistance are treated as doubled this turn. */
    fortifyThisTurn: boolean;
    /** Cards successfully played this turn (for Heal gating). */
    cardsPlayedThisTurn: number;
    /** Heal: no further cards may be played this turn. */
    noMoreCardsThisTurn: boolean;
    /** Guard Destroyer: last monster hit by an attack. */
    guardDestroyerTargetId: string | null;
    /** Guard Destroyer: bonus damage stacks for the tracked target. */
    guardDestroyerStacks: number;
    /** Damage taken this turn (for Keep Fighting). */
    damageTakenThisTurn: number;
    /** Monster ids knockbacked this turn (for Thieving Strike bonus gold). */
    knockbackedMonsterIdsThisTurn: string[];
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
  /** Potion of Harming clouds: damage on enter; expire after turnsLeft player turns. */
  harmingClouds: { id: string; x: number; y: number; turnsLeft: number }[];
  /** Tangleweed obstacles (Overgrown). */
  tangleweeds: TangleweedPropInstance[];
  /** Bone piles left by slain Bonelings (walkable props). */
  bonePiles: BonePilePropInstance[];
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
  /** Dual Wield's staged first-hand-attack and second-discard-attack sequence. */
  dualWieldStage:
    | null
    | { step: "choose_hand_attack" }
    | { step: "resolving_hand_attack"; firstCardId: string }
    | { step: "choose_discard_attack"; firstCardId: string }
    | { step: "resolving_discard_attack"; firstCardId: string };
  /**
   * Sensei / Special card multi-step offers (discard pickers, HP sacrifice, etc.).
   */
  senseiOffer:
    | null
    | { kind: "perfected_strike_discard"; cardHandIndex: number; selected: number[] }
    | { kind: "evaluate_discard"; selected: number[] }
    | { kind: "stay_on_the_move" }
    | { kind: "reckless_assault_hp"; cardHandIndex: number; hpLost: number };
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
  /** True after first conversation with Shifty this run. */
  shiftyMet: boolean;
  /** True after first conversation with Mr. Robert Obamly this run. */
  obamlyMet: boolean;
  /**
   * Consumable catalog keys sold out at Obamly — next Obamly visit guarantees
   * those items with +1 stock.
   */
  obamlyRestockKeys: string[];
  /** True after first conversation with Sennis the Wizard this run. */
  sennisMet: boolean;
  /** True after Sennis's Magic Tome explanation has been heard this run. */
  sennisTomeExplained: boolean;
  /** True after first conversation with Sensei Tenori this run. */
  senseiMet: boolean;
  /** Active stair-room merchant UI/stock (null if none spawned). */
  merchantState: ShiftyMerchantState | null;
  /** Card pedestal in the stair room (after peace). */
  pedestalUsed: boolean;
  pedestalOffer: null | { cards: [string, string, string] };
  /** After taking/skipping pedestal cards, optionally destroy one deck card (or skip). */
  deckDestroyPending: boolean;
  /** Flame of Destruction: pick a discard card to destroy forever. */
  flameDestroyPending: boolean;
  /** Unbound Magic Tome: pick a Magic card from hand to bind. */
  bindTomePending: boolean;
  /** Playing a spell via Bound Tome (virtual hand card). */
  tomeCast: null | { tomeId: string; handIndex: number };
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
  /** Developer editor mode: reveals the floor and allows inspecting dungeon deck order. */
  editorMode: boolean;
  /** Normal health and fog settings restored when editor mode is disabled. */
  editorModeBackup: { hp: number; maxHp: number; fogOfWar: boolean } | null;
  /**
   * Dev Test mode: spawn Bonelings in packs of 3–5 instead of normal room monsters.
   */
  testBonelingSpawns: boolean;
  log: string[];
  turn: number;
}

/** One combat hit for UI (flash + floating damage number at grid cell). */
export type AttackFxKind =
  | "magic_missile"
  | "arrow"
  | "fireball"
  | "douvlon_orb"
  | "melee_slash"
  | "potion_harming"
  | "vine_whip"
  | "shining_blade";

export interface AttackFx {
  kind: AttackFxKind;
  fromX: number;
  fromY: number;
  /**
   * Vine whip: tile the tip retracts toward while the target is pulled
   * (player pull destination). Tip starts at the HitVisual cell.
   */
  tipToX?: number;
  tipToY?: number;
}

export interface HitVisual {
  gridX: number;
  gridY: number;
  damage: number;
  /** False for an animation anchor that should not show a hit flash or damage number. */
  showDamage?: boolean;
  /** Optional attack animation from attacker → this cell. */
  fx?: AttackFx;
}

/** Ordered presentation beats played after a dispatch resolves. */
export type TurnAnimEvent =
  | {
      kind: "move";
      /** `"player"` or a monster instance id. */
      entityId: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }
  | {
      kind: "attack";
      hits: HitVisual[];
      /** Game state after this attack’s damage/death should be shown. */
      stateAfter: GameState;
    }
  | {
      /** Several moves (and optional hits) presented together — e.g. slime leap. */
      kind: "simultaneous";
      moves: Array<{
        entityId: string;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
      }>;
      hits: HitVisual[];
      stateAfter: GameState;
    };

export type DispatchResult = {
  state: GameState;
  hits: HitVisual[];
  anims: TurnAnimEvent[];
};

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
  | { type: "DEV_SKILL"; skillId: string }
  | {
      type: "DEV_ITEM";
      item:
        | "gold"
        | "bread"
        | "herb"
        | "cheese"
        | "flameOfDestruction"
        | "unboundTomes"
        | "gem";
      gemId?: ShiftyGemId;
      quantity: number;
    }
  | { type: "DEV_DECK"; action: "clear" | "reshuffle" | "reset" }
  | { type: "DEV_DUNGEON_TOP"; cardId: string }
  | { type: "DEV_GOTO_FLOOR"; depth: number }
  | { type: "DEV_SET_THEME"; theme: FloorTheme }
  | { type: "DEV_SUMMON"; defId: string; level: number }
  | { type: "DEV_CHANCE"; mode: ChanceMode; playerOnly: boolean }
  | { type: "DEV_TEST"; feature: "boneling" }
  | { type: "DEV_EDITOR"; enabled: boolean }
  | { type: "DEV_EDITOR_CELL_ACTION"; x: number; y: number }
  | { type: "REQUEST_PLAY_CARD"; handIndex: number }
  | { type: "RESOLVE_DUAL_WIELD_DISCARD"; cardId: string }
  | { type: "TOGGLE_SENSEI_OFFER_SELECT"; handIndex: number }
  | { type: "CONFIRM_SENSEI_OFFER" }
  | { type: "SET_RECKLESS_ASSAULT_HP"; hpLost: number }
  | { type: "RESOLVE_STAY_ON_THE_MOVE"; cardId: string }
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
  | { type: "USE_CHEESE" }
  | { type: "USE_STEW" }
  | { type: "USE_FLAME_OF_DESTRUCTION" }
  | { type: "RESOLVE_FLAME_DESTROY"; cardId: string | null }
  | { type: "USE_UNBOUND_TOME" }
  | { type: "RESOLVE_BIND_TOME"; handIndex: number | null }
  | { type: "USE_BOUND_TOME"; tomeId: string }
  | { type: "USE_GEM"; gemId: ShiftyGemId }
  | { type: "CONFIRM_WATER_ESCAPE"; destX: number; destY: number; handIndex: number }
  | { type: "CANCEL_WATER_ESCAPE" }
  | { type: "END_TURN" }
  | { type: "RESOLVE_CHEST_OFFER"; pickIndex: number | null }
  | { type: "RESOLVE_CARD_PICKUP"; accept: boolean }
  | { type: "DISMISS_DUNGEON_TOAST" }
  | { type: "PEACE_MOVE_TO"; x: number; y: number }
  | { type: "TALK_TO_MERCHANT" }
  | { type: "RESOLVE_MERCHANT_DIALOGUE"; choiceId: string }
  | { type: "SELECT_MERCHANT_ITEM"; listingId: string }
  | { type: "OPEN_MERCHANT_TOMES" }
  | { type: "OPEN_SENSEI_TRAINING" }
  | { type: "OPEN_SENSEI_BRANCH"; branch: "Attack" | "Defense" | "Mobility" | "Vitality" | "Deck" }
  | { type: "CLOSE_MERCHANT_SHOP" }
  | { type: "RESOLVE_PEDESTAL_PICK"; pickIndex: number | null }
  | { type: "RESOLVE_DECK_DESTROY"; cardId: string | null }
  | { type: "UNLOCK_SKILL"; skillId: string }
  | { type: "USE_MOVE_TOKEN" }
  | { type: "USE_KNOCKBACK_TOKEN" }
  | { type: "RESOLVE_DECK_BUILDER_TYPE"; cardType: CardType }
  | { type: "RESOLVE_DECK_BUILDER_PICK"; pickIndex: number | null }
  | { type: "RESOLVE_DECK_BUILDER_CANCEL" };
