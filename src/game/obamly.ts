import { rollInt } from "../engine/combat";
import { isPlayableDeckCard } from "./loot";
import type {
  CardDef,
  GameState,
  ShiftyDialogueChoice,
  ShiftyGemId,
  ShiftyListing,
  ShiftyMerchantState,
} from "./types";

type ConsumableEntry =
  | { catalogKey: string; kind: "bread"; name: string; basePrice: number; stock: number }
  | { catalogKey: string; kind: "herb"; name: string; basePrice: number; stock: number }
  | { catalogKey: string; kind: "cheese"; name: string; basePrice: number; stock: number }
  | {
      catalogKey: string;
      kind: "gem";
      gemId: ShiftyGemId;
      name: string;
      basePrice: number;
      stock: number;
    }
  | { catalogKey: string; kind: "stew"; name: string; basePrice: number; stock: number }
  | { catalogKey: string; kind: "flame"; name: string; basePrice: number; stock: number };

const CONSUMABLE_CATALOG: ConsumableEntry[] = [
  { catalogKey: "bread", kind: "bread", name: "Piece of Bread", basePrice: 3, stock: 5 },
  { catalogKey: "herb", kind: "herb", name: "Healing Herb", basePrice: 2, stock: 5 },
  { catalogKey: "cheese", kind: "cheese", name: "Cheese", basePrice: 4, stock: 3 },
  {
    catalogKey: "gem_strength",
    kind: "gem",
    gemId: "strength",
    name: "Gem of Strength",
    basePrice: 5,
    stock: 2,
  },
  {
    catalogKey: "gem_speed",
    kind: "gem",
    gemId: "speed",
    name: "Gem of Speed",
    basePrice: 5,
    stock: 2,
  },
  {
    catalogKey: "gem_healing",
    kind: "gem",
    gemId: "healing",
    name: "Gem of Healing",
    basePrice: 5,
    stock: 2,
  },
  {
    catalogKey: "gem_defense",
    kind: "gem",
    gemId: "defense",
    name: "Gem of Defense",
    basePrice: 5,
    stock: 2,
  },
  {
    catalogKey: "gem_cards",
    kind: "gem",
    gemId: "cards",
    name: "Gem of Cards",
    basePrice: 6,
    stock: 2,
  },
  {
    catalogKey: "gem_luck",
    kind: "gem",
    gemId: "luck",
    name: "Gem of Luck",
    basePrice: 7,
    stock: 2,
  },
  {
    catalogKey: "stew",
    kind: "stew",
    name: "Obamly's Special Stew",
    basePrice: 8,
    stock: 3,
  },
  {
    catalogKey: "flame",
    kind: "flame",
    name: "Flame of Destruction",
    basePrice: 6,
    stock: 1,
  },
];

