import { applyDefense, rollInt, pushRollChanceContext, popRollChanceContext } from "../engine/combat";
import { addRoomsToDiscovered, collectRoomIdsAdjacentToPlayer } from "../engine/discovery";
import {
  chebyshev,
  inBounds,
  keyOf,
  lineOfSightClear,
  magicMissilePathClearToPoint,
  tileAt,
} from "../engine/grid";
import {
  extendReachableWithBlockedDestinations,
  isWalkable,
  manhattan,
  reachableOrthogonal,
} from "../engine/movement";
import { buildFreshDungeonDeck, DUNGEON_DEADLIER_ID } from "./dungeonDeck";
import {
  appendGoldSeekerBonusCoin,
  buildStartingDeck,
  createNextFloorState,
  pickMonsterId,
  pickWeightedDefId,
} from "./initialState";
import { runMonsterPhaseWithHooks } from "./monsterAi";
import { cullMonstersWithDouvlonPairs, setMonsterHpWithDouvlonSync } from "./douvlon";
import { animsFromHits, finalizeAnims, mergeAnimResults, pushMoveAnim } from "./turnAnims";
import { createMonsterInstance, monsterDefenseForIncoming } from "./monsterSpawn";
import { attachStairRoom } from "./stairRoom";
import {
  handleMerchantCommand,
  merchantUiBlocks,
  spawnMerchantAfterGauntlet,
} from "./merchantRuntime";
import {
  maybeDropMonsterCoin,
  pickChestOfferCards,
  pickDeckBuilderThreeForType,
  pickPedestalOfferCards,
  pickRandomLootCardId,
  rollChestLoot,
  rollPotLoot,
} from "./loot";
import { addExp } from "./progression";
import {
  attackStrengthBonus,
  breadHealBonus,
  descendantSkipDungeonDraw,
  fighterTrainingBonus,
  hasteMovementRange,
  heavyPunchBonus,
  incomingDamageToPlayer,
  knockbackTokensGrantedPerTurn,
  lightningBoltSkillDamageBonus,
  mageTrainingBonus,
  moveTokensGrantedPerTurn,
  playerDrawCountPerTurn,
  potLootHitChance,
  punchStrikeCount,
  SID,
  sprinterExtraMoveRange,
} from "./skillsRuntime";
import { getSkillDef } from "./skillDefs";
import type {
  AttackFxKind,
  CardDef,
  DispatchResult,
  FloorTheme,
  GameCommand,
  GameState,
  GroundLootInstance,
  HitVisual,
  MonsterDef,
  MonsterInstance,
  Point,
  RockInstance,
  RoomKind,
  TileKind,
  TurnAnimEvent,
} from "./types";

function log(state: GameState, line: string): GameState {
  return { ...state, log: [...state.log.slice(-50), line] };
}

function choiceModalBlocksProgression(s: GameState): boolean {
  return (
    !!s.chestOffer ||
    (s.cardPickupOffer?.queue.length ?? 0) > 0 ||
    !!s.pedestalOffer ||
    s.deckDestroyPending ||
    !!s.deckBuilderOffer ||
    merchantUiBlocks(s)
  );
}

function handleDeckBuilderOffer(state: GameState, cmd: GameCommand): DispatchResult {
  const offer = state.deckBuilderOffer!;
  if (cmd.type === "RESOLVE_DECK_BUILDER_CANCEL") {
    if (offer.step !== "choose_type") return noHits(state);
    return noHits(
      log({ ...state, deckBuilderOffer: null }, "You skip adding a card from Deck Builder."),
    );
  }
  if (cmd.type === "RESOLVE_DECK_BUILDER_TYPE") {
    if (offer.step !== "choose_type") return noHits(state);
    const options = pickDeckBuilderThreeForType(state.cardDefs, cmd.cardType, state.depth);
    return noHits({
      ...state,
      deckBuilderOffer: { step: "choose_card", cardType: cmd.cardType, options },
    });
  }
  if (cmd.type === "RESOLVE_DECK_BUILDER_PICK") {
    if (offer.step !== "choose_card") return noHits(state);
    let s: GameState = { ...state, deckBuilderOffer: null };
    const idx = cmd.pickIndex;
    if (idx === null || idx < 0 || idx > 2) {
      return noHits(log(s, "You decline to add a card to your deck."));
    }
    const cardId = offer.options[idx];
    if (!cardId) return noHits(state);
    const nm = s.cardDefs.get(cardId)?.name ?? cardId;
    return noHits(
      log(
        {
          ...s,
          player: { ...s.player, discardPile: [...s.player.discardPile, cardId] },
        },
        `Deck Builder: you add ${nm} to your discard pile.`,
      ),
    );
  }
  return noHits(state);
}

function handleDevCommand(state: GameState, cmd: GameCommand): DispatchResult {
  if (cmd.type === "DEV_SET_VARIABLE") {
    const value = Math.trunc(cmd.value);
    switch (cmd.variable) {
      case "danger":
        return noHits(log({ ...state, danger: value }, `Command: danger set to ${value}.`));
      case "noise":
        return noHits(log({ ...state, noise: value }, `Command: noise set to ${value}.`));
      case "level":
        return noHits(
          log(
            { ...state, player: { ...state.player, level: Math.max(1, value) } },
            `Command: level set to ${Math.max(1, value)}.`,
          ),
        );
      case "maxHp": {
        const maxHp = Math.max(1, value);
        const hp = Math.min(state.player.hp, maxHp);
        return noHits(
          log(
            { ...state, player: { ...state.player, maxHp, hp } },
            `Command: max HP set to ${maxHp}.`,
          ),
        );
      }
      case "hp": {
        const hp = Math.max(0, Math.min(value, state.player.maxHp));
        return noHits(
          log({ ...state, player: { ...state.player, hp } }, `Command: HP set to ${hp}.`),
        );
      }
      case "gold":
        return noHits(
          log(
            { ...state, player: { ...state.player, gold: Math.max(0, value) } },
            `Command: gold set to ${Math.max(0, value)}.`,
          ),
        );
      case "bread":
        return noHits(
          log(
            { ...state, player: { ...state.player, bread: Math.max(0, value) } },
            `Command: bread set to ${Math.max(0, value)}.`,
          ),
        );
      case "herb":
        return noHits(
          log(
            { ...state, player: { ...state.player, herb: Math.max(0, value) } },
            `Command: herb set to ${Math.max(0, value)}.`,
          ),
        );
      case "exp":
        return noHits(
          log(
            { ...state, player: { ...state.player, exp: Math.max(0, value) } },
            `Command: EXP set to ${Math.max(0, value)}.`,
          ),
        );
      case "skillPoints":
        return noHits(
          log(
            { ...state, player: { ...state.player, skillPoints: Math.max(0, value) } },
            `Command: skill points set to ${Math.max(0, value)}.`,
          ),
        );
    }
  }

  if (cmd.type === "DEV_CARD") {
    const nm = state.cardDefs.get(cmd.cardId)?.name ?? cmd.cardId;
    if (cmd.action === "add") {
      return noHits(
        log(
          {
            ...state,
            player: { ...state.player, discardPile: [...state.player.discardPile, cmd.cardId] },
          },
          `Command: added ${nm} to your discard pile.`,
        ),
      );
    }
    const removed = removeOneCardFromDeck(state, cmd.cardId);
    if (removed) {
      return noHits(log(clearEquippedIfGone(removed), `Command: removed one ${nm}.`));
    }
    return noHits(log(state, `Command: ${nm} is not in your deck.`));
  }

  if (cmd.type === "DEV_DECK") {
    if (cmd.action === "clear") {
      return noHits(
        log(
          {
            ...state,
            pending: null,
            player: {
              ...state.player,
              drawPile: [],
              discardPile: [],
              hand: [],
              equipped: null,
            },
          },
          "Command: deck cleared.",
        ),
      );
    }

    if (cmd.action === "reset") {
      return noHits(
        log(
          {
            ...state,
            pending: null,
            player: {
              ...state.player,
              drawPile: buildStartingDeck(),
              discardPile: [],
              hand: [],
              equipped: null,
            },
          },
          "Command: deck reset to a new starting deck.",
        ),
      );
    }

    return noHits(
      log(
        {
          ...reshufflePlayerCards(state),
          pending: null,
        },
        "Command: deck reshuffled.",
      ),
    );
  }

  if (cmd.type === "DEV_DUNGEON_TOP") {
    const nm = state.dungeonCardDefs.get(cmd.cardId)?.name ?? cmd.cardId;
    return noHits(
      log(
        { ...state, dungeonDraw: [cmd.cardId, ...state.dungeonDraw] },
        `Command: ${nm} placed on top of the dungeon deck.`,
      ),
    );
  }

  if (cmd.type === "DEV_SUMMON") {
    if (!state.monsterDefs.has(cmd.defId)) {
      return noHits(log(state, `Command: unknown monster id "${cmd.defId}".`));
    }
    const P = { x: state.player.x, y: state.player.y };
    const occ = new Set(state.monsters.filter((m) => m.hp > 0).map((m) => keyOf(m)));
    const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
    const adj = dirs
      .map((d) => ({ x: P.x + d.x, y: P.y + d.y }))
      .filter(
        (np) =>
          tileAt(state.tiles, np) === "floor" &&
          !occ.has(keyOf(np)) &&
          !state.rocks.some((r) => r.x === np.x && r.y === np.y),
      );
    if (adj.length === 0) {
      return noHits(log(state, "Command: no adjacent space to summon."));
    }
    const pos = adj[Math.floor(Math.random() * adj.length)]!;
    const serial = nextMonsterSerial(state.monsters);
    const inst = createMonsterInstance(
      `monster_${serial}`,
      cmd.defId,
      pos.x,
      pos.y,
      state.monsterDefs,
      cmd.level,
    );
    const nm = state.monsterDefs.get(cmd.defId)?.name ?? cmd.defId;
    return noHits(
      log(
        { ...state, monsters: [...state.monsters, inst] },
        `Command: summoned ${nm} at level ${inst.level}.`,
      ),
    );
  }

  if (cmd.type === "DEV_CHANCE") {
    const po = cmd.playerOnly ? " (player rolls only)" : "";
    return noHits(
      log(
        { ...state, chanceMode: cmd.mode, chancePlayerOnly: cmd.playerOnly },
        `Command: Chance set to ${cmd.mode}${po}.`,
      ),
    );
  }

  if (cmd.type === "DEV_EDITOR") {
    if (cmd.enabled) {
      const editorModeBackup = state.editorModeBackup ?? {
        hp: state.player.hp,
        maxHp: state.player.maxHp,
        fogOfWar: state.fogOfWar,
      };
      return noHits(
        log(
          {
            ...state,
            fogOfWar: false,
            editorMode: true,
            editorModeBackup,
            player: { ...state.player, hp: 9999, maxHp: 9999 },
          },
          "Command: editor mode enabled.",
        ),
      );
    }

    if (!state.editorMode) {
      return noHits(log(state, "Command: editor mode is already disabled."));
    }

    const restoredPlayer = state.editorModeBackup
      ? {
          ...state.player,
          hp: state.editorModeBackup.hp,
          maxHp: state.editorModeBackup.maxHp,
        }
      : state.player;
    const next = revealAtPlayer({
      ...state,
      fogOfWar: state.editorModeBackup?.fogOfWar ?? true,
      editorMode: false,
      editorModeBackup: null,
      player: restoredPlayer,
    });
    return noHits(log(next, "Command: editor mode disabled."));
  }

  if (cmd.type === "DEV_EDITOR_CELL_ACTION") {
    if (!state.editorMode) return noHits(state);

    const monster = state.monsters.find(
      (m) => m.hp > 0 && m.x === cmd.x && m.y === cmd.y,
    );
    if (monster) {
      const name = state.monsterDefs.get(monster.defId)?.name ?? "Enemy";
      let next = {
        ...state,
        monsters: patchMonsterHp(state.monsters, monster.id, 0),
      };
      next = applyMonsterKillRewards(next, monster.defId, monster.x, monster.y);
      next = log(next, `Editor: ${name} killed.`);
      return withHits(next, [{ gridX: cmd.x, gridY: cmd.y, damage: monster.hp }]);
    }

    const destination = { x: cmd.x, y: cmd.y };
    const occupied = new Set<string>();
    for (const rock of state.rocks) occupied.add(keyOf(rock));
    for (const pot of state.pots) occupied.add(keyOf(pot));
    for (const chest of state.chests) occupied.add(keyOf(chest));
    for (const loot of state.groundLoot) occupied.add(keyOf(loot));
    for (const weed of state.tangleweeds) {
      if (weed.hp > 0) occupied.add(keyOf(weed));
    }
    if (state.stairFeatures) {
      occupied.add(keyOf(state.stairFeatures.pedestal));
      occupied.add(keyOf(state.stairFeatures.merchant));
    }
    occupied.add(keyOf({ x: state.player.x, y: state.player.y }));
    const bridgeTiles = new Set(state.bridgeTiles.map((p) => keyOf(p)));
    if (
      !isWalkable(
        state.tiles,
        state.width,
        state.height,
        destination,
        occupied,
        bridgeTiles,
      )
    ) {
      return noHits(state);
    }

    return noHits(
      log(
        {
          ...state,
          pending: null,
          player: { ...state.player, x: cmd.x, y: cmd.y },
        },
        `Editor: teleported to ${cmd.x},${cmd.y}.`,
      ),
    );
  }

  if (cmd.type === "DEV_GOTO_FLOOR") {
    const targetDepth = Math.max(1, Math.trunc(cmd.depth));
    let next = createNextFloorState(state, { depth: targetDepth });
    next = reshufflePlayerDeck(next);
    const drawN = playerDrawCountPerTurn(next);
    next = ensureEquippedOnTopOfDraw(next);
    next = drawFromPlayerDeck(next, drawN, true);
    next = applyPerTurnSkillResourcesAfterDraw(next);
    next = revealAtPlayer(next);
    next = collectAdjacentLoot(next);
    next = log(next, `Command: jumped to floor ${next.depth} (danger ${next.danger}). Deck reshuffled, new hand drawn.`);
    next = log(next, `— Turn ${next.turn} — You draw ${drawN} cards.`);
    return noHits({ ...next, phase: "player", pending: null });
  }

  if (cmd.type === "DEV_SET_THEME") {
    let next = createNextFloorState(state, {
      depth: state.depth,
      theme: cmd.theme,
      danger: state.danger,
    });
    next = reshufflePlayerDeck(next);
    const drawN = playerDrawCountPerTurn(next);
    next = ensureEquippedOnTopOfDraw(next);
    next = drawFromPlayerDeck(next, drawN, true);
    next = applyPerTurnSkillResourcesAfterDraw(next);
    next = revealAtPlayer(next);
    next = collectAdjacentLoot(next);
    next = log(
      next,
      `Command: regenerated floor ${next.depth} as ${cmd.theme} (danger ${next.danger}).`,
    );
    next = log(next, `— Turn ${next.turn} — You draw ${drawN} cards.`);
    return noHits({ ...next, phase: "player", pending: null });
  }

  return noHits(state);
}

function applyMonsterKillRewards(
  state: GameState,
  defId: string,
  x: number,
  y: number,
): GameState {
  let next = state;
  if (defId === "mimic") {
    next = applyMimicDeathLoot(next);
  }
  const drop = maybeDropMonsterCoin(next.groundLoot, x, y);
  if (drop.dropped) next = log({ ...next, groundLoot: drop.groundLoot }, "The monster dropped 1 gold.");
  const power = next.monsterDefs.get(defId)?.power ?? 3;
  return addExp(next, power);
}

/** Mimics spill chest-table loot when slain. */
function applyMimicDeathLoot(state: GameState): GameState {
  let next = log(state, "The Mimic spills its hoard!");
  const loot = rollChestLoot();
  switch (loot.kind) {
    case "coins":
      return log(
        {
          ...next,
          player: { ...next.player, gold: next.player.gold + loot.amount },
        },
        `Mimic loot: +${loot.amount} gold.`,
      );
    case "bread":
      return log(
        {
          ...next,
          player: { ...next.player, bread: next.player.bread + 1 },
        },
        "Mimic loot: a loaf of bread.",
      );
    case "cardChoice": {
      const cards = pickChestOfferCards(next.cardDefs, loot.tier, next.depth);
      return log(
        { ...next, chestOffer: { cards } },
        "Mimic loot: inscribed cards — take one, or leave them all.",
      );
    }
  }
}

function fireBurnDamage(maxHp: number): number {
  return Math.max(1, Math.floor(maxHp * 0.2));
}

/** After the player's turn: Fire level −1 and 20% max HP damage. */
function tickPlayerFire(s: GameState): GameState {
  const lv = s.player.fireLevels ?? 0;
  if (lv <= 0) return s;
  const dmg = fireBurnDamage(s.player.maxHp);
  const hp = Math.max(0, s.player.hp - dmg);
  let next: GameState = {
    ...s,
    player: { ...s.player, hp, fireLevels: lv - 1 },
  };
  next = log(next, `Fire burns you for ${dmg} (${lv - 1} left).`);
  if (hp <= 0) return { ...next, phase: "defeat" };
  return next;
}

function playerEntangled(s: GameState): boolean {
  return s.tangleweeds.some((tw) => tw.hp > 0 && tw.x === s.player.x && tw.y === s.player.y);
}

function tryKnockMonsterFromPlayer(
  s: GameState,
  mon: MonsterInstance,
  moveAnims?: TurnAnimEvent[],
): GameState {
  const dx = Math.sign(mon.x - s.player.x);
  const dy = Math.sign(mon.y - s.player.y);
  if (dx === 0 && dy === 0) return log(s, "No knockback direction.");
  const nx = mon.x + dx;
  const ny = mon.y + dy;
  if (nx < 0 || ny < 0 || nx >= s.width || ny >= s.height) return s;
  const np: Point = { x: nx, y: ny };
  if (tileAt(s.tiles, np) !== "floor") return log(s, "A wall blocks the knockback.");
  if (s.monsters.some((m) => m.hp > 0 && m.x === nx && m.y === ny))
    return log(s, "Another creature blocks the knockback.");
  if (s.player.x === nx && s.player.y === ny) return s;
  if (s.pots.some((p) => p.x === nx && p.y === ny)) return log(s, "Something blocks the knockback.");
  if (s.chests.some((c) => c.x === nx && c.y === ny)) return log(s, "A chest blocks the knockback.");
  if (s.rocks.some((r) => r.x === nx && r.y === ny)) return log(s, "Rubble blocks the knockback.");
  if (moveAnims) pushMoveAnim(moveAnims, mon.id, mon, np);
  const monsters = s.monsters.map((m) => (m.id === mon.id ? { ...m, x: nx, y: ny } : m));
  return log({ ...s, monsters }, "Knockback sends them reeling!");
}

/** Apply knockback N times in the direction away from the player. */
function tryKnockMonsterFromPlayerN(
  s: GameState,
  monId: string,
  times: number,
  moveAnims?: TurnAnimEvent[],
): GameState {
  for (let i = 0; i < times; i++) {
    const cur = s.monsters.find((m) => m.id === monId && m.hp > 0);
    if (!cur) break;
    s = tryKnockMonsterFromPlayer(s, cur, moveAnims);
  }
  return s;
}

function tryKnockMonsterInDirection(
  s: GameState,
  monId: string,
  dx: number,
  dy: number,
  times: number,
  moveAnims?: TurnAnimEvent[],
): GameState {
  for (let i = 0; i < times; i++) {
    const mon = s.monsters.find((m) => m.id === monId && m.hp > 0);
    if (!mon) break;
    const nx = mon.x + dx;
    const ny = mon.y + dy;
    const blocked =
      nx < 0 ||
      ny < 0 ||
      nx >= s.width ||
      ny >= s.height ||
      tileAt(s.tiles, { x: nx, y: ny }) !== "floor" ||
      s.monsters.some((m) => m.id !== monId && m.hp > 0 && m.x === nx && m.y === ny) ||
      (s.player.x === nx && s.player.y === ny) ||
      s.pots.some((p) => p.x === nx && p.y === ny) ||
      s.chests.some((c) => c.x === nx && c.y === ny) ||
      s.rocks.some((r) => r.x === nx && r.y === ny);
    if (blocked) break;
    if (moveAnims) pushMoveAnim(moveAnims, monId, mon, { x: nx, y: ny });
    s = {
      ...s,
      monsters: s.monsters.map((m) =>
        m.id === monId ? { ...m, x: nx, y: ny } : m,
      ),
    };
  }
  return s;
}

/** Apply Fire levels to a monster instance, returning updated monsters array. */
function applyFireToMonster(
  monsters: MonsterInstance[],
  monId: string,
  levels: number,
): MonsterInstance[] {
  return monsters.map((m) =>
    m.id === monId ? { ...m, fireLevels: (m.fireLevels ?? 0) + levels } : m,
  );
}

