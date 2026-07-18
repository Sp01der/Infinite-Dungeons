import { applyDefense, rollInt } from "../engine/combat";
import type { CardDef, GameState } from "./types";

/** Canonical skill ids — match skillDefs.ts */
export const SID = {
  ATK_STRENGTH: "atk_attack_strength",
  ATK_KNOCKBACK: "atk_knockback",
  ATK_HEAVY_PUNCHES: "atk_heavy_punches",
  ATK_FIGHTER: "atk_fighter_training",
  ATK_MAGE: "atk_mage_training",
  DEF_BLOCK: "def_block",
  DEF_BLOCK_II: "def_block_ii",
  DEF_PROTECTIVE: "def_protective_stance",
  DEF_BLOCK_III: "def_block_iii",
  DEF_PROTECTIVE_II: "def_protective_stance_ii",
  MOB_SPEEDY: "mob_speedy",
  MOB_SPEEDY_II: "mob_speedy_ii",
  MOB_CAREFUL: "mob_careful_looting",
  MOB_GOLD: "mob_gold_seeker",
  MOB_SPRINTER: "mob_sprinter",
  MOB_EXPLORATION: "mob_exploration",
  VIT_RES: "vit_resilience",
  VIT_RES_II: "vit_resilience_ii",
  VIT_FEASTER: "vit_feaster",
  VIT_TOUGH: "vit_tough",
  DECK_CP: "deck_card_player",
  DECK_CP_II: "deck_card_player_ii",
  DECK_DESC: "deck_descendant",
  DECK_BUILDER: "deck_builder",
  DECK_CP_III: "deck_card_player_iii",
} as const;

export function hasSkill(s: GameState, id: string): boolean {
  return s.player.skillsUnlocked.includes(id);
}

/** Cards drawn at the start of each player turn (before Card Player bonuses). */
export function playerDrawCountPerTurn(s: GameState): number {
  let n = 3;
  if (hasSkill(s, SID.DECK_CP)) n += 1;
  if (hasSkill(s, SID.DECK_CP_II)) n += 1;
  if (hasSkill(s, SID.DECK_CP_III)) n += 1;
  return n;
}

export function moveTokensGrantedPerTurn(s: GameState): number {
  let t = 0;
  if (hasSkill(s, SID.MOB_SPEEDY)) t += 1;
  if (hasSkill(s, SID.MOB_SPEEDY_II)) t += 1;
  return t;
}

export function knockbackTokensGrantedPerTurn(s: GameState): number {
  return hasSkill(s, SID.ATK_KNOCKBACK) ? 1 : 0;
}

/** Rolled block armor vs each incoming hit (stacked with Parry bonus). */
export function playerBlockRollForHit(s: GameState): number {
  if (!hasSkill(s, SID.DEF_BLOCK)) return 0;
  let min = 0;
  let max = 1;
  if (hasSkill(s, SID.DEF_BLOCK_II)) max += 1;
  if (hasSkill(s, SID.DEF_BLOCK_III)) max += 1;
  if (hasSkill(s, SID.DEF_PROTECTIVE)) min += 1;
  if (hasSkill(s, SID.DEF_PROTECTIVE_II)) min += 1;
  if (min > max) max = min;
  return rollInt(min, max);
}

export function incomingDamageToPlayer(s: GameState, raw: number): number {
  const block = playerBlockRollForHit(s);
  return applyDefense(raw, s.player.defenseBonusThisTurn + block);
}

export function attackStrengthBonus(s: GameState): number {
  return hasSkill(s, SID.ATK_STRENGTH) ? 1 : 0;
}

/** Punches made by discarding a card pass no definition; played punch cards use the `punch` tag. */
export function heavyPunchBonus(s: GameState, def?: CardDef): number {
  if (!hasSkill(s, SID.ATK_HEAVY_PUNCHES)) return 0;
  return !def || def.tags?.includes("punch") ? 1 : 0;
}

/** Flurry doubles ordinary discard punches and any played card tagged `punch`. */
export function punchStrikeCount(s: GameState, def?: CardDef): number {
  if (!s.player.doublePunchThisTurn) return 1;
  return !def || def.tags?.includes("punch") ? 2 : 1;
}

export function fighterTrainingBonus(s: GameState, def: CardDef | undefined): number {
  if (!hasSkill(s, SID.ATK_FIGHTER) || !def) return 0;
  return def.tags?.includes("physical attack") ? 1 : 0;
}

export function mageTrainingBonus(s: GameState, def: CardDef | undefined): number {
  if (!hasSkill(s, SID.ATK_MAGE) || !def) return 0;
  return def.types.includes("Attack") && def.types.includes("Magic") ? 1 : 0;
}

/** Flat damage added to each Lightning Bolt chain hop (range/decay still use the card's base step). */
export function lightningBoltSkillDamageBonus(s: GameState, cardId: string | undefined): number {
  const def = cardId ? s.cardDefs.get(cardId) : undefined;
  return attackStrengthBonus(s) + mageTrainingBonus(s, def);
}

export function sprinterExtraMoveRange(s: GameState, def: CardDef | undefined): number {
  if (!hasSkill(s, SID.MOB_SPRINTER) || !def) return 0;
  if (!def.types.includes("Move")) return 0;
  if (s.player.movementCardsPlayedThisTurn > 0) return 0;
  return 1;
}

export function hasteMovementRange(s: GameState, baseRange: number): number {
  let range = s.player.hasteThisTurn ? baseRange * 2 : baseRange;
  if (s.player.nextMoveDoubled) range *= 2;
  return range;
}

export function breadHealBonus(s: GameState): number {
  return hasSkill(s, SID.VIT_FEASTER) ? 1 : 0;
}

export function potLootHitChance(s: GameState): number {
  let p = 0.4;
  if (hasSkill(s, SID.MOB_CAREFUL)) p += 0.05;
  return Math.min(0.95, p);
}

export function descendantSkipDungeonDraw(s: GameState): boolean {
  if (!hasSkill(s, SID.DECK_DESC)) return false;
  return rollInt(1, 16) === 1;
}
