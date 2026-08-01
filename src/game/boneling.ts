import type { BonePilePropInstance, GameState, Point, TurnAnimEvent } from "./types";
import { createMonsterInstance, bonelingLeaderForRoom } from "./monsterSpawn";

export const BONE_PILE_HP = 2;
/** Monster phases that must pass before a fresh pile may merge. */
export const BONE_PILE_SETTLE_TURNS = 2;

/** Ortho + diagonal + same tile. */
const MERGE_NEIGHBORS: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/** Replace a dead Boneling with a bone-pile prop (walkable, no name/HP UI). */
export function convertBonelingToBonePile(
  state: GameState,
  x: number,
  y: number,
  preferredId?: string,
): GameState {
  const dead = state.monsters.find(
    (m) => m.defId === "boneling" && m.hp <= 0 && m.x === x && m.y === y,
  );
  const id = preferredId ?? dead?.id ?? `bone_pile_${x}_${y}_${Math.floor(Math.random() * 1e6)}`;
  const pile: BonePilePropInstance = {
    id,
    x,
    y,
    hp: BONE_PILE_HP,
    settleTurnsRemaining: BONE_PILE_SETTLE_TURNS,
  };
  const monsters = state.monsters.filter(
    (m) => m.id !== id && !(m.defId === "boneling" && m.hp <= 0 && m.x === x && m.y === y),
  );
  return {
    ...state,
    monsters,
    bonePiles: [...state.bonePiles, pile],
    log: [...state.log.slice(-50), "The Boneling collapses into a pile of bones."],
  };
}

export type BonePileTickResult = {
  state: GameState;
  /** Presentation beats: piles slide onto the spawn tile, then Boneling appears. */
  mergeAnims: TurnAnimEvent[];
};

/**
 * Each monster phase: ready piles may merge with an ortho/diagonal/same-tile
 * ready pile into a Boneling at current danger; then settling piles tick down.
 */
export function tickBonePiles(state: GameState): BonePileTickResult {
  let piles = state.bonePiles.filter((p) => p.hp > 0);
  let monsters = state.monsters;
  let log = state.log;
  const consumed = new Set<string>();
  const mergeAnims: TurnAnimEvent[] = [];

  for (const p of piles) {
    if (consumed.has(p.id) || p.settleTurnsRemaining > 0) continue;
    let partner: BonePilePropInstance | undefined;
    for (const o of MERGE_NEIGHBORS) {
      const tx = p.x + o.x;
      const ty = p.y + o.y;
      const found = piles.find(
        (other) =>
          other.id !== p.id &&
          !consumed.has(other.id) &&
          other.settleTurnsRemaining <= 0 &&
          other.x === tx &&
          other.y === ty,
      );
      if (found) {
        partner = found;
        break;
      }
    }
    if (!partner) continue;

    consumed.add(p.id);
    consumed.add(partner.id);

    const spawnX = p.x;
    const spawnY = p.y;
    const aloneInRoom = bonelingLeaderForRoom(monsters, state.roomIds, spawnX, spawnY);
    let risen = createMonsterInstance(
      p.id,
      "boneling",
      spawnX,
      spawnY,
      state.monsterDefs,
      state.danger,
    );
    if (aloneInRoom) {
      risen = {
        ...risen,
        aiFlags: { ...(risen.aiFlags ?? {}), leader: true },
      };
    }
    monsters = monsters.filter((m) => m.id !== p.id && m.id !== partner!.id).concat([risen]);
    log = [...log.slice(-50), "Two bone piles knit together — a Boneling rises!"];

    const remainingPiles = piles.filter((x) => !consumed.has(x.id));
    const stateAfter: GameState = {
      ...state,
      monsters,
      bonePiles: remainingPiles,
      log,
    };

    const moves: Array<{
      entityId: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }> = [];
    for (const pile of [p, partner]) {
      if (pile.x === spawnX && pile.y === spawnY) continue;
      moves.push({
        entityId: pile.id,
        fromX: pile.x,
        fromY: pile.y,
        toX: spawnX,
        toY: spawnY,
      });
    }
    mergeAnims.push({
      kind: "simultaneous",
      moves,
      hits: [],
      stateAfter,
    });
  }

  piles = piles
    .filter((p) => !consumed.has(p.id))
    .map((p) =>
      p.settleTurnsRemaining > 0
        ? { ...p, settleTurnsRemaining: p.settleTurnsRemaining - 1 }
        : p,
    );

  return {
    state: {
      ...state,
      monsters,
      bonePiles: piles,
      log,
    },
    mergeAnims,
  };
}
