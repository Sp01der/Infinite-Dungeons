import type { GroundLootInstance, ShiftyGemId } from "./types";

/** 8×8 cells in `loot_icons.png` (32×32 sheet, row-major). */
export const LOOT_ICON_FRAMES = {
  loot_card: [0, 0],
  loot_coin: [8, 0],
  loot_bread: [16, 0],
  loot_herb: [24, 0],
  loot_gem_strength: [0, 8],
  loot_gem_speed: [8, 8],
  loot_gem_luck: [16, 8],
  loot_gem_cards: [24, 8],
  loot_gem_healing: [0, 16],
  loot_gem_defense: [8, 16],
  loot_coins_3: [16, 16],
  loot_soup: [24, 16],
  loot_cheese: [0, 24],
  loot_tome: [8, 24],
  loot_fire: [16, 24],
  loot_shard: [24, 24],
} as const;

export type LootIconId = keyof typeof LOOT_ICON_FRAMES;

const CELL = 8;
const SHEET = 32;

/** CSS background-position for an inventory icon at `displaySize` px (integer scale of 8). */
export function lootIconCss(id: LootIconId, displaySize = 24): {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  width: string;
  height: string;
} {
  const [x, y] = LOOT_ICON_FRAMES[id];
  const scale = displaySize / CELL;
  return {
    backgroundImage: 'url("/assets/loot_icons.png")',
    backgroundSize: `${SHEET * scale}px ${SHEET * scale}px`,
    backgroundPosition: `${-x * scale}px ${-y * scale}px`,
    width: `${displaySize}px`,
    height: `${displaySize}px`,
  };
}

export function groundLootSpriteId(loot: GroundLootInstance): LootIconId {
  switch (loot.kind) {
    case "coin":
      return (loot.amount ?? 1) >= 3 ? "loot_coins_3" : "loot_coin";
    case "bread":
      return "loot_bread";
    case "herb":
      return "loot_herb";
    case "card":
      return "loot_card";
    case "cheese":
      return "loot_cheese";
    case "gem":
      return gemLootSpriteId(loot.gemId ?? "strength");
    case "flame_of_destruction":
      return "loot_fire";
    case "magic_tome":
      return "loot_tome";
  }
}

export function gemLootSpriteId(gemId: ShiftyGemId): LootIconId {
  switch (gemId) {
    case "strength":
      return "loot_gem_strength";
    case "speed":
      return "loot_gem_speed";
    case "luck":
      return "loot_gem_luck";
    case "cards":
      return "loot_gem_cards";
    case "healing":
      return "loot_gem_healing";
    case "defense":
      return "loot_gem_defense";
  }
}

export const ALL_GEM_IDS: ShiftyGemId[] = [
  "strength",
  "speed",
  "luck",
  "cards",
  "healing",
  "defense",
];

export function randomLootGemId(): ShiftyGemId {
  return ALL_GEM_IDS[Math.floor(Math.random() * ALL_GEM_IDS.length)]!;
}
