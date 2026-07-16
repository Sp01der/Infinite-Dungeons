import { rollInt } from "../engine/combat";
import type { CardDef, CardType } from "./types";

export type PotLoot =
  | { kind: "nothing" }
  | { kind: "coin"; amount: number }
  | { kind: "bread" }
  | { kind: "card"; cardId: string };

/** Default 40% any loot; then 55% coin / 25% bread / 20% random deck card. `hitChance` caps at ~0.95. */
export function rollPotLoot(cardDefs: Map<string, CardDef>, depth: number, hitChance = 0.4): PotLoot {
  if (Math.random() >= hitChance) return { kind: "nothing" };

  const r = Math.random();
  if (r < 0.55) return { kind: "coin", amount: 1 };
  if (r < 0.8) return { kind: "bread" };

  return { kind: "card", cardId: pickRandomLootCardId(cardDefs, depth) };
}

export type ChestLootRoll =
  | { kind: "coins"; amount: 1 | 2 | 3 }
  | { kind: "bread" }
  | { kind: "cardChoice"; tier: "basicToUncommon" | "rarePlus" };

/** 10% / 20% / 20% coins, 20% bread, 20% normal card choice, 10% rare+ card choice. */
export function rollChestLoot(): ChestLootRoll {
  const r = Math.random();
  if (r < 0.1) return { kind: "coins", amount: 1 };
  if (r < 0.3) return { kind: "coins", amount: 2 };
  if (r < 0.5) return { kind: "coins", amount: 3 };
  if (r < 0.7) return { kind: "bread" };
  if (r < 0.9) return { kind: "cardChoice", tier: "basicToUncommon" };
  return { kind: "cardChoice", tier: "rarePlus" };
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
  return d.effect.type !== "bonus_chit";
}

const NON_CHEST_BASE_RARITIES = new Set(["Basic", "Common", "Uncommon"]);

/** Random playable card from ground / pots / similar (not chest rare+ draft). */
export function pickRandomLootCardId(cardDefs: Map<string, CardDef>, depth: number): string {
  const playable = [...cardDefs.entries()].filter(([, d]) => isPlayableDeckCard(d));
  const basic = playable.filter(([, d]) => NON_CHEST_BASE_RARITIES.has(d.rarity)).map(([id]) => id);
  const rare = playable.filter(([, d]) => d.rarity === "Rare").map(([id]) => id);
  const leg = playable.filter(([, d]) => d.rarity === "Legendary").map(([id]) => id);

  const pick = (pool: string[]) => pool[rollInt(0, pool.length - 1)]!;

  if (depth <= 1) {
    if (basic.length === 0) return "move";
    return pick(basic);
  }
  if (depth <= 3) {
    if (rare.length > 0 && Math.random() < 0.12) return pick(rare);
    if (basic.length === 0) return rare.length ? pick(rare) : "move";
    return pick(basic);
  }
  if (leg.length > 0 && Math.random() < 0.08) return pick(leg);
  if (rare.length > 0 && Math.random() < 0.18) return pick(rare);
  if (basic.length === 0) {
    if (rare.length > 0) return pick(rare);
    if (leg.length > 0) return pick(leg);
    return "move";
  }
  return pick(basic);
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
    if (pickLegendary) out.push(leg[rollInt(0, leg.length - 1)]!);
    else if (rare.length > 0) out.push(rare[rollInt(0, rare.length - 1)]!);
    else if (leg.length > 0) out.push(leg[rollInt(0, leg.length - 1)]!);
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
