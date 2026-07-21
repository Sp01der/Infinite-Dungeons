import { Application } from "pixi.js";
import floorSample from "./content/floor_sample.json";
import type { FloorDef } from "./game/types";
import { createInitialState, createInitialStateGenerated } from "./game/initialState";
import { dispatch } from "./game/reducer";
import { expToNextLevel } from "./game/progression";
import {
  getSkillDef,
  getSkillParentId,
  SKILL_CATEGORIES,
  SKILL_DEFS,
  type SkillDef,
} from "./game/skillDefs";
import { CARD_TYPE_ORDER, type AtbmbTilePref, type AtbmbWhen, type CardDef, type FloorTheme, type GameCommand, type GameState, type ShiftyGemId, type TurnAnimEvent } from "./game/types";
import { hasAtbmb, inAttackRange, isOnBadTile, isOnFavoredTile, planAtbmbPath, resolveTilePrefs, stablePathRng, whenMatches, evaluateEliteSkeletonOptions } from "./game/atbmb";
import { monsterTilePassable, movementOcc } from "./game/monsterAi";
import { manhattan } from "./engine/movement";
import type { AtbmbMoveSeek } from "./game/types";
import { lightningBoltSkillDamageBonus } from "./game/skillsRuntime";
import { merchantDialogueOpen, merchantDisplayName, merchantShopOpen, merchantUiBlocks } from "./game/merchantRuntime";
import {
  ALL_GEM_IDS,
  gemLootSpriteId,
  lootIconCss,
  type LootIconId,
} from "./game/lootIcons";
import { loadSpriteStyles } from "./render/assets";
import { loadAttackFxFrames } from "./render/attackFx";
import { GridView, VIEW_HEIGHT_PX, VIEW_WIDTH_PX } from "./render/gridView";

const viewport = document.querySelector<HTMLDivElement>("#game-viewport")!;
const hudFloor = document.querySelector<HTMLSpanElement>("#hud-floor")!;
const hudPhase = document.querySelector<HTMLSpanElement>("#hud-phase")!;
const hudHp = document.querySelector<HTMLSpanElement>("#hud-hp")!;
const hudLevel = document.querySelector<HTMLSpanElement>("#hud-level")!;
const hudExp = document.querySelector<HTMLSpanElement>("#hud-exp")!;
const hudSkillPts = document.querySelector<HTMLSpanElement>("#hud-skill-pts")!;
const hudGold = document.querySelector<HTMLSpanElement>("#hud-gold")!;
const inventoryGrid = document.querySelector<HTMLDivElement>("#inventory-grid")!;
const hudDanger = document.querySelector<HTMLSpanElement>("#hud-danger")!;
const hudNoise = document.querySelector<HTMLSpanElement>("#hud-noise")!;
const hudDraw = document.querySelector<HTMLSpanElement>("#hud-draw")!;
const hudDiscard = document.querySelector<HTMLSpanElement>("#hud-discard")!;
const hudEquipped = document.querySelector<HTMLSpanElement>("#hud-equipped")!;
const dungeonDeckVisual = document.querySelector<HTMLDivElement>("#dungeon-deck-visual")!;
const dungeonDiscardVisual = document.querySelector<HTMLDivElement>("#dungeon-discard-visual")!;
const handEl = document.querySelector<HTMLDivElement>("#hand-cards")!;
const handZoneEl = document.querySelector<HTMLDivElement>(".dock-hand")!;
const actionBarEl = document.querySelector<HTMLDivElement>("#hand-action-bar")!;
const logEl = document.querySelector<HTMLDivElement>("#game-log")!;
const hintEl = document.querySelector<HTMLParagraphElement>("#hint")!;
const btnEnd = document.querySelector<HTMLButtonElement>("#btn-end-turn")!;
const cancelBtn = document.querySelector<HTMLButtonElement>("#btn-cancel")!;
const unequipBtn = document.querySelector<HTMLButtonElement>("#btn-unequip")!;
const shiftyDialogueEl = document.querySelector<HTMLDivElement>("#shifty-dialogue")!;
const shiftyDialogueBox = document.querySelector<HTMLDivElement>("#shifty-dialogue .shifty-dialogue-box")!;
const shiftyDialogueText = document.querySelector<HTMLParagraphElement>("#shifty-dialogue-text")!;
const shiftyDialogueChoices = document.querySelector<HTMLDivElement>("#shifty-dialogue-choices")!;
const shiftyShopEl = document.querySelector<HTMLDivElement>("#shifty-shop")!;
const shiftyShopTitle = document.querySelector<HTMLHeadingElement>("#shifty-shop-title")!;
const shiftyShopNote = document.querySelector<HTMLParagraphElement>("#shifty-shop .chest-offer-note")!;
const shiftyShopBackdrop = document.querySelector<HTMLDivElement>("#shifty-shop-backdrop")!;
const shiftyShopListings = document.querySelector<HTMLDivElement>("#shifty-shop-listings")!;
const shiftyShopTomes = document.querySelector<HTMLButtonElement>("#shifty-shop-tomes")!;
const shiftyShopLeave = document.querySelector<HTMLButtonElement>("#shifty-shop-leave")!;
const inspectDeckBtn = document.querySelector<HTMLButtonElement>("#inspect-deck")!;
const inspectDiscardBtn = document.querySelector<HTMLButtonElement>("#inspect-discard")!;
const pileInspector = document.querySelector<HTMLDivElement>("#pile-inspector")!;
const pileInspectorBackdrop = document.querySelector<HTMLDivElement>("#pile-inspector-backdrop")!;
const pileInspectorClose = document.querySelector<HTMLButtonElement>("#pile-inspector-close")!;
const pileInspectorTitle = document.querySelector<HTMLHeadingElement>("#pile-inspector-title")!;
const pileInspectorNote = document.querySelector<HTMLParagraphElement>("#pile-inspector-note")!;
const pileInspectorBody = document.querySelector<HTMLDivElement>("#pile-inspector-body")!;
const monsterBrainEl = document.querySelector<HTMLElement>("#monster-brain")!;
const monsterBrainTitle = document.querySelector<HTMLHeadingElement>("#monster-brain-title")!;
const monsterBrainSubtitle = document.querySelector<HTMLParagraphElement>("#monster-brain-subtitle")!;
const monsterBrainBody = document.querySelector<HTMLDivElement>("#monster-brain-body")!;
const monsterBrainClose = document.querySelector<HTMLButtonElement>("#monster-brain-close")!;
const chestOfferEl = document.querySelector<HTMLDivElement>("#chest-offer")!;
const chestOfferBackdrop = document.querySelector<HTMLDivElement>("#chest-offer-backdrop")!;
const chestOfferCards = document.querySelector<HTMLDivElement>("#chest-offer-cards")!;
const chestOfferSkip = document.querySelector<HTMLButtonElement>("#chest-offer-skip")!;
const cardPickupOfferEl = document.querySelector<HTMLDivElement>("#card-pickup-offer")!;
const cardPickupBackdrop = document.querySelector<HTMLDivElement>("#card-pickup-backdrop")!;
const cardPickupBody = document.querySelector<HTMLDivElement>("#card-pickup-body")!;
const cardPickupAccept = document.querySelector<HTMLButtonElement>("#card-pickup-accept")!;
const cardPickupDecline = document.querySelector<HTMLButtonElement>("#card-pickup-decline")!;
const pedestalOfferEl = document.querySelector<HTMLDivElement>("#pedestal-offer")!;
const pedestalOfferBackdrop = document.querySelector<HTMLDivElement>("#pedestal-offer-backdrop")!;
const pedestalOfferCards = document.querySelector<HTMLDivElement>("#pedestal-offer-cards")!;
const pedestalOfferSkip = document.querySelector<HTMLButtonElement>("#pedestal-offer-skip")!;
const deckDestroyOfferEl = document.querySelector<HTMLDivElement>("#deck-destroy-offer")!;
const deckDestroyBackdrop = document.querySelector<HTMLDivElement>("#deck-destroy-backdrop")!;
const deckDestroyBody = document.querySelector<HTMLDivElement>("#deck-destroy-body")!;
const deckDestroySkip = document.querySelector<HTMLButtonElement>("#deck-destroy-skip")!;
const flameDestroyOfferEl = document.querySelector<HTMLDivElement>("#flame-destroy-offer")!;
const flameDestroyBackdrop = document.querySelector<HTMLDivElement>("#flame-destroy-backdrop")!;
const flameDestroyBody = document.querySelector<HTMLDivElement>("#flame-destroy-body")!;
const flameDestroySkip = document.querySelector<HTMLButtonElement>("#flame-destroy-skip")!;
const bindTomeOfferEl = document.querySelector<HTMLDivElement>("#bind-tome-offer")!;
const bindTomeBackdrop = document.querySelector<HTMLDivElement>("#bind-tome-backdrop")!;
const bindTomeBody = document.querySelector<HTMLDivElement>("#bind-tome-body")!;
const bindTomeSkip = document.querySelector<HTMLButtonElement>("#bind-tome-skip")!;
const dungeonCardToast = document.querySelector<HTMLDivElement>("#dungeon-card-toast")!;
const dungeonCardToastTitle = document.querySelector<HTMLDivElement>("#dungeon-card-toast-title")!;
const dungeonCardToastSummary = document.querySelector<HTMLDivElement>("#dungeon-card-toast-summary")!;
const dungeonCardToastDismiss = document.querySelector<HTMLButtonElement>(
  "#dungeon-card-toast-dismiss",
)!;
const skillTreeModal = document.querySelector<HTMLDivElement>("#skill-tree-modal")!;
const skillTreeBackdrop = document.querySelector<HTMLDivElement>("#skill-tree-backdrop")!;
const skillTreeClose = document.querySelector<HTMLButtonElement>("#skill-tree-close")!;
const skillTreeScroll = document.querySelector<HTMLDivElement>("#skill-tree-scroll")!;
const skillTreeCanvas = document.querySelector<HTMLDivElement>("#skill-tree-canvas")!;
const skillTreeTooltip = document.querySelector<HTMLDivElement>("#skill-tree-tooltip")!;
const skillTreeSkillPts = document.querySelector<HTMLSpanElement>("#skill-tree-skill-pts")!;
const btnSkillTree = document.querySelector<HTMLButtonElement>("#btn-skill-tree")!;
const turnTokensEl = document.querySelector<HTMLDivElement>("#turn-tokens")!;
const deckBuilderOfferEl = document.querySelector<HTMLDivElement>("#deck-builder-offer")!;
const deckBuilderBackdrop = document.querySelector<HTMLDivElement>("#deck-builder-backdrop")!;
const deckBuilderNote = document.querySelector<HTMLParagraphElement>("#deck-builder-note")!;
const deckBuilderTypeGrid = document.querySelector<HTMLDivElement>("#deck-builder-type-grid")!;
const deckBuilderCards = document.querySelector<HTMLDivElement>("#deck-builder-cards")!;
const deckBuilderSkip = document.querySelector<HTMLButtonElement>("#deck-builder-skip")!;
const dualWieldOfferEl = document.querySelector<HTMLDivElement>("#dual-wield-offer")!;
const dualWieldBackdrop = document.querySelector<HTMLDivElement>("#dual-wield-backdrop")!;
const dualWieldCards = document.querySelector<HTMLDivElement>("#dual-wield-cards")!;
const dualWieldCancel = document.querySelector<HTMLButtonElement>("#dual-wield-cancel")!;
const commandWindowBtn = document.querySelector<HTMLButtonElement>("#btn-command-window")!;
const graphicsToggleBtn = document.querySelector<HTMLButtonElement>("#btn-graphics-toggle")!;
const commandWindow = document.querySelector<HTMLDivElement>("#command-window")!;
const commandWindowBackdrop = document.querySelector<HTMLDivElement>("#command-window-backdrop")!;
const commandWindowClose = document.querySelector<HTMLButtonElement>("#command-window-close")!;
const commandForm = document.querySelector<HTMLFormElement>("#command-form")!;
const commandInput = document.querySelector<HTMLInputElement>("#command-input")!;
const commandFeedback = document.querySelector<HTMLParagraphElement>("#command-feedback")!;

const useSampleFloor =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("sampleFloor");

let state: GameState = useSampleFloor
  ? createInitialState(floorSample as FloorDef)
  : createInitialStateGenerated(1);
let grid: GridView | undefined;
let mapCameraInitialized = false;
let lastSyncedFloorId: string | null = null;
/** Hand index chosen to discard when escaping water (then click land). */
let waterEscapeHandIndex: number | null = null;
/** Currently selected hand card for the shared action bar. */
let selectedHandIndex: number | null = null;
/** Whether the discard bonus sub-menu is open in the action bar. */
let discardMenuOpen = false;
/** Editor: monster instance whose ATBMB brain is open. */
let brainInspectMonsterId: string | null = null;
/** True while move/attack presentation is playing — blocks further commands. */
let animating = false;

const PIXEL_ART_STORAGE_KEY = "infinite-dungeon-pixel-art";

function readStoredPixelArtPreference(): boolean {
  try {
    const v = localStorage.getItem(PIXEL_ART_STORAGE_KEY);
    if (v === "0" || v === "false" || v === "boxes") return false;
    if (v === "1" || v === "true" || v === "pixel") return true;
  } catch {
    /* ignore */
  }
  return true;
}

function syncGraphicsToggleButton(): void {
  const on = grid?.getPixelArtEnabled() ?? readStoredPixelArtPreference();
  graphicsToggleBtn.textContent = on ? "Pixel art" : "Boxes";
  graphicsToggleBtn.title = on
    ? "Using pixel art — click for solid box sprites"
    : "Using box sprites — click for pixel art";
  graphicsToggleBtn.setAttribute("aria-pressed", on ? "true" : "false");
}

function setPixelArtEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PIXEL_ART_STORAGE_KEY, enabled ? "pixel" : "boxes");
  } catch {
    /* ignore */
  }
  grid?.setPixelArtEnabled(enabled);
  syncGraphicsToggleButton();
}

