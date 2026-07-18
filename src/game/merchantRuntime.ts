import type { DispatchResult, GameCommand, GameState, ShiftyListing } from "./types";
import {
  confirmDialogue,
  createShiftyMerchantState,
  openingDialogue,
  shouldSpawnShifty,
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
  if (!shouldSpawnShifty(s)) {
    return log(s, "The stair chamber is empty of traders.");
  }
  return log(
    {
      ...s,
      merchantState: createShiftyMerchantState(s, s.shiftyMet),
    },
    "Shifty sets up shop in the stair chamber.",
  );
}

export function handleMerchantCommand(state: GameState, cmd: GameCommand): DispatchResult | null {
  switch (cmd.type) {
    case "TALK_TO_MERCHANT": {
      if (state.phase !== "peace" || !state.merchantState || !sameRoomAsMerchant(state)) {
        return noHits(state);
      }
      const ms = state.merchantState;
      const open = openingDialogue(state.shiftyMet, ms.leftShopThisFloor);
      return noHits({
        ...state,
        shiftyMet: true,
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
            ...state,
            shiftyMet: true,
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
          ...state,
          shiftyMet: true,
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
            return noHits({
              ...state,
              merchantState: {
                ...ms,
                phase: "dialogue",
                dialogueText: "You don't have enough gold! You trying to rip me off?",
                dialogueChoices: [{ id: "open_shop", label: "Back to shop" }],
                selectedListingId: null,
              },
            });
          }
          let s: GameState = {
            ...state,
            player: { ...state.player, gold: state.player.gold - listing.price },
          };
          s = grantListing(s, listing);
          const listings = ms.listings
            .map((l) => (l.id === listing.id ? { ...l, stock: l.stock - 1 } : l))
            .filter((l) => l.stock > 0);
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
      const conf = confirmDialogue(listing.name);
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
