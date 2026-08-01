import { keyOf, magicMissilePathClearToPlayer, tileAt, chebyshev, lineOfSightClear } from "../../engine/grid";
import { manhattan } from "../../engine/movement";
import type {
  AtbmbMetric,
  AtbmbStateDef,
  AtbmbTilePref,
  AtbmbTilePrefs,
  GameState,
  MonsterInstance,
  Point,
} from "../types";

export function distByMetric(a: Point, b: Point, metric: AtbmbMetric): number {
  return metric === "chebyshev" ? chebyshev(a, b) : manhattan(a, b);
}

/** Merge base tile prefs with per-weapon overrides. */
export function resolveTilePrefs(
  stateDef: AtbmbStateDef,
  m: MonsterInstance,
): AtbmbTilePrefs {
  const base = stateDef.tilePrefs ?? {};
  const w = m.skeletonWeapon;
  const byW = w ? stateDef.weaponTilePrefs?.[w] : undefined;
  if (!byW) return base;
  return {
    favored: byW.favored ?? base.favored,
    secondary: byW.secondary ?? base.secondary,
    tertiary: byW.tertiary ?? base.tertiary,
    bad: [...(base.bad ?? []), ...(byW.bad ?? [])],
  };
}

export function tileMatchesPref(
  s: GameState,
  m: MonsterInstance,
  tile: Point,
  pref: AtbmbTilePref,
): boolean {
  const player: Point = { x: s.player.x, y: s.player.y };
  switch (pref.kind) {
    case "adjacent_to_player":
      return distByMetric(tile, player, pref.metric) === 1;
    case "distance_to_player": {
      const d = distByMetric(tile, player, pref.metric);
      return d >= pref.min && d <= pref.max;
    }
    case "plus_from_player": {
      const dx = tile.x - player.x;
      const dy = tile.y - player.y;
      if (dx !== 0 && dy !== 0) return false;
      const d = Math.abs(dx) + Math.abs(dy);
      return d >= pref.min && d <= pref.max;
    }
    case "queen_line_from_player": {
      const dx = tile.x - player.x;
      const dy = tile.y - player.y;
      if (dx === 0 && dy === 0) return false;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (!(dx === 0 || dy === 0 || adx === ady)) return false;
      const c = chebyshev(tile, player);
      const minC = pref.minChebyshev ?? 1;
      if (c < minC) return false;
      if (pref.maxChebyshev !== undefined && c > pref.maxChebyshev) return false;
      if (pref.maxManhattan !== undefined && manhattan(tile, player) > pref.maxManhattan) {
        return false;
      }
      if (pref.requireClear === false) return true;
      return magicMissilePathClearToPlayer(s.tiles, s.monsters, tile, player, m.id);
    }
    case "los_in_radius_from_player": {
      const d = distByMetric(tile, player, pref.metric);
      const minD = pref.min ?? 1;
      if (d < minD || d > pref.max) return false;
      if (pref.minManhattan !== undefined && manhattan(tile, player) < pref.minManhattan) {
        return false;
      }
      return lineOfSightClear(s.tiles, tile, player);
    }
    case "vine_whip_range_to_player": {
      const maxM = pref.maxManhattan ?? 4;
      if (manhattan(tile, player) > maxM) return false;
      if (manhattan(tile, player) === 0) return false;
      return magicMissilePathClearToPlayer(s.tiles, s.monsters, tile, player, m.id);
    }
    case "adjacent_to_fire": {
      const dirs = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
        { x: 1, y: 1 },
        { x: 1, y: -1 },
        { x: -1, y: 1 },
        { x: -1, y: -1 },
      ];
      for (const o of dirs) {
        const nx = tile.x + o.x;
        const ny = tile.y + o.y;
        if ((s.player.fireLevels ?? 0) > 0 && s.player.x === nx && s.player.y === ny) {
          return true;
        }
        if (
          s.monsters.some(
            (other) =>
              other.hp > 0 &&
              other.x === nx &&
              other.y === ny &&
              (other.fireLevels ?? 0) > 0,
          )
        ) {
          return true;
        }
      }
      return false;
    }
    case "adjacent_to_ally": {
      const allyId = pref.allyDefId ?? m.defId;
      const dirs = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ];
      for (const o of dirs) {
        const nx = tile.x + o.x;
        const ny = tile.y + o.y;
        if (
          s.monsters.some(
            (other) =>
              other.hp > 0 &&
              other.id !== m.id &&
              other.defId === allyId &&
              other.x === nx &&
              other.y === ny &&
              (!pref.preferLeader || !!other.aiFlags?.leader),
          )
        ) {
          return true;
        }
      }
      return false;
    }
    case "diagonal_adjacent_to_player": {
      const adx = Math.abs(tile.x - player.x);
      const ady = Math.abs(tile.y - player.y);
      return adx === 1 && ady === 1;
    }
    case "slime_leap_path": {
      for (const other of s.monsters) {
        if (other.hp <= 0 || other.defId !== "slime") continue;
        const dir = other.leapDir;
        if (!dir || (dir.x === 0 && dir.y === 0)) continue;
        for (let i = 1; i <= 2; i++) {
          if (tile.x === other.x + dir.x * i && tile.y === other.y + dir.y * i) {
            return true;
          }
        }
      }
      return false;
    }
    case "pending_collapse":
      return !!s.pendingCollapse?.tiles.some((t) => t.x === tile.x && t.y === tile.y);
    case "pending_targeted_collapse":
      return !!s.pendingTargetedCollapse?.some((t) => t.x === tile.x && t.y === tile.y);
    case "flooding_room": {
      if (s.floodingRoomId == null) return false;
      return (s.roomIds[tile.y]?.[tile.x] ?? -1) === s.floodingRoomId;
    }
    case "water":
      return tileAt(s.tiles, tile) === "water";
    case "floor":
      return tileAt(s.tiles, tile) === "floor";
    case "not_water":
      return tileAt(s.tiles, tile) !== "water";
    case "same_room_as_player": {
      const rooms = s.roomIds;
      if (!rooms.length) return true;
      const a = rooms[tile.y]?.[tile.x];
      const b = rooms[player.y]?.[player.x];
      return a !== undefined && b !== undefined && a === b && a >= 0;
    }
    case "clear_queen_ray_to_player":
      return magicMissilePathClearToPlayer(s.tiles, s.monsters, tile, player, m.id);
    case "harming_cloud":
      return s.harmingClouds.some((c) => c.x === tile.x && c.y === tile.y && c.turnsLeft > 0);
    default:
      return false;
  }
}

