import { rollInt } from "../engine/combat";
import type { CardDef } from "./types";

export type PotLoot =
  | { kind: "nothing" }
  | { kind: "coin"; amount: number }
  | { kind: "bread" }
  | { kind: "card"; cardId: string };

/** 40% any loot; then 55% coin / 25% bread / 20% random deck card. */
export function rollPotLoot(cardPool: string[]): PotLoot {
  if (Math.random() >= 0.4) return { kind: "nothing" };

  const r = Math.random();
  if (r < 0.55) return { kind: "coin", amount: 1 };
  if (r < 0.8) return { kind: "bread" };

  if (cardPool.length === 0) return { kind: "bread" };
  const cardId = cardPool[rollInt(0, cardPool.length - 1)]!;
  return { kind: "card", cardId };
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
function isPlayableDeckCard(d: CardDef): boolean {
  return d.effect.type !== "bonus_chit";
}

export function pickChestOfferCards(
  cardDefs: Map<string, CardDef>,
  tier: "basicToUncommon" | "rarePlus",
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
  const leg = [...cardDefs.entries()]
    .filter(([, d]) => d.rarity === "Legendary" && isPlayableDeckCard(d))
    .map(([id]) => id);
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

/** Stair pedestal: any playable rarity (no bonus chits). */
export function pickPedestalOfferCards(cardDefs: Map<string, CardDef>): [string, string, string] {
  const pool = [...cardDefs.entries()]
    .filter(([, d]) => d.effect.type !== "bonus_chit")
    .map(([id]) => id);
  return pickThreeFromPool(pool, "move");
}
