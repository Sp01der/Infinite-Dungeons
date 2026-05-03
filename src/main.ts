import { Application } from "pixi.js";
import floorSample from "./content/floor_sample.json";
import { generateFloor } from "./engine/floorGen";
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
import { CARD_TYPE_ORDER, type CardDef, type GameCommand, type GameState } from "./game/types";
import { loadSpriteStyles } from "./render/assets";
import { GridView, VIEW_HEIGHT_PX, VIEW_WIDTH_PX } from "./render/gridView";

const viewport = document.querySelector<HTMLDivElement>("#game-viewport")!;
const hudFloor = document.querySelector<HTMLSpanElement>("#hud-floor")!;
const hudPhase = document.querySelector<HTMLSpanElement>("#hud-phase")!;
const hudHp = document.querySelector<HTMLSpanElement>("#hud-hp")!;
const hudLevel = document.querySelector<HTMLSpanElement>("#hud-level")!;
const hudExp = document.querySelector<HTMLSpanElement>("#hud-exp")!;
const hudSkillPts = document.querySelector<HTMLSpanElement>("#hud-skill-pts")!;
const hudGold = document.querySelector<HTMLSpanElement>("#hud-gold")!;
const hudBread = document.querySelector<HTMLSpanElement>("#hud-bread")!;
const hudDanger = document.querySelector<HTMLSpanElement>("#hud-danger")!;
const hudNoise = document.querySelector<HTMLSpanElement>("#hud-noise")!;
const hudDraw = document.querySelector<HTMLSpanElement>("#hud-draw")!;
const hudDiscard = document.querySelector<HTMLSpanElement>("#hud-discard")!;
const hudEquipped = document.querySelector<HTMLSpanElement>("#hud-equipped")!;
const dungeonDeckVisual = document.querySelector<HTMLDivElement>("#dungeon-deck-visual")!;
const dungeonDiscardVisual = document.querySelector<HTMLDivElement>("#dungeon-discard-visual")!;
const handEl = document.querySelector<HTMLDivElement>("#hand-cards")!;
const logEl = document.querySelector<HTMLDivElement>("#game-log")!;
const hintEl = document.querySelector<HTMLParagraphElement>("#hint")!;
const btnEnd = document.querySelector<HTMLButtonElement>("#btn-end-turn")!;
const cancelBtn = document.querySelector<HTMLButtonElement>("#btn-cancel")!;
const unequipBtn = document.querySelector<HTMLButtonElement>("#btn-unequip")!;
const itemBreadBtn = document.querySelector<HTMLButtonElement>("#item-bread")!;
const inspectDeckBtn = document.querySelector<HTMLButtonElement>("#inspect-deck")!;
const inspectDiscardBtn = document.querySelector<HTMLButtonElement>("#inspect-discard")!;
const pileInspector = document.querySelector<HTMLDivElement>("#pile-inspector")!;
const pileInspectorBackdrop = document.querySelector<HTMLDivElement>("#pile-inspector-backdrop")!;
const pileInspectorClose = document.querySelector<HTMLButtonElement>("#pile-inspector-close")!;
const pileInspectorTitle = document.querySelector<HTMLHeadingElement>("#pile-inspector-title")!;
const pileInspectorBody = document.querySelector<HTMLDivElement>("#pile-inspector-body")!;
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
const commandWindowBtn = document.querySelector<HTMLButtonElement>("#btn-command-window")!;
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
  : createInitialStateGenerated(generateFloor({ depth: 1 }));
let grid: GridView | undefined;
let mapCameraInitialized = false;
let lastSyncedFloorId: string | null = null;

