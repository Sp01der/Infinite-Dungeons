import type { AtbmbMoveStyle, Point } from "../types";

export const ORTHO: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export const ALL8: Point[] = [
  ...ORTHO,
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export function dirsForMoveStyle(style: AtbmbMoveStyle): Point[] {
  return style === "any8" ? ALL8 : ORTHO;
}