export function tileMatchesAnyPref(
  s: GameState,
  m: MonsterInstance,
  tile: Point,
  prefs: AtbmbTilePref[] | undefined,
): boolean {
  if (!prefs?.length) return false;
  return prefs.some((p) => tileMatchesPref(s, m, tile, p));
}

export function isOnFavoredTile(
  s: GameState,
  m: MonsterInstance,
  prefs: AtbmbTilePrefs | undefined,
): boolean {
  // Favored never includes disliked tiles.
  if (isOnBadTile(s, m, prefs)) return false;
  return tileMatchesAnyPref(s, m, { x: m.x, y: m.y }, prefs?.favored);
}

export function isOnSecondaryTile(
  s: GameState,
  m: MonsterInstance,
  prefs: AtbmbTilePrefs | undefined,
): boolean {
  if (isOnBadTile(s, m, prefs)) return false;
  return tileMatchesAnyPref(s, m, { x: m.x, y: m.y }, prefs?.secondary);
}

export function isOnBadTile(
  s: GameState,
  m: MonsterInstance,
  prefs: AtbmbTilePrefs | undefined,
): boolean {
  return tileMatchesAnyPref(s, m, { x: m.x, y: m.y }, prefs?.bad);
}

/** Disliked / bad tiles — used for prefs and (usually) as movement blockers. */
export function isDislikedTile(
  s: GameState,
  m: MonsterInstance,
  tile: Point,
  prefs: AtbmbTilePrefs | undefined,
): boolean {
  return tileMatchesAnyPref(s, m, tile, prefs?.bad);
}

