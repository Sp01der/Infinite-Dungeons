import { keyOf, tileAt } from "../../engine/grid";
import type {
  AtbmbDef,
  AtbmbMoveSeek,
  AtbmbTilePrefs,
  GameState,
  MonsterInstance,
  Point,
} from "../types";
import { dirsForMoveStyle } from "./dirs";
import {
  farthestReachableGoals,
  findShortestPath,
  stablePathRng,
  type ShortestPathResult,
} from "./pathfind";
import {
  collectFavoredTiles,
  collectNonDislikedTiles,
  collectPrefTiles,
  distByMetric,
  isDislikedTile,
  nearestManhattan,
} from "./tilePrefs";

export type AtbmbPathContext = {
  tilePassable: (s: GameState, m: MonsterInstance, p: Point) => boolean;
  occupancy: (s: GameState, excludeMonsterId: string) => Set<string>;
};

function makeCanEnter(
  s: GameState,
  m: MonsterInstance,
  prefs: AtbmbTilePrefs | undefined,
  occ: Set<string>,
  tileOk: (p: Point) => boolean,
  allowDisliked: boolean,
  onDisliked: boolean,
): (p: Point) => boolean {
  const startKey = keyOf(m);
  return (p: Point) => {
    if (keyOf(p) === startKey) return true;
    if (occ.has(keyOf(p))) return false;
    if (!tileOk(p)) return false;
    const destDisliked = isDislikedTile(s, m, p, prefs);
    if (destDisliked && !allowDisliked) return false;
    if (destDisliked && !onDisliked) return false;
    return true;
  };
}

function resolveGoalTiles(
  s: GameState,
  m: MonsterInstance,
  ai: AtbmbDef,
  prefs: AtbmbTilePrefs | undefined,
  seek: AtbmbMoveSeek,
  moveUsesRemaining: number,
  tileOk: (p: Point) => boolean,
  occ: Set<string>,
  canEnter: (p: Point) => boolean,
): Point[] {
  const from: Point = { x: m.x, y: m.y };
  const passableGoal = (p: Point) => tileOk(p) && !isDislikedTile(s, m, p, prefs);
  const favored = collectFavoredTiles(s, m, prefs, passableGoal, occ);
  const secondary = collectPrefTiles(s, m, prefs?.secondary, prefs, passableGoal, occ);
  const tertiary = collectPrefTiles(s, m, prefs?.tertiary, prefs, passableGoal, occ);
  const safeTiles = collectNonDislikedTiles(s, m, prefs, passableGoal, occ);
  const player: Point = { x: s.player.x, y: s.player.y };
  const metric = ai.moveStyle === "any8" ? "chebyshev" : "manhattan";
  const dirs = dirsForMoveStyle(ai.moveStyle);

  switch (seek) {
    case "secondary":
      return secondary;
    case "tertiary":
      return tertiary;
    case "away_from_bad":
      return safeTiles.length ? safeTiles : [];
    case "toward_player": {
      // Stand on a passable tile adjacent to the player (ortho for ortho movers).
      const adj: Point[] = [];
      for (const o of dirsForMoveStyle(ai.moveStyle === "any8" ? "any8" : "ortho")) {
        const p = { x: player.x + o.x, y: player.y + o.y };
        if (passableGoal(p) && !occ.has(keyOf(p))) adj.push(p);
      }
      return adj;
    }
    case "away_from_player":
      return farthestReachableGoals(
        from,
        dirs,
        canEnter,
        (p) => distByMetric(p, player, metric),
      );
    case "favored":
    default: {
      let goals = favored;
      if (prefs?.secondary?.length) {
        const favDist = nearestManhattan(from, favored);
        if (favDist > moveUsesRemaining) {
          const secDist = nearestManhattan(from, secondary);
          if (secondary.length && secDist <= moveUsesRemaining) {
            goals = secondary;
          }
        }
      }
      return goals;
    }
  }
}

/**
 * Plan a shortest path for the monster's current seek target.
 * Recomputed every call (reroutes when blocked / goals move / state changes).
 */
export function planAtbmbPath(
  s: GameState,
  m: MonsterInstance,
  ai: AtbmbDef,
  prefs: AtbmbTilePrefs | undefined,
  seek: AtbmbMoveSeek,
  ctx: AtbmbPathContext,
  opts?: {
    moveUsesRemaining?: number;
    waterOnly?: boolean;
    /** Default Math.random; use stablePathRng for brain overlay. */
    rng?: () => number;
  },
): ShortestPathResult | null {
  const occ = ctx.occupancy(s, m.id);
  const dirs = dirsForMoveStyle(ai.moveStyle);
  const waterOnly = opts?.waterOnly ?? false;
  const rng = opts?.rng ?? Math.random;
  const tileOk = (p: Point) => {
    if (!ctx.tilePassable(s, m, p)) return false;
    if (waterOnly && tileAt(s.tiles, p) !== "water") return false;
    return true;
  };
  const from: Point = { x: m.x, y: m.y };
  const onDisliked = isDislikedTile(s, m, from, prefs);

  const tryPlan = (allowDisliked: boolean): ShortestPathResult | null => {
    const canEnter = makeCanEnter(s, m, prefs, occ, tileOk, allowDisliked, onDisliked);
    const goals = resolveGoalTiles(
      s,
      m,
      ai,
      prefs,
      seek,
      opts?.moveUsesRemaining ?? 1,
      tileOk,
      occ,
      canEnter,
    ).filter((g) => {
      if (keyOf(g) === keyOf(from)) return true;
      return canEnter(g);
    });
    if (!goals.length) return null;
    return findShortestPath(from, goals, dirs, canEnter, rng);
  };

  const preferred = tryPlan(false);
  if (preferred) return preferred;
  if (onDisliked) return tryPlan(true);
  return null;
}

/** Next step along a freshly planned shortest path, or null if none. */
export function pickPathStep(
  s: GameState,
  m: MonsterInstance,
  ai: AtbmbDef,
  prefs: AtbmbTilePrefs | undefined,
  seek: AtbmbMoveSeek,
  ctx: AtbmbPathContext,
  moveUsesRemaining: number,
  waterOnly = false,
  rng: () => number = Math.random,
): Point | null {
  const plan = planAtbmbPath(s, m, ai, prefs, seek, ctx, {
    moveUsesRemaining,
    waterOnly,
    rng,
  });
  return plan?.nextStep ?? null;
}

export { stablePathRng };
