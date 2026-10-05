import {
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  Ticker,
} from "pixi.js";
import { chebyshev, keyOf, lineOfSightClear, magicMissilePathClearToPoint } from "../engine/grid";
import { areaCellsForAim, areaCellsForSelectedCard, spearAimCells } from "../game/areaPreview";
import {
  extendReachableWithBlockedDestinations,
  manhattan,
  reachableOrthogonal,
} from "../engine/movement";
import type {
  GameState,
  HitVisual,
  PendingIntent,
  Point,
  RoomKind,
} from "../game/types";
import { tileMatchesAnyPref, resolveTilePrefs, planAtbmbPath, stablePathRng, whenMatches, evaluateEliteSkeletonOptions, eliteSkeletonAttackPrefs } from "../game/atbmb";
import { monsterTilePassable, movementOcc } from "../game/monsterAi";
import type { AtbmbMoveSeek } from "../game/types";
import type { SpriteStyle } from "./assets";
import type { AttackFxFrames } from "./attackFx";
import {
  meleeSlashFrameIndex,
  pickMeleeSlashTexture,
  pickProjectileTexture,
  shiningBladeFrameIndex,
  SHINING_BLADE_MS,
} from "./attackFx";
import { groundLootSpriteId } from "../game/lootIcons";

/** Logical tile size in pixels (smaller than original 48 for a wider view). */
export const TILE = 40;

/** Default canvas size before the first layout pass (fills `#game-viewport` after load). */
export const VIEW_COLS = 14;
export const VIEW_ROWS = 10;
export const VIEW_WIDTH_PX = VIEW_COLS * TILE;
export const VIEW_HEIGHT_PX = VIEW_ROWS * TILE;

const HIT_ANIM_MS = 520;
const HIT_FLASH_MS = 280;
const PROJECTILE_TRAVEL_MS = 240;
const MELEE_SLASH_MS = 216;
const FIREBALL_EXPLOSION_FRAME_MS = 100;
const FIREBALL_EXPLOSION_MS = 700;
const VINE_EXTEND_MS = 280;
const FX_SPRITE_SCALE = 2;
const MOVE_ANIM_MS = 160;

/** Thickness of “heavy” wall rim along discovered floor (highlights door gaps). */
const WALL_RIM_THICK = Math.max(5, Math.round(TILE * 0.16));

const CLICK_DRAG_THRESHOLD_PX = 9;

function stableBinaryVariant(id: string): "a" | "b" {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return (hash & 1) === 0 ? "a" : "b";
}

export class GridView extends Container {
  private floorLayer = new Container();
  private wallRimLayer = new Graphics();
  private wallBorderLayer = new Container();
  private gridLines = new Graphics();
  private potLayer = new Container();
  private rockLayer = new Container();
  private lootLayer = new Container();
  private fogLayer = new Container();
  private entityLayer = new Container();
  private highlightLayer = new Container();
  /** Red outline of every tile an area attack will hit. */
  private areaOutline = new Graphics();
  private brainHighlightLayer = new Graphics();
  private collapseMarkerLayer = new Container();
  private douvlonLineLayer = new Graphics();
  private darknessLayer = new Container();
  private fxLayer = new Container();
  private styles: Map<string, SpriteStyle>;
  private onCellClick: (x: number, y: number) => void;
  private onCellSecondary: (x: number, y: number) => void;
  private latestState: GameState | null = null;
  /** Editor: monster instance id whose ATBMB brain tiles are highlighted. */
  private brainInspectMonsterId: string | null = null;
  private hitAnims: {
    gx: number;
    gy: number;
    damage: number;
    showDamage: boolean;
    t0: number;
    fx?: HitVisual["fx"];
  }[] = [];
  private fxTickerAdded = false;
  private harmingCloudTickerAdded = false;
  private lastHarmingCloudFrame = -1;
  private attackFxFrames: AttackFxFrames | null = null;
  /** When true, use pixel-art textures where available; otherwise solid tint boxes. */
  private usePixelArt = true;
  /** Entity roots keyed by `"player"` or monster instance id — used for move tweens. */
  private entityRoots = new Map<string, Container>();
  private moveTickerAdded = false;
  private activeMoves: {
    root: Container;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    t0: number;
    duration: number;
    resolve: () => void;
  }[] = [];
  /** When true, skip harming-cloud re-sync so mid-tween entity roots stay intact. */
  private presentationLocked = false;

  setPresentationLocked(locked: boolean): void {
    this.presentationLocked = locked;
  }

  private viewportWidth = VIEW_WIDTH_PX;
  private viewportHeight = VIEW_HEIGHT_PX;
  private interactionCanvas: HTMLCanvasElement | null = null;

  private panPointerDown = false;
  private lastPanClientX = 0;
  private lastPanClientY = 0;
  private panAccumDist = 0;
  private hoverCell: Point | null = null;
  /** Hand card selected but not yet played. Used for fixed areas such as Shining Blade. */
  private previewCardId: string | null = null;

  constructor(
    styles: Map<string, SpriteStyle>,
    onCellClick: (x: number, y: number) => void,
    onCellSecondary: (x: number, y: number) => void,
  ) {
    super();
    this.styles = styles;
    this.onCellClick = onCellClick;
    this.onCellSecondary = onCellSecondary;
    this.sortableChildren = true;
    this.floorLayer.zIndex = 0;
    this.wallRimLayer.zIndex = 1;
    this.wallBorderLayer.zIndex = 1.5;
    this.gridLines.zIndex = 2;
    this.potLayer.zIndex = 3;
    this.rockLayer.zIndex = 4;
    this.lootLayer.zIndex = 5;
    this.fogLayer.zIndex = 6;
    this.entityLayer.zIndex = 7;
    this.collapseMarkerLayer.zIndex = 6;
    this.douvlonLineLayer.zIndex = 7;
    this.darknessLayer.zIndex = 8;
    this.brainHighlightLayer.zIndex = 8.5;
    this.highlightLayer.zIndex = 9;
    this.areaOutline.zIndex = 9.5;
    this.areaOutline.eventMode = "none";
    this.fxLayer.zIndex = 10;
    this.addChild(this.floorLayer);
    this.addChild(this.wallRimLayer);
    this.addChild(this.wallBorderLayer);
    this.addChild(this.gridLines);
    this.addChild(this.potLayer);
    this.addChild(this.rockLayer);
    this.addChild(this.lootLayer);
    this.addChild(this.fogLayer);
    this.addChild(this.entityLayer);
    this.addChild(this.collapseMarkerLayer);
    this.addChild(this.douvlonLineLayer);
    this.addChild(this.darknessLayer);
    this.addChild(this.brainHighlightLayer);
    this.addChild(this.highlightLayer);
    this.addChild(this.areaOutline);
    this.addChild(this.fxLayer);
    this.eventMode = "static";
    this.cursor = "grab";
    this.on("pointerdown", this.onPointerDown);
    this.on("pointermove", this.onPointerMove);
    this.on("pointerup", this.onPointerUp);
    this.on("pointerupoutside", this.onPointerUp);
    this.on("pointerleave", this.onPointerLeave);
  }

  /** Viewport size in CSS pixels (fixed camera window). */
  configureViewport(widthPx: number, heightPx: number, canvas: HTMLCanvasElement): void {
    this.viewportWidth = widthPx;
    this.viewportHeight = heightPx;
    if (this.interactionCanvas !== canvas) {
      this.interactionCanvas?.removeEventListener("contextmenu", this.preventContextMenu);
      canvas.addEventListener("contextmenu", this.preventContextMenu);
    }
    this.interactionCanvas = canvas;
  }

  getPixelArtEnabled(): boolean {
    return this.usePixelArt;
  }

  /** Card currently selected in hand. Fixed areas (Shining Blade) outline before the card is played. */
  setPreviewCardId(cardId: string | null): void {
    this.previewCardId = cardId;
  }

  setBrainInspectMonsterId(id: string | null): void {
    this.brainInspectMonsterId = id;
  }

  getBrainInspectMonsterId(): string | null {
    return this.brainInspectMonsterId;
  }

  /** Toggle pixel-art textures vs solid color boxes. Re-syncs if a state is loaded. */
  setPixelArtEnabled(enabled: boolean): void {
    if (this.usePixelArt === enabled) return;
    this.usePixelArt = enabled;
    if (this.latestState) this.sync(this.latestState);
  }

  setAttackFxFrames(frames: AttackFxFrames | null): void {
    this.attackFxFrames = frames;
  }

  centerOnPlayer(state: GameState): void {
    const px = (state.player.x + 0.5) * TILE;
    const py = (state.player.y + 0.5) * TILE;
    this.position.x = this.viewportWidth / 2 - px;
    this.position.y = this.viewportHeight / 2 - py;
    this.clampCamera(state);
  }

  /** After window / container resize, keep pan within bounds. */
  reapplyCameraClamp(state: GameState): void {
    this.clampCamera(state);
  }

  private clampCamera(state: GameState | null): void {
    if (!state) return;
    const mapW = state.width * TILE;
    const mapH = state.height * TILE;
    if (mapW <= this.viewportWidth) {
      this.position.x = (this.viewportWidth - mapW) / 2;
    } else {
      this.position.x = Math.min(0, Math.max(this.viewportWidth - mapW, this.position.x));
    }
    if (mapH <= this.viewportHeight) {
      this.position.y = (this.viewportHeight - mapH) / 2;
    } else {
      this.position.y = Math.min(0, Math.max(this.viewportHeight - mapH, this.position.y));
    }
  }

  private onPointerDown = (ev: FederatedPointerEvent) => {
    const ne = ev.nativeEvent as PointerEvent;
    if (ne.button === 2) {
      ne.preventDefault();
      const s = this.latestState;
      if (!s?.editorMode) return;
      const lp = ev.getLocalPosition(this);
      const x = Math.floor(lp.x / TILE);
      const y = Math.floor(lp.y / TILE);
      if (x < 0 || y < 0 || x >= s.width || y >= s.height) return;
      this.onCellSecondary(x, y);
      return;
    }
    if (ne.button !== 0) return;
    this.panPointerDown = true;
    this.panAccumDist = 0;
    this.lastPanClientX = ne.clientX;
    this.lastPanClientY = ne.clientY;
    this.cursor = "grabbing";
    try {
      this.interactionCanvas?.setPointerCapture(ne.pointerId);
    } catch {
      /* ignore */
    }
  };