function applyPoisonToMonsters(
  monsters: MonsterInstance[],
  monsterIds: readonly string[],
  levels: number,
): MonsterInstance[] {
  const ids = new Set(monsterIds);
  return monsters.map((m) =>
    ids.has(m.id) ? { ...m, poisonLevels: (m.poisonLevels ?? 0) + levels } : m,
  );
}

function weaponAttackRollRaw(s: GameState, cardId: string | undefined, minD: number, maxD: number): number {
  const def = cardId ? s.cardDefs.get(cardId) : undefined;
  let r = rollInt(minD, maxD);
  r += attackStrengthBonus(s);
  r += fighterTrainingBonus(s, def);
  r += heavyPunchBonus(s, def);
  if (s.player.nextPhysicalAttackMultiplier !== 1 && def?.tags?.includes("physical attack")) {
    r = Math.floor(r * s.player.nextPhysicalAttackMultiplier);
  }
  return r;
}

function magicAttackRollRaw(s: GameState, cardId: string, minD: number, maxD: number): number {
  const def = s.cardDefs.get(cardId);
  let r = rollInt(minD, maxD);
  r += attackStrengthBonus(s);
  r += mageTrainingBonus(s, def);
  return r;
}

function applySkillUnlockPassives(s: GameState, skillId: string): GameState {
  const p = s.player;
  switch (skillId) {
    case SID.VIT_RES: {
      const maxHp = p.maxHp + 2;
      const hp = Math.min(maxHp, p.hp + 2);
      return { ...s, player: { ...p, maxHp, hp } };
    }
    case SID.VIT_RES_II: {
      const maxHp = p.maxHp + 3;
      const hp = Math.min(maxHp, p.hp + 3);
      return { ...s, player: { ...p, maxHp, hp } };
    }
    case SID.VIT_TOUGH: {
      const maxHp = p.maxHp + 5;
      const hp = Math.min(maxHp, p.hp + 5);
      return { ...s, player: { ...p, maxHp, hp } };
    }
    case SID.DECK_BUILDER:
      return { ...s, deckBuilderOffer: { step: "choose_type" } };
    case SID.MOB_GOLD:
      return appendGoldSeekerBonusCoin(s);
    default:
      return s;
  }
}

function unlockSkillDispatch(state: GameState, skillId: string): DispatchResult {
  if (state.phase !== "player" && state.phase !== "peace") {
    return noHits(log(state, "You can only spend skill points during your turn or in peace."));
  }
  if (state.phase === "player" && state.pending) {
    return noHits(log(state, "Resolve or cancel your pending action first."));
  }
  if (choiceModalBlocksProgression(state)) {
    return noHits(log(state, "Resolve the open offer first."));
  }
  const def = getSkillDef(skillId);
  if (!def) return noHits(log(state, "Unknown skill."));
  if (state.player.skillsUnlocked.includes(skillId)) {
    return noHits(log(state, "Already unlocked."));
  }
  for (const r of def.requires) {
    if (!state.player.skillsUnlocked.includes(r)) {
      return noHits(log(state, "Prerequisites not met."));
    }
  }
  if (state.player.skillPoints < def.cost) {
    return noHits(log(state, "Not enough skill points."));
  }
  let next: GameState = {
    ...state,
    player: {
      ...state.player,
      skillPoints: state.player.skillPoints - def.cost,
      skillsUnlocked: [...state.player.skillsUnlocked, skillId],
    },
  };
  next = applySkillUnlockPassives(next, skillId);
  return noHits(log(next, `Unlocked skill: ${def.name}.`));
}

function noHits(s: GameState): DispatchResult {
  return { state: s, hits: [], anims: [] };
}

function withHits(s: GameState, hits: HitVisual[], extraAnims: TurnAnimEvent[] = []): DispatchResult {
  return { state: s, hits, anims: [...animsFromHits(hits, s), ...extraAnims] };
}

/** Attack first (HP at pre-knockback positions), then knockback move tweens. */
function withHitsThenKnockback(
  afterHit: GameState,
  hits: HitVisual[],
  survivorIds: string[],
  knockback: number,
): DispatchResult {
  const knockMoves: TurnAnimEvent[] = [];
  const state = applyKnockbackToMonsters(afterHit, survivorIds, knockback, knockMoves);
  return {
    state,
    hits,
    anims: [...animsFromHits(hits, afterHit), ...knockMoves],
  };
}

function playerAttackFx(s: GameState, kind: AttackFxKind): HitVisual["fx"] {
  return { kind, fromX: s.player.x, fromY: s.player.y };
}

function hitAt(s: GameState, x: number, y: number, damage: number, kind: AttackFxKind): HitVisual {
  return { gridX: x, gridY: y, damage, fx: playerAttackFx(s, kind) };
}

function occupiedByMonsters(state: GameState): Set<string> {
  const s = new Set<string>();
  for (const m of state.monsters) {
    if (m.hp > 0) s.add(keyOf(m));
  }
  return s;
}

function occupiedForPlayerMove(state: GameState): Set<string> {
  const occ = occupiedByMonsters(state);
  for (const m of state.monsters) {
    if (m.defId === "mimic" && m.mimicAsleep && m.hp > 0) occ.delete(keyOf(m));
  }
  for (const tw of state.tangleweeds) {
    if (tw.hp > 0) occ.add(keyOf(tw));
  }
  return occ;
}

function bridgeTileKeySet(s: GameState): Set<string> {
  return new Set(s.bridgeTiles.map(keyOf));
}

function addAdjacentPureWaterTiles(s: GameState, reach: Set<string>, from: Point): Set<string> {
  const bridgeKeys = bridgeTileKeySet(s);
  const out = new Set(reach);
  const seeds: Point[] = [{ ...from }];
  for (const k of reach) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    seeds.push({ x, y });
  }
  for (const p of seeds) {
    for (const o of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const q = { x: p.x + o.x, y: p.y + o.y };
      if (!inBounds(q, s.width, s.height)) continue;
      if (tileAt(s.tiles, q) !== "water") continue;
      if (bridgeKeys.has(keyOf(q))) continue;
      out.add(keyOf(q));
    }
  }
  return out;
}

function applyFloodingTick(s: GameState): GameState {
  const rid = s.floodingRoomId;
  if (rid === null) return s;
  const candidates: Point[] = [];
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (s.roomIds[y][x] !== rid) continue;
      if (s.tiles[y][x] !== "floor") continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) {
    return log({ ...s, floodingRoomId: null }, "The flood fills its chamber.");
  }
  shuffleInPlace(candidates);
  const n = Math.min(s.danger + 1, candidates.length);
  const tiles = cloneTileGrid(s.tiles);
  for (let i = 0; i < n; i++) {
    const p = candidates[i]!;
    tiles[p.y][p.x] = "water";
  }
  let next: GameState = { ...s, tiles };
  if (candidates.length <= n) {
    next = { ...next, floodingRoomId: null };
  }
  return log(next, "Water rises…");
}

function applyPendingStalactiteDamage(s: GameState): GameState {
  if (s.pendingStalactites.length === 0) return s;
  const envDmg = 4 + s.danger;
  let next: GameState = { ...s, pendingStalactites: [] };
  const seen = new Set<string>();
  for (const pos of s.pendingStalactites) {
    const k = keyOf(pos);
    if (seen.has(k)) continue;
    seen.add(k);
    if (next.player.x === pos.x && next.player.y === pos.y) {
      const dmg = incomingDamageToPlayer(next, envDmg);
      const hp = Math.max(0, next.player.hp - dmg);
      next = { ...next, player: { ...next.player, hp } };
      next = log(next, `Stalactites crash down — ${dmg} damage!`);
      if (hp <= 0) return { ...next, phase: "defeat" };
    }
    next = {
      ...next,
      monsters: next.monsters.map((m) => {
        if (m.hp <= 0 || m.x !== pos.x || m.y !== pos.y) return m;
        return { ...m, hp: Math.max(0, m.hp - envDmg) };
      }),
    };
    next = {
      ...next,
      tangleweeds: next.tangleweeds.map((tw) =>
        tw.x === pos.x && tw.y === pos.y ? { ...tw, hp: tw.hp - envDmg } : tw,
      ),
    };
  }
  return next;
}

function cloneTileGrid(tiles: TileKind[][]): TileKind[][] {
  return tiles.map((row) => [...row]);
}

function findNearestFloorEscape(state: GameState, from: Point): Point | null {
  const occ = occupiedByMonsters(state);
  let best: Point | null = null;
  let bestD = Infinity;
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      if (tileAt(state.tiles, { x, y }) !== "floor") continue;
      if (state.rocks.some((r) => r.x === x && r.y === y)) continue;
      if (occ.has(keyOf({ x, y }))) continue;
      if (state.pots.some((p) => p.x === x && p.y === y)) continue;
      if (state.chests.some((c) => c.x === x && c.y === y)) continue;
      const d = manhattan({ x, y }, from);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

const COLLAPSE_CRUSH_DAMAGE = 20;

function applyPendingCollapse(state: GameState): { state: GameState; hits: HitVisual[] } {
  const hits: HitVisual[] = [];
  const keys = new Set<string>();
  if (state.pendingCollapse?.tiles) {
    for (const t of state.pendingCollapse.tiles) keys.add(keyOf(t));
  }
  if (state.pendingTargetedCollapse) {
    for (const t of state.pendingTargetedCollapse) keys.add(keyOf(t));
  }
  if (keys.size === 0) return { state: state, hits };

  let next: GameState = {
    ...state,
    pendingCollapse: null,
    pendingTargetedCollapse: null,
    dungeonCardReveal: {
      title: "Collapse!",
      summary: "The ceiling gives way — stone seals parts of the floor.",
    },
  };
  const tiles = cloneTileGrid(state.tiles);
  for (const k of keys) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    if (tiles[y]?.[x] === "floor") tiles[y][x] = "blocked";
  }
  next = { ...next, tiles };

  const crushedMonsterIds = new Set<string>();
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    if (!keys.has(keyOf(m))) continue;
    crushedMonsterIds.add(m.id);
    const nh = Math.max(0, m.hp - COLLAPSE_CRUSH_DAMAGE);
    next = {
      ...next,
      monsters: setMonsterHpWithDouvlonSync(next.monsters, m.id, nh),
    };
    hits.push({ gridX: m.x, gridY: m.y, damage: COLLAPSE_CRUSH_DAMAGE });
  }
  next = { ...next, monsters: cullMonstersWithDouvlonPairs(next.monsters) };

  const rewardedPairs = new Set<string>();
  for (const id of crushedMonsterIds) {
    const survived = next.monsters.some((m) => m.id === id && m.hp > 0);
    if (survived) continue;
    const om = state.monsters.find((x) => x.id === id);
    if (!om) continue;
    if (om.defId === "douvlon" && om.douvlonPairId) {
      if (rewardedPairs.has(om.douvlonPairId)) continue;
      rewardedPairs.add(om.douvlonPairId);
    }
    next = log(
      next,
      `${state.monsterDefs.get(om.defId)?.name ?? "Monster"} is crushed by falling stone.`,
    );
    next = applyMonsterKillRewards(next, om.defId, om.x, om.y);
  }

  const playerHere = keyOf({ x: next.player.x, y: next.player.y });
  if (keys.has(playerHere)) {
    const dmg = incomingDamageToPlayer(next, COLLAPSE_CRUSH_DAMAGE);
    hits.push({ gridX: next.player.x, gridY: next.player.y, damage: dmg });
    const hp = Math.max(0, next.player.hp - dmg);
    next = { ...next, player: { ...next.player, hp } };
    if (hp <= 0) {
      return {
        state: log({ ...next, phase: "defeat", player: { ...next.player, hp: 0 } }, "You are buried in the collapse."),
        hits,
      };
    }
    const escapeTo = findNearestFloorEscape(next, { x: next.player.x, y: next.player.y });
    if (escapeTo) {
      next = {
        ...next,
        player: { ...next.player, x: escapeTo.x, y: escapeTo.y },
      };
      next = revealAtPlayer(next);
      next = resolvePlayerEnterTile(next, escapeTo.x, escapeTo.y);
      next = log(next, "You scramble out from under the falling rock!");
    }
  }

  return { state: log(next, "The collapse settles."), hits };
}

function removeHandIndices(hand: string[], indices: number[]): { nextHand: string[]; removed: string[] } {
  const sorted = [...new Set(indices)].sort((a, b) => b - a);
  const nextHand = [...hand];
  const removed: string[] = [];
  for (const ix of sorted) {
    if (ix < 0 || ix >= nextHand.length) continue;
    const [c] = nextHand.splice(ix, 1);
    if (c !== undefined) removed.push(c);
  }
  return { nextHand, removed };
}

function awakenMimicOnTile(s: GameState, x: number, y: number): GameState {
  return {
    ...s,
    monsters: s.monsters.map((m) =>
      m.defId === "mimic" && m.x === x && m.y === y && m.mimicAsleep
        ? { ...m, mimicAsleep: false, aiStateId: "awake" }
        : m,
    ),
  };
}

function extendMoveReachForPending(
  state: GameState,
  base: Set<string>,
  from: Point,
  pending:
    | { kind: "play_move" }
    | { kind: "discard_move1" }
    | { kind: "play_card_seeker" }
    | { kind: "move_token_step" },
): Set<string> {
  const need =
    pending.kind === "play_move" || pending.kind === "play_card_seeker" ? 2 : 1;
  const can = state.player.hand.length >= need;
  return extendReachableWithBlockedDestinations(
    base,
    from,
    state.tiles,
    state.width,
    state.height,
    can,
    occupiedForPlayerMove(state),
  );
}

function patchMonsterHp(monsters: MonsterInstance[], monId: string, hp: number): MonsterInstance[] {
  let ms = setMonsterHpWithDouvlonSync(monsters, monId, hp);
  ms = cullMonstersWithDouvlonPairs(ms);
  return ms;
}

function rockKeySet(state: GameState): Set<string> {
  return new Set(state.rocks.map((r) => keyOf(r)));
}

function rollTrapDamage(): number {
  const r = Math.random();
  if (r < 0.4) return 5;
  if (r < 0.6) return 3;
  if (r < 0.8) return 1;
  return 0;
}

function nextRockSerial(rocks: RockInstance[]): number {
  let n = 0;
  for (const rk of rocks) {
    const mm = /^rock_(\d+)$/.exec(rk.id);
    if (mm) n = Math.max(n, parseInt(mm[1]!, 10) + 1);
  }
  return n;
}

function tileBlockedForDeepSpawn(s: GameState, x: number, y: number): boolean {
  if (s.player.x === x && s.player.y === y) return true;
  if (s.rocks.some((r) => r.x === x && r.y === y)) return true;
  if (s.monsters.some((m) => m.hp > 0 && m.x === x && m.y === y)) return true;
  if (s.pots.some((p) => p.x === x && p.y === y)) return true;
  if (s.chests.some((c) => c.x === x && c.y === y)) return true;
  return false;
}

function spawnMonstersFromDeep(s: GameState): { state: GameState; lines: string[] } {
  const lines: string[] = [];
  const attempts = 2 + s.depth;
  const px = s.player.x;
  const py = s.player.y;
  const playerRid = s.roomIds[py]?.[px] ?? -1;
  const eligibleRids = new Set<number>();
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (s.tiles[y][x] !== "floor") continue;
      const rid = s.roomIds[y][x];
      if (rid < 0 || rid === playerRid) continue;
      const kind = s.roomKinds[rid] ?? "normal";
      if (kind === "entrance" || kind === "normal" || kind === "corridor" || kind === "treasure") {
        eligibleRids.add(rid);
      }
    }
  }
  const pool = [...eligibleRids];
  if (pool.length === 0) {
    lines.push("Nothing stirs — nowhere else to spawn.");
    return { state: s, lines };
  }
  let next = s;
  let serial = nextMonsterSerial(s.monsters);
  for (let a = 0; a < attempts; a++) {
    const rid = pool[rollInt(0, pool.length - 1)]!;
    const kind = s.roomKinds[rid] ?? "normal";
    const cells: Point[] = [];
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        if (next.tiles[y][x] !== "floor") continue;
        if (next.roomIds[y][x] !== rid) continue;
        if (tileBlockedForDeepSpawn(next, x, y)) continue;
        cells.push({ x, y });
      }
    }
    if (cells.length === 0) continue;
    shuffleInPlace(cells);
    const p = cells[0]!;
    const defId = pickMonsterId(kind, next.monsterDefs, next.depth, next.floorTheme);
    next = {
      ...next,
      monsters: [
        ...next.monsters,
        createMonsterInstance(`monster_${serial++}`, defId, p.x, p.y, next.monsterDefs, next.danger),
      ],
    };
    const nm = next.monsterDefs.get(defId)?.name ?? defId;
    lines.push(`Something emerges in another room (${nm}).`);
  }
  return { state: next, lines };
}

function applyFallingRocksCard(s: GameState): { state: GameState; hits: HitVisual[]; lines: string[] } {
  const hits: HitVisual[] = [];
  const lines: string[] = [];
  let next = s;
  const eligibleRids = new Set<number>();
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (next.tiles[y][x] !== "floor") continue;
      const rid = next.roomIds[y][x];
      if (rid < 0) continue;
      const k = next.roomKinds[rid];
      if (k === "gauntlet" || k === "gauntlet_corridor") continue;
      eligibleRids.add(rid);
    }
  }
  const roomList = [...eligibleRids];
  let rockSerial = nextRockSerial(next.rocks);
  let rocks = [...next.rocks];

  for (let wave = 0; wave < next.depth; wave++) {
    for (const rid of roomList) {
      if (Math.random() >= 1 / 6) continue;
      const cells: Point[] = [];
      for (let y = 0; y < next.height; y++) {
        for (let x = 0; x < next.width; x++) {
          if (next.tiles[y][x] !== "floor") continue;
          if (next.roomIds[y][x] !== rid) continue;
          if (x === next.player.x && y === next.player.y) continue;
          if (next.chests.some((c) => c.x === x && c.y === y)) continue;
          if (rocks.some((r) => r.x === x && r.y === y)) continue;
          cells.push({ x, y });
        }
      }
      if (cells.length === 0) continue;
      const pick = cells[rollInt(0, cells.length - 1)]!;
      const { x, y } = pick;

      const monIdx = next.monsters.findIndex((m) => m.hp > 0 && m.x === x && m.y === y);
      if (monIdx >= 0) {
        const m = next.monsters[monIdx]!;
        const nh = m.hp - 5;
        hits.push({ gridX: x, gridY: y, damage: 5 });
        const monsters = [...next.monsters];
        if (nh <= 0) monsters.splice(monIdx, 1);
        else monsters[monIdx] = { ...m, hp: nh };
        next = { ...next, monsters };
        lines.push(`A rock slams a creature for 5 damage.`);
      }

      const pot = next.pots.find((p) => p.x === x && p.y === y);
      if (pot) {
        next = { ...next, pots: next.pots.filter((p) => p.id !== pot.id) };
        lines.push("A rock crushes a pot.");
      }

      rocks = rocks.filter((r) => r.x !== x || r.y !== y);
      rocks.push({ id: `rock_${rockSerial++}`, x, y });
      next = { ...next, rocks };
    }
  }
  if (lines.length === 0) {
    lines.push("Dust falls, but no rocks strike.");
  }
  return { state: next, hits, lines };
}

function pickRandomDeckCardForGroundLoot(state: GameState): string {
  return pickRandomLootCardId(state.cardDefs, state.depth);
}

function enqueueCardPickup(s: GameState, cardId: string): GameState {
  const prev = s.cardPickupOffer?.queue ?? [];
  return { ...s, cardPickupOffer: { queue: [...prev, cardId] } };
}

/** Played equipped cards return to the top; all other played cards go to discard. */
function playerAfterPlayingCard(
  s: GameState,
  hand: string[],
  cardId: string,
): GameState["player"] {
  if (s.player.equipped === cardId) {
    return {
      ...s.player,
      hand,
      drawPile: [cardId, ...s.player.drawPile],
    };
  }
  return {
    ...s.player,
    hand,
    discardPile: [...s.player.discardPile, cardId],
  };
}

function roomKindAt(s: GameState, x: number, y: number): RoomKind | null {
  const rid = s.roomIds[y]?.[x] ?? -1;
  if (rid < 0) return null;
  return s.roomKinds[rid] ?? null;
}

