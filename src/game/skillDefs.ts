export type SkillCategory = "Attack" | "Defense" | "Mobility" | "Vitality" | "Deck";

export const SKILL_CATEGORIES: SkillCategory[] = [
  "Attack",
  "Defense",
  "Mobility",
  "Vitality",
  "Deck",
];

export type SkillTokenGrantKind = "move" | "knockback";

export interface SkillDef {
  id: string;
  category: SkillCategory;
  name: string;
  description: string;
  cost: number;
  /** Prerequisite skill ids in this tree. */
  requires: string[];
  /** Computed: distance from root (siblings share a column). */
  layoutCol: number;
  /** Shown under the node: resources granted each turn. */
  grantsTokens?: { kind: SkillTokenGrantKind; perTurn: number }[];
  /** Sold by merchants (e.g. Sensei); hidden from the skill-point tree UI. */
  merchantOnly?: boolean;
}

type RawSkill = Omit<SkillDef, "layoutCol">;

const RAW_SKILLS: RawSkill[] = [
  {
    id: "atk_attack_strength",
    category: "Attack",
    name: "Attack Strength",
    description: "Every attack deals +1 damage.",
    cost: 1,
    requires: [],
  },
  {
    id: "atk_knockback",
    category: "Attack",
    name: "Knockback",
    description:
      "Gain 1 knockback token each turn. Spend any number before a Melee attack; each token adds 1 space of knockback and stacks with the attack's own knockback.",
    cost: 1,
    requires: ["atk_attack_strength"],
    grantsTokens: [{ kind: "knockback", perTurn: 1 }],
  },
  {
    id: "atk_heavy_punches",
    category: "Attack",
    name: "Heavy Punches",
    description: "Punches deal 1 extra damage.",
    cost: 1,
    requires: ["atk_attack_strength"],
  },
  {
    id: "atk_fighter_training",
    category: "Attack",
    name: "Fighter Training",
    description: "Physical attacks deal +1 damage.",
    cost: 2,
    requires: ["atk_knockback"],
  },
  {
    id: "atk_mage_training",
    category: "Attack",
    name: "Mage Training",
    description: "Attack cards with the Magic type deal +1 damage.",
    cost: 2,
    requires: ["atk_knockback"],
  },
  {
    id: "def_block",
    category: "Defense",
    name: "Block",
    description: "Each time you take damage, roll defense 0–1 (reduces damage).",
    cost: 1,
    requires: [],
  },
  {
    id: "def_block_ii",
    category: "Defense",
    name: "Block II",
    description: "Your maximum rolled defense increases by 1 (e.g. 0–1 becomes 0–2).",
    cost: 1,
    requires: ["def_block"],
  },
  {
    id: "def_protective_stance",
    category: "Defense",
    name: "Protective Stance",
    description:
      "Your minimum rolled defense increases by 1. Minimum cannot exceed maximum.",
    cost: 2,
    requires: ["def_block"],
  },
  {
    id: "def_block_iii",
    category: "Defense",
    name: "Block III",
    description: "Your maximum rolled defense increases by 1.",
    cost: 1,
    requires: ["def_block_ii"],
  },
  {
    id: "def_protective_stance_ii",
    category: "Defense",
    name: "Protective Stance II",
    description: "Your minimum rolled defense increases by 1. Cannot exceed maximum.",
    cost: 2,
    requires: ["def_protective_stance"],
  },
  {
    id: "mob_speedy",
    category: "Mobility",
    name: "Speedy",
    description: "Gain +1 move token each turn. Click a token to move 1 orthogonal space (like a bonus step).",
    cost: 1,
    requires: [],
    grantsTokens: [{ kind: "move", perTurn: 1 }],
  },
  {
    id: "mob_speedy_ii",
    category: "Mobility",
    name: "Speedy II",
    description: "Gain +1 additional move token each turn.",
    cost: 2,
    requires: ["mob_speedy"],
    grantsTokens: [{ kind: "move", perTurn: 1 }],
  },
  {
    id: "mob_careful_looting",
    category: "Mobility",
    name: "Careful Looting",
    description: "Each pot broken has +10% chance to yield loot.",
    cost: 1,
    requires: ["mob_speedy"],
  },
  {
    id: "mob_gold_seeker",
    category: "Mobility",
    name: "Gold Seeker",
    description: "+1 gold coin spawns on the ground on each new floor (in addition to normal loot).",
    cost: 1,
    requires: ["mob_careful_looting"],
  },
  {
    id: "mob_sprinter",
    category: "Mobility",
    name: "Sprinter",
    description:
      "The first card with the Move type you play each turn gains +1 movement. Bonus discard moves do not count.",
    cost: 2,
    requires: ["mob_speedy_ii"],
  },
  {
    id: "mob_exploration",
    category: "Mobility",
    name: "Exploration",
    description:
      "The first time you scout (investigate) each turn, you reveal two rooms instead of one.",
    cost: 3,
    requires: ["mob_speedy_ii"],
  },
  {
    id: "vit_resilience",
    category: "Vitality",
    name: "Resilience",
    description: "Gain +2 max HP and heal 2 (applied when unlocked).",
    cost: 1,
    requires: [],
  },
  {
    id: "vit_resilience_ii",
    category: "Vitality",
    name: "Resilience II",
    description: "Gain +3 max HP and heal 3 (applied when unlocked).",
    cost: 1,
    requires: ["vit_resilience"],
  },
  {
    id: "vit_feaster",
    category: "Vitality",
    name: "Feaster",
    description: "Bread heals 1 additional HP.",
    cost: 1,
    requires: ["vit_resilience"],
  },
  {
    id: "vit_tough",
    category: "Vitality",
    name: "Tough",
    description: "Gain +5 max HP and heal 5 (applied when unlocked).",
    cost: 3,
    requires: ["vit_resilience_ii"],
  },
  {
    id: "deck_card_player",
    category: "Deck",
    name: "Card Player",
    description: "Your starting hand size each turn increases by 1 (3 → 4).",
    cost: 3,
    requires: [],
  },
  {
    id: "deck_card_player_ii",
    category: "Deck",
    name: "Card Player II",
    description: "Your starting hand size increases by 1 again.",
    cost: 4,
    requires: ["deck_card_player"],
  },
  {
    id: "deck_descendant",
    category: "Deck",
    name: "Descendant",
    description: "1 in 16 chance each turn to skip drawing the dungeon card.",
    cost: 3,
    requires: ["deck_card_player"],
  },
  {
    id: "deck_builder",
    category: "Deck",
    name: "Deck Builder",
    description:
      "When unlocked, choose a card type — then pick one of three random cards of that type to add to your deck (discard pile).",
    cost: 3,
    requires: ["deck_card_player"],
  },
  {
    id: "deck_card_player_iii",
    category: "Deck",
    name: "Card Player III",
    description: "Your starting hand size increases by 1 again.",
    cost: 6,
    requires: ["deck_card_player_ii"],
  },
  {
    id: "atk_guard_destroyer",
    category: "Attack",
    name: "Guard Destroyer",
    description:
      "After attacking an enemy, your next attack on that enemy will do one additional damage. This stacks, but if you play an attack that does not hit that enemy, the additional damage is reset.",
    cost: 0,
    requires: [],
    merchantOnly: true,
  },
  {
    id: "def_keep_up_your_guard",
    category: "Defense",
    name: "Keep up your Guard",
    description:
      "Each turn you gain 1 level of resistance. This resistance lasts between turns. However, if you have resistance equal or higher than your Level, you gain none.",
    cost: 0,
    requires: [],
    merchantOnly: true,
  },
  {
    id: "mob_always_moving",
    category: "Mobility",
    name: "Always Moving",
    description: "If you draw no cards with the type Move you gain another movement token this turn.",
    cost: 0,
    requires: [],
    merchantOnly: true,
  },
  {
    id: "vit_keep_fighting",
    category: "Vitality",
    name: "Keep Fighting",
    description:
      "If you took more than 5 damage between now and last turn, gain 5 levels of resistance for this turn.",
    cost: 0,
    requires: [],
    merchantOnly: true,
  },
  {
    id: "deck_foresight",
    category: "Deck",
    name: "Foresight",
    description: "You will see what card is on top of your deck if you hover over it.",
    cost: 0,
    requires: [],
    merchantOnly: true,
  },
];

function computeLayoutCol(id: string, byId: Map<string, RawSkill>, memo: Map<string, number>): number {
  if (memo.has(id)) return memo.get(id)!;
  const d = byId.get(id);
  if (!d || d.requires.length === 0) {
    memo.set(id, 0);
    return 0;
  }
  const c = Math.max(...d.requires.map((r) => computeLayoutCol(r, byId, memo))) + 1;
  memo.set(id, c);
  return c;
}

function finalizeSkills(raw: RawSkill[]): SkillDef[] {
  const byId = new Map(raw.map((r) => [r.id, r]));
  const memo = new Map<string, number>();
  return raw.map((r) => ({
    ...r,
    layoutCol: computeLayoutCol(r.id, byId, memo),
  }));
}

export const SKILL_DEFS: SkillDef[] = finalizeSkills(RAW_SKILLS);

const byId = new Map(SKILL_DEFS.map((s) => [s.id, s]));

export function getSkillDef(id: string): SkillDef | undefined {
  return byId.get(id);
}

/** Parent skill id for tree edges (first prerequisite). */
export function getSkillParentId(skill: SkillDef): string | null {
  return skill.requires[0] ?? null;
}