function choiceModalBlocksPlay(s: GameState): boolean {
  return (
    !!s.chestOffer ||
    (s.cardPickupOffer?.queue.length ?? 0) > 0 ||
    !!s.pedestalOffer ||
    s.deckDestroyPending ||
    s.flameDestroyPending ||
    s.bindTomePending ||
    !!s.deckBuilderOffer ||
    s.dualWieldStage?.step === "choose_discard_attack" ||
    merchantUiBlocks(s)
  );
}

function skillTreeUnlockBlocked(s: GameState): boolean {
  return choiceModalBlocksPlay(s) || (s.phase === "player" && !!s.pending);
}

function openSkillTreeModal(): void {
  if (state.phase === "defeat") return;
  if (state.gauntletCommenced && state.phase !== "peace") return;
  skillTreeModal.classList.add("is-open");
  skillTreeModal.setAttribute("aria-hidden", "false");
  renderSkillTree();
}

function closeSkillTreeModal(): void {
  skillTreeModal.classList.remove("is-open");
  skillTreeModal.setAttribute("aria-hidden", "true");
  skillTreeTooltip.hidden = true;
  skillTreeTooltip.replaceChildren();
}

function positionSkillTooltip(clientX: number, clientY: number): void {
  const pad = 12;
  const tw = skillTreeTooltip.offsetWidth;
  const th = skillTreeTooltip.offsetHeight;
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + tw > window.innerWidth - 8) x = clientX - tw - pad;
  if (y + th > window.innerHeight - 8) y = clientY - th - pad;
  skillTreeTooltip.style.left = `${Math.max(8, x)}px`;
  skillTreeTooltip.style.top = `${Math.max(8, y)}px`;
}

function showSkillTooltip(e: MouseEvent, sk: SkillDef, reqLabel: string): void {
  skillTreeTooltip.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = sk.name;
  const desc = document.createElement("p");
  desc.style.margin = "0";
  desc.textContent = sk.description;
  const meta = document.createElement("p");
  meta.className = "skill-tip-meta";
  meta.textContent =
    `Cost: ${sk.cost} SP` + (reqLabel ? ` · Requires: ${reqLabel}` : "");
  skillTreeTooltip.appendChild(title);
  skillTreeTooltip.appendChild(desc);
  skillTreeTooltip.appendChild(meta);
  skillTreeTooltip.hidden = false;
  positionSkillTooltip(e.clientX, e.clientY);
}

function hideSkillTooltip(): void {
  skillTreeTooltip.hidden = true;
}

function drawSkillTreeEdges(wrap: HTMLElement, svg: SVGSVGElement): void {
  const chart = wrap.querySelector(".skill-tree-chart") as HTMLElement | null;
  if (!chart) return;
  const rect = chart.getBoundingClientRect();
  svg.replaceChildren();
  svg.setAttribute("width", String(Math.max(1, chart.offsetWidth)));
  svg.setAttribute("height", String(Math.max(1, chart.offsetHeight)));
  wrap.querySelectorAll<HTMLElement>("[data-skill-node]").forEach((nodeEl) => {
    const sid = nodeEl.dataset.skillNode;
    if (!sid) return;
    const sk = getSkillDef(sid);
    const pid = sk ? getSkillParentId(sk) : null;
    if (!pid) return;
    const pWrap = wrap.querySelector(`[data-skill-node="${pid}"]`) as HTMLElement | null;
    if (!pWrap || !nodeEl) return;
    const pr = pWrap.getBoundingClientRect();
    const cr = nodeEl.getBoundingClientRect();
    const x1 = pr.right - rect.left;
    const y1 = pr.top + pr.height / 2 - rect.top;
    const x2 = cr.left - rect.left;
    const y2 = cr.top + cr.height / 2 - rect.top;
    const mid = (x1 + x2) / 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
    path.setAttribute("class", "skill-tree-edge");
    svg.appendChild(path);
  });
}

function renderSkillTree(): void {
  const n = state.player.skillPoints;
  skillTreeSkillPts.textContent = `${n} skill point${n === 1 ? "" : "s"}`;
  skillTreeCanvas.replaceChildren();
  for (const cat of SKILL_CATEGORIES) {
    const skills = SKILL_DEFS.filter((s) => s.category === cat).sort((a, b) => {
      if (a.layoutCol !== b.layoutCol) return a.layoutCol - b.layoutCol;
      return a.id.localeCompare(b.id);
    });
    const maxCol = skills.reduce((m, s) => Math.max(m, s.layoutCol), 0);

    const wrap = document.createElement("div");
    wrap.className = "skill-tree-row-wrap";

    const label = document.createElement("span");
    label.className = "skill-tree-cat";
    label.textContent = cat;

    const chart = document.createElement("div");
    chart.className = "skill-tree-chart";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("skill-tree-svg");

    const colsWrap = document.createElement("div");
    colsWrap.className = "skill-tree-cols";

    for (let c = 0; c <= maxCol; c++) {
      const colEl = document.createElement("div");
      colEl.className = "skill-tree-col";
      const inCol = skills.filter((sk) => sk.layoutCol === c);
      for (const sk of inCol) {
        const unlocked = state.player.skillsUnlocked.includes(sk.id);
        const prereqOk = sk.requires.every((r) => state.player.skillsUnlocked.includes(r));
        const affordable = state.player.skillPoints >= sk.cost;
        const blocked = skillTreeUnlockBlocked(state);
        const nodeWrap = document.createElement("div");
        nodeWrap.className = "skill-tree-node-wrap";
        nodeWrap.dataset.skillNode = sk.id;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "skill-node";
        btn.textContent = sk.name;
        if (unlocked) btn.classList.add("skill-node--unlocked");
        else if (prereqOk && affordable && !blocked) btn.classList.add("skill-node--ready");
        else btn.classList.add("skill-node--locked");
        const canBuy = !unlocked && prereqOk && affordable && !blocked;
        btn.disabled = unlocked || !canBuy;
        btn.addEventListener("click", () => {
          if (!canBuy || btn.disabled) return;
          apply({ type: "UNLOCK_SKILL", skillId: sk.id });
        });
        const reqNames = sk.requires
          .map((r) => SKILL_DEFS.find((x) => x.id === r)?.name ?? r)
          .join(", ");
        btn.addEventListener("mouseenter", (ev) => showSkillTooltip(ev, sk, reqNames));
        btn.addEventListener("mousemove", (ev) => positionSkillTooltip(ev.clientX, ev.clientY));
        btn.addEventListener("mouseleave", hideSkillTooltip);

        const hintRow = document.createElement("div");
        hintRow.className = "skill-token-hint";
        if (sk.grantsTokens?.length) {
          for (const g of sk.grantsTokens) {
            const chip = document.createElement("span");
            chip.className = "skill-token-hint-chip";
            chip.textContent =
              g.kind === "move"
                ? `+${g.perTurn} move${g.perTurn > 1 ? "" : ""}/turn`
                : `+${g.perTurn} knockback/turn`;
            hintRow.appendChild(chip);
          }
        }

        nodeWrap.appendChild(btn);
        nodeWrap.appendChild(hintRow);
        colEl.appendChild(nodeWrap);
      }
      colsWrap.appendChild(colEl);
    }

    chart.appendChild(svg);
    chart.appendChild(colsWrap);
    wrap.appendChild(label);
    wrap.appendChild(chart);
    skillTreeCanvas.appendChild(wrap);

    requestAnimationFrame(() => drawSkillTreeEdges(wrap, svg));
  }
}

function renderTurnTokens(): void {
  turnTokensEl.replaceChildren();
  if (state.phase === "defeat") return;
  const blocked = choiceModalBlocksPlay(state);
  if (state.player.moveTokens > 0) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "turn-token turn-token--move";
    b.textContent = `Move ×${state.player.moveTokens}`;
    b.title = "Spend one token, then click a highlighted tile to step 1 space.";
    b.disabled = state.phase !== "player" || !!state.pending || blocked;
    b.addEventListener("click", () => apply({ type: "USE_MOVE_TOKEN" }));
    turnTokensEl.appendChild(b);
  }
  if (state.player.knockbackTokens > 0) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "turn-token turn-token--kb";
    b.textContent = `Knockback ×${state.player.knockbackTokens}`;
    b.title = "Spend to add 1 space of knockback to your next Melee attack. Spend more to stack.";
    b.disabled = state.phase !== "player" || !!state.pending || blocked;
    b.addEventListener("click", () => apply({ type: "USE_KNOCKBACK_TOKEN" }));
    turnTokensEl.appendChild(b);
  }
  if (state.player.knockbackPrimed) {
    const span = document.createElement("span");
    span.className = "turn-token-primed";
    span.textContent = `KB +${state.player.knockbackPrimed}`;
    turnTokensEl.appendChild(span);
  }
}

function cardChrome(cardId: string): { icon: string; accent: string } {
  switch (cardId) {
    case "move":
      return { icon: "↔", accent: "#3d8c5c" };
    case "copper_sword":
      return { icon: "⚔", accent: "#b87333" };
    case "focus":
      return { icon: "◉", accent: "#4a90d9" };
    case "spear":
      return { icon: "╋", accent: "#8b9a6b" };
    case "knife":
      return { icon: "✂", accent: "#a8a8b8" };
    case "axe":
      return { icon: "🪓", accent: "#8b4513" };
    case "quickstep":
      return { icon: "⚡", accent: "#6b9e9e" };
    case "tactical_approach":
      return { icon: "◇", accent: "#5a9e7a" };
    case "bonus_card":
      return { icon: "◇", accent: "#7a8e9e" };
    case "threefold_gift":
      return { icon: "✦", accent: "#e8c547" };
    case "parry":
      return { icon: "🛡", accent: "#6b8fc9" };
    case "flurry_of_blows":
      return { icon: "👊", accent: "#c17a4a" };
    case "magic_missile":
      return { icon: "✧", accent: "#b565d8" };
    case "card_seeker":
      return { icon: "🃏", accent: "#e6a23c" };
    case "mace_smash":
      return { icon: "✹", accent: "#8f6b45" };
    case "weariness":
      return { icon: "…", accent: "#6b7280" };
    case "poisoned_blade":
      return { icon: "☠", accent: "#5c9b45" };
    case "loot_and_scoot":
      return { icon: "●", accent: "#d4a72c" };
    case "dual_wield":
      return { icon: "⚔", accent: "#a66dd4" };
    case "flying_kick":
      return { icon: "➜", accent: "#d07145" };
    case "great_sword":
      return { icon: "†", accent: "#e6a23c" };
    case "potion_of_harming":
      return { icon: "⚗", accent: "#a0522d" };
    default:
      return { icon: "?", accent: "#888888" };
  }
}

function createCardTypesElement(def: CardDef | undefined): HTMLDivElement | null {
  const types = def?.types ?? [];
  if (types.length === 0) return null;

  const row = document.createElement("div");
  row.className = "card-type-row";
  row.setAttribute("aria-label", `Card types: ${types.join(", ")}`);
  for (const type of types) {
    const pill = document.createElement("span");
    pill.className = "card-type-pill";
    pill.textContent = type;
    row.appendChild(pill);
  }
  return row;
}

function apply(cmd: GameCommand): void {
  if (animating) return;
  const prev = state;
  const { state: next, anims } = dispatch(state, cmd);
  if (anims.length === 0 || !grid) {
    state = next;
    renderAll();
    return;
  }
  void playTurnAnims(prev, next, anims);
}

async function playTurnAnims(
  prev: GameState,
  finalState: GameState,
  anims: TurnAnimEvent[],
): Promise<void> {
  if (!grid) {
    state = finalState;
    renderAll();
    return;
  }
  animating = true;
  grid.setPresentationLocked(true);
  let display = prev;
  // Keep logical `state` on the pre-action snapshot so HUD/HP stay deferred.
  // Grid starts at pre-action positions; beats update presentation as they finish.
  grid.sync(display);
  renderHudFrom(display);

  try {
    for (const ev of anims) {
      if (ev.kind === "move") {
        await grid.playMove(ev.entityId, ev.fromX, ev.fromY, ev.toX, ev.toY);
        display = applyMoveToDisplay(display, ev);
      } else if (ev.kind === "simultaneous") {
        const vineHit = ev.hits.find((h) => h.fx?.kind === "vine_whip");
        const vineMove = vineHit && ev.moves.length === 1 ? ev.moves[0] : null;
        if (vineHit && vineMove) {
          await grid.playVineWhipPull(vineHit, vineMove);
        } else {
          const movePromises = ev.moves.map((mv) =>
            grid!.playMove(mv.entityId, mv.fromX, mv.fromY, mv.toX, mv.toY),
          );
          const hitPromise =
            ev.hits.length > 0 ? grid.playHitsAsync(ev.hits) : Promise.resolve();
          await Promise.all([...movePromises, hitPromise]);
        }
        for (const mv of ev.moves) {
          display = applyMoveToDisplay(display, { kind: "move", ...mv });
        }
        display = ev.stateAfter;
        grid.sync(display);
        renderHudFrom(display);
      } else {
        await grid.playHitsAsync(ev.hits);
        display = ev.stateAfter;
        grid.sync(display);
        renderHudFrom(display);
      }
    }
  } finally {
    grid.setPresentationLocked(false);
    state = finalState;
    animating = false;
    renderAll();
  }
}

function applyMoveToDisplay(s: GameState, ev: Extract<TurnAnimEvent, { kind: "move" }>): GameState {
  if (ev.entityId === "player") {
    return {
      ...s,
      player: { ...s.player, x: ev.toX, y: ev.toY },
    };
  }
  return {
    ...s,
    monsters: s.monsters.map((m) =>
      m.id === ev.entityId ? { ...m, x: ev.toX, y: ev.toY } : m,
    ),
  };
}

/** Lightweight HUD refresh used mid-animation (HP / phase / log). */
function renderHudFrom(s: GameState): void {
  hudPhase.textContent =
    s.phase === "defeat" ? "Defeat" : s.phase === "peace" ? "Peace" : "Your turn";
  hudHp.textContent =
    s.player.resistance > 0
      ? `${s.player.hp} / ${s.player.maxHp} (Res ${s.player.resistance})`
      : `${s.player.hp} / ${s.player.maxHp}`;
  renderLogFrom(s);
}

