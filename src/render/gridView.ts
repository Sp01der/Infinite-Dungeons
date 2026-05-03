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
import { chebyshev, keyOf, lineOfSightClear, magicMissilePathClear, magicMissilePathClearToPoint } from "../engine/grid";
import {
  extendReachableWithBlockedDestinations,
  manhattan,
  reachableOrthogonal,
} from "../engine/movement";
import type { GameState, HitVisual, PendingIntent, SkeletonWeapon } from "../game/types";
import type { SpriteStyle } from "./assets";

/** Logical tile size in pixels (smaller than original 48 for a wider view). */
export const TILE = 40;

/** Default canvas size before the first layout pass (fills `#game-viewport` after load). */
export const VIEW_COLS = 14;
export const VIEW_ROWS = 10;
export const VIEW_WIDTH_PX = VIEW_COLS * TILE;
export const VIEW_HEIGHT_PX = VIEW_ROWS * TILE;

const HIT_ANIM_MS = 520;
const HIT_FLASH_MS = 280;

/** Thickness of “heavy” wall rim along discovered floor (highlights door gaps). */
const WALL_RIM_THICK = Math.max(5, Math.round(TILE * 0.16));

const CLICK_DRAG_THRESHOLD_PX = 9;

export class GridView extends Container {
  private floorLayer = new Container();
  private wallRimLayer = new Graphics();
  private gridLines = new Graphics();
  private potLayer = new Container();
  private rockLayer = new Container();
  private lootLayer = new Container();
  private fogLayer = new Container();
  private entityLayer = new Container();
  private highlightLayer = new Container();
  private collapseMarkerLayer = new Container();
  private douvlonLineLayer = new Graphics();
  private darknessLayer = new Container();
  private fxLayer = new Container();
  private styles: Map<string, SpriteStyle>;
  private onCellClick: (x: number, y: number) => void;
  private latestState: GameState | null = null;
  private hitAnims: { gx: number; gy: number; damage: number; t0: number }[] = [];
  private fxTickerAdded = false;

  private viewportWidth = VIEW_WIDTH_PX;
  private viewportHeight = VIEW_HEIGHT_PX;
  private interactionCanvas: HTMLCanvasElement | null = null;

  private panPointerDown = false;
  private lastPanClientX = 0;
  private lastPanClientY = 0;
  private panAccumDist = 0;

  constructor(styles: Map<string, SpriteStyle>, onCellClick: (x: number, y: number) => void) {
    super();
    this.styles = styles;
    this.onCellClick = onCellClick;
    this.sortableChildren = true;
    this.floorLayer.zIndex = 0;
    this.wallRimLayer.zIndex = 1;
    this.gridLines.zIndex = 2;
    this.potLayer.zIndex = 3;
    this.rockLayer.zIndex = 4;
    this.lootLayer.zIndex = 5;
    this.fogLayer.zIndex = 6;
    this.entityLayer.zIndex = 7;
    this.collapseMarkerLayer.zIndex = 6;
    this.douvlonLineLayer.zIndex = 7;
    this.darknessLayer.zIndex = 8;
    this.highlightLayer.zIndex = 9;
    this.fxLayer.zIndex = 10;
    this.addChild(this.floorLayer);
    this.addChild(this.wallRimLayer);
    this.addChild(this.gridLines);
    this.addChild(this.potLayer);
    this.addChild(this.rockLayer);
    this.addChild(this.lootLayer);
    this.addChild(this.fogLayer);
    this.addChild(this.entityLayer);
    this.addChild(this.collapseMarkerLayer);
    this.addChild(this.douvlonLineLayer);
    this.addChild(this.highlightLayer);
    this.addChild(this.darknessLayer);
    this.addChild(this.fxLayer);
    this.eventMode = "static";
    this.cursor = "grab";
    this.on("pointerdown", this.onPointerDown);
    this.on("pointermove", this.onPointerMove);
    this.on("pointerup", this.onPointerUp);
    this.on("pointerupoutside", this.onPointerUp);
  }

