import type { SkillCategory } from "./skillDefs";
import { getSkillDef, SKILL_DEFS } from "./skillDefs";
import type {
  GameState,
  ShiftyDialogueChoice,
  ShiftyListing,
  ShiftyMerchantState,
} from "./types";

export type SenseiPose = "meditating" | "sitting" | "standing";
export type SenseiBranch = SkillCategory;

export const SENSEI_TRAINING_COST = 3;
export const SENSEI_TRAINING_EXP = 5;
export const SENSEI_SKILL_COST = 10;
export const SENSEI_SKILL_TREE_REQUIREMENT = 2;

export const SENSEI_WISE_SAYINGS: string[] = [
  "Know your foe. Understanding the weaknesses and strengths of your enemy is key to victory.",
  "Always be ready. The Dungeon is not above dirty tricks and ambushes.",
  "He who utilizes every tool at his disposal will be victorious. Cards, items, even the dungeon itself can all be of use.",
  "Knowing when to fight and when to run is the deciding factor between dying and living.",
  "He who can adapt to the Dungeon's ways will survive. He who does not will surely perish.",
  "The Dungeon will not let those who are not worthy descend to its depths. You must prove your strength and cunning.",
  "There are many powerful relics in the Dungeon, not all of them are to be tampered with. Those who use powers they cannot control create their own demise.",
  "Beware the lure of enchanted gold, for in the depths lurk those that come from the abyss.",
];

type BranchOffer = {
  branch: SenseiBranch;
  quote: string;
  card: { cardId: string; name: string; price: number };
  skill: { skillId: string; name: string; price: number };
};

export const SENSEI_BRANCHES: BranchOffer[] = [
  {
    branch: "Attack",
    quote:
      "A force divided is weak, only when all your energy is focused into one space will you triumph.",
    card: { cardId: "perfected_strike", name: "Perfected Strike", price: 10 },
    skill: { skillId: "atk_guard_destroyer", name: "Guard Destroyer", price: SENSEI_SKILL_COST },
  },
  {
    branch: "Defense",
    quote:
      "To leave oneself unguarded is foolishness, the strongest warrior may be felled if he does not protect himself.",
    card: { cardId: "fortify", name: "Fortify", price: 8 },
    skill: { skillId: "def_keep_up_your_guard", name: "Keep up your Guard", price: SENSEI_SKILL_COST },
  },
  {
    branch: "Mobility",
    quote:
      "He who stays still in the Dungeon risks his life. It is not cowardly to retreat when you cannot defeat your foe.",
    card: { cardId: "stay_on_the_move", name: "Stay on the Move", price: 8 },
    skill: { skillId: "mob_always_moving", name: "Always Moving", price: SENSEI_SKILL_COST },
  },
  {
    branch: "Vitality",
    quote:
      "Even the greatest fighter can be hurt sometimes, and when that happens, one must recover quickly.",
    card: { cardId: "heal", name: "Heal", price: 10 },
    skill: { skillId: "vit_keep_fighting", name: "Keep Fighting", price: SENSEI_SKILL_COST },
  },
  {
    branch: "Deck",
    quote:
      "In this Dungeon we must use cards. Even the strongest warrior could barely move without the power of these magical cards. Thus, it is important to manage your deck.",
    card: { cardId: "evaluate", name: "Evaluate", price: 10 },
    skill: { skillId: "deck_foresight", name: "Foresight", price: SENSEI_SKILL_COST },
  },
];

export function randomWiseSaying(): string {
  return SENSEI_WISE_SAYINGS[Math.floor(Math.random() * SENSEI_WISE_SAYINGS.length)]!;
}

export function createSenseiListings(): ShiftyListing[] {
  const listings: ShiftyListing[] = [];
  for (const b of SENSEI_BRANCHES) {
    listings.push({
      id: `sensei_card_${b.card.cardId}`,
      kind: "card",
      name: b.card.name,
      basePrice: b.card.price,
      price: b.card.price,
      stock: 1,
      cardId: b.card.cardId,
      catalogKey: `sensei_card_${b.card.cardId}`,
    });
    listings.push({
      id: `sensei_skill_${b.skill.skillId}`,
      kind: "skill",
      name: b.skill.name,
      basePrice: b.skill.price,
      price: b.skill.price,
      stock: 1,
      skillId: b.skill.skillId,
      catalogKey: `sensei_skill_${b.skill.skillId}`,
    });
  }
  return listings;
}

