import { rollInt } from "../engine/combat";
import type {
  GameState,
  ShiftyDialogueChoice,
  ShiftyGemId,
  ShiftyListing,
  ShiftyMerchantState,
} from "./types";

type ConsumableEntry =
  | {
      catalogKey: string;
      kind: "gem";
      gemId: ShiftyGemId;
      name: string;
      basePrice: number;
    }
  | { catalogKey: string; kind: "flame"; name: string; basePrice: number; stock: number };

const CONSUMABLE_CATALOG: ConsumableEntry[] = [
  { catalogKey: "gem_strength", kind: "gem", gemId: "strength", name: "Gem of Strength", basePrice: 6 },
  { catalogKey: "gem_healing", kind: "gem", gemId: "healing", name: "Gem of Healing", basePrice: 6 },
  { catalogKey: "gem_defense", kind: "gem", gemId: "defense", name: "Gem of Defense", basePrice: 6 },
  { catalogKey: "gem_cards", kind: "gem", gemId: "cards", name: "Gem of Cards", basePrice: 6 },
  { catalogKey: "gem_luck", kind: "gem", gemId: "luck", name: "Gem of Luck", basePrice: 7 },
  { catalogKey: "flame", kind: "flame", name: "Flame of Destruction", basePrice: 6, stock: 2 },
];

type CardEntry = { cardId: string; name: string; basePrice: number; weight: number };

const CARD_CATALOG: CardEntry[] = [
  { cardId: "shining_blade", name: "Shining Blade", basePrice: 6, weight: 1 },
  { cardId: "arcane_shield", name: "Arcane Shield", basePrice: 7, weight: 1 },
  { cardId: "fireball", name: "Fireball", basePrice: 8, weight: 1 },
  { cardId: "magic_missile", name: "Magic Missile", basePrice: 9, weight: 1 },
  { cardId: "arcane_charge", name: "Arcane Charge", basePrice: 10, weight: 2 },
  { cardId: "lightning_bolt", name: "Lightning Bolt", basePrice: 14, weight: 1 },
];

/** Bind an Unbound Tome with one of these spells (player provides the tome). */
export const SENNIS_BIND_OPTIONS: { cardId: string; name: string; cost: number }[] = [
  { cardId: "shining_blade", name: "Shining Blade", cost: 3 },
  { cardId: "arcane_shield", name: "Arcane Shield", cost: 3 },
  { cardId: "fireball", name: "Fireball", cost: 4 },
  { cardId: "magic_missile", name: "Magic Missile", cost: 4 },
  { cardId: "lightning_bolt", name: "Lightning Bolt", cost: 5 },
  { cardId: "arcane_charge", name: "Arcane Charge", cost: 5 },
];

export const SENNIS_UNBOUND_TOME_BUY_PRICE = 4;
export const SENNIS_UNBOUND_TOME_SELL_PRICE = 3;

function pickUniqueWeighted(pool: CardEntry[], count: number): CardEntry[] {
  const remaining = [...pool];
  const picked: CardEntry[] = [];
  for (let n = 0; n < count && remaining.length > 0; n++) {
    const total = remaining.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < remaining.length; i++) {
      roll -= remaining[i]!.weight;
      if (roll <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(remaining[idx]!);
    remaining.splice(idx, 1);
  }
  return picked;
}

function pickUniqueConsumables(count: number): ConsumableEntry[] {
  const copy = [...CONSUMABLE_CATALOG];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

export function createSennisListings(): ShiftyListing[] {
  const threeConsumables = Math.random() < 0.5;
  const consCount = threeConsumables ? 3 : 2;
  const cardCount = threeConsumables ? 2 : 3;
  const consumables = pickUniqueConsumables(consCount);
  const cards = pickUniqueWeighted(CARD_CATALOG, cardCount);
  const listings: ShiftyListing[] = [];
  let i = 0;
  for (const entry of consumables) {
    if (entry.kind === "gem") {
      listings.push({
        id: `sennis_${i}_${entry.catalogKey}`,
        kind: "gem",
        name: entry.name,
        basePrice: entry.basePrice,
        price: entry.basePrice,
        stock: rollInt(1, 2),
        gemId: entry.gemId,
        catalogKey: entry.catalogKey,
      });
    } else {
      listings.push({
        id: `sennis_${i}_${entry.catalogKey}`,
        kind: "flame",
        name: entry.name,
        basePrice: entry.basePrice,
        price: entry.basePrice,
        stock: entry.stock,
        catalogKey: entry.catalogKey,
      });
    }
    i += 1;
  }
  for (const entry of cards) {
    listings.push({
      id: `sennis_${i}_${entry.cardId}`,
      kind: "card",
      name: entry.name,
      basePrice: entry.basePrice,
      price: entry.basePrice,
      stock: 1,
      cardId: entry.cardId,
    });
    i += 1;
  }
  return listings;
}

export function openingDialogueSennis(
  metBefore: boolean,
  leftShopThisFloor: boolean,
): { text: string; choices: ShiftyDialogueChoice[] } {
  if (leftShopThisFloor) {
    return {
      text: "I'm always willing to trade.",
      choices: [
        { id: "open_shop", label: "Browse wares" },
        { id: "leave", label: "Leave" },
      ],
    };
  }
  if (metBefore) {
    return {
      text: "Hello. Would you be willing to trade? Perhaps I could interest you in a Magic Tome.",
      choices: [
        { id: "open_shop", label: "Show me" },
        { id: "leave", label: "Not now" },
      ],
    };
  }
  return {
    text:
      "Hello. My name is Sennis of the Mage Guild. I would be willing to trade with you, for I offer powerful magic items.",
    choices: [
      { id: "open_shop", label: "Let's trade" },
      { id: "leave", label: "Maybe later" },
    ],
  };
}

export function confirmDialogueSennis(listing: ShiftyListing): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  let text = "A fine magical ware.";
  if (listing.kind === "gem") {
    text =
      "These Gems contain concentrated magical energy. Simply break it to release its power.";
  } else if (listing.kind === "flame") {
    text =
      "These Flames were created with magic, and thus can permanently destroy cards in the dungeon. Very useful.";
  } else if (listing.cardId === "shining_blade" || listing.cardId === "arcane_shield") {
    text =
      "A Basic Spell in card form. The simplest of magic. But even the simplest magic can be highly effective.";
  } else if (listing.cardId === "fireball") {
    text =
      "Beware. The rash mage will throw fireballs with no regard, and in doing so burn themselves.";
  } else if (listing.cardId === "magic_missile") {
    text = "Simple and powerful. The same attack Mystic Cores use.";
  } else if (listing.cardId === "arcane_charge") {
    text = "A specialty of the Mage Guild. Charging your magic makes it far more effective.";
  } else if (listing.cardId === "lightning_bolt") {
    text = "Such magic is dangerous, and rare. Can you wield the power of thunder?";
  }
  return {
    text,
    choices: [
      { id: "buy", label: "Buy" },
      { id: "cancel", label: "Cancel" },
    ],
  };
}

export function brokeDialogueSennis(backChoiceId: string, backLabel: string): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  return {
    text: "You'll need a bit more gold than that. Magic is expensive, you know.",
    choices: [{ id: backChoiceId, label: backLabel }],
  };
}

