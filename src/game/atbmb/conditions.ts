import { keyOf, magicMissilePathClearToPlayer, lineOfSightClear } from "../../engine/grid";
import { monsterMaxHp } from "../../engine/combat";
import type {
  AtbmbAttackRange,
  AtbmbTilePrefs,
  AtbmbWhen,
  GameState,
  MonsterInstance,
  Point,
  RoomKind,
} from "../types";
import type { AtbmbTurnCtx } from "./abilities";
import { skeletonWeaponCanHit } from "./skeletonWeapon";
import { distByMetric, isOnBadTile, isOnFavoredTile } from "./tilePrefs";

function hpFraction(s: GameState, m: MonsterInstance): number {
  const base = s.monsterDefs.get(m.defId)?.hp ?? m.hp;
  const max = monsterMaxHp(base, m.level);
  return max > 0 ? m.hp / max : 0;
}

const CORRIDOR_KINDS: ReadonlySet<RoomKind> = new Set(["corridor", "gauntlet_corridor"]);

/** Room has no discovered floor tiles and is not a corridor. */
export function inUndiscoveredNonCorridorRoom(s: GameState, m: MonsterInstance): boolean {
  const rid = s.roomIds[m.y]?.[m.x] ?? -1;
  if (rid < 0) return false;
  const kind = s.roomKinds[rid];
  if (!kind || CORRIDOR_KINDS.has(kind)) return false;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (s.roomIds[y]?.[x] !== rid) continue;
      if (s.tiles[y]?.[x] !== "floor" && s.tiles[y]?.[x] !== "water") continue;
      if (s.discovered.has(keyOf({ x, y }))) return false;
    }
  }
  return true;
}

export function inAttackRange(
  mon: Point,
  player: Point,
  range: AtbmbAttackRange | undefined,
): boolean {
  if (!range) return false;
  const d = distByMetric(mon, player, range.metric);
  const min = range.min ?? 1;
  return d >= min && d <= range.max;
}

export function whenMatches(
  s: GameState,
  m: MonsterInstance,
  when: AtbmbWhen | undefined,
  prefs: AtbmbTilePrefs | undefined,
  attackRange: AtbmbAttackRange | undefined,
  turnCtx?: AtbmbTurnCtx,
): boolean {
  if (!when) return true;
  const player: Point = { x: s.player.x, y: s.player.y };
  const monPos: Point = { x: m.x, y: m.y };

  if (when.onFavoredTile !== undefined) {
    if (isOnFavoredTile(s, m, prefs) !== when.onFavoredTile) return false;
  }
  if (when.onBadTile !== undefined) {
    if (isOnBadTile(s, m, prefs) !== when.onBadTile) return false;
  }
  if (when.inAttackRange !== undefined) {
    if (inAttackRange(monPos, player, attackRange) !== when.inAttackRange) return false;
  }
  if (when.clearQueenRayToPlayer !== undefined) {
    const clear = magicMissilePathClearToPlayer(
      s.tiles,
      s.monsters,
      monPos,
      player,
      m.id,
    );
    if (clear !== when.clearQueenRayToPlayer) return false;
  }
  if (when.clearLosToPlayer !== undefined) {
    const clear = lineOfSightClear(s.tiles, monPos, player);
    if (clear !== when.clearLosToPlayer) return false;
  }
  if (when.canWeaponMelee !== undefined) {
    const w = m.skeletonWeapon ?? "sword";
    const can = skeletonWeaponCanHit(w, monPos, player, (turnCtx?.movesSpent ?? 0) > 0);
    if (can !== when.canWeaponMelee) return false;
  }
  if (when.inUndiscoveredNonCorridorRoom !== undefined) {
    if (inUndiscoveredNonCorridorRoom(s, m) !== when.inUndiscoveredNonCorridorRoom) return false;
  }
  if (when.hpFractionBelow !== undefined) {
    if (hpFraction(s, m) >= when.hpFractionBelow) return false;
  }
  if (when.hpFractionAbove !== undefined) {
    if (hpFraction(s, m) <= when.hpFractionAbove) return false;
  }
  if (when.flagTrue !== undefined) {
    if (!m.aiFlags?.[when.flagTrue]) return false;
  }
  if (when.flagFalse !== undefined) {
    if (m.aiFlags?.[when.flagFalse]) return false;
  }
  return true;
}
