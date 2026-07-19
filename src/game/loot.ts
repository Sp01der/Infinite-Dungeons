import type { CardDef, CardType, GroundLootInstance, ShiftyGemId } from "./types";
import { ALL_GEM_IDS, randomLootGemId } from "./lootIcons";

/** Uniform int in [min, max]; ignores `chanceMode` (loot tables must stay fair). */
function lootRollInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export type PotLoot =
  | { kind: "nothing" }
  | { kind: "coin"; amount: number }
  | { kind: "bread" }
  | { kind: "herb" }
  | { kind: "cheese" }
  | { kind: "card"; cardId: string };

/**
 * Default 40% any loot; then among hits:
 * 38% 1 coin / 10% 3 coins / 18% bread / 12% herb / 10% cheese / 12% card.
 * Careful Looting adds +10% hit (via potLootHitChance). Cap ~0.95.
 */
export function rollPotLoot(cardDefs: Map<string, CardDef>, depth: number, hitChance = 0.4): PotLoot {
  if (Math.random() >= hitChance) return { kind: "nothing" };

  const r = Math.random();
  if (r < 0.38) return { kind: "coin", amount: 1 };
  if (r < 0.48) return { kind: "coin", amount: 3 };
  if (r < 0.66) return { kind: "bread" };
  if (r < 0.78) return { kind: "herb" };
  if (r < 0.88) return { kind: "cheese" };
  return { kind: "card", cardId: pickRandomLootCardId(cardDefs, depth) };
}

export type MagicPotLoot =
  | { kind: "gem"; gemId: ShiftyGemId }
  | { kind: "flame_of_destruction" }
  | { kind: "magic_tome" };

/** Magic pot: equal 1/8 for each of 6 gems, Flame of Destruction, and Magic Tome. */
export function rollMagicPotLoot(): MagicPotLoot {
  const roll = lootRollInt(0, 7);
  if (roll < 6) return { kind: "gem", gemId: ALL_GEM_IDS[roll]! };
  if (roll === 6) return { kind: "flame_of_destruction" };
  return { kind: "magic_tome" };
}

export type ChestLootRoll =
  | { kind: "coins"; amount: 3 | 4 }
  | { kind: "bread" }
  | { kind: "herb" }
  | { kind: "cheese" }
  | { kind: "gem"; gemId: ShiftyGemId }
  | { kind: "cardChoice"; tier: "basicToUncommon" | "rarePlus" };

/**
 * Chest contents:
 * 20% 3 coins / 18% 4 coins / 16% bread / 10% herb / 8% cheese / 8% gem /
 * 14% basic–uncommon card choice / 6% rare+ card choice.
 */
export function rollChestLoot(): ChestLootRoll {
  const r = Math.random();
  if (r < 0.2) return { kind: "coins", amount: 3 };
  if (r < 0.38) return { kind: "coins", amount: 4 };
  if (r < 0.54) return { kind: "bread" };
  if (r < 0.64) return { kind: "herb" };
  if (r < 0.72) return { kind: "cheese" };
  if (r < 0.8) return { kind: "gem", gemId: randomLootGemId() };
  if (r < 0.94) return { kind: "cardChoice", tier: "basicToUncommon" };
  return { kind: "cardChoice", tier: "rarePlus" };
}

/** Monsters have an 8% chance to leave one coin on their tile when slain. */
export function maybeDropMonsterCoin(
  groundLoot: GroundLootInstance[],
  x: number,
  y: number,
): { groundLoot: GroundLootInstance[]; dropped: boolean } {
  if (Math.random() >= 0.08) return { groundLoot, dropped: false };

  let serial = 0;
  for (const loot of groundLoot) {
    const match = /^gloot_(\d+)$/.exec(loot.id);
    if (match) serial = Math.max(serial, Number.parseInt(match[1]!, 10) + 1);
  }
  return {
    groundLoot: [...groundLoot, { id: `gloot_${serial}`, x, y, kind: "coin", amount: 1 }],
    dropped: true,
  };
}

function shuffleStrings(xs: string[]): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
}

export function pickThreeFromPool(pool: string[], fallback: string): [string, string, string] {
  if (pool.length === 0) return [fallback, fallback, fallback];
  const sh = [...pool];
  shuffleStrings(sh);
  const a = sh[0]!;
  const b = sh.find((x) => x !== a) ?? a;
  const c = sh.find((x) => x !== a && x !== b) ?? a;
  return [a, b, c];
}

/** Three offered cards for a chest (may repeat if the pool is tiny). */
export function isPlayableDeckCard(d: CardDef): boolean {
  return (
    d.effect.type !== "bonus_chit" &&
    d.effect.type !== "penalty_destroy" &&
    d.rarity !== "Merchant"
  );
}

const NON_CHEST_BASE_RARITIES = new Set(["Basic", "Common", "Uncommon"]);