function pickUnique<T>(pool: T[], count: number): T[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

function entryToListing(entry: ConsumableEntry, index: number, stockBonus: number): ShiftyListing {
  const stock = entry.stock + stockBonus;
  const base = {
    id: `obamly_${index}_${entry.catalogKey}`,
    name: entry.name,
    basePrice: entry.basePrice,
    price: entry.basePrice,
    stock,
    catalogKey: entry.catalogKey,
  };
  if (entry.kind === "gem") {
    return { ...base, kind: "gem" as const, gemId: entry.gemId };
  }
  return { ...base, kind: entry.kind };
}

function cardPriceForRarity(rarity: string): number {
  if (rarity === "Basic") return 5;
  if (rarity === "Common") return 7;
  return 9; // Uncommon
}

function pickObamlyCard(cardDefs: Map<string, CardDef>): { cardId: string; name: string; price: number } {
  const playable = [...cardDefs.entries()].filter(([, d]) => isPlayableDeckCard(d));
  const basic = playable.filter(([, d]) => d.rarity === "Basic");
  const common = playable.filter(([, d]) => d.rarity === "Common");
  const uncommon = playable.filter(([, d]) => d.rarity === "Uncommon");

  const roll = Math.random();
  let pool = basic;
  if (roll < 0.4) pool = basic.length > 0 ? basic : common.length > 0 ? common : uncommon;
  else if (roll < 0.8) pool = common.length > 0 ? common : basic.length > 0 ? basic : uncommon;
  else pool = uncommon.length > 0 ? uncommon : common.length > 0 ? common : basic;

  if (pool.length === 0) {
    return { cardId: "move", name: "Move", price: 5 };
  }
  const [cardId, def] = pool[rollInt(0, pool.length - 1)]!;
  return {
    cardId,
    name: def.name,
    price: cardPriceForRarity(def.rarity),
  };
}

/** Six consumables (+ restock guarantees) and two rarity-weighted cards. Prices are fixed. */
export function createObamlyListings(
  state: GameState,
): { listings: ShiftyListing[]; consumedRestockKeys: string[] } {
  const restock = new Set(state.obamlyRestockKeys);
  const byKey = new Map(CONSUMABLE_CATALOG.map((e) => [e.catalogKey, e]));
  const guaranteed: ConsumableEntry[] = [];
  const consumedRestockKeys: string[] = [];
  for (const key of state.obamlyRestockKeys) {
    const entry = byKey.get(key);
    if (!entry) continue;
    if (guaranteed.some((g) => g.catalogKey === key)) continue;
    guaranteed.push(entry);
    consumedRestockKeys.push(key);
  }

  const remainingSlots = Math.max(0, 6 - guaranteed.length);
  const fillerPool = CONSUMABLE_CATALOG.filter(
    (e) => !guaranteed.some((g) => g.catalogKey === e.catalogKey),
  );
  const fillers = pickUnique(fillerPool, remainingSlots);
  const consumables = [...guaranteed, ...fillers];

  const listings: ShiftyListing[] = consumables.map((entry, i) =>
    entryToListing(entry, i, restock.has(entry.catalogKey) ? 1 : 0),
  );

  for (let c = 0; c < 2; c++) {
    const card = pickObamlyCard(state.cardDefs);
    listings.push({
      id: `obamly_card_${c}_${card.cardId}`,
      kind: "card",
      name: card.name,
      basePrice: card.price,
      price: card.price,
      stock: 1,
      cardId: card.cardId,
    });
  }

  return { listings, consumedRestockKeys };
}

export function openingDialogueObamly(
  metBefore: boolean,
  leftShopThisFloor: boolean,
): { text: string; choices: ShiftyDialogueChoice[] } {
  const bestPrices = "I have the best prices in the Infinite Dungeon!";
  const choicesBrowse: ShiftyDialogueChoice[] = [
    { id: "open_shop", label: "Browse wares" },
    { id: "leave", label: "Leave" },
  ];

  if (leftShopThisFloor) {
    if (Math.random() < 0.25) {
      return { text: bestPrices, choices: choicesBrowse };
    }
    return {
      text: "I say, my goods are still fine as ever! Care to have a look?",
      choices: choicesBrowse,
    };
  }
  if (metBefore) {
    if (Math.random() < 0.25) {
      return { text: bestPrices, choices: choicesBrowse };
    }
    return {
      text: "Hello again good chap! Care to browse my wares?",
      choices: [
        { id: "open_shop", label: "Show me" },
        { id: "leave", label: "Not now" },
      ],
    };
  }
  return {
    text:
      "Good day to you, sir! I am Mr. Robert Obamly, here to sell my wares. Care to browse my fine selection?",
    choices: [
      { id: "open_shop", label: "Let's trade" },
      { id: "leave", label: "Maybe later" },
    ],
  };
}

export function confirmDialogueObamly(listing: ShiftyListing): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  let text = "Having some spare cardboard on hand is always useful.";
  if (listing.kind === "bread" || listing.kind === "herb" || listing.kind === "cheese") {
    text = "Always good to keep your food supplies high down in this Dungeon.";
  } else if (listing.kind === "gem") {
    switch (listing.gemId) {
      case "strength":
        text =
          "As they always say, a good offense is the best defense! Or is it the otherway round...";
        break;
      case "speed":
        text = "A chap could outrun a raging beast with one of those!";
        break;
      case "healing":
        text = "Always good to stay healthy.";
        break;
      case "defense":
        text = "It's like they all ways say, a good defense is the best offense!";
        break;
      case "cards":
        text = "A Gem of Cards is a fine choice. That'll be six gold.";
        break;
      case "luck":
        text = "That'll be seven gold, cause seven is a lucky number!";
        break;
    }
  } else if (listing.kind === "stew") {
    text = "That's my own secret recipe! Finest stew in all the world, if I do say so myself!";
  } else if (listing.kind === "flame") {
    text = "Very useful for burning cardboard you don't want, isn't it?";
  } else if (listing.kind === "card") {
    text = "Having some spare cardboard on hand is always useful.";
  }

  return {
    text,
    choices: [
      { id: "buy", label: "Buy" },
      { id: "cancel", label: "Cancel" },
    ],
  };
}

export function soldOutDialogueObamly(itemName: string): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  return {
    text: `Great Scott! You've bought all of my ${itemName}. I'll have to restock.`,
    choices: [{ id: "open_shop", label: "Back to shop" }],
  };
}

export function brokeDialogueObamly(): { text: string; choices: ShiftyDialogueChoice[] } {
  return {
    text:
      "I say! Seems like you don't have enough money old chap. Better come back later with more.",
    choices: [{ id: "open_shop", label: "Back to shop" }],
  };
}

export function createObamlyMerchantState(state: GameState): {
  merchant: ShiftyMerchantState;
  nextRestockKeys: string[];
} {
  const { listings, consumedRestockKeys } = createObamlyListings(state);
  const consumed = new Set(consumedRestockKeys);
  const nextRestockKeys = state.obamlyRestockKeys.filter((k) => !consumed.has(k));
  return {
    merchant: {
      merchantId: "obamly",
      leftShopThisFloor: false,
      phase: "idle",
      dialogueText: "",
      dialogueChoices: [],
      listings,
      selectedListingId: null,
    },
    nextRestockKeys,
  };
}