  /** Viewport size in CSS pixels (fixed camera window). */
  configureViewport(widthPx: number, heightPx: number, canvas: HTMLCanvasElement): void {
    this.viewportWidth = widthPx;
    this.viewportHeight = heightPx;
    this.interactionCanvas = canvas;
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
    if (!this.panPointerDown) return;
    const ne = ev.nativeEvent as PointerEvent;
    const dx = ne.clientX - this.lastPanClientX;
    const dy = ne.clientY - this.lastPanClientY;
    this.lastPanClientX = ne.clientX;
    this.lastPanClientY = ne.clientY;
    this.panAccumDist += Math.hypot(dx, dy);
    this.position.x += dx;
    this.position.y += dy;
    this.clampCamera(this.latestState);
  };

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

  /** Red flash + floating damage number at grid cells (player or monster). */
  playHits(hits: HitVisual[]): void {
    const base = performance.now();
    hits.forEach((h, i) => {
      this.hitAnims.push({ gx: h.gridX, gy: h.gridY, damage: h.damage, t0: base + i * 55 });
    });
    if (!this.fxTickerAdded) {
      Ticker.shared.add(this.updateFx, this);
      this.fxTickerAdded = true;
    }
  }

  private updateFx = (): void => {
    const now = performance.now();
    this.hitAnims = this.hitAnims.filter((a) => now - a.t0 < HIT_ANIM_MS);
    this.fxLayer.removeChildren();

    if (this.hitAnims.length === 0) {
      Ticker.shared.remove(this.updateFx, this);
      this.fxTickerAdded = false;
      return;
    }

    const fs = Math.round(14 * (TILE / 40));

    for (const a of this.hitAnims) {
      const elapsed = now - a.t0;
      if (elapsed < HIT_FLASH_MS) {
        const flash = new Graphics();
        const alpha = 0.55 * (1 - elapsed / HIT_FLASH_MS);
        flash
          .rect(a.gx * TILE, a.gy * TILE, TILE, TILE)
          .fill({ color: 0xff2020, alpha });
        this.fxLayer.addChild(flash);
      }

      const rise = (elapsed / 1000) * TILE * 1.1;
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
      lbl.alpha = Math.max(0, 1 - elapsed / HIT_ANIM_MS);
      this.fxLayer.addChild(lbl);
    }
  };

