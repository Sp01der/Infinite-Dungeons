import { rollInt } from "../engine/combat";
import type {
  GameState,
  ShiftyDialogueChoice,
  ShiftyGemId,
  ShiftyListing,
  ShiftyMerchantState,
} from "./types";

type CatalogEntry =
  | { kind: "card"; cardId: string; name: string; basePrice: number; stock: number; shift: "normal" | "up" | "none" }
  | { kind: "bread"; name: string; basePrice: number; stock: number; shift: "normal" }
  | { kind: "herb"; name: string; basePrice: number; stock: number; shift: "lowHp" }
  | { kind: "cheese"; name: string; basePrice: number; stock: number; shift: "normal" }
  | { kind: "gem"; gemId: ShiftyGemId; name: string; basePrice: number; stock: number; shift: "normal" };

const CARD_CATALOG: CatalogEntry[] = [
  { kind: "card", cardId: "quickstep", name: "Quickstep", basePrice: 9, stock: 1, shift: "normal" },
  { kind: "card", cardId: "tactical_approach", name: "Tactical Approach", basePrice: 10, stock: 1, shift: "normal" },
  { kind: "card", cardId: "dash", name: "Dash", basePrice: 15, stock: 1, shift: "normal" },
  { kind: "card", cardId: "knockback_punch", name: "Knockback Punch", basePrice: 7, stock: 1, shift: "normal" },
  { kind: "card", cardId: "bow", name: "Bow", basePrice: 8, stock: 1, shift: "normal" },
  { kind: "card", cardId: "loot_and_scoot", name: "Loot and Scoot", basePrice: 12, stock: 1, shift: "up" },
  { kind: "card", cardId: "poisoned_blade", name: "Poisoned Blade", basePrice: 11, stock: 1, shift: "normal" },
  { kind: "card", cardId: "mace_smash", name: "Mace Smash", basePrice: 11, stock: 1, shift: "normal" },
  { kind: "card", cardId: "shield", name: "Shield", basePrice: 7, stock: 1, shift: "normal" },
  { kind: "card", cardId: "stealthy_advance", name: "Stealthy Advance", basePrice: 7, stock: 1, shift: "normal" },
  { kind: "card", cardId: "knife", name: "Knife", basePrice: 9, stock: 1, shift: "normal" },
  { kind: "card", cardId: "spear", name: "Spear", basePrice: 8, stock: 1, shift: "normal" },
  { kind: "card", cardId: "parry", name: "Parry", basePrice: 5, stock: 1, shift: "none" },
  { kind: "card", cardId: "axe", name: "Axe", basePrice: 8, stock: 1, shift: "normal" },
  { kind: "card", cardId: "focus", name: "Focus", basePrice: 14, stock: 1, shift: "up" },
  { kind: "card", cardId: "potion_of_harming", name: "Potion of Harming", basePrice: 12, stock: 1, shift: "normal" },
];

const CONSUMABLE_CATALOG: CatalogEntry[] = [
  { kind: "bread", name: "Piece of Bread", basePrice: 3, stock: 5, shift: "normal" },
  { kind: "herb", name: "Healing Herb", basePrice: 2, stock: 5, shift: "lowHp" },
  { kind: "cheese", name: "Cheese", basePrice: 4, stock: 3, shift: "normal" },
  { kind: "gem", gemId: "strength", name: "Gem of Strength", basePrice: 8, stock: 2, shift: "normal" },
  { kind: "gem", gemId: "speed", name: "Gem of Speed", basePrice: 8, stock: 2, shift: "normal" },
  { kind: "gem", gemId: "luck", name: "Gem of Luck", basePrice: 10, stock: 2, shift: "normal" },
  { kind: "gem", gemId: "cards", name: "Gem of Cards", basePrice: 8, stock: 2, shift: "normal" },
  { kind: "gem", gemId: "healing", name: "Gem of Healing", basePrice: 8, stock: 2, shift: "normal" },
  { kind: "gem", gemId: "defense", name: "Gem of Defense", basePrice: 8, stock: 2, shift: "normal" },
];