function renderLogFrom(s: GameState): void {
  logEl.replaceChildren();
  const lines = s.log.slice(-12);
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    logEl.appendChild(p);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function cellClick(x: number, y: number): void {
  if (animating) return;
  const s = state;
  if (choiceModalBlocksPlay(s)) return;
  if (s.phase === "peace") {
    const mer = s.stairFeatures?.merchant;
    if (
      s.merchantState &&
      mer &&
      mer.x === x &&
      mer.y === y
    ) {
      const pr = s.roomIds[s.player.y]?.[s.player.x] ?? -1;
      const mr = s.roomIds[mer.y]?.[mer.x] ?? -1;
      if (pr >= 0 && pr === mr) {
        apply({ type: "TALK_TO_MERCHANT" });
        return;
      }
    }
    apply({ type: "PEACE_MOVE_TO", x, y });
    return;
  }
  if (s.phase !== "player") return;
  if (s.pending?.kind === "water_escape") {
    if (waterEscapeHandIndex === null) return;
    apply({
      type: "CONFIRM_WATER_ESCAPE",
      destX: x,
      destY: y,
      handIndex: waterEscapeHandIndex,
    });
    waterEscapeHandIndex = null;
    return;
  }
  if (!s.pending) {
    if (s.editorMode) {
      const mon = s.monsters.find((m) => m.hp > 0 && m.x === x && m.y === y);
      if (mon) {
        openMonsterBrain(mon.id);
        return;
      }
      if (brainInspectMonsterId) {
        closeMonsterBrain();
        renderAll();
      }
    }
    return;
  }
  if (s.pending.kind === "enter_blocked_tile") return;
  apply({ type: "CONFIRM_TARGET_TILE", x, y });
}

function cellSecondary(x: number, y: number): void {
  if (!state.editorMode) return;
  apply({ type: "DEV_EDITOR_CELL_ACTION", x, y });
}

function countIds(ids: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

type CommandVariable = Extract<GameCommand, { type: "DEV_SET_VARIABLE" }>["variable"];

const COMMAND_VARIABLES: Record<string, CommandVariable> = {
  level: "level",
  danger: "danger",
  "max hp": "maxHp",
  maxhp: "maxHp",
  hp: "hp",
  gold: "gold",
  bread: "bread",
  herb: "herb",
  noise: "noise",
  exp: "exp",
  experience: "exp",
  "skill points": "skillPoints",
  skillpoints: "skillPoints",
  sp: "skillPoints",
};

type CommandItem = Extract<GameCommand, { type: "DEV_ITEM" }>;

const COMMAND_ITEMS: Record<string, { item: CommandItem["item"]; gemId?: ShiftyGemId; label: string }> = {
  gold: { item: "gold", label: "gold" },
  coin: { item: "gold", label: "gold" },
  coins: { item: "gold", label: "gold" },
  bread: { item: "bread", label: "bread" },
  "piece of bread": { item: "bread", label: "bread" },
  herb: { item: "herb", label: "healing herb" },
  herbs: { item: "herb", label: "healing herb" },
  "healing herb": { item: "herb", label: "healing herb" },
  cheese: { item: "cheese", label: "cheese" },
  flame: { item: "flameOfDestruction", label: "Flame of Destruction" },
  "flame of destruction": { item: "flameOfDestruction", label: "Flame of Destruction" },
  tome: { item: "unboundTomes", label: "Unbound Magic Tome" },
  "magic tome": { item: "unboundTomes", label: "Unbound Magic Tome" },
  "unbound magic tome": { item: "unboundTomes", label: "Unbound Magic Tome" },
  "unbound tome": { item: "unboundTomes", label: "Unbound Magic Tome" },
  "gem of strength": { item: "gem", gemId: "strength", label: "Gem of Strength" },
  "strength gem": { item: "gem", gemId: "strength", label: "Gem of Strength" },
  strength: { item: "gem", gemId: "strength", label: "Gem of Strength" },
  "gem of speed": { item: "gem", gemId: "speed", label: "Gem of Speed" },
  "speed gem": { item: "gem", gemId: "speed", label: "Gem of Speed" },
  speed: { item: "gem", gemId: "speed", label: "Gem of Speed" },
  "gem of luck": { item: "gem", gemId: "luck", label: "Gem of Luck" },
  "luck gem": { item: "gem", gemId: "luck", label: "Gem of Luck" },
  luck: { item: "gem", gemId: "luck", label: "Gem of Luck" },
  "gem of cards": { item: "gem", gemId: "cards", label: "Gem of Cards" },
  "cards gem": { item: "gem", gemId: "cards", label: "Gem of Cards" },
  cards: { item: "gem", gemId: "cards", label: "Gem of Cards" },
  "gem of healing": { item: "gem", gemId: "healing", label: "Gem of Healing" },
  "healing gem": { item: "gem", gemId: "healing", label: "Gem of Healing" },
  healing: { item: "gem", gemId: "healing", label: "Gem of Healing" },
  "gem of defense": { item: "gem", gemId: "defense", label: "Gem of Defense" },
  "defense gem": { item: "gem", gemId: "defense", label: "Gem of Defense" },
  defense: { item: "gem", gemId: "defense", label: "Gem of Defense" },
};

function normalizeLookupName(value: string): string {
  // Expand common contractions before stripping punctuation, so "You're Not Alone"
  // matches defs named "You Are Not Alone" (apostrophe alone would yield "you re").
  let s = value.trim().toLowerCase();
  s = s
    .replace(/\byou're\b/g, "you are")
    .replace(/\bwe're\b/g, "we are")
    .replace(/\bthey're\b/g, "they are")
    .replace(/\bit's\b/g, "it is")
    .replace(/\bthat's\b/g, "that is")
    .replace(/\bwhat's\b/g, "what is")
    .replace(/\bwho's\b/g, "who is")
    .replace(/\bhere's\b/g, "here is")
    .replace(/\bthere's\b/g, "there is")
    .replace(/\bi'm\b/g, "i am");
  return s
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findNamedId(defs: ReadonlyMap<string, { name: string }>, rawName: string): string | null {
  const needle = normalizeLookupName(rawName);
  if (!needle) return null;
  for (const [id, def] of defs) {
    if (id.toLowerCase() === rawName.trim().toLowerCase()) return id;
    if (normalizeLookupName(id) === needle || normalizeLookupName(def.name) === needle) return id;
  }
  return null;
}

function parseCommandNumber(raw: string): number | null {
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function playerHasCardCopy(cardId: string): boolean {
  return (
    state.player.hand.includes(cardId) ||
    state.player.discardPile.includes(cardId) ||
    state.player.drawPile.includes(cardId) ||
    state.player.equipped === cardId
  );
}

function openCommandWindow(): void {
  commandWindow.classList.add("is-open");
  commandWindow.setAttribute("aria-hidden", "false");
  commandFeedback.textContent = "";
  requestAnimationFrame(() => commandInput.focus());
}

function closeCommandWindow(): void {
  commandWindow.classList.remove("is-open");
  commandWindow.setAttribute("aria-hidden", "true");
  commandInput.blur();
}

function runCommandLine(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Enter a command.";

  const [verbRaw, ...args] = trimmed.split(/\s+/);
  const verb = verbRaw?.toLowerCase();

  if (verb === "set") {
    if (args.length < 2) return "Usage: Set [variable] [number]";
    const value = parseCommandNumber(args[args.length - 1]!);
    if (value === null) return "Set command needs a whole number.";
    const variableText = args.slice(0, -1).join(" ");
    const variable = COMMAND_VARIABLES[normalizeLookupName(variableText)];
    if (!variable) return `Unknown variable: ${variableText}`;
    apply({ type: "DEV_SET_VARIABLE", variable, value });
    return `Set ${variableText} to ${value}.`;
  }

  if (verb === "card") {
    if (args.length < 1) return "Usage: Card [card name] [add|remove?]";
    const maybeAction = args[args.length - 1]!.toLowerCase();
    const hasAction = maybeAction === "add" || maybeAction === "remove";
    const action = hasAction ? (maybeAction as "add" | "remove") : "add";
    const cardName = hasAction ? args.slice(0, -1).join(" ") : args.join(" ");
    if (!cardName) return "Usage: Card [card name] [add|remove?]";
    const cardId = findNamedId(state.cardDefs, cardName);
    if (!cardId) return `Unknown card: ${cardName}`;
    if (action === "remove" && !playerHasCardCopy(cardId)) {
      return `You do not have ${state.cardDefs.get(cardId)?.name ?? cardId}.`;
    }
    apply({ type: "DEV_CARD", cardId, action });
    return `${action === "add" ? "Added" : "Removed"} ${state.cardDefs.get(cardId)?.name ?? cardId}.`;
  }

  if (verb === "item") {
    if (args.length < 1) return "Usage: Item [item name] [quantity?]";
    let quantity = 1;
    let nameArgs = args;
    const maybeQty = parseCommandNumber(args[args.length - 1]!);
    if (maybeQty !== null && args.length >= 2) {
      quantity = maybeQty;
      nameArgs = args.slice(0, -1);
    }
    if (quantity < 1) return "Item quantity must be at least 1.";
    const itemText = nameArgs.join(" ");
    const item = COMMAND_ITEMS[normalizeLookupName(itemText)];
    if (!item) {
      return `Unknown item: ${itemText}. Try bread, herb, cheese, gold, Flame of Destruction, Magic Tome, or Gem of Strength.`;
    }
    apply({ type: "DEV_ITEM", item: item.item, gemId: item.gemId, quantity });
    const label = item.label;
    return `Added ${quantity} ${label}.`;
  }

  if (verb === "deck") {
    if (args.length !== 1) return "Usage: Deck [clear|reshuffle|reset]";
    const action = args[0]!.toLowerCase();
    if (action !== "clear" && action !== "reshuffle" && action !== "reset") {
      return `Unknown deck action "${args[0]}". Use clear, reshuffle, or reset.`;
    }
    apply({ type: "DEV_DECK", action });
    if (action === "clear") return "Cleared your deck.";
    if (action === "reset") return "Replaced your deck with a new starting deck.";
    return "Reshuffled your deck.";
  }

  if (verb === "dungeon") {
    if (args.length < 1) return "Usage: Dungeon [card name]";
    const cardName = args.join(" ");
    const cardId = findNamedId(state.dungeonCardDefs, cardName);
    if (!cardId) return `Unknown dungeon card: ${cardName}`;
    apply({ type: "DEV_DUNGEON_TOP", cardId });
    return `Placed ${state.dungeonCardDefs.get(cardId)?.name ?? cardId} on top.`;
  }

  if (verb === "summon") {
    if (args.length < 1) return "Usage: Summon [monster name] [level (optional)]";
    const maybeLevel = parseCommandNumber(args[args.length - 1]!);
    const hasExplicitLevel = maybeLevel !== null && args.length >= 2;
    const monsterName = hasExplicitLevel ? args.slice(0, -1).join(" ") : args.join(" ");
    const monsterId = findNamedId(state.monsterDefs as ReadonlyMap<string, { name: string }>, monsterName);
    if (!monsterId) return `Unknown monster: ${monsterName}`;
    const defaultLevel = monsterId === "elite_skeleton" ? state.danger + 1 : state.danger;
    const level = hasExplicitLevel ? maybeLevel! : defaultLevel;
    apply({ type: "DEV_SUMMON", defId: monsterId, level });
    return `Summoned ${state.monsterDefs.get(monsterId)?.name ?? monsterId} at level ${level}.`;
  }

  if (verb === "floor") {
    if (args.length < 1) return "Usage: Floor [floor number]";
    const depth = parseCommandNumber(args[0]!);
    if (depth === null) return "Floor command needs a whole number.";
    if (depth < 1) return "Floor number must be at least 1.";
    apply({ type: "DEV_GOTO_FLOOR", depth });
    return `Jumped to floor ${depth}.`;
  }

  if (verb === "theme") {
    if (args.length < 1) {
      return "Usage: Theme [Normal|Overgrown|Damp|Brownstone]";
    }
    const key = normalizeLookupName(args.join(" "));
    const themes: Record<string, FloorTheme> = {
      normal: "normal",
      overgrown: "overgrown",
      damp: "damp",
      brownstone: "brownstone",
      "brownstone tunnels": "brownstone",
      tunnels: "brownstone",
    };
    const theme = themes[key];
    if (!theme) return `Unknown theme "${args.join(" ")}". Use Normal, Overgrown, Damp, or Brownstone.`;
    apply({ type: "DEV_SET_THEME", theme });
    return `Regenerated this floor as ${theme}.`;
  }

  if (verb === "graphics") {
    if (args.length < 1) return "Usage: Graphics [pixel|boxes]";
    const mode = args[0]!.toLowerCase();
    if (mode === "pixel" || mode === "art" || mode === "on") {
      setPixelArtEnabled(true);
      return "Graphics: pixel art on.";
    }
    if (mode === "boxes" || mode === "box" || mode === "off") {
      setPixelArtEnabled(false);
      return "Graphics: box sprites on.";
    }
    return `Unknown graphics mode "${args[0]}". Use pixel or boxes.`;
  }

  if (verb === "chance") {
    if (args.length < 1) {
      return "Usage: Chance [Highest|Lowest|Normal] [Player only: true or false]";
    }
    const modeKey = args[0]!.toLowerCase();
    const modes: Record<string, "highest" | "lowest" | "normal"> = {
      highest: "highest",
      lowest: "lowest",
      normal: "normal",
    };
    const mode = modes[modeKey];
    if (!mode) return `Unknown Chance mode "${args[0]}". Use Highest, Lowest, or Normal.`;
    let playerOnly = false;
    if (args.length >= 2) {
      const b = args[1]!.toLowerCase();
      if (b !== "true" && b !== "false") {
        return "Optional second argument must be true or false (player rolls only).";
      }
      playerOnly = b === "true";
    }
    apply({ type: "DEV_CHANCE", mode, playerOnly });
    return `Chance set to ${mode}${playerOnly ? " (player rolls only)" : ""}.`;
  }

  if (verb === "editor") {
    if (args.length !== 1) return "Usage: Editor [true|false]";
    const value = args[0]!.toLowerCase();
    if (value !== "true" && value !== "false") {
      return `Unknown Editor value "${args[0]}". Use true or false.`;
    }
    const enabled = value === "true";
    apply({ type: "DEV_EDITOR", enabled });
    return `Editor mode ${enabled ? "enabled" : "disabled"}.`;
  }

  return "Unknown command. Try Set, Card, Item, Deck, Dungeon, Floor, Theme, Graphics, Summon, Chance, or Editor.";
}

function openPileInspector(which: "deck" | "discard" | "dungeon"): void {
  if (choiceModalBlocksPlay(state)) return;
  if (which === "dungeon" && !state.editorMode) return;
  pileInspectorBody.replaceChildren();

  if (which === "dungeon") {
    pileInspectorTitle.textContent = "Dungeon deck";
    pileInspectorNote.textContent = "Top to bottom — card #1 is next.";
    if (state.dungeonDraw.length === 0) {
      const p = document.createElement("p");
      p.className = "pile-inspector-empty";
      p.textContent = "Empty.";
      pileInspectorBody.appendChild(p);
    } else {
      state.dungeonDraw.forEach((id, index) => {
        const row = document.createElement("div");
        row.className = "pile-row";
        const name = document.createElement("span");
        name.className = "pile-row-name";
        name.textContent = state.dungeonCardDefs.get(id)?.name ?? id;
        const position = document.createElement("span");
        position.className = "pile-row-count";
        position.textContent = index === 0 ? "#1 · next" : `#${index + 1}`;
        row.appendChild(name);
        row.appendChild(position);
        pileInspectorBody.appendChild(row);
      });
    }
    pileInspector.classList.add("is-open");
    pileInspector.setAttribute("aria-hidden", "false");
    return;
  }

  const pile = which === "deck" ? state.player.drawPile : state.player.discardPile;
  pileInspectorTitle.textContent = which === "deck" ? "Your deck" : "Discard pile";
  pileInspectorNote.textContent = "Counts only — order is hidden.";
  const counts = countIds(pile);
  if (counts.size === 0) {
    const p = document.createElement("p");
    p.className = "pile-inspector-empty";
    p.textContent = "Empty.";
    pileInspectorBody.appendChild(p);
  } else {
    const rows = [...counts.entries()].sort((a, b) => {
      const na = state.cardDefs.get(a[0])?.name ?? a[0];
      const nb = state.cardDefs.get(b[0])?.name ?? b[0];
      return na.localeCompare(nb);
    });
    for (const [id, n] of rows) {
      const row = document.createElement("div");
      row.className = "pile-row";
      const name = document.createElement("span");
      name.className = "pile-row-name";
      name.textContent = state.cardDefs.get(id)?.name ?? id;
      const cnt = document.createElement("span");
      cnt.className = "pile-row-count";
      cnt.textContent = `×${n}`;
      row.appendChild(name);
      row.appendChild(cnt);
      pileInspectorBody.appendChild(row);
    }
  }
  pileInspector.classList.add("is-open");
  pileInspector.setAttribute("aria-hidden", "false");
}

function closePileInspector(): void {
  pileInspector.classList.remove("is-open");
  pileInspector.setAttribute("aria-hidden", "true");
}

function formatTilePref(pref: AtbmbTilePref): string {
  switch (pref.kind) {
    case "adjacent_to_player":
      return `Adjacent to player (${pref.metric})`;
    case "distance_to_player":
      return `Distance to player ${pref.min}–${pref.max} (${pref.metric})`;
    case "plus_from_player":
      return `Cardinal + from player (${pref.min}–${pref.max})`;
    case "queen_line_from_player": {
      const clear = pref.requireClear === false ? "any path" : "clear path";
      const minC = pref.minChebyshev ?? 1;
      const maxParts: string[] = [`≥${minC}`];
      if (pref.maxChebyshev !== undefined) maxParts.push(`≤${pref.maxChebyshev} Chebyshev`);
      if (pref.maxManhattan !== undefined) maxParts.push(`≤${pref.maxManhattan} Manhattan`);
      return `Queen-line from player (${maxParts.join(", ")}, ${clear})`;
    }
    case "los_in_radius_from_player": {
      const min = pref.min ?? 1;
      const parts = [`${min}–${pref.max} ${pref.metric}`, "LOS"];
      if (pref.minManhattan !== undefined) parts.push(`Manhattan ≥${pref.minManhattan}`);
      return `Radius from player (${parts.join(", ")})`;
    }
    case "vine_whip_range_to_player":
      return `Vine whip range (Manhattan ≤${pref.maxManhattan ?? 4}, queen LOS)`;
    case "adjacent_to_fire":
      return "Adjacent to burning creature";
    case "diagonal_adjacent_to_player":
      return "Diagonally adjacent to player";
    case "slime_leap_path":
      return "Slime leap path";
    case "pending_collapse":
      return "Pending collapse";
    case "pending_targeted_collapse":
      return "Targeted collapse";
    case "flooding_room":
      return "Flooding room";
    case "water":
      return "Water";
    case "floor":
      return "Floor";
    case "not_water":
      return "Not water";
    case "same_room_as_player":
      return "Same room as player";
    case "clear_queen_ray_to_player":
      return "Clear queen-ray to player";
    case "harming_cloud":
      return "Harming cloud";
    default:
      return "Unknown pref";
  }
}

function formatWhen(when: AtbmbWhen | undefined): string {
  if (!when) return "Always";
  const parts: string[] = [];
  if (when.onFavoredTile === true) parts.push("on favored tile");
  if (when.onFavoredTile === false) parts.push("not on favored tile");
  if (when.onBadTile === true) parts.push("on disliked tile");
  if (when.onBadTile === false) parts.push("not on disliked tile");
  if (when.inAttackRange === true) parts.push("in attack range");
  if (when.inAttackRange === false) parts.push("not in attack range");
  if (when.clearQueenRayToPlayer === true) parts.push("clear queen-ray");
  if (when.clearQueenRayToPlayer === false) parts.push("no clear queen-ray");
  if (when.clearLosToPlayer === true) parts.push("clear LOS");
  if (when.clearLosToPlayer === false) parts.push("no clear LOS");
  if (when.canWeaponMelee === true) parts.push("can weapon-melee");
  if (when.canWeaponMelee === false) parts.push("cannot weapon-melee");
  if (when.inUndiscoveredNonCorridorRoom === true) parts.push("undiscovered room");
  if (when.inUndiscoveredNonCorridorRoom === false) parts.push("not undiscovered room");
  if (when.hpFractionBelow !== undefined) parts.push(`HP < ${Math.round(when.hpFractionBelow * 100)}%`);
  if (when.hpFractionAbove !== undefined) parts.push(`HP > ${Math.round(when.hpFractionAbove * 100)}%`);
  if (when.flagTrue) parts.push(`flag ${when.flagTrue}`);
  if (when.flagFalse) parts.push(`flag !${when.flagFalse}`);
  return parts.length ? parts.join(", ") : "Always";
}

function formatPrefList(label: string, prefs: AtbmbTilePref[] | undefined): HTMLElement {
  const section = document.createElement("div");
  section.className = "monster-brain-section";
  const h = document.createElement("h3");
  h.textContent = label;
  section.appendChild(h);
  if (!prefs?.length) {
    const p = document.createElement("p");
    p.className = "monster-brain-muted";
    p.textContent = "None";
    section.appendChild(p);
    return section;
  }
  const ul = document.createElement("ul");
  for (const pref of prefs) {
    const li = document.createElement("li");
    li.textContent = formatTilePref(pref);
    ul.appendChild(li);
  }
  section.appendChild(ul);
  return section;
}

function closeMonsterBrain(): void {
  brainInspectMonsterId = null;
  monsterBrainEl.hidden = true;
  monsterBrainEl.setAttribute("aria-hidden", "true");
  grid?.setBrainInspectMonsterId(null);
}

function openMonsterBrain(monsterId: string): void {
  brainInspectMonsterId = monsterId;
  renderAll();
}

function renderMonsterBrain(): void {
  if (!brainInspectMonsterId || !state.editorMode) {
    brainInspectMonsterId = null;
    monsterBrainEl.hidden = true;
    monsterBrainEl.setAttribute("aria-hidden", "true");
    grid?.setBrainInspectMonsterId(null);
    return;
  }
  const mon = state.monsters.find((m) => m.id === brainInspectMonsterId && m.hp > 0);
  if (!mon) {
    brainInspectMonsterId = null;
    monsterBrainEl.hidden = true;
    monsterBrainEl.setAttribute("aria-hidden", "true");
    grid?.setBrainInspectMonsterId(null);
    return;
  }

  grid?.setBrainInspectMonsterId(mon.id);

  const def = state.monsterDefs.get(mon.defId);
  const name = def?.name ?? mon.defId;
  monsterBrainTitle.textContent = name;
  monsterBrainSubtitle.textContent = `${mon.defId} · HP ${mon.hp} · Lv ${mon.level}`;
  monsterBrainBody.replaceChildren();

  const ai = def?.ai;
  if (!hasAtbmb(ai)) {
    const section = document.createElement("div");
    section.className = "monster-brain-section";
    const h = document.createElement("h3");
    h.textContent = "AI";
    const p = document.createElement("p");
    p.className = "monster-brain-muted";
    p.textContent = "Legacy scripted AI — no ATBMB profile.";
    section.appendChild(h);
    section.appendChild(p);
    monsterBrainBody.appendChild(section);
    monsterBrainEl.hidden = false;
    monsterBrainEl.setAttribute("aria-hidden", "false");
    return;
  }

  const stateId = mon.aiStateId ?? ai.initialState;
  const stateDef = ai.states.find((st) => st.id === stateId) ?? ai.states[0];
  const prefs = stateDef ? resolveTilePrefs(stateDef, mon) : undefined;
  const player = { x: state.player.x, y: state.player.y };
  const monPos = { x: mon.x, y: mon.y };

  const stateSec = document.createElement("div");
  stateSec.className = "monster-brain-section";
  {
    const h = document.createElement("h3");
    h.textContent = "State";
    stateSec.appendChild(h);
    const strong = document.createElement("div");
    const nameEl = document.createElement("strong");
    nameEl.textContent = stateId;
    strong.appendChild(nameEl);
    stateSec.appendChild(strong);
    const meta = document.createElement("div");
    const range = stateDef?.attackRange
      ? `${stateDef.attackRange.metric} ≤ ${stateDef.attackRange.max}`
      : "—";
    const weapon = mon.skeletonWeapon ? ` · Weapon: ${mon.skeletonWeapon}` : "";
    meta.textContent = `Move: ${ai.moveStyle} · Attack range: ${range}${weapon}`;
    stateSec.appendChild(meta);
    const flags = document.createElement("div");
    flags.className = "monster-brain-muted";
    const onFav = prefs ? isOnFavoredTile(state, mon, prefs) : false;
    const onBad = prefs ? isOnBadTile(state, mon, prefs) : false;
    const inRange = stateDef?.attackRange
      ? inAttackRange(monPos, player, stateDef.attackRange)
      : false;
    flags.textContent = `On favored: ${onFav ? "yes" : "no"} · On disliked: ${onBad ? "yes" : "no"} · In range: ${inRange ? "yes" : "no"}`;
    stateSec.appendChild(flags);
    if (mon.leapDir) {
      const leap = document.createElement("div");
      leap.className = "monster-brain-muted";
      const dx = mon.leapDir.x;
      const dy = mon.leapDir.y;
      const facing =
        dx === 1 ? "east" : dx === -1 ? "west" : dy === 1 ? "south" : dy === -1 ? "north" : "?";
      leap.textContent = `Leap telegraph: ${facing}`;
      stateSec.appendChild(leap);
    }
    if (mon.defId === "elite_skeleton" && mon.eliteTeleported) {
      const concerned = document.createElement("div");
      concerned.className = "monster-brain-muted";
      concerned.textContent = "Concerned (teleported): spear option has no +2 penalty.";
      stateSec.appendChild(concerned);
    }
  }
  monsterBrainBody.appendChild(stateSec);

  if (mon.defId === "elite_skeleton" && stateId === "attack") {
    const simSec = document.createElement("div");
    simSec.className = "monster-brain-section";
    const simH = document.createElement("h3");
    simH.textContent = "Attack simulation";
    simSec.appendChild(simH);

    const orthoAdjacent =
      manhattan({ x: mon.x, y: mon.y }, { x: state.player.x, y: state.player.y }) === 1;
    if (orthoAdjacent) {
      const p = document.createElement("p");
      p.textContent = "Orthogonally adjacent — axe attack, then Retreat.";
      simSec.appendChild(p);
    } else {
      const evals = evaluateEliteSkeletonOptions(state, mon, {
        tilePassable: monsterTilePassable,
        occupancy: movementOcc,
      });
      const table = document.createElement("table");
      table.className = "monster-brain-table";
      const thead = document.createElement("thead");
      thead.innerHTML =
        "<tr><th>Option</th><th>Weapon</th><th>Steps</th><th>Penalty</th><th>Weight</th><th>Goals</th></tr>";
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const ev of evals) {
        const tr = document.createElement("tr");
        if (ev.chosen) tr.className = "monster-brain-chosen";
        const goalText =
          ev.goals.length === 0
            ? "—"
            : ev.plan?.goal
              ? `(${ev.plan.goal.x}, ${ev.plan.goal.y}) +${ev.goals.length - 1} more`
              : `${ev.goals.length} tile(s)`;
        tr.innerHTML = `<td>${ev.id}${ev.chosen ? " ✓" : ""}</td><td>${ev.weapon}</td><td>${ev.pathSteps === Infinity ? "∞" : ev.pathSteps}</td><td>+${ev.penalty}</td><td>${ev.weighted === Infinity ? "∞" : ev.weighted}</td><td>${goalText}</td>`;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      simSec.appendChild(table);
      const legend = document.createElement("p");
      legend.className = "monster-brain-muted";
      legend.textContent =
        "Tie-break: scimitar → sword → spear. Green / yellow / blue on grid = option goal tiles.";
      simSec.appendChild(legend);
    }
    monsterBrainBody.appendChild(simSec);
  }

  if (prefs) {
    monsterBrainBody.appendChild(formatPrefList("Favored tiles", prefs.favored));
    monsterBrainBody.appendChild(formatPrefList("Secondary tiles", prefs.secondary));
    monsterBrainBody.appendChild(formatPrefList("Disliked tiles", prefs.bad));

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
    const pathSec = document.createElement("div");
    pathSec.className = "monster-brain-section";
    const pathH = document.createElement("h3");
    pathH.textContent = "Planned path";
    pathSec.appendChild(pathH);
    const pathP = document.createElement("p");
    pathP.className = "monster-brain-muted";
    if (!foundMove) {
      pathP.textContent = "No move/swim action in the current decision tree.";
    } else if (!plan || plan.path.length < 2) {
      pathP.textContent =
        plan?.path.length === 1
          ? `Already at goal (${plan.goal.x}, ${plan.goal.y}) · seek: ${seek}`
          : `No path · seek: ${seek}`;
    } else {
      const steps = plan.path.length - 1;
      pathP.textContent = `${steps} step${steps === 1 ? "" : "s"} → (${plan.goal.x}, ${plan.goal.y}) · seek: ${seek}`;
    }
    pathSec.appendChild(pathP);
    monsterBrainBody.appendChild(pathSec);
  }

  if (ai.maxActionsPerTurn !== undefined) {
    const cap = document.createElement("div");
    cap.className = "monster-brain-section";
    const h = document.createElement("h3");
    h.textContent = "Action budget";
    const p = document.createElement("p");
    p.textContent = `Max ${ai.maxActionsPerTurn} ability use(s) per turn`;
    cap.appendChild(h);
    cap.appendChild(p);
    monsterBrainBody.appendChild(cap);
  }

  const abilSec = document.createElement("div");
  abilSec.className = "monster-brain-section";
  {
    const h = document.createElement("h3");
    h.textContent = "Abilities";
    abilSec.appendChild(h);
    const ul = document.createElement("ul");
    for (const a of ai.abilities) {
      const li = document.createElement("li");
      const parts = [`${a.id} (${a.kind})`];
      if (a.params?.steps !== undefined) parts.push(`${a.params.steps} step(s)`);
      if (a.params?.minDamage !== undefined) {
        parts.push(`dmg ${a.params.minDamage}–${a.params.maxDamage ?? a.params.minDamage}`);
      }
      li.textContent = parts.join(" · ");
      ul.appendChild(li);
    }
    abilSec.appendChild(ul);
  }
  monsterBrainBody.appendChild(abilSec);

  if (stateDef) {
    const decideSec = document.createElement("div");
    decideSec.className = "monster-brain-section";
    const h = document.createElement("h3");
    h.textContent = "Decision tree";
    decideSec.appendChild(h);
    for (const rule of stateDef.decide) {
      const ruleEl = document.createElement("div");
      ruleEl.className = "monster-brain-rule";
      const title = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = rule.id ?? "rule";
      title.appendChild(strong);
      title.appendChild(document.createTextNode(" · "));
      const whenSpan = document.createElement("span");
      whenSpan.className = "monster-brain-muted";
      whenSpan.textContent = `when: ${formatWhen(rule.when)}`;
      title.appendChild(whenSpan);
      ruleEl.appendChild(title);
      const actions = document.createElement("ul");
      for (const act of rule.actions) {
        const li = document.createElement("li");
        li.textContent =
          act.ability +
          (act.seek ? ` → seek ${act.seek}` : "") +
          (act.optional ? " (optional)" : "") +
          (rule.shuffleActions ? " [shuffled]" : "");
        actions.appendChild(li);
      }
      ruleEl.appendChild(actions);
      decideSec.appendChild(ruleEl);
    }
    monsterBrainBody.appendChild(decideSec);
  }

  monsterBrainEl.hidden = false;
  monsterBrainEl.setAttribute("aria-hidden", "false");
}

function buildOfferCardArticle(cardId: string): HTMLElement {
  const def = state.cardDefs.get(cardId);
  const { icon, accent } = cardChrome(cardId);
  const rarity = def?.rarity ?? "Basic";
  const card = document.createElement("article");
  card.className = `playing-card rarity-${rarity}`;

  const rail = document.createElement("div");
  rail.className = "card-rail";
  rail.style.color = accent;

  const header = document.createElement("div");
  header.className = "card-header";
  const ic = document.createElement("div");
  ic.className = "card-icon";
  ic.style.background = accent;
  ic.textContent = icon;
  const titleWrap = document.createElement("div");
  const h = document.createElement("h2");
  h.className = "card-name";
  h.textContent = def?.name ?? cardId;
  const tag = document.createElement("p");
  tag.className = "card-rarity-tag";
  tag.textContent = rarity;
  titleWrap.appendChild(h);
  titleWrap.appendChild(tag);
  header.appendChild(ic);
  header.appendChild(titleWrap);

  const body = document.createElement("div");
  body.className = "card-body";
  body.textContent = def?.description ?? "";
  const typeRow = createCardTypesElement(def);

  card.appendChild(rail);
  card.appendChild(header);
  card.appendChild(body);
  if (typeRow) card.appendChild(typeRow);
  return card;
}

function syncPedestalOfferModal(): void {
  if (!state.pedestalOffer) {
    pedestalOfferEl.classList.remove("is-open");
    pedestalOfferEl.setAttribute("aria-hidden", "true");
    return;
  }
  pedestalOfferEl.classList.add("is-open");
  pedestalOfferEl.setAttribute("aria-hidden", "false");
  pedestalOfferCards.replaceChildren();
  state.pedestalOffer.cards.forEach((cardId, idx) => {
    const slot = document.createElement("div");
    slot.className = "chest-offer-slot";
    slot.appendChild(buildOfferCardArticle(cardId));
    const take = document.createElement("button");
    take.type = "button";
    take.className = "primary";
    take.textContent = "Take this card";
    take.addEventListener("click", () => apply({ type: "RESOLVE_PEDESTAL_PICK", pickIndex: idx }));
    slot.appendChild(take);
    pedestalOfferCards.appendChild(slot);
  });
}

function syncDeckDestroyModal(): void {
  if (!state.deckDestroyPending) {
    deckDestroyOfferEl.classList.remove("is-open");
    deckDestroyOfferEl.setAttribute("aria-hidden", "true");
    return;
  }
  deckDestroyOfferEl.classList.add("is-open");
  deckDestroyOfferEl.setAttribute("aria-hidden", "false");
  deckDestroyBody.replaceChildren();
  const merged = [...state.player.drawPile, ...state.player.discardPile, ...state.player.hand];
  const counts = countIds(merged);
  const rows = [...counts.entries()].sort((a, b) => {
    const na = state.cardDefs.get(a[0])?.name ?? a[0];
    const nb = state.cardDefs.get(b[0])?.name ?? b[0];
    return na.localeCompare(nb);
  });
  for (const [id, n] of rows) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "deck-destroy-option";
    const nm = state.cardDefs.get(id)?.name ?? id;
    b.textContent = `${nm} ×${n}`;
    b.addEventListener("click", () => apply({ type: "RESOLVE_DECK_DESTROY", cardId: id }));
    deckDestroyBody.appendChild(b);
  }
}

function syncFlameDestroyModal(): void {
  if (!state.flameDestroyPending) {
    flameDestroyOfferEl.classList.remove("is-open");
    flameDestroyOfferEl.setAttribute("aria-hidden", "true");
    return;
  }
  flameDestroyOfferEl.classList.add("is-open");
  flameDestroyOfferEl.setAttribute("aria-hidden", "false");
  flameDestroyBody.replaceChildren();
  const counts = countIds(state.player.discardPile);
  const rows = [...counts.entries()].sort((a, b) => {
    const na = state.cardDefs.get(a[0])?.name ?? a[0];
    const nb = state.cardDefs.get(b[0])?.name ?? b[0];
    return na.localeCompare(nb);
  });
  for (const [id, n] of rows) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "deck-destroy-option";
    const nm = state.cardDefs.get(id)?.name ?? id;
    b.textContent = n > 1 ? `${nm} ×${n}` : nm;
    b.addEventListener("click", () => apply({ type: "RESOLVE_FLAME_DESTROY", cardId: id }));
    flameDestroyBody.appendChild(b);
  }
}

function syncBindTomeModal(): void {
  if (!state.bindTomePending) {
    bindTomeOfferEl.classList.remove("is-open");
    bindTomeOfferEl.setAttribute("aria-hidden", "true");
    return;
  }
  bindTomeOfferEl.classList.add("is-open");
  bindTomeOfferEl.setAttribute("aria-hidden", "false");
  bindTomeBody.replaceChildren();
  state.player.hand.forEach((cardId, idx) => {
    const def = state.cardDefs.get(cardId);
    if (!def?.types.includes("Magic")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "deck-destroy-option";
    b.textContent = def.name;
    b.addEventListener("click", () => apply({ type: "RESOLVE_BIND_TOME", handIndex: idx }));
    bindTomeBody.appendChild(b);
  });
}

function syncChestOfferModal(): void {
  if (!state.chestOffer) {
    chestOfferEl.classList.remove("is-open");
    chestOfferEl.setAttribute("aria-hidden", "true");
    return;
  }
  chestOfferEl.classList.add("is-open");
  chestOfferEl.setAttribute("aria-hidden", "false");
  chestOfferCards.replaceChildren();
  state.chestOffer.cards.forEach((cardId, idx) => {
    const slot = document.createElement("div");
    slot.className = "chest-offer-slot";
    slot.appendChild(buildOfferCardArticle(cardId));
    const take = document.createElement("button");
    take.type = "button";
    take.className = "primary";
    take.textContent = "Take this card";
    take.addEventListener("click", () => apply({ type: "RESOLVE_CHEST_OFFER", pickIndex: idx }));
    slot.appendChild(take);
    chestOfferCards.appendChild(slot);
  });
}

function syncDeckBuilderModal(): void {
  const offer = state.deckBuilderOffer;
  if (!offer) {
    deckBuilderOfferEl.classList.remove("is-open");
    deckBuilderOfferEl.setAttribute("aria-hidden", "true");
    deckBuilderTypeGrid.hidden = true;
    deckBuilderTypeGrid.replaceChildren();
    return;
  }
  deckBuilderOfferEl.classList.add("is-open");
  deckBuilderOfferEl.setAttribute("aria-hidden", "false");
  deckBuilderCards.replaceChildren();
  if (offer.step === "choose_type") {
    deckBuilderNote.textContent =
      "Choose a card type. You will be offered three random cards of that type — pick one to add to your discard pile.";
    deckBuilderTypeGrid.hidden = false;
    deckBuilderTypeGrid.replaceChildren();
    deckBuilderSkip.textContent = "Skip (no card)";
    deckBuilderSkip.onclick = () => apply({ type: "RESOLVE_DECK_BUILDER_CANCEL" });
    for (const ct of CARD_TYPE_ORDER) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "deck-builder-type-btn";
      b.textContent = ct;
      b.addEventListener("click", () => apply({ type: "RESOLVE_DECK_BUILDER_TYPE", cardType: ct }));
      deckBuilderTypeGrid.appendChild(b);
    }
  } else {
    deckBuilderNote.textContent = `Choose one ${offer.cardType} card to add to your deck (discard pile), or take none.`;
    deckBuilderTypeGrid.hidden = true;
    deckBuilderTypeGrid.replaceChildren();
    deckBuilderSkip.textContent = "Take none";
    deckBuilderSkip.onclick = () => apply({ type: "RESOLVE_DECK_BUILDER_PICK", pickIndex: null });
    offer.options.forEach((cardId, idx) => {
      const slot = document.createElement("div");
      slot.className = "chest-offer-slot";
      slot.appendChild(buildOfferCardArticle(cardId));
      const take = document.createElement("button");
      take.type = "button";
      take.className = "primary";
      take.textContent = "Add to deck";
      take.addEventListener("click", () =>
        apply({ type: "RESOLVE_DECK_BUILDER_PICK", pickIndex: idx }),
      );
      slot.appendChild(take);
      deckBuilderCards.appendChild(slot);
    });
  }
}

function syncCardPickupModal(): void {
  const q = state.cardPickupOffer?.queue;
  const cardId =
    q &&
    q.length > 0 &&
    !state.chestOffer &&
    !state.pedestalOffer &&
    !state.deckDestroyPending &&
    !state.flameDestroyPending &&
    !state.bindTomePending &&
    !state.deckBuilderOffer
      ? q[0]!
      : null;
  if (!cardId) {
    cardPickupOfferEl.classList.remove("is-open");
    cardPickupOfferEl.setAttribute("aria-hidden", "true");
    return;
  }
  cardPickupOfferEl.classList.add("is-open");
  cardPickupOfferEl.setAttribute("aria-hidden", "false");
  cardPickupBody.replaceChildren();
  cardPickupBody.appendChild(buildOfferCardArticle(cardId));
}

function dualWieldDiscardChoices(s: GameState): string[] {
  if (s.dualWieldStage?.step !== "choose_discard_attack") return [];
  const first = s.dualWieldStage.firstCardId;
  return [...new Set(s.player.discardPile)].filter((id) => {
    const def = s.cardDefs.get(id);
    return (
      id !== first &&
      !!def?.types.includes("Attack") &&
      !!def.tags?.includes("physical attack") &&
      !!def.tags?.includes("melee")
    );
  });
}

function syncDualWieldModal(): void {
  if (state.dualWieldStage?.step !== "choose_discard_attack") {
    dualWieldOfferEl.classList.remove("is-open");
    dualWieldOfferEl.setAttribute("aria-hidden", "true");
    dualWieldCards.replaceChildren();
    return;
  }
  dualWieldOfferEl.classList.add("is-open");
  dualWieldOfferEl.setAttribute("aria-hidden", "false");
  dualWieldCards.replaceChildren();
  for (const id of dualWieldDiscardChoices(state)) {
    const slot = document.createElement("div");
    slot.className = "chest-offer-slot";
    slot.appendChild(buildOfferCardArticle(id));
    const play = document.createElement("button");
    play.type = "button";
    play.className = "primary";
    play.textContent = "Play now";
    play.addEventListener("click", () =>
      apply({ type: "RESOLVE_DUAL_WIELD_DISCARD", cardId: id }),
    );
    slot.appendChild(play);
    dualWieldCards.appendChild(slot);
  }
}

function syncShiftyMerchantUi(): void {
  const ms = state.merchantState;
  const showDialogue = merchantDialogueOpen(state);
  const showShop = merchantShopOpen(state);
  const isObamly = ms?.merchantId === "obamly";
  const isSennis = ms?.merchantId === "sennis";
  shiftyDialogueBox.classList.toggle("merchant-obamly", !!isObamly);
  shiftyDialogueBox.classList.toggle("merchant-sennis", !!isSennis);

  if (!showDialogue || !ms) {
    shiftyDialogueEl.classList.remove("is-open");
    shiftyDialogueEl.setAttribute("aria-hidden", "true");
  } else {
    shiftyDialogueEl.classList.add("is-open");
    shiftyDialogueEl.setAttribute("aria-hidden", "false");
    shiftyDialogueText.textContent = ms.dialogueText;
    shiftyDialogueChoices.replaceChildren();
    for (const choice of ms.dialogueChoices) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = choice.label;
      b.addEventListener("click", () =>
        apply({ type: "RESOLVE_MERCHANT_DIALOGUE", choiceId: choice.id }),
      );
      shiftyDialogueChoices.appendChild(b);
    }
  }

  if (!showShop || !ms) {
    shiftyShopEl.classList.remove("is-open");
    shiftyShopEl.setAttribute("aria-hidden", "true");
    shiftyShopTomes.hidden = true;
  } else {
    shiftyShopEl.classList.add("is-open");
    shiftyShopEl.setAttribute("aria-hidden", "false");
    if (isSennis) {
      shiftyShopTitle.textContent = "Sennis's wares";
      shiftyShopNote.textContent =
        "Magic goods from the Mage Guild. Discuss Magic Tomes below.";
    } else if (isObamly) {
      shiftyShopTitle.textContent = "Mr. Obamly's wares";
      shiftyShopNote.textContent = "Six consumables and two cards. Prices stay put.";
    } else {
      shiftyShopTitle.textContent = "Shifty's wares";
      shiftyShopNote.textContent =
        "Three cards and three consumables. Prices shift each visit.";
    }
    shiftyShopTomes.hidden = !isSennis;
    shiftyShopListings.replaceChildren();
    for (const listing of ms.listings) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "shifty-shop-item";
      const name = document.createElement("span");
      name.className = "shifty-shop-item-name";
      name.textContent = listing.name;
      const meta = document.createElement("span");
      meta.className = "shifty-shop-item-meta";
      meta.textContent = `${listing.price}G · stock ${listing.stock}`;
      b.appendChild(name);
      b.appendChild(meta);
      b.addEventListener("click", () =>
        apply({ type: "SELECT_MERCHANT_ITEM", listingId: listing.id }),
      );
      shiftyShopListings.appendChild(b);
    }
  }
}

function renderDungeonPiles(): void {
  const n = state.dungeonDraw.length;
  dungeonDeckVisual.classList.toggle("is-inspectable", state.editorMode);
  dungeonDeckVisual.tabIndex = state.editorMode ? 0 : -1;
  dungeonDeckVisual.setAttribute("role", state.editorMode ? "button" : "img");
  dungeonDeckVisual.setAttribute(
    "aria-label",
    state.editorMode ? "Inspect dungeon deck order" : "Face-down dungeon cards",
  );
  dungeonDeckVisual.title = state.editorMode
    ? "Inspect dungeon deck order"
    : "Face-down dungeon cards";
  dungeonDeckVisual.replaceChildren();
  if (n === 0) {
    const empty = document.createElement("div");
    empty.className = "dungeon-deck-empty";
    empty.textContent = "Empty";
    dungeonDeckVisual.appendChild(empty);
  } else {
    const layers = Math.min(4, Math.max(1, n));
    for (let i = 0; i < layers; i++) {
      const back = document.createElement("div");
      back.className = "dungeon-card-back";
      back.style.setProperty("--i", String(i));
      back.textContent = "D";
      dungeonDeckVisual.appendChild(back);
    }
    const badge = document.createElement("span");
    badge.className = "dungeon-deck-count";
    badge.textContent = String(n);
    dungeonDeckVisual.appendChild(badge);
  }

  dungeonDiscardVisual.replaceChildren();
  if (state.dungeonDiscard.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dungeon-card-empty";
    empty.textContent = "No discard";
    dungeonDiscardVisual.appendChild(empty);
  } else {
    const topId = state.dungeonDiscard[state.dungeonDiscard.length - 1]!;
    const def = state.dungeonCardDefs.get(topId);
    const face = document.createElement("div");
    face.className = "dungeon-card-face";
    const title = document.createElement("div");
    title.className = "dcf-title";
    title.textContent = def?.name ?? topId;
    const body = document.createElement("div");
    body.className = "dcf-body";
    body.textContent = def?.description ?? "";
    face.appendChild(title);
    face.appendChild(body);
    dungeonDiscardVisual.appendChild(face);
  }
}

function applyLootIconStyle(el: HTMLElement, id: LootIconId, size = 24): void {
  const css = lootIconCss(id, size);
  el.style.backgroundImage = css.backgroundImage;
  el.style.backgroundSize = css.backgroundSize;
  el.style.backgroundPosition = css.backgroundPosition;
  el.style.width = css.width;
  el.style.height = css.height;
}

type InventorySlot = {
  key: string;
  icon: LootIconId;
  count: number;
  title: string;
  use: () => void;
  canUse: boolean;
  bound?: boolean;
};

function inventorySlots(): InventorySlot[] {
  const blocked =
    state.phase !== "player" || !!state.pending || !!state.tomeCast || choiceModalBlocksPlay(state);
  const full = state.player.hp >= state.player.maxHp;
  const slots: InventorySlot[] = [];
  if (state.player.bread > 0) {
    slots.push({
      key: "bread",
      icon: "loot_bread",
      count: state.player.bread,
      title: "Bread — heal 2 HP (+ Feaster bonus)",
      use: () => apply({ type: "USE_BREAD" }),
      canUse: !blocked && !full,
    });
  }
  if (state.player.herb > 0) {
    slots.push({
      key: "herb",
      icon: "loot_herb",
      count: state.player.herb,
      title: "Healing Herb — restore 1 HP",
      use: () => apply({ type: "USE_HERB" }),
      canUse: !blocked && !full,
    });
  }
  if (state.player.cheese > 0) {
    slots.push({
      key: "cheese",
      icon: "loot_cheese",
      count: state.player.cheese,
      title: "Cheese — restore 3 HP",
      use: () => apply({ type: "USE_CHEESE" }),
      canUse: !blocked && !full,
    });
  }
  if (state.player.stew > 0) {
    slots.push({
      key: "stew",
      icon: "loot_soup",
      count: state.player.stew,
      title: "Obamly's Special Stew — +1 max HP and heal 6 (capped)",
      use: () => apply({ type: "USE_STEW" }),
      canUse: !blocked,
    });
  }
  if (state.player.flameOfDestruction > 0) {
    slots.push({
      key: "flame",
      icon: "loot_fire",
      count: state.player.flameOfDestruction,
      title: "Flame of Destruction — destroy a card in your discard pile",
      use: () => apply({ type: "USE_FLAME_OF_DESTRUCTION" }),
      canUse: !blocked && state.player.discardPile.length > 0,
    });
  }
  if (state.player.unboundTomes > 0) {
    slots.push({
      key: "tome_unbound",
      icon: "loot_tome",
      count: state.player.unboundTomes,
      title: "Unbound Magic Tome — discard a Magic card from hand to bind it (3 charges)",
      use: () => apply({ type: "USE_UNBOUND_TOME" }),
      canUse:
        !blocked &&
        state.player.hand.some((id) => state.cardDefs.get(id)?.types.includes("Magic")),
    });
  }
  for (const tome of state.player.boundTomes) {
    const spellName = state.cardDefs.get(tome.cardId)?.name ?? tome.cardId;
    slots.push({
      key: `tome_bound_${tome.id}`,
      icon: "loot_tome",
      count: tome.charges,
      title: `Bound Tome (${spellName}) — ${tome.charges} charge(s); cast like playing that card`,
      use: () => apply({ type: "USE_BOUND_TOME", tomeId: tome.id }),
      canUse: !blocked && tome.charges > 0,
      bound: true,
    });
  }
  const gemTitles: Record<ShiftyGemId, string> = {
    strength: "Gem of Strength — next physical attack ×1.5",
    speed: "Gem of Speed — next movement doubled",
    luck: "Gem of Luck — Chance Highest this turn",
    cards: "Gem of Cards — draw 2",
    healing: "Gem of Healing — heal 10% max HP",
    defense: "Gem of Defense — +4 defense this turn",
  };
  for (const id of ALL_GEM_IDS) {
    const count = state.player.gems[id] ?? 0;
    if (count <= 0) continue;
    slots.push({
      key: `gem_${id}`,
      icon: gemLootSpriteId(id),
      count,
      title: gemTitles[id],
      use: () => apply({ type: "USE_GEM", gemId: id }),
      canUse: !blocked && (id === "healing" ? !full : true),
    });
  }
  return slots;
}

function renderInventoryGrid(): void {
  inventoryGrid.replaceChildren();
  for (const slot of inventorySlots()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = slot.bound ? "inv-slot inv-slot-bound" : "inv-slot";
    btn.title = slot.title;
    btn.disabled = !slot.canUse;
    const icon = document.createElement("span");
    icon.className = "inv-icon";
    icon.setAttribute("aria-hidden", "true");
    applyLootIconStyle(icon, slot.icon, 24);
    btn.appendChild(icon);
    if (slot.count > 1 || slot.bound) {
      const n = document.createElement("span");
      n.className = "inv-slot-count";
      n.textContent = String(slot.count);
      btn.appendChild(n);
    }
    btn.addEventListener("click", () => {
      if (!slot.canUse) return;
      slot.use();
    });
    inventoryGrid.appendChild(btn);
  }
}

function focusHandZone(): void {
  if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
  handZoneEl.focus({ preventScroll: true });
}

function scrollHandCardIntoView(index: number): void {
  const cards = handEl.querySelectorAll<HTMLElement>(".playing-card");
  cards[index]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function selectHandCard(index: number | null): void {
  selectedHandIndex = index;
  discardMenuOpen = false;
  renderAll();
  if (index !== null) {
    focusHandZone();
    scrollHandCardIntoView(index);
  }
}

function handIndexFromDigitKey(e: KeyboardEvent): number | null {
  if (e.key >= "1" && e.key <= "9") return parseInt(e.key, 10) - 1;
  const digit = e.code.match(/^(?:Digit|Numpad)([1-9])$/);
  return digit ? parseInt(digit[1], 10) - 1 : null;
}

function gameplayKeyboardBlocked(): boolean {
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (active instanceof HTMLElement && active.isContentEditable) return true;
  if (commandWindow.classList.contains("is-open")) return true;
  if (skillTreeModal.classList.contains("is-open")) return true;
  if (pileInspector.classList.contains("is-open")) return true;
  if (chestOfferEl.classList.contains("is-open")) return true;
  if (pedestalOfferEl.classList.contains("is-open")) return true;
  if (deckDestroyOfferEl.classList.contains("is-open")) return true;
  if (flameDestroyOfferEl.classList.contains("is-open")) return true;
  if (bindTomeOfferEl.classList.contains("is-open")) return true;
  if (deckBuilderOfferEl.classList.contains("is-open")) return true;
  if (cardPickupOfferEl.classList.contains("is-open")) return true;
  if (shiftyShopEl.classList.contains("is-open")) return true;
  if (shiftyDialogueEl.classList.contains("is-open")) return true;
  return false;
}

function renderActionBar(): void {
  actionBarEl.replaceChildren();

  const handLen = state.player.hand.length;
  const hasSelection =
    selectedHandIndex !== null && selectedHandIndex >= 0 && selectedHandIndex < handLen;
  if (!hasSelection) discardMenuOpen = false;
  actionBarEl.classList.toggle("hand-action-bar--empty", !hasSelection);

  const enterBlocked = state.pending?.kind === "enter_blocked_tile";
  const waterEscape = state.pending?.kind === "water_escape";
  const resume = state.pending?.kind === "enter_blocked_tile" ? state.pending.resume : null;
  const forbidIdx =
    resume?.kind === "play_move" || resume?.kind === "play_card_seeker"
      ? resume.cardHandIndex
      : -1;
  const actionsDisabled =
    !hasSelection ||
    state.phase !== "player" ||
    (!!state.pending && !enterBlocked && !waterEscape) ||
    choiceModalBlocksPlay(state);

  const idx = hasSelection ? selectedHandIndex! : -1;
  const cardId = hasSelection ? state.player.hand[idx] : null;
  const def = cardId ? state.cardDefs.get(cardId) : undefined;
  const isBonus = def?.effect.type === "bonus_chit";
  const isPenalty = def?.effect.type === "penalty_destroy";
  const dualHandChoice = state.dualWieldStage?.step === "choose_hand_attack";

  const info = document.createElement("div");
  info.className = "hand-action-info";
  const nameEl = document.createElement("span");
  nameEl.className = "hand-action-name" + (hasSelection ? "" : " hand-action-name--placeholder");
  nameEl.textContent = hasSelection ? (def?.name ?? cardId!) : "Select a card";
  info.appendChild(nameEl);

  if (def) {
    const types = document.createElement("span");
    types.className = "hand-action-types";
    for (const t of def.types) {
      const pill = document.createElement("span");
      pill.className = "card-type-pill";
      pill.textContent = t;
      types.appendChild(pill);
    }
    info.appendChild(types);
  }

  const buttons = document.createElement("div");
  buttons.className = "hand-action-buttons";

  const mkBtn = (label: string, cls: string, onClick: () => void, extraDisabled?: boolean) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hand-action-btn" + (cls ? " " + cls : "");
    b.textContent = label;
    b.disabled = actionsDisabled || !!extraDisabled;
    b.addEventListener("click", onClick);
    return b;
  };

  if (waterEscape && hasSelection) {
    buttons.appendChild(
      mkBtn(
        waterEscapeHandIndex === idx ? "Selected ✓" : "Discard to escape",
        waterEscapeHandIndex === idx ? "primary" : "",
        () => { waterEscapeHandIndex = idx; renderAll(); },
      ),
    );
  } else {
    buttons.appendChild(
      mkBtn(
        enterBlocked ? "Pay rubble cost" : "Play",
        "primary",
        () => {
          if (!hasSelection) return;
          if (enterBlocked) apply({ type: "CONFIRM_ENTER_BLOCKED", handIndex: idx });
          else apply({ type: "REQUEST_PLAY_CARD", handIndex: idx });
        },
        isBonus ||
          waterEscape ||
          (enterBlocked && idx === forbidIdx) ||
          (dualHandChoice && !def?.types.includes("Attack")),
      ),
    );

    buttons.appendChild(
      mkBtn(
        "Equip",
        "",
        () => {
          if (!hasSelection) return;
          apply({ type: "REQUEST_EQUIP", handIndex: idx });
        },
        !!state.player.equipped || isBonus || isPenalty || enterBlocked || dualHandChoice,
      ),
    );

    const discardWrap = document.createElement("div");
    discardWrap.className = "hand-discard-wrap";
    const discardBtn = mkBtn(
      "Discard ▾",
      "",
      () => {
        if (!hasSelection) return;
        discardMenuOpen = !discardMenuOpen;
        renderActionBar();
      },
      isPenalty || dualHandChoice,
    );
    discardWrap.appendChild(discardBtn);

    if (discardMenuOpen && hasSelection) {
      const menu = document.createElement("div");
      menu.className = "hand-discard-menu";
      menu.appendChild(mkBtn("Move +1", "", () => {
        discardMenuOpen = false;
        apply({ type: "REQUEST_DISCARD_BONUS", handIndex: idx, bonus: "move1" });
      }, isPenalty || dualHandChoice));
      menu.appendChild(mkBtn("Punch", "", () => {
        discardMenuOpen = false;
        apply({ type: "REQUEST_DISCARD_BONUS", handIndex: idx, bonus: "punch" });
      }, isPenalty || dualHandChoice));
      menu.appendChild(mkBtn("Scout", "", () => {
        discardMenuOpen = false;
        apply({ type: "REQUEST_DISCARD_BONUS", handIndex: idx, bonus: "investigate" });
      }, isPenalty || dualHandChoice));
      discardWrap.appendChild(menu);
    }

    buttons.appendChild(discardWrap);
  }

  actionBarEl.appendChild(info);
  actionBarEl.appendChild(buttons);
}

function renderLog(): void {
  logEl.replaceChildren();
  const lines = state.log.slice(-12);
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    logEl.appendChild(p);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function renderAll(): void {
  if (!grid) return;
  if (state.pending?.kind !== "water_escape") waterEscapeHandIndex = null;
  if (lastSyncedFloorId !== state.floorId) {
    lastSyncedFloorId = state.floorId;
    mapCameraInitialized = false;
  }
  renderMonsterBrain();
  grid.setBrainInspectMonsterId(brainInspectMonsterId);
  grid.sync(state);
  if (!mapCameraInitialized) {
    grid.centerOnPlayer(state);
    mapCameraInitialized = true;
  }

  hudFloor.textContent = state.floorName;
  hudPhase.textContent =
    state.phase === "defeat" ? "Defeat" : state.phase === "peace" ? "Peace" : "Your turn";
  hudHp.textContent =
    state.player.resistance > 0
      ? `${state.player.hp} / ${state.player.maxHp} (Res ${state.player.resistance})`
      : `${state.player.hp} / ${state.player.maxHp}`;
  hudLevel.textContent = String(state.player.level);
  hudExp.textContent = `${state.player.exp} / ${expToNextLevel(state.player.level)}`;
  hudSkillPts.textContent = String(state.player.skillPoints);
  {
    const n = state.player.skillPoints;
    skillTreeSkillPts.textContent = `${n} skill point${n === 1 ? "" : "s"}`;
  }
  hudGold.textContent = String(state.player.gold);
  {
    const goldIcon = document.querySelector<HTMLElement>(".inv-gold .inv-icon");
    if (goldIcon) applyLootIconStyle(goldIcon, "loot_coin", 20);
  }
  renderInventoryGrid();
  hudDanger.textContent = String(state.danger);
  hudNoise.textContent = String(state.noise);

  if (state.dungeonCardReveal) {
    dungeonCardToast.hidden = false;
    dungeonCardToastTitle.textContent = state.dungeonCardReveal.title;
    const sum = state.dungeonCardReveal.summary;
    dungeonCardToastSummary.textContent = sum;
    dungeonCardToastSummary.hidden = !sum;
  } else {
    dungeonCardToast.hidden = true;
    dungeonCardToastTitle.textContent = "";
    dungeonCardToastSummary.textContent = "";
    dungeonCardToastSummary.hidden = false;
  }
  hudDraw.textContent = String(state.player.drawPile.length);
  hudDiscard.textContent = String(state.player.discardPile.length);
  hudEquipped.textContent = state.player.equipped
    ? state.cardDefs.get(state.player.equipped)?.name ?? state.player.equipped
    : "—";

  btnEnd.disabled =
    state.phase !== "player" ||
    choiceModalBlocksPlay(state) ||
    !!state.pending ||
    !!state.tomeCast ||
    !!state.dualWieldStage;
  cancelBtn.style.display =
    state.pending ||
    !!state.tomeCast ||
    state.dualWieldStage?.step === "choose_hand_attack" ||
    state.dualWieldStage?.step === "choose_discard_attack"
      ? "inline-block"
      : "none";
  unequipBtn.disabled = !state.player.equipped || choiceModalBlocksPlay(state);
  inspectDeckBtn.disabled = choiceModalBlocksPlay(state);
  inspectDiscardBtn.disabled = choiceModalBlocksPlay(state);

  btnSkillTree.disabled =
    state.phase === "defeat" ||
    choiceModalBlocksPlay(state) ||
    (state.gauntletCommenced && state.phase !== "peace");

  renderDungeonPiles();
  renderTurnTokens();

  if (state.deckBuilderOffer) {
    hintEl.textContent =
      state.deckBuilderOffer.step === "choose_type"
        ? "Deck Builder — choose a card type (or skip)."
        : "Deck Builder — pick one card for your discard pile, or take none.";
  } else if (state.chestOffer) {
    hintEl.textContent = "Choose one chest card to add to your discard pile, or take none.";
  } else if ((state.cardPickupOffer?.queue.length ?? 0) > 0) {
    hintEl.textContent =
      state.cardPickupOffer!.queue.length > 1
        ? `Found card (${state.cardPickupOffer!.queue.length} to resolve) — add to deck or leave it.`
        : "Add this card to your deck (discard pile), or leave it.";
  } else if (state.phase === "peace") {
    if (merchantDialogueOpen(state)) {
      hintEl.textContent = `${merchantDisplayName(state)} is talking — choose a reply.`;
    } else if (merchantShopOpen(state)) {
      hintEl.textContent = `Browse ${merchantDisplayName(state)}'s shop, or leave when you're done.`;
    } else if (state.deckDestroyPending) {
      hintEl.textContent = "Pedestal — destroy one deck card, or skip.";
    } else if (state.flameDestroyPending) {
      hintEl.textContent = "Flame of Destruction — choose a discard card to destroy, or cancel.";
    } else if (state.bindTomePending) {
      hintEl.textContent = "Bind Magic Tome — choose a Magic card in hand to discard, or cancel.";
    } else if (state.pedestalOffer) {
      hintEl.textContent = "Pedestal — take one card into discard, or take none.";
    } else if (state.merchantState) {
      hintEl.textContent =
        `Peace — click ${merchantDisplayName(state)} to talk, the pedestal first, then the east stair to descend.`;
    } else {
      hintEl.textContent =
        "Peace — click to move. Pedestal (sky circle) first; then step the east stair (grey) to descend.";
    }
  } else if (state.pending?.kind === "water_escape") {
    hintEl.textContent =
      waterEscapeHandIndex === null
        ? "Water! Click Discard on a hand card, then click adjacent land — or Cancel to stay put."
        : "Card ready — click a highlighted land tile next to the water.";
  } else if (state.pending?.kind === "play_move") {
    hintEl.textContent = "Click a gold-highlighted tile on the map to move (up to 2 steps).";
  } else if (state.pending?.kind === "play_melee") {
    hintEl.textContent = "Click an adjacent enemy on the map to strike with your sword.";
  } else if (state.pending?.kind === "discard_move1") {
    const mr = state.pending.maxRange;
    hintEl.textContent =
      mr > 1
        ? `Click a highlighted tile to move up to ${mr} spaces (Quickstep + Sprinter).`
        : "Click a highlighted tile to step 1 space.";
  } else if (state.pending?.kind === "move_token_step") {
    hintEl.textContent = `Click a highlighted tile to use your move token (${state.player.hasteThisTurn ? 2 : 1} step${state.player.hasteThisTurn ? "s" : ""}).`;
  } else if (state.pending?.kind === "discard_punch") {
    hintEl.textContent = "Click an adjacent highlighted tile to punch everything on it.";
  } else if (state.pending?.kind === "play_spear") {
    hintEl.textContent =
      "Click a highlighted cardinal tile 1–2 spaces away — everything there and one tile behind is struck.";
  } else if (state.pending?.kind === "play_knife") {
    hintEl.textContent = "Click an adjacent highlighted tile to strike everything there, then draw a card.";
  } else if (state.pending?.kind === "play_axe") {
    hintEl.textContent = "Click an adjacent highlighted tile to cleave everything there — your next movement is cancelled.";
  } else if (state.pending?.kind === "play_magic_missile") {
    hintEl.textContent =
      "Click a highlighted target tile in a straight or diagonal line. Magic Missile ignores defense.";
  } else if (state.pending?.kind === "play_knockback_punch") {
    hintEl.textContent = "Click an adjacent highlighted tile — punch everything and apply stacked knockback.";
  } else if (state.pending?.kind === "play_bow_attack") {
    hintEl.textContent = `Click a highlighted target tile within ${state.pending.range} spaces (line of sight; not adjacent).`;
  } else if (state.pending?.kind === "play_lightning_bolt") {
    const p = state.pending;
    const hop = p.hitIds.length + 1;
    const cardId = state.player.hand[p.cardHandIndex];
    const dmgShown = p.nextDamage + lightningBoltSkillDamageBonus(state, cardId);
    hintEl.textContent = `Lightning chain (hit ${hop}) — click a highlighted target tile within ${p.nextDamage} spaces for ${dmgShown} damage.`;
  } else if (state.pending?.kind === "play_fireball") {
    hintEl.textContent = `Click a highlighted tile within ${state.pending.range} spaces (line of sight) as the blast center.`;
  } else if (state.pending?.kind === "play_potion_of_harming") {
    hintEl.textContent = `Click a highlighted tile within ${state.pending.range} spaces — creatures there take ${state.pending.damage} damage and a harming cloud remains.`;
  } else if (state.pending?.kind === "play_card_seeker") {
    hintEl.textContent = `Click a highlighted tile to move up to ${state.pending.range} space${state.pending.range === 1 ? "" : "s"} — 2 random cards drop as ground loot.`;
  } else if (state.pending?.kind === "play_loot_and_scoot") {
    hintEl.textContent = `Click a highlighted tile to move up to ${state.pending.range} spaces and scatter coins.`;
  } else if (state.pending?.kind === "play_flying_kick") {
    hintEl.textContent = "Choose a highlighted direction for the 2-space Flying Kick.";
  } else if (state.pending?.kind === "play_great_sword") {
    hintEl.textContent =
      "Choose an adjacent target for 7–12 damage, or an unobstructed cardinal/diagonal target 2 spaces away for 2–5 damage.";
  } else if (state.dualWieldStage?.step === "choose_hand_attack") {
    hintEl.textContent = "Dual Wield: play an Attack from your hand, or Cancel to end Dual Wield.";
  } else if (state.dualWieldStage?.step === "choose_discard_attack") {
    hintEl.textContent =
      "Dual Wield: choose a physical melee Attack from your discard pile to play now, or Cancel.";
  } else if (state.pending?.kind === "enter_blocked_tile") {
    hintEl.textContent =
      "Choose a hand card to discard as extra cost to enter the rubble (cannot be the same card as your move, when applicable).";
  } else {
    hintEl.textContent =
      state.phase === "defeat"
        ? "You were defeated. Refresh the page to try again."
        : "Use the hand below; End turn is bottom-right. The dungeon draws after you.";
  }

  handEl.replaceChildren();
  state.player.hand.forEach((cardId, idx) => {
    const def = state.cardDefs.get(cardId);
    const { icon, accent } = cardChrome(cardId);
    const rarity = def?.rarity ?? "Basic";

    const card = document.createElement("article");
    card.className = `playing-card rarity-${rarity}`;

    const rail = document.createElement("div");
    rail.className = "card-rail";
    rail.style.color = accent;

    const header = document.createElement("div");
    header.className = "card-header";

    const ic = document.createElement("div");
    ic.className = "card-icon";
    ic.style.background = accent;
    ic.textContent = icon;

    const titleWrap = document.createElement("div");
    const h = document.createElement("h2");
    h.className = "card-name";
    h.textContent = def?.name ?? cardId;
    const tag = document.createElement("p");
    tag.className = "card-rarity-tag";
    tag.textContent = rarity;
    titleWrap.appendChild(h);
    titleWrap.appendChild(tag);

    header.appendChild(ic);
    header.appendChild(titleWrap);

    const body = document.createElement("div");
    body.className = "card-body";
    body.textContent = def?.description ?? "";
    const typeRow = createCardTypesElement(def);

    const isSelected = selectedHandIndex === idx;
    if (isSelected) card.classList.add("playing-card--selected");
    else if (selectedHandIndex !== null) card.classList.add("playing-card--dimmed");

    const hotkey = document.createElement("span");
    hotkey.className = "playing-card-hotkey";
    hotkey.textContent = String(idx + 1);

    card.appendChild(rail);
    card.appendChild(hotkey);
    card.appendChild(header);
    card.appendChild(body);
    if (typeRow) card.appendChild(typeRow);

    card.addEventListener("click", () => {
      selectHandCard(selectedHandIndex === idx ? null : idx);
    });

    handEl.appendChild(card);
  });

  if (state.player.equipped) {
    const ban = document.createElement("div");
    ban.className = "equipped-banner";
    ban.textContent = `Equipped: ${state.cardDefs.get(state.player.equipped)?.name ?? state.player.equipped}`;
    handEl.appendChild(ban);
  }

  if (selectedHandIndex !== null && selectedHandIndex >= state.player.hand.length) {
    selectedHandIndex = state.player.hand.length > 0 ? state.player.hand.length - 1 : null;
    discardMenuOpen = false;
  }
  renderActionBar();

  renderLog();
  syncChestOfferModal();
  syncPedestalOfferModal();
  syncDeckDestroyModal();
  syncFlameDestroyModal();
  syncBindTomeModal();
  syncCardPickupModal();
  syncDeckBuilderModal();
  syncDualWieldModal();
  syncShiftyMerchantUi();

  if (skillTreeModal.classList.contains("is-open")) {
    renderSkillTree();
  }
}

cancelBtn.addEventListener("click", () => {
  waterEscapeHandIndex = null;
  if (state.pending?.kind === "water_escape") apply({ type: "CANCEL_WATER_ESCAPE" });
  else apply({ type: "CANCEL_PENDING" });
});
dualWieldCancel.addEventListener("click", () => apply({ type: "CANCEL_PENDING" }));
dualWieldBackdrop.addEventListener("click", () => apply({ type: "CANCEL_PENDING" }));
unequipBtn.addEventListener("click", () => apply({ type: "UNEQUIP" }));
shiftyShopTomes.addEventListener("click", () => apply({ type: "OPEN_MERCHANT_TOMES" }));
shiftyShopLeave.addEventListener("click", () => apply({ type: "CLOSE_MERCHANT_SHOP" }));
shiftyShopBackdrop.addEventListener("click", () => apply({ type: "CLOSE_MERCHANT_SHOP" }));
btnEnd.addEventListener("click", () => apply({ type: "END_TURN" }));

dungeonCardToastDismiss.addEventListener("click", () => {
  apply({ type: "DISMISS_DUNGEON_TOAST" });
});

inspectDeckBtn.addEventListener("click", () => openPileInspector("deck"));
inspectDiscardBtn.addEventListener("click", () => openPileInspector("discard"));
dungeonDeckVisual.addEventListener("click", () => openPileInspector("dungeon"));
dungeonDeckVisual.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openPileInspector("dungeon");
});
pileInspectorBackdrop.addEventListener("click", closePileInspector);
pileInspectorClose.addEventListener("click", closePileInspector);
monsterBrainClose.addEventListener("click", () => {
  closeMonsterBrain();
  renderAll();
});
chestOfferSkip.addEventListener("click", () => {
  if (state.chestOffer) apply({ type: "RESOLVE_CHEST_OFFER", pickIndex: null });
});
chestOfferBackdrop.addEventListener("click", () => {
  if (state.chestOffer) apply({ type: "RESOLVE_CHEST_OFFER", pickIndex: null });
});

pedestalOfferSkip.addEventListener("click", () => {
  if (state.pedestalOffer) apply({ type: "RESOLVE_PEDESTAL_PICK", pickIndex: null });
});
pedestalOfferBackdrop.addEventListener("click", () => {
  if (state.pedestalOffer) apply({ type: "RESOLVE_PEDESTAL_PICK", pickIndex: null });
});
function skipDeckDestroy(): void {
  if (state.deckDestroyPending) apply({ type: "RESOLVE_DECK_DESTROY", cardId: null });
}

function skipFlameDestroy(): void {
  if (state.flameDestroyPending) apply({ type: "RESOLVE_FLAME_DESTROY", cardId: null });
}

function skipBindTome(): void {
  if (state.bindTomePending) apply({ type: "RESOLVE_BIND_TOME", handIndex: null });
}

deckDestroySkip.addEventListener("click", () => skipDeckDestroy());
deckDestroyBackdrop.addEventListener("click", () => skipDeckDestroy());
flameDestroySkip.addEventListener("click", () => skipFlameDestroy());
flameDestroyBackdrop.addEventListener("click", () => skipFlameDestroy());
bindTomeSkip.addEventListener("click", () => skipBindTome());
bindTomeBackdrop.addEventListener("click", () => skipBindTome());

deckBuilderBackdrop.addEventListener("click", () => {
  if (!state.deckBuilderOffer) return;
  if (state.deckBuilderOffer.step === "choose_type") {
    apply({ type: "RESOLVE_DECK_BUILDER_CANCEL" });
  } else {
    apply({ type: "RESOLVE_DECK_BUILDER_PICK", pickIndex: null });
  }
});

cardPickupAccept.addEventListener("click", () => {
  if (
    (state.cardPickupOffer?.queue.length ?? 0) > 0 &&
    !state.chestOffer &&
    !state.deckBuilderOffer
  ) {
    apply({ type: "RESOLVE_CARD_PICKUP", accept: true });
  }
});
cardPickupDecline.addEventListener("click", () => {
  if (
    (state.cardPickupOffer?.queue.length ?? 0) > 0 &&
    !state.chestOffer &&
    !state.deckBuilderOffer
  ) {
    apply({ type: "RESOLVE_CARD_PICKUP", accept: false });
  }
});
cardPickupBackdrop.addEventListener("click", () => {
  if (
    (state.cardPickupOffer?.queue.length ?? 0) > 0 &&
    !state.chestOffer &&
    !state.deckBuilderOffer
  ) {
    apply({ type: "RESOLVE_CARD_PICKUP", accept: false });
  }
});

btnSkillTree.addEventListener("click", () => openSkillTreeModal());
skillTreeBackdrop.addEventListener("click", () => closeSkillTreeModal());
skillTreeClose.addEventListener("click", () => closeSkillTreeModal());

commandWindowBtn.addEventListener("click", () => openCommandWindow());
graphicsToggleBtn.addEventListener("click", () => {
  const next = !(grid?.getPixelArtEnabled() ?? true);
  setPixelArtEnabled(next);
});
commandWindowBackdrop.addEventListener("click", () => closeCommandWindow());
commandWindowClose.addEventListener("click", () => closeCommandWindow());
commandForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const feedback = runCommandLine(commandInput.value);
  commandFeedback.textContent = feedback;
  commandInput.select();
});

skillTreeScroll.addEventListener(
  "wheel",
  (e) => {
    if (!skillTreeModal.classList.contains("is-open")) return;
    if (skillTreeScroll.scrollWidth <= skillTreeScroll.clientWidth) return;
    e.preventDefault();
    skillTreeScroll.scrollLeft += e.deltaY;
  },
  { passive: false },
);

handZoneEl.addEventListener("pointerdown", () => focusHandZone());

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && commandWindow.classList.contains("is-open")) {
    closeCommandWindow();
    return;
  }
  if (e.key === "Escape" && shiftyShopEl.classList.contains("is-open")) {
    apply({ type: "CLOSE_MERCHANT_SHOP" });
    return;
  }
  if (e.key === "Escape" && shiftyDialogueEl.classList.contains("is-open")) {
    apply({ type: "RESOLVE_MERCHANT_DIALOGUE", choiceId: "leave" });
    return;
  }
  if (e.key === "Escape" && deckBuilderOfferEl.classList.contains("is-open")) {
    if (state.deckBuilderOffer?.step === "choose_type") {
      apply({ type: "RESOLVE_DECK_BUILDER_CANCEL" });
    } else if (state.deckBuilderOffer?.step === "choose_card") {
      apply({ type: "RESOLVE_DECK_BUILDER_PICK", pickIndex: null });
    }
    return;
  }
  if (e.key === "Escape" && deckDestroyOfferEl.classList.contains("is-open")) {
    if (state.deckDestroyPending) skipDeckDestroy();
    return;
  }
  if (e.key === "Escape" && flameDestroyOfferEl.classList.contains("is-open")) {
    if (state.flameDestroyPending) skipFlameDestroy();
    return;
  }
  if (e.key === "Escape" && bindTomeOfferEl.classList.contains("is-open")) {
    if (state.bindTomePending) skipBindTome();
    return;
  }
  if (e.key === "Escape" && pedestalOfferEl.classList.contains("is-open")) {
    if (state.pedestalOffer) apply({ type: "RESOLVE_PEDESTAL_PICK", pickIndex: null });
    return;
  }
  if (e.key === "Escape" && chestOfferEl.classList.contains("is-open")) {
    if (state.chestOffer) apply({ type: "RESOLVE_CHEST_OFFER", pickIndex: null });
    return;
  }
  if (e.key === "Escape" && cardPickupOfferEl.classList.contains("is-open") && !state.chestOffer) {
    if ((state.cardPickupOffer?.queue.length ?? 0) > 0) apply({ type: "RESOLVE_CARD_PICKUP", accept: false });
    return;
  }
  if (e.key === "Escape" && pileInspector.classList.contains("is-open")) closePileInspector();
  if (e.key === "Escape" && skillTreeModal.classList.contains("is-open")) closeSkillTreeModal();

  if (e.key === "Escape" && selectedHandIndex !== null) {
    selectHandCard(null);
    return;
  }
});

window.addEventListener(
  "keydown",
  (e) => {
    if (gameplayKeyboardBlocked()) return;

    const handLen = state.player.hand.length;
    const digitIndex = handIndexFromDigitKey(e);

    if (digitIndex !== null) {
      if (digitIndex < handLen) {
        e.preventDefault();
        selectHandCard(selectedHandIndex === digitIndex ? null : digitIndex);
      }
      return;
    }

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (handLen === 0) return;
      e.preventDefault();
      if (selectedHandIndex === null) {
        selectHandCard(0);
      } else {
        const delta = e.key === "ArrowRight" ? 1 : -1;
        selectHandCard((selectedHandIndex + delta + handLen) % handLen);
      }
      return;
    }

    if ((e.key === "Enter" || e.key === " ") && selectedHandIndex !== null) {
      e.preventDefault();
      const idx = selectedHandIndex;
      if (state.pending?.kind === "enter_blocked_tile") {
        apply({ type: "CONFIRM_ENTER_BLOCKED", handIndex: idx });
      } else if (state.pending?.kind === "water_escape") {
        waterEscapeHandIndex = idx;
        renderAll();
      } else {
        apply({ type: "REQUEST_PLAY_CARD", handIndex: idx });
      }
      return;
    }

    if (e.key === "e" && selectedHandIndex !== null) {
      e.preventDefault();
      apply({ type: "REQUEST_EQUIP", handIndex: selectedHandIndex });
      return;
    }

    if (e.key === "d" && selectedHandIndex !== null) {
      e.preventDefault();
      discardMenuOpen = !discardMenuOpen;
      renderActionBar();
      return;
    }

    if (discardMenuOpen && selectedHandIndex !== null) {
      const bonusMap: Record<string, "move1" | "punch" | "investigate"> = {
        m: "move1",
        p: "punch",
        s: "investigate",
      };
      if (bonusMap[e.key]) {
        e.preventDefault();
        discardMenuOpen = false;
        apply({ type: "REQUEST_DISCARD_BONUS", handIndex: selectedHandIndex, bonus: bonusMap[e.key] });
      }
      return;
    }

    if (e.key === "t" && selectedHandIndex === null) {
      e.preventDefault();
      if (!btnEnd.disabled) apply({ type: "END_TURN" });
      return;
    }

    if (e.key === "c") {
      e.preventDefault();
      waterEscapeHandIndex = null;
      if (state.pending?.kind === "water_escape") apply({ type: "CANCEL_WATER_ESCAPE" });
      else apply({ type: "CANCEL_PENDING" });
    }
  },
  true,
);

const app = new Application();

function layoutMapCanvas(): void {
  if (!grid) return;
  const w = Math.max(240, Math.floor(viewport.clientWidth));
  const h = Math.max(200, Math.floor(viewport.clientHeight));
  app.renderer.resize(w, h);
  grid.configureViewport(w, h, app.canvas as HTMLCanvasElement);
  if (mapCameraInitialized) {
    grid.reapplyCameraClamp(state);
  }
}

async function bootstrap(): Promise<void> {
  viewport.innerHTML = "";
  const loading = document.createElement("p");
  loading.className = "viewport-loading";
  loading.textContent = "Loading map…";
  viewport.appendChild(loading);

  const styles = await loadSpriteStyles("/assets/manifest.json");
  const attackFx = await loadAttackFxFrames();
  grid = new GridView(styles, cellClick, cellSecondary);
  grid.setAttackFxFrames(attackFx);
  grid.setPixelArtEnabled(readStoredPixelArtPreference());
  syncGraphicsToggleButton();

  await app.init({
    width: VIEW_WIDTH_PX,
    height: VIEW_HEIGHT_PX,
    background: 0x0d0e14,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
  });

  viewport.replaceChildren(app.canvas as HTMLCanvasElement);
  layoutMapCanvas();
  const ro = new ResizeObserver(() => layoutMapCanvas());
  ro.observe(viewport);
  window.addEventListener("resize", layoutMapCanvas);
  app.stage.addChild(grid);

  apply({ type: "BEGIN_FIRST_TURN" });
  focusHandZone();
}

bootstrap().catch((e) => {
  console.error(e);
  viewport.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "bootstrap-error";
  wrap.innerHTML = `<p><strong>Could not start the game.</strong></p><p>${String(e)}</p><p>Run <code>npm run dev</code> from the project folder (or double‑click <code>dev.bat</code>), then open the local address in your browser.</p>`;
  viewport.appendChild(wrap);
});
