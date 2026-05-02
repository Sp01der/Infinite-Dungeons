export type SkillCategory = "Attack" | "Defense" | "Mobility" | "Vitality" | "Deck";

export const SKILL_CATEGORIES: SkillCategory[] = [
  "Attack",
  "Defense",
  "Mobility",
  "Vitality",
  "Deck",
];

export interface SkillDef {
  id: string;
  category: SkillCategory;
  name: string;
  description: string;
  cost: number;
  /** Prerequisite skill ids (all must be unlocked). */
  requires: string[];
  /** Horizontal position, left to right. */
  column: number;
}

/** Placeholder branching trees; replace with real skills later. */
export const SKILL_DEFS: SkillDef[] = [
  {
    id: "atk_strike",
    category: "Attack",
    name: "Strike training",
    description: "Placeholder — extra damage or knockback later.",
    cost: 1,
    requires: [],
    column: 0,
  },
  {
    id: "atk_heavy",
    category: "Attack",
    name: "Heavy blows",
    description: "Placeholder — follow-up to Strike training.",
    cost: 2,
    requires: ["atk_strike"],
    column: 1,
  },
  {
    id: "atk_cleave",
    category: "Attack",
    name: "Cleave",
    description: "Placeholder — branch option from Strike training.",
    cost: 2,
    requires: ["atk_strike"],
    column: 2,
  },
  {
    id: "def_stance",
    category: "Defense",
    name: "Sturdy stance",
    description: "Placeholder — defense scaling later.",
    cost: 1,
    requires: [],
    column: 0,
  },
  {
    id: "def_parry",
    category: "Defense",
    name: "Parry focus",
    description: "Placeholder — requires Sturdy stance.",
    cost: 2,
    requires: ["def_stance"],
    column: 1,
  },
  {
    id: "def_bulwark",
    category: "Defense",
    name: "Bulwark",
    description: "Placeholder — advanced defense node.",
    cost: 3,
    requires: ["def_parry"],
    column: 2,
  },
  {
    id: "mob_stride",
    category: "Mobility",
    name: "Long stride",
    description: "Placeholder — bonus move points later.",
    cost: 1,
    requires: [],
    column: 0,
  },
  {
    id: "mob_scout",
    category: "Mobility",
    name: "Scout",
    description: "Placeholder — exploration perks.",
    cost: 2,
    requires: ["mob_stride"],
    column: 1,
  },
  {
    id: "mob_dash",
    category: "Mobility",
    name: "Dash",
    description: "Placeholder — alternate path from Long stride.",
    cost: 2,
    requires: ["mob_stride"],
    column: 2,
  },
  {
    id: "vit_heart",
    category: "Vitality",
    name: "Strong heart",
    description: "Placeholder — HP and consumable boosts later.",
    cost: 1,
    requires: [],
    column: 0,
  },
  {
    id: "vit_feast",
    category: "Vitality",
    name: "Feast",
    description: "Placeholder — better food.",
    cost: 2,
    requires: ["vit_heart"],
    column: 1,
  },
  {
    id: "vit_salve",
    category: "Vitality",
    name: "Salve",
    description: "Placeholder — potion efficiency.",
    cost: 2,
    requires: ["vit_heart"],
    column: 2,
  },
  {
    id: "deck_focus",
    category: "Deck",
    name: "Deck focus",
    description: "Placeholder — draw or deck quality later.",
    cost: 2,
    requires: [],
    column: 0,
  },
  {
    id: "deck_slot",
    category: "Deck",
    name: "Extra sleeve",
    description: "Placeholder — equipment slot ideas.",
    cost: 3,
    requires: ["deck_focus"],
    column: 1,
  },
  {
    id: "deck_fortune",
    category: "Deck",
    name: "Fortune",
    description: "Placeholder — dungeon deck interaction.",
    cost: 4,
    requires: ["deck_slot"],
    column: 2,
  },
];

const byId = new Map(SKILL_DEFS.map((s) => [s.id, s]));

export function getSkillDef(id: string): SkillDef | undefined {
  return byId.get(id);
}