  private onPointerMove = (ev: FederatedPointerEvent) => {
    if (this.panPointerDown) {
      const ne = ev.nativeEvent as PointerEvent;
      const dx = ne.clientX - this.lastPanClientX;
      const dy = ne.clientY - this.lastPanClientY;
      this.lastPanClientX = ne.clientX;
      this.lastPanClientY = ne.clientY;
      this.panAccumDist += Math.hypot(dx, dy);
      this.position.x += dx;
      this.position.y += dy;
      this.clampCamera(this.latestState);
      return;
    }
    this.updateHoverCell(ev);
  };

  private onPointerLeave = (): void => {
    if (!this.hoverCell) return;
    this.hoverCell = null;
    this.drawAreaOutline();
  };

  private updateHoverCell(ev: FederatedPointerEvent): void {
    const s = this.latestState;
    if (!s) return;
    const lp = ev.getLocalPosition(this);
    const x = Math.floor(lp.x / TILE);
    const y = Math.floor(lp.y / TILE);
    const next =
      x < 0 || y < 0 || x >= s.width || y >= s.height ? null : { x, y };
    if (this.hoverCell?.x === next?.x && this.hoverCell?.y === next?.y) return;
    this.hoverCell = next;
    this.drawAreaOutline();
  }

  private onPointerUp = (ev: FederatedPointerEvent) => {
    const ne = ev.nativeEvent as PointerEvent;
    try {
      this.interactionCanvas?.releasePointerCapture(ne.pointerId);
    } catch {
      /* ignore */
    }
    this.cursor = "grab";
    const wasPan = this.panPointerDown;
    this.panPointerDown = false;

    if (!wasPan) return;
    if (this.panAccumDist >= CLICK_DRAG_THRESHOLD_PX) return;

    const s = this.latestState;
    if (!s || (s.phase !== "player" && s.phase !== "peace")) return;
    const lp = ev.getLocalPosition(this);
    const x = Math.floor(lp.x / TILE);
    const y = Math.floor(lp.y / TILE);
    if (x < 0 || y < 0 || x >= s.width || y >= s.height) return;
    this.onCellClick(x, y);
  };

  private preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  /** Attack FX (when pixel art on) + red flash + floating damage number. */
  playHits(hits: HitVisual[]): void {
    const base = performance.now();
    const fireballAnchor = hits.find((h) => h.fx?.kind === "fireball");
    hits.forEach((h, i) => {
      this.hitAnims.push({
        gx: h.gridX,
        gy: h.gridY,
        damage: h.damage,
        showDamage: h.showDamage !== false,
        // A fireball's blast damage lands together, after its one projectile arrives.
        t0: base + (fireballAnchor && h !== fireballAnchor ? PROJECTILE_TRAVEL_MS : i * 55),
        fx: h.fx,
      });
    });
    if (!this.fxTickerAdded) {
      Ticker.shared.add(this.updateFx, this);
      this.fxTickerAdded = true;
    }
  }

