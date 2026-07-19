import type { DispatchResult, GameCommand, GameState, ShiftyListing } from "./types";
import {
  brokeDialogueObamly,
  confirmDialogueObamly,
  createObamlyMerchantState,
  openingDialogueObamly,
  soldOutDialogueObamly,
} from "./obamly";
import {
  confirmDialogue,
  createShiftyMerchantState,
  openingDialogue,
  pickStairMerchantId,
} from "./shifty";

function log(state: GameState, line: string): GameState {
  return { ...state, log: [...state.log.slice(-50), line] };
}

function noHits(s: GameState): DispatchResult {
  return { state: s, hits: [], anims: [] };
}

function sameRoomAsMerchant(s: GameState): boolean {
  if (!s.stairFeatures) return false;
  const m = s.stairFeatures.merchant;
  const pr = s.roomIds[s.player.y]?.[s.player.x] ?? -1;
  const mr = s.roomIds[m.y]?.[m.x] ?? -1;
  return pr >= 0 && pr === mr;
}

function isConsumableListing(listing: ShiftyListing): boolean {
  return listing.kind !== "card";
}

function grantListing(s: GameState, listing: ShiftyListing): GameState {
  if (listing.kind === "card" && listing.cardId) {
    const nm = s.cardDefs.get(listing.cardId)?.name ?? listing.cardId;
    return log(
      {
        ...s,
        player: {
          ...s.player,
          discardPile: [...s.player.discardPile, listing.cardId],
        },
      },
      `Bought ${nm} for ${listing.price} gold.`,
    );
  }
  if (listing.kind === "bread") {
    return log(
      { ...s, player: { ...s.player, bread: s.player.bread + 1 } },
      `Bought bread for ${listing.price} gold.`,
    );
  }
  if (listing.kind === "herb") {
    return log(
      { ...s, player: { ...s.player, herb: s.player.herb + 1 } },
      `Bought a healing herb for ${listing.price} gold.`,
    );
  }
  if (listing.kind === "cheese") {
    return log(
      { ...s, player: { ...s.player, cheese: s.player.cheese + 1 } },
      `Bought cheese for ${listing.price} gold.`,
    );
  }
  if (listing.kind === "stew") {
    return log(
      { ...s, player: { ...s.player, stew: s.player.stew + 1 } },
      `Bought Obamly's Special Stew for ${listing.price} gold.`,
    );
  }
  if (listing.kind === "flame") {
    return log(
      {
        ...s,
        player: {
          ...s.player,
          flameOfDestruction: s.player.flameOfDestruction + 1,
        },
      },
      `Bought Flame of Destruction for ${listing.price} gold.`,
    );
  }
  if (listing.kind === "gem" && listing.gemId) {
    return log(
      {
        ...s,
        player: {
          ...s.player,
          gems: {
            ...s.player.gems,
            [listing.gemId]: s.player.gems[listing.gemId] + 1,
          },
        },
      },
      `Bought ${listing.name} for ${listing.price} gold.`,
    );
  }
  return s;
}

export function spawnMerchantAfterGauntlet(s: GameState): GameState {
  const id = pickStairMerchantId();
  if (id === "shifty") {
    return log(
      {
        ...s,
        merchantState: createShiftyMerchantState(s, s.shiftyMet),
      },
      "Shifty sets up shop in the stair chamber.",
    );
  }
  const { merchant, nextRestockKeys } = createObamlyMerchantState(s);
  return log(
    {
      ...s,
      obamlyRestockKeys: nextRestockKeys,
      merchantState: merchant,
    },
    "Mr. Robert Obamly sets up shop in the stair chamber.",
  );
}

function markMet(state: GameState, merchantId: "shifty" | "obamly"): GameState {
  if (merchantId === "shifty") return { ...state, shiftyMet: true };
  return { ...state, obamlyMet: true };
}

function metBefore(state: GameState, merchantId: "shifty" | "obamly"): boolean {
  return merchantId === "shifty" ? state.shiftyMet : state.obamlyMet;
}