function spawnGroundCardLootInDiscovered(state: GameState, count: number): GameState {
  const blocked = new Set<string>();
  blocked.add(keyOf(state.player));
  for (const p of state.pots) blocked.add(keyOf(p));
  for (const c of state.chests) blocked.add(keyOf(c));
  for (const g of state.groundLoot) blocked.add(keyOf(g));

  const candidates: Point[] = [];
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      if (state.tiles[y][x] !== "floor") continue;
      const rk = roomKindAt(state, x, y);
      if (rk === "gauntlet" || rk === "gauntlet_corridor") continue;
      if (state.fogOfWar && !state.discovered.has(keyOf({ x, y }))) continue;
      if (blocked.has(keyOf({ x, y }))) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) {
    return log(state, "Nowhere visible to drop cards.");
  }
  shuffleInPlace(candidates);
  let maxN = 0;
  for (const g of state.groundLoot) {
    const m = /^gloot_(\d+)$/.exec(g.id);
    if (m) maxN = Math.max(maxN, parseInt(m[1]!, 10));
  }
  let nextLoot = [...state.groundLoot];
  const placed = Math.min(count, candidates.length);
  for (let i = 0; i < placed; i++) {
    const p = candidates[i]!;
    maxN += 1;
    const cardId = pickRandomDeckCardForGroundLoot(state);
    nextLoot.push({ id: `gloot_${maxN}`, x: p.x, y: p.y, kind: "card", cardId });
  }
  let s = { ...state, groundLoot: nextLoot };
  s = log(s, placed < count ? `Dropped ${placed} card(s) on the ground (no more room).` : `Dropped ${placed} card(s) on the ground.`);
  return s;
}

function spawnGroundCoinsInDungeon(state: GameState, count: number): GameState {
  if (count <= 0) return log(state, "Loot and Scoot finds no loose coins.");
  const blocked = new Set<string>([
    keyOf(state.player),
    ...state.pots.map(keyOf),
    ...state.chests.map(keyOf),
    ...state.groundLoot.map(keyOf),
  ]);
  const candidates: Point[] = [];
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      if (state.tiles[y][x] !== "floor" || blocked.has(keyOf({ x, y }))) continue;
      candidates.push({ x, y });
    }
  }
  shuffleInPlace(candidates);
  let serial = nextGroundLootSerial(state);
  const placed = Math.min(count, candidates.length);
  const groundLoot = [...state.groundLoot];
  for (let i = 0; i < placed; i++) {
    const p = candidates[i]!;
    groundLoot.push({ id: `gloot_${serial++}`, x: p.x, y: p.y, kind: "coin", amount: 1 });
  }
  return log({ ...state, groundLoot }, `Loot and Scoot scatters ${placed} coin${placed === 1 ? "" : "s"}.`);
}

function sealGauntletCorridorTiles(s: GameState): GameState {
  const tiles = s.tiles.map((row) => [...row]);
  const roomIds = s.roomIds.map((row) => [...row]);
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const rid = roomIds[y][x];
      if (rid < 0) continue;
      if (s.roomKinds[rid] === "gauntlet_corridor") {
        tiles[y][x] = "wall";
        roomIds[y][x] = -1;
      }
    }
  }
  return { ...s, tiles, roomIds };
}

function gauntletPowerPartitions(totalPower: number, maxMonsters: number, depth: number): number[][] {
  const validPowers = depth >= 5 ? [2, 4, 5, 8] : [2, 4, 5];
  const res: number[][] = [];
  function bt(rem: number, path: number[]) {
    if (path.length > maxMonsters) return;
    if (rem === 0) {
      res.push([...path]);
      return;
    }
    for (const p of validPowers) {
      if (p <= rem) bt(rem - p, [...path, p]);
    }
  }
  bt(totalPower, []);
  return res;
}

function defIdForGauntletPower(
  p: number,
  depth: number,
  monsterDefs: Map<string, MonsterDef>,
  theme: FloorTheme,
): string {
  if (p === 8) return "elite_skeleton";
  if (p === 5) return "rockling";
  if (p === 4) {
    if (depth >= 5) return pickWeightedDefId(["skeleton", "mystic_core", "shadow_rodent"], monsterDefs);
    return pickWeightedDefId(["skeleton", "mystic_core"], monsterDefs);
  }
  if (depth >= 5) return "slime";
  // Overgrown: no Dust Rats — Vineshons take their place.
  const lowTier = theme === "overgrown" ? ["slime", "vineshon"] : ["slime", "dune_rat"];
  return pickWeightedDefId(lowTier, monsterDefs);
}

function collectGauntletSpawnCells(
  s: GameState,
  gauntletRid: number,
  excludeOrthoAdjacentToPlayer: boolean,
): Point[] {
  const px = s.player.x;
  const py = s.player.y;
  const out: Point[] = [];
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (s.tiles[y][x] !== "floor") continue;
      if (s.roomIds[y][x] !== gauntletRid) continue;
      if (x === px && y === py) continue;
      if (excludeOrthoAdjacentToPlayer && Math.abs(x - px) + Math.abs(y - py) === 1) continue;
      out.push({ x, y });
    }
  }
  return out;
}

function nextMonsterSerial(monsters: MonsterInstance[]): number {
  let n = 0;
  for (const m of monsters) {
    const mm = /^monster_(\d+)$/.exec(m.id);
    if (mm) n = Math.max(n, parseInt(mm[1]!, 10) + 1);
  }
  return n;
}

function spawnGauntletWave(s: GameState): GameState {
  const gauntletRid = s.roomKinds.findIndex((k) => k === "gauntlet");
  if (gauntletRid < 0) return s;
  let candidates = collectGauntletSpawnCells(s, gauntletRid, true);
  if (candidates.length < 3) {
    candidates = collectGauntletSpawnCells(s, gauntletRid, false);
  }
  const totalPower = s.depth * 5 + 5;
  const options = gauntletPowerPartitions(totalPower, candidates.length, s.depth);
  if (options.length === 0) {
    return log(s, "Gauntlet spawn failed — not enough space.");
  }
  const powers = options[Math.floor(Math.random() * options.length)]!;
  const roster = powers.map((p) => defIdForGauntletPower(p, s.depth, s.monsterDefs, s.floorTheme));
  shuffleInPlace(roster);
  shuffleInPlace(candidates);
  let serial = nextMonsterSerial(s.monsters);
  const newMons = [...s.monsters];
  for (let i = 0; i < roster.length; i++) {
    const defId = roster[i]!;
    const p = candidates[i]!;
    newMons.push(
      createMonsterInstance(`monster_${serial++}`, defId, p.x, p.y, s.monsterDefs, s.danger, {
        spawnedInGauntlet: true,
      }),
    );
  }
  return { ...s, monsters: newMons };
}

function maybeCommenceGauntlet(s: GameState, enterX: number, enterY: number): GameState {
  if (s.gauntletCommenced) return s;
  const rid = s.roomIds[enterY]?.[enterX] ?? -1;
  if (rid < 0) return s;
  if (s.roomKinds[rid] !== "gauntlet") return s;
  let next = sealGauntletCorridorTiles({ ...s, gauntletCommenced: true });
  next = spawnGauntletWave(next);
  return log(next, "The way behind you seals shut — the gauntlet begins!");
}

function resolvePlayerEnterTile(s: GameState, x: number, y: number): GameState {
  let next = applyHarmingCloudEnter(s, x, y);
  if (next.phase === "defeat") return next;
  if (next.player.nextMoveDoubled) {
    next = { ...next, player: { ...next.player, nextMoveDoubled: false } };
  }
  next = collectAdjacentLoot(openChestAsPlayer(breakPotAsPlayer(next, x, y), x, y));
  next = maybeCommenceGauntlet(next, x, y);
  return next;
}

function applyHarmingCloudEnter(s: GameState, x: number, y: number): GameState {
  const cloud = s.harmingClouds.find((c) => c.x === x && c.y === y && c.turnsLeft > 0);
  if (!cloud) return s;
  const dmg = incomingDamageToPlayer(s, 5);
  const hp = Math.max(0, s.player.hp - dmg);
  let next: GameState = {
    ...s,
    player: { ...s.player, hp },
  };
  next = log(next, `The harming cloud burns you for ${dmg}!`);
  if (hp <= 0) return { ...next, phase: "defeat" };
  return next;
}

function tickHarmingClouds(s: GameState): GameState {
  if (s.harmingClouds.length === 0) return s;
  const clouds = s.harmingClouds
    .map((c) => ({ ...c, turnsLeft: c.turnsLeft - 1 }))
    .filter((c) => c.turnsLeft > 0);
  let next: GameState = { ...s, harmingClouds: clouds };
  if (clouds.length < s.harmingClouds.length) {
    next = log(next, "A harming cloud dissipates.");
  }
  return next;
}

function nextHarmingCloudId(s: GameState): string {
  let n = 0;
  for (const c of s.harmingClouds) {
    const m = /^harmcloud_(\d+)$/.exec(c.id);
    if (m) n = Math.max(n, parseInt(m[1]!, 10) + 1);
  }
  return `harmcloud_${n}`;
}

function consumeStrengthGemIfPhysical(s: GameState, cardId: string | undefined): GameState {
  if (s.player.nextPhysicalAttackMultiplier === 1) return s;
  const def = cardId ? s.cardDefs.get(cardId) : undefined;
  if (!def?.tags?.includes("physical attack")) return s;
  return {
    ...s,
    player: { ...s.player, nextPhysicalAttackMultiplier: 1 },
  };
}

/** Same tile or orthogonally adjacent; loot tile must be discovered in fog. */
function collectAdjacentLoot(s: GameState): GameState {
  const px = s.player.x;
  const py = s.player.y;
  const taken: GroundLootInstance[] = [];
  const rest: GroundLootInstance[] = [];
  for (const loot of s.groundLoot) {
    const d = Math.abs(loot.x - px) + Math.abs(loot.y - py);
    if (d > 1) {
      rest.push(loot);
      continue;
    }
    if (s.fogOfWar && !s.discovered.has(keyOf(loot))) {
      rest.push(loot);
      continue;
    }
    taken.push(loot);
  }
  if (taken.length === 0) return s;

  let gold = s.player.gold;
  let bread = s.player.bread;
  let herb = s.player.herb;
  let next: GameState = { ...s, groundLoot: rest };
  const lines: string[] = [];
  let cardFound = 0;
  for (const loot of taken) {
    const d0 =
      Math.abs(loot.x - px) + Math.abs(loot.y - py) === 0
        ? "At your feet — "
        : "Nearby — ";
    switch (loot.kind) {
      case "coin": {
        const a = loot.amount ?? 1;
        gold += a;
        lines.push(`${d0}+${a} gold.`);
        break;
      }
      case "bread":
        bread += 1;
        lines.push(`${d0}bread.`);
        break;
      case "herb":
        herb += 1;
        lines.push(`${d0}a healing herb.`);
        break;
      case "card": {
        const cid = loot.cardId ?? "move";
        next = enqueueCardPickup(next, cid);
        cardFound += 1;
        break;
      }
    }
  }
  next = {
    ...next,
    player: { ...next.player, gold, bread, herb },
  };
  for (const line of lines) next = log(next, line);
  if (cardFound === 1) next = log(next, "A card on the ground — add it to your deck?");
  if (cardFound > 1) next = log(next, `${cardFound} cards on the ground — decide each in turn.`);
  return next;
}

function nextGroundLootSerial(s: GameState): number {
  let n = 0;
  for (const g of s.groundLoot) {
    const mm = /^gloot_(\d+)$/.exec(g.id);
    if (mm) n = Math.max(n, parseInt(mm[1]!, 10) + 1);
  }
  return n;
}

/** Pot broken by a card attack — contents drop as ground loot, then same-tile/adjacent pickup. */
function breakPotFromAttack(s: GameState, px: number, py: number): GameState {
  const pot = s.pots.find((p) => p.x === px && p.y === py);
  if (!pot) return s;
  const pots = s.pots.filter((p) => p.id !== pot.id);
  let next: GameState = { ...s, pots };
  const loot = rollPotLoot(next.cardDefs, next.depth, potLootHitChance(next));
  let serial = nextGroundLootSerial(next);
  next = log(next, "The pot shatters!");
  switch (loot.kind) {
    case "nothing":
      return collectAdjacentLoot(log(next, "Nothing but dust inside."));
    case "coin": {
      const g: GroundLootInstance = {
        id: `gloot_${serial}`,
        x: px,
        y: py,
        kind: "coin",
        amount: loot.amount,
      };
      return collectAdjacentLoot(
        log({ ...next, groundLoot: [...next.groundLoot, g] }, "Coins spill onto the floor."),
      );
    }
    case "bread": {
      const g: GroundLootInstance = { id: `gloot_${serial}`, x: px, y: py, kind: "bread" };
      return collectAdjacentLoot(
        log({ ...next, groundLoot: [...next.groundLoot, g] }, "Bread tumbles out."),
      );
    }
    case "card": {
      const g: GroundLootInstance = {
        id: `gloot_${serial}`,
        x: px,
        y: py,
        kind: "card",
        cardId: loot.cardId,
      };
      return collectAdjacentLoot(
        log({ ...next, groundLoot: [...next.groundLoot, g] }, "A card flutters to the ground."),
      );
    }
  }
}

function breakPotAsPlayer(s: GameState, x: number, y: number): GameState {
  const pot = s.pots.find((p) => p.x === x && p.y === y);
  if (!pot) return s;
  const pots = s.pots.filter((p) => p.id !== pot.id);
  let next: GameState = { ...s, pots };
  const loot = rollPotLoot(s.cardDefs, s.depth, potLootHitChance(next));
  next = log(next, "You smash a pot!");
  switch (loot.kind) {
    case "nothing":
      return log(next, "Nothing but dust.");
    case "coin":
      return log(
        { ...next, player: { ...next.player, gold: next.player.gold + loot.amount } },
        `Inside: +${loot.amount} gold.`,
      );
    case "bread":
      return log(
        { ...next, player: { ...next.player, bread: next.player.bread + 1 } },
        "Inside: a loaf of bread!",
      );
    case "card": {
      const nm = next.cardDefs.get(loot.cardId)?.name ?? loot.cardId;
      return log(enqueueCardPickup(next, loot.cardId), `Inside: a card — ${nm}! Add it to your deck?`);
    }
  }
}

function breakPotAsMonster(s: GameState, x: number, y: number): GameState {
  const pot = s.pots.find((p) => p.x === x && p.y === y);
  if (!pot) return s;
  return log(
    { ...s, pots: s.pots.filter((p) => p.id !== pot.id) },
    "A slime smashes a pot.",
  );
}

function openChestAsPlayer(s: GameState, x: number, y: number): GameState {
  const chest = s.chests.find((c) => c.x === x && c.y === y);
  if (!chest) return s;
  const chests = s.chests.filter((c) => c.id !== chest.id);
  let next: GameState = { ...s, chests };
  const loot = rollChestLoot();
  next = log(next, "You open a chest!");
  switch (loot.kind) {
    case "coins":
      return log(
        {
          ...next,
          player: { ...next.player, gold: next.player.gold + loot.amount },
        },
        `Inside: +${loot.amount} gold.`,
      );
    case "bread":
      return log(
        {
          ...next,
          player: { ...next.player, bread: next.player.bread + 1 },
        },
        "Inside: a loaf of bread.",
      );
    case "cardChoice": {
      const cards = pickChestOfferCards(next.cardDefs, loot.tier, next.depth);
      return log(
        { ...next, chestOffer: { cards } },
        "Inside: inscribed cards — take one, or leave them all.",
      );
    }
  }
}

/**
 * Draw cards, normally skipping the equipped card so draw effects cannot
 * return it after it has been played this turn. Fresh-hand draws explicitly
 * opt in after placing the equipped card on top of the pile.
 */
function drawFromPlayerDeck(
  state: GameState,
  n: number,
  allowEquipped = false,
): GameState {
  let s = state;
  let hand = [...s.player.hand];
  for (let i = 0; i < n; i++) {
    if (s.player.drawPile.length === 0) {
      if (s.player.discardPile.length === 0) break;
      const nextDraw = [...s.player.discardPile];
      shuffleInPlace(nextDraw);
      s = {
        ...s,
        player: { ...s.player, drawPile: nextDraw, discardPile: [], hand },
      };
    }

    const equipped = allowEquipped ? null : s.player.equipped;
    let drawIndex = equipped
      ? s.player.drawPile.findIndex((id) => id !== equipped)
      : 0;

    // The equipped card may be the only card left in draw. Shuffle discard
    // behind it so another eligible card can still be drawn.
    if (drawIndex < 0 && s.player.discardPile.length > 0) {
      const shuffledDiscard = [...s.player.discardPile];
      shuffleInPlace(shuffledDiscard);
      s = {
        ...s,
        player: {
          ...s.player,
          drawPile: [...s.player.drawPile, ...shuffledDiscard],
          discardPile: [],
          hand,
        },
      };
      drawIndex = s.player.drawPile.findIndex((id) => id !== equipped);
    }

    if (drawIndex < 0 || s.player.drawPile.length === 0) break;
    const drawPile = [...s.player.drawPile];
    const [drawn] = drawPile.splice(drawIndex, 1);
    if (!drawn) break;
    hand = [...hand, drawn];
    s = { ...s, player: { ...s.player, drawPile, hand } };
  }
  return s;
}

function shuffleInPlace<T>(xs: T[]): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
}

function reshufflePlayerCards(s: GameState): GameState {
  const all = [...s.player.drawPile, ...s.player.discardPile, ...s.player.hand];
  shuffleInPlace(all);
  return {
    ...s,
    player: {
      ...s.player,
      drawPile: all,
      discardPile: [],
      hand: [],
    },
  };
}

function reshufflePlayerDeck(s: GameState): GameState {
  const reshuffled = reshufflePlayerCards(s);
  return {
    ...reshuffled,
    player: {
      ...reshuffled.player,
      suppressNextMove: false,
      defenseBonusThisTurn: 0,
      doublePunchThisTurn: false,
      moveTokens: 0,
      knockbackTokens: 0,
      knockbackPrimed: 0,
      hasteThisTurn: false,
    },
  };
}

/**
 * Guarantees the equipped card is drawn at the start of every turn: pulls one
 * copy out of the discard pile (or from deeper in the draw pile) and places it
 * on top of the draw pile before the turn's draw.
 */
function ensureEquippedOnTopOfDraw(s: GameState): GameState {
  const id = s.player.equipped;
  if (!id) return s;
  if (s.player.drawPile[0] === id) return s;
  const di = s.player.discardPile.lastIndexOf(id);
  if (di >= 0) {
    const discardPile = [...s.player.discardPile];
    discardPile.splice(di, 1);
    return {
      ...s,
      player: { ...s.player, discardPile, drawPile: [id, ...s.player.drawPile] },
    };
  }
  const dri = s.player.drawPile.indexOf(id);
  if (dri >= 0) {
    const drawPile = [...s.player.drawPile];
    drawPile.splice(dri, 1);
    return { ...s, player: { ...s.player, drawPile: [id, ...drawPile] } };
  }
  return s;
}

/** Clears the equipped marker when no copy of that card remains in the deck. */
function clearEquippedIfGone(s: GameState): GameState {
  const id = s.player.equipped;
  if (!id) return s;
  const anyLeft =
    s.player.hand.includes(id) ||
    s.player.drawPile.includes(id) ||
    s.player.discardPile.includes(id);
  if (anyLeft) return s;
  return { ...s, player: { ...s.player, equipped: null } };
}

function removeOneCardFromDeck(s: GameState, cardId: string): GameState | null {
  const handIdx = s.player.hand.indexOf(cardId);
  if (handIdx >= 0) {
    const hand = [...s.player.hand];
    hand.splice(handIdx, 1);
    return { ...s, player: { ...s.player, hand } };
  }
  const di = s.player.discardPile.lastIndexOf(cardId);
  if (di >= 0) {
    const discardPile = [...s.player.discardPile];
    discardPile.splice(di, 1);
    return { ...s, player: { ...s.player, discardPile } };
  }
  const dri = s.player.drawPile.indexOf(cardId);
  if (dri >= 0) {
    const drawPile = [...s.player.drawPile];
    drawPile.splice(dri, 1);
    return { ...s, player: { ...s.player, drawPile } };
  }
  return null;
}

function maybeActivatePedestal(s: GameState): GameState {
  if (s.pedestalUsed || !s.stairFeatures || s.pedestalOffer || s.deckDestroyPending) return s;
  const { pedestal } = s.stairFeatures;
  if (s.player.x !== pedestal.x || s.player.y !== pedestal.y) return s;
  const cards = pickPedestalOfferCards(s.cardDefs, s.depth);
  return { ...s, pedestalOffer: { cards } };
}

