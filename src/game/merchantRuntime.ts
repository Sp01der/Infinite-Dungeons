import type { DispatchResult, GameCommand, GameState, MerchantId, ShiftyListing } from "./types";
import {
  brokeDialogueObamly,
  confirmDialogueObamly,
  createObamlyMerchantState,
  openingDialogueObamly,
  soldOutDialogueObamly,
} from "./obamly";
import {
  bindSuccessDialogue,
  brokeDialogueSennis,
  confirmDialogueSennis,
  createSennisMerchantState,
  openingDialogueSennis,
  SENNIS_BIND_OPTIONS,
  SENNIS_UNBOUND_TOME_BUY_PRICE,
  SENNIS_UNBOUND_TOME_SELL_PRICE,
  tomeBindIntroDialogue,
  tomeBuyOfferDialogue,
  tomeFirstExplanation,
  tomeHubDialogue,
  tomeSellDialogue,
} from "./sennis";
import {
  confirmDialogue,
  createShiftyMerchantState,
  openingDialogue,
  pickStairMerchantId,
} from "./shifty";
import { addExp } from "./progression";
import {
  branchMenuDialogue,
  brokeDialogueSensei,
  canBuySenseiSkill,
  createSenseiMerchantState,
  getSenseiBranch,
  meditatingDialogue,
  notReadyDialogueSensei,
  SENSEI_TRAINING_COST,
  SENSEI_TRAINING_EXP,
  sittingDialogue,
  wiseSayingDialogue,
  type SenseiBranch,
} from "./sensei";

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
  return listing.kind !== "card" && listing.kind !== "skill";
}

