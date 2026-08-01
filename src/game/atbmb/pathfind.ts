import { keyOf } from "../../engine/grid";
import type { Point } from "../types";

export type ShortestPathResult = {
  /** Inclusive path from start to a nearest goal. */
  path: Point[];
  /** First step along the path (path[1]), or null if already at a goal. */
  nextStep: Point | null;
  goal: Point;
};

function pointKey(p: Point): string {
  return keyOf(p);
}

/**
 * Unweighted shortest path from `from` to any of `goals`.
 * Among equal-length paths, prefers `preferGoal` matches when any exist at that
 * distance, then picks randomly via `rng` (default Math.random).
 * Pass `rng` that is deterministic for stable brain overlays.
 */
export function findShortestPath(
  from: Point,
  goals: readonly Point[],
  dirs: readonly Point[],
  canEnter: (p: Point) => boolean,
  rng: () => number = Math.random,
  preferGoal?: (p: Point) => boolean,
): ShortestPathResult | null {
  if (!goals.length) return null;
  const goalSet = new Set(goals.map(pointKey));
  const startKey = pointKey(from);
  if (goalSet.has(startKey)) {
    return { path: [from], nextStep: null, goal: from };
  }

  const dist = new Map<string, number>();
  const parents = new Map<string, Point[]>();
  const queue: Point[] = [from];
  dist.set(startKey, 0);

  let bestGoalDist = Infinity;
  const goalsAtBest: Point[] = [];

  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    const curKey = pointKey(cur);
    const d = dist.get(curKey)!;
    if (d > bestGoalDist) break;

    for (const o of dirs) {
      const np = { x: cur.x + o.x, y: cur.y + o.y };
      const nk = pointKey(np);
      if (!canEnter(np)) continue;

      const prev = dist.get(nk);
      if (prev === undefined) {
        dist.set(nk, d + 1);
        parents.set(nk, [cur]);
        queue.push(np);
        if (goalSet.has(nk)) {
          if (d + 1 < bestGoalDist) {
            bestGoalDist = d + 1;
            goalsAtBest.length = 0;
            goalsAtBest.push(np);
          } else if (d + 1 === bestGoalDist) {
            goalsAtBest.push(np);
          }
        }
      } else if (prev === d + 1) {
        const plist = parents.get(nk);
        if (plist) plist.push(cur);
      }
    }
  }

  if (!goalsAtBest.length) return null;

  const preferred = preferGoal ? goalsAtBest.filter(preferGoal) : [];
  const pool = preferred.length > 0 ? preferred : goalsAtBest;
  const goal = pool[Math.floor(rng() * pool.length)]!;
  const pathRev: Point[] = [goal];
  let cursor: Point = goal;
  while (pointKey(cursor) !== startKey) {
    const opts = parents.get(pointKey(cursor));
    if (!opts?.length) return null;
    cursor = opts[Math.floor(rng() * opts.length)]!;
    pathRev.push(cursor);
  }
  pathRev.reverse();
  return {
    path: pathRev,
    nextStep: pathRev.length > 1 ? pathRev[1]! : null,
    goal,
  };
}

/** Lexicographic RNG stand-in: always picks index 0 (stable brain overlays). */
export function stablePathRng(): number {
  return 0;
}

/**
 * Among reachable tiles that maximize distance to `awayFrom` (in the given metric
 * via hop count from `from` is not used — we maximize `distFn` at the destination).
 * Returns those farthest tiles as pathfinding goals.
 */
export function farthestReachableGoals(
  from: Point,
  dirs: readonly Point[],
  canEnter: (p: Point) => boolean,
  scoreAway: (p: Point) => number,
  maxExpand = 4000,
): Point[] {
  const startKey = pointKey(from);
  const seen = new Set<string>([startKey]);
  const queue: Point[] = [from];
  let bestScore = scoreAway(from);
  let best: Point[] = [from];

  for (let qi = 0; qi < queue.length && qi < maxExpand; qi++) {
    const cur = queue[qi]!;
    for (const o of dirs) {
      const np = { x: cur.x + o.x, y: cur.y + o.y };
      const nk = pointKey(np);
      if (seen.has(nk)) continue;
      if (!canEnter(np)) continue;
      seen.add(nk);
      queue.push(np);
      const sc = scoreAway(np);
      if (sc > bestScore) {
        bestScore = sc;
        best = [np];
      } else if (sc === bestScore) {
        best.push(np);
      }
    }
  }
  return best;
}