  sync(state: GameState): void {
    this.latestState = state;
    this.hitArea = new Rectangle(0, 0, state.width * TILE, state.height * TILE);

    this.floorLayer.removeChildren();
    this.wallRimLayer.clear();
    this.potLayer.removeChildren();
    this.rockLayer.removeChildren();
    this.lootLayer.removeChildren();
    this.fogLayer.removeChildren();
    this.entityLayer.removeChildren();
    this.collapseMarkerLayer.removeChildren();
    this.douvlonLineLayer.clear();
    this.darknessLayer.removeChildren();
    this.highlightLayer.removeChildren();
    this.gridLines.clear();

    const w = state.width;
    const h = state.height;
    const rimHalf = WALL_RIM_THICK / 2;

    const isSolidWall = (tx: number, ty: number): boolean => {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return true;
      return state.tiles[ty][tx] === "wall";
    };

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
        const id =
          kind === "wall"
            ? "wall"
            : rkind === "gauntlet_corridor"
              ? (x + y) % 2 === 0
                ? "gauntlet_corridor"
                : "gauntlet_corridor_alt"
              : rkind === "stair_room"
                ? (x + y) % 2 === 0
                  ? "floor"
                  : "floor_alt"
              : (x + y) % 2 === 0
                ? "floor"
                : "floor_alt";
        const spr = this.makeSprite(id);
        spr.x = x * TILE;
        spr.y = y * TILE;
        this.floorLayer.addChild(spr);
        this.gridLines
          .rect(x * TILE, y * TILE, TILE, TILE)
          .stroke({ width: 1, color: 0x000000, alpha: 0.28 });
      }
    }

    if (state.fogOfWar) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!state.discovered.has(keyOf({ x, y })) || state.tiles[y][x] !== "floor") continue;
          const ox = x * TILE;
          const oy = y * TILE;
          if (isSolidWall(x, y - 1)) {
            this.wallRimLayer
              .rect(ox, oy - rimHalf, TILE, WALL_RIM_THICK)
              .fill({ color: 0x05060a, alpha: 0.95 });
          }
          if (isSolidWall(x + 1, y)) {
            this.wallRimLayer
              .rect(ox + TILE - rimHalf, oy, WALL_RIM_THICK, TILE)
              .fill({ color: 0x05060a, alpha: 0.95 });
          }
          if (isSolidWall(x, y + 1)) {
            this.wallRimLayer
              .rect(ox, oy + TILE - rimHalf, TILE, WALL_RIM_THICK)
              .fill({ color: 0x05060a, alpha: 0.95 });
          }
          if (isSolidWall(x - 1, y)) {
            this.wallRimLayer
              .rect(ox - rimHalf, oy, WALL_RIM_THICK, TILE)
              .fill({ color: 0x05060a, alpha: 0.95 });
          }
        }
      }
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (state.tiles[y][x] !== "floor") continue;
          const ox = x * TILE;
          const oy = y * TILE;
          if (isSolidWall(x, y - 1)) {
            this.wallRimLayer
              .rect(ox, oy - rimHalf, TILE, WALL_RIM_THICK)
              .fill({ color: 0x05060a, alpha: 0.95 });
          }
          if (isSolidWall(x + 1, y)) {
            this.wallRimLayer
              .rect(ox + TILE - rimHalf, oy, WALL_RIM_THICK, TILE)
              .fill({ color: 0x05060a, alpha: 0.95 });
          }
          if (isSolidWall(x, y + 1)) {
            this.wallRimLayer
              .rect(ox, oy + TILE - rimHalf, TILE, WALL_RIM_THICK)
              .fill({ color: 0x05060a, alpha: 0.95 });
          }
          if (isSolidWall(x - 1, y)) {
            this.wallRimLayer
              .rect(ox - rimHalf, oy, WALL_RIM_THICK, TILE)
              .fill({ color: 0x05060a, alpha: 0.95 });
          }
        }
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

    const inset = Math.round(4 * (TILE / 40));

    for (const pot of state.pots) {
      if (state.fogOfWar && !state.discovered.has(keyOf(pot))) continue;
      const spr = this.makeSprite("pot");
      const potInset = Math.max(4, Math.round(6 * (TILE / 48)));
      spr.x = pot.x * TILE + potInset / 2;
      spr.y = pot.y * TILE + potInset / 2;
      spr.width = TILE - potInset;
      spr.height = TILE - potInset;
      this.potLayer.addChild(spr);
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

    for (const loot of state.groundLoot) {
      if (state.fogOfWar && !state.discovered.has(keyOf(loot))) continue;
      const g = new Graphics();
      const cx = loot.x * TILE + TILE * 0.72;
      const cy = loot.y * TILE + TILE * 0.72;
      const r = Math.max(3, Math.round(TILE * 0.12));
      let color = 0xe8c547;
      if (loot.kind === "bread") color = 0xc4a574;
      if (loot.kind === "card") color = 0x9b59b6;
      g.circle(cx, cy, r).fill({ color, alpha: 0.92 });
      this.lootLayer.addChild(g);
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
          if (state.discovered.has(keyOf({ x, y }))) continue;
          const spr = this.makeSprite("fog");
          spr.x = x * TILE;
          spr.y = y * TILE;
          this.fogLayer.addChild(spr);
        }
      }
    }

    const pSpr = this.makeSprite("player");
    pSpr.x = state.player.x * TILE + inset / 2;
    pSpr.y = state.player.y * TILE + inset / 2;
    pSpr.width = TILE - inset;
    pSpr.height = TILE - inset;
    this.entityLayer.addChild(pSpr);
    this.entityLayer.addChild(
      this.makeEntityLabel("You", state.player.x * TILE, state.player.y * TILE, 0xffffff),
    );

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
      const spr = this.makeSprite(
        mimicChest ? "chest" : def?.spriteId ?? "enemy_slime",
      );
      spr.x = m.x * TILE + inset / 2;
      spr.y = m.y * TILE + inset / 2;
      spr.width = TILE - inset;
      spr.height = TILE - inset;
      if (m.defId === "douvlon") {
        const tint = m.douvlonColor === "blue" ? 0x5dade2 : 0xe74c3c;
        spr.tint = tint;
      }
      this.entityLayer.addChild(spr);
      if (m.defId === "slime" && m.leapTarget != null) {
        const r = Math.max(3, Math.round(TILE * 0.11));
        const cx = m.x * TILE + Math.max(2, inset / 3) + r;
        const cy = m.y * TILE + Math.max(2, inset / 3) + r;
        const dot = new Graphics();
        dot.circle(cx, cy, r).fill({ color: 0xe74c3c, alpha: 0.95 });
        this.entityLayer.addChild(dot);
      }
      if ((m.defId === "skeleton" || m.defId === "skeleton_archer") && m.skeletonWeapon) {
        const badge = this.makeSkeletonWeaponIcon(m.skeletonWeapon);
        const badgeScale = Math.max(0.78, TILE / 48);
        badge.scale.set(badgeScale);
        badge.x = m.x * TILE + 1;
        badge.y = m.y * TILE + 1;
        this.entityLayer.addChild(badge);
      }
      if (m.defId === "skeleton_archer" && m.bowLoaded) {
        const r = Math.max(3, Math.round(TILE * 0.11));
        const cx = m.x * TILE + Math.max(2, inset / 3) + r;
        const cy = m.y * TILE + Math.max(2, inset / 3) + r;
        const dot = new Graphics();
        dot.circle(cx, cy, r).fill({ color: 0xf39c12, alpha: 0.95 });
        this.entityLayer.addChild(dot);
      }
      if (m.defId === "corrupted_shade") {
        const r = Math.max(3, Math.round(TILE * 0.11));
        const baseX = m.x * TILE + Math.max(2, inset / 3) + r;
        const baseY = m.y * TILE + Math.max(2, inset / 3) + r;
        if (m.darkBoltReady) {
          const dot = new Graphics();
          dot.circle(baseX, baseY, r).fill({ color: 0x8e44ad, alpha: 0.95 });
          this.entityLayer.addChild(dot);
        }
        if (m.blackShieldActive) {
          const dot = new Graphics();
          const ox = m.darkBoltReady ? r * 2 + 1 : 0;
          dot.circle(baseX + ox, baseY, r).fill({ color: 0x2980b9, alpha: 0.95 });
          this.entityLayer.addChild(dot);
        }
      }
      if (!mimicChest) {
        const label = def?.name ?? "?";
        this.entityLayer.addChild(
          this.makeEntityLabel(`${label} ${m.hp}hp`, m.x * TILE, m.y * TILE, 0xf5e6ff),
        );
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
    if (state.lightsOutTurns > 0) {
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
          const ch = Math.max(Math.abs(x - px), Math.abs(y - py));
          if (ch <= 1) continue;
          const dim = new Graphics();
          dim.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: 0x000000, alpha: 1 });
          this.darknessLayer.addChild(dim);
          if (manhattan({ x, y }, { x: px, y: py }) === 2 && entityHintAt(x, y)) {
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
      const pedAlpha = state.pedestalUsed ? 0.42 : 0.92;
      const tileInset = inset;

      const ped = sf.pedestal;
      if (!state.fogOfWar || state.discovered.has(keyOf(ped))) {
        const pcx = (ped.x + 0.5) * TILE;
        const pcy = (ped.y + 0.5) * TILE;
        const pr = TILE * 0.36;
        const pg = new Graphics();
        pg.circle(pcx, pcy, pr).fill({ color: 0x87ceeb, alpha: pedAlpha });
        this.entityLayer.addChild(pg);
      }

      const mer = sf.merchant;
      if (!state.fogOfWar || state.discovered.has(keyOf(mer))) {
        const ox = mer.x * TILE + tileInset / 2;
        const oy = mer.y * TILE + tileInset / 2;
        const sz = TILE - tileInset;
        const mg = new Graphics();
        mg.roundRect(ox, oy, sz, sz, 3)
          .fill({ color: 0xa0522d, alpha: 0.96 })
          .stroke({ width: 2.5, color: 0xf1c40f, alpha: 1 });
        this.entityLayer.addChild(mg);
      }

      for (const d of sf.exitDoorCells) {
        if (state.fogOfWar && !state.discovered.has(keyOf(d))) continue;
        const ox = d.x * TILE + tileInset / 2;
        const oy = d.y * TILE + tileInset / 2;
        const sz = TILE - tileInset;
        const sg = new Graphics();
        sg.roundRect(ox, oy, sz, sz, 2).fill({ color: 0x3d3d42, alpha: 0.98 });
        this.entityLayer.addChild(sg);
      }
      const ct = sf.cornerTile;
      if (!state.fogOfWar || state.discovered.has(keyOf(ct))) {
        const g = new Graphics();
        const cx = ct.x * TILE + TILE * 0.76;
        const cy = ct.y * TILE + TILE * 0.76;
        g.circle(cx, cy, Math.max(2, Math.round(TILE * 0.065))).fill({ color: 0xe8c547, alpha: 0.55 });
        this.entityLayer.addChild(g);
      }
    }

    this.drawHighlights(state);
  }

  /** Tiny weapon silhouette (14×14 design units) for skeleton AI readability. */
  private makeSkeletonWeaponIcon(weapon: SkeletonWeapon): Graphics {
    const g = new Graphics();
    const blade = 0xd5d8dc;
    const bladeHi = 0xecf0f1;
    const guard = 0x2c3e50;
    const grip = 0x5d4037;
    const shaft = 0x6d4c41;
    const head = 0x90a4ae;

    switch (weapon) {
      case "sword":
        g.poly([7, 1, 8, 1, 8.5, 9.5, 6.5, 9.5]).fill({ color: blade });
        g.poly([6.5, 5, 9, 5, 8.8, 9.5, 6.7, 9.5]).fill({ color: bladeHi, alpha: 0.35 });
        g.rect(4.5, 10, 6, 1.4).fill({ color: guard });
        g.roundRect(6.5, 11.3, 2, 3.2, 0.6).fill({ color: grip });
        break;
      case "spear":
        g.moveTo(3.5, 13).lineTo(11, 3.5).stroke({ width: 2.1, color: shaft, cap: "round" });
        g.poly([11, 3.5, 12.8, 2.2, 10.6, 2.8]).fill({ color: blade });
        g.poly([11, 3.5, 12.2, 2.8, 10.9, 3.2]).fill({ color: bladeHi, alpha: 0.4 });
        break;
      case "axe":
        g.rect(7, 6.5, 2, 8).fill({ color: shaft });
        g.poly([1.5, 3.5, 7, 2, 7, 8.5, 2.5, 7.5]).fill({ color: head });
        g.poly([2, 4.5, 6.2, 3.2, 6.2, 7.3, 2.8, 6.4]).fill({ color: bladeHi, alpha: 0.25 });
        break;
      case "scimitar":
        g.moveTo(2, 12)
          .quadraticCurveTo(5, 3, 12, 7)
          .lineTo(11, 9)
          .quadraticCurveTo(6, 11, 2, 12)
          .closePath()
          .fill({ color: blade });
        g.moveTo(3.5, 10)
          .quadraticCurveTo(6, 5, 10.5, 7.5)
          .stroke({ width: 1.2, color: bladeHi, alpha: 0.5 });
        g.roundRect(10.5, 9.5, 2.2, 3.8, 0.5).fill({ color: grip });
        break;
    }
    return g;
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

  private peaceStepTiles(state: GameState): Set<string> {
    const from = { x: state.player.x, y: state.player.y };
    const occ = new Set<string>();
    for (const m of state.monsters) {
      if (m.hp > 0) occ.add(keyOf(m));
    }
    const rockKeys = new Set(state.rocks.map((r) => keyOf(r)));
    const out = new Set<string>();
    for (const o of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const t = { x: from.x + o.x, y: from.y + o.y };
      if (t.x < 0 || t.y < 0 || t.x >= state.width || t.y >= state.height) continue;
      if (state.tiles[t.y][t.x] !== "floor") continue;
      if (occ.has(keyOf(t))) continue;
      if (rockKeys.has(keyOf(t))) continue;
      out.add(keyOf(t));
    }
    return out;
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
    if (pending.kind === "play_move") {
      const base = reachableOrthogonal(
        state.tiles,
        state.width,
        state.height,
        from,
        pending.range,
        occ,
        rockKeys,
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
    if (pending.kind === "play_card_seeker" || pending.kind === "move_token_step") {
      const base = reachableOrthogonal(state.tiles, state.width, state.height, from, 1, occ, rockKeys);
      const needExtra =
        pending.kind === "play_card_seeker"
          ? state.player.hand.length >= 2
          : state.player.hand.length >= 1;
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
      pending.kind === "play_melee" ||
      pending.kind === "play_knife" ||
      pending.kind === "play_axe" ||
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
      return adj;
    }

    if (pending.kind === "play_spear") {
      const cells = new Set<string>();
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        if (state.fogOfWar && !state.discovered.has(keyOf(m))) continue;
        const dx = m.x - from.x;
        const dy = m.y - from.y;
        if (dx !== 0 && dy !== 0) continue;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist !== 1 && dist !== 2) continue;
        cells.add(keyOf(m));
      }
      for (const pot of state.pots) {
        if (state.fogOfWar && !state.discovered.has(keyOf(pot))) continue;
        const dx = pot.x - from.x;
        const dy = pot.y - from.y;
        if (dx !== 0 && dy !== 0) continue;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist !== 1 && dist !== 2) continue;
        cells.add(keyOf(pot));
      }
      return cells;
    }

    if (pending.kind === "play_magic_missile") {
      const cells = new Set<string>();
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        if (state.fogOfWar && !state.discovered.has(keyOf(m))) continue;
        if (magicMissilePathClear(state.tiles, state.monsters, from, m)) cells.add(keyOf(m));
      }
      for (const pot of state.pots) {
        if (state.fogOfWar && !state.discovered.has(keyOf(pot))) continue;
        if (
          magicMissilePathClearToPoint(state.tiles, state.monsters, state.pots, from, pot.x, pot.y)
        ) {
          cells.add(keyOf(pot));
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
      return adj;
    }

    if (pending.kind === "play_bow_attack") {
      const cells = new Set<string>();
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        if (state.fogOfWar && !state.discovered.has(keyOf(m))) continue;
        if (manhattan(from, m) <= 1) continue;
        if (chebyshev(from, m) > pending.range) continue;
        if (lineOfSightClear(state.tiles, from, { x: m.x, y: m.y })) cells.add(keyOf(m));
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
              const lastMon = state.monsters.find((m) => m.id === pending.hitIds[pending.hitIds.length - 1]);
              return lastMon ? { x: lastMon.x, y: lastMon.y } : from;
            })();
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        if (state.fogOfWar && !state.discovered.has(keyOf(m))) continue;
        if (pending.hitIds.includes(m.id)) continue;
        if (chebyshev(origin, { x: m.x, y: m.y }) <= pending.nextDamage) cells.add(keyOf(m));
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

    return new Set();
  }

  private makeSprite(id: string): Sprite {
    const style = this.styles.get(id) ?? { kind: "tinted" as const, tint: 0x888888 };
    const spr = new Sprite(Texture.WHITE);
    spr.width = TILE;
    spr.height = TILE;
    if (style.kind === "texture") {
      spr.texture = style.texture;
      spr.tint = 0xffffff;
    } else {
      spr.texture = Texture.WHITE;
      spr.tint = style.tint;
      if (style.alpha !== undefined) {
        spr.alpha = style.alpha;
      }
    }
    return spr;
  }
}