export function tomeFirstExplanation(): { text: string; choices: ShiftyDialogueChoice[] } {
  return {
    text:
      "Magic Tomes a books that can be imbued with magical energy from cards. This is called Binding. Once Bound, they can expel the energy to achieve various effects. Doing so does damage the Tome though, so they don't last forever.",
    choices: [{ id: "tome_hub", label: "Continue" }],
  };
}

export function tomeHubDialogue(): { text: string; choices: ShiftyDialogueChoice[] } {
  return {
    text: "What would you like to do with Magic Tomes?",
    choices: [
      { id: "tome_buy_offer", label: "Buy Magic Tomes" },
      { id: "tome_bind_menu", label: "Bind Magic Tomes" },
      { id: "tome_sell_menu", label: "Sell Magic Tomes" },
      { id: "open_shop", label: "Back to shop" },
    ],
  };
}

export function tomeBuyOfferDialogue(): { text: string; choices: ShiftyDialogueChoice[] } {
  return {
    text: `I will sell you an unbound Tome for ${SENNIS_UNBOUND_TOME_BUY_PRICE} gold.`,
    choices: [
      { id: "buy_unbound_tome", label: "Buy" },
      { id: "tome_hub", label: "Cancel" },
    ],
  };
}

export function tomeBindIntroDialogue(state: GameState): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  if (state.player.unboundTomes <= 0) {
    return {
      text: "You may give me an Unbound Tome and I can Bind it for you. You don't have an Unbound Tome right now.",
      choices: [{ id: "tome_hub", label: "Back" }],
    };
  }
  const choices: ShiftyDialogueChoice[] = SENNIS_BIND_OPTIONS.map((o) => ({
    id: `bind_${o.cardId}`,
    label: `${o.name} — ${o.cost}G`,
  }));
  choices.push({ id: "tome_hub", label: "Cancel" });
  return {
    text: "You may give me an Unbound Tome and I can Bind it for you.",
    choices,
  };
}

export function tomeSellDialogue(state: GameState): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  const choices: ShiftyDialogueChoice[] = [];
  if (state.player.unboundTomes > 0) {
    choices.push({
      id: "sell_unbound",
      label: `Unbound Tome ×${state.player.unboundTomes} — ${SENNIS_UNBOUND_TOME_SELL_PRICE}G`,
    });
  }
  for (const tome of state.player.boundTomes) {
    const nm = state.cardDefs.get(tome.cardId)?.name ?? tome.cardId;
    const price = SENNIS_UNBOUND_TOME_SELL_PRICE + tome.charges;
    choices.push({
      id: `sell_bound_${tome.id}`,
      label: `Bound (${nm}, ${tome.charges} charges) — ${price}G`,
    });
  }
  if (choices.length === 0) {
    return {
      text:
        "I will buy an Unbound Tome for 3 gold. If you have a Bound Tome, I'll give you an extra gold for each Charge remaining. You have none to sell.",
      choices: [{ id: "tome_hub", label: "Back" }],
    };
  }
  choices.push({ id: "tome_hub", label: "Done" });
  return {
    text:
      "I will buy an Unbound Tome for 3 gold. If you have a Bound Tome, I'll give you an extra gold for each Charge remaining.",
    choices,
  };
}

export function bindSuccessDialogue(cardName: string): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  return {
    text: `There! This book now contains the magic of ${cardName}. It has three charges.`,
    choices: [{ id: "tome_hub", label: "Continue" }],
  };
}

export function createSennisMerchantState(_state: GameState): ShiftyMerchantState {
  return {
    merchantId: "sennis",
    leftShopThisFloor: false,
    phase: "idle",
    dialogueText: "",
    dialogueChoices: [],
    listings: createSennisListings(),
    selectedListingId: null,
  };
}