function choiceModalBlocksPlay(s: GameState): boolean {
  return (
    !!s.chestOffer ||
    (s.cardPickupOffer?.queue.length ?? 0) > 0 ||
    !!s.pedestalOffer ||
    s.deckDestroyPending ||
    !!s.deckBuilderOffer
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
    b.title = "Spend to prime your next weapon attack to push the enemy back.";
    b.disabled = state.phase !== "player" || !!state.pending || blocked;
    b.addEventListener("click", () => apply({ type: "USE_KNOCKBACK_TOKEN" }));
    turnTokensEl.appendChild(b);
  }
  if (state.player.knockbackPrimed) {
    const span = document.createElement("span");
    span.className = "turn-token-primed";
    span.textContent = "KB ready";
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
  const { state: next, hits } = dispatch(state, cmd);
  state = next;
  if (hits.length > 0) grid?.playHits(hits);
  renderAll();
}

function cellClick(x: number, y: number): void {
  const s = state;
  if (choiceModalBlocksPlay(s)) return;
  if (s.phase === "peace") {
    apply({ type: "PEACE_MOVE_TO", x, y });
    return;
  }
  if (s.phase !== "player" || !s.pending) return;
  if (s.pending.kind === "enter_blocked_tile") return;
  const monsterTargeting =
    s.pending.kind === "play_melee" ||
    s.pending.kind === "discard_punch" ||
    s.pending.kind === "play_spear" ||
    s.pending.kind === "play_knife" ||
    s.pending.kind === "play_axe" ||
    s.pending.kind === "play_magic_missile" ||
    s.pending.kind === "play_knockback_punch" ||
    s.pending.kind === "play_bow_attack" ||
    s.pending.kind === "play_lightning_bolt";
  if (monsterTargeting) {
    const mon = s.monsters.find((m) => m.hp > 0 && m.x === x && m.y === y);
    if (mon) {
      apply({ type: "CONFIRM_TARGET_MONSTER", monsterInstanceId: mon.id });
      return;
    }
    const pot = s.pots.find((p) => p.x === x && p.y === y);
    if (pot) {
      apply({ type: "CONFIRM_TARGET_POT", potId: pot.id });
      return;
    }
  }
  apply({ type: "CONFIRM_TARGET_TILE", x, y });
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
  noise: "noise",
  exp: "exp",
  experience: "exp",
  "skill points": "skillPoints",
  skillpoints: "skillPoints",
  sp: "skillPoints",
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
    if (args.length < 2) return "Usage: Card [card name] [add or remove]";
    const action = args[args.length - 1]!.toLowerCase();
    if (action !== "add" && action !== "remove") return "Card action must be add or remove.";
    const cardName = args.slice(0, -1).join(" ");
    const cardId = findNamedId(state.cardDefs, cardName);
    if (!cardId) return `Unknown card: ${cardName}`;
    if (action === "remove" && !playerHasCardCopy(cardId)) {
      return `You do not have ${state.cardDefs.get(cardId)?.name ?? cardId}.`;
    }
    apply({ type: "DEV_CARD", cardId, action });
    return `${action === "add" ? "Added" : "Removed"} ${state.cardDefs.get(cardId)?.name ?? cardId}.`;
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

  return "Unknown command. Try Set, Card, Dungeon, Floor, or Summon.";
}

function openPileInspector(which: "deck" | "discard"): void {
  if (choiceModalBlocksPlay(state)) return;
  const pile = which === "deck" ? state.player.drawPile : state.player.discardPile;
  pileInspectorTitle.textContent = which === "deck" ? "Your deck" : "Discard pile";
  pileInspectorBody.replaceChildren();
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

function renderDungeonPiles(): void {
  const n = state.dungeonDraw.length;
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
  if (lastSyncedFloorId !== state.floorId) {
    lastSyncedFloorId = state.floorId;
    mapCameraInitialized = false;
  }
  grid.sync(state);
  if (!mapCameraInitialized) {
    grid.centerOnPlayer(state);
    mapCameraInitialized = true;
  }

  hudFloor.textContent = state.floorName;
  hudPhase.textContent =
    state.phase === "defeat" ? "Defeat" : state.phase === "peace" ? "Peace" : "Your turn";
  hudHp.textContent = `${state.player.hp} / ${state.player.maxHp}`;
  hudLevel.textContent = String(state.player.level);
  hudExp.textContent = `${state.player.exp} / ${expToNextLevel(state.player.level)}`;
  hudSkillPts.textContent = String(state.player.skillPoints);
  {
    const n = state.player.skillPoints;
    skillTreeSkillPts.textContent = `${n} skill point${n === 1 ? "" : "s"}`;
  }
  hudGold.textContent = String(state.player.gold);
  hudBread.textContent = String(state.player.bread);
  hudDanger.textContent = String(state.danger);
  hudNoise.textContent = String(state.noise);

  if (state.dungeonCardReveal) {
    dungeonCardToast.hidden = false;
    dungeonCardToastTitle.textContent = state.dungeonCardReveal.title;
    dungeonCardToastSummary.textContent = state.dungeonCardReveal.summary;
  } else {
    dungeonCardToast.hidden = true;
    dungeonCardToastTitle.textContent = "";
    dungeonCardToastSummary.textContent = "";
  }
  hudDraw.textContent = String(state.player.drawPile.length);
  hudDiscard.textContent = String(state.player.discardPile.length);
  hudEquipped.textContent = state.player.equipped
    ? state.cardDefs.get(state.player.equipped)?.name ?? state.player.equipped
    : "—";

  btnEnd.disabled =
    state.phase !== "player" || choiceModalBlocksPlay(state) || !!state.pending;
  cancelBtn.style.display = state.pending ? "inline-block" : "none";
  unequipBtn.disabled = !state.player.equipped || choiceModalBlocksPlay(state);
  inspectDeckBtn.disabled = choiceModalBlocksPlay(state);
  inspectDiscardBtn.disabled = choiceModalBlocksPlay(state);
  itemBreadBtn.disabled =
    state.phase !== "player" ||
    !!state.pending ||
    choiceModalBlocksPlay(state) ||
    state.player.bread <= 0 ||
    state.player.hp >= state.player.maxHp;

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
    if (state.deckDestroyPending) {
      hintEl.textContent = "Pedestal — destroy one deck card, or skip.";
    } else if (state.pedestalOffer) {
      hintEl.textContent = "Pedestal — take one card into discard, or take none.";
    } else {
      hintEl.textContent =
        "Peace — click to move. Pedestal (sky circle) first; then step the east stair (grey) to descend.";
    }
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
    hintEl.textContent = "Click a highlighted tile to use your move token (1 step).";
  } else if (state.pending?.kind === "discard_punch") {
    hintEl.textContent = "Click an adjacent enemy to punch.";
  } else if (state.pending?.kind === "play_spear") {
    hintEl.textContent =
      "Click an enemy in a straight line 1–2 tiles away (cardinal) to thrust — may pierce one tile behind.";
  } else if (state.pending?.kind === "play_knife") {
    hintEl.textContent = "Click an adjacent enemy to stab with the knife (you draw a card).";
  } else if (state.pending?.kind === "play_axe") {
    hintEl.textContent = "Click an adjacent enemy to cleave — your next move is cancelled.";
  } else if (state.pending?.kind === "play_magic_missile") {
    hintEl.textContent =
      "Click an enemy in a straight or diagonal line from you (queen move). Magic Missile ignores defense.";
  } else if (state.pending?.kind === "play_knockback_punch") {
    hintEl.textContent = "Click an adjacent enemy to punch — knocks them back 2 spaces.";
  } else if (state.pending?.kind === "play_bow_attack") {
    hintEl.textContent = `Click a highlighted enemy within ${state.pending.range} spaces (line of sight; cannot target adjacent).`;
  } else if (state.pending?.kind === "play_lightning_bolt") {
    const p = state.pending;
    const hop = p.hitIds.length + 1;
    hintEl.textContent = `Lightning chain (hit ${hop}) — click a highlighted enemy within ${p.nextDamage} spaces for ${p.nextDamage} damage.`;
  } else if (state.pending?.kind === "play_fireball") {
    hintEl.textContent = `Click a highlighted tile within ${state.pending.range} spaces (line of sight) as the blast center.`;
  } else if (state.pending?.kind === "play_card_seeker") {
    hintEl.textContent = "Click a highlighted tile to move 1 space — 2 random cards drop as ground loot.";
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

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const enterBlocked = state.pending?.kind === "enter_blocked_tile";
    const resume =
      state.pending?.kind === "enter_blocked_tile" ? state.pending.resume : null;
    const forbidIdx =
      resume?.kind === "play_move" || resume?.kind === "play_card_seeker"
        ? resume.cardHandIndex
        : -1;
    const disabled =
      state.phase !== "player" ||
      (!!state.pending && !enterBlocked) ||
      choiceModalBlocksPlay(state);
    const isBonus = def?.effect.type === "bonus_chit";

    const mkBtn = (label: string, cls: string, onClick: () => void, extraDisabled?: boolean) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = label;
      b.disabled = disabled || !!extraDisabled;
      b.addEventListener("click", onClick);
      return b;
    };

    actions.appendChild(
      mkBtn(
        enterBlocked ? "Pay rubble cost" : "Play",
        "primary",
        () =>
          enterBlocked
            ? apply({ type: "CONFIRM_ENTER_BLOCKED", handIndex: idx })
            : apply({ type: "REQUEST_PLAY_CARD", handIndex: idx }),
        isBonus || (enterBlocked && idx === forbidIdx),
      ),
    );

    const discardRow = document.createElement("div");
    discardRow.className = "discard-row";
    if (!enterBlocked) {
      discardRow.appendChild(
        mkBtn("Move +1", "", () =>
          apply({ type: "REQUEST_DISCARD_BONUS", handIndex: idx, bonus: "move1" }),
        ),
      );
      discardRow.appendChild(
        mkBtn("Punch", "", () =>
          apply({ type: "REQUEST_DISCARD_BONUS", handIndex: idx, bonus: "punch" }),
        ),
      );
      discardRow.appendChild(
        mkBtn("Scout", "", () =>
          apply({ type: "REQUEST_DISCARD_BONUS", handIndex: idx, bonus: "investigate" }),
        ),
      );
    }

    actions.appendChild(discardRow);
    actions.appendChild(
      mkBtn(
        "Equip",
        "",
        () => apply({ type: "REQUEST_EQUIP", handIndex: idx }),
        !!state.player.equipped || isBonus || enterBlocked,
      ),
    );

    card.appendChild(rail);
    card.appendChild(header);
    card.appendChild(body);
    if (typeRow) card.appendChild(typeRow);
    card.appendChild(actions);
    handEl.appendChild(card);
  });

  if (state.player.equipped) {
    const ban = document.createElement("div");
    ban.className = "equipped-banner";
    ban.textContent = `Equipped: ${state.cardDefs.get(state.player.equipped)?.name ?? state.player.equipped}`;
    handEl.appendChild(ban);
  }

  renderLog();
  syncChestOfferModal();
  syncPedestalOfferModal();
  syncDeckDestroyModal();
  syncCardPickupModal();
  syncDeckBuilderModal();

  if (skillTreeModal.classList.contains("is-open")) {
    renderSkillTree();
  }
}