/**
 * Disliked tiles normally block entry like walls.
 * When the monster is already on a disliked tile, entry is *not* hard-blocked
 * (so it can still escape if every exit is disliked) — callers must still prefer
 * non-disliked steps when any exist.
 */
export function dislikedBlocksEntry(
  s: GameState,
  m: MonsterInstance,
  dest: Point,
  prefs: AtbmbTilePrefs | undefined,
): boolean {
  if (!isDislikedTile(s, m, dest, prefs)) return false;
  if (isDislikedTile(s, m, { x: m.x, y: m.y }, prefs)) return false;
  return true;
}

/**
 * Score a tile for movement. Higher is better.
 * favored ≫ secondary ≫ tertiary. Disliked tiles are filtered out before scoring.
 * Tie-break: closer to the nearest free favored tile (Manhattan), then closer to player.
 */
export function scoreTile(
  s: GameState,
  m: MonsterInstance,
  tile: Point,
  prefs: AtbmbTilePrefs | undefined,
  favoredTargets: Point[],
): number {
  if (!prefs) return 0;
  let score = 0;
  if (isDislikedTile(s, m, tile, prefs)) {
    score -= 500;
  } else if (tileMatchesAnyPref(s, m, tile, prefs.favored)) score += 1000;
  else if (tileMatchesAnyPref(s, m, tile, prefs.secondary)) score += 100;
  else if (tileMatchesAnyPref(s, m, tile, prefs.tertiary)) score += 10;

  if (favoredTargets.length) {
    let nearest = Infinity;
    for (const t of favoredTargets) {
      const d = manhattan(tile, t);
      if (d < nearest) nearest = d;
    }
    score -= nearest;
  } else {
    score -= manhattan(tile, { x: s.player.x, y: s.player.y });
  }
  return score;
}

/** Collect passable, unoccupied, non-disliked tiles that match a pref list.
 * Prefs are tried in order: if an earlier pref yields any tiles, later prefs are skipped.
 * (Lets `preferLeader` ally tiles win over generic ally tiles.)
 */
export function collectPrefTiles(
  s: GameState,
  m: MonsterInstance,
  prefList: AtbmbTilePref[] | undefined,
  prefs: AtbmbTilePrefs | undefined,
  passable: (p: Point) => boolean,
  occupied: Set<string>,
): Point[] {
  if (!prefList?.length) return [];
  for (const pref of prefList) {
    const out: Point[] = [];
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const p = { x, y };
        if (occupied.has(keyOf(p)) && !(p.x === m.x && p.y === m.y)) continue;
        if (!passable(p)) continue;
        if (isDislikedTile(s, m, p, prefs)) continue;
        if (tileMatchesPref(s, m, p, pref)) out.push(p);
      }
    }
    if (out.length) return out;
  }
  return [];
}

/** Collect passable, unoccupied tiles that are not disliked. */
export function collectNonDislikedTiles(
  s: GameState,
  m: MonsterInstance,
  prefs: AtbmbTilePrefs | undefined,
  passable: (p: Point) => boolean,
  occupied: Set<string>,
): Point[] {
  const out: Point[] = [];
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const p = { x, y };
      if (occupied.has(keyOf(p)) && !(p.x === m.x && p.y === m.y)) continue;
      if (!passable(p)) continue;
      if (isDislikedTile(s, m, p, prefs)) continue;
      out.push(p);
    }
  }
  return out;
}

/** Collect passable, unoccupied, non-disliked tiles that match favored prefs. */
export function collectFavoredTiles(
  s: GameState,
  m: MonsterInstance,
  prefs: AtbmbTilePrefs | undefined,
  passable: (p: Point) => boolean,
  occupied: Set<string>,
): Point[] {
  return collectPrefTiles(s, m, prefs?.favored, prefs, passable, occupied);
}

/** Manhattan distance to nearest target, or Infinity if none. */
export function nearestManhattan(from: Point, targets: Point[]): number {
  let best = Infinity;
  for (const t of targets) {
    const d = manhattan(from, t);
    if (d < best) best = d;
  }
  return best;
}
