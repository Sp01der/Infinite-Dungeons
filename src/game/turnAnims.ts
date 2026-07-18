import type { GameCommand, GameState, HitVisual, Point, TurnAnimEvent } from "./types";

export function animsFromHits(hits: HitVisual[], stateAfter: GameState): TurnAnimEvent[] {
  if (hits.length === 0) return [];
  return [{ kind: "attack", hits, stateAfter }];
}

export function hitsFromAnims(anims: readonly TurnAnimEvent[]): HitVisual[] {
  const out: HitVisual[] = [];
  for (const a of anims) {
    if (a.kind === "attack" || a.kind === "simultaneous") out.push(...a.hits);
  }
  return out;
}

export function pushMoveAnim(
  anims: TurnAnimEvent[],
  entityId: string,
  from: Point,
  to: Point,
): void {
  if (from.x === to.x && from.y === to.y) return;
  anims.push({
    kind: "move",
    entityId,
    fromX: from.x,
    fromY: from.y,
    toX: to.x,
    toY: to.y,
  });
}

export function pushAttackAnim(
  hits: HitVisual[],
  anims: TurnAnimEvent[],
  hit: HitVisual,
  stateAfter: GameState,
): void {
  hits.push(hit);
  anims.push({ kind: "attack", hits: [hit], stateAfter });
}

function isDevCommand(cmd: GameCommand): boolean {
  return cmd.type.startsWith("DEV_");
}

function timelineHasPlayerMove(anims: readonly TurnAnimEvent[]): boolean {
  return anims.some(
    (a) =>
      (a.kind === "move" && a.entityId === "player") ||
      (a.kind === "simultaneous" && a.moves.some((m) => m.entityId === "player")),
  );
}

/**
 * Build the presentation timeline.
 * Move tweens are only for intentional walks / knockback recorded by gameplay —
 * never for floor changes, editor teleports, or pulls that already have their own FX
 * (e.g. vineshon whip in a simultaneous beat).
 */
export function finalizeAnims(
  prev: GameState,
  next: GameState,
  hits: HitVisual[],
  existing: TurnAnimEvent[],
  cmd: GameCommand,
): TurnAnimEvent[] {
  if (existing.length > 0) {
    // e.g. Flying Kick: attack timeline without an explicit player move beat.
    // Do NOT prepend when the player pull is already in a simultaneous event (vine whip).
    const playerMoved =
      prev.floorId === next.floorId &&
      (prev.player.x !== next.player.x || prev.player.y !== next.player.y);
    if (
      playerMoved &&
      !isDevCommand(cmd) &&
      !timelineHasPlayerMove(existing)
    ) {
      return [
        {
          kind: "move",
          entityId: "player",
          fromX: prev.player.x,
          fromY: prev.player.y,
          toX: next.player.x,
          toY: next.player.y,
        },
        ...existing,
      ];
    }
    return existing;
  }

  // No explicit timeline: attacks from hits, plus a player walk only for normal movement.
  const anims: TurnAnimEvent[] = [];
  if (
    !isDevCommand(cmd) &&
    prev.floorId === next.floorId &&
    (prev.player.x !== next.player.x || prev.player.y !== next.player.y)
  ) {
    pushMoveAnim(anims, "player", prev.player, next.player);
  }
  if (hits.length > 0) {
    anims.push({ kind: "attack", hits, stateAfter: next });
  }
  return anims;
}

export function mergeAnimResults(
  dungeonHits: HitVisual[],
  stateAfterDungeon: GameState,
  monAnims: TurnAnimEvent[],
  monHits: HitVisual[],
  _finalState: GameState,
): { hits: HitVisual[]; anims: TurnAnimEvent[] } {
  const anims: TurnAnimEvent[] = [];
  if (dungeonHits.length > 0) {
    anims.push({ kind: "attack", hits: dungeonHits, stateAfter: stateAfterDungeon });
  }
  anims.push(...monAnims);
  return {
    hits: [...dungeonHits, ...monHits],
    anims,
  };
}