export function handleMerchantCommand(state: GameState, cmd: GameCommand): DispatchResult | null {
  switch (cmd.type) {
    case "TALK_TO_MERCHANT": {
      if (state.phase !== "peace" || !state.merchantState || !sameRoomAsMerchant(state)) {
        return noHits(state);
      }
      const ms = state.merchantState;
      const open =
        ms.merchantId === "obamly"
          ? openingDialogueObamly(metBefore(state, "obamly"), ms.leftShopThisFloor)
          : openingDialogue(metBefore(state, "shifty"), ms.leftShopThisFloor);
      return noHits({
        ...markMet(state, ms.merchantId),
        merchantState: {
          ...ms,
          phase: "dialogue",
          dialogueText: open.text,
          dialogueChoices: open.choices,
          selectedListingId: null,
        },
      });
    }
    case "RESOLVE_MERCHANT_DIALOGUE": {
      const ms = state.merchantState;
      if (!ms) return noHits(state);
      if (ms.phase === "dialogue") {
        if (cmd.choiceId === "open_shop") {
          return noHits({
            ...markMet(state, ms.merchantId),
            merchantState: {
              ...ms,
              phase: "shop",
              dialogueText: "",
              dialogueChoices: [],
              selectedListingId: null,
            },
          });
        }
        return noHits({
          ...markMet(state, ms.merchantId),
          merchantState: {
            ...ms,
            phase: "idle",
            leftShopThisFloor: true,
            dialogueText: "",
            dialogueChoices: [],
            selectedListingId: null,
          },
        });
      }
      if (ms.phase === "confirm") {
        const listing = ms.listings.find((l) => l.id === ms.selectedListingId);
        if (cmd.choiceId === "cancel" || !listing) {
          return noHits({
            ...state,
            merchantState: {
              ...ms,
              phase: "shop",
              dialogueText: "",
              dialogueChoices: [],
              selectedListingId: null,
            },
          });
        }
        if (cmd.choiceId === "buy") {
          if (state.player.gold < listing.price) {
            const broke =
              ms.merchantId === "obamly"
                ? brokeDialogueObamly()
                : {
                    text: "You don't have enough gold! You trying to rip me off?",
                    choices: [{ id: "open_shop" as const, label: "Back to shop" }],
                  };
            return noHits({
              ...state,
              merchantState: {
                ...ms,
                phase: "dialogue",
                dialogueText: broke.text,
                dialogueChoices: broke.choices,
                selectedListingId: null,
              },
            });
          }
          let s: GameState = {
            ...state,
            player: { ...state.player, gold: state.player.gold - listing.price },
          };
          s = grantListing(s, listing);
          const newStock = listing.stock - 1;
          const listings = ms.listings
            .map((l) => (l.id === listing.id ? { ...l, stock: newStock } : l))
            .filter((l) => l.stock > 0);

          if (
            ms.merchantId === "obamly" &&
            isConsumableListing(listing) &&
            newStock <= 0 &&
            listing.catalogKey
          ) {
            const restockKeys = s.obamlyRestockKeys.includes(listing.catalogKey)
              ? s.obamlyRestockKeys
              : [...s.obamlyRestockKeys, listing.catalogKey];
            const sold = soldOutDialogueObamly(listing.name);
            return noHits({
              ...s,
              obamlyRestockKeys: restockKeys,
              merchantState: {
                ...ms,
                phase: "dialogue",
                dialogueText: sold.text,
                dialogueChoices: sold.choices,
                selectedListingId: null,
                listings,
              },
            });
          }

          return noHits({
            ...s,
            merchantState: {
              ...ms,
              phase: "shop",
              dialogueText: "",
              dialogueChoices: [],
              selectedListingId: null,
              listings,
            },
          });
        }
      }
      if (cmd.choiceId === "open_shop") {
        return noHits({
          ...state,
          merchantState: {
            ...ms,
            phase: "shop",
            dialogueText: "",
            dialogueChoices: [],
            selectedListingId: null,
          },
        });
      }
      return noHits(state);
    }
    case "SELECT_MERCHANT_ITEM": {
      const ms = state.merchantState;
      if (!ms || ms.phase !== "shop") return noHits(state);
      const listing = ms.listings.find((l) => l.id === cmd.listingId && l.stock > 0);
      if (!listing) return noHits(state);
      const conf =
        ms.merchantId === "obamly" ? confirmDialogueObamly(listing) : confirmDialogue(listing.name);
      return noHits({
        ...state,
        merchantState: {
          ...ms,
          phase: "confirm",
          dialogueText: conf.text,
          dialogueChoices: conf.choices,
          selectedListingId: listing.id,
        },
      });
    }
    case "CLOSE_MERCHANT_SHOP": {
      const ms = state.merchantState;
      if (!ms) return noHits(state);
      return noHits({
        ...state,
        merchantState: {
          ...ms,
          phase: "idle",
          leftShopThisFloor: true,
          dialogueText: "",
          dialogueChoices: [],
          selectedListingId: null,
        },
      });
    }
    default:
      return null;
  }
}

export function merchantUiBlocks(s: GameState): boolean {
  const ms = s.merchantState;
  if (!ms) return false;
  return ms.phase === "dialogue" || ms.phase === "confirm" || ms.phase === "shop";
}

export function merchantShopOpen(s: GameState): boolean {
  return s.merchantState?.phase === "shop";
}

export function merchantDialogueOpen(s: GameState): boolean {
  const p = s.merchantState?.phase;
  return p === "dialogue" || p === "confirm";
}

export function merchantDisplayName(s: GameState): string {
  const id = s.merchantState?.merchantId;
  if (id === "obamly") return "Mr. Robert Obamly";
  if (id === "shifty") return "Shifty";
  return "the merchant";
}