function maybeEliteTeleportAll(s: GameState): GameState {
  let next = s;
  for (const m of next.monsters) {
    if (m.defId !== "elite_skeleton") continue;
    if (m.hp <= 0 || m.hp > 6 || m.eliteTeleported) continue;

    const P = { x: next.player.x, y: next.player.y };
    const gauntletRid = next.roomKinds.findIndex((k) => k === "gauntlet");
    const occ = new Set(next.monsters.filter((x) => x.hp > 0 && x.id !== m.id).map((x) => keyOf(x)));

    const candidates: { x: number; y: number }[] = [];
    const fallback: { x: number; y: number }[] = [];
    for (let y = 0; y < next.height; y++) {
      for (let x = 0; x < next.width; x++) {
        if (next.tiles[y][x] !== "floor") continue;
        if (x === m.x && y === m.y) continue;
        if (occ.has(keyOf({ x, y }))) continue;
        if (m.spawnedInGauntlet && gauntletRid >= 0 && next.roomIds[y]?.[x] !== gauntletRid) continue;
        const dist = manhattan({ x, y }, P);
        if (dist >= 4) candidates.push({ x, y });
        else fallback.push({ x, y });
      }
    }

    const pool = candidates.length > 0 ? candidates : fallback;
    if (pool.length === 0) {
      next = {
        ...next,
        monsters: next.monsters.map((x) => (x.id === m.id ? { ...x, eliteTeleported: true } : x)),
      };
      continue;
    }

    const dest = pool[Math.floor(Math.random() * pool.length)]!;
    const nm = next.monsterDefs.get(m.defId)?.name ?? "Elite Skeleton";
    next = {
      ...next,
      monsters: next.monsters.map((x) =>
        x.id === m.id ? { ...x, x: dest.x, y: dest.y, eliteTeleported: true } : x,
      ),
    };
    next = log(next, `${nm} vanishes in a blur of bone and shadow!`);
  }
  return next;
}

export function processGauntletVictory(s: GameState): GameState {
  if (s.phase === "defeat" || s.phase === "peace") return s;
  if (!s.gauntletCommenced) return s;
  const gauntletRid = s.roomKinds.findIndex((k) => k === "gauntlet");
  if (gauntletRid < 0) return s;
  const alive = s.monsters.some(
    (m) => m.hp > 0 && s.roomIds[m.y]?.[m.x] === gauntletRid,
  );
  if (alive) return s;
  let next = attachStairRoom(s);
  next = reshufflePlayerDeck(next);
  next = log(
    next,
    "The gauntlet falls silent. A stair chamber opens — peace. Your deck is reshuffled.",
  );
  next = spawnMerchantAfterGauntlet(next);
  return {
    ...next,
    phase: "peace",
    pending: null,
    pedestalOffer: null,
    deckDestroyPending: false,
    dungeonCardReveal: null,
  };
}

/** Reveal every floor tile in the player's room and in any room orthogonally adjacent to the player. */
function revealAtPlayer(s: GameState): GameState {
  if (!s.fogOfWar) return s;
  const rooms = collectRoomIdsAdjacentToPlayer({
    width: s.width,
    height: s.height,
    tiles: s.tiles,
    roomIds: s.roomIds,
    player: s.player,
  });
  if (rooms.size === 0) return s;
  const next = new Set(s.discovered);
  addRoomsToDiscovered(next, s.tiles, s.roomIds, s.width, s.height, rooms);
  return { ...s, discovered: next };
}

function revealOneRandomRoom(state: GameState): { state: GameState; revealed: boolean } {
  const unseenByRoom = new Map<number, boolean>();
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      if (state.tiles[y][x] !== "floor") continue;
      const rid = state.roomIds[y][x];
      if (rid < 0) continue;
      const k = keyOf({ x, y });
      if (!state.discovered.has(k)) unseenByRoom.set(rid, true);
    }
  }
  const candidates = [...unseenByRoom.keys()];
  if (candidates.length === 0) {
    return { state: log(state, "You investigate — nothing new to reveal."), revealed: false };
  }
  const pick = candidates[rollInt(0, candidates.length - 1)]!;
  const nextDisc = new Set(state.discovered);
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      if (state.tiles[y][x] === "floor" && state.roomIds[y][x] === pick) {
        nextDisc.add(keyOf({ x, y }));
      }
    }
  }
  return {
    state: log(
      { ...state, discovered: nextDisc },
      "You investigate and piece together a distant room.",
    ),
    revealed: true,
  };
}

/** Scout: reveal one room that is still completely hidden (any tile unseen). */
function investigateRevealOneRoom(s: GameState): GameState {
  if (!s.fogOfWar) return s;
  if (s.scoutBlockedThisTurn) {
    return log(s, "The dust has settled — you can't scout this turn.");
  }
  const exploration =
    s.player.skillsUnlocked.includes(SID.MOB_EXPLORATION) && s.player.scoutUsesThisTurn === 0;

  const first = revealOneRandomRoom(s);
  let out = first.state;
  if (!first.revealed) {
    return { ...out, player: { ...out.player, scoutUsesThisTurn: out.player.scoutUsesThisTurn + 1 } };
  }
  if (exploration) {
    const second = revealOneRandomRoom(out);
    out = second.state;
  }
  return { ...out, player: { ...out.player, scoutUsesThisTurn: out.player.scoutUsesThisTurn + 1 } };
}

function discardHand(s: GameState): GameState {
  const toDiscard: string[] = [];
  for (const id of s.player.hand) {
    const def = s.cardDefs.get(id);
    if (def?.effect.type === "bonus_chit") continue;
    toDiscard.push(id);
  }
  const discardPile = [...s.player.discardPile, ...toDiscard];
  return {
    ...s,
    player: {
      ...s.player,
      hand: [],
      discardPile,
      moveTokens: 0,
      knockbackTokens: 0,
      knockbackPrimed: 0,
    },
  };
}

function drawDungeonTop(s: GameState): { state: GameState; hits: HitVisual[] } {
  let draw = [...s.dungeonDraw];
  let disc = [...s.dungeonDiscard];
  if (draw.length === 0) {
    if (disc.length === 0) {
      return withHits(log(s, "The dungeon deck is empty."), []);
    }
    draw = [...disc];
    disc = [];
    shuffleInPlace(draw);
  }
  const id = draw[0]!;
  const rest = draw.slice(1);
  const def = s.dungeonCardDefs.get(id);
  let base: GameState = { ...s, dungeonDraw: rest, dungeonDiscard: [...disc, id] };
  if (!def) {
    return withHits(log(base, `Unknown dungeon card: ${id}`), []);
  }

  if (s.stabilityBuffActive && id !== DUNGEON_DEADLIER_ID && Math.random() < 0.5) {
    const summary = "Stability holds — the card triggers but nothing happens.";
    const st = log(
      { ...base, stabilityBuffActive: false, dungeonCardReveal: { title: def.name, summary } },
      `Dungeon: ${def.name} — ${summary}`,
    );
    return withHits(st, []);
  }

  const working: GameState = { ...base, stabilityBuffActive: false };

  if (descendantSkipDungeonDraw(working)) {
    const summary = "Descendant — the dungeon's pull slips past you this turn.";
    const st = log(
      { ...working, dungeonCardReveal: { title: def.name, summary } },
      `Dungeon: ${def.name} — ${summary}`,
    );
    return withHits(st, []);
  }

  const title = def.name;
  let summary = "";

  switch (def.effect.type) {
    case "noop": {
      summary = "Nothing happens.";
      const st = log(
        { ...working, dungeonCardReveal: { title, summary } },
        `Dungeon: ${title} — ${summary}`,
      );
      return withHits(st, []);
    }
    case "add_noise": {
      const noise = working.noise + def.effect.amount;
      summary = `+${def.effect.amount} Noise (total ${noise}).`;
      const st = log(
        { ...working, noise, dungeonCardReveal: { title, summary } },
        `Dungeon: ${title} — ${summary}`,
      );
      return withHits(st, []);
    }
    case "trap": {
      const rawTrap = rollTrapDamage();
      const dmg = incomingDamageToPlayer(working, rawTrap);
      summary = dmg === 0 ? "No damage." : `You take ${dmg} damage.`;
      const hits: HitVisual[] = [];
      if (dmg > 0) {
        hits.push({ gridX: working.player.x, gridY: working.player.y, damage: dmg });
      }
      const hp = Math.max(0, working.player.hp - dmg);
      if (hp <= 0) {
        const st = log(
          {
            ...working,
            player: { ...working.player, hp: 0 },
            phase: "defeat",
            dungeonCardReveal: { title, summary },
          },
          `Dungeon: ${title} — ${summary}`,
        );
        return { state: st, hits };
      }
      const st = log(
        {
          ...working,
          player: { ...working.player, hp },
          dungeonCardReveal: { title, summary },
        },
        `Dungeon: ${title} — ${summary}`,
      );
      return { state: st, hits };
    }
    case "falling_rocks": {
      const fr = applyFallingRocksCard(working);
      summary = fr.lines.join(" ");
      const st = log(
        { ...fr.state, dungeonCardReveal: { title, summary } },
        `Dungeon: ${title} — rocks fall.`,
      );
      return withHits(st, fr.hits);
    }
    case "monsters_from_deep": {
      const sp = spawnMonstersFromDeep(working);
      summary = sp.lines.join(" ");
      const st = log(
        { ...sp.state, dungeonCardReveal: { title, summary } },
        `Dungeon: ${title} — ${summary}`,
      );
      return withHits(st, []);
    }
    case "danger_and_reshuffle": {
      const danger = working.danger + 1;
      summary = `Danger rises to ${danger}. The dungeon deck is reshuffled.`;
      const st = log(
        {
          ...working,
          danger,
          dungeonDraw: buildFreshDungeonDeck(working.depth, working.floorTheme),
          dungeonDiscard: [],
          dungeonCardReveal: { title, summary },
        },
        `Dungeon: ${title} — ${summary}`,
      );
      return withHits(st, []);
    }
    case "stability": {
      summary = "The next dungeon card may not take effect (except THE DUNGEON IS DEADLIER).";
      const st = log(
        { ...working, stabilityBuffActive: true, dungeonCardReveal: { title, summary } },
        `Dungeon: ${title} — ${summary}`,
      );
      return withHits(st, []);
    }
    case "dust_settles": {
      summary = "You cannot scout this turn.";
      const st = log(
        { ...working, scoutBlockedThisTurn: true, dungeonCardReveal: { title, summary } },
        `Dungeon: ${title} — ${summary}`,
      );
      return withHits(st, []);
    }
    case "collapse": {
      const roomTiles = pickCollapseRoomFloorTiles(working);
      if (!roomTiles || roomTiles.length === 0) {
        summary = "Nothing caves in — no suitable chamber.";
        const st = log(
          { ...working, dungeonCardReveal: { title, summary } },
          `Dungeon: ${title} — ${summary}`,
        );
        return withHits(st, []);
      }
      summary = "A chamber is marked — it will collapse at the end of your next turn.";
      const st = log(
        {
          ...working,
          pendingCollapse: { tiles: roomTiles },
          dungeonCardReveal: { title, summary },
        },
        `Dungeon: ${title} — ${summary}`,
      );
      return withHits(st, []);
    }
    case "lights_out": {
      const n = Math.max(1, working.depth - 2);
      /** +1 so duration matches intent: beginNextPlayerTurn decrements once right after this card resolves. */
      const stored = n + 1;
      summary = `Darkness lingers for ${n} of your turns (map obscured).`;
      const st = log(
        {
          ...working,
          lightsOutTurns: Math.max(working.lightsOutTurns, stored),
          dungeonCardReveal: { title, summary },
        },
        `Dungeon: ${title} — ${summary}`,
      );
      return withHits(st, []);
    }
    case "targeted_collapse": {
      const p = working.player;
      const cells: Point[] = [];
      const tryAdd = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= working.width || y >= working.height) return;
        if (tileAt(working.tiles, { x, y }) === "floor") cells.push({ x, y });
      };
      tryAdd(p.x, p.y);
      tryAdd(p.x + 1, p.y);
      tryAdd(p.x - 1, p.y);
      tryAdd(p.x, p.y + 1);
      tryAdd(p.x, p.y - 1);
      summary = "Rubble is about to fall around you — it drops at the end of your next turn.";
      const st = log(
        {
          ...working,
          pendingTargetedCollapse: cells,
          dungeonCardReveal: { title, summary },
        },
        `Dungeon: ${title} — ${summary}`,
      );
      return withHits(st, []);
    }
    case "you_are_not_alone": {
      // Collect eligible rooms: not gauntlet, not gauntlet_corridor, not stair_room
      const eligibleRids = new Set<number>();
      const undiscoveredRids = new Set<number>();
      const roomHasDiscovered = new Map<number, boolean>();
      for (let y = 0; y < working.height; y++) {
        for (let x = 0; x < working.width; x++) {
          if (working.tiles[y][x] !== "floor") continue;
          const rid = working.roomIds[y][x];
          if (rid < 0) continue;
          const kind = working.roomKinds[rid];
          if (kind === "gauntlet" || kind === "gauntlet_corridor" || kind === "stair_room") continue;
          eligibleRids.add(rid);
          if (working.discovered.has(keyOf({ x, y }))) {
            roomHasDiscovered.set(rid, true);
          }
        }
      }
      for (const rid of eligibleRids) {
        if (!roomHasDiscovered.has(rid)) undiscoveredRids.add(rid);
      }
      const pool = undiscoveredRids.size > 0 ? [...undiscoveredRids] : [...eligibleRids];
      if (pool.length === 0) {
        summary = "Something stirs, but there is nowhere left to lurk.";
        const st = log(
          { ...working, dungeonCardReveal: { title, summary } },
          `Dungeon: ${title} — ${summary}`,
        );
        return withHits(st, []);
      }
      const chosenRid = pool[rollInt(0, pool.length - 1)]!;
      // Find free floor tiles in that room (not on player, not on existing monster)
      const occupiedKeys = new Set<string>();
      occupiedKeys.add(keyOf({ x: working.player.x, y: working.player.y }));
      for (const mon of working.monsters) {
        if (mon.hp > 0) occupiedKeys.add(keyOf({ x: mon.x, y: mon.y }));
      }
      const candidateTiles: Point[] = [];
      for (let y = 0; y < working.height; y++) {
        for (let x = 0; x < working.width; x++) {
          if (working.tiles[y][x] !== "floor") continue;
          if (working.roomIds[y][x] !== chosenRid) continue;
          if (occupiedKeys.has(keyOf({ x, y }))) continue;
          candidateTiles.push({ x, y });
        }
      }
      if (candidateTiles.length === 0) {
        summary = "Something stirs, but cannot find footing.";
        const st = log(
          { ...working, dungeonCardReveal: { title, summary } },
          `Dungeon: ${title} — ${summary}`,
        );
        return withHits(st, []);
      }
      const spawnTile = candidateTiles[rollInt(0, candidateTiles.length - 1)]!;
      const serial = nextMonsterSerial(working.monsters);
      const shade = createMonsterInstance(
        `monster_${serial}`,
        "corrupted_shade",
        spawnTile.x,
        spawnTile.y,
        working.monsterDefs,
        working.danger,
      );
      summary = "";
      const st = log(
        {
          ...working,
          monsters: [...working.monsters, shade],
          dungeonCardReveal: { title, summary },
        },
        `Dungeon: ${title}.`,
      );
      return withHits(st, []);
    }
    case "overgrowth": {
      let st = working;
      let serial = nextMonsterSerial(st.monsters);
      let any = false;
      for (let rid = 0; rid < st.roomKinds.length; rid++) {
        if (st.roomKinds[rid] !== "greenhouse") continue;
        const cells: Point[] = [];
        for (let y = 0; y < st.height; y++) {
          for (let x = 0; x < st.width; x++) {
            if (st.roomIds[y][x] !== rid) continue;
            if (st.tiles[y][x] !== "floor") continue;
            if (st.player.x === x && st.player.y === y) continue;
            if (st.monsters.some((m) => m.hp > 0 && m.x === x && m.y === y)) continue;
            cells.push({ x, y });
          }
        }
        shuffleInPlace(cells);
        if (cells.length === 0) continue;
        any = true;
        if (Math.random() < 0.5) {
          const p = cells[0]!;
          st = {
            ...st,
            monsters: [
              ...st.monsters,
              createMonsterInstance(`monster_${serial++}`, "tangleweed_bloom", p.x, p.y, st.monsterDefs, st.danger),
            ],
          };
        } else {
          for (let k = 0; k < 2 && k < cells.length; k++) {
            const p = cells[k]!;
            st = {
              ...st,
              monsters: [
                ...st.monsters,
                createMonsterInstance(`monster_${serial++}`, "vineshon", p.x, p.y, st.monsterDefs, st.danger),
              ],
            };
          }
        }
      }
      summary = any ? "The greenhouses surge with growth." : "No greenhouses stir.";
      const out = log({ ...st, dungeonCardReveal: { title, summary } }, `Dungeon: ${title} — ${summary}`);
      return withHits(out, []);
    }
    case "flooding": {
      const eligibleRids = new Set<number>();
      for (let y = 0; y < working.height; y++) {
        for (let x = 0; x < working.width; x++) {
          const t = working.tiles[y][x];
          if (t !== "floor" && t !== "water") continue;
          const rid = working.roomIds[y][x];
          if (rid < 0) continue;
          const kind = working.roomKinds[rid];
          if (kind === "gauntlet" || kind === "gauntlet_corridor" || kind === "stair_room") continue;
          eligibleRids.add(rid);
        }
      }
      const pool = [...eligibleRids];
      if (pool.length === 0) {
        summary = "Nowhere floods.";
        return withHits(log({ ...working, dungeonCardReveal: { title, summary } }, `Dungeon: ${title} — ${summary}`), [],);
      }
      const chosenRid = pool[rollInt(0, pool.length - 1)]!;
      summary = "A chamber is marked — water will rise each turn.";
      const stFl = log(
        {
          ...working,
          floodingRoomId: chosenRid,
          dungeonCardReveal: { title, summary },
        },
        `Dungeon: ${title} — ${summary}`,
      );
      return withHits(stFl, []);
    }
    case "stalactites_fall": {
      const marks: Point[] = [];
      for (let rid = 0; rid < working.roomKinds.length; rid++) {
        const k = working.roomKinds[rid];
        if (k === "gauntlet" || k === "gauntlet_corridor") continue;
        const cells: Point[] = [];
        for (let y = 0; y < working.height; y++) {
          for (let x = 0; x < working.width; x++) {
            if (working.roomIds[y][x] !== rid) continue;
            const t = working.tiles[y][x];
            if (t === "floor" || t === "water") cells.push({ x, y });
          }
        }
        if (cells.length === 0) continue;
        shuffleInPlace(cells);
        const n = rollInt(1, Math.max(1, working.depth));
        for (let i = 0; i < n && i < cells.length; i++) marks.push(cells[i]!);
      }
      summary = "Weak points in the ceiling — stalactites fall next turn.";
      const stSc = log(
        {
          ...working,
          pendingStalactites: [...working.pendingStalactites, ...marks],
          dungeonCardReveal: { title, summary },
        },
        `Dungeon: ${title} — ${summary}`,
      );
      return withHits(stSc, []);
    }
    default:
      return withHits(log(working, "Unknown dungeon card effect."), []);
  }
}

function pickCollapseRoomFloorTiles(s: GameState): Point[] | null {
  const eligibleRids = new Set<number>();
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (s.tiles[y][x] !== "floor") continue;
      const rid = s.roomIds[y][x];
      if (rid < 0) continue;
      const k = s.roomKinds[rid];
      if (k === "gauntlet" || k === "gauntlet_corridor") continue;
      eligibleRids.add(rid);
    }
  }
  const pool = [...eligibleRids];
  if (pool.length === 0) return null;
  const rid = pool[rollInt(0, pool.length - 1)]!;
  const tiles: Point[] = [];
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (s.roomIds[y][x] !== rid) continue;
      if (s.tiles[y][x] === "floor") tiles.push({ x, y });
    }
  }
  return tiles.length > 0 ? tiles : null;
}

function runMonsterPhase(state: GameState): {
  state: GameState;
  hits: HitVisual[];
  anims: TurnAnimEvent[];
} {
  return runMonsterPhaseWithHooks(state, {
    resolvePlayerEnter: resolvePlayerEnterTile,
    breakPotMonster: breakPotAsMonster,
  });
}

/** After drawing a fresh hand: apply skills that grant move/knockback tokens and reset per-turn flags. */
function applyPerTurnSkillResourcesAfterDraw(next: GameState): GameState {
  return {
    ...next,
    player: {
      ...next.player,
      defenseBonusThisTurn: 0,
      doublePunchThisTurn: false,
      moveTokens: moveTokensGrantedPerTurn(next),
      knockbackTokens: knockbackTokensGrantedPerTurn(next),
      knockbackPrimed: 0,
      movementCardsPlayedThisTurn: 0,
      scoutUsesThisTurn: 0,
      hasteThisTurn: false,
    },
  };
}

