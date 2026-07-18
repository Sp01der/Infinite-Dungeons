import { Assets, Rectangle, Texture } from "pixi.js";
import type { AttackFxKind } from "../game/types";

export type AttackFxFrames = {
  magicMissileOrtho: Texture;
  magicMissileDiag: Texture;
  arrowOrtho: Texture;
  arrowDiag: Texture;
  douvlonOrb: Texture;
  fireball: Texture;
  fireballExplosion: Texture[];
  fireOverlays: [Texture, Texture, Texture, Texture, Texture];
  meleeSlash: [Texture, Texture, Texture];
  potionHarming: Texture;
  vineWhipSegment: Texture;
};

const CELL = 16;
const EXPLOSION_FRAME_SIZE = 48;
const EXPLOSION_FRAME_COUNT = 7;

function cellRect(col: number, row: number): Rectangle {
  return new Rectangle(col * CELL, row * CELL, CELL, CELL);
}

/** Load the attack and elemental-status sheets into named frame textures. */
export async function loadAttackFxFrames(url = "/assets/attack_fx.png"): Promise<AttackFxFrames> {
  const [sheet, explosionSheet, statusSheet, potionHarming, vineWhipSegment] = await Promise.all([
    Assets.load<Texture>({
      src: url,
      data: { scaleMode: "nearest" },
    }),
    Assets.load<Texture>({
      src: "/assets/fireball_explosion.png",
      data: { scaleMode: "nearest" },
    }),
    Assets.load<Texture>({
      src: "/assets/elemental_status.png",
      data: { scaleMode: "nearest" },
    }),
    Assets.load<Texture>({
      src: "/assets/potion_of_harming.png",
      data: { scaleMode: "nearest" },
    }),
    Assets.load<Texture>({
      src: "/assets/vine_whip_segment.png",
      data: { scaleMode: "nearest" },
    }),
  ]);
  if (sheet.source) sheet.source.scaleMode = "nearest";
  if (explosionSheet.source) explosionSheet.source.scaleMode = "nearest";
  if (statusSheet.source) statusSheet.source.scaleMode = "nearest";
  if (potionHarming.source) potionHarming.source.scaleMode = "nearest";
  if (vineWhipSegment.source) vineWhipSegment.source.scaleMode = "nearest";

  const frame = (col: number, row: number): Texture =>
    new Texture({ source: sheet.source, frame: cellRect(col, row) });
  const statusFrame = (col: number, row: number): Texture =>
    new Texture({ source: statusSheet.source, frame: cellRect(col, row) });
  const explosionFrames = Array.from(
    { length: EXPLOSION_FRAME_COUNT },
    (_, col) =>
      new Texture({
        source: explosionSheet.source,
        frame: new Rectangle(
          col * EXPLOSION_FRAME_SIZE,
          0,
          EXPLOSION_FRAME_SIZE,
          EXPLOSION_FRAME_SIZE,
        ),
      }),
  );

  return {
    // Row 0
    magicMissileDiag: frame(0, 0),
    magicMissileOrtho: frame(1, 0),
    arrowOrtho: frame(2, 0),
    // Row 1
    douvlonOrb: frame(0, 1),
    fireball: frame(1, 1),
    arrowDiag: frame(2, 1),
    fireballExplosion: explosionFrames,
    // Fire levels 1–5: top row, then middle-left and middle.
    fireOverlays: [
      statusFrame(0, 0),
      statusFrame(1, 0),
      statusFrame(2, 0),
      statusFrame(0, 1),
      statusFrame(1, 1),
    ],
    // Row 2 — melee slash L→R
    meleeSlash: [frame(0, 2), frame(1, 2), frame(2, 2)],
    potionHarming,
    vineWhipSegment,
  };
}

/**
 * Pixi rotation (radians) so a sprite whose art faces `baseFacing` aims toward (dx, dy).
 * Screen coords: +y is down. Ortho missiles/arrows face east (0). Diagonal art faces SE (π/4).
 */
export function aimRotation(dx: number, dy: number, baseFacing: "east" | "southeast"): number {
  if (dx === 0 && dy === 0) return 0;
  const desired = Math.atan2(dy, dx);
  const base = baseFacing === "southeast" ? Math.PI / 4 : 0;
  return desired - base;
}

export function isDiagonalStep(dx: number, dy: number): boolean {
  return dx !== 0 && dy !== 0;
}

export function pickProjectileTexture(
  frames: AttackFxFrames,
  kind: AttackFxKind,
  dx: number,
  dy: number,
): { texture: Texture; rotation: number } {
  switch (kind) {
    case "magic_missile": {
      // Sheet art faces opposite the travel direction — flip 180°.
      if (isDiagonalStep(dx, dy)) {
        return {
          texture: frames.magicMissileDiag,
          rotation: aimRotation(dx, dy, "southeast") + Math.PI,
        };
      }
      return {
        texture: frames.magicMissileOrtho,
        rotation: aimRotation(dx, dy, "east") + Math.PI,
      };
    }
    case "arrow": {
      if (isDiagonalStep(dx, dy)) {
        return {
          texture: frames.arrowDiag,
          rotation: aimRotation(dx, dy, "southeast") + Math.PI,
        };
      }
      return {
        texture: frames.arrowOrtho,
        rotation: aimRotation(dx, dy, "east") + Math.PI,
      };
    }
    case "fireball":
      return {
        texture: frames.fireball,
        rotation: Math.atan2(dy, dx) + Math.PI / 2,
      };
    case "douvlon_orb":
      return { texture: frames.douvlonOrb, rotation: 0 };
    case "potion_harming":
      return { texture: frames.potionHarming, rotation: 0 };
    case "vine_whip":
      return {
        texture: frames.vineWhipSegment,
        rotation: Math.atan2(dy, dx),
      };
    case "melee_slash":
      return {
        texture: frames.meleeSlash[0]!,
        rotation: aimRotation(dx, dy, "southeast") - Math.PI / 2,
      };
  }
}

/** Melee slash frame at target tile, rotated toward attacker. */
export function pickMeleeSlashTexture(
  frames: AttackFxFrames,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  frameIndex: number,
): { texture: Texture; rotation: number } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const idx = Math.max(0, Math.min(2, frameIndex));
  return {
    texture: frames.meleeSlash[idx]!,
    // Art faces SE; rotate 90° CCW so the slash arcs correctly for the attack direction.
    rotation: aimRotation(dx, dy, "southeast") - Math.PI / 2,
  };
}

/** Pick melee slash frame 0–2 from elapsed ms within the slash phase. */
export function meleeSlashFrameIndex(elapsedMs: number, frameMs = 72): number {
  return Math.min(2, Math.floor(elapsedMs / frameMs));
}