/** Random playable card from ground / pots / similar (not chest rare+ draft). */
export function pickRandomLootCardId(cardDefs: Map<string, CardDef>, depth: number): string {
  const playable = [...cardDefs.entries()].filter(([, d]) => isPlayableDeckCard(d));
  const basic = playable.filter(([, d]) => NON_CHEST_BASE_RARITIES.has(d.rarity)).map(([id]) => id);
  const rare = playable.filter(([, d]) => d.rarity === "Rare").map(([id]) => id);
  const leg = playable.filter(([, d]) => d.rarity === "Legendary").map(([id]) => id);

  const pick = (pool: string[]) => pool[lootRollInt(0, pool.length - 1)]!;
  const pickBasicOrFallback = (): string => {
    if (basic.length > 0) return pick(basic);
    if (rare.length > 0) return pick(rare);
    if (leg.length > 0) return pick(leg);
    return "move";
  };

  if (depth <= 2) {
    return pickBasicOrFallback();
  }
  if (depth === 3) {
    if (rare.length > 0 && Math.random() < 0.12) return pick(rare);
    return pickBasicOrFallback();
  }
  if (depth === 4) {
    if (leg.length > 0 && Math.random() < 0.07) return pick(leg);
    if (rare.length > 0 && Math.random() < 0.13) return pick(rare);
    return pickBasicOrFallback();
  }
  // depth ≥ 5
  if (leg.length > 0 && Math.random() < 0.08) return pick(leg);
  if (rare.length > 0 && Math.random() < 0.18) return pick(rare);
  return pickBasicOrFallback();
}

function filterIdsByLootDepthForDeckBuilder(
  entries: [string, CardDef][],
  depth: number,
): string[] {
  return entries
    .filter(([, d]) => {
      if (!isPlayableDeckCard(d)) return false;
      if (depth <= 1) return NON_CHEST_BASE_RARITIES.has(d.rarity);
      if (depth <= 3) return d.rarity !== "Legendary";
      return true;
    })
    .map(([id]) => id);
}

/** Deck Builder: three random playable cards that include `cardType` in their types; fallback if pool empty. */
export function pickDeckBuilderThreeForType(
  cardDefs: Map<string, CardDef>,
  cardType: CardType,
  depth: number,
): [string, string, string] {
  const typed = [...cardDefs.entries()].filter(
    ([, d]) => d.types.includes(cardType) && isPlayableDeckCard(d),
  );
  const pool = filterIdsByLootDepthForDeckBuilder(typed, depth);
  if (pool.length === 0) {
    const fallback = filterIdsByLootDepthForDeckBuilder(
      [...cardDefs.entries()].filter(([, d]) => isPlayableDeckCard(d)),
      depth,
    );
    return pickThreeFromPool(fallback, "move");
  }
  return pickThreeFromPool(pool, pool[0]!);
}

export function pickChestOfferCards(
  cardDefs: Map<string, CardDef>,
  tier: "basicToUncommon" | "rarePlus",
  floorDepth: number,
): [string, string, string] {
  if (tier === "basicToUncommon") {
    const pool = [...cardDefs.entries()]
      .filter(([, d]) => ["Basic", "Common", "Uncommon"].includes(d.rarity) && isPlayableDeckCard(d))
      .map(([id]) => id);
    return pickThreeFromPool(pool, "move");
  }

  const rare = [...cardDefs.entries()]
    .filter(([, d]) => d.rarity === "Rare" && isPlayableDeckCard(d))
    .map(([id]) => id);
  const leg =
    floorDepth >= 4
      ? [...cardDefs.entries()]
          .filter(([, d]) => d.rarity === "Legendary" && isPlayableDeckCard(d))
          .map(([id]) => id)
      : [];
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const pickLegendary = leg.length > 0 && (rare.length === 0 || Math.random() < 0.22);
    if (pickLegendary) out.push(leg[lootRollInt(0, leg.length - 1)]!);
    else if (rare.length > 0) out.push(rare[lootRollInt(0, rare.length - 1)]!);
    else if (leg.length > 0) out.push(leg[lootRollInt(0, leg.length - 1)]!);
    else out.push("focus");
  }
  return [out[0]!, out[1]!, out[2]!];
}

/** Stair pedestal: playable by rarity vs floor depth (floor 1: no rare; legendary only depth 4+). */
export function pickPedestalOfferCards(
  cardDefs: Map<string, CardDef>,
  floorDepth: number,
): [string, string, string] {
  const pool = [...cardDefs.entries()]
    .filter(([, d]) => {
      if (!isPlayableDeckCard(d)) return false;
      if (floorDepth <= 1) return NON_CHEST_BASE_RARITIES.has(d.rarity);
      if (floorDepth <= 3) return d.rarity !== "Legendary";
      return true;
    })
    .map(([id]) => id);
  return pickThreeFromPool(pool, "move");
}

export type GroundLootPiece =
  | { kind: "coin"; amount: number }
  | { kind: "bread" }
  | { kind: "herb" }
  | { kind: "cheese" }
  | { kind: "gem"; gemId: ShiftyGemId }
  | { kind: "card"; cardId: string };

/**
 * Floor ground piece (non-greenhouse).
 * Three-coin piles: none before floor 3, 5% on floor 3, 10% on floor 4+.
 * Otherwise: ~35.6% 1 coin / 24.4% bread / 13.3% herb / 8.9% cheese / 6.7% gem / 11.1% card
 * (relative weights of the non-pile table).
 */
export function rollGroundLootPiece(
  cardDefs: Map<string, CardDef>,
  depth: number,
): GroundLootPiece {
  const threeCoinChance = depth >= 4 ? 0.1 : depth >= 3 ? 0.05 : 0;
  if (threeCoinChance > 0 && Math.random() < threeCoinChance) {
    return { kind: "coin", amount: 3 };
  }

  // Remaining outcomes (was 90% of the old table without the 10% three-coin band).
  const r = Math.random();
  if (r < 32 / 90) return { kind: "coin", amount: 1 };
  if (r < 54 / 90) return { kind: "bread" };
  if (r < 66 / 90) return { kind: "herb" };
  if (r < 74 / 90) return { kind: "cheese" };
  if (r < 80 / 90) return { kind: "gem", gemId: randomLootGemId() };
  return { kind: "card", cardId: pickRandomLootCardId(cardDefs, depth) };
}