function beginNextPlayerTurn(s: GameState): GameState {
  if (s.phase === "defeat") return s;
  let next = { ...s, turn: s.turn + 1 };
  next = applyPendingStalactiteDamage(next);
  if (next.phase === "defeat") return next;
  next = tickHarmingClouds(next);
  if (next.lightsOutTurns > 0) {
    next = { ...next, lightsOutTurns: next.lightsOutTurns - 1 };
  }
  if (next.player.gemLuckRestore != null) {
    next = {
      ...next,
      chanceMode: next.player.gemLuckRestore,
      player: { ...next.player, gemLuckRestore: null },
    };
  }
  const drawN = playerDrawCountPerTurn(next);
  next = ensureEquippedOnTopOfDraw(next);
  next = drawFromPlayerDeck(next, drawN, true);
  next = applyPerTurnSkillResourcesAfterDraw(next);
  next = revealAtPlayer(next);
  next = collectAdjacentLoot(next);
  return log(
    {
      ...next,
      phase: "player",
      pending: null,
      dungeonCardReveal: null,
      scoutBlockedThisTurn: false,
    },
    `— Turn ${next.turn} — You draw ${drawN} cards.`,
  );
}

function hasAttackTargetAt(s: GameState, x: number, y: number): boolean {
  return (
    s.monsters.some((m) => m.hp > 0 && m.x === x && m.y === y) ||
    s.pots.some((p) => p.x === x && p.y === y) ||
    s.tangleweeds.some((tw) => tw.hp > 0 && tw.x === x && tw.y === y)
  );
}

function attackTargetTiles(s: GameState): Point[] {
  const byKey = new Map<string, Point>();
  const add = (p: Point) => {
    if (s.fogOfWar && !s.discovered.has(keyOf(p))) return;
    byKey.set(keyOf(p), { x: p.x, y: p.y });
  };
  for (const m of s.monsters) if (m.hp > 0) add(m);
  for (const p of s.pots) add(p);
  for (const tw of s.tangleweeds) if (tw.hp > 0) add(tw);
  return [...byKey.values()];
}

type TileAttackResult = {
  state: GameState;
  hits: HitVisual[];
  survivorMonsterIds: string[];
  monsterDamage: Map<string, number>;
  targetCount: number;
};

/** Damage every target on a tile using one shared raw damage value. */
function damageAttackTargetsAt(
  state: GameState,
  target: Point,
  rawDamage: number,
  fxKind: AttackFxKind,
  ignoreDefense = false,
  defensePierce = 0,
): TileAttackResult {
  let s = state;
  const hits: HitVisual[] = [];
  let targetCount = 0;
  const survivorMonsterIds: string[] = [];
  const monsterDamage = new Map<string, number>();
  const monsterIds = s.monsters
    .filter((m) => m.hp > 0 && m.x === target.x && m.y === target.y)
    .map((m) => m.id);

  for (const id of monsterIds) {
    const mon = s.monsters.find((m) => m.id === id && m.hp > 0);
    if (!mon) continue;
    targetCount++;
    const def = s.monsterDefs.get(mon.defId);
    const defense = Math.max(0, monsterDefenseForIncoming(mon, def) - defensePierce);
    const damage = ignoreDefense ? rawDamage : applyDefense(rawDamage, defense);
    monsterDamage.set(mon.id, damage);
    const hp = Math.max(0, mon.hp - damage);
    s = { ...s, monsters: patchMonsterHp(s.monsters, mon.id, hp) };
    hits.push(hitAt(s, target.x, target.y, damage, fxKind));
    if (hp <= 0) {
      s = log(s, `${def?.name ?? "Enemy"} defeated.`);
      s = applyMonsterKillRewards(s, mon.defId, mon.x, mon.y);
    } else {
      survivorMonsterIds.push(mon.id);
    }
  }

  const tangleweedIds = s.tangleweeds
    .filter((tw) => tw.hp > 0 && tw.x === target.x && tw.y === target.y)
    .map((tw) => tw.id);
  for (const id of tangleweedIds) {
    const tw = s.tangleweeds.find((x) => x.id === id && x.hp > 0);
    if (!tw) continue;
    targetCount++;
    const hp = Math.max(0, tw.hp - rawDamage);
    s = {
      ...s,
      tangleweeds: s.tangleweeds.map((x) => (x.id === id ? { ...x, hp } : x)),
    };
    hits.push(hitAt(s, target.x, target.y, rawDamage, fxKind));
    if (hp <= 0) s = log(s, "Tangleweed destroyed.");
  }

  while (s.pots.some((p) => p.x === target.x && p.y === target.y)) {
    targetCount++;
    s = breakPotFromAttack(s, target.x, target.y);
    hits.push(hitAt(s, target.x, target.y, 1, fxKind));
  }

  return { state: s, hits, survivorMonsterIds, monsterDamage, targetCount };
}

function applyKnockbackToMonsters(
  state: GameState,
  monsterIds: string[],
  distance: number,
  moveAnims?: TurnAnimEvent[],
): GameState {
  let s = state;
  if (distance <= 0) return s;
  for (const id of monsterIds) s = tryKnockMonsterFromPlayerN(s, id, distance, moveAnims);
  return s;
}

function consumePlayedCard(
  state: GameState,
  handIndex: number,
): { state: GameState; cardId: string } | null {
  const hand = [...state.player.hand];
  const cardId = hand[handIndex];
  if (!cardId) return null;
  hand.splice(handIndex, 1);
  return {
    cardId,
    state: {
      ...state,
      player: playerAfterPlayingCard(state, hand, cardId),
      pending: null,
    },
  };
}

function isPhysicalMeleeAttack(def: CardDef | undefined): boolean {
  return !!def?.types.includes("Attack") &&
    !!def.tags?.includes("physical attack") &&
    !!def.tags?.includes("melee");
}

function resolvePlayerAttackAtTile(state: GameState, target: Point): DispatchResult {
  const pending = state.pending;
  if (!pending || !hasAttackTargetAt(state, target.x, target.y)) return noHits(state);
  if (state.fogOfWar && !state.discovered.has(keyOf(target))) return noHits(state);
  const player = { x: state.player.x, y: state.player.y };

  if (pending.kind === "play_great_sword") {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const adjacent = manhattan(player, target) === 1;
    const straight = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    const longReach = straight && Math.max(Math.abs(dx), Math.abs(dy)) === 2;
    if (!adjacent && !longReach) return noHits(state);
    if (longReach) {
      const middle = { x: player.x + dx / 2, y: player.y + dy / 2 };
      const middleBlocked =
        tileAt(state.tiles, middle) !== "floor" ||
        hasAttackTargetAt(state, middle.x, middle.y) ||
        state.chests.some((c) => c.x === middle.x && c.y === middle.y) ||
        state.rocks.some((r) => r.x === middle.x && r.y === middle.y);
      if (middleBlocked) return noHits(log(state, "Something blocks the Great Sword's reach."));
    }
    const consumed = consumePlayedCard(state, pending.cardHandIndex);
    if (!consumed) return noHits(state);
    const minDamage = adjacent ? pending.minDamage : pending.secondaryMinDamage;
    const maxDamage = adjacent ? pending.maxDamage : pending.secondaryMaxDamage;
    const raw = weaponAttackRollRaw(consumed.state, consumed.cardId, minDamage, maxDamage);
    const result = damageAttackTargetsAt(consumed.state, target, raw, "melee_slash");
    const knockback = state.player.knockbackPrimed;
    let afterHit = {
      ...result.state,
      player: { ...result.state.player, knockbackPrimed: 0 },
    };
    afterHit = consumeStrengthGemIfPhysical(afterHit, consumed.cardId);
    afterHit = log(
      afterHit,
      adjacent ? "Great Sword — crushing strike!" : "Great Sword — long-reach strike!",
    );
    return withHitsThenKnockback(afterHit, result.hits, result.survivorMonsterIds, knockback);
  }

  if (pending.kind === "discard_punch") {
    if (manhattan(player, target) > 1) return noHits(state);
    const strikes = punchStrikeCount(state);
    let s: GameState = { ...state, pending: null };
    const hits: HitVisual[] = [];
    let survivors: string[] = [];
    for (let i = 0; i < strikes; i++) {
      if (!hasAttackTargetAt(s, target.x, target.y)) break;
      let raw = rollInt(1, 2) + attackStrengthBonus(s) + heavyPunchBonus(s);
      if (s.player.nextPhysicalAttackMultiplier !== 1) {
        raw = Math.floor(raw * s.player.nextPhysicalAttackMultiplier);
      }
      const result = damageAttackTargetsAt(s, target, raw, "melee_slash");
      s = result.state;
      hits.push(...result.hits);
      survivors = result.survivorMonsterIds;
    }
    const knockback = state.player.knockbackPrimed;
    const afterHit = log(
      { ...s, player: { ...s.player, knockbackPrimed: 0, nextPhysicalAttackMultiplier: 1 } },
      strikes > 1 ? "Flurry punch!" : "Punch!",
    );
    return withHitsThenKnockback(afterHit, hits, survivors, knockback);
  }

  if (
    pending.kind === "play_melee" ||
    pending.kind === "play_knife" ||
    pending.kind === "play_axe" ||
    pending.kind === "play_knockback_punch" ||
    pending.kind === "play_mace_smash" ||
    pending.kind === "play_poisoned_blade"
  ) {
    if (manhattan(player, target) > 1) return noHits(state);
    const consumed = consumePlayedCard(state, pending.cardHandIndex);
    if (!consumed) return noHits(state);
    const def = state.cardDefs.get(consumed.cardId);
    const strikes =
      pending.kind === "play_knockback_punch" ? punchStrikeCount(state, def) : 1;
    let s = consumed.state;
    const hits: HitVisual[] = [];
    let survivors: string[] = [];
    for (let i = 0; i < strikes; i++) {
      if (!hasAttackTargetAt(s, target.x, target.y)) break;
      const raw = weaponAttackRollRaw(s, consumed.cardId, pending.minDamage, pending.maxDamage);
      const result = damageAttackTargetsAt(
        s,
        target,
        raw,
        "melee_slash",
        false,
        pending.kind === "play_mace_smash" ? pending.defensePierce : 0,
      );
      s = result.state;
      hits.push(...result.hits);
      survivors = result.survivorMonsterIds;
      if (pending.kind === "play_poisoned_blade") {
        const poisoned = survivors.filter((id) => (result.monsterDamage.get(id) ?? 0) > 1);
        if (poisoned.length > 0) {
          s = {
            ...s,
            monsters: applyPoisonToMonsters(s.monsters, poisoned, pending.poisonLevels),
          };
          s = log(s, `Poisoned Blade inflicts ${pending.poisonLevels} Poison.`);
        }
      }
    }
    const builtIn = pending.kind === "play_knockback_punch" ? pending.knockback : 0;
    const knockback = builtIn + state.player.knockbackPrimed;
    let afterHit: GameState = { ...s, player: { ...s.player, knockbackPrimed: 0 } };
    if (pending.kind === "play_knife") {
      afterHit = drawFromPlayerDeck(afterHit, 1);
      afterHit = log(afterHit, "Knife — draw a card.");
    }
    if (pending.kind === "play_axe") {
      afterHit = { ...afterHit, player: { ...afterHit.player, suppressNextMove: true } };
      afterHit = log(afterHit, "Axe — your next movement will fail.");
    }
    if (pending.kind === "play_mace_smash") {
      afterHit = {
        ...afterHit,
        player: { ...afterHit.player, drawPile: ["weariness", ...afterHit.player.drawPile] },
      };
      afterHit = log(afterHit, "Mace Smash adds Weariness to the top of your deck.");
    }
    afterHit = consumeStrengthGemIfPhysical(afterHit, consumed.cardId);
    return withHitsThenKnockback(afterHit, hits, survivors, knockback);
  }

  if (pending.kind === "play_spear") {
    const distance = manhattan(player, target);
    const dx = Math.sign(target.x - player.x);
    const dy = Math.sign(target.y - player.y);
    if ((distance !== 1 && distance !== 2) || (dx !== 0 && dy !== 0)) return noHits(state);
    const consumed = consumePlayedCard(state, pending.cardHandIndex);
    if (!consumed) return noHits(state);
    const raw = weaponAttackRollRaw(
      consumed.state,
      consumed.cardId,
      pending.minDamage,
      pending.maxDamage,
    );
    let result = damageAttackTargetsAt(consumed.state, target, raw, "melee_slash");
    let s = result.state;
    const hits = [...result.hits];
    let survivors = [...result.survivorMonsterIds];
    const behind = { x: target.x + dx, y: target.y + dy };
    if (hasAttackTargetAt(s, behind.x, behind.y)) {
      result = damageAttackTargetsAt(s, behind, raw, "melee_slash");
      s = result.state;
      hits.push(...result.hits);
      survivors.push(...result.survivorMonsterIds);
    }
    const knockback = state.player.knockbackPrimed;
    let afterHit: GameState = { ...s, player: { ...s.player, knockbackPrimed: 0 } };
    afterHit = consumeStrengthGemIfPhysical(afterHit, consumed.cardId);
    afterHit = log(afterHit, "The spear pierces the line!");
    return withHitsThenKnockback(afterHit, hits, survivors, knockback);
  }

  if (pending.kind === "play_magic_missile") {
    if (
      !magicMissilePathClearToPoint(
        state.tiles,
        state.monsters,
        state.pots,
        player,
        target.x,
        target.y,
      )
    ) {
      return noHits(state);
    }
    const consumed = consumePlayedCard(state, pending.cardHandIndex);
    if (!consumed) return noHits(state);
    const raw = magicAttackRollRaw(
      consumed.state,
      consumed.cardId,
      pending.minDamage,
      pending.maxDamage,
    );
    const result = damageAttackTargetsAt(
      consumed.state,
      target,
      raw,
      "magic_missile",
      true,
    );
    return withHits(log(result.state, `Magic Missile — ${raw} damage, ignoring defense.`), result.hits);
  }

  if (pending.kind === "play_bow_attack") {
    if (manhattan(player, target) <= 1) return noHits(log(state, "The bow cannot hit adjacent targets."));
    if (chebyshev(player, target) > pending.range) return noHits(log(state, "Target is out of bow range."));
    if (!lineOfSightClear(state.tiles, player, target)) return noHits(log(state, "No line of sight."));
    const consumed = consumePlayedCard(state, pending.cardHandIndex);
    if (!consumed) return noHits(state);
    const raw = weaponAttackRollRaw(
      consumed.state,
      consumed.cardId,
      pending.minDamage,
      pending.maxDamage,
    );
    const result = damageAttackTargetsAt(consumed.state, target, raw, "arrow");
    let s = consumeStrengthGemIfPhysical(result.state, consumed.cardId);
    return withHits(log(s, `Bow shot — ${raw} raw damage.`), result.hits);
  }

  if (pending.kind === "play_lightning_bolt") {
    const targetKey = keyOf(target);
    if (pending.hitIds.includes(targetKey)) {
      return noHits(log(state, "Lightning cannot hit the same tile twice."));
    }
    const origin =
      pending.hitIds.length === 0
        ? player
        : (() => {
            const [x, y] = pending.hitIds[pending.hitIds.length - 1]!.split(",").map(Number);
            return { x, y };
          })();
    if (chebyshev(origin, target) > pending.nextDamage) {
      return noHits(log(state, "Target is out of chain range."));
    }
    const cardId = state.player.hand[pending.cardHandIndex];
    if (!cardId) return noHits(state);
    const raw = pending.nextDamage + lightningBoltSkillDamageBonus(state, cardId);
    const result = damageAttackTargetsAt(state, target, raw, "magic_missile", true);
    let s = result.state;
    const hitIds = [...pending.hitIds, targetKey];
    const nextDamage = pending.nextDamage - 1;
    const nextTargets =
      nextDamage > 0
        ? attackTargetTiles(s).filter(
            (p) => !hitIds.includes(keyOf(p)) && chebyshev(target, p) <= nextDamage,
          )
        : [];
    if (nextTargets.length === 0) {
      const consumed = consumePlayedCard(s, pending.cardHandIndex);
      if (consumed) s = consumed.state;
      s = log(s, "Lightning chain ends.");
    } else {
      s = {
        ...s,
        pending: { ...pending, nextDamage, hitIds },
      };
      s = log(s, `Lightning chains — choose a target within ${nextDamage}.`);
    }
    return withHits(s, result.hits);
  }

  return noHits(state);
}