const CONFIRM_LINES = [
  "I see you have an eye for quality!",
  "I risked my life getting that one!",
  "I'm sellin' it at half price. Normally its way more expensive!",
];

function shiftPrice(
  base: number,
  mode: CatalogEntry["shift"],
  state: GameState,
): number {
  if (mode === "none") return Math.max(1, base);
  if (mode === "lowHp") {
    const low = state.player.hp < state.player.maxHp * 0.5;
    if (!low) return Math.max(1, base);
  }
  const delta = rollInt(0, 5);
  if (mode === "up") return Math.max(1, base + delta);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return Math.max(1, base + sign * delta);
}

function pickUnique<T>(pool: T[], count: number): T[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

/** Build three cards + three consumables with this encounter’s shifted prices. */
export function createShiftyListings(state: GameState): ShiftyListing[] {
  const cards = pickUnique(CARD_CATALOG, 3);
  const consumables = pickUnique(CONSUMABLE_CATALOG, 3);
  const picked = [...cards, ...consumables];
  return picked.map((entry, i) => {
    const price = shiftPrice(entry.basePrice, entry.shift, state);
    if (entry.kind === "card") {
      return {
        id: `shifty_${i}_${entry.cardId}`,
        kind: "card" as const,
        name: entry.name,
        basePrice: entry.basePrice,
        price,
        stock: entry.stock,
        cardId: entry.cardId,
      };
    }
    if (entry.kind === "gem") {
      return {
        id: `shifty_${i}_gem_${entry.gemId}`,
        kind: "gem" as const,
        name: entry.name,
        basePrice: entry.basePrice,
        price,
        stock: entry.stock,
        gemId: entry.gemId,
      };
    }
    return {
      id: `shifty_${i}_${entry.kind}`,
      kind: entry.kind,
      name: entry.name,
      basePrice: entry.basePrice,
      price,
      stock: entry.stock,
    };
  });
}

/** With Obamly available: Shifty appears 25% of the time; otherwise Obamly. */
export function pickStairMerchantId(): "shifty" | "obamly" {
  return Math.random() < 0.25 ? "shifty" : "obamly";
}

export function openingDialogue(metBefore: boolean, leftShopThisFloor: boolean): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  if (leftShopThisFloor) {
    return {
      text: "Changed your mind? I still have plenty of goods!",
      choices: [
        { id: "open_shop", label: "Browse wares" },
        { id: "leave", label: "Leave" },
      ],
    };
  }
  if (metBefore) {
    return {
      text: "Hello again. Care to have a look at my quality wares?",
      choices: [
        { id: "open_shop", label: "Show me" },
        { id: "leave", label: "Not now" },
      ],
    };
  }
  return {
    text:
      "Greetings! You may address me as Shifty. I am a merchant who has set up shop here in the Infinite Dungeon. It's pretty dangerous down here, but there's loads of treasure!",
    choices: [
      { id: "open_shop", label: "Let's trade" },
      { id: "leave", label: "Maybe later" },
    ],
  };
}

export function confirmDialogue(itemName: string): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  const flavor =
    Math.random() < 0.25
      ? `You can't go wrong with buying a ${itemName}`
      : CONFIRM_LINES[Math.floor(Math.random() * CONFIRM_LINES.length)]!;
  return {
    text: `Ahh, thats a fine choice. ${flavor}`,
    choices: [
      { id: "buy", label: "Buy" },
      { id: "cancel", label: "Cancel" },
    ],
  };
}

export function createShiftyMerchantState(
  state: GameState,
  _metBefore: boolean,
): ShiftyMerchantState {
  return {
    merchantId: "shifty",
    leftShopThisFloor: false,
    phase: "idle",
    dialogueText: "",
    dialogueChoices: [],
    listings: createShiftyListings(state),
    selectedListingId: null,
  };
}
