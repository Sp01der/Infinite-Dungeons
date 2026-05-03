/** Bottom four positions when deck has at least four cards; otherwise any slot. */
export const DUNGEON_DEADLIER_ID = "dungeon_deadlier";

function shuffleInPlace<T>(xs: T[]): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
}

function themeCardsFor(theme: string): string[] {
  switch (theme) {
    case "basic":
      return ["the_dust_settles"];
    default:
      return themeCardsFor("basic");
  }
}

/** Card id multiset for the dungeon deck at a given depth and floor theme. */
export function expandRecipe(depth: number, theme: string): string[] {
  const d: string[] = [];
  for (let i = 0; i < 6; i++) d.push("dungeon_still");
  for (let i = 0; i < 2; i++) d.push("noisy_adventurer");
  d.push("dungeon_knows_here", "dungeon_trap");
  for (let i = 0; i < 2; i++) d.push("falling_rocks");
  d.push("monsters_from_deep", "stability");
  d.push(...themeCardsFor(theme));
  if (depth >= 3) {
    d.push("dungeon_still", "falling_rocks", "collapse", "lights_out");
  }
  if (depth >= 4) {
    d.push("stability", "monsters_from_deep", "targeted_collapse");
    d.push(...themeCardsFor(theme));
  }
  if (depth >= 5) {
    d.push("you_are_not_alone");
  }
  d.push(DUNGEON_DEADLIER_ID);
  return d;
}

export function shuffleDeadlierToBottomFour(deck: string[], deadlierId: string): string[] {
  const without: string[] = [];
  let removed = false;
  for (const id of deck) {
    if (!removed && id === deadlierId) {
      removed = true;
      continue;
    }
    without.push(id);
  }
  shuffleInPlace(without);
  const n = without.length + 1;
  let pos: number;
  if (n <= 4) {
    pos = Math.floor(Math.random() * n);
  } else {
    pos = n - 4 + Math.floor(Math.random() * 4);
  }
  const out = [...without];
  out.splice(pos, 0, deadlierId);
  return out;
}

export function buildFreshDungeonDeck(depth: number, theme: string): string[] {
  return shuffleDeadlierToBottomFour(expandRecipe(depth, theme), DUNGEON_DEADLIER_ID);
}