export function createSenseiMerchantState(_state: GameState): ShiftyMerchantState {
  return {
    merchantId: "sensei",
    leftShopThisFloor: false,
    phase: "idle",
    dialogueText: "",
    dialogueChoices: [],
    listings: createSenseiListings(),
    selectedListingId: null,
    pose: "meditating",
    senseiBranch: null,
  };
}

export function meditatingDialogue(): { text: string; choices: ShiftyDialogueChoice[] } {
  return {
    text: "The stars shine upon our meeting. Experience is the teacher of all things, and I offer it to you. I will train you, if you wish.",
    choices: [{ id: "sensei_awaken", label: "Continue" }],
  };
}

export function sittingDialogue(
  metBefore: boolean,
  leftShopThisFloor: boolean,
): { text: string; choices: ShiftyDialogueChoice[] } {
  const choices: ShiftyDialogueChoice[] = [
    { id: "sensei_wise_then_shop", label: "Train with me" },
    { id: "leave", label: "Leave" },
  ];
  if (leftShopThisFloor) {
    return { text: "Do you seek my teaching?", choices };
  }
  if (metBefore) {
    return { text: "Greetings once more. Do you wish to train with me?", choices };
  }
  return {
    text: "I am Sensei Tenori, trained by Sensei Gernio. I am a master fighter, and accustomed to the ways of the Infinite Dungeon. I can train you many skills useful to you here.",
    choices,
  };
}

export function wiseSayingDialogue(nextChoiceId: string, nextLabel: string): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  return {
    text: randomWiseSaying(),
    choices: [{ id: nextChoiceId, label: nextLabel }],
  };
}

export function brokeDialogueSensei(backChoiceId: string, backLabel: string): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  return {
    text: "I am sorry. My time is valuable, and I cannot train you if you cannot make it worth my while.",
    choices: [{ id: backChoiceId, label: backLabel }],
  };
}

export function notReadyDialogueSensei(backChoiceId: string, backLabel: string): {
  text: string;
  choices: ShiftyDialogueChoice[];
} {
  return {
    text: "You are not yet ready. Return when you have learned two skills of this path.",
    choices: [{ id: backChoiceId, label: backLabel }],
  };
}

export function countSkillsInBranch(state: GameState, branch: SenseiBranch): number {
  return state.player.skillsUnlocked.filter((id) => {
    const def = getSkillDef(id);
    return def?.category === branch && !def.merchantOnly;
  }).length;
}

export function canBuySenseiSkill(state: GameState, branch: SenseiBranch, skillId: string): boolean {
  if (state.player.skillsUnlocked.includes(skillId)) return false;
  return countSkillsInBranch(state, branch) >= SENSEI_SKILL_TREE_REQUIREMENT;
}

export function getSenseiBranch(branch: SenseiBranch): BranchOffer | undefined {
  return SENSEI_BRANCHES.find((b) => b.branch === branch);
}

export function branchMenuDialogue(
  state: GameState,
  listings: ShiftyListing[],
  branch: SenseiBranch,
): { text: string; choices: ShiftyDialogueChoice[] } {
  const offer = getSenseiBranch(branch);
  if (!offer) {
    return { text: "...", choices: [{ id: "open_shop", label: "Back" }] };
  }
  const choices: ShiftyDialogueChoice[] = [];
  const cardListing = listings.find((l) => l.cardId === offer.card.cardId && l.stock > 0);
  if (cardListing) {
    choices.push({
      id: `sensei_buy:${cardListing.id}`,
      label: `${cardListing.name} — ${cardListing.price}G`,
    });
  }
  const skillListing = listings.find((l) => l.skillId === offer.skill.skillId && l.stock > 0);
  if (skillListing && !state.player.skillsUnlocked.includes(offer.skill.skillId)) {
    const ready = canBuySenseiSkill(state, branch, offer.skill.skillId);
    choices.push({
      id: `sensei_buy:${skillListing.id}`,
      label: ready
        ? `${skillListing.name} — ${skillListing.price}G`
        : `${skillListing.name} — ${skillListing.price}G (need ${SENSEI_SKILL_TREE_REQUIREMENT} ${branch} skills)`,
    });
  }
  choices.push({ id: "open_shop", label: "Back" });
  return { text: offer.quote, choices };
}

/** All Sensei merchant-only skill ids (for docs / filters). */
export function senseiSkillIds(): string[] {
  return SKILL_DEFS.filter((s) => s.merchantOnly).map((s) => s.id);
}