cancelBtn.addEventListener("click", () => apply({ type: "CANCEL_PENDING" }));
unequipBtn.addEventListener("click", () => apply({ type: "UNEQUIP" }));
itemBreadBtn.addEventListener("click", () => apply({ type: "USE_BREAD" }));
btnEnd.addEventListener("click", () => apply({ type: "END_TURN" }));

dungeonCardToastDismiss.addEventListener("click", () => {
  apply({ type: "DISMISS_DUNGEON_TOAST" });
});

inspectDeckBtn.addEventListener("click", () => openPileInspector("deck"));
inspectDiscardBtn.addEventListener("click", () => openPileInspector("discard"));
pileInspectorBackdrop.addEventListener("click", closePileInspector);
pileInspectorClose.addEventListener("click", closePileInspector);
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

deckDestroySkip.addEventListener("click", () => skipDeckDestroy());
deckDestroyBackdrop.addEventListener("click", () => skipDeckDestroy());

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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && commandWindow.classList.contains("is-open")) {
    closeCommandWindow();
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
});

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
  grid = new GridView(styles, cellClick);

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
}

bootstrap().catch((e) => {
  console.error(e);
  viewport.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "bootstrap-error";
  wrap.innerHTML = `<p><strong>Could not start the game.</strong></p><p>${String(e)}</p><p>Run <code>npm run dev</code> from the project folder (or double‑click <code>dev.bat</code>), then open the local address in your browser.</p>`;
  viewport.appendChild(wrap);
});
