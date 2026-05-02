import type { CardDef, DungeonCardDef, MonsterDef } from "./types";
import cardsJson from "../content/cards.json";
import monstersJson from "../content/monsters.json";
import dungeonCardsJson from "../content/dungeon_cards.json";

export function loadCardDefs(): Map<string, CardDef> {
  const m = new Map<string, CardDef>();
  for (const c of cardsJson as CardDef[]) {
    m.set(c.id, c);
  }
  return m;
}

export function loadMonsterDefs(): Map<string, MonsterDef> {
  const m = new Map<string, MonsterDef>();
  for (const x of monstersJson as MonsterDef[]) {
    m.set(x.id, x);
  }
  return m;
}

export function loadDungeonCardDefs(): Map<string, DungeonCardDef> {
  const m = new Map<string, DungeonCardDef>();
  for (const x of dungeonCardsJson as DungeonCardDef[]) {
    m.set(x.id, x);
  }
  return m;
}