  /**
   * Play hits and resolve when the attack impact lands (damage reveal),
   * not when floating numbers fully fade.
   */
  playHitsAsync(hits: HitVisual[]): Promise<void> {
    if (hits.length === 0) return Promise.resolve();
    this.playHits(hits);
    const fireballAnchor = hits.find((h) => h.fx?.kind === "fireball");
    let maxImpact = 0;
    hits.forEach((h, i) => {
      const t0Offset =
        fireballAnchor && h !== fireballAnchor ? PROJECTILE_TRAVEL_MS : i * 55;
      const impact = t0Offset + this.fxTravelMs(h.fx);
      if (impact > maxImpact) maxImpact = impact;
    });
    return new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(maxImpact, 1));
    });
  }

  /** Tween an entity root from one tile to another. */
  playMove(
    entityId: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): Promise<void> {
    const root = this.entityRoots.get(entityId);
    if (!root) return Promise.resolve();
    const steps = Math.max(1, Math.abs(toX - fromX) + Math.abs(toY - fromY));
    const duration = MOVE_ANIM_MS * Math.min(steps, 4);
    root.x = fromX * TILE;
    root.y = fromY * TILE;
    return new Promise((resolve) => {
      this.activeMoves.push({
        root,
        fromX: fromX * TILE,
        fromY: fromY * TILE,
        toX: toX * TILE,
        toY: toY * TILE,
        t0: performance.now(),
        duration,
        resolve,
      });
      if (!this.moveTickerAdded) {
        Ticker.shared.add(this.updateMoves, this);
        this.moveTickerAdded = true;
      }
    });
  }

  private updateMoves = (): void => {
    const now = performance.now();
    const remaining: typeof this.activeMoves = [];
    for (const m of this.activeMoves) {
      const t = Math.min(1, (now - m.t0) / m.duration);
      const eased = t * t * (3 - 2 * t);
      m.root.x = m.fromX + (m.toX - m.fromX) * eased;
      m.root.y = m.fromY + (m.toY - m.fromY) * eased;
      if (t >= 1) {
        m.root.x = m.toX;
        m.root.y = m.toY;
        m.resolve();
      } else {
        remaining.push(m);
      }
    }
    this.activeMoves = remaining;
    if (this.activeMoves.length === 0) {
      Ticker.shared.remove(this.updateMoves, this);
      this.moveTickerAdded = false;
    }
  };

  private ensureEntityRoot(entityId: string, tileX: number, tileY: number): Container {
    const root = new Container();
    root.x = tileX * TILE;
    root.y = tileY * TILE;
    this.entityRoots.set(entityId, root);
    this.entityLayer.addChild(root);
    return root;
  }

  private fxTravelMs(fx: HitVisual["fx"] | undefined): number {
    if (!fx || !this.usePixelArt || !this.attackFxFrames) return 0;
    if (fx.kind === "melee_slash") return MELEE_SLASH_MS;
    if (fx.kind === "vine_whip") return VINE_EXTEND_MS;
    if (fx.kind === "shining_blade") return SHINING_BLADE_MS;
    return PROJECTILE_TRAVEL_MS;
  }

  private vineRetractMs(fx: HitVisual["fx"], catchX: number, catchY: number): number {
    if (!fx || fx.tipToX === undefined || fx.tipToY === undefined) {
      return MOVE_ANIM_MS;
    }
    const steps = Math.max(
      1,
      Math.abs(fx.tipToX - catchX) + Math.abs(fx.tipToY - catchY),
    );
    return MOVE_ANIM_MS * Math.min(steps, 4);
  }

  private fxDurationMs(fx: HitVisual["fx"] | undefined, catchX = 0, catchY = 0): number {
    if (!fx || !this.usePixelArt || !this.attackFxFrames) return 0;
    if (fx.kind === "fireball") return PROJECTILE_TRAVEL_MS + FIREBALL_EXPLOSION_MS;
    if (fx.kind === "vine_whip") return VINE_EXTEND_MS + this.vineRetractMs(fx, catchX, catchY);
    if (fx.kind === "shining_blade") return SHINING_BLADE_MS;
    return this.fxTravelMs(fx);
  }

  /**
   * Vine extends to the catch tile, then retracts while the target is pulled.
   */
  async playVineWhipPull(
    hit: HitVisual,
    move: { entityId: string; fromX: number; fromY: number; toX: number; toY: number },
  ): Promise<void> {
    this.playHits([hit]);
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, Math.max(VINE_EXTEND_MS, 1));
    });
    await this.playMove(move.entityId, move.fromX, move.fromY, move.toX, move.toY);
  }

  private drawVineSegments(
    texture: Texture,
    fromCx: number,
    fromCy: number,
    tipCx: number,
    tipCy: number,
  ): void {
    const dx = tipCx - fromCx;
    const dy = tipCy - fromCy;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    const spacing = TILE * 0.85;
    const count = Math.max(1, Math.round(dist / spacing));
    const rotation = Math.atan2(dy, dx);
    for (let i = 0; i < count; i++) {
      const t = Math.min(1, ((i + 0.5) * spacing) / dist);
      const x = fromCx + dx * t;
      const y = fromCy + dy * t;
      this.fxLayer.addChild(this.makeFxSprite(texture, x, y, rotation));
    }
  }

  private makeFxSprite(texture: Texture, cx: number, cy: number, rotation: number): Sprite {
    const spr = new Sprite(texture);
    spr.anchor.set(0.5, 0.5);
    spr.x = cx;
    spr.y = cy;
    spr.rotation = rotation;
    spr.scale.set(FX_SPRITE_SCALE);
    return spr;
  }

  private makeFireOverlay(gx: number, gy: number, levels: number): Sprite | null {
    if (!this.usePixelArt || !this.attackFxFrames || levels <= 0) return null;
    const index = Math.min(5, Math.max(1, Math.trunc(levels))) - 1;
    const spr = new Sprite(this.attackFxFrames.fireOverlays[index]!);
    spr.x = gx * TILE;
    spr.y = gy * TILE;
    spr.width = TILE;
    spr.height = TILE;
    spr.eventMode = "none";
    return spr;
  }

  private updateFx = (): void => {
    const now = performance.now();
    this.fxLayer.removeChildren();

    this.hitAnims = this.hitAnims.filter((a) => {
      const elapsed = now - a.t0;
      const dur = Math.max(
        this.fxDurationMs(a.fx, a.gx, a.gy),
        this.fxTravelMs(a.fx) + HIT_ANIM_MS,
      );
      return elapsed < dur;
    });

    if (this.hitAnims.length === 0) {
      Ticker.shared.remove(this.updateFx, this);
      this.fxTickerAdded = false;
      return;
    }

    const fs = Math.round(14 * (TILE / 40));
    const frames = this.attackFxFrames;
    const showFx = this.usePixelArt && frames;

    for (const a of this.hitAnims) {
      const elapsed = now - a.t0;
      const fx = a.fx;
      let damageStart = 0;

      if (fx && showFx) {
        const fromCx = fx.fromX * TILE + TILE / 2;
        const fromCy = fx.fromY * TILE + TILE / 2;
        const toCx = a.gx * TILE + TILE / 2;
        const toCy = a.gy * TILE + TILE / 2;
        const dx = a.gx - fx.fromX;
        const dy = a.gy - fx.fromY;

        if (fx.kind === "melee_slash") {
          if (elapsed < MELEE_SLASH_MS) {
            const fi = meleeSlashFrameIndex(elapsed);
            const { texture, rotation } = pickMeleeSlashTexture(
              frames,
              fx.fromX,
              fx.fromY,
              a.gx,
              a.gy,
              fi,
            );
            this.fxLayer.addChild(this.makeFxSprite(texture, toCx, toCy, rotation));
          }
          damageStart = MELEE_SLASH_MS;
        } else if (fx.kind === "shining_blade") {
          if (elapsed < SHINING_BLADE_MS) {
            const fi = shiningBladeFrameIndex(elapsed);
            const spr = this.makeFxSprite(
              frames.shiningBlade[fi]!,
              fromCx,
              fromCy,
              0,
            );
            // 60×60 art; central 20×20 maps onto the caster's tile (TILE).
            spr.width = TILE * 3;
            spr.height = TILE * 3;
            this.fxLayer.addChild(spr);
          }
          damageStart = 0;
        } else if (fx.kind === "vine_whip") {
          const retractMs = this.vineRetractMs(fx, a.gx, a.gy);
          const total = VINE_EXTEND_MS + retractMs;
          if (elapsed < total) {
            let tipX: number;
            let tipY: number;
            if (elapsed < VINE_EXTEND_MS) {
              const t = elapsed / VINE_EXTEND_MS;
              const eased = t * t * (3 - 2 * t);
              tipX = fromCx + (toCx - fromCx) * eased;
              tipY = fromCy + (toCy - fromCy) * eased;
            } else {
              const pullCx =
                fx.tipToX !== undefined ? fx.tipToX * TILE + TILE / 2 : toCx;
              const pullCy =
                fx.tipToY !== undefined ? fx.tipToY * TILE + TILE / 2 : toCy;
              const t = Math.min(1, (elapsed - VINE_EXTEND_MS) / retractMs);
              const eased = t * t * (3 - 2 * t);
              tipX = toCx + (pullCx - toCx) * eased;
              tipY = toCy + (pullCy - toCy) * eased;
            }
            this.drawVineSegments(frames.vineWhipSegment, fromCx, fromCy, tipX, tipY);
          }
          damageStart = VINE_EXTEND_MS;
        } else {
          if (elapsed < PROJECTILE_TRAVEL_MS) {
            const t = elapsed / PROJECTILE_TRAVEL_MS;
            const px = fromCx + (toCx - fromCx) * t;
            const py = fromCy + (toCy - fromCy) * t;
            const { texture, rotation } = pickProjectileTexture(frames, fx.kind, dx, dy);
            this.fxLayer.addChild(this.makeFxSprite(texture, px, py, rotation));
          } else if (fx.kind === "fireball" && elapsed < PROJECTILE_TRAVEL_MS + FIREBALL_EXPLOSION_MS) {
            const explosionElapsed = elapsed - PROJECTILE_TRAVEL_MS;
            const frameIndex = Math.min(
              frames.fireballExplosion.length - 1,
              Math.floor(explosionElapsed / FIREBALL_EXPLOSION_FRAME_MS),
            );
            const spr = this.makeFxSprite(
              frames.fireballExplosion[frameIndex]!,
              toCx,
              toCy,
              0,
            );
            // The 48×48 animation represents the full 3×3 blast around its center tile.
            spr.width = TILE * 3;
            spr.height = TILE * 3;
            this.fxLayer.addChild(spr);
          }
          damageStart = PROJECTILE_TRAVEL_MS;
        }
      }

      if (!a.showDamage) continue;
      const dmgElapsed = elapsed - damageStart;
      if (dmgElapsed < 0) continue;

      if (dmgElapsed < HIT_FLASH_MS) {
        const flash = new Graphics();
        const alpha = 0.55 * (1 - dmgElapsed / HIT_FLASH_MS);
        flash
          .rect(a.gx * TILE, a.gy * TILE, TILE, TILE)
          .fill({ color: 0xff2020, alpha });
        this.fxLayer.addChild(flash);
      }

      const rise = (dmgElapsed / 1000) * TILE * 1.1;
      const lbl = new Text({
        text: String(a.damage),
        style: {
          fontFamily: "Segoe UI, system-ui, sans-serif",
          fontSize: fs,
          fontWeight: "700",
          fill: 0xff5555,
          stroke: { color: 0x1a0505, width: 4 },
        },
      });
      lbl.anchor.set(0.5, 1);
      lbl.x = a.gx * TILE + TILE / 2;
      lbl.y = a.gy * TILE + TILE * 0.32 - rise;
      lbl.alpha = Math.max(0, 1 - dmgElapsed / HIT_ANIM_MS);
      this.fxLayer.addChild(lbl);
    }
  };

  sync(state: GameState): void {
    this.latestState = state;
    this.hitArea = new Rectangle(0, 0, state.width * TILE, state.height * TILE);

    this.floorLayer.removeChildren();
    this.wallRimLayer.clear();
    this.wallBorderLayer.removeChildren();
    this.potLayer.removeChildren();
    this.rockLayer.removeChildren();
    this.lootLayer.removeChildren();
    this.fogLayer.removeChildren();
    this.entityLayer.removeChildren();
    this.entityRoots.clear();
    this.collapseMarkerLayer.removeChildren();
    this.douvlonLineLayer.clear();
    this.darknessLayer.removeChildren();
    this.highlightLayer.removeChildren();
    this.brainHighlightLayer.clear();
    this.gridLines.clear();

    const w = state.width;
    const h = state.height;

    // Faced walls read as part of the room, so they never produce a border edge.
    const isSolidWall = (tx: number, ty: number): boolean => {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return true;
      if (state.tiles[ty][tx] !== "wall") return false;
      return !this.isWallFaceTile(state, tx, ty);
    };

    const bridgeKeys = this.bridgeKeySet(state);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const kind = state.tiles[y][x];
        if (kind === "blocked") {
          const g = new Graphics();
          g.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: 0x3a3040, alpha: 1 });
          this.floorLayer.addChild(g);
          this.gridLines
            .rect(x * TILE, y * TILE, TILE, TILE)
            .stroke({ width: 1, color: 0x000000, alpha: 0.28 });
          continue;
        }
        const rid = state.roomIds[y]?.[x] ?? -1;
        const rkind = rid >= 0 ? state.roomKinds[rid] : undefined;
        let id: string;
        if (kind === "wall") {
          id = this.isWallFaceTile(state, x, y)
            ? this.pickWallFaceSpriteId(state, x, y)
            : "wall";
        } else if (kind === "water") {
          id = bridgeKeys.has(keyOf({ x, y }))
            ? this.pickThemedFloorSpriteId(state, x, y, rid, rkind)
            : "water";
        } else {
          id = this.pickThemedFloorSpriteId(state, x, y, rid, rkind);
        }
        const spr = this.makeSprite(id);
        const rot = this.floorTileRotation(id, x, y);
        if (rot !== 0) {
          spr.anchor.set(0.5);
          spr.x = x * TILE + TILE / 2;
          spr.y = y * TILE + TILE / 2;
          spr.rotation = rot;
        } else {
          spr.x = x * TILE;
          spr.y = y * TILE;
        }
        this.floorLayer.addChild(spr);
        this.gridLines
          .rect(x * TILE, y * TILE, TILE, TILE)
          .stroke({ width: 1, color: 0x000000, alpha: 0.28 });
      }
    }

    for (const b of state.bridgeTiles) {
      if (b.x < 0 || b.y < 0 || b.x >= w || b.y >= h) continue;
      if (state.tiles[b.y][b.x] !== "water") continue;
      if (state.fogOfWar && !state.discovered.has(keyOf(b))) continue;
      const g = new Graphics();
      const pad = TILE * 0.2;
      g.roundRect(b.x * TILE + pad, b.y * TILE + TILE * 0.38, TILE - pad * 2, TILE * 0.22, 3).fill({
        color: 0x6b5344,
        alpha: 0.92,
      });
      g.moveTo(b.x * TILE + TILE * 0.18, b.y * TILE + TILE * 0.52)
        .lineTo(b.x * TILE + TILE * 0.82, b.y * TILE + TILE * 0.58)
        .stroke({ width: 1.4, color: 0x2a1a10, alpha: 0.9 });
      g.moveTo(b.x * TILE + TILE * 0.22, b.y * TILE + TILE * 0.62)
        .lineTo(b.x * TILE + TILE * 0.78, b.y * TILE + TILE * 0.68)
        .stroke({ width: 1.2, color: 0x2a1a10, alpha: 0.75 });
      this.floorLayer.addChild(g);
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (state.fogOfWar && !this.isRevealedForDraw(state, x, y)) continue;
        const tk = state.tiles[y][x];
        const bordered =
          tk === "floor" ||
          (tk === "water" && bridgeKeys.has(keyOf({ x, y }))) ||
          this.isWallFaceTile(state, x, y);
        if (!bordered) continue;
        const ox = x * TILE;
        const oy = y * TILE;
        if (isSolidWall(x, y - 1)) this.addWallBorder(state, "top", ox, oy);
        if (isSolidWall(x + 1, y)) this.addWallBorder(state, "right", ox, oy);
        if (isSolidWall(x, y + 1)) this.addWallBorder(state, "bottom", ox, oy);
        if (isSolidWall(x - 1, y)) this.addWallBorder(state, "left", ox, oy);
      }
    }

    const markCollapseTile = (cx: number, cy: number) => {
      const pad = TILE * 0.18;
      const x0 = cx * TILE + pad;
      const y0 = cy * TILE + pad;
      const x1 = (cx + 1) * TILE - pad;
      const y1 = (cy + 1) * TILE - pad;
      const g = new Graphics();
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3, color: 0xff6600, alpha: 0.92 });
      g.moveTo(x1, y0).lineTo(x0, y1).stroke({ width: 3, color: 0xff6600, alpha: 0.92 });
      this.collapseMarkerLayer.addChild(g);
    };
    if (state.pendingCollapse?.tiles) {
      for (const t of state.pendingCollapse.tiles) markCollapseTile(t.x, t.y);
    }
    if (state.pendingTargetedCollapse) {
      for (const t of state.pendingTargetedCollapse) markCollapseTile(t.x, t.y);
    }

    const markFloodingTile = (cx: number, cy: number) => {
      const pad = TILE * 0.16;
      const x0 = cx * TILE + pad;
      const y0 = cy * TILE + pad;
      const x1 = (cx + 1) * TILE - pad;
      const y1 = (cy + 1) * TILE - pad;
      const g = new Graphics();
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3, color: 0x3498db, alpha: 0.88 });
      g.moveTo(x1, y0).lineTo(x0, y1).stroke({ width: 3, color: 0x3498db, alpha: 0.88 });
      this.collapseMarkerLayer.addChild(g);
    };
    if (state.floodingRoomId != null) {
      const frid = state.floodingRoomId;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (state.roomIds[y][x] !== frid) continue;
          const tk = state.tiles[y][x];
          if (tk !== "floor" && tk !== "water") continue;
          if (state.fogOfWar && !state.discovered.has(keyOf({ x, y }))) continue;
          markFloodingTile(x, y);
        }
      }
    }

    const markStalactiteTile = (cx: number, cy: number) => {
      const pad = TILE * 0.2;
      const x0 = cx * TILE + pad;
      const y0 = cy * TILE + pad;
      const x1 = (cx + 1) * TILE - pad;
      const y1 = (cy + 1) * TILE - pad;
      const g = new Graphics();
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3, color: 0x9a9a9a, alpha: 0.95 });
      g.moveTo(x1, y0).lineTo(x0, y1).stroke({ width: 3, color: 0x9a9a9a, alpha: 0.95 });
      this.collapseMarkerLayer.addChild(g);
    };
    for (const st of state.pendingStalactites) {
      if (state.fogOfWar && !state.discovered.has(keyOf(st))) continue;
      markStalactiteTile(st.x, st.y);
    }

    const inset = Math.round(4 * (TILE / 40));

    for (const pot of state.pots) {
      if (state.fogOfWar && !state.discovered.has(keyOf(pot))) continue;
      this.potLayer.addChild(
        this.makePlacedSprite(pot.magic ? "magic_pot" : "pot", pot.x, pot.y),
      );
    }

    for (const rk of state.rocks) {
      if (state.fogOfWar && !state.discovered.has(keyOf(rk))) continue;
      const g = new Graphics();
      const pad = Math.max(5, Math.round(TILE * 0.14));
      g.roundRect(rk.x * TILE + pad, rk.y * TILE + pad, TILE - pad * 2, TILE - pad * 2, 5).fill({
        color: 0x6b5c4c,
        alpha: 0.95,
      });
      this.rockLayer.addChild(g);
    }

    for (const tw of state.tangleweeds) {
      if (tw.hp <= 0) continue;
      if (state.fogOfWar && !state.discovered.has(keyOf(tw))) continue;
      const variant = stableBinaryVariant(tw.id);
      const vine = this.makePlacedSprite(`tangleweed_vine_${variant}`, tw.x, tw.y);
      if (tw.withered) vine.tint = 0x9a6841;
      this.rockLayer.addChild(vine);
    }

    for (const loot of state.groundLoot) {
      if (state.fogOfWar && !state.discovered.has(keyOf(loot))) continue;
      const spriteId = groundLootSpriteId(loot);
      const style = this.styles.get(spriteId);
      if (this.usePixelArt && style?.kind === "texture") {
        const size = 16;
        const spr = this.makeSprite(spriteId);
        spr.width = size;
        spr.height = size;
        spr.x = loot.x * TILE + TILE - size - 2;
        spr.y = loot.y * TILE + TILE - size - 2;
        this.lootLayer.addChild(spr);
      } else {
        const g = new Graphics();
        const cx = loot.x * TILE + TILE * 0.72;
        const cy = loot.y * TILE + TILE * 0.72;
        const r = Math.max(3, Math.round(TILE * 0.12));
        let color = 0xe8c547;
        if (loot.kind === "bread") color = 0xc4a574;
        if (loot.kind === "herb") color = 0x27ae60;
        if (loot.kind === "card") color = 0x9b59b6;
        if (loot.kind === "cheese") color = 0xf1c40f;
        if (loot.kind === "gem") color = 0xe74c3c;
        if (loot.kind === "flame_of_destruction") color = 0xe67e22;
        if (loot.kind === "magic_tome") color = 0x5dade2;
        g.circle(cx, cy, r).fill({ color, alpha: 0.92 });
        this.lootLayer.addChild(g);
      }
    }

    for (const chest of state.chests) {
      if (state.fogOfWar && !state.discovered.has(keyOf(chest))) continue;
      const spr = this.makeSprite("chest");
      const chInset = Math.max(4, Math.round(5 * (TILE / 48)));
      spr.x = chest.x * TILE + chInset / 2;
      spr.y = chest.y * TILE + chInset / 2;
      spr.width = TILE - chInset;
      spr.height = TILE - chInset;
      this.potLayer.addChild(spr);
    }

    if (state.fogOfWar) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (this.isRevealedForDraw(state, x, y)) continue;
          const spr = this.makeSprite("fog");
          spr.x = x * TILE;
          spr.y = y * TILE;
          this.fogLayer.addChild(spr);
        }
      }
    }

    const playerRoot = this.ensureEntityRoot("player", state.player.x, state.player.y);
    playerRoot.addChild(this.makePlacedSprite("player", 0, 0));
    const playerFire = this.makeFireOverlay(0, 0, state.player.fireLevels ?? 0);
    if (playerFire) playerRoot.addChild(playerFire);
    if ((state.player.resistance ?? 0) > 0) {
      const resStyle = this.styles.get("status_resistance");
      if (this.usePixelArt && resStyle?.kind === "texture") {
        playerRoot.addChild(this.makePlacedSprite("status_resistance", 0, 0));
      } else {
        const r = Math.max(3, Math.round(TILE * 0.11));
        const dot = new Graphics();
        dot.circle(TILE - r - 3, r + 3, r).fill({ color: 0x3d6ed8, alpha: 0.95 });
        playerRoot.addChild(dot);
      }
    }
    playerRoot.addChild(this.makeEntityLabel("You", 0, 0, 0xffffff));

    for (const bp of state.bonePiles) {
      if (bp.hp <= 0) continue;
      if (state.fogOfWar && !state.discovered.has(keyOf(bp))) continue;
      const root = this.ensureEntityRoot(bp.id, bp.x, bp.y);
      root.addChild(this.makePlacedSprite("enemy_bone_pile", 0, 0));
    }

    const douvlonPairs = new Map<string, { red?: { x: number; y: number }; blue?: { x: number; y: number }; visibleCount: number }>();
    for (const m of state.monsters) {
      if (m.hp <= 0) continue;
      if (m.defId === "douvlon" && m.douvlonPairId) {
        const slot = douvlonPairs.get(m.douvlonPairId) ?? { visibleCount: 0 };
        if (m.douvlonColor === "red") slot.red = { x: m.x, y: m.y };
        if (m.douvlonColor === "blue") slot.blue = { x: m.x, y: m.y };
        if (!state.fogOfWar || state.discovered.has(keyOf(m))) slot.visibleCount += 1;
        douvlonPairs.set(m.douvlonPairId, slot);
      }
    }
    for (const m of state.monsters) {
      if (m.hp <= 0) continue;
      if (state.fogOfWar && !state.discovered.has(keyOf(m))) continue;
      const def = state.monsterDefs.get(m.defId);
      const mimicChest = m.defId === "mimic" && m.mimicAsleep;
      const archerAiming =
        m.defId === "skeleton_archer" &&
        (m.aiStateId === "aiming" || m.bowLoaded);
      const spriteId =
        m.defId === "skeleton" && m.skeletonWeapon
          ? `enemy_skeleton_${m.skeletonWeapon}`
          : archerAiming
            ? "enemy_skeleton_archer_aiming"
            : m.defId === "boneling"
              ? `enemy_boneling_${Math.max(0, Math.min(5, Number(m.aiFlags?.spriteVariant ?? 0)))}`
              : def?.spriteId ?? "enemy_slime";
      const root = this.ensureEntityRoot(m.id, m.x, m.y);
      const useTall = m.defId === "elite_skeleton" || def?.spriteId === "enemy_elite_skeleton";
      const spr = useTall
        ? this.makeTallPlacedSprite(mimicChest ? "chest" : spriteId, 0, 0)
        : this.makePlacedSprite(mimicChest ? "chest" : spriteId, 0, 0);
      if (m.defId === "douvlon") {
        const tint = m.douvlonColor === "blue" ? 0x5dade2 : 0xe74c3c;
        spr.tint = tint;
      }
      root.addChild(spr);
      const monsterFire = this.makeFireOverlay(0, 0, m.fireLevels ?? 0);
      if (monsterFire) root.addChild(monsterFire);
      if ((m.poisonLevels ?? 0) > 0) {
        const levels = m.poisonLevels ?? 0;
        const poisonId =
          levels >= 5 ? "poison_major" : levels >= 3 ? "poison_medium" : "poison_minor";
        const style = this.styles.get(poisonId);
        if (this.usePixelArt && style?.kind === "texture") {
          root.addChild(this.makePlacedSprite(poisonId, 0, 0));
        } else {
          const r = Math.max(3, Math.round(TILE * 0.11));
          const dot = new Graphics();
          dot.circle(TILE - r - 3, r + 3, r).fill({ color: 0x65a30d, alpha: 0.95 });
          root.addChild(dot);
        }
      }
      if (m.defId === "slime" && (m.leapDir != null || m.leapTarget != null)) {
        const dir =
          m.leapDir ??
          (m.leapTarget
            ? {
                x: Math.sign(m.leapTarget.x - m.x) || 0,
                y: Math.sign(m.leapTarget.y - m.y) || 0,
              }
            : null);
        if (dir && (dir.x !== 0 || dir.y !== 0)) {
          const arrow = new Graphics();
          const cx = TILE / 2;
          const cy = TILE / 2;
          const len = TILE * 0.28;
          const tipX = cx + dir.x * len;
          const tipY = cy + dir.y * len;
          const backX = cx - dir.x * len * 0.35;
          const backY = cy - dir.y * len * 0.35;
          const px = -dir.y;
          const py = dir.x;
          const wing = TILE * 0.12;
          arrow
            .poly([
              tipX,
              tipY,
              backX + px * wing,
              backY + py * wing,
              backX - px * wing,
              backY - py * wing,
            ])
            .fill({ color: 0xe74c3c, alpha: 0.95 });
          root.addChild(arrow);
        } else {
          const r = Math.max(3, Math.round(TILE * 0.11));
          const cx = Math.max(2, inset / 3) + r;
          const cy = Math.max(2, inset / 3) + r;
          const dot = new Graphics();
          dot.circle(cx, cy, r).fill({ color: 0xe74c3c, alpha: 0.95 });
          root.addChild(dot);
        }
      }
      if (m.defId === "corrupted_shade") {
        const r = Math.max(3, Math.round(TILE * 0.11));
        const baseX = Math.max(2, inset / 3) + r;
        const baseY = Math.max(2, inset / 3) + r;
        if (m.darkBoltReady) {
          const dot = new Graphics();
          dot.circle(baseX, baseY, r).fill({ color: 0x8e44ad, alpha: 0.95 });
          root.addChild(dot);
        }
        if (m.blackShieldActive) {
          const dot = new Graphics();
          const ox = m.darkBoltReady ? r * 2 + 1 : 0;
          dot.circle(baseX + ox, baseY, r).fill({ color: 0x2980b9, alpha: 0.95 });
          root.addChild(dot);
        }
      }
      if (!mimicChest) {
        const label = def?.name ?? "?";
        root.addChild(this.makeEntityLabel(`${label} ${m.hp}hp`, 0, 0, 0xf5e6ff));
      }
    }

    for (const [, pair] of douvlonPairs) {
      if (!pair.red || !pair.blue) continue;
      if (pair.visibleCount === 0) continue;
      const x0 = (pair.red.x + 0.5) * TILE;
      const y0 = (pair.red.y + 0.5) * TILE;
      const x1 = (pair.blue.x + 0.5) * TILE;
      const y1 = (pair.blue.y + 0.5) * TILE;
      this.douvlonLineLayer.moveTo(x0, y0).lineTo(x1, y1).stroke({
        width: 3.5,
        color: 0x9b59b6,
        alpha: 0.92,
        cap: "round",
      });
    }

    this.darknessLayer.eventMode = "none";
    if (state.lightsOutTurns > 0 && !state.editorMode) {
      const px = state.player.x;
      const py = state.player.y;
      const entityHintAt = (gx: number, gy: number): boolean => {
        if (state.monsters.some((m) => m.hp > 0 && m.x === gx && m.y === gy)) return true;
        if (state.pots.some((p) => p.x === gx && p.y === gy)) return true;
        if (state.chests.some((c) => c.x === gx && c.y === gy)) return true;
        if (state.groundLoot.some((l) => l.x === gx && l.y === gy)) return true;
        return false;
      };
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const man = manhattan({ x, y }, { x: px, y: py });
          if (man <= 1) continue;
          const dim = new Graphics();
          dim.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: 0x000000, alpha: 1 });
          this.darknessLayer.addChild(dim);
          if (man === 2 && entityHintAt(x, y)) {
            const dot = new Graphics();
            const cx = x * TILE + TILE * 0.22;
            const cy = y * TILE + TILE * 0.22;
            const r = Math.max(2, Math.round(TILE * 0.09));
            dot.circle(cx, cy, r).fill({ color: 0x3498db, alpha: 0.95 });
            this.darknessLayer.addChild(dot);
          }
        }
      }
    }

    if (state.stairFeatures) {
      const sf = state.stairFeatures;
      const tileInset = inset;

      const ped = sf.pedestal;
      if (!state.fogOfWar || state.discovered.has(keyOf(ped))) {
        const pedId = state.pedestalUsed ? "card_pedestal_used" : "card_pedestal";
        const pedStyle = this.styles.get(pedId);
        if (this.usePixelArt && pedStyle?.kind === "texture") {
          this.entityLayer.addChild(this.makePlacedSprite(pedId, ped.x, ped.y));
        } else {
          const pedAlpha = state.pedestalUsed ? 0.42 : 0.92;
          const pcx = (ped.x + 0.5) * TILE;
          const pcy = (ped.y + 0.5) * TILE;
          const pr = TILE * 0.36;
          const pg = new Graphics();
          pg.circle(pcx, pcy, pr).fill({ color: 0x87ceeb, alpha: pedAlpha });
          this.entityLayer.addChild(pg);
        }
      }

      const mer = sf.merchant;
      if (
        state.merchantState &&
        (!state.fogOfWar || state.discovered.has(keyOf(mer)))
      ) {
        const merchantSprite =
          state.merchantState.merchantId === "obamly"
            ? "merchant_obamly"
            : state.merchantState.merchantId === "sennis"
              ? "merchant_sennis"
              : state.merchantState.merchantId === "sensei"
                ? state.merchantState.pose === "standing"
                  ? "merchant_sensei_standing"
                  : state.merchantState.pose === "sitting"
                    ? "merchant_sensei_sitting"
                    : "merchant_sensei_meditating"
                : "merchant_shifty";
        // Sennis is 20×25 — place bottom-aligned so the extra 5px stick out the top.
        this.entityLayer.addChild(
          merchantSprite === "merchant_sennis"
            ? this.makeTallPlacedSprite(merchantSprite, mer.x, mer.y)
            : this.makePlacedSprite(merchantSprite, mer.x, mer.y),
        );
      }

      const doors = sf.exitDoorCells;
      const stairsVisible =
        doors.length > 0 &&
        (!state.fogOfWar || doors.some((d) => state.discovered.has(keyOf(d))));
      if (stairsVisible) {
        const stairStyle = this.styles.get("staircase");
        const origin = doors[0]!;
        if (this.usePixelArt && stairStyle?.kind === "texture" && doors.length >= 2) {
          // 40×20 art at 2× fills exactly two tiles.
          const spr = this.makeSprite("staircase");
          spr.x = origin.x * TILE;
          spr.y = origin.y * TILE;
          spr.width = TILE * 2;
          spr.height = TILE;
          this.entityLayer.addChild(spr);
        } else {
          for (const d of doors) {
            if (state.fogOfWar && !state.discovered.has(keyOf(d))) continue;
            const ox = d.x * TILE + tileInset / 2;
            const oy = d.y * TILE + tileInset / 2;
            const sz = TILE - tileInset;
            const sg = new Graphics();
            sg.roundRect(ox, oy, sz, sz, 2).fill({ color: 0x3d3d42, alpha: 0.98 });
            this.entityLayer.addChild(sg);
          }
        }
      }
    }

    for (const cloud of state.harmingClouds) {
      if (cloud.turnsLeft <= 0) continue;
      if (state.fogOfWar && !state.discovered.has(keyOf(cloud))) continue;
      const frame = Math.floor(performance.now() / 1000) % 4;
      const cloudId = `harming_cloud_${frame}`;
      const style = this.styles.get(cloudId);
      if (this.usePixelArt && style?.kind === "texture") {
        this.entityLayer.addChild(this.makePlacedSprite(cloudId, cloud.x, cloud.y));
      } else {
        const g = new Graphics();
        g.circle(cloud.x * TILE + TILE / 2, cloud.y * TILE + TILE / 2, TILE * 0.32).fill({
          color: 0x8b4513,
          alpha: 0.55,
        });
        this.entityLayer.addChild(g);
      }
    }
    this.ensureHarmingCloudTicker(state);

    this.drawBrainHighlights(state);
    this.drawHighlights(state);
    this.drawAreaOutline();
  }

  private drawBrainHighlights(state: GameState): void {
    this.brainHighlightLayer.clear();
    const id = this.brainInspectMonsterId;
    if (!id || !state.editorMode || state.pending) return;
    const mon = state.monsters.find((m) => m.id === id && m.hp > 0);
    if (!mon) return;
    const ai = state.monsterDefs.get(mon.defId)?.ai;
    if (!ai) return;
    const stateId = mon.aiStateId ?? ai.initialState;

    if (mon.defId === "elite_skeleton" && stateId === "attack") {
      this.drawEliteSkeletonAttackBrain(state, mon);
      return;
    }

    const stateDef = ai.states.find((st) => st.id === stateId) ?? ai.states[0];
    const prefs = stateDef ? resolveTilePrefs(stateDef, mon) : undefined;
    if (!prefs) return;

    const favored = prefs.favored;
    const secondary = prefs.secondary;
    const bad = prefs.bad;

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const tile = { x, y };
        if (state.fogOfWar && !state.discovered.has(keyOf(tile))) continue;
        let color: number | null = null;
        if (tileMatchesAnyPref(state, mon, tile, bad)) color = 0xe74c3c;
        else if (tileMatchesAnyPref(state, mon, tile, favored)) color = 0x2ecc71;
        else if (tileMatchesAnyPref(state, mon, tile, secondary)) color = 0xf1c40f;
        if (color === null) continue;
        this.brainHighlightLayer
          .rect(x * TILE, y * TILE, TILE, TILE)
          .fill({ color, alpha: 0.38 });
      }
    }

    // Shortest path the monster would take for its next move/swim seek.
    let seek: AtbmbMoveSeek = "favored";
    let waterOnly = false;
    let foundMove = false;
    if (stateDef) {
      for (const rule of stateDef.decide) {
        if (!whenMatches(state, mon, rule.when, prefs, stateDef.attackRange)) continue;
        for (const action of rule.actions) {
          const ab = ai.abilities.find((a) => a.id === action.ability);
          if (!ab || (ab.kind !== "move" && ab.kind !== "swim")) continue;
          seek = action.seek ?? "favored";
          waterOnly = ab.kind === "swim";
          foundMove = true;
          break;
        }
        if (foundMove) break;
      }
    }

    const plan = planAtbmbPath(
      state,
      mon,
      ai,
      prefs,
      seek,
      { tilePassable: monsterTilePassable, occupancy: movementOcc },
      { moveUsesRemaining: 2, waterOnly, rng: stablePathRng },
    );
    if (!plan || plan.path.length < 2) return;

    for (let i = 1; i < plan.path.length; i++) {
      const p = plan.path[i]!;
      if (state.fogOfWar && !state.discovered.has(keyOf(p))) continue;
      const isGoal = i === plan.path.length - 1;
      this.brainHighlightLayer
        .rect(p.x * TILE, p.y * TILE, TILE, TILE)
        .fill({ color: isGoal ? 0x3498db : 0x5dade2, alpha: isGoal ? 0.55 : 0.42 });
    }
    this.brainHighlightLayer.setStrokeStyle({ width: 3, color: 0x1a5276, alpha: 0.95 });
    for (let i = 0; i < plan.path.length - 1; i++) {
      const a = plan.path[i]!;
      const b = plan.path[i + 1]!;
      this.brainHighlightLayer
        .moveTo(a.x * TILE + TILE / 2, a.y * TILE + TILE / 2)
        .lineTo(b.x * TILE + TILE / 2, b.y * TILE + TILE / 2)
        .stroke();
    }
  }

  /** Elite Skeleton Attacking: show simulation option tiles, weights, and chosen path. */
  private drawEliteSkeletonAttackBrain(state: GameState, mon: GameState["monsters"][0]): void {
    const prefs = eliteSkeletonAttackPrefs();
    const player = { x: state.player.x, y: state.player.y };
    const orthoAdjacent = manhattan({ x: mon.x, y: mon.y }, player) === 1;

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const tile = { x, y };
        if (state.fogOfWar && !state.discovered.has(keyOf(tile))) continue;
        if (tileMatchesAnyPref(state, mon, tile, prefs.bad)) {
          this.brainHighlightLayer
            .rect(x * TILE, y * TILE, TILE, TILE)
            .fill({ color: 0xe74c3c, alpha: 0.38 });
        }
      }
    }

    if (orthoAdjacent) {
      this.brainHighlightLayer
        .rect(mon.x * TILE, mon.y * TILE, TILE, TILE)
        .fill({ color: 0xe67e22, alpha: 0.55 });
      return;
    }

    const optionColors: Record<string, number> = {
      scimitar: 0x2ecc71,
      sword: 0xf1c40f,
      spear: 0x3498db,
    };

    const evals = evaluateEliteSkeletonOptions(state, mon, {
      tilePassable: monsterTilePassable,
      occupancy: movementOcc,
    });

    for (const ev of evals) {
      const color = optionColors[ev.id] ?? 0xffffff;
      for (const g of ev.goals) {
        if (state.fogOfWar && !state.discovered.has(keyOf(g))) continue;
        this.brainHighlightLayer
          .rect(g.x * TILE, g.y * TILE, TILE, TILE)
          .fill({ color, alpha: ev.chosen ? 0.48 : 0.28 });
      }
    }

    const chosen = evals.find((e) => e.chosen);
    const plan = chosen?.plan;
    if (!plan || plan.path.length < 2) return;

    for (let i = 1; i < plan.path.length; i++) {
      const p = plan.path[i]!;
      if (state.fogOfWar && !state.discovered.has(keyOf(p))) continue;
      const isGoal = i === plan.path.length - 1;
      this.brainHighlightLayer
        .rect(p.x * TILE, p.y * TILE, TILE, TILE)
        .fill({ color: isGoal ? 0x1abc9c : 0x48c9b0, alpha: isGoal ? 0.55 : 0.42 });
    }
    this.brainHighlightLayer.setStrokeStyle({ width: 3, color: 0x117a65, alpha: 0.95 });
    for (let i = 0; i < plan.path.length - 1; i++) {
      const a = plan.path[i]!;
      const b = plan.path[i + 1]!;
      this.brainHighlightLayer
        .moveTo(a.x * TILE + TILE / 2, a.y * TILE + TILE / 2)
        .lineTo(b.x * TILE + TILE / 2, b.y * TILE + TILE / 2)
        .stroke();
    }
  }

  private makeEntityLabel(text: string, tileX: number, tileY: number, color: number): Text {
    const fs = Math.max(8, Math.round(10 * (TILE / 48)));
    const t = new Text({
      text,
      style: {
        fontFamily: "system-ui, Segoe UI, sans-serif",
        fontSize: fs,
        fill: color,
        stroke: { color: 0x000000, width: 3 },
        align: "center",
      },
    });
    t.anchor.set(0.5, 1);
    t.x = tileX + TILE / 2;
    t.y = tileY + TILE - 2;
    return t;
  }

  private bridgeKeySet(state: GameState): Set<string> {
    return new Set(state.bridgeTiles.map((b) => keyOf(b)));
  }

  /**
   * A wall directly above ground shows its face, so it reads as part of the room
   * below it for fog, drawing, and border edges. It stays impassable.
   */
  private isWallFaceTile(state: GameState, x: number, y: number): boolean {
    if (state.tiles[y]?.[x] !== "wall") return false;
    const below = state.tiles[y + 1]?.[x];
    return below === "floor" || below === "water";
  }

  /** Discovered ground, plus the faced walls belonging to discovered ground. */
  private isRevealedForDraw(state: GameState, x: number, y: number): boolean {
    if (state.discovered.has(keyOf({ x, y }))) return true;
    return (
      this.isWallFaceTile(state, x, y) && state.discovered.has(keyOf({ x, y: y + 1 }))
    );
  }

  /**
   * Wall-face variant (stable per tile).
   * 1 default; 2–7 uncommon accents; 8–9 rare from depth 3+ (under 5% by depth 5+);
   * 10 is 1% from depth 5+; 11–14 only on overgrown floors.
   */
  private pickWallFaceSpriteId(state: GameState, x: number, y: number): string {
    const h =
      (Math.imul(x + 17, 2246822519) ^
        Math.imul(y + 3, 3266489917) ^
        Math.imul(state.depth + 1, 668265263) ^
        0x9e3779b9) >>>
      0;
    const depth = state.depth;
    const roll = (shift: number, mod: number) => ((h >>> shift) % mod);

    if (state.floorTheme === "brownstone") {
      const brownstoneIds = [
        "wall_face_brownstone",
        "wall_face_brownstone_2",
        "wall_face_brownstone_3",
        "wall_face_brownstone_4",
        "wall_face_brownstone_5",
        "wall_face_brownstone_6",
      ] as const;
      return brownstoneIds[roll(12, brownstoneIds.length)]!;
    }

    // Sprite 10 — 1% on floor 5+.
    if (depth >= 5 && roll(0, 100) === 0) return "wall_face_10";

    // Sprites 8–9 — from floor 3; ~1% / ~2% / ~4% at depths 3 / 4 / 5+.
    if (depth >= 3) {
      const rarePct = depth >= 5 ? 4 : depth === 4 ? 2 : 1;
      if (roll(8, 100) < rarePct) {
        return roll(16, 2) === 0 ? "wall_face_8" : "wall_face_9";
      }
    }

    // Sprites 11–14 — overgrown vines (~18%, sparse more common).
    if (state.floorTheme === "overgrown" && roll(4, 100) < 18) {
      const vineIds = [
        "wall_face_11",
        "wall_face_12",
        "wall_face_13",
        "wall_face_14",
      ] as const;
      const vineWeights = [4, 3, 2, 1];
      let r = roll(20, 10);
      for (let i = 0; i < vineWeights.length; i++) {
        r -= vineWeights[i]!;
        if (r < 0) return vineIds[i]!;
      }
      return vineIds[0]!;
    }

    // Sprites 2–7 — ~15% chance of a common accent.
    if (roll(12, 100) < 15) {
      const common = [
        "wall_face_2",
        "wall_face_3",
        "wall_face_4",
        "wall_face_5",
        "wall_face_6",
        "wall_face_7",
      ] as const;
      return common[roll(24, common.length)]!;
    }

    return "wall_face";
  }

  /** Textured trim centered on a floor tile's edge that abuts a wall. */
  private addWallBorder(
    state: GameState,
    side: "top" | "right" | "bottom" | "left",
    ox: number,
    oy: number,
  ): void {
    const id = state.floorTheme === "brownstone" ? "wall_border_brownstone" : "wall_border";
    const spr = this.makeSprite(id);
    spr.anchor.set(0.5);
    spr.width = TILE;
    spr.height = WALL_RIM_THICK;
    const horizontal = side === "top" || side === "bottom";
    spr.rotation = horizontal ? 0 : Math.PI / 2;
    spr.x = side === "left" ? ox : side === "right" ? ox + TILE : ox + TILE / 2;
    spr.y = side === "top" ? oy : side === "bottom" ? oy + TILE : oy + TILE / 2;
    this.wallBorderLayer.addChild(spr);
  }

  /** Checkerboard base + rare decorative variants (stable per tile). */
  private pickBaseFloorSpriteId(x: number, y: number): string {
    const light = (x + y) % 2 === 0;
    // Plain tiles heavily weighted; decorative variants are rare accents.
    const lightIds = ["floor", "floor_crack_a", "floor_crack_b", "floor_sigil"] as const;
    const darkIds = [
      "floor_alt",
      "floor_alt_crack_a",
      "floor_alt_bone",
      "floor_alt_crack_b",
    ] as const;
    const ids = light ? lightIds : darkIds;
    const weights = [40, 1, 1, 1];
    const h =
      (Math.imul(x + 1, 374761) ^ Math.imul(y + 1, 668265) ^ 0x9e3779b9) >>> 0;
    let r = h % 43;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return ids[i]!;
    }
    return ids[0]!;
  }

  /** Special floor accents (not sigil, not plain) get a stable 0/90/180/270° rotation. */
  private floorTileRotation(id: string, x: number, y: number): number {
    const rotatable =
      id === "floor_crack_a" ||
      id === "floor_crack_b" ||
      id === "floor_alt_crack_a" ||
      id === "floor_alt_bone" ||
      id === "floor_alt_crack_b" ||
      id.startsWith("floor_overgrown") ||
      id.startsWith("floor_greenhouse");
    if (!rotatable) return 0;
    const h =
      (Math.imul(x + 3, 915799) ^ Math.imul(y + 7, 465493) ^ 0x85ebca6b) >>> 0;
    return (h % 4) * (Math.PI / 2);
  }

  private pickOvergrownMossSpriteId(x: number, y: number): string {
    const light = (x + y) % 2 === 0;
    const lightIds = ["floor_overgrown", "floor_overgrown_b", "floor_overgrown_c"] as const;
    const darkIds = [
      "floor_overgrown_alt",
      "floor_overgrown_b_alt",
      "floor_overgrown_c_alt",
    ] as const;
    const ids = light ? lightIds : darkIds;
    // Sparser moss more common than heavy patches.
    const weights = [3, 2, 1];
    const h =
      (Math.imul(x + 11, 265443) ^ Math.imul(y + 5, 975313) ^ 0xc2b2ae3d) >>> 0;
    let r = h % 6;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return ids[i]!;
    }
    return ids[0]!;
  }

  private pickGreenhouseSpriteId(x: number, y: number): string {
    const ids = [
      "floor_greenhouse",
      "floor_greenhouse_b",
      "floor_greenhouse_c",
      "floor_greenhouse_d",
      "floor_greenhouse_e",
    ] as const;
    const h =
      (Math.imul(x + 9, 224682) ^ Math.imul(y + 2, 326648) ^ 0x27d4eb2f) >>> 0;
    return ids[h % ids.length]!;
  }

  private pickThemedFloorSpriteId(
    state: GameState,
    x: number,
    y: number,
    _rid: number,
    rkind: RoomKind | undefined,
  ): string {
    if (rkind === "gauntlet_corridor") {
      return (x + y) % 2 === 0 ? "gauntlet_corridor" : "gauntlet_corridor_alt";
    }
    if (rkind === "stair_room") {
      return this.pickBaseFloorSpriteId(x, y);
    }
    if (rkind === "greenhouse") return this.pickGreenhouseSpriteId(x, y);
    const alt = (x + y) % 2 === 0;
    const th = state.floorTheme;
    if (th === "overgrown") {
      // ~10% of tiles get moss overlays (stable per tile so redraws don't flicker).
      const h = Math.imul(x + 1, 374761) ^ Math.imul(y + 1, 668265) ^ 0x9e3779b9;
      const mossy = (h >>> 0) % 10 === 0;
      if (mossy) return this.pickOvergrownMossSpriteId(x, y);
      return this.pickBaseFloorSpriteId(x, y);
    }
    if (th === "brownstone") return alt ? "floor_brownstone" : "floor_brownstone_alt";
    return this.pickBaseFloorSpriteId(x, y);
  }

  private peaceStepTiles(state: GameState): Set<string> {
    const from = { x: state.player.x, y: state.player.y };
    const occ = new Set<string>();
    for (const m of state.monsters) {
      if (m.hp > 0) occ.add(keyOf(m));
    }
    const rockKeys = new Set(state.rocks.map((r) => keyOf(r)));
    const bridgeKeys = this.bridgeKeySet(state);
    const out = new Set<string>();
    for (const o of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const t = { x: from.x + o.x, y: from.y + o.y };
      if (t.x < 0 || t.y < 0 || t.x >= state.width || t.y >= state.height) continue;
      const tk = state.tiles[t.y][t.x];
      const walk = tk === "floor" || (tk === "water" && bridgeKeys.has(keyOf(t)));
      if (!walk) continue;
      if (occ.has(keyOf(t))) continue;
      if (rockKeys.has(keyOf(t))) continue;
      out.add(keyOf(t));
    }
    return out;
  }

  /** Tiles a coiled slime will cross on its next leap. Walls and blockers stop the line. */
  private slimeLeapCells(state: GameState): Point[] {
    const cells: Point[] = [];
    for (const mon of state.monsters) {
      if (mon.hp <= 0 || mon.defId !== "slime") continue;
      if (state.fogOfWar && !state.discovered.has(keyOf(mon))) continue;
      const dir =
        mon.leapDir ??
        (mon.leapTarget
          ? {
              x: Math.sign(mon.leapTarget.x - mon.x) || 0,
              y: Math.sign(mon.leapTarget.y - mon.y) || 0,
            }
          : null);
      if (!dir || (dir.x === 0 && dir.y === 0)) continue;
      const steps =
        state.monsterDefs.get(mon.defId)?.ai?.abilities.find((a) => a.kind === "leap")?.params
          ?.steps ?? 2;
      const occ = movementOcc(state, mon.id);
      for (let i = 1; i <= steps; i++) {
        const cell = { x: mon.x + dir.x * i, y: mon.y + dir.y * i };
        if (!monsterTilePassable(state, mon, cell)) break;
        cells.push(cell);
        if (occ.has(keyOf(cell))) break;
      }
    }
    return cells;
  }

  private drawAreaOutline(): void {
    const g = this.areaOutline;
    g.clear();
    const state = this.latestState;
    if (!state || this.presentationLocked) return;

    const cells: Point[] = this.slimeLeapCells(state);
    if (state.phase === "player") {
      const pending = state.pending;
      let aim: Point[] | null = null;
      if (pending && this.hoverCell) {
        const legal = this.highlightTiles(state, pending);
        if (legal.has(keyOf(this.hoverCell))) {
          aim = areaCellsForAim(state, pending, this.hoverCell);
        }
      } else if (!pending && this.previewCardId) {
        aim = areaCellsForSelectedCard(state, this.previewCardId);
      }
      if (aim) cells.push(...aim);
    }
    if (cells.length === 0) return;

    const inset = 3;
    for (const cell of cells) {
      g.rect(
        cell.x * TILE + inset,
        cell.y * TILE + inset,
        TILE - inset * 2,
        TILE - inset * 2,
      ).stroke({ width: 3, color: 0xff2a2a, alignment: 0, alpha: 0.95 });
    }
  }

  private drawHighlights(state: GameState): void {
    let reach: Set<string>;
    if (
      state.phase === "peace" &&
      !state.pedestalOffer &&
      !state.deckDestroyPending
    ) {
      reach = this.peaceStepTiles(state);
    } else {
      const pending = state.pending;
      if (!pending || state.phase !== "player") return;
      reach = this.highlightTiles(state, pending);
    }
    for (const k of reach) {
      const [xs, ys] = k.split(",").map(Number);
      const spr = this.makeSprite("highlight");
      spr.x = xs * TILE;
      spr.y = ys * TILE;
      this.highlightLayer.addChild(spr);
    }
  }

  private highlightTiles(state: GameState, pending: PendingIntent): Set<string> {
    const from = { x: state.player.x, y: state.player.y };
    const occ = new Set<string>();
    for (const m of state.monsters) {
      if (m.hp > 0) occ.add(keyOf(m));
    }
    const rockKeys = new Set(state.rocks.map((r) => keyOf(r)));
    const bridgeKeys = this.bridgeKeySet(state);
    const attackTargets = new Map<string, { x: number; y: number }>();
    const addAttackTarget = (target: { x: number; y: number }) => {
      if (state.fogOfWar && !state.discovered.has(keyOf(target))) return;
      attackTargets.set(keyOf(target), { x: target.x, y: target.y });
    };
    for (const m of state.monsters) if (m.hp > 0) addAttackTarget(m);
    for (const pot of state.pots) addAttackTarget(pot);
    for (const tw of state.tangleweeds) if (tw.hp > 0) addAttackTarget(tw);
    for (const bp of state.bonePiles) if (bp.hp > 0) addAttackTarget(bp);
    if (pending.kind === "water_escape") {
      const occW = new Set<string>();
      for (const m of state.monsters) {
        if (m.hp > 0) occW.add(keyOf(m));
      }
      for (const m of state.monsters) {
        if (m.defId === "mimic" && m.mimicAsleep && m.hp > 0) occW.delete(keyOf(m));
      }
      for (const tw of state.tangleweeds) {
        if (tw.hp > 0) occW.add(keyOf(tw));
      }
      const cells = new Set<string>();
      const wx = pending.waterX;
      const wy = pending.waterY;
      for (const o of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        const t = { x: wx + o.x, y: wy + o.y };
        if (t.x < 0 || t.y < 0 || t.x >= state.width || t.y >= state.height) continue;
        if (state.fogOfWar && !state.discovered.has(keyOf(t))) continue;
        const tile = state.tiles[t.y][t.x];
        const land = tile === "floor" || (tile === "water" && bridgeKeys.has(keyOf(t)));
        if (!land) continue;
        if (occW.has(keyOf(t))) continue;
        if (rockKeys.has(keyOf(t))) continue;
        cells.add(keyOf(t));
      }
      return cells;
    }
    if (pending.kind === "play_move") {
      const base = reachableOrthogonal(
        state.tiles,
        state.width,
        state.height,
        from,
        pending.range,
        occ,
        rockKeys,
        bridgeKeys,
      );
      const needExtra = state.player.hand.length >= 2;
      return extendReachableWithBlockedDestinations(
        base,
        from,
        state.tiles,
        state.width,
        state.height,
        needExtra,
        occ,
      );
    }
    if (pending.kind === "discard_move1") {
      const base = reachableOrthogonal(
        state.tiles,
        state.width,
        state.height,
        from,
        pending.maxRange,
        occ,
        rockKeys,
        bridgeKeys,
      );
      const needExtra = state.player.hand.length >= 1;
      return extendReachableWithBlockedDestinations(
        base,
        from,
        state.tiles,
        state.width,
        state.height,
        needExtra,
        occ,
      );
    }
    if (
      pending.kind === "play_card_seeker" ||
      pending.kind === "play_loot_and_scoot" ||
      pending.kind === "move_token_step"
    ) {
      const range =
        pending.kind === "play_card_seeker" || pending.kind === "play_loot_and_scoot"
          ? pending.range
          : state.player.hasteThisTurn
            ? 2
            : 1;
      const base = reachableOrthogonal(
        state.tiles,
        state.width,
        state.height,
        from,
        range,
        occ,
        rockKeys,
        bridgeKeys,
      );
      const needExtra =
        pending.kind === "play_card_seeker" || pending.kind === "play_loot_and_scoot"
          ? state.player.hand.length >= 2
          : state.player.hand.length >= 1;
      if (pending.kind === "play_loot_and_scoot") {
        return new Set(
          [...base].filter((k) => {
            const [x, y] = k.split(",").map(Number);
            return state.tiles[y]?.[x] === "floor";
          }),
        );
      }
      const reachable = extendReachableWithBlockedDestinations(
        base,
        from,
        state.tiles,
        state.width,
        state.height,
        needExtra,
        occ,
      );
      return reachable;
    }
    if (
      pending.kind === "play_melee" ||
      pending.kind === "play_knife" ||
      pending.kind === "play_axe" ||
      pending.kind === "play_mace_smash" ||
      pending.kind === "play_poisoned_blade" ||
      pending.kind === "play_perfected_strike" ||
      pending.kind === "play_reckless_assault" ||
      pending.kind === "play_thieving_strike" ||
      pending.kind === "discard_punch"
    ) {
      const adj = new Set<string>();
      for (const o of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        const t = { x: from.x + o.x, y: from.y + o.y };
        if (t.x >= 0 && t.y >= 0 && t.x < state.width && t.y < state.height) {
          adj.add(keyOf(t));
        }
      }
      // Tangleweed can spawn on the player; all adjacent-style attacks may hit it in place.
      if (attackTargets.has(keyOf(from))) {
        adj.add(keyOf(from));
      }
      return adj;
    }

    if (pending.kind === "play_great_sword") {
      const cells = new Set<string>();
      for (const o of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        const target = { x: from.x + o.x, y: from.y + o.y };
        if (attackTargets.has(keyOf(target))) cells.add(keyOf(target));
      }
      for (const target of attackTargets.values()) {
        const dx = target.x - from.x;
        const dy = target.y - from.y;
        const straight = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
        if (!straight || Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
        const middle = { x: from.x + dx / 2, y: from.y + dy / 2 };
        const blocked =
          state.tiles[middle.y]?.[middle.x] !== "floor" ||
          attackTargets.has(keyOf(middle)) ||
          state.chests.some((c) => c.x === middle.x && c.y === middle.y) ||
          state.rocks.some((r) => r.x === middle.x && r.y === middle.y);
        if (!blocked) cells.add(keyOf(target));
      }
      return cells;
    }

    if (pending.kind === "play_flying_kick") {
      const cells = new Set<string>();
      for (const o of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        const path = Array.from({ length: pending.move }, (_, i) => ({
          x: from.x + o.x * (i + 1),
          y: from.y + o.y * (i + 1),
        }));
        const blocked = path.some(
          (cell) =>
            state.tiles[cell.y]?.[cell.x] !== "floor" ||
            state.rocks.some((r) => r.x === cell.x && r.y === cell.y) ||
            state.chests.some((c) => c.x === cell.x && c.y === cell.y),
        );
        if (!blocked) cells.add(keyOf(path[path.length - 1]!));
      }
      return cells;
    }

    if (pending.kind === "play_spear") {
      return new Set(spearAimCells(state, from).map((cell) => keyOf(cell)));
    }

    if (pending.kind === "play_magic_missile") {
      const cells = new Set<string>();
      for (const target of attackTargets.values()) {
        if (
          magicMissilePathClearToPoint(
            state.tiles,
            state.monsters,
            state.pots,
            from,
            target.x,
            target.y,
          )
        ) {
          cells.add(keyOf(target));
        }
      }
      return cells;
    }

    if (pending.kind === "play_knockback_punch") {
      const adj = new Set<string>();
      for (const o of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
        const t = { x: from.x + o.x, y: from.y + o.y };
        if (t.x >= 0 && t.y >= 0 && t.x < state.width && t.y < state.height) adj.add(keyOf(t));
      }
      if (attackTargets.has(keyOf(from))) adj.add(keyOf(from));
      return adj;
    }

    if (pending.kind === "play_bow_attack") {
      const cells = new Set<string>();
      for (const target of attackTargets.values()) {
        if (manhattan(from, target) <= 1) continue;
        if (chebyshev(from, target) > pending.range) continue;
        if (lineOfSightClear(state.tiles, from, target)) cells.add(keyOf(target));
      }
      return cells;
    }

    if (pending.kind === "play_lightning_bolt") {
      const cells = new Set<string>();
      // range for current hop always equals nextDamage (5→4→3→2→1)
      const origin =
        pending.hitIds.length === 0
          ? from
          : (() => {
              const [x, y] = pending.hitIds[pending.hitIds.length - 1]!.split(",").map(Number);
              return { x, y };
            })();
      for (const target of attackTargets.values()) {
        if (pending.hitIds.includes(keyOf(target))) continue;
        if (chebyshev(origin, target) <= pending.nextDamage) cells.add(keyOf(target));
      }
      return cells;
    }

    if (pending.kind === "play_fireball") {
      const cells = new Set<string>();
      for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
          const t = { x, y };
          if (chebyshev(from, t) > pending.range) continue;
          if (!lineOfSightClear(state.tiles, from, t)) continue;
          if (state.fogOfWar && !state.discovered.has(keyOf(t))) continue;
          cells.add(keyOf(t));
        }
      }
      return cells;
    }

    if (pending.kind === "play_potion_of_harming") {
      const cells = new Set<string>();
      for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
          const t = { x, y };
          if (chebyshev(from, t) > pending.range) continue;
          if (state.tiles[y]?.[x] === "wall") continue;
          if (state.fogOfWar && !state.discovered.has(keyOf(t))) continue;
          cells.add(keyOf(t));
        }
      }
      return cells;
    }

    return new Set();
  }

  private ensureHarmingCloudTicker(state: GameState): void {
    const active = state.harmingClouds.some((c) => c.turnsLeft > 0);
    if (!active) {
      if (this.harmingCloudTickerAdded) {
        Ticker.shared.remove(this.updateHarmingCloudAnim, this);
        this.harmingCloudTickerAdded = false;
      }
      this.lastHarmingCloudFrame = -1;
      return;
    }
    if (!this.harmingCloudTickerAdded) {
      Ticker.shared.add(this.updateHarmingCloudAnim, this);
      this.harmingCloudTickerAdded = true;
    }
  }

  private updateHarmingCloudAnim = (): void => {
    if (this.presentationLocked) return;
    const s = this.latestState;
    if (!s || !s.harmingClouds.some((c) => c.turnsLeft > 0)) {
      if (this.harmingCloudTickerAdded) {
        Ticker.shared.remove(this.updateHarmingCloudAnim, this);
        this.harmingCloudTickerAdded = false;
      }
      this.lastHarmingCloudFrame = -1;
      return;
    }
    const frame = Math.floor(performance.now() / 1000) % 4;
    if (frame === this.lastHarmingCloudFrame) return;
    this.lastHarmingCloudFrame = frame;
    this.sync(s);
  };

  private makeSprite(id: string): Sprite {
    const style = this.styles.get(id) ?? { kind: "tinted" as const, tint: 0x888888 };
    const spr = new Sprite(Texture.WHITE);
    spr.width = TILE;
    spr.height = TILE;
    const preferTexture = this.usePixelArt && style.kind === "texture";
    if (preferTexture) {
      spr.texture = style.texture;
      spr.tint = 0xffffff;
      if (style.alpha !== undefined) spr.alpha = style.alpha;
    } else {
      spr.texture = Texture.WHITE;
      const tint =
        style.kind === "texture" ? style.fallbackTint : style.tint;
      spr.tint = tint;
      if (style.alpha !== undefined) spr.alpha = style.alpha;
    }
    return spr;
  }

  /** Place a sprite in a tile: pixel art at 2× native size (capped to the tile), boxes with a slight inset. */
  private makePlacedSprite(id: string, tileX: number, tileY: number): Sprite {
    const style = this.styles.get(id);
    const spr = this.makeSprite(id);
    const pixel = this.usePixelArt && style?.kind === "texture";
    if (pixel) {
      const native = Math.max(style.texture.width, style.texture.height);
      // 16×16 → 32px; 20×20 → 40px (fills the tile, larger than smaller sprites).
      const size = Math.min(TILE, native * 2);
      const pad = (TILE - size) / 2;
      spr.x = tileX * TILE + pad;
      spr.y = tileY * TILE + pad;
      spr.width = size;
      spr.height = size;
    } else {
      const inset = Math.round(4 * (TILE / 40));
      spr.x = tileX * TILE + inset / 2;
      spr.y = tileY * TILE + inset / 2;
      spr.width = TILE - inset;
      spr.height = TILE - inset;
    }
    return spr;
  }

  /**
   * Place a taller-than-tile sprite (e.g. Sennis 20×25) at 2× scale, bottom-aligned so
   * extra height sticks out above the tile.
   */
  private makeTallPlacedSprite(id: string, tileX: number, tileY: number): Sprite {
    const style = this.styles.get(id);
    const spr = this.makeSprite(id);
    const pixel = this.usePixelArt && style?.kind === "texture";
    if (pixel) {
      const w = Math.min(TILE, style.texture.width * 2);
      const h = style.texture.height * 2;
      const padX = (TILE - w) / 2;
      spr.x = tileX * TILE + padX;
      spr.y = tileY * TILE + TILE - h;
      spr.width = w;
      spr.height = h;
    } else {
      const inset = Math.round(4 * (TILE / 40));
      spr.x = tileX * TILE + inset / 2;
      spr.y = tileY * TILE + inset / 2;
      spr.width = TILE - inset;
      spr.height = TILE - inset;
    }
    return spr;
  }
}