function dispatchCore(state: GameState, cmd: GameCommand): DispatchResult {
  if (
    cmd.type === "DEV_SET_VARIABLE" ||
    cmd.type === "DEV_CARD" ||
    cmd.type === "DEV_DECK" ||
    cmd.type === "DEV_DUNGEON_TOP" ||
    cmd.type === "DEV_GOTO_FLOOR" ||
    cmd.type === "DEV_SET_THEME" ||
    cmd.type === "DEV_SUMMON" ||
    cmd.type === "DEV_CHANCE" ||
    cmd.type === "DEV_EDITOR" ||
    cmd.type === "DEV_EDITOR_CELL_ACTION"
  ) {
    return handleDevCommand(state, cmd);
  }
  if (state.phase === "defeat") return noHits(state);
  if (state.deckBuilderOffer) return handleDeckBuilderOffer(state, cmd);
  if (state.chestOffer && cmd.type !== "RESOLVE_CHEST_OFFER") return noHits(state);
  const pickupLen = state.cardPickupOffer?.queue.length ?? 0;
  if (pickupLen > 0 && cmd.type !== "RESOLVE_CARD_PICKUP") return noHits(state);
  if (state.pedestalOffer && cmd.type !== "RESOLVE_PEDESTAL_PICK") return noHits(state);
  if (state.deckDestroyPending && cmd.type !== "RESOLVE_DECK_DESTROY") return noHits(state);
  if (
    state.dualWieldStage?.step === "choose_discard_attack" &&
    cmd.type !== "RESOLVE_DUAL_WIELD_DISCARD" &&
    cmd.type !== "CANCEL_PENDING"
  ) {
    return noHits(log(state, "Choose Dual Wield's discard attack first."));
  }
  if (
    state.dualWieldStage?.step === "choose_hand_attack" &&
    cmd.type !== "REQUEST_PLAY_CARD" &&
    cmd.type !== "CANCEL_PENDING"
  ) {
    return noHits(log(state, "Play an Attack to continue Dual Wield."));
  }

  if (state.phase === "peace") {
    const merchantResult = handleMerchantCommand(state, cmd);
    if (merchantResult) return merchantResult;
    if (cmd.type === "PEACE_MOVE_TO") {
      if (merchantUiBlocks(state)) return noHits(log(state, "Finish talking with Shifty first."));
      const dest = { x: cmd.x, y: cmd.y };
      const from = { x: state.player.x, y: state.player.y };
      if (manhattan(from, dest) !== 1) return noHits(state);
      const occ = occupiedForPlayerMove(state);
      if (occ.has(keyOf(dest))) return noHits(state);
      if (tileAt(state.tiles, dest) !== "floor") return noHits(state);
      if (state.rocks.some((r) => r.x === dest.x && r.y === dest.y)) return noHits(state);

      const onStairDown =
        state.stairFeatures?.exitDoorCells.some((c) => c.x === dest.x && c.y === dest.y) ?? false;
      if (onStairDown && !state.pedestalUsed) {
        return noHits(log(state, "The descent waits — finish at the pedestal first."));
      }
      if (onStairDown && state.pedestalUsed) {
        let next = createNextFloorState(state);
        next = reshufflePlayerDeck(next);
        const drawN = playerDrawCountPerTurn(next);
        next = ensureEquippedOnTopOfDraw(next);
        next = drawFromPlayerDeck(next, drawN, true);
        next = applyPerTurnSkillResourcesAfterDraw(next);
        next = revealAtPlayer(next);
        next = collectAdjacentLoot(next);
        next = log(
          next,
          `You descend — floor ${next.depth}, danger ${next.danger}. Decks reshuffled; new hand drawn.`,
        );
        next = log(next, `— Turn ${next.turn} — You draw ${drawN} cards.`);
        return noHits(next);
      }

      let s: GameState = { ...state, player: { ...state.player, x: dest.x, y: dest.y } };
      s = revealAtPlayer(s);
      s = resolvePlayerEnterTile(s, dest.x, dest.y);
      s = maybeActivatePedestal(s);
      return noHits(log(s, "You move freely."));
    }
    if (cmd.type === "RESOLVE_PEDESTAL_PICK") {
      if (!state.pedestalOffer) return noHits(state);
      const { cards } = state.pedestalOffer;
      let s: GameState = { ...state, pedestalOffer: null };
      const pick = cmd.pickIndex;
      if (pick !== null && pick >= 0 && pick <= 2) {
        const cardId = cards[pick];
        if (cardId) {
          const nm = s.cardDefs.get(cardId)?.name ?? cardId;
          s = log(
            {
              ...s,
              player: { ...s.player, discardPile: [...s.player.discardPile, cardId] },
            },
            `You inscribe ${nm} into your deck (discard).`,
          );
        }
      } else {
        s = log(s, "You leave the offered cards.");
      }
      return noHits({ ...s, deckDestroyPending: true });
    }
    if (cmd.type === "RESOLVE_DECK_DESTROY") {
      if (!state.deckDestroyPending) return noHits(state);
      if (cmd.cardId === null) {
        return noHits(
          log(
            { ...state, deckDestroyPending: false, pedestalUsed: true },
            "You leave your deck as it is.",
          ),
        );
      }
      const removed = removeOneCardFromDeck(state, cmd.cardId);
      if (!removed) return noHits(log(state, "That card is not in your deck."));
      const nm = state.cardDefs.get(cmd.cardId)?.name ?? cmd.cardId;
      return noHits(
        log(
          { ...clearEquippedIfGone(removed), deckDestroyPending: false, pedestalUsed: true },
          `${nm} is torn out of your deck forever.`,
        ),
      );
    }
    if (cmd.type === "UNLOCK_SKILL") {
      return unlockSkillDispatch(state, cmd.skillId);
    }
    return noHits(state);
  }

  switch (cmd.type) {
    case "RESOLVE_CARD_PICKUP": {
      const q = state.cardPickupOffer?.queue;
      if (!q || q.length === 0) return noHits(state);
      const cardId = q[0]!;
      const rest = q.slice(1);
      const nm = state.cardDefs.get(cardId)?.name ?? cardId;
      let s: GameState = {
        ...state,
        cardPickupOffer: rest.length > 0 ? { queue: rest } : null,
      };
      if (cmd.accept) {
        return noHits(
          log(
            {
              ...s,
              player: { ...s.player, discardPile: [...s.player.discardPile, cardId] },
            },
            `You add ${nm} to your discard pile.`,
          ),
        );
      }
      return noHits(log(s, `You leave ${nm}.`));
    }

    case "RESOLVE_CHEST_OFFER": {
      if (!state.chestOffer) return noHits(state);
      const { cards } = state.chestOffer;
      let s: GameState = { ...state, chestOffer: null };
      const pick = cmd.pickIndex;
      if (pick === null || pick < 0 || pick > 2) {
        return noHits(log(s, "You take none of the cards."));
      }
      const cardId = cards[pick];
      if (!cardId) return noHits(state);
      const nm = s.cardDefs.get(cardId)?.name ?? cardId;
      return noHits(
        log(
          {
            ...s,
            player: { ...s.player, discardPile: [...s.player.discardPile, cardId] },
          },
          `You take ${nm} — it goes to your discard pile.`,
        ),
      );
    }

    case "DISMISS_DUNGEON_TOAST":
      return noHits({ ...state, dungeonCardReveal: null });

    case "BEGIN_FIRST_TURN": {
      if (state.turn > 0) return noHits(state);
      let s = { ...state, turn: 1 };
      const n = playerDrawCountPerTurn(s);
      s = drawFromPlayerDeck(s, n);
      s = {
        ...s,
        player: {
          ...s.player,
          moveTokens: moveTokensGrantedPerTurn(s),
          knockbackTokens: knockbackTokensGrantedPerTurn(s),
          knockbackPrimed: 0,
          movementCardsPlayedThisTurn: 0,
          scoutUsesThisTurn: 0,
          hasteThisTurn: false,
        },
      };
      s = revealAtPlayer(s);
      s = collectAdjacentLoot(s);
      return noHits(log(s, `— Turn 1 — You draw ${n} cards.`));
    }

    case "CANCEL_PENDING": {
      if (
        state.dualWieldStage?.step === "choose_hand_attack" ||
        state.dualWieldStage?.step === "choose_discard_attack"
      ) {
        return noHits(
          log({ ...state, dualWieldStage: null, pending: null }, "Dual Wield cancelled."),
        );
      }
      if (!state.pending) return noHits(state);
      if (
        state.dualWieldStage?.step === "resolving_hand_attack"
      ) {
        return noHits({
          ...state,
          pending: null,
          dualWieldStage: { step: "choose_hand_attack" },
        });
      }
      if (
        state.dualWieldStage?.step === "resolving_discard_attack" &&
        "cardHandIndex" in state.pending
      ) {
        const idx = state.pending.cardHandIndex;
        const hand = [...state.player.hand];
        const cardId = hand[idx];
        if (!cardId) return noHits(state);
        hand.splice(idx, 1);
        return noHits({
          ...state,
          player: {
            ...state.player,
            hand,
            discardPile: [...state.player.discardPile, cardId],
          },
          pending: null,
          dualWieldStage: {
            step: "choose_discard_attack",
            firstCardId: state.dualWieldStage.firstCardId,
          },
        });
      }
      // If a lightning bolt chain has already dealt damage, discard the card on cancel.
      if (state.pending.kind === "play_lightning_bolt" && state.pending.hitIds.length > 0) {
        const p = state.pending;
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (cardId) {
          hand.splice(p.cardHandIndex, 1);
          return noHits(
            log(
              { ...state, player: playerAfterPlayingCard(state, hand, cardId), pending: null },
              "Lightning chain cancelled.",
            ),
          );
        }
      }
      return noHits({ ...state, pending: null });
    }

    case "REQUEST_EQUIP": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      const idx = cmd.handIndex;
      const cardId = state.player.hand[idx];
      if (!cardId || state.player.equipped) return noHits(state);
      const effectType = state.cardDefs.get(cardId)?.effect.type;
      if (effectType === "bonus_chit" || effectType === "penalty_destroy") {
        return noHits(log(state, "Bonus and Penalty cards can't be equipped."));
      }
      const hand = [...state.player.hand];
      hand.splice(idx, 1);
      return noHits(
        log(
          {
            ...state,
            player: {
              ...state.player,
              hand,
              drawPile: [cardId, ...state.player.drawPile],
              equipped: cardId,
            },
          },
          `Equipped ${state.cardDefs.get(cardId)?.name ?? cardId} — it is used for this turn and will be drawn at the start of every turn.`,
        ),
      );
    }

    case "UNEQUIP": {
      if (!state.player.equipped) return noHits(state);
      return noHits(
        log(
          { ...state, player: { ...state.player, equipped: null } },
          "Card unequipped — it returns to your deck's normal cycle.",
        ),
      );
    }

    case "REQUEST_PLAY_CARD": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      const idx = cmd.handIndex;
      const cardId = state.player.hand[idx];
      if (!cardId) return noHits(state);
      const def = state.cardDefs.get(cardId);
      if (!def) return noHits(state);

      if (
        state.dualWieldStage?.step === "choose_hand_attack" &&
        !def.types.includes("Attack")
      ) {
        return noHits(log(state, "Dual Wield requires you to play an Attack."));
      }

      if (def.effect.type === "bonus_chit") {
        return noHits(log(state, "Bonus Cards can't be played — discard one for a bonus action."));
      }

      if (def.effect.type === "penalty_destroy") {
        const hand = [...state.player.hand];
        hand.splice(idx, 1);
        return noHits(
          log(
            { ...state, player: { ...state.player, hand } },
            "Weariness is played and destroyed.",
          ),
        );
      }

      if (def.effect.type === "dual_wield") {
        const hand = [...state.player.hand];
        hand.splice(idx, 1);
        return noHits(
          log(
            {
              ...state,
              player: playerAfterPlayingCard(state, hand, cardId),
              dualWieldStage: { step: "choose_hand_attack" },
            },
            "Dual Wield — play an Attack from your hand.",
          ),
        );
      }

      if (state.player.hasteThisTurn) {
        const blockedTypes: string[] = ["Attack", "Protection", "Aid", "Deck"];
        if (def.types.some((t) => blockedTypes.includes(t))) {
          return noHits(
            log(state, `Haste is active — Attack, Protection, Aid, and Deck cards cannot be played this turn.`),
          );
        }
      }

      if (def.effect.type === "tactical_approach") {
        let s = state;
        const hand = [...s.player.hand];
        hand.splice(idx, 1);
        s = { ...s, player: playerAfterPlayingCard(s, hand, cardId) };
        s = drawFromPlayerDeck(s, def.effect.draw);
        const bonusId = "bonus_card";
        for (let i = 0; i < def.effect.bonusCount; i++) {
          s = { ...s, player: { ...s.player, hand: [...s.player.hand, bonusId] } };
        }
        return noHits(
          log(
            s,
            `Played ${def.name} — draw ${def.effect.draw}, gain ${def.effect.bonusCount} Bonus Cards.`,
          ),
        );
      }

      if (def.effect.type === "draw") {
        let s = state;
        const hand = [...s.player.hand];
        hand.splice(idx, 1);
        s = { ...s, player: playerAfterPlayingCard(s, hand, cardId) };
        s = drawFromPlayerDeck(s, def.effect.amount);
        return noHits(log(s, `Played ${def.name} — draw ${def.effect.amount}.`));
      }

      if (def.effect.type === "move") {
        const baseRange = def.effect.range + sprinterExtraMoveRange(state, def);
        const range = hasteMovementRange(state, baseRange);
        return noHits({
          ...state,
          pending: { kind: "play_move", cardHandIndex: idx, range },
        });
      }

      if (def.effect.type === "melee_attack") {
        return noHits({
          ...state,
          pending: {
            kind: "play_melee",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
          },
        });
      }

      if (def.effect.type === "spear_line") {
        return noHits({
          ...state,
          pending: {
            kind: "play_spear",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
          },
        });
      }

      if (def.effect.type === "knife") {
        return noHits({
          ...state,
          pending: {
            kind: "play_knife",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
          },
        });
      }

      if (def.effect.type === "axe") {
        return noHits({
          ...state,
          pending: {
            kind: "play_axe",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
          },
        });
      }

      if (def.effect.type === "quickstep") {
        let s = state;
        const hand = [...s.player.hand];
        const cardId = hand[idx];
        if (!cardId) return noHits(state);
        hand.splice(idx, 1);
        const maxRange = hasteMovementRange(
          s,
          def.effect.move + sprinterExtraMoveRange(s, def),
        );
        s = {
          ...s,
          player: playerAfterPlayingCard(s, hand, cardId),
          pending: { kind: "discard_move1", maxRange, fromQuickstep: true },
        };
        s = drawFromPlayerDeck(s, def.effect.draw);
        const stepMsg =
          maxRange > 1
            ? `Played ${def.name} — draw, then move up to ${maxRange} spaces.`
            : `Played ${def.name} — draw, then step 1 space.`;
        return noHits(log(s, stepMsg));
      }

      if (def.effect.type === "parry") {
        let s = state;
        const hand = [...s.player.hand];
        hand.splice(idx, 1);
        const defenseBonusThisTurn = s.player.defenseBonusThisTurn + def.effect.defenseBonus;
        s = {
          ...s,
          player: {
            ...playerAfterPlayingCard(s, hand, cardId),
            defenseBonusThisTurn,
          },
        };
        return noHits(log(s, `Played ${def.name} — +${def.effect.defenseBonus} defense this turn.`));
      }

      if (def.effect.type === "flurry") {
        let s = state;
        const hand = [...s.player.hand];
        hand.splice(idx, 1);
        s = {
          ...s,
          player: {
            ...playerAfterPlayingCard(s, hand, cardId),
            doublePunchThisTurn: true,
          },
        };
        return noHits(log(s, `Played ${def.name} — punches hit twice this turn.`));
      }

      if (def.effect.type === "magic_missile") {
        return noHits({
          ...state,
          pending: {
            kind: "play_magic_missile",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
          },
        });
      }

      if (def.effect.type === "card_seeker") {
        const range = hasteMovementRange(
          state,
          def.effect.move + sprinterExtraMoveRange(state, def),
        );
        return noHits({
          ...state,
          pending: { kind: "play_card_seeker", cardHandIndex: idx, range },
        });
      }

      if (def.effect.type === "haste") {
        if (state.player.hasteThisTurn) {
          return noHits(log(state, "Haste is already active."));
        }
        const hand = [...state.player.hand];
        hand.splice(idx, 1);
        const s = log(
          {
            ...state,
            player: {
              ...playerAfterPlayingCard(state, hand, cardId),
              hasteThisTurn: true,
            },
          },
          "Haste! Movement doubled this turn. Attack, Protection, Aid and Deck cards are locked.",
        );
        return noHits(s);
      }

      if (def.effect.type === "stealthy_advance") {
        const hand = [...state.player.hand];
        hand.splice(idx, 1);
        const noise = Math.max(0, state.noise - def.effect.noiseReduction);
        const defenseBonusThisTurn =
          state.player.defenseBonusThisTurn + def.effect.defenseBonus;
        let s: GameState = {
          ...state,
          noise,
          player: {
            ...playerAfterPlayingCard(state, hand, cardId),
            defenseBonusThisTurn,
          },
          pending: {
            kind: "discard_move1",
            maxRange: hasteMovementRange(state, def.effect.move),
            fromQuickstep: false,
          },
        };
        s = log(
          s,
          `Stealthy Advance — ${def.effect.noiseReduction > 0 ? `-${def.effect.noiseReduction} noise, ` : ""}+${def.effect.defenseBonus} defense, move ${def.effect.move} space.`,
        );
        return noHits(s);
      }

      if (def.effect.type === "knockback_punch") {
        return noHits({
          ...state,
          pending: {
            kind: "play_knockback_punch",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
            knockback: def.effect.knockback,
          },
        });
      }

      if (def.effect.type === "bow_attack") {
        return noHits({
          ...state,
          pending: {
            kind: "play_bow_attack",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
            range: def.effect.range,
          },
        });
      }

      if (def.effect.type === "lightning_bolt") {
        return noHits({
          ...state,
          pending: {
            kind: "play_lightning_bolt",
            cardHandIndex: idx,
            nextDamage: def.effect.startDamage,
            chainRange: def.effect.chainRange,
            hitIds: [],
          },
        });
      }

      if (def.effect.type === "fireball") {
        return noHits({
          ...state,
          pending: {
            kind: "play_fireball",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
            range: def.effect.range,
            minFire: def.effect.minFire,
            maxFire: def.effect.maxFire,
          },
        });
      }

      if (def.effect.type === "potion_of_harming") {
        return noHits({
          ...state,
          pending: {
            kind: "play_potion_of_harming",
            cardHandIndex: idx,
            range: def.effect.range,
            damage: def.effect.damage,
            cloudTurns: def.effect.cloudTurns,
          },
        });
      }

      if (def.effect.type === "mace_smash") {
        return noHits({
          ...state,
          pending: {
            kind: "play_mace_smash",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
            defensePierce: def.effect.defensePierce,
          },
        });
      }

      if (def.effect.type === "poisoned_blade") {
        return noHits({
          ...state,
          pending: {
            kind: "play_poisoned_blade",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
            poisonLevels: def.effect.poisonLevels,
          },
        });
      }

      if (def.effect.type === "loot_and_scoot") {
        const range = hasteMovementRange(
          state,
          def.effect.move + sprinterExtraMoveRange(state, def),
        );
        return noHits({
          ...state,
          pending: {
            kind: "play_loot_and_scoot",
            cardHandIndex: idx,
            range,
            maxCoins: def.effect.maxCoins,
          },
        });
      }

      if (def.effect.type === "flying_kick") {
        return noHits({
          ...state,
          pending: {
            kind: "play_flying_kick",
            cardHandIndex: idx,
            move: def.effect.move,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
            knockback: def.effect.knockback,
          },
        });
      }

      if (def.effect.type === "great_sword") {
        return noHits({
          ...state,
          pending: {
            kind: "play_great_sword",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
            secondaryMinDamage: def.effect.secondaryMinDamage,
            secondaryMaxDamage: def.effect.secondaryMaxDamage,
          },
        });
      }

      return noHits(state);
    }

    case "RESOLVE_DUAL_WIELD_DISCARD": {
      const stage = state.dualWieldStage;
      if (!stage || stage.step !== "choose_discard_attack") return noHits(state);
      const def = state.cardDefs.get(cmd.cardId);
      if (!isPhysicalMeleeAttack(def) || cmd.cardId === stage.firstCardId) {
        return noHits(log(state, "Choose another physical melee Attack."));
      }
      const discardIndex = state.player.discardPile.indexOf(cmd.cardId);
      if (discardIndex < 0) return noHits(log(state, "That card is not in your discard pile."));
      const discardPile = [...state.player.discardPile];
      discardPile.splice(discardIndex, 1);
      const hand = [...state.player.hand, cmd.cardId];
      const staged: GameState = {
        ...state,
        player: { ...state.player, discardPile, hand },
        dualWieldStage: { step: "resolving_discard_attack", firstCardId: stage.firstCardId },
      };
      return dispatchCore(staged, { type: "REQUEST_PLAY_CARD", handIndex: hand.length - 1 });
    }

    case "REQUEST_DISCARD_BONUS": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      const idx = cmd.handIndex;
      const cardId = state.player.hand[idx];
      if (!cardId) return noHits(state);
      if (state.cardDefs.get(cardId)?.effect.type === "penalty_destroy") {
        return noHits(log(state, "Weariness cannot be used for bonus actions."));
      }
      const hand = state.player.hand.filter((_, i) => i !== idx);
      const isBonus = state.cardDefs.get(cardId)?.effect.type === "bonus_chit";
      const discardPile = isBonus ? state.player.discardPile : [...state.player.discardPile, cardId];
      let s: GameState = { ...state, player: { ...state.player, hand, discardPile } };
      const name = state.cardDefs.get(cardId)?.name ?? cardId;
      if (cmd.bonus === "move1") {
        const bonusMoveRange = state.player.hasteThisTurn ? 2 : 1;
        s = log(
          s,
          isBonus
            ? `Bonus Card destroyed — bonus move (${bonusMoveRange} space${bonusMoveRange > 1 ? "s" : ""}).`
            : `Discarded ${name} for a bonus move (${bonusMoveRange} space${bonusMoveRange > 1 ? "s" : ""}).`,
        );
        return noHits({
          ...s,
          pending: { kind: "discard_move1", maxRange: bonusMoveRange, fromQuickstep: false },
        });
      }
      if (cmd.bonus === "punch") {
        s = log(
          s,
          isBonus ? `Bonus Card destroyed — punch.` : `Discarded ${name} for a punch.`,
        );
        return noHits({ ...s, pending: { kind: "discard_punch" } });
      }
      s = log(
        s,
        isBonus ? `Bonus Card destroyed — you investigate.` : `Discarded ${name} to investigate.`,
      );
      s = investigateRevealOneRoom(s);
      s = collectAdjacentLoot(s);
      return noHits(s);
    }

    case "CONFIRM_TARGET_TILE": {
      if (!state.pending) return noHits(state);
      const dest = { x: cmd.x, y: cmd.y };
      const from = { x: state.player.x, y: state.player.y };
      if (
        state.pending.kind === "play_melee" ||
        state.pending.kind === "play_spear" ||
        state.pending.kind === "play_knife" ||
        state.pending.kind === "play_axe" ||
        state.pending.kind === "discard_punch" ||
        state.pending.kind === "play_magic_missile" ||
        state.pending.kind === "play_knockback_punch" ||
        state.pending.kind === "play_bow_attack" ||
        state.pending.kind === "play_lightning_bolt" ||
        state.pending.kind === "play_mace_smash" ||
        state.pending.kind === "play_poisoned_blade" ||
        state.pending.kind === "play_great_sword"
      ) {
        return resolvePlayerAttackAtTile(state, dest);
      }

      const moveKinds =
        state.pending.kind === "play_move" ||
        state.pending.kind === "discard_move1" ||
        state.pending.kind === "move_token_step" ||
        state.pending.kind === "play_card_seeker" ||
        state.pending.kind === "play_loot_and_scoot" ||
        state.pending.kind === "play_flying_kick";
      if (moveKinds && playerEntangled(state)) {
        return noHits(log(state, "Tangleweed holds you — kill it before you can move."));
      }

      if (state.pending.kind === "play_move") {
        const p = state.pending;
        if (state.player.suppressNextMove) {
          const hand = [...state.player.hand];
          const cardId = hand[p.cardHandIndex];
          if (!cardId) return noHits(state);
          hand.splice(p.cardHandIndex, 1);
          let s: GameState = {
            ...state,
            player: {
              ...playerAfterPlayingCard(state, hand, cardId),
              suppressNextMove: false,
            },
            pending: null,
          };
          return noHits(log(s, "The axe's weight cancels your move — card spent, you stay put."));
        }
        const occ = occupiedForPlayerMove(state);
        let reach = reachableOrthogonal(
          state.tiles,
          state.width,
          state.height,
          from,
          p.range,
          occ,
          rockKeySet(state),
          bridgeTileKeySet(state),
        );
        reach = extendMoveReachForPending(state, reach, from, p);
        reach = addAdjacentPureWaterTiles(state, reach, from);
        if (!reach.has(keyOf(dest))) return noHits(state);

        const mimicHere = state.monsters.find(
          (m) => m.defId === "mimic" && m.mimicAsleep && m.x === dest.x && m.y === dest.y,
        );
        if (mimicHere) {
          const hand = [...state.player.hand];
          const cardId = hand[p.cardHandIndex];
          if (!cardId) return noHits(state);
          hand.splice(p.cardHandIndex, 1);
          const raw = rollInt(3, 4);
          const dmg = incomingDamageToPlayer(state, raw);
          const hp = Math.max(0, state.player.hp - dmg);
          const px = state.player.x;
          const py = state.player.y;
          if (hp <= 0) {
            return withHits(log(
                {
                  ...state,
                  player: { ...playerAfterPlayingCard(state, hand, cardId), hp: 0 },
                  phase: "defeat",
                  pending: null,
                },
                "The mimic's bite is fatal.",
              ), [{ gridX: px, gridY: py, damage: dmg }],);
          }
          let s: GameState = {
            ...state,
            player: { ...playerAfterPlayingCard(state, hand, cardId), hp },
            pending: null,
          };
          s = awakenMimicOnTile(s, dest.x, dest.y);
          s = log(s, "The chest strikes — the Mimic wakes!");
          return withHits(s, [{ gridX: px, gridY: py, damage: dmg }],);
        }

        const brPlayMove = bridgeTileKeySet(state);
        if (tileAt(state.tiles, dest) === "water" && !brPlayMove.has(keyOf(dest))) {
          const handW = [...state.player.hand];
          const cardIdW = handW[p.cardHandIndex];
          if (!cardIdW) return noHits(state);
          handW.splice(p.cardHandIndex, 1);
          const rawW = state.danger;
          const dmgW = incomingDamageToPlayer(state, rawW);
          const hpW = Math.max(0, state.player.hp - dmgW);
          let sw: GameState = {
            ...state,
            player: { ...playerAfterPlayingCard(state, handW, cardIdW), hp: hpW },
            pending: { kind: "water_escape", waterX: dest.x, waterY: dest.y },
          };
          sw = log(
            sw,
            `The water pulls you under — ${dmgW} damage! Discard a card and choose adjacent land to escape.`,
          );
          if (hpW <= 0) {
            return withHits(log(
                { ...sw, player: { ...sw.player, hp: 0 }, phase: "defeat", pending: null },
                "You drown.",
              ), [{ gridX: state.player.x, gridY: state.player.y, damage: dmgW }],);
          }
          return withHits(sw, [{ gridX: state.player.x, gridY: state.player.y, damage: dmgW }]);
        }

        if (tileAt(state.tiles, dest) === "blocked") {
          if (state.player.hand.length < 2) {
            return noHits(log(state, "You need two cards in hand to enter the rubble."));
          }
          return noHits({
            ...state,
            pending: {
              kind: "enter_blocked_tile",
              dest,
              resume: {
                kind: "play_move",
                cardHandIndex: p.cardHandIndex,
                range: p.range,
              },
            },
          });
        }

        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        let s: GameState = {
          ...state,
          player: {
            ...playerAfterPlayingCard(state, hand, cardId),
            x: dest.x,
            y: dest.y,
            movementCardsPlayedThisTurn: state.player.movementCardsPlayedThisTurn + 1,
          },
          pending: null,
        };
        s = revealAtPlayer(s);
        s = log(s, `Played ${state.cardDefs.get(cardId)?.name ?? cardId} — moved.`);
        s = resolvePlayerEnterTile(s, dest.x, dest.y);
        return noHits(s);
      }

      if (state.pending.kind === "play_card_seeker") {
        const p = state.pending;
        if (state.player.suppressNextMove) {
          const hand = [...state.player.hand];
          const cardId = hand[p.cardHandIndex];
          if (!cardId) return noHits(state);
          hand.splice(p.cardHandIndex, 1);
          return noHits(
            log(
              {
                ...state,
                player: {
                  ...playerAfterPlayingCard(state, hand, cardId),
                  suppressNextMove: false,
                },
                pending: null,
              },
              "The axe's weight cancels your move — Card Seeker spent, you stay put.",
            ),
          );
        }
        const occ = occupiedForPlayerMove(state);
        let reach = reachableOrthogonal(
          state.tiles,
          state.width,
          state.height,
          from,
          p.range,
          occ,
          rockKeySet(state),
          bridgeTileKeySet(state),
        );
        reach = extendMoveReachForPending(state, reach, from, p);
        reach = addAdjacentPureWaterTiles(state, reach, from);
        if (!reach.has(keyOf(dest))) return noHits(state);

        const mimicHere = state.monsters.find(
          (m) => m.defId === "mimic" && m.mimicAsleep && m.x === dest.x && m.y === dest.y,
        );
        if (mimicHere) {
          const hand = [...state.player.hand];
          const cardId = hand[p.cardHandIndex];
          if (!cardId) return noHits(state);
          hand.splice(p.cardHandIndex, 1);
          const raw = rollInt(3, 4);
          const dmg = incomingDamageToPlayer(state, raw);
          const hp = Math.max(0, state.player.hp - dmg);
          const px = state.player.x;
          const py = state.player.y;
          if (hp <= 0) {
            return withHits(log(
                {
                  ...state,
                  player: { ...playerAfterPlayingCard(state, hand, cardId), hp: 0 },
                  phase: "defeat",
                  pending: null,
                },
                "The mimic's bite is fatal.",
              ), [{ gridX: px, gridY: py, damage: dmg }],);
          }
          let s: GameState = {
            ...state,
            player: { ...playerAfterPlayingCard(state, hand, cardId), hp },
            pending: null,
          };
          s = awakenMimicOnTile(s, dest.x, dest.y);
          s = log(s, "The chest strikes — the Mimic wakes!");
          return withHits(s, [{ gridX: px, gridY: py, damage: dmg }],);
        }

        const brSeek = bridgeTileKeySet(state);
        if (tileAt(state.tiles, dest) === "water" && !brSeek.has(keyOf(dest))) {
          const handWs = [...state.player.hand];
          const cardIdWs = handWs[p.cardHandIndex];
          if (!cardIdWs) return noHits(state);
          handWs.splice(p.cardHandIndex, 1);
          const dmgWs = incomingDamageToPlayer(state, state.danger);
          const hpWs = Math.max(0, state.player.hp - dmgWs);
          let sws: GameState = {
            ...state,
            player: { ...playerAfterPlayingCard(state, handWs, cardIdWs), hp: hpWs },
            pending: { kind: "water_escape", waterX: dest.x, waterY: dest.y },
          };
          sws = log(
            sws,
            `The water pulls you under — ${dmgWs} damage! Discard a card and choose adjacent land to escape.`,
          );
          if (hpWs <= 0) {
            return withHits(log(
                { ...sws, player: { ...sws.player, hp: 0 }, phase: "defeat", pending: null },
                "You drown.",
              ), [{ gridX: state.player.x, gridY: state.player.y, damage: dmgWs }],);
          }
          return withHits(sws, [{ gridX: state.player.x, gridY: state.player.y, damage: dmgWs }]);
        }

        if (tileAt(state.tiles, dest) === "blocked") {
          if (state.player.hand.length < 2) {
            return noHits(log(state, "You need two cards in hand to enter the rubble."));
          }
          return noHits({
            ...state,
            pending: {
              kind: "enter_blocked_tile",
              dest,
              resume: {
                kind: "play_card_seeker",
                cardHandIndex: p.cardHandIndex,
                range: p.range,
              },
            },
          });
        }

        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const nm = state.cardDefs.get(cardId)?.name ?? cardId;
        let s: GameState = {
          ...state,
          player: {
            ...playerAfterPlayingCard(state, hand, cardId),
            x: dest.x,
            y: dest.y,
            movementCardsPlayedThisTurn: state.player.movementCardsPlayedThisTurn + 1,
          },
          pending: null,
        };
        s = revealAtPlayer(s);
        s = log(s, `Played ${nm} — moved.`);
        s = resolvePlayerEnterTile(s, dest.x, dest.y);
        s = spawnGroundCardLootInDiscovered(s, 2);
        return noHits(s);
      }

      if (state.pending.kind === "play_loot_and_scoot") {
        const p = state.pending;
        if (state.player.suppressNextMove) {
          const hand = [...state.player.hand];
          const cardId = hand[p.cardHandIndex];
          if (!cardId) return noHits(state);
          hand.splice(p.cardHandIndex, 1);
          let s: GameState = {
            ...state,
            player: {
              ...playerAfterPlayingCard(state, hand, cardId),
              suppressNextMove: false,
            },
            pending: null,
          };
          s = spawnGroundCoinsInDungeon(s, rollInt(0, p.maxCoins));
          return noHits(log(s, "The axe's weight cancels Loot and Scoot's movement."));
        }
        const occ = occupiedForPlayerMove(state);
        const reach = reachableOrthogonal(
          state.tiles,
          state.width,
          state.height,
          from,
          p.range,
          occ,
          rockKeySet(state),
          bridgeTileKeySet(state),
        );
        if (
          !reach.has(keyOf(dest)) ||
          tileAt(state.tiles, dest) !== "floor"
        ) {
          return noHits(state);
        }
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const landedOnPot = state.pots.some((pot) => pot.x === dest.x && pot.y === dest.y);
        let s: GameState = {
          ...state,
          player: {
            ...playerAfterPlayingCard(state, hand, cardId),
            x: dest.x,
            y: dest.y,
            movementCardsPlayedThisTurn: state.player.movementCardsPlayedThisTurn + 1,
          },
          pending: null,
        };
        s = spawnGroundCoinsInDungeon(s, rollInt(0, p.maxCoins));
        s = revealAtPlayer(s);
        s = resolvePlayerEnterTile(s, dest.x, dest.y);
        if (landedOnPot) {
          s = log(
            { ...s, player: { ...s.player, gold: s.player.gold + 1 } },
            "Loot and Scoot — +1 bonus gold from the pot.",
          );
        }
        return noHits(s);
      }

      if (state.pending.kind === "play_flying_kick") {
        const p = state.pending;
        if (state.player.suppressNextMove) {
          const consumed = consumePlayedCard(state, p.cardHandIndex);
          if (!consumed) return noHits(state);
          return noHits(
            log(
              {
                ...consumed.state,
                player: { ...consumed.state.player, suppressNextMove: false },
              },
              "The axe's weight cancels Flying Kick — nothing else happens.",
            ),
          );
        }
        const dxTotal = dest.x - from.x;
        const dyTotal = dest.y - from.y;
        const cardinal = (dxTotal === 0) !== (dyTotal === 0);
        if (!cardinal || Math.abs(dxTotal) + Math.abs(dyTotal) !== p.move) return noHits(state);
        const dx = Math.sign(dxTotal);
        const dy = Math.sign(dyTotal);
        const path = Array.from({ length: p.move }, (_, i) => ({
          x: from.x + dx * (i + 1),
          y: from.y + dy * (i + 1),
        }));
        const blocked = path.some(
          (cell) =>
            tileAt(state.tiles, cell) !== "floor" ||
            state.rocks.some((r) => r.x === cell.x && r.y === cell.y) ||
            state.chests.some((c) => c.x === cell.x && c.y === cell.y),
        );
        if (blocked) return noHits(log(state, "Flying Kick is blocked — nothing happens."));
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        let s: GameState = {
          ...state,
          player: playerAfterPlayingCard(state, hand, cardId),
          pending: null,
        };
        const raw = weaponAttackRollRaw(s, cardId, p.minDamage, p.maxDamage);
        const hits: HitVisual[] = [];
        const survivors: string[] = [];
        for (const cell of path) {
          if (!hasAttackTargetAt(s, cell.x, cell.y)) continue;
          const result = damageAttackTargetsAt(s, cell, raw, "melee_slash");
          s = result.state;
          hits.push(...result.hits);
          survivors.push(...result.survivorMonsterIds);
        }
        const afterCombat = s;
        const knockMoves: TurnAnimEvent[] = [];
        for (const id of survivors) {
          s = tryKnockMonsterInDirection(s, id, dx, dy, p.knockback, knockMoves);
        }
        if (!s.monsters.some((m) => m.hp > 0 && m.x === dest.x && m.y === dest.y)) {
          s = {
            ...s,
            player: {
              ...s.player,
              x: dest.x,
              y: dest.y,
              movementCardsPlayedThisTurn: state.player.movementCardsPlayedThisTurn + 1,
            },
          };
          s = revealAtPlayer(s);
          s = resolvePlayerEnterTile(s, dest.x, dest.y);
        } else {
          s = log(s, "A surviving target stops the kick short.");
        }
        s = consumeStrengthGemIfPhysical(s, cardId);
        s = log(s, "Flying Kick!");
        return {
          state: s,
          hits,
          anims: [...animsFromHits(hits, afterCombat), ...knockMoves],
        };
      }

      if (state.pending.kind === "discard_move1") {
        const dm = state.pending;
        if (state.player.suppressNextMove) {
          return noHits(
            log(
              {
                ...state,
                player: { ...state.player, suppressNextMove: false },
                pending: null,
              },
              "The axe's curse cancels your step.",
            ),
          );
        }
        const occ = occupiedForPlayerMove(state);
        let reach = reachableOrthogonal(
          state.tiles,
          state.width,
          state.height,
          from,
          dm.maxRange,
          occ,
          rockKeySet(state),
          bridgeTileKeySet(state),
        );
        reach = extendMoveReachForPending(state, reach, from, dm);
        reach = addAdjacentPureWaterTiles(state, reach, from);
        if (!reach.has(keyOf(dest))) return noHits(state);

        const mimicHere = state.monsters.find(
          (m) => m.defId === "mimic" && m.mimicAsleep && m.x === dest.x && m.y === dest.y,
        );
        if (mimicHere) {
          let s: GameState = {
            ...state,
            player: { ...state.player, suppressNextMove: false },
            pending: null,
          };
          const raw = rollInt(3, 4);
          const dmg = incomingDamageToPlayer(s, raw);
          const hp = Math.max(0, s.player.hp - dmg);
          const px = s.player.x;
          const py = s.player.y;
          if (hp <= 0) {
            return withHits(log(
                { ...s, player: { ...s.player, hp: 0 }, phase: "defeat" },
                "The mimic's bite is fatal.",
              ), [{ gridX: px, gridY: py, damage: dmg }],);
          }
          s = { ...s, player: { ...s.player, hp } };
          s = awakenMimicOnTile(s, dest.x, dest.y);
          s = log(s, "The chest strikes — the Mimic wakes!");
          return withHits(s, [{ gridX: px, gridY: py, damage: dmg }],);
        }

        const brDm = bridgeTileKeySet(state);
        if (tileAt(state.tiles, dest) === "water" && !brDm.has(keyOf(dest))) {
          const dmgD = incomingDamageToPlayer(state, state.danger);
          const hpD = Math.max(0, state.player.hp - dmgD);
          let sd: GameState = {
            ...state,
            player: { ...state.player, hp: hpD, suppressNextMove: false },
            pending: { kind: "water_escape", waterX: dest.x, waterY: dest.y },
          };
          sd = log(
            sd,
            `The water pulls you under — ${dmgD} damage! Discard a card and choose adjacent land to escape.`,
          );
          if (hpD <= 0) {
            return withHits(log(
                { ...sd, player: { ...sd.player, hp: 0 }, phase: "defeat", pending: null },
                "You drown.",
              ), [{ gridX: state.player.x, gridY: state.player.y, damage: dmgD }],);
          }
          return withHits(sd, [{ gridX: state.player.x, gridY: state.player.y, damage: dmgD }]);
        }

        if (tileAt(state.tiles, dest) === "blocked") {
          if (state.player.hand.length < 1) {
            return noHits(log(state, "You need a card to discard to enter the rubble."));
          }
          return noHits({
            ...state,
            pending: {
              kind: "enter_blocked_tile",
              dest,
              resume: {
                kind: "discard_move1",
                maxRange: dm.maxRange,
                fromQuickstep: dm.fromQuickstep,
              },
            },
          });
        }

        let playerPatch = { ...state.player, x: dest.x, y: dest.y };
        if (dm.fromQuickstep) {
          playerPatch = {
            ...playerPatch,
            movementCardsPlayedThisTurn: state.player.movementCardsPlayedThisTurn + 1,
          };
        }
        let s: GameState = {
          ...state,
          player: playerPatch,
          pending: null,
        };
        s = revealAtPlayer(s);
        const moveMsg = dm.fromQuickstep
          ? dm.maxRange > 1
            ? `Quickstep — moved up to ${dm.maxRange} spaces.`
            : "Quickstep — stepped."
          : "Bonus move — stepped 1 space.";
        s = log(s, moveMsg);
        s = resolvePlayerEnterTile(s, dest.x, dest.y);
        return noHits(s);
      }

      if (state.pending.kind === "move_token_step") {
        if (state.player.suppressNextMove) {
          return noHits(
            log(
              {
                ...state,
                player: { ...state.player, suppressNextMove: false },
                pending: null,
              },
              "The axe's curse cancels your token step.",
            ),
          );
        }
        if (state.player.moveTokens <= 0) return noHits(state);
        const occ = occupiedForPlayerMove(state);
        let reach = reachableOrthogonal(
          state.tiles,
          state.width,
          state.height,
          from,
          hasteMovementRange(state, 1),
          occ,
          rockKeySet(state),
          bridgeTileKeySet(state),
        );
        reach = extendMoveReachForPending(state, reach, from, state.pending);
        reach = addAdjacentPureWaterTiles(state, reach, from);
        if (!reach.has(keyOf(dest))) return noHits(state);

        const mimicHere = state.monsters.find(
          (m) => m.defId === "mimic" && m.mimicAsleep && m.x === dest.x && m.y === dest.y,
        );
        if (mimicHere) {
          const raw = rollInt(3, 4);
          const dmg = incomingDamageToPlayer(state, raw);
          const hp = Math.max(0, state.player.hp - dmg);
          const px = state.player.x;
          const py = state.player.y;
          if (hp <= 0) {
            return withHits(log(
                {
                  ...state,
                  player: { ...state.player, hp: 0 },
                  phase: "defeat",
                  pending: null,
                },
                "The mimic's bite is fatal.",
              ), [{ gridX: px, gridY: py, damage: dmg }],);
          }
          let s: GameState = {
            ...state,
            player: { ...state.player, hp, moveTokens: state.player.moveTokens - 1 },
            pending: null,
          };
          s = awakenMimicOnTile(s, dest.x, dest.y);
          s = log(s, "The chest strikes — the Mimic wakes!");
          return withHits(s, [{ gridX: px, gridY: py, damage: dmg }],);
        }

        const brTok = bridgeTileKeySet(state);
        if (tileAt(state.tiles, dest) === "water" && !brTok.has(keyOf(dest))) {
          const dmgT = incomingDamageToPlayer(state, state.danger);
          const hpT = Math.max(0, state.player.hp - dmgT);
          let st: GameState = {
            ...state,
            player: {
              ...state.player,
              hp: hpT,
              moveTokens: state.player.moveTokens - 1,
            },
            pending: { kind: "water_escape", waterX: dest.x, waterY: dest.y },
          };
          st = log(
            st,
            `The water pulls you under — ${dmgT} damage! Discard a card and choose adjacent land to escape.`,
          );
          if (hpT <= 0) {
            return withHits(log(
                { ...st, player: { ...st.player, hp: 0 }, phase: "defeat", pending: null },
                "You drown.",
              ), [{ gridX: state.player.x, gridY: state.player.y, damage: dmgT }],);
          }
          return withHits(st, [{ gridX: state.player.x, gridY: state.player.y, damage: dmgT }]);
        }

        if (tileAt(state.tiles, dest) === "blocked") {
          if (state.player.hand.length < 1) {
            return noHits(log(state, "You need a card to discard to enter the rubble."));
          }
          return noHits({
            ...state,
            pending: {
              kind: "enter_blocked_tile",
              dest,
              resume: { kind: "move_token_step" },
            },
          });
        }

        let s: GameState = {
          ...state,
          player: {
            ...state.player,
            x: dest.x,
            y: dest.y,
            moveTokens: state.player.moveTokens - 1,
          },
          pending: null,
        };
        s = revealAtPlayer(s);
        s = log(s, "Move token — stepped 1 space.");
        s = resolvePlayerEnterTile(s, dest.x, dest.y);
        return noHits(s);
      }

      if (state.pending.kind === "play_fireball") {
        const p = state.pending;
        const P = { x: state.player.x, y: state.player.y };
        if (chebyshev(P, dest) > p.range) return noHits(log(state, "Target is out of fireball range."));
        if (!lineOfSightClear(state.tiles, P, dest))
          return noHits(log(state, "No line of sight to target tile."));
        if (tileAt(state.tiles, dest) !== "floor")
          return noHits(log(state, "Cannot target a wall."));

        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);

        const hits: HitVisual[] = [
          {
            gridX: dest.x,
            gridY: dest.y,
            damage: 0,
            showDamage: false,
            fx: playerAttackFx(state, "fireball"),
          },
        ];
        let s: GameState = {
          ...state,
          player: playerAfterPlayingCard(state, hand, cardId),
          pending: null,
        };
        const dmg = magicAttackRollRaw(s, cardId, p.minDamage, p.maxDamage);
        const fireLvls = rollInt(p.minFire, p.maxFire);

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const tx = dest.x + dx;
            const ty = dest.y + dy;
            const cell = { x: tx, y: ty };
            const t = tileAt(s.tiles, cell);
            if (t !== "floor" && t !== "water") continue;
            if (s.pots.some((pot) => pot.x === tx && pot.y === ty)) {
              s = breakPotFromAttack(s, tx, ty);
            }
            for (const tw of s.tangleweeds.filter((w) => w.hp > 0 && w.x === tx && w.y === ty)) {
              const hp = Math.max(0, tw.hp - dmg);
              s = {
                ...s,
                tangleweeds: s.tangleweeds.map((w) => (w.id === tw.id ? { ...w, hp } : w)),
              };
              hits.push({ gridX: tx, gridY: ty, damage: dmg });
              if (hp <= 0) s = log(s, "Tangleweed burned away.");
            }
            if (s.player.x === tx && s.player.y === ty) {
              const pdmg = incomingDamageToPlayer(s, dmg);
              const php = Math.max(0, s.player.hp - pdmg);
              s = {
                ...s,
                player: {
                  ...s.player,
                  hp: php,
                  fireLevels: (s.player.fireLevels ?? 0) + fireLvls,
                },
              };
              hits.push({ gridX: tx, gridY: ty, damage: pdmg });
              s = log(s, `You are caught in the fireball — ${pdmg} damage and Fire ${fireLvls}!`);
              if (php <= 0) {
                return withHits(
                  { ...s, phase: "defeat" },
                  hits,
                );
              }
            }
            const monstersHere = s.monsters.filter((m) => m.hp > 0 && m.x === tx && m.y === ty);
            for (const target of monstersHere) {
              const defM = s.monsterDefs.get(target.defId);
              const finalDmg = applyDefense(dmg, monsterDefenseForIncoming(target, defM));
              const hp = Math.max(0, target.hp - finalDmg);
              s = { ...s, monsters: patchMonsterHp(s.monsters, target.id, hp) };
              s = { ...s, monsters: applyFireToMonster(s.monsters, target.id, fireLvls) };
              hits.push({ gridX: tx, gridY: ty, damage: finalDmg });
              if (hp <= 0) {
                s = log(s, `${defM?.name ?? "Enemy"} consumed by fire!`);
                s = applyMonsterKillRewards(s, target.defId, target.x, target.y);
              }
            }
          }
        }
        s = log(s, `Fireball! ${dmg} damage in a 3×3 blast, ${fireLvls} Fire level(s) inflicted.`);
        return withHits(s, hits);
      }

      if (state.pending.kind === "play_potion_of_harming") {
        const p = state.pending;
        const P = { x: state.player.x, y: state.player.y };
        if (chebyshev(P, dest) > p.range) return noHits(log(state, "Target is out of range."));
        if (tileAt(state.tiles, dest) === "wall") return noHits(log(state, "Cannot target a wall."));
        const consumed = consumePlayedCard(state, p.cardHandIndex);
        if (!consumed) return noHits(state);
        let s = consumed.state;
        const hits: HitVisual[] = [
          {
            gridX: dest.x,
            gridY: dest.y,
            damage: 0,
            showDamage: false,
            fx: { kind: "potion_harming", fromX: P.x, fromY: P.y },
          },
        ];
        for (const mon of s.monsters.filter((m) => m.hp > 0 && m.x === dest.x && m.y === dest.y)) {
          const hp = Math.max(0, mon.hp - p.damage);
          s = { ...s, monsters: patchMonsterHp(s.monsters, mon.id, hp) };
          hits.push({ gridX: dest.x, gridY: dest.y, damage: p.damage });
          if (hp <= 0) {
            s = log(s, `${s.monsterDefs.get(mon.defId)?.name ?? "Enemy"} defeated.`);
            s = applyMonsterKillRewards(s, mon.defId, mon.x, mon.y);
          } else {
            s = log(s, `Potion of Harming hits for ${p.damage}.`);
          }
        }
        for (const tw of s.tangleweeds.filter((t) => t.hp > 0 && t.x === dest.x && t.y === dest.y)) {
          const hp = Math.max(0, tw.hp - p.damage);
          s = {
            ...s,
            tangleweeds: s.tangleweeds.map((t) => (t.id === tw.id ? { ...t, hp } : t)),
          };
          hits.push({ gridX: dest.x, gridY: dest.y, damage: p.damage });
        }
        if (s.player.x === dest.x && s.player.y === dest.y) {
          const dmg = incomingDamageToPlayer(s, p.damage);
          const hp = Math.max(0, s.player.hp - dmg);
          s = { ...s, player: { ...s.player, hp } };
          hits.push({ gridX: dest.x, gridY: dest.y, damage: dmg });
          s = log(s, `You are caught in the potion blast — ${dmg} damage!`);
          if (hp <= 0) return withHits({ ...s, phase: "defeat" }, hits);
        }
        const clouds = s.harmingClouds.filter((c) => !(c.x === dest.x && c.y === dest.y));
        clouds.push({
          id: nextHarmingCloudId(s),
          x: dest.x,
          y: dest.y,
          turnsLeft: p.cloudTurns,
        });
        s = {
          ...s,
          harmingClouds: clouds,
        };
        s = log(s, `A harming cloud settles for ${p.cloudTurns} turns.`);
        return withHits(s, hits);
      }

      return noHits(state);
    }

    case "CONFIRM_ENTER_BLOCKED": {
      if (state.phase !== "player") return noHits(state);
      const pb = state.pending;
      if (!pb || pb.kind !== "enter_blocked_tile") return noHits(state);
      const extraIdx = cmd.handIndex;
      const dest = pb.dest;
      const resume = pb.resume;
      if (!state.player.hand[extraIdx]) return noHits(state);

      if (resume.kind === "play_move" || resume.kind === "play_card_seeker") {
        if (extraIdx === resume.cardHandIndex) {
          return noHits(log(state, "Pick a different card for the extra cost."));
        }
        const playedId = state.player.hand[resume.cardHandIndex];
        const extraId = state.player.hand[extraIdx];
        if (!playedId || !extraId) return noHits(state);
        const { nextHand, removed } = removeHandIndices(state.player.hand, [
          resume.cardHandIndex,
          extraIdx,
        ]);
        if (removed.length !== 2) return noHits(state);
        const playedPlayer = playerAfterPlayingCard(state, nextHand, playedId);
        const discardPile = [...playedPlayer.discardPile, extraId];
        if (resume.kind === "play_move") {
          let s: GameState = {
            ...state,
            player: {
              ...playedPlayer,
              discardPile,
              x: dest.x,
              y: dest.y,
              movementCardsPlayedThisTurn: state.player.movementCardsPlayedThisTurn + 1,
            },
            pending: null,
          };
          s = revealAtPlayer(s);
          s = log(s, "You force a path through the rubble.");
          s = resolvePlayerEnterTile(s, dest.x, dest.y);
          return noHits(s);
        }
        let s: GameState = {
          ...state,
          player: {
            ...playedPlayer,
            discardPile,
            x: dest.x,
            y: dest.y,
            movementCardsPlayedThisTurn: state.player.movementCardsPlayedThisTurn + 1,
          },
          pending: null,
        };
        s = revealAtPlayer(s);
        s = log(s, "You squeeze through the rubble.");
        s = resolvePlayerEnterTile(s, dest.x, dest.y);
        s = spawnGroundCardLootInDiscovered(s, 2);
        return noHits(s);
      }

      if (resume.kind === "discard_move1") {
        const { nextHand, removed } = removeHandIndices(state.player.hand, [extraIdx]);
        if (removed.length !== 1) return noHits(state);
        const discardPile = [...state.player.discardPile, ...removed];
        let playerPatch = {
          ...state.player,
          hand: nextHand,
          discardPile,
          x: dest.x,
          y: dest.y,
        };
        if (resume.fromQuickstep) {
          playerPatch = {
            ...playerPatch,
            movementCardsPlayedThisTurn: state.player.movementCardsPlayedThisTurn + 1,
          };
        }
        let s: GameState = { ...state, player: playerPatch, pending: null };
        s = revealAtPlayer(s);
        s = log(s, "You climb through the rubble.");
        s = resolvePlayerEnterTile(s, dest.x, dest.y);
        return noHits(s);
      }

      if (resume.kind === "move_token_step") {
        if (state.player.moveTokens <= 0) return noHits(state);
        const { nextHand, removed } = removeHandIndices(state.player.hand, [extraIdx]);
        if (removed.length !== 1) return noHits(state);
        const discardPile = [...state.player.discardPile, ...removed];
        let s: GameState = {
          ...state,
          player: {
            ...state.player,
            hand: nextHand,
            discardPile,
            x: dest.x,
            y: dest.y,
            moveTokens: state.player.moveTokens - 1,
          },
          pending: null,
        };
        s = revealAtPlayer(s);
        s = log(s, "You burn a move token and a card to cross the rubble.");
        s = resolvePlayerEnterTile(s, dest.x, dest.y);
        return noHits(s);
      }

      return noHits(state);
    }

    case "CONFIRM_TARGET_MONSTER": {
      if (!state.pending) return noHits(state);
      const mon = state.monsters.find((m) => m.id === cmd.monsterInstanceId && m.hp > 0);
      return mon ? resolvePlayerAttackAtTile(state, { x: mon.x, y: mon.y }) : noHits(state);
    }

    case "CONFIRM_TARGET_POT": {
      if (!state.pending) return noHits(state);
      const pot = state.pots.find((p) => p.id === cmd.potId);
      return pot ? resolvePlayerAttackAtTile(state, { x: pot.x, y: pot.y }) : noHits(state);
    }

    case "CONFIRM_WATER_ESCAPE": {
      if (state.phase !== "player" || !state.pending || state.pending.kind !== "water_escape") {
        return noHits(state);
      }
      const { waterX, waterY } = state.pending;
      const dest = { x: cmd.destX, y: cmd.destY };
      if (manhattan({ x: waterX, y: waterY }, dest) !== 1) return noHits(state);
      const br = bridgeTileKeySet(state);
      const t = tileAt(state.tiles, dest);
      if (t !== "floor" && !(t === "water" && br.has(keyOf(dest)))) return noHits(state);
      if (occupiedForPlayerMove(state).has(keyOf(dest))) return noHits(state);
      if (state.player.hand.length === 0) {
        return noHits(log(state, "You need a card to discard to escape the water."));
      }
      const handIndex = cmd.handIndex;
      if (handIndex < 0 || handIndex >= state.player.hand.length) {
        return noHits(log(state, "Choose a hand card to discard, then click land."));
      }
      const hand = [...state.player.hand];
      const [cardId] = hand.splice(handIndex, 1);
      if (!cardId) return noHits(state);
      let s: GameState = {
        ...state,
        player: {
          ...state.player,
          x: dest.x,
          y: dest.y,
          hand,
          discardPile: [...state.player.discardPile, cardId],
        },
        pending: null,
      };
      s = revealAtPlayer(s);
      s = resolvePlayerEnterTile(s, dest.x, dest.y);
      return noHits(log(s, "You pull yourself onto solid ground."));
    }

    case "CANCEL_WATER_ESCAPE": {
      if (!state.pending || state.pending.kind !== "water_escape") return noHits(state);
      return noHits({ ...state, pending: null });
    }

    case "CONFIRM_TARGET_TANGLEWEED": {
      if (!state.pending) return noHits(state);
      const tw = state.tangleweeds.find((x) => x.id === cmd.tangleweedId && x.hp > 0);
      return tw ? resolvePlayerAttackAtTile(state, { x: tw.x, y: tw.y }) : noHits(state);
    }

    case "USE_BREAD": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      if (state.player.bread <= 0) return noHits(log(state, "You have no bread."));
      if (state.player.hp >= state.player.maxHp) return noHits(log(state, "You're not hungry."));
      let heal = 2;
      heal += breadHealBonus(state);
      heal = Math.min(heal, state.player.maxHp - state.player.hp);
      return noHits(
        log(
          {
            ...state,
            player: {
              ...state.player,
              bread: state.player.bread - 1,
              hp: state.player.hp + heal,
            },
          },
          `You eat bread and recover ${heal} HP.`,
        ),
      );
    }

    case "USE_HERB": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      if (state.player.herb <= 0) return noHits(log(state, "You have no healing herbs."));
      if (state.player.hp >= state.player.maxHp) return noHits(log(state, "You're at full health."));
      return noHits(
        log(
          {
            ...state,
            player: {
              ...state.player,
              herb: state.player.herb - 1,
              hp: Math.min(state.player.maxHp, state.player.hp + 1),
            },
          },
          "You use a healing herb and recover 1 HP.",
        ),
      );
    }

    case "USE_GEM": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      const count = state.player.gems[cmd.gemId] ?? 0;
      if (count <= 0) return noHits(log(state, "You don't have that gem."));
      const gems = { ...state.player.gems, [cmd.gemId]: count - 1 };
      let s: GameState = { ...state, player: { ...state.player, gems } };
      switch (cmd.gemId) {
        case "strength":
          return noHits(
            log(
              {
                ...s,
                player: { ...s.player, nextPhysicalAttackMultiplier: 1.5 },
              },
              "Gem of Strength — your next physical attack deals ×1.5 damage.",
            ),
          );
        case "speed":
          return noHits(
            log(
              { ...s, player: { ...s.player, nextMoveDoubled: true } },
              "Gem of Speed — your next movement is doubled.",
            ),
          );
        case "luck":
          return noHits(
            log(
              {
                ...s,
                chanceMode: "highest",
                player: {
                  ...s.player,
                  gemLuckRestore: s.player.gemLuckRestore ?? s.chanceMode,
                },
              },
              "Gem of Luck — Chance is Highest for the rest of this turn.",
            ),
          );
        case "cards":
          s = drawFromPlayerDeck(s, 2);
          return noHits(log(s, "Gem of Cards — draw 2."));
        case "healing": {
          const heal = Math.max(1, Math.floor(s.player.maxHp * 0.1));
          const hp = Math.min(s.player.maxHp, s.player.hp + heal);
          return noHits(
            log(
              { ...s, player: { ...s.player, hp } },
              `Gem of Healing — recover ${heal} HP.`,
            ),
          );
        }
      }
      return noHits(s);
    }

    case "USE_MOVE_TOKEN": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      if (state.player.moveTokens <= 0) return noHits(log(state, "No move tokens."));
      return noHits({ ...state, pending: { kind: "move_token_step" } });
    }

    case "USE_KNOCKBACK_TOKEN": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      if (state.player.knockbackTokens <= 0) return noHits(log(state, "No knockback tokens."));
      return noHits(
        log(
          {
            ...state,
            player: {
              ...state.player,
              knockbackTokens: state.player.knockbackTokens - 1,
              knockbackPrimed: state.player.knockbackPrimed + 1,
            },
          },
          `Knockback +${state.player.knockbackPrimed + 1} primed for your next Melee attack.`,
        ),
      );
    }

    case "END_TURN": {
      if (state.phase !== "player") return noHits(state);
      if (state.chestOffer) {
        return noHits(log(state, "Choose a chest card or pass before ending the turn."));
      }
      if (pickupLen > 0) {
        return noHits(log(state, "Resolve the found card before ending the turn."));
      }
      if (state.pending) {
        return noHits(log(state, "Resolve or cancel your pending action before ending the turn."));
      }

      let s = discardHand(state);
      s = tickPlayerFire(s);
      if (s.phase === "defeat") return noHits(s);
      let dungeonHits: HitVisual[] = [];
      pushRollChanceContext(s, "world");
      try {
        const collapsed = applyPendingCollapse(s);
        s = collapsed.state;
        dungeonHits = [...dungeonHits, ...collapsed.hits];
        if (s.phase === "defeat") {
          return { state: s, hits: dungeonHits, anims: animsFromHits(dungeonHits, s) };
        }
        s = applyFloodingTick(s);
        if (!s.gauntletCommenced) {
          const drawn = drawDungeonTop(s);
          s = drawn.state;
          dungeonHits = [...dungeonHits, ...drawn.hits];
        }
        if (s.phase === "defeat") {
          return { state: s, hits: dungeonHits, anims: animsFromHits(dungeonHits, s) };
        }
        const stateAfterDungeon = s;
        const { state: afterMon, hits: monHits, anims: monAnims } = runMonsterPhase(s);
        if (afterMon.phase === "defeat") {
          const merged = mergeAnimResults(dungeonHits, stateAfterDungeon, monAnims, monHits, afterMon);
          return { state: afterMon, ...merged };
        }
        const cleared = processGauntletVictory(afterMon);
        if (cleared.phase === "peace") {
          const merged = mergeAnimResults(dungeonHits, stateAfterDungeon, monAnims, monHits, cleared);
          return { state: cleared, ...merged };
        }
        const nextTurn = beginNextPlayerTurn(cleared);
        const merged = mergeAnimResults(dungeonHits, stateAfterDungeon, monAnims, monHits, nextTurn);
        return { state: nextTurn, ...merged };
      } finally {
        popRollChanceContext();
      }
    }

    case "UNLOCK_SKILL":
      return unlockSkillDispatch(state, cmd.skillId);

    default:
      return noHits(state);
  }
}

