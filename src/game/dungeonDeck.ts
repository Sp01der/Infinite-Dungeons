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
  const stillN = 6 + Math.max(0, depth - 1) * 2;
  for (let i = 0; i < stillN; i++) d.push("dungeon_still");
  const noisyN = 2 + Math.max(0, depth - 1);
  for (let i = 0; i < noisyN; i++) d.push("noisy_adventurer");
  d.push("dungeon_knows_here");
  const trapN = 1 + Math.max(0, depth - 1);
  for (let i = 0; i < trapN; i++) d.push("dungeon_trap");
  const rocksN = 2 + Math.max(0, depth - 1);
  for (let i = 0; i < rocksN; i++) d.push("falling_rocks");
  d.push("monsters_from_deep");
  if (depth >= 2) {
    d.push("monsters_from_deep", "dungeon_knows_here", "dungeon_trap", "falling_rocks");
  }
  if (depth >= 3) {
    d.push("monsters_from_deep", "noisy_adventurer", "stability");
  }
  d.push("stability");
  d.push(...themeCardsFor(theme));
  if (depth >= 2) d.push(...themeCardsFor(theme));
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