function nextBoundTomeId(s: GameState): string {
  let n = 0;
  for (const t of s.player.boundTomes) {
    const m = /^tome_(\d+)$/.exec(t.id);
    if (m) n = Math.max(n, parseInt(m[1]!, 10) + 1);
  }
  return `tome_${n}`;
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
  if (listing.kind === "skill" && listing.skillId) {
    if (s.player.skillsUnlocked.includes(listing.skillId)) return s;
    return log(
      {
        ...s,
        player: {
          ...s.player,
          skillsUnlocked: [...s.player.skillsUnlocked, listing.skillId],
        },
      },
      `Learned ${listing.name} for ${listing.price} gold.`,
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
  if (id === "sennis") {
    return log(
      {
        ...s,
        merchantState: createSennisMerchantState(s),
      },
      "Sennis the Wizard sets up shop in the stair chamber.",
    );
  }
  if (id === "sensei") {
    return log(
      {
        ...s,
        merchantState: createSenseiMerchantState(s),
      },
      "Sensei Tenori meditates in the stair chamber.",
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

function markMet(state: GameState, merchantId: MerchantId): GameState {
  if (merchantId === "shifty") return { ...state, shiftyMet: true };
  if (merchantId === "obamly") return { ...state, obamlyMet: true };
  if (merchantId === "sensei") return { ...state, senseiMet: true };
  return { ...state, sennisMet: true };
}

function metBefore(state: GameState, merchantId: MerchantId): boolean {
  if (merchantId === "shifty") return state.shiftyMet;
  if (merchantId === "obamly") return state.obamlyMet;
  if (merchantId === "sensei") return state.senseiMet;
  return state.sennisMet;
}

function openingFor(state: GameState, merchantId: MerchantId, leftShopThisFloor: boolean) {
  if (merchantId === "obamly") {
    return openingDialogueObamly(metBefore(state, "obamly"), leftShopThisFloor);
  }
  if (merchantId === "sennis") {
    return openingDialogueSennis(metBefore(state, "sennis"), leftShopThisFloor);
  }
  if (merchantId === "sensei") {
    return sittingDialogue(metBefore(state, "sensei"), leftShopThisFloor);
  }
  return openingDialogue(metBefore(state, "shifty"), leftShopThisFloor);
}

function confirmFor(merchantId: MerchantId, listing: ShiftyListing) {
  if (merchantId === "obamly") return confirmDialogueObamly(listing);
  if (merchantId === "sennis") return confirmDialogueSennis(listing);
  return confirmDialogue(listing.name);
}

function setDialogue(
  state: GameState,
  phase: NonNullable<GameState["merchantState"]>["phase"],
  text: string,
  choices: { id: string; label: string }[],
  extra: Partial<NonNullable<GameState["merchantState"]>> = {},
): GameState {
  const ms = state.merchantState!;
  return {
    ...state,
    merchantState: {
      ...ms,
      ...extra,
      phase,
      dialogueText: text,
      dialogueChoices: choices,
      selectedListingId: extra.selectedListingId ?? null,
    },
  };
}

function enterTomeFlow(state: GameState): GameState {
  if (!state.sennisTomeExplained) {
    const d = tomeFirstExplanation();
    return setDialogue(state, "dialogue", d.text, d.choices);
  }
  const d = tomeHubDialogue();
  return setDialogue(state, "tome_hub", d.text, d.choices);
}

function openSenseiShop(state: GameState): GameState {
  return setDialogue(state, "shop", "", [], {
    selectedListingId: null,
    senseiBranch: null,
  });
}

function openSenseiBranch(state: GameState, branch: SenseiBranch): GameState {
  const ms = state.merchantState!;
  const d = branchMenuDialogue(state, ms.listings, branch);
  return setDialogue(state, "branch_menu", d.text, d.choices, { senseiBranch: branch });
}

function consumeListingStock(ms: NonNullable<GameState["merchantState"]>, listing: ShiftyListing) {
  const newStock = listing.stock - 1;
  return ms.listings
    .map((l) => (l.id === listing.id ? { ...l, stock: newStock } : l))
    .filter((l) => l.stock > 0);
}

function getSenseiBranchFromListing(listing: ShiftyListing | undefined): SenseiBranch | null {
  if (!listing) return null;
  for (const b of ["Attack", "Defense", "Mobility", "Vitality", "Deck"] as SenseiBranch[]) {
    const offer = getSenseiBranch(b);
    if (!offer) continue;
    if (listing.cardId === offer.card.cardId || listing.skillId === offer.skill.skillId) {
      return b;
    }
  }
  return null;
}

function handleSenseiBuy(state: GameState, listingId: string): DispatchResult {
  const ms = state.merchantState!;
  const listing = ms.listings.find((l) => l.id === listingId && l.stock > 0);
  const branch = (ms.senseiBranch ?? getSenseiBranchFromListing(listing)) as SenseiBranch | null;

  if (!listing) {
    if (branch) return noHits(openSenseiBranch(state, branch));
    return noHits(openSenseiShop(state));
  }

  if (listing.kind === "skill" && listing.skillId && branch) {
    if (!canBuySenseiSkill(state, branch, listing.skillId)) {
      const d = notReadyDialogueSensei(`sensei_branch:${branch}`, "Back");
      return noHits(setDialogue(state, "dialogue", d.text, d.choices, { senseiBranch: branch }));
    }
  }

  if (state.player.gold < listing.price) {
    const d = brokeDialogueSensei(branch ? `sensei_branch:${branch}` : "open_shop", "Back");
    return noHits(setDialogue(state, "dialogue", d.text, d.choices, { senseiBranch: branch }));
  }

  let s: GameState = {
    ...state,
    player: { ...state.player, gold: state.player.gold - listing.price },
  };
  s = grantListing(s, listing);
  const listings = consumeListingStock(ms, listing);
  s = {
    ...s,
    merchantState: {
      ...ms,
      listings,
      selectedListingId: null,
    },
  };
  if (branch) return noHits(openSenseiBranch(s, branch));
  return noHits(openSenseiShop(s));
}

function handleSenseiDialogueChoice(state: GameState, choiceId: string): DispatchResult {
  const ms = state.merchantState!;

  if (choiceId === "sensei_awaken") {
    const wasMet = state.senseiMet;
    const open = sittingDialogue(wasMet, ms.leftShopThisFloor);
    return noHits({
      ...markMet(state, "sensei"),
      merchantState: {
        ...ms,
        pose: "sitting",
        phase: "dialogue",
        dialogueText: open.text,
        dialogueChoices: open.choices,
        selectedListingId: null,
      },
    });
  }

  if (choiceId === "sensei_wise_then_shop") {
    const d = wiseSayingDialogue("open_shop", "Continue");
    return noHits(setDialogue(state, "dialogue", d.text, d.choices));
  }

  if (choiceId === "open_shop") {
    return noHits(openSenseiShop(markMet(state, "sensei")));
  }

  if (choiceId === "sensei_training_done") {
    return noHits(openSenseiShop(state));
  }

  if (choiceId.startsWith("sensei_branch:")) {
    const branch = choiceId.slice("sensei_branch:".length) as SenseiBranch;
    return noHits(openSenseiBranch(state, branch));
  }

  if (choiceId.startsWith("sensei_buy:")) {
    return handleSenseiBuy(state, choiceId.slice("sensei_buy:".length));
  }

  if (choiceId === "leave") {
    return noHits({
      ...markMet(state, "sensei"),
      merchantState: {
        ...ms,
        phase: "idle",
        leftShopThisFloor: true,
        dialogueText: "",
        dialogueChoices: [],
        selectedListingId: null,
        senseiBranch: null,
      },
    });
  }

  return noHits(state);
}

function handleSennisDialogueChoice(state: GameState, choiceId: string): DispatchResult {
  const ms = state.merchantState!;

  if (choiceId === "open_shop") {
    return noHits(
      setDialogue(state, "shop", "", [], { selectedListingId: null }),
    );
  }

  if (choiceId === "leave") {
    return noHits({
      ...markMet(state, "sennis"),
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

  if (choiceId === "tome_hub") {
    const d = tomeHubDialogue();
    return noHits({
      ...setDialogue(state, "tome_hub", d.text, d.choices),
      sennisTomeExplained: true,
    });
  }

  if (choiceId === "tome_buy_offer") {
    const d = tomeBuyOfferDialogue();
    return noHits(setDialogue(state, "tome_buy", d.text, d.choices));
  }

  if (choiceId === "buy_unbound_tome") {
    if (state.player.gold < SENNIS_UNBOUND_TOME_BUY_PRICE) {
      const broke = brokeDialogueSennis("tome_hub", "Back");
      return noHits(setDialogue(state, "tome_hub", broke.text, broke.choices));
    }
    const next = log(
      {
        ...state,
        player: {
          ...state.player,
          gold: state.player.gold - SENNIS_UNBOUND_TOME_BUY_PRICE,
          unboundTomes: state.player.unboundTomes + 1,
        },
      },
      `Bought an Unbound Magic Tome for ${SENNIS_UNBOUND_TOME_BUY_PRICE} gold.`,
    );
    const d = tomeBuyOfferDialogue();
    return noHits(setDialogue(next, "tome_buy", d.text, d.choices));
  }

  if (choiceId === "tome_bind_menu") {
    const d = tomeBindIntroDialogue(state);
    return noHits(setDialogue(state, "tome_bind", d.text, d.choices));
  }

  if (choiceId.startsWith("bind_")) {
    const cardId = choiceId.slice("bind_".length);
    const opt = SENNIS_BIND_OPTIONS.find((o) => o.cardId === cardId);
    if (!opt || state.player.unboundTomes <= 0) {
      const d = tomeBindIntroDialogue(state);
      return noHits(setDialogue(state, "tome_bind", d.text, d.choices));
    }
    if (state.player.gold < opt.cost) {
      const broke = brokeDialogueSennis("tome_bind_menu", "Back");
      return noHits(setDialogue(state, "tome_bind", broke.text, broke.choices));
    }
    const bound = {
      id: nextBoundTomeId(state),
      cardId: opt.cardId,
      charges: 3,
    };
    const next = log(
      {
        ...state,
        player: {
          ...state.player,
          gold: state.player.gold - opt.cost,
          unboundTomes: state.player.unboundTomes - 1,
          boundTomes: [...state.player.boundTomes, bound],
        },
      },
      `Sennis binds a Tome with ${opt.name}.`,
    );
    const ok = bindSuccessDialogue(opt.name);
    return noHits(setDialogue(next, "tome_hub", ok.text, ok.choices));
  }

  if (choiceId === "tome_sell_menu") {
    const d = tomeSellDialogue(state);
    return noHits(setDialogue(state, "tome_sell", d.text, d.choices));
  }

  if (choiceId === "sell_unbound") {
    if (state.player.unboundTomes <= 0) {
      const d = tomeSellDialogue(state);
      return noHits(setDialogue(state, "tome_sell", d.text, d.choices));
    }
    const next = log(
      {
        ...state,
        player: {
          ...state.player,
          gold: state.player.gold + SENNIS_UNBOUND_TOME_SELL_PRICE,
          unboundTomes: state.player.unboundTomes - 1,
        },
      },
      `Sold an Unbound Magic Tome for ${SENNIS_UNBOUND_TOME_SELL_PRICE} gold.`,
    );
    const d = tomeSellDialogue(next);
    return noHits(setDialogue(next, "tome_sell", d.text, d.choices));
  }

  if (choiceId.startsWith("sell_bound_")) {
    const tomeId = choiceId.slice("sell_bound_".length);
    const tome = state.player.boundTomes.find((t) => t.id === tomeId);
    if (!tome) {
      const d = tomeSellDialogue(state);
      return noHits(setDialogue(state, "tome_sell", d.text, d.choices));
    }
    const price = SENNIS_UNBOUND_TOME_SELL_PRICE + tome.charges;
    const nm = state.cardDefs.get(tome.cardId)?.name ?? tome.cardId;
    const next = log(
      {
        ...state,
        player: {
          ...state.player,
          gold: state.player.gold + price,
          boundTomes: state.player.boundTomes.filter((t) => t.id !== tomeId),
        },
      },
      `Sold a Bound Tome (${nm}) for ${price} gold.`,
    );
    const d = tomeSellDialogue(next);
    return noHits(setDialogue(next, "tome_sell", d.text, d.choices));
  }

  return noHits(state);
}

export function handleMerchantCommand(state: GameState, cmd: GameCommand): DispatchResult | null {
  switch (cmd.type) {
    case "TALK_TO_MERCHANT": {
      if (state.phase !== "peace" || !state.merchantState || !sameRoomAsMerchant(state)) {
        return noHits(state);
      }
      const ms = state.merchantState;
      if (ms.merchantId === "sensei" && (ms.pose ?? "meditating") === "meditating") {
        const open = meditatingDialogue();
        return noHits({
          ...state,
          merchantState: {
            ...ms,
            phase: "dialogue",
            dialogueText: open.text,
            dialogueChoices: open.choices,
            selectedListingId: null,
          },
        });
      }
      const open = openingFor(state, ms.merchantId, ms.leftShopThisFloor);
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
    case "OPEN_MERCHANT_TOMES": {
      const ms = state.merchantState;
      if (!ms || ms.merchantId !== "sennis" || ms.phase !== "shop") return noHits(state);
      return noHits(enterTomeFlow(state));
    }
    case "OPEN_SENSEI_TRAINING": {
      const ms = state.merchantState;
      if (!ms || ms.merchantId !== "sensei" || ms.phase !== "shop") return noHits(state);
      if (state.player.gold < SENSEI_TRAINING_COST) {
        const d = brokeDialogueSensei("open_shop", "Back to shop");
        return noHits(setDialogue(state, "dialogue", d.text, d.choices));
      }
      let s: GameState = {
        ...state,
        player: { ...state.player, gold: state.player.gold - SENSEI_TRAINING_COST },
      };
      s = addExp(s, SENSEI_TRAINING_EXP);
      s = log(s, `Trained with Sensei Tenori (+${SENSEI_TRAINING_EXP} EXP).`);
      const d = wiseSayingDialogue("sensei_training_done", "Continue");
      return noHits(
        setDialogue(s, "dialogue", d.text, d.choices, {
          pose: "standing",
          senseiBranch: null,
        }),
      );
    }
    case "OPEN_SENSEI_BRANCH": {
      const ms = state.merchantState;
      if (!ms || ms.merchantId !== "sensei" || ms.phase !== "shop") return noHits(state);
      return noHits(openSenseiBranch(state, cmd.branch));
    }
    case "RESOLVE_MERCHANT_DIALOGUE": {
      const ms = state.merchantState;
      if (!ms) return noHits(state);

      if (ms.merchantId === "sensei") {
        if (ms.phase === "dialogue" || ms.phase === "branch_menu") {
          return handleSenseiDialogueChoice(state, cmd.choiceId);
        }
        return noHits(state);
      }

      if (ms.merchantId === "sennis") {
        if (ms.phase === "confirm") {
          const listing = ms.listings.find((l) => l.id === ms.selectedListingId);
          if (cmd.choiceId === "cancel" || !listing) {
            return noHits(
              setDialogue(state, "shop", "", [], { selectedListingId: null }),
            );
          }
          if (cmd.choiceId === "buy") {
            if (state.player.gold < listing.price) {
              const broke = brokeDialogueSennis("open_shop", "Back to shop");
              return noHits(setDialogue(state, "dialogue", broke.text, broke.choices));
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

        const tomePhases = new Set([
          "dialogue",
          "tome_hub",
          "tome_buy",
          "tome_bind",
          "tome_sell",
        ]);
        if (tomePhases.has(ms.phase)) {
          return handleSennisDialogueChoice(state, cmd.choiceId);
        }
        return noHits(state);
      }

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
      if (ms.merchantId === "sensei") return noHits(state);
      const listing = ms.listings.find((l) => l.id === cmd.listingId && l.stock > 0);
      if (!listing) return noHits(state);
      const conf = confirmFor(ms.merchantId, listing);
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
          senseiBranch: null,
        },
      });
    }
    default:
      return null;
  }
}

const DIALOGUE_PHASES = new Set([
  "dialogue",
  "confirm",
  "tome_hub",
  "tome_buy",
  "tome_bind",
  "tome_sell",
  "branch_menu",
]);

export function merchantUiBlocks(s: GameState): boolean {
  const ms = s.merchantState;
  if (!ms) return false;
  return ms.phase === "shop" || DIALOGUE_PHASES.has(ms.phase);
}

export function merchantShopOpen(s: GameState): boolean {
  return s.merchantState?.phase === "shop";
}

export function merchantDialogueOpen(s: GameState): boolean {
  const p = s.merchantState?.phase;
  return !!p && DIALOGUE_PHASES.has(p);
}

export function merchantDisplayName(s: GameState): string {
  const id = s.merchantState?.merchantId;
  if (id === "obamly") return "Mr. Robert Obamly";
  if (id === "shifty") return "Shifty";
  if (id === "sennis") return "Sennis";
  if (id === "sensei") return "Sensei Tenori";
  return "the merchant";
}