function advanceDualWieldAfterFirstAttack(s: GameState, firstCardId: string): GameState {
  const hasChoice = s.player.discardPile.some(
    (id) => id !== firstCardId && isPhysicalMeleeAttack(s.cardDefs.get(id)),
  );
  return log(
    {
      ...s,
      dualWieldStage: hasChoice
        ? { step: "choose_discard_attack", firstCardId }
        : null,
    },
    hasChoice
      ? "Dual Wield — choose a physical melee Attack from your discard pile."
      : "Dual Wield ends — no other physical melee Attack is in your discard pile.",
  );
}

export function dispatch(state: GameState, cmd: GameCommand): DispatchResult {
  pushRollChanceContext(state, "player");
  try {
    const firstCardId =
      cmd.type === "REQUEST_PLAY_CARD" ? state.player.hand[cmd.handIndex] : undefined;
    const r = dispatchCore(state, cmd);
    let s = r.state;
    if (
      state.dualWieldStage?.step === "choose_hand_attack" &&
      cmd.type === "REQUEST_PLAY_CARD" &&
      firstCardId &&
      state.cardDefs.get(firstCardId)?.types.includes("Attack")
    ) {
      if (s.pending) {
        s = {
          ...s,
          dualWieldStage: { step: "resolving_hand_attack", firstCardId },
        };
      } else if (
        s.dualWieldStage?.step === "choose_hand_attack" &&
        s.player.hand.length < state.player.hand.length
      ) {
        // Instant-resolve Attack (e.g. Flurry) — move straight to discard choice.
        s = advanceDualWieldAfterFirstAttack(s, firstCardId);
      }
    } else if (
      s.dualWieldStage?.step === "resolving_hand_attack" &&
      !s.pending
    ) {
      s = advanceDualWieldAfterFirstAttack(s, s.dualWieldStage.firstCardId);
    } else if (
      s.dualWieldStage?.step === "resolving_discard_attack" &&
      !s.pending
    ) {
      s = log({ ...s, dualWieldStage: null }, "Dual Wield complete.");
    }
    s = processGauntletVictory(s);
    s = maybeEliteTeleportAll(s);
    const hits = r.hits;
    const anims = finalizeAnims(state, s, hits, r.anims, cmd);
    return { state: s, hits, anims };
  } finally {
    popRollChanceContext();
  }
}
