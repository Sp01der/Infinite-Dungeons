import { inBounds, keyOf, tileAt } from "../engine/grid";
import type { GameState, PendingIntent, Point } from "./types";

/**
 * Footprints for attacks that strike more than the single tile you aim at.
 * Add a case in `areaCellsForAim` or `areaCellsForSelectedCard` when a new
 * card should show the red area outline.
 */

const ORTHOGONAL: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const EIGHT: Point[] = [
  ...ORTHOGONAL,
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

function playerPos(state: GameState): Point {
  return { x: state.player.x, y: state.player.y };
}

/** Adjacent tiles a strike can land on. Walls stop the strike. */
function adjacentStrikeCells(state: GameState, from: Point, diagonals: boolean): Point[] {
  const cells: Point[] = [];
  for (const dir of diagonals ? EIGHT : ORTHOGONAL) {
    const cell = { x: from.x + dir.x, y: from.y + dir.y };
    if (!inBounds(cell, state.width, state.height)) continue;
    if (tileAt(state.tiles, cell) === "wall") continue;
    cells.push(cell);
  }
  return cells;
}

/** Orthogonal line of `length` tiles starting at `aim`. Walls stop it. */
export function directionalLineCells(
  state: GameState,
  from: Point,
  aim: Point,
  length: number,
): Point[] {
  const dx = aim.x - from.x;
  const dy = aim.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return [];
  const cells: Point[] = [];
  for (let step = 1; step <= length; step++) {
    const cell = { x: from.x + dx * step, y: from.y + dy * step };
    if (!inBounds(cell, state.width, state.height)) break;
    if (tileAt(state.tiles, cell) === "wall") break;
    cells.push(cell);
  }
  return cells;
}

/** Two-tile spear line starting at `aim` (an orthogonal step from the player). Walls stop it. */
export function spearStrikeCells(state: GameState, from: Point, aim: Point): Point[] {
  return directionalLineCells(state, from, aim, 2);
}

function aimDirections(
  state: GameState,
  from: Point,
  cellsForAim: (aim: Point) => Point[],
): Point[] {
  const cells: Point[] = [];
  for (const dir of ORTHOGONAL) {
    const aim = { x: from.x + dir.x, y: from.y + dir.y };
    if (state.fogOfWar && !state.discovered.has(keyOf(aim))) continue;
    if (cellsForAim(aim).length > 0) cells.push(aim);
  }
  return cells;
}

/** The four directions a spear can be aimed, skipping a wall in the first tile. */
export function spearAimCells(state: GameState, from: Point): Point[] {
  return aimDirections(state, from, (aim) => spearStrikeCells(state, from, aim));
}

/**
 * Broadsword cleave: the aimed tile plus the two tiles beside it,
 * one step from the player. Walls are skipped.
 * Aim up: X X X / O. Aim left: a vertical column beside the player.
 */
export function broadswordCleaveCells(state: GameState, from: Point, aim: Point): Point[] {
  const dx = aim.x - from.x;
  const dy = aim.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return [];
  const center = { x: from.x + dx, y: from.y + dy };
  if (!inBounds(center, state.width, state.height)) return [];
  if (tileAt(state.tiles, center) === "wall") return [];
  const px = -dy;
  const py = dx;
  const cells: Point[] = [];
  for (const cell of [
    { x: center.x + px, y: center.y + py },
    center,
    { x: center.x - px, y: center.y - py },
  ]) {
    if (!inBounds(cell, state.width, state.height)) continue;
    if (tileAt(state.tiles, cell) === "wall") continue;
    cells.push(cell);
  }
  return cells;
}

export function broadswordAimCells(state: GameState, from: Point): Point[] {
  return aimDirections(state, from, (aim) => broadswordCleaveCells(state, from, aim));
}

/** Three-tile lance line. Walls stop it. */
export function icicleLanceCells(state: GameState, from: Point, aim: Point): Point[] {
  return directionalLineCells(state, from, aim, 3);
}

export function icicleLanceAimCells(state: GameState, from: Point): Point[] {
  return aimDirections(state, from, (aim) => icicleLanceCells(state, from, aim));
}

/** Floor and water tiles in the 3×3 fireball blast. Walls and rubble are skipped. */
export function fireballBlastCells(state: GameState, center: Point): Point[] {
  const cells: Point[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cell = { x: center.x + dx, y: center.y + dy };
      if (!inBounds(cell, state.width, state.height)) continue;
      const tile = tileAt(state.tiles, cell);
      if (tile !== "floor" && tile !== "water") continue;
      cells.push(cell);
    }
  }
  return cells;
}

/** Tiles a Flying Kick travels through when aimed at `dest`, or null if that is not a kick aim. */
export function flyingKickPath(from: Point, dest: Point, move: number): Point[] | null {
  const dxTotal = dest.x - from.x;
  const dyTotal = dest.y - from.y;
  const cardinal = (dxTotal === 0) !== (dyTotal === 0);
  if (!cardinal || Math.abs(dxTotal) + Math.abs(dyTotal) !== move) return null;
  const dx = Math.sign(dxTotal);
  const dy = Math.sign(dyTotal);
  return Array.from({ length: move }, (_, i) => ({
    x: from.x + dx * (i + 1),
    y: from.y + dy * (i + 1),
  }));
}

/**
 * Tiles that would be struck if `aim` is confirmed for the current pending attack.
 * Null means this attack only affects the aimed tile (no extra outline).
 */
export function areaCellsForAim(state: GameState, pending: PendingIntent, aim: Point): Point[] | null {
  const from = playerPos(state);
  switch (pending.kind) {
    case "play_fireball":
      return fireballBlastCells(state, aim);
    case "play_spear":
      return spearStrikeCells(state, from, aim);
    case "play_broadsword":
      return broadswordCleaveCells(state, from, aim);
    case "play_icicle_lance":
      return icicleLanceCells(state, from, aim);
    case "play_flying_kick":
      return flyingKickPath(from, aim, pending.move);
    default:
      return null;
  }
}

/**
 * Fixed area for a card that is selected but not yet played (no aim step).
 * Null means selecting the card does not preview an area.
 */
export function areaCellsForSelectedCard(state: GameState, cardId: string): Point[] | null {
  const effect = state.cardDefs.get(cardId)?.effect;
  if (!effect) return null;
  if (effect.type === "shining_blade") {
    return adjacentStrikeCells(state, playerPos(state), effect.diagonals);
  }
  return null;
}
