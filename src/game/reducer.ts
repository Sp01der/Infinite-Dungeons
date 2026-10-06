import {
  broadswordCleaveCells,
  fireballBlastCells,
  icicleLanceCells,
  spearStrikeCells,
} from "./areaPreview";
import { baseMagicCardId, upgradedMagicCardId } from "./cardUpgrades";
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
  createCatacombsTestState,
  createNextFloorState,
  pickMonsterId,
  pickWeightedDefId,
} from "./initialState";
import { addFootingBlocks, blocksFooting, isLockedDoorAt, keyDoorHaltTiles, unlockLockedDoorsInOccupancy } from "./tombs";
import { runMonsterPhaseWithHooks } from "./monsterAi";
import { cullMonstersWithDouvlonPairs, setMonsterHpWithDouvlonSync } from "./douvlon";
import { animsFromHits, finalizeAnims, mergeAnimResults, pushMoveAnim } from "./turnAnims";
import {
  bonelingLeaderForRoom,
  createMonsterInstance,
  monsterDefenseForIncoming,
  withBonelingLeaderFlag,
} from "./monsterSpawn";
import { convertBonelingToBonePile } from "./boneling";
import { attachStairRoom } from "./stairRoom";
import {
  handleMerchantCommand,
  merchantDisplayName,
  merchantUiBlocks,
  spawnMerchantAfterGauntlet,
} from "./merchantRuntime";
import {
  maybeDropMonsterCoin,
  pickChestOfferCards,
  pickDeckBuilderThreeForType,
  pickPedestalOfferCards,
  pickRandomLootCardId,
  rollCatacombsPotLoot,
  rollChestLoot,
  rollGoldenPotLoot,
  rollMagicPotLoot,
  rollPotLoot,
  trinketLabel,
} from "./loot";
import { addExp } from "./progression";
import {
  applyDamageToPlayer,
  applyGuardDestroyerAfterAttack,
  attackStrengthBonus,
  breadHealBonus,
  descendantSkipDungeonDraw,
  fighterTrainingBonus,
  guardDestroyerBonus,
  hasteMovementRange,
  heavyPunchBonus,
  knockbackTokensGrantedPerTurn,
  lightningBoltSkillDamageBonus,
  mageTrainingBonus,
  moveTokensGrantedPerTurn,
  playerDrawCountPerTurn,
  potLootHitChance,
  punchStrikeCount,
  SID,
  sprinterExtraMoveRange,
  hasSkill,
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
  TrinketId,
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
    s.flameDestroyPending ||
    s.bindTomePending ||
    !!s.deckBuilderOffer ||
    !!s.senseiOffer ||
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

  if (cmd.type === "DEV_SKILL") {
    const def = getSkillDef(cmd.skillId);
    if (!def) return noHits(log(state, "Command: unknown skill."));
    if (state.player.skillsUnlocked.includes(cmd.skillId)) {
      return noHits(log(state, `Command: already have ${def.name}.`));
    }
    let next: GameState = {
      ...state,
      player: {
        ...state.player,
        skillsUnlocked: [...state.player.skillsUnlocked, cmd.skillId],
      },
    };
    next = applySkillUnlockPassives(next, cmd.skillId);
    return noHits(log(next, `Command: unlocked skill ${def.name}.`));
  }

  if (cmd.type === "DEV_ITEM") {
    const qty = Math.max(0, Math.trunc(cmd.quantity));
    if (qty <= 0) return noHits(log(state, "Command: item quantity must be at least 1."));
    const p = state.player;
    switch (cmd.item) {
      case "gold":
        return noHits(
          log(
            { ...state, player: { ...p, gold: p.gold + qty } },
            `Command: added ${qty} gold.`,
          ),
        );
      case "bread":
        return noHits(
          log(
            { ...state, player: { ...p, bread: p.bread + qty } },
            `Command: added ${qty} bread.`,
          ),
        );
      case "herb":
        return noHits(
          log(
            { ...state, player: { ...p, herb: p.herb + qty } },
            `Command: added ${qty} healing herb${qty === 1 ? "" : "s"}.`,
          ),
        );
      case "cheese":
        return noHits(
          log(
            { ...state, player: { ...p, cheese: p.cheese + qty } },
            `Command: added ${qty} cheese.`,
          ),
        );
      case "flameOfDestruction":
        return noHits(
          log(
            {
              ...state,
              player: { ...p, flameOfDestruction: p.flameOfDestruction + qty },
            },
            `Command: added ${qty} Flame of Destruction.`,
          ),
        );
      case "unboundTomes":
        return noHits(
          log(
            { ...state, player: { ...p, unboundTomes: p.unboundTomes + qty } },
            `Command: added ${qty} Unbound Magic Tome${qty === 1 ? "" : "s"}.`,
          ),
        );
      case "throwingKnife":
        return noHits(
          log(
            { ...state, player: { ...p, throwingKnives: p.throwingKnives + qty } },
            `Command: added ${qty} throwing knife${qty === 1 ? "" : "s"}.`,
          ),
        );
      case "healingPendant":
        return noHits(
          log(
            { ...state, player: { ...p, healingPendants: p.healingPendants + qty } },
            `Command: added ${qty} healing pendant${qty === 1 ? "" : "s"}.`,
          ),
        );
      case "shieldingRing":
        return noHits(
          log(
            { ...state, player: { ...p, shieldingRings: p.shieldingRings + qty } },
            `Command: added ${qty} shielding ring${qty === 1 ? "" : "s"}.`,
          ),
        );
      case "key":
        return noHits(
          log(
            { ...state, player: { ...p, keys: p.keys + qty } },
            `Command: added ${qty} key${qty === 1 ? "" : "s"}.`,
          ),
        );
      case "gem": {
        const gemId = cmd.gemId;
        if (!gemId) return noHits(log(state, "Command: missing gem type."));
        const gems = { ...p.gems, [gemId]: p.gems[gemId] + qty };
        const label = gemId[0]!.toUpperCase() + gemId.slice(1);
        return noHits(
          log(
            { ...state, player: { ...p, gems } },
            `Command: added ${qty} Gem of ${label}.`,
          ),
        );
      }
    }
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
          !state.rocks.some((r) => r.x === np.x && r.y === np.y) &&
          !blocksFooting(state, np.x, np.y),
      );
    if (adj.length === 0) {
      return noHits(log(state, "Command: no adjacent space to summon."));
    }
    const pos = adj[Math.floor(Math.random() * adj.length)]!;
    const serial = nextMonsterSerial(state.monsters);
    let inst = createMonsterInstance(
      `monster_${serial}`,
      cmd.defId,
      pos.x,
      pos.y,
      state.monsterDefs,
      cmd.level,
    );
    if (cmd.defId === "boneling") {
      const leader = bonelingLeaderForRoom(state.monsters, state.roomIds, pos.x, pos.y);
      inst = withBonelingLeaderFlag(inst, leader);
    }
    const nm = state.monsterDefs.get(cmd.defId)?.name ?? cmd.defId;
    return noHits(
      log(
        { ...state, monsters: [...state.monsters, inst] },
        `Command: summoned ${nm} at level ${inst.level}${inst.aiFlags?.leader ? " (leader)" : ""}.`,
      ),
    );
  }

  if (cmd.type === "DEV_TEST") {
    if (cmd.feature === "boneling") {
      let next = {
        ...state,
        testBonelingSpawns: true,
      };
      next = createNextFloorState(next, {
        depth: state.depth,
        theme: state.floorTheme,
        danger: state.danger,
      });
      next = reshufflePlayerDeck(next);
      const drawN = playerDrawCountPerTurn(next);
      next = ensureEquippedOnTopOfDraw(next);
      next = drawFromPlayerDeck(next, drawN, true);
      next = applyPerTurnSkillResourcesAfterDraw(next);
      next = revealAtPlayer(next);
      next = collectAdjacentLoot(next);
      return noHits(
        log(
          { ...next, phase: "player", pending: null },
          "Test: Boneling packs (3–5) now spawn in rooms. Floor regenerated.",
        ),
      );
    }
    if (cmd.feature === "catacombs") {
      let next = createCatacombsTestState(state);
      next = reshufflePlayerDeck(next);
      const drawN = playerDrawCountPerTurn(next);
      next = ensureEquippedOnTopOfDraw(next);
      next = drawFromPlayerDeck(next, drawN, true);
      next = applyPerTurnSkillResourcesAfterDraw(next);
      next = revealAtPlayer(next);
      next = collectAdjacentLoot(next);
      return noHits(log({ ...next, phase: "player", pending: null }, "Test: Catacombs layout generated."));
    }
    return noHits(log(state, `Command: unknown Test feature "${cmd.feature}".`));
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
    addFootingBlocks(state, occupied);
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
  next = addExp(next, power);
  if (defId === "boneling") {
    const dead = next.monsters.find(
      (m) => m.defId === "boneling" && m.hp <= 0 && m.x === x && m.y === y,
    );
    next = convertBonelingToBonePile(next, x, y, dead?.id);
  }
  return next;
}

/** Mimics spill chest-table loot when slain. */
function applyMimicDeathLoot(state: GameState): GameState {
  let next = log(state, "The Mimic spills its hoard!");
  const loot = rollChestLoot(next.floorTheme === "catacombs" ? { catacombs: true } : undefined);
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
    case "herb":
      return log(
        {
          ...next,
          player: { ...next.player, herb: next.player.herb + 1 },
        },
        "Mimic loot: a healing herb.",
      );
    case "cheese":
      return log(
        {
          ...next,
          player: { ...next.player, cheese: next.player.cheese + 1 },
        },
        "Mimic loot: cheese.",
      );
    case "gem": {
      const gems = {
        ...next.player.gems,
        [loot.gemId]: next.player.gems[loot.gemId] + 1,
      };
      return log(
        { ...next, player: { ...next.player, gems } },
        `Mimic loot: a Gem of ${loot.gemId[0]!.toUpperCase()}${loot.gemId.slice(1)}.`,
      );
    }
    case "trinket":
      return log(
        { ...next, player: withTrinket(next.player, loot.trinket) },
        `Mimic loot: ${trinketLabel(loot.trinket)}.`,
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
  const taken = applyDamageToPlayer(s, dmg, { ignoreDefense: true });
  let next: GameState = {
    ...taken.state,
    player: { ...taken.state.player, fireLevels: lv - 1 },
  };
  next = log(next, `Fire burns you for ${taken.damage}!`);
  if (next.player.hp <= 0) return { ...next, phase: "defeat" };
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
  if (s.rocks.some((r) => r.x === nx && r.y === ny) || blocksFooting(s, nx, ny))
    return log(s, "Rubble blocks the knockback.");
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
      s.rocks.some((r) => r.x === nx && r.y === ny) ||
      blocksFooting(s, nx, ny);
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

function applyFreezeToMonsters(
  monsters: MonsterInstance[],
  monsterIds: readonly string[],
  levels: number,
): MonsterInstance[] {
  const ids = new Set(monsterIds);
  return monsters.map((m) =>
    ids.has(m.id) ? { ...m, freezeLevels: (m.freezeLevels ?? 0) + levels } : m,
  );
}

function ancientKnifeKills(cardId: string): number {
  if (cardId === "ancient_knife") return 0;
  const match = /^ancient_knife#(\d+)$/.exec(cardId);
  return match ? parseInt(match[1]!, 10) : 0;
}

function ancientKnifeDescription(kills: number): string {
  const bonus = kills * 2;
  const min = 1 + bonus;
  const max = 2 + bonus;
  const growth =
    kills <= 0
      ? "If you kill the target, the Knife's power will grow."
      : `It has grown stronger (${kills} kill${kills === 1 ? "" : "s"}, +${bonus} damage).`;
  return `The Knife thirsts for blood… Deal ${min}–${max} damage to an adjacent target and draw a card. ${growth}`;
}

/** Register a grown Ancient Knife definition. The base card stays at 0 kills. */
function withAncientKnifeGrowth(s: GameState, kills: number): { state: GameState; cardId: string } {
  const cardId = kills <= 0 ? "ancient_knife" : `ancient_knife#${kills}`;
  if (kills <= 0 || s.cardDefs.has(cardId)) return { state: s, cardId };
  const base = s.cardDefs.get("ancient_knife");
  if (!base || base.effect.type !== "ancient_knife") return { state: s, cardId };
  const bonus = kills * 2;
  const grown: CardDef = {
    ...base,
    id: cardId,
    description: ancientKnifeDescription(kills),
    effect: {
      type: "ancient_knife",
      minDamage: base.effect.minDamage + bonus,
      maxDamage: base.effect.maxDamage + bonus,
    },
  };
  const cardDefs = new Map(s.cardDefs);
  cardDefs.set(cardId, grown);
  return { state: { ...s, cardDefs }, cardId };
}

function replaceJustPlayedCard(s: GameState, fromId: string, toId: string): GameState {
  if (s.player.equipped === fromId && s.player.drawPile[0] === fromId) {
    const drawPile = [...s.player.drawPile];
    drawPile[0] = toId;
    return { ...s, player: { ...s.player, drawPile, equipped: toId } };
  }
  const discard = s.player.discardPile;
  if (discard.length > 0 && discard[discard.length - 1] === fromId) {
    const discardPile = [...discard];
    discardPile[discardPile.length - 1] = toId;
    return { ...s, player: { ...s.player, discardPile } };
  }
  return s;
}

/** Pull the copy just played back into hand so a kill does not discard it. */
function reclaimJustPlayedCard(s: GameState, cardId: string): GameState {
  if (s.player.equipped === cardId && s.player.drawPile[0] === cardId) {
    return {
      ...s,
      player: {
        ...s.player,
        drawPile: s.player.drawPile.slice(1),
        hand: [...s.player.hand, cardId],
      },
    };
  }
  const discard = s.player.discardPile;
  if (discard.length > 0 && discard[discard.length - 1] === cardId) {
    return {
      ...s,
      player: {
        ...s.player,
        discardPile: discard.slice(0, -1),
        hand: [...s.player.hand, cardId],
      },
    };
  }
  return s;
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
  addFootingBlocks(state, occ);
  unlockLockedDoorsInOccupancy(state, occ);
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
      const _taken_dmg = applyDamageToPlayer(next, envDmg);
      next = _taken_dmg.state;
      const dmg = _taken_dmg.damage;
      const hp = next.player.hp;
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
      bonePiles: next.bonePiles
        .map((bp) =>
          bp.x === pos.x && bp.y === pos.y ? { ...bp, hp: bp.hp - envDmg } : bp,
        )
        .filter((bp) => bp.hp > 0),
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
      if (blocksFooting(state, x, y)) continue;
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
    const taken = applyDamageToPlayer(next, COLLAPSE_CRUSH_DAMAGE);
    next = taken.state;
    const dmg = taken.damage;
    hits.push({ gridX: next.player.x, gridY: next.player.y, damage: dmg });
    const hp = next.player.hp;
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
  if (blocksFooting(s, x, y)) return true;
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

/** Played equipped cards return to the top; all other played cards go to discard. Bound Tome casts are consumed (not discarded). Temporary Magic+ upgrades discard as their base card. */
function playerAfterPlayingCard(
  s: GameState,
  hand: string[],
  cardId: string,
): GameState["player"] {
  if (s.tomeCast) {
    return { ...s.player, hand };
  }
  if (s.player.equipped === cardId) {
    return {
      ...s.player,
      hand,
      drawPile: [cardId, ...s.player.drawPile],
      cardsPlayedThisTurn: s.player.cardsPlayedThisTurn + 1,
    };
  }
  const discardId = baseMagicCardId(cardId);
  return {
    ...s.player,
    hand,
    discardPile: [...s.player.discardPile, discardId],
    cardsPlayedThisTurn: s.player.cardsPlayedThisTurn + 1,
  };
}

function spendBoundTomeCharge(
  player: GameState["player"],
  tomeId: string,
  cardDefs: Map<string, CardDef>,
): { player: GameState["player"]; message: string | null } {
  const tome = player.boundTomes.find((t) => t.id === tomeId);
  if (!tome) return { player, message: null };
  const nm = cardDefs.get(tome.cardId)?.name ?? tome.cardId;
  if (tome.charges <= 1) {
    return {
      player: {
        ...player,
        boundTomes: player.boundTomes.filter((t) => t.id !== tomeId),
      },
      message: `The Bound Tome (${nm}) is consumed.`,
    };
  }
  return {
    player: {
      ...player,
      boundTomes: player.boundTomes.map((t) =>
        t.id === tomeId ? { ...t, charges: t.charges - 1 } : t,
      ),
    },
    message: `Bound Tome (${nm}): ${tome.charges - 1} charge(s) remain.`,
  };
}

/** If a Bound Tome virtual card left the hand without applyCardPlayed, spend the charge. */
function finalizeTomeCast(_before: GameState, after: GameState): GameState {
  if (!after.tomeCast) return after;
  const { handIndex, tomeId } = after.tomeCast;
  const tome = after.player.boundTomes.find((t) => t.id === tomeId);
  if (tome && after.player.hand[handIndex] === tome.cardId) return after;
  const spent = spendBoundTomeCharge(after.player, tomeId, after.cardDefs);
  let next: GameState = { ...after, player: spent.player, tomeCast: null };
  if (spent.message) next = log(next, spent.message);
  return next;
}

/** Apply hand update after a card is played; spends a Bound Tome charge when casting from a tome. */
function applyCardPlayed(s: GameState, hand: string[], cardId: string): GameState {
  const player = playerAfterPlayingCard(s, hand, cardId);
  if (!s.tomeCast) {
    return { ...s, player, tomeCast: null };
  }
  const spent = spendBoundTomeCharge(player, s.tomeCast.tomeId, s.cardDefs);
  let next: GameState = { ...s, player: spent.player, tomeCast: null };
  if (spent.message) next = log(next, spent.message);
  return next;
}

function nextBoundTomeId(s: GameState): string {
  let n = 0;
  for (const t of s.player.boundTomes) {
    const m = /^tome_(\d+)$/.exec(t.id);
    if (m) n = Math.max(n, parseInt(m[1]!, 10) + 1);
  }
  return `tome_${n}`;
}

function removeOneFromDiscard(s: GameState, cardId: string): GameState | null {
  const di = s.player.discardPile.lastIndexOf(cardId);
  if (di < 0) return null;
  const discardPile = [...s.player.discardPile];
  discardPile.splice(di, 1);
  return { ...s, player: { ...s.player, discardPile } };
}

function abortTomeCast(s: GameState): GameState {
  if (!s.tomeCast) return s;
  const hand = [...s.player.hand];
  const idx = s.tomeCast.handIndex;
  if (idx >= 0 && idx < hand.length) hand.splice(idx, 1);
  return {
    ...s,
    player: { ...s.player, hand },
    pending: null,
    tomeCast: null,
  };
}

function withTrinket(player: GameState["player"], id: TrinketId): GameState["player"] {
  if (id === "throwing_knife") return { ...player, throwingKnives: player.throwingKnives + 1 };
  if (id === "healing_pendant") return { ...player, healingPendants: player.healingPendants + 1 };
  return { ...player, shieldingRings: player.shieldingRings + 1 };
}

function grantMagicPotContents(s: GameState, loot: ReturnType<typeof rollMagicPotLoot>): GameState {
  if (loot.kind === "gem") {
    const gems = {
      ...s.player.gems,
      [loot.gemId]: s.player.gems[loot.gemId] + 1,
    };
    const label = loot.gemId[0]!.toUpperCase() + loot.gemId.slice(1);
    return log({ ...s, player: { ...s.player, gems } }, `Inside: a Gem of ${label}!`);
  }
  if (loot.kind === "flame_of_destruction") {
    return log(
      {
        ...s,
        player: {
          ...s.player,
          flameOfDestruction: s.player.flameOfDestruction + 1,
        },
      },
      "Inside: Flame of Destruction!",
    );
  }
  return log(
    {
      ...s,
      player: {
        ...s.player,
        unboundTomes: s.player.unboundTomes + 1,
      },
    },
    "Inside: an Unbound Magic Tome!",
  );
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
  next = openChestAsPlayer(breakPotAsPlayer(next, x, y), x, y);
  if (isLockedDoorAt(next, x, y) && next.player.keys > 0) {
    next = {
      ...next,
      lockedDoors: next.lockedDoors.filter((d) => d.x !== x || d.y !== y),
      player: { ...next.player, keys: next.player.keys - 1 },
    };
    next = log(next, "The key turns. The locked gate swings open.");
  }
  next = collectAdjacentLoot(next);
  if (next.catacombStair && next.catacombStair.x === x && next.catacombStair.y === y) {
    next = log(next, "Stone steps descend into the Gauntlet Chamber. The way down is not open yet.");
  }
  next = maybeCommenceGauntlet(next, x, y);
  return next;
}

function applyHarmingCloudEnter(s: GameState, x: number, y: number): GameState {
  const cloud = s.harmingClouds.find((c) => c.x === x && c.y === y && c.turnsLeft > 0);
  if (!cloud) return s;
  const taken = applyDamageToPlayer(s, 5);
  let next = taken.state;
  const dmg = taken.damage;
  next = log(next, `The harming cloud burns you for ${dmg}!`);
  if (next.player.hp <= 0) return { ...next, phase: "defeat" };
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
  let cheese = s.player.cheese;
  let throwingKnives = s.player.throwingKnives;
  let healingPendants = s.player.healingPendants;
  let shieldingRings = s.player.shieldingRings;
  let keys = s.player.keys;
  let flameOfDestruction = s.player.flameOfDestruction;
  let unboundTomes = s.player.unboundTomes;
  const gems = { ...s.player.gems };
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
      case "cheese":
        cheese += 1;
        lines.push(`${d0}cheese.`);
        break;
      case "gem": {
        const gid = loot.gemId ?? "strength";
        gems[gid] = (gems[gid] ?? 0) + 1;
        lines.push(`${d0}a gem (${gid}).`);
        break;
      }
      case "flame_of_destruction":
        flameOfDestruction += 1;
        lines.push(`${d0}Flame of Destruction.`);
        break;
      case "magic_tome":
        unboundTomes += 1;
        lines.push(`${d0}an Unbound Magic Tome.`);
        break;
      case "throwing_knife":
        throwingKnives += 1;
        lines.push(`${d0}a throwing knife.`);
        break;
      case "healing_pendant":
        healingPendants += 1;
        lines.push(`${d0}a healing pendant.`);
        break;
      case "shielding_ring":
        shieldingRings += 1;
        lines.push(`${d0}a shielding ring.`);
        break;
      case "key":
        keys += 1;
        lines.push(`${d0}a key.`);
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
    player: {
      ...next.player,
      gold,
      bread,
      herb,
      cheese,
      throwingKnives,
      healingPendants,
      shieldingRings,
      keys,
      flameOfDestruction,
      unboundTomes,
      gems,
    },
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
  let serial = nextGroundLootSerial(next);
  if (pot.magic) {
    next = log(next, "The magic pot shatters!");
    const loot = rollMagicPotLoot();
    if (loot.kind === "gem") {
      const g: GroundLootInstance = {
        id: `gloot_${serial}`,
        x: px,
        y: py,
        kind: "gem",
        gemId: loot.gemId,
      };
      return collectAdjacentLoot(
        log({ ...next, groundLoot: [...next.groundLoot, g] }, "A gem spills out in a flash of light."),
      );
    }
    if (loot.kind === "flame_of_destruction") {
      const g: GroundLootInstance = {
        id: `gloot_${serial}`,
        x: px,
        y: py,
        kind: "flame_of_destruction",
      };
      return collectAdjacentLoot(
        log({ ...next, groundLoot: [...next.groundLoot, g] }, "Flame of Destruction tumbles out!"),
      );
    }
    const g: GroundLootInstance = {
      id: `gloot_${serial}`,
      x: px,
      y: py,
      kind: "magic_tome",
    };
    return collectAdjacentLoot(
      log({ ...next, groundLoot: [...next.groundLoot, g] }, "An Unbound Magic Tome tumbles out!"),
    );
  }
  if (pot.golden) {
    next = log(next, "The golden pot shatters!");
    const golden = rollGoldenPotLoot(next.cardDefs, next.depth);
    const g: GroundLootInstance =
      golden.kind === "coin"
        ? { id: `gloot_${serial}`, x: px, y: py, kind: "coin", amount: golden.amount }
        : golden.kind === "gem"
          ? { id: `gloot_${serial}`, x: px, y: py, kind: "gem", gemId: golden.gemId }
          : golden.kind === "trinket"
            ? { id: `gloot_${serial}`, x: px, y: py, kind: golden.trinket }
            : { id: `gloot_${serial}`, x: px, y: py, kind: "card", cardId: golden.cardId };
    const line =
      golden.kind === "coin"
        ? `${golden.amount} gold spills from the golden pot.`
        : golden.kind === "gem"
          ? "A gem spills from the golden pot."
          : golden.kind === "trinket"
            ? `${trinketLabel(golden.trinket)} spills from the golden pot.`
            : "A card flutters out of the golden pot.";
    return collectAdjacentLoot(log({ ...next, groundLoot: [...next.groundLoot, g] }, line));
  }
  const loot =
    next.floorTheme === "catacombs"
      ? rollCatacombsPotLoot(next.cardDefs, next.depth)
      : rollPotLoot(next.cardDefs, next.depth, potLootHitChance(next));
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
    case "herb": {
      const g: GroundLootInstance = { id: `gloot_${serial}`, x: px, y: py, kind: "herb" };
      return collectAdjacentLoot(
        log({ ...next, groundLoot: [...next.groundLoot, g] }, "A healing herb tumbles out."),
      );
    }
    case "cheese": {
      const g: GroundLootInstance = { id: `gloot_${serial}`, x: px, y: py, kind: "cheese" };
      return collectAdjacentLoot(
        log({ ...next, groundLoot: [...next.groundLoot, g] }, "Cheese tumbles out."),
      );
    }
    case "gem": {
      const g: GroundLootInstance = {
        id: `gloot_${serial}`,
        x: px,
        y: py,
        kind: "gem",
        gemId: loot.gemId,
      };
      return collectAdjacentLoot(
        log({ ...next, groundLoot: [...next.groundLoot, g] }, "A gem tumbles out."),
      );
    }
    case "trinket": {
      const g: GroundLootInstance = {
        id: `gloot_${serial}`,
        x: px,
        y: py,
        kind: loot.trinket,
      };
      return collectAdjacentLoot(
        log(
          { ...next, groundLoot: [...next.groundLoot, g] },
          `${trinketLabel(loot.trinket)} tumbles out.`,
        ),
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
  if (pot.magic) {
    next = log(next, "You smash a magic pot!");
    return grantMagicPotContents(next, rollMagicPotLoot());
  }
  if (pot.golden) {
    next = log(next, "You smash a golden pot!");
    const golden = rollGoldenPotLoot(next.cardDefs, next.depth);
    if (golden.kind === "coin") {
      return log(
        { ...next, player: { ...next.player, gold: next.player.gold + golden.amount } },
        `Inside: +${golden.amount} gold.`,
      );
    }
    if (golden.kind === "gem") {
      const gems = { ...next.player.gems, [golden.gemId]: next.player.gems[golden.gemId] + 1 };
      return log({ ...next, player: { ...next.player, gems } }, "Inside: a gem!");
    }
    if (golden.kind === "trinket") {
      return log(
        { ...next, player: withTrinket(next.player, golden.trinket) },
        `Inside: ${trinketLabel(golden.trinket)}.`,
      );
    }
    const nm = next.cardDefs.get(golden.cardId)?.name ?? golden.cardId;
    return log(enqueueCardPickup(next, golden.cardId), `Inside: a card — ${nm}! Add it to your deck?`);
  }
  const loot =
    s.floorTheme === "catacombs"
      ? rollCatacombsPotLoot(s.cardDefs, s.depth)
      : rollPotLoot(s.cardDefs, s.depth, potLootHitChance(next));
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
    case "herb":
      return log(
        { ...next, player: { ...next.player, herb: next.player.herb + 1 } },
        "Inside: a healing herb!",
      );
    case "cheese":
      return log(
        { ...next, player: { ...next.player, cheese: next.player.cheese + 1 } },
        "Inside: cheese!",
      );
    case "gem": {
      const gems = { ...next.player.gems, [loot.gemId]: next.player.gems[loot.gemId] + 1 };
      return log({ ...next, player: { ...next.player, gems } }, "Inside: a gem!");
    }
    case "trinket":
      return log(
        { ...next, player: withTrinket(next.player, loot.trinket) },
        `Inside: ${trinketLabel(loot.trinket)}.`,
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
  const loot = rollChestLoot(
    next.floorTheme === "catacombs"
      ? { catacombs: true, rich: roomKindAt(next, x, y) === "treasure" }
      : undefined,
  );
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
    case "herb":
      return log(
        {
          ...next,
          player: { ...next.player, herb: next.player.herb + 1 },
        },
        "Inside: a healing herb.",
      );
    case "cheese":
      return log(
        {
          ...next,
          player: { ...next.player, cheese: next.player.cheese + 1 },
        },
        "Inside: cheese.",
      );
    case "gem": {
      const gems = {
        ...next.player.gems,
        [loot.gemId]: next.player.gems[loot.gemId] + 1,
      };
      return log(
        { ...next, player: { ...next.player, gems } },
        `Inside: a Gem of ${loot.gemId[0]!.toUpperCase()}${loot.gemId.slice(1)}.`,
      );
    }
    case "trinket":
      return log(
        { ...next, player: withTrinket(next.player, loot.trinket) },
        `Inside: ${trinketLabel(loot.trinket)}.`,
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
    let drawnId = drawn;
    if (s.player.arcaneChargeActive) {
      const d = s.cardDefs.get(drawn);
      if (d?.types.includes("Magic")) {
        drawnId = upgradedMagicCardId(drawn) ?? drawn;
      }
    }
    hand = [...hand, drawnId];
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
      defenseBonusThisTurn: 0,
      defenseUntilHit: 0,
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
  next = {
    ...next,
    player: { ...next.player, gold: next.player.gold + 3 },
  };
  next = log(
    next,
    "The gauntlet falls silent. You claim 3 gold. A stair chamber opens — peace. Your deck is reshuffled.",
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
    toDiscard.push(baseMagicCardId(id));
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
      /** Charge ends with the turn — must clear before the next hand is drawn. */
      arcaneChargeActive: false,
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

  let working: GameState = { ...base, stabilityBuffActive: false };

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
      const taken = applyDamageToPlayer(working, rawTrap);
      working = taken.state;
      const dmg = taken.damage;
      summary = dmg === 0 ? "No damage." : `You take ${dmg} damage.`;
      const hits: HitVisual[] = [];
      if (dmg > 0) {
        hits.push({ gridX: working.player.x, gridY: working.player.y, damage: dmg });
      }
      const hp = working.player.hp;
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
  const damageLastTurn = next.player.damageTakenThisTurn;
  let resistance = hasSkill(next, SID.DEF_KEEP_UP_YOUR_GUARD) ? next.player.resistance : 0;
  if (hasSkill(next, SID.DEF_KEEP_UP_YOUR_GUARD) && resistance < next.player.level) {
    resistance += 1;
  }
  if (hasSkill(next, SID.VIT_KEEP_FIGHTING) && damageLastTurn > 5) {
    resistance += 5;
    next = log(next, "Keep Fighting — you brace yourself (+5 Resistance).");
  }
  let moveTokens = moveTokensGrantedPerTurn(next);
  if (hasSkill(next, SID.MOB_ALWAYS_MOVING)) {
    const hasMove = next.player.hand.some((id) =>
      next.cardDefs.get(id)?.types.includes("Move"),
    );
    if (!hasMove) moveTokens += 1;
  }
  return {
    ...next,
    player: {
      ...next.player,
      // Guard Destroyer stacks/target intentionally persist across turns.
      defenseBonusThisTurn: 0,
      doublePunchThisTurn: false,
      fortifyThisTurn: false,
      cardsPlayedThisTurn: 0,
      noMoreCardsThisTurn: false,
      damageTakenThisTurn: 0,
      knockbackedMonsterIdsThisTurn: [],
      moveTokens,
      knockbackTokens: knockbackTokensGrantedPerTurn(next),
      knockbackPrimed: 0,
      movementCardsPlayedThisTurn: 0,
      scoutUsesThisTurn: 0,
      hasteThisTurn: false,
      arcaneChargeActive: false,
      resistance,
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
  // Arcane Charge must not still be active when the new hand is drawn.
  if (next.player.arcaneChargeActive) {
    next = { ...next, player: { ...next.player, arcaneChargeActive: false } };
  }
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
    s.tangleweeds.some((tw) => tw.hp > 0 && tw.x === x && tw.y === y) ||
    s.bonePiles.some((bp) => bp.hp > 0 && bp.x === x && bp.y === y) ||
    s.graveBonePiles.some((g) => g.hp > 0 && g.x === x && g.y === y)
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
  for (const bp of s.bonePiles) if (bp.hp > 0) add(bp);
  for (const g of s.graveBonePiles) if (g.hp > 0) add(g);
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
  // Snapshot before kills so a Boneling death pile is not hit by this same attack.
  const bonePileIds = s.bonePiles
    .filter((bp) => bp.hp > 0 && bp.x === target.x && bp.y === target.y)
    .map((bp) => bp.id);
  const gravePileIds = s.graveBonePiles
    .filter((g) => g.hp > 0 && g.x === target.x && g.y === target.y)
    .map((g) => g.id);

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

  for (const id of bonePileIds) {
    const bp = s.bonePiles.find((x) => x.id === id && x.hp > 0);
    if (!bp) continue;
    targetCount++;
    const hp = Math.max(0, bp.hp - rawDamage);
    s = {
      ...s,
      bonePiles: s.bonePiles.map((x) => (x.id === id ? { ...x, hp } : x)),
    };
    hits.push(hitAt(s, target.x, target.y, rawDamage, fxKind));
    if (hp <= 0) {
      s = {
        ...s,
        bonePiles: s.bonePiles.filter((x) => x.id !== id),
        log: [...s.log.slice(-50), "The bone pile is scattered."],
      };
    }
  }

  for (const id of gravePileIds) {
    const pile = s.graveBonePiles.find((g) => g.id === id && g.hp > 0);
    if (!pile) continue;
    targetCount++;
    const hp = Math.max(0, pile.hp - rawDamage);
    s = {
      ...s,
      graveBonePiles:
        hp <= 0
          ? s.graveBonePiles.filter((g) => g.id !== id)
          : s.graveBonePiles.map((g) => (g.id === id ? { ...g, hp } : g)),
    };
    hits.push(hitAt(s, target.x, target.y, rawDamage, fxKind));
    if (hp <= 0) s = log(s, "The pile of bones collapses.");
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
  const knocked: string[] = [];
  for (const id of monsterIds) {
    const before = s.monsters.find((m) => m.id === id);
    s = tryKnockMonsterFromPlayerN(s, id, distance, moveAnims);
    const after = s.monsters.find((m) => m.id === id);
    if (before && after && (before.x !== after.x || before.y !== after.y)) {
      knocked.push(id);
    }
  }
  if (knocked.length === 0) return s;
  const merged = new Set([...s.player.knockbackedMonsterIdsThisTurn, ...knocked]);
  return {
    ...s,
    player: { ...s.player, knockbackedMonsterIdsThisTurn: [...merged] },
  };
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
      ...applyCardPlayed(state, hand, cardId),
      pending: null,
    },
  };
}

function isPhysicalMeleeAttack(def: CardDef | undefined): boolean {
  return !!def?.types.includes("Attack") &&
    !!def.tags?.includes("physical attack") &&
    !!def.tags?.includes("melee");
}

function resolveSpearLine(state: GameState, target: Point): DispatchResult {
  const pending = state.pending;
  if (!pending || pending.kind !== "play_spear") return noHits(state);
  const player = { x: state.player.x, y: state.player.y };
  const line = spearStrikeCells(state, player, target);
  if (line.length === 0) return noHits(state);
  if (state.fogOfWar && !state.discovered.has(keyOf(target))) return noHits(state);
  const consumed = consumePlayedCard(state, pending.cardHandIndex);
  if (!consumed) return noHits(state);
  const raw = weaponAttackRollRaw(
    consumed.state,
    consumed.cardId,
    pending.minDamage,
    pending.maxDamage,
  );
  let s = consumed.state;
  const hits: HitVisual[] = [];
  const survivors: string[] = [];
  for (const cell of line) {
    if (!hasAttackTargetAt(s, cell.x, cell.y)) continue;
    const result = damageAttackTargetsAt(s, cell, raw, "melee_slash");
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

function strikeLine(
  state: GameState,
  cells: Point[],
  raw: number,
): { state: GameState; hits: HitVisual[]; survivors: string[] } {
  let s = state;
  const hits: HitVisual[] = [];
  const survivors: string[] = [];
  for (const cell of cells) {
    if (!hasAttackTargetAt(s, cell.x, cell.y)) continue;
    const result = damageAttackTargetsAt(s, cell, raw, "melee_slash");
    s = result.state;
    hits.push(...result.hits);
    survivors.push(...result.survivorMonsterIds);
  }
  return { state: s, hits, survivors };
}

function resolveBroadsword(state: GameState, target: Point): DispatchResult {
  const pending = state.pending;
  if (!pending || pending.kind !== "play_broadsword") return noHits(state);
  const player = { x: state.player.x, y: state.player.y };
  const cells = broadswordCleaveCells(state, player, target);
  if (cells.length === 0) return noHits(state);
  if (state.fogOfWar && !state.discovered.has(keyOf(target))) return noHits(state);
  const consumed = consumePlayedCard(state, pending.cardHandIndex);
  if (!consumed) return noHits(state);
  const raw = weaponAttackRollRaw(
    consumed.state,
    consumed.cardId,
    pending.minDamage,
    pending.maxDamage,
  );
  const struck = strikeLine(consumed.state, cells, raw);
  const knockback = state.player.knockbackPrimed;
  let afterHit: GameState = {
    ...struck.state,
    player: { ...struck.state.player, knockbackPrimed: 0 },
  };
  afterHit = consumeStrengthGemIfPhysical(afterHit, consumed.cardId);
  afterHit = log(afterHit, "Broadsword cleaves a wide arc!");
  return withHitsThenKnockback(afterHit, struck.hits, struck.survivors, knockback);
}

function resolveIcicleLance(state: GameState, target: Point): DispatchResult {
  const pending = state.pending;
  if (!pending || pending.kind !== "play_icicle_lance") return noHits(state);
  const player = { x: state.player.x, y: state.player.y };
  const cells = icicleLanceCells(state, player, target);
  if (cells.length === 0) return noHits(state);
  if (state.fogOfWar && !state.discovered.has(keyOf(target))) return noHits(state);
  const consumed = consumePlayedCard(state, pending.cardHandIndex);
  if (!consumed) return noHits(state);
  const raw = weaponAttackRollRaw(
    consumed.state,
    consumed.cardId,
    pending.minDamage,
    pending.maxDamage,
  );
  const struck = strikeLine(consumed.state, cells, raw);
  let afterHit: GameState = {
    ...struck.state,
    player: { ...struck.state.player, knockbackPrimed: 0 },
  };
  if (struck.survivors.length > 0) {
    afterHit = {
      ...afterHit,
      monsters: applyFreezeToMonsters(afterHit.monsters, struck.survivors, 1),
    };
    afterHit = log(afterHit, "Icicle Lance inflicts 1 Freezing.");
  }
  afterHit = consumeStrengthGemIfPhysical(afterHit, consumed.cardId);
  afterHit = log(afterHit, "The icicle lance pierces the line!");
  const knockback = state.player.knockbackPrimed;
  return withHitsThenKnockback(afterHit, struck.hits, struck.survivors, knockback);
}

function resolvePlayerAttackAtTile(state: GameState, target: Point): DispatchResult {
  const pending = state.pending;
  if (!pending) return noHits(state);
  if (pending.kind === "play_spear") return resolveSpearLine(state, target);
  if (pending.kind === "play_broadsword") return resolveBroadsword(state, target);
  if (pending.kind === "play_icicle_lance") return resolveIcicleLance(state, target);
  if (!hasAttackTargetAt(state, target.x, target.y)) return noHits(state);
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
    const targetMonBefore = state.monsters.find(
      (m) => m.hp > 0 && m.x === target.x && m.y === target.y,
    );
    const strikes = punchStrikeCount(state);
    let s: GameState = { ...state, pending: null };
    const hits: HitVisual[] = [];
    let survivors: string[] = [];
    let lastMonsterDamage = new Map<string, number>();
    for (let i = 0; i < strikes; i++) {
      if (!hasAttackTargetAt(s, target.x, target.y)) break;
      let raw = rollInt(1, 2) + attackStrengthBonus(s) + heavyPunchBonus(s);
      const monNow = s.monsters.find((m) => m.hp > 0 && m.x === target.x && m.y === target.y);
      raw += guardDestroyerBonus(s, monNow?.id ?? null);
      if (s.player.nextPhysicalAttackMultiplier !== 1) {
        raw = Math.floor(raw * s.player.nextPhysicalAttackMultiplier);
      }
      const result = damageAttackTargetsAt(s, target, raw, "melee_slash");
      s = result.state;
      hits.push(...result.hits);
      survivors = result.survivorMonsterIds;
      lastMonsterDamage = result.monsterDamage;
    }
    const didHitTrackedEnemy =
      !!targetMonBefore && lastMonsterDamage.has(targetMonBefore.id);
    s = applyGuardDestroyerAfterAttack(
      s,
      didHitTrackedEnemy ? targetMonBefore!.id : null,
      true,
    );
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
    pending.kind === "play_executioner_axe" ||
    pending.kind === "play_ancient_knife" ||
    pending.kind === "play_knockback_punch" ||
    pending.kind === "play_mace_smash" ||
    pending.kind === "play_poisoned_blade" ||
    pending.kind === "play_perfected_strike" ||
    pending.kind === "play_reckless_assault" ||
    pending.kind === "play_thieving_strike"
  ) {
    if (manhattan(player, target) > 1) return noHits(state);
    const targetMonBefore = state.monsters.find(
      (m) => m.hp > 0 && m.x === target.x && m.y === target.y,
    );
    const consumed = consumePlayedCard(state, pending.cardHandIndex);
    if (!consumed) return noHits(state);
    const def = state.cardDefs.get(consumed.cardId);
    const strikes =
      pending.kind === "play_knockback_punch" ? punchStrikeCount(state, def) : 1;
    let s = consumed.state;
    if (pending.kind === "play_reckless_assault" && pending.hpLost > 0) {
      const hp = Math.max(0, s.player.hp - pending.hpLost);
      s = {
        ...s,
        player: {
          ...s.player,
          hp,
          damageTakenThisTurn: s.player.damageTakenThisTurn + pending.hpLost,
        },
      };
      s = log(s, `Reckless Assault — you lose ${pending.hpLost} HP.`);
      if (hp <= 0) {
        return noHits({ ...s, phase: "defeat" });
      }
    }
    const hits: HitVisual[] = [];
    let survivors: string[] = [];
    let lastMonsterDamage = new Map<string, number>();
    for (let i = 0; i < strikes; i++) {
      if (!hasAttackTargetAt(s, target.x, target.y)) break;
      let minD: number;
      let maxD: number;
      if (pending.kind === "play_perfected_strike") {
        minD = pending.damage;
        maxD = pending.damage;
      } else {
        minD = pending.minDamage;
        maxD = pending.maxDamage;
      }
      if (pending.kind === "play_reckless_assault") {
        minD += pending.hpLost * 2;
        maxD += pending.hpLost * 2;
      }
      let raw = weaponAttackRollRaw(s, consumed.cardId, minD, maxD);
      const monNow = s.monsters.find((m) => m.hp > 0 && m.x === target.x && m.y === target.y);
      raw += guardDestroyerBonus(s, monNow?.id ?? null);
      const pierce = pending.kind === "play_mace_smash" ? pending.defensePierce : 0;
      const result = damageAttackTargetsAt(s, target, raw, "melee_slash", false, pierce);
      s = result.state;
      hits.push(...result.hits);
      survivors = result.survivorMonsterIds;
      lastMonsterDamage = result.monsterDamage;
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
    const didHitTrackedEnemy =
      !!targetMonBefore && lastMonsterDamage.has(targetMonBefore.id);
    s = applyGuardDestroyerAfterAttack(
      s,
      didHitTrackedEnemy ? targetMonBefore!.id : null,
      true,
    );

    if (pending.kind === "play_thieving_strike" && targetMonBefore && didHitTrackedEnemy) {
      let goldGain = 0;
      const killed = !s.monsters.some((m) => m.id === targetMonBefore.id && m.hp > 0);
      if (killed || rollInt(1, 100) <= 25) goldGain += 1;
      if (state.player.knockbackedMonsterIdsThisTurn.includes(targetMonBefore.id)) {
        goldGain += 1;
      }
      if (goldGain > 0) {
        s = {
          ...s,
          player: { ...s.player, gold: s.player.gold + goldGain },
        };
        s = log(s, `Thieving Strike — +${goldGain} gold.`);
      }
    }

    const builtIn = pending.kind === "play_knockback_punch" ? pending.knockback : 0;
    const knockback = builtIn + state.player.knockbackPrimed;
    let afterHit: GameState = { ...s, player: { ...s.player, knockbackPrimed: 0 } };
    if (pending.kind === "play_knife" || pending.kind === "play_ancient_knife") {
      const killed =
        pending.kind === "play_ancient_knife" &&
        !!targetMonBefore &&
        !afterHit.monsters.some((m) => m.id === targetMonBefore.id && m.hp > 0);
      if (killed) {
        const nextKills = ancientKnifeKills(consumed.cardId) + 1;
        const grown = withAncientKnifeGrowth(afterHit, nextKills);
        afterHit = replaceJustPlayedCard(grown.state, consumed.cardId, grown.cardId);
        afterHit = log(afterHit, "The Ancient Knife drinks deep. Its power grows.");
      }
      afterHit = drawFromPlayerDeck(afterHit, 1);
      afterHit = log(
        afterHit,
        pending.kind === "play_ancient_knife" ? "Ancient Knife — draw a card." : "Knife — draw a card.",
      );
    }
    if (pending.kind === "play_executioner_axe") {
      const killed =
        !!targetMonBefore &&
        !afterHit.monsters.some((m) => m.id === targetMonBefore.id && m.hp > 0);
      if (killed) {
        afterHit = reclaimJustPlayedCard(afterHit, consumed.cardId);
        afterHit = {
          ...afterHit,
          player: { ...afterHit.player, moveTokens: afterHit.player.moveTokens + 1 },
        };
        afterHit = log(
          afterHit,
          "Executioner's Axe — the target falls. The axe stays in your hand, and you gain a movement token.",
        );
      } else {
        afterHit = {
          ...afterHit,
          player: {
            ...afterHit.player,
            drawPile: ["weariness", "weariness", ...afterHit.player.drawPile],
          },
        };
        afterHit = log(
          afterHit,
          "Executioner's Axe adds two Weariness cards to the top of your deck.",
        );
      }
    }
    if (pending.kind === "play_axe" || pending.kind === "play_mace_smash") {
      const wearinessCount = pending.kind === "play_mace_smash" ? 2 : 1;
      const weariness = Array.from({ length: wearinessCount }, () => "weariness");
      afterHit = {
        ...afterHit,
        player: { ...afterHit.player, drawPile: [...weariness, ...afterHit.player.drawPile] },
      };
      const cardName = pending.kind === "play_axe" ? "Axe" : "Mace Smash";
      afterHit = log(
        afterHit,
        wearinessCount === 1
          ? `${cardName} adds Weariness to the top of your deck.`
          : `${cardName} adds two Weariness cards to the top of your deck.`,
      );
    }
    afterHit = consumeStrengthGemIfPhysical(afterHit, consumed.cardId);
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

  if (pending.kind === "throw_knife") {
    if (state.player.throwingKnives <= 0) return noHits(log(state, "You have no throwing knife."));
    const dist = chebyshev(player, target);
    if (dist < 2 || dist > 5) return noHits(log(state, "The knife only reaches 2 to 5 spaces away."));
    if (!lineOfSightClear(state.tiles, player, target)) return noHits(log(state, "No line of sight."));
    if (!hasAttackTargetAt(state, target.x, target.y)) return noHits(log(state, "Nothing there to hit."));
    const raw = rollInt(1, 4);
    const thrown: GameState = {
      ...state,
      pending: null,
      player: { ...state.player, throwingKnives: state.player.throwingKnives - 1 },
    };
    const result = damageAttackTargetsAt(thrown, target, raw, "throwing_knife");
    const knife: GroundLootInstance = {
      id: `gloot_${nextGroundLootSerial(result.state)}`,
      x: target.x,
      y: target.y,
      kind: "throwing_knife",
    };
    let s: GameState = {
      ...result.state,
      groundLoot: [...result.state.groundLoot, knife],
    };
    s = collectAdjacentLoot(s);
    return withHits(log(s, `Throwing Knife — ${raw} damage. It sticks in the ground.`), result.hits);
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
    cmd.type === "DEV_SKILL" ||
    cmd.type === "DEV_ITEM" ||
    cmd.type === "DEV_DECK" ||
    cmd.type === "DEV_DUNGEON_TOP" ||
    cmd.type === "DEV_GOTO_FLOOR" ||
    cmd.type === "DEV_SET_THEME" ||
    cmd.type === "DEV_SUMMON" ||
    cmd.type === "DEV_TEST" ||
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
  if (state.flameDestroyPending && cmd.type !== "RESOLVE_FLAME_DESTROY") return noHits(state);
  if (state.bindTomePending && cmd.type !== "RESOLVE_BIND_TOME") return noHits(state);
  if (
    state.senseiOffer &&
    cmd.type !== "TOGGLE_SENSEI_OFFER_SELECT" &&
    cmd.type !== "CONFIRM_SENSEI_OFFER" &&
    cmd.type !== "SET_RECKLESS_ASSAULT_HP" &&
    cmd.type !== "RESOLVE_STAY_ON_THE_MOVE" &&
    cmd.type !== "CANCEL_PENDING"
  ) {
    return noHits(log(state, "Finish the current card choice first."));
  }
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
      if (merchantUiBlocks(state)) {
        return noHits(log(state, `Finish talking with ${merchantDisplayName(state)} first.`));
      }
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
      if (state.senseiOffer) {
        return noHits(
          log({ ...state, senseiOffer: null, pending: null }, "Card choice cancelled."),
        );
      }
      if (
        state.dualWieldStage?.step === "choose_hand_attack" ||
        state.dualWieldStage?.step === "choose_discard_attack"
      ) {
        return noHits(
          log({ ...state, dualWieldStage: null, pending: null }, "Dual Wield cancelled."),
        );
      }
      if (!state.pending) {
        if (state.tomeCast) {
          return noHits(log(abortTomeCast(state), "Bound Tome casting cancelled."));
        }
        return noHits(state);
      }
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
              { ...applyCardPlayed(state, hand, cardId), pending: null },
              "Lightning chain cancelled.",
            ),
          );
        }
      }
      if (state.tomeCast) {
        return noHits(log(abortTomeCast(state), "Bound Tome casting cancelled."));
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
      if (state.senseiOffer) {
        return noHits(log(state, "Finish the current card choice first."));
      }
      if (state.player.noMoreCardsThisTurn) {
        return noHits(log(state, "Heal prevents playing further cards this turn."));
      }
      if (state.tomeCast && cmd.handIndex !== state.tomeCast.handIndex) {
        return noHits(log(state, "Finish or cancel the Bound Tome cast first."));
      }
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
            { ...applyCardPlayed(state, hand, cardId), dualWieldStage: { step: "choose_hand_attack" },
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

      if (state.player.arcaneChargeActive && !def.types.includes("Magic")) {
        return noHits(
          log(state, "Arcane Charge is active — only Magic cards can be played this turn."),
        );
      }

      if (def.effect.type === "arcane_charge") {
        const hand = [...state.player.hand];
        hand.splice(idx, 1);
        let s = applyCardPlayed(state, hand, cardId);
        const upgradedHand = s.player.hand.map((id) => {
          const d = s.cardDefs.get(id);
          if (!d?.types.includes("Magic")) return id;
          return upgradedMagicCardId(id) ?? id;
        });
        s = {
          ...s,
          player: {
            ...s.player,
            hand: upgradedHand,
            arcaneChargeActive: true,
          },
        };
        if (def.effect.draw > 0) {
          s = drawFromPlayerDeck(s, def.effect.draw);
        }
        const drawMsg =
          def.effect.draw > 0 ? ` Draw ${def.effect.draw}.` : "";
        return noHits(
          log(
            s,
            `Arcane Charge! Only Magic cards this turn; Magic in hand is upgraded.${drawMsg}`,
          ),
        );
      }

      if (def.effect.type === "arcane_shield") {
        const hand = [...state.player.hand];
        hand.splice(idx, 1);
        let s = applyCardPlayed(state, hand, cardId);
        const resistance = s.player.resistance + def.effect.resistance;
        s = {
          ...s,
          player: { ...s.player, resistance },
        };
        return noHits(
          log(s, `Arcane Shield — gain ${def.effect.resistance} Resistance (${resistance} total).`),
        );
      }

      if (def.effect.type === "fortify") {
        const hand = [...state.player.hand];
        hand.splice(idx, 1);
        let s = applyCardPlayed(state, hand, cardId);
        s = {
          ...s,
          player: { ...s.player, fortifyThisTurn: true },
        };
        return noHits(log(s, "Fortify — your defense and resistance are doubled this turn."));
      }

      if (def.effect.type === "heal") {
        if (state.player.cardsPlayedThisTurn > 0) {
          return noHits(log(state, "Heal can only be played as your first card this turn."));
        }
        const hand = [...state.player.hand];
        hand.splice(idx, 1);
        let s = applyCardPlayed(state, hand, cardId);
        const healAmt = Math.max(1, Math.floor(s.player.maxHp * 0.1));
        const hp = Math.min(s.player.maxHp, s.player.hp + healAmt);
        s = {
          ...s,
          player: { ...s.player, hp, noMoreCardsThisTurn: true },
        };
        return noHits(log(s, `Heal — restore ${healAmt} HP. You may not play more cards this turn.`));
      }

      if (def.effect.type === "evaluate") {
        const hand = [...state.player.hand];
        hand.splice(idx, 1);
        let s = applyCardPlayed(state, hand, cardId);
        s = drawFromPlayerDeck(s, 1);
        return noHits(
          log(
            { ...s, senseiOffer: { kind: "evaluate_discard", selected: [] } },
            "Evaluate — draw 1. Discard any number of cards, then draw that many.",
          ),
        );
      }

      if (def.effect.type === "perfected_strike") {
        return noHits({
          ...state,
          senseiOffer: { kind: "perfected_strike_discard", cardHandIndex: idx, selected: [] },
        });
      }

      if (def.effect.type === "stay_on_the_move") {
        const hand = [...state.player.hand];
        hand.splice(idx, 1);
        const s = applyCardPlayed(state, hand, cardId);
        const moves = s.player.discardPile.filter((id) =>
          s.cardDefs.get(id)?.types.includes("Move"),
        );
        if (moves.length === 0) {
          return noHits(log(s, "Stay on the Move — no Move cards in your discard pile."));
        }
        return noHits(
          log(
            { ...s, senseiOffer: { kind: "stay_on_the_move" } },
            "Stay on the Move — choose a Move card from your discard to play.",
          ),
        );
      }

      if (def.effect.type === "reckless_assault") {
        return noHits({
          ...state,
          senseiOffer: { kind: "reckless_assault_hp", cardHandIndex: idx, hpLost: 0 },
        });
      }

      if (def.effect.type === "thieving_strike") {
        return noHits({
          ...state,
          pending: {
            kind: "play_thieving_strike",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
          },
        });
      }

      if (def.effect.type === "shining_blade") {
        const hand = [...state.player.hand];
        hand.splice(idx, 1);
        let s = applyCardPlayed(state, hand, cardId);
        const dirs = def.effect.diagonals
          ? [
              { x: 1, y: 0 },
              { x: -1, y: 0 },
              { x: 0, y: 1 },
              { x: 0, y: -1 },
              { x: 1, y: 1 },
              { x: 1, y: -1 },
              { x: -1, y: 1 },
              { x: -1, y: -1 },
            ]
          : [
              { x: 1, y: 0 },
              { x: -1, y: 0 },
              { x: 0, y: 1 },
              { x: 0, y: -1 },
            ];
        const raw = magicAttackRollRaw(s, cardId, def.effect.minDamage, def.effect.maxDamage);
        const hits: HitVisual[] = [
          {
            gridX: s.player.x,
            gridY: s.player.y,
            damage: 0,
            showDamage: false,
            fx: playerAttackFx(s, "shining_blade"),
          },
        ];
        for (const d of dirs) {
          const t = { x: s.player.x + d.x, y: s.player.y + d.y };
          if (!inBounds(t, s.width, s.height)) continue;
          const result = damageAttackTargetsAt(s, t, raw, "magic_missile");
          s = result.state;
          for (const h of result.hits) hits.push({ ...h, fx: undefined });
        }
        return withHits(
          log(
            s,
            def.effect.diagonals
              ? `Shining Blade+ flashes in all directions (${raw} damage)!`
              : `Shining Blade flashes outward (${raw} damage)!`,
          ),
          hits,
        );
      }

      if (def.effect.type === "tactical_approach") {
        let s = state;
        const hand = [...s.player.hand];
        hand.splice(idx, 1);
        s = applyCardPlayed(s, hand, cardId);
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
        s = applyCardPlayed(s, hand, cardId);
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

      if (def.effect.type === "broadsword") {
        return noHits({
          ...state,
          pending: {
            kind: "play_broadsword",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
          },
        });
      }

      if (def.effect.type === "executioner_axe") {
        return noHits({
          ...state,
          pending: {
            kind: "play_executioner_axe",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
          },
        });
      }

      if (def.effect.type === "ancient_knife") {
        return noHits({
          ...state,
          pending: {
            kind: "play_ancient_knife",
            cardHandIndex: idx,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
          },
        });
      }

      if (def.effect.type === "icicle_lance") {
        return noHits({
          ...state,
          pending: {
            kind: "play_icicle_lance",
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
        const untilDamage = !!def.effect.untilDamage;
        const bonus = def.effect.defenseBonus;
        s = {
          ...s,
          player: {
            ...playerAfterPlayingCard(s, hand, cardId),
            ...(untilDamage
              ? { defenseUntilHit: s.player.defenseUntilHit + bonus }
              : { defenseBonusThisTurn: s.player.defenseBonusThisTurn + bonus }),
          },
        };
        const msg = untilDamage
          ? `Played ${def.name} — +${bonus} defense until you take damage.`
          : `Played ${def.name} — +${bonus} defense this turn.`;
        return noHits(log(s, msg));
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

    case "TOGGLE_SENSEI_OFFER_SELECT": {
      const offer = state.senseiOffer;
      if (!offer) return noHits(state);
      if (offer.kind === "perfected_strike_discard") {
        const cardId = state.player.hand[cmd.handIndex];
        if (!cardId || cmd.handIndex === offer.cardHandIndex) return noHits(state);
        if (!state.cardDefs.get(cardId)?.types.includes("Attack")) {
          return noHits(log(state, "Perfected Strike can only discard Attack cards."));
        }
        const selected = offer.selected.includes(cmd.handIndex)
          ? offer.selected.filter((i) => i !== cmd.handIndex)
          : [...offer.selected, cmd.handIndex].sort((a, b) => a - b);
        return noHits({
          ...state,
          senseiOffer: { ...offer, selected },
        });
      }
      if (offer.kind === "evaluate_discard") {
        const cardId = state.player.hand[cmd.handIndex];
        if (!cardId) return noHits(state);
        const selected = offer.selected.includes(cmd.handIndex)
          ? offer.selected.filter((i) => i !== cmd.handIndex)
          : [...offer.selected, cmd.handIndex].sort((a, b) => a - b);
        return noHits({
          ...state,
          senseiOffer: { ...offer, selected },
        });
      }
      return noHits(state);
    }

    case "CONFIRM_SENSEI_OFFER": {
      const offer = state.senseiOffer;
      if (!offer) return noHits(state);
      if (offer.kind === "perfected_strike_discard") {
        const strikeId = state.player.hand[offer.cardHandIndex];
        if (!strikeId) return noHits(state);
        const removeSet = new Set(offer.selected.filter((i) => i !== offer.cardHandIndex));
        const discarded: string[] = [];
        const hand: string[] = [];
        state.player.hand.forEach((id, i) => {
          if (removeSet.has(i)) {
            if (state.cardDefs.get(id)?.types.includes("Attack")) discarded.push(id);
            else hand.push(id);
          } else {
            hand.push(id);
          }
        });
        const newStrikeIndex = hand.indexOf(strikeId);
        if (newStrikeIndex < 0) return noHits(state);
        let s: GameState = {
          ...state,
          player: {
            ...state.player,
            hand,
            discardPile: [...state.player.discardPile, ...discarded],
          },
          senseiOffer: null,
        };
        if (discarded.length <= 0) {
          const consumed = consumePlayedCard(s, newStrikeIndex);
          if (!consumed) return noHits(state);
          return noHits(
            log(consumed.state, "Perfected Strike — no Attack cards discarded."),
          );
        }
        const damage = 5 + 5 * discarded.length;
        return noHits(
          log(
            {
              ...s,
              pending: {
                kind: "play_perfected_strike",
                cardHandIndex: newStrikeIndex,
                damage,
              },
            },
            `Perfected Strike — discarded ${discarded.length}. Choose an adjacent target (${damage} damage).`,
          ),
        );
      }
      if (offer.kind === "evaluate_discard") {
        const sorted = [...offer.selected].sort((a, b) => b - a);
        let hand = [...state.player.hand];
        const discarded: string[] = [];
        for (const i of sorted) {
          const id = hand[i];
          if (!id) continue;
          discarded.push(id);
          hand.splice(i, 1);
        }
        let s: GameState = {
          ...state,
          player: {
            ...state.player,
            hand,
            discardPile: [...state.player.discardPile, ...discarded],
          },
          senseiOffer: null,
        };
        if (discarded.length > 0) {
          s = drawFromPlayerDeck(s, discarded.length);
        }
        return noHits(
          log(
            s,
            discarded.length === 0
              ? "Evaluate — you discard nothing."
              : `Evaluate — discard ${discarded.length}, draw ${discarded.length}.`,
          ),
        );
      }
      if (offer.kind === "reckless_assault_hp") {
        const def = state.cardDefs.get(state.player.hand[offer.cardHandIndex] ?? "");
        if (!def || def.effect.type !== "reckless_assault") return noHits(state);
        return noHits({
          ...state,
          senseiOffer: null,
          pending: {
            kind: "play_reckless_assault",
            cardHandIndex: offer.cardHandIndex,
            minDamage: def.effect.minDamage,
            maxDamage: def.effect.maxDamage,
            hpLost: offer.hpLost,
          },
        });
      }
      return noHits(state);
    }

    case "SET_RECKLESS_ASSAULT_HP": {
      const offer = state.senseiOffer;
      if (!offer || offer.kind !== "reckless_assault_hp") return noHits(state);
      const maxLose = Math.max(0, state.player.hp - 1);
      const hpLost = Math.max(0, Math.min(maxLose, Math.trunc(cmd.hpLost)));
      return noHits({
        ...state,
        senseiOffer: { ...offer, hpLost },
      });
    }

    case "RESOLVE_STAY_ON_THE_MOVE": {
      const offer = state.senseiOffer;
      if (!offer || offer.kind !== "stay_on_the_move") return noHits(state);
      const def = state.cardDefs.get(cmd.cardId);
      if (!def?.types.includes("Move")) {
        return noHits(log(state, "Choose a Move card from your discard pile."));
      }
      const discardIndex = state.player.discardPile.lastIndexOf(cmd.cardId);
      if (discardIndex < 0) return noHits(log(state, "That card is not in your discard pile."));
      const discardPile = [...state.player.discardPile];
      discardPile.splice(discardIndex, 1);
      const hand = [...state.player.hand, cmd.cardId];
      const staged: GameState = {
        ...state,
        player: { ...state.player, discardPile, hand },
        senseiOffer: null,
      };
      return dispatchCore(staged, { type: "REQUEST_PLAY_CARD", handIndex: hand.length - 1 });
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
        state.pending.kind === "play_broadsword" ||
        state.pending.kind === "play_icicle_lance" ||
        state.pending.kind === "play_knife" ||
        state.pending.kind === "play_axe" ||
        state.pending.kind === "play_executioner_axe" ||
        state.pending.kind === "play_ancient_knife" ||
        state.pending.kind === "discard_punch" ||
        state.pending.kind === "play_magic_missile" ||
        state.pending.kind === "play_knockback_punch" ||
        state.pending.kind === "play_bow_attack" ||
        state.pending.kind === "throw_knife" ||
        state.pending.kind === "play_lightning_bolt" ||
        state.pending.kind === "play_mace_smash" ||
        state.pending.kind === "play_poisoned_blade" ||
        state.pending.kind === "play_great_sword" ||
        state.pending.kind === "play_perfected_strike" ||
        state.pending.kind === "play_reckless_assault" ||
        state.pending.kind === "play_thieving_strike"
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
          keyDoorHaltTiles(state),
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
          const taken = applyDamageToPlayer(state, raw);
          const dmg = taken.damage;
          const hp = taken.state.player.hp;
          const resistance = taken.state.player.resistance;
          const px = state.player.x;
          const py = state.player.y;
          if (hp <= 0) {
            return withHits(log(
                {
                  ...taken.state,
                  player: { ...playerAfterPlayingCard(taken.state, hand, cardId), hp: 0, resistance },
                  phase: "defeat",
                  pending: null,
                },
                "The mimic's bite is fatal.",
              ), [{ gridX: px, gridY: py, damage: dmg }],);
          }
          let s: GameState = {
            ...taken.state,
            player: { ...playerAfterPlayingCard(taken.state, hand, cardId), hp, resistance },
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
          const takenW = applyDamageToPlayer(state, state.danger);
          const dmgW = takenW.damage;
          const hpW = takenW.state.player.hp;
          let sw: GameState = {
            ...takenW.state,
            player: {
              ...playerAfterPlayingCard(takenW.state, handW, cardIdW),
              hp: hpW,
              resistance: takenW.state.player.resistance,
            },
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
          keyDoorHaltTiles(state),
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
          const taken = applyDamageToPlayer(state, raw);
          const dmg = taken.damage;
          const hp = taken.state.player.hp;
          const resistance = taken.state.player.resistance;
          const px = state.player.x;
          const py = state.player.y;
          if (hp <= 0) {
            return withHits(log(
                {
                  ...taken.state,
                  player: { ...playerAfterPlayingCard(taken.state, hand, cardId), hp: 0, resistance },
                  phase: "defeat",
                  pending: null,
                },
                "The mimic's bite is fatal.",
              ), [{ gridX: px, gridY: py, damage: dmg }],);
          }
          let s: GameState = {
            ...taken.state,
            player: { ...playerAfterPlayingCard(taken.state, hand, cardId), hp, resistance },
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
          const takenWs = applyDamageToPlayer(state, state.danger);
          const dmgWs = takenWs.damage;
          const hpWs = takenWs.state.player.hp;
          let sws: GameState = {
            ...takenWs.state,
            player: {
              ...playerAfterPlayingCard(takenWs.state, handWs, cardIdWs),
              hp: hpWs,
              resistance: takenWs.state.player.resistance,
            },
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
          keyDoorHaltTiles(state),
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
            (blocksFooting(state, cell.x, cell.y) &&
              !(
                isLockedDoorAt(state, cell.x, cell.y) &&
                state.player.keys > 0 &&
                cell.x === dest.x &&
                cell.y === dest.y
              )) ||
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
          keyDoorHaltTiles(state),
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
            pending: null,
          };
          const raw = rollInt(3, 4);
          const taken = applyDamageToPlayer(s, raw);
          s = taken.state;
          const dmg = taken.damage;
          const hp = s.player.hp;
          const px = s.player.x;
          const py = s.player.y;
          if (hp <= 0) {
            return withHits(log(
                { ...s, player: { ...s.player, hp: 0 }, phase: "defeat" },
                "The mimic's bite is fatal.",
              ), [{ gridX: px, gridY: py, damage: dmg }],);
          }
          s = awakenMimicOnTile(s, dest.x, dest.y);
          s = log(s, "The chest strikes — the Mimic wakes!");
          return withHits(s, [{ gridX: px, gridY: py, damage: dmg }],);
        }

        const brDm = bridgeTileKeySet(state);
        if (tileAt(state.tiles, dest) === "water" && !brDm.has(keyOf(dest))) {
          const takenD = applyDamageToPlayer(state, state.danger);
          const dmgD = takenD.damage;
          let sd: GameState = {
            ...takenD.state,
            pending: { kind: "water_escape", waterX: dest.x, waterY: dest.y },
          };
          sd = log(
            sd,
            `The water pulls you under — ${dmgD} damage! Discard a card and choose adjacent land to escape.`,
          );
          if (sd.player.hp <= 0) {
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
          keyDoorHaltTiles(state),
        );
        reach = extendMoveReachForPending(state, reach, from, state.pending);
        reach = addAdjacentPureWaterTiles(state, reach, from);
        if (!reach.has(keyOf(dest))) return noHits(state);

        const mimicHere = state.monsters.find(
          (m) => m.defId === "mimic" && m.mimicAsleep && m.x === dest.x && m.y === dest.y,
        );
        if (mimicHere) {
          const raw = rollInt(3, 4);
          const taken = applyDamageToPlayer(state, raw);
          const dmg = taken.damage;
          const hp = taken.state.player.hp;
          const px = state.player.x;
          const py = state.player.y;
          if (hp <= 0) {
            return withHits(log(
                {
                  ...taken.state,
                  player: { ...taken.state.player, hp: 0 },
                  phase: "defeat",
                  pending: null,
                },
                "The mimic's bite is fatal.",
              ), [{ gridX: px, gridY: py, damage: dmg }],);
          }
          let s: GameState = {
            ...taken.state,
            player: {
              ...taken.state.player,
              moveTokens: state.player.moveTokens - 1,
            },
            pending: null,
          };
          s = awakenMimicOnTile(s, dest.x, dest.y);
          s = log(s, "The chest strikes — the Mimic wakes!");
          return withHits(s, [{ gridX: px, gridY: py, damage: dmg }],);
        }

        const brTok = bridgeTileKeySet(state);
        if (tileAt(state.tiles, dest) === "water" && !brTok.has(keyOf(dest))) {
          const takenT = applyDamageToPlayer(state, state.danger);
          const dmgT = takenT.damage;
          let st: GameState = {
            ...takenT.state,
            player: {
              ...takenT.state.player,
              moveTokens: state.player.moveTokens - 1,
            },
            pending: { kind: "water_escape", waterX: dest.x, waterY: dest.y },
          };
          st = log(
            st,
            `The water pulls you under — ${dmgT} damage! Discard a card and choose adjacent land to escape.`,
          );
          if (st.player.hp <= 0) {
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

        for (const cell of fireballBlastCells(s, dest)) {
            const tx = cell.x;
            const ty = cell.y;
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
            for (const bp of s.bonePiles.filter((w) => w.hp > 0 && w.x === tx && w.y === ty)) {
              const hp = Math.max(0, bp.hp - dmg);
              s = {
                ...s,
                bonePiles:
                  hp <= 0
                    ? s.bonePiles.filter((w) => w.id !== bp.id)
                    : s.bonePiles.map((w) => (w.id === bp.id ? { ...w, hp } : w)),
              };
              hits.push({ gridX: tx, gridY: ty, damage: dmg });
              if (hp <= 0) s = log(s, "The bone pile is scattered.");
            }
            for (const pile of s.graveBonePiles.filter((w) => w.hp > 0 && w.x === tx && w.y === ty)) {
              const hp = Math.max(0, pile.hp - dmg);
              s = {
                ...s,
                graveBonePiles:
                  hp <= 0
                    ? s.graveBonePiles.filter((w) => w.id !== pile.id)
                    : s.graveBonePiles.map((w) => (w.id === pile.id ? { ...w, hp } : w)),
              };
              hits.push({ gridX: tx, gridY: ty, damage: dmg });
              if (hp <= 0) s = log(s, "The pile of bones collapses.");
            }
            if (s.player.x === tx && s.player.y === ty) {
              const taken = applyDamageToPlayer(s, dmg);
              s = taken.state;
              const pdmg = taken.damage;
              s = {
                ...s,
                player: {
                  ...s.player,
                  fireLevels: (s.player.fireLevels ?? 0) + fireLvls,
                },
              };
              hits.push({ gridX: tx, gridY: ty, damage: pdmg });
              s = log(s, `You are caught in the fireball — ${pdmg} damage and Fire ${fireLvls}!`);
              if (s.player.hp <= 0) {
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
        const preexistingBonePileIds = s.bonePiles
          .filter((t) => t.hp > 0 && t.x === dest.x && t.y === dest.y)
          .map((t) => t.id);
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
        for (const id of preexistingBonePileIds) {
          const bp = s.bonePiles.find((t) => t.id === id && t.hp > 0);
          if (!bp) continue;
          const hp = Math.max(0, bp.hp - p.damage);
          s = {
            ...s,
            bonePiles:
              hp <= 0
                ? s.bonePiles.filter((t) => t.id !== bp.id)
                : s.bonePiles.map((t) => (t.id === bp.id ? { ...t, hp } : t)),
          };
          hits.push({ gridX: dest.x, gridY: dest.y, damage: p.damage });
          if (hp <= 0) s = log(s, "The bone pile is scattered.");
        }
        for (const pile of s.graveBonePiles.filter((t) => t.hp > 0 && t.x === dest.x && t.y === dest.y)) {
          const hp = Math.max(0, pile.hp - p.damage);
          s = {
            ...s,
            graveBonePiles:
              hp <= 0
                ? s.graveBonePiles.filter((t) => t.id !== pile.id)
                : s.graveBonePiles.map((t) => (t.id === pile.id ? { ...t, hp } : t)),
          };
          hits.push({ gridX: dest.x, gridY: dest.y, damage: p.damage });
          if (hp <= 0) s = log(s, "The pile of bones collapses.");
        }
        if (s.player.x === dest.x && s.player.y === dest.y) {
          const _taken_dmg = applyDamageToPlayer(s, p.damage);
          s = _taken_dmg.state;
          const dmg = _taken_dmg.damage;
          const hp = s.player.hp;
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

    case "USE_THROWING_KNIFE": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      if (state.player.throwingKnives <= 0) return noHits(log(state, "You have no throwing knife."));
      return noHits(
        log({ ...state, pending: { kind: "throw_knife" } }, "Choose a target 2 to 5 spaces away."),
      );
    }

    case "USE_HEALING_PENDANT": {
      if (state.phase !== "player") return noHits(state);
      if (state.player.healingPendants <= 0) return noHits(log(state, "You have no healing pendant."));
      if (state.pending?.kind === "pendant_discard") {
        return noHits(log({ ...state, pending: null }, "You lower the healing pendant."));
      }
      if (state.pending) return noHits(state);
      if (state.player.hp >= state.player.maxHp) return noHits(log(state, "You are already at full health."));
      if (state.player.hand.length < 4) {
        return noHits(log(state, "The pendant needs four cards to discard."));
      }
      return noHits(
        log(
          { ...state, pending: { kind: "pendant_discard", chosen: [] } },
          "Choose 4 cards to discard.",
        ),
      );
    }

    case "TOGGLE_PENDANT_CARD": {
      if (state.pending?.kind !== "pendant_discard") return noHits(state);
      const ix = cmd.handIndex;
      if (ix < 0 || ix >= state.player.hand.length) return noHits(state);
      const chosen = state.pending.chosen.includes(ix)
        ? state.pending.chosen.filter((i) => i !== ix)
        : [...state.pending.chosen, ix];
      if (chosen.length < 4) {
        return noHits({ ...state, pending: { kind: "pendant_discard", chosen } });
      }
      const { nextHand, removed } = removeHandIndices(state.player.hand, chosen);
      if (removed.length < 4) return noHits(state);
      const heal = Math.max(1, Math.round(state.player.maxHp * 0.1));
      const hp = Math.min(state.player.maxHp, state.player.hp + heal);
      return noHits(
        log(
          {
            ...state,
            pending: null,
            player: {
              ...state.player,
              hand: nextHand,
              discardPile: [...state.player.discardPile, ...removed],
              hp,
            },
          },
          `The pendant drinks four cards. You heal ${hp - state.player.hp} HP.`,
        ),
      );
    }

    case "USE_SHIELDING_RING": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      if (state.player.shieldingRings <= 0) return noHits(log(state, "You have no shielding ring."));
      if (state.player.gold < 2) return noHits(log(state, "The ring demands 2 gold."));
      const resistance = state.player.resistance + 5;
      return noHits(
        log(
          {
            ...state,
            player: { ...state.player, gold: state.player.gold - 2, resistance },
          },
          `The shielding ring drinks 2 gold. Resistance is ${resistance} this turn.`,
        ),
      );
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

    case "USE_CHEESE": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      if (state.player.cheese <= 0) return noHits(log(state, "You have no cheese."));
      if (state.player.hp >= state.player.maxHp) return noHits(log(state, "You're at full health."));
      const heal = Math.min(3, state.player.maxHp - state.player.hp);
      return noHits(
        log(
          {
            ...state,
            player: {
              ...state.player,
              cheese: state.player.cheese - 1,
              hp: state.player.hp + heal,
            },
          },
          `You eat cheese and recover ${heal} HP.`,
        ),
      );
    }

    case "USE_STEW": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      if (state.player.stew <= 0) return noHits(log(state, "You have no Obamly's Special Stew."));
      const maxHp = state.player.maxHp + 1;
      const hp = Math.min(state.player.hp + 6, maxHp);
      return noHits(
        log(
          {
            ...state,
            player: {
              ...state.player,
              stew: state.player.stew - 1,
              maxHp,
              hp,
            },
          },
          `You eat Obamly's Special Stew — +1 max HP and recover to ${hp}/${maxHp}.`,
        ),
      );
    }

    case "USE_FLAME_OF_DESTRUCTION": {
      if (state.phase !== "player" || state.pending || choiceModalBlocksProgression(state)) {
        return noHits(state);
      }
      if (state.player.flameOfDestruction <= 0) {
        return noHits(log(state, "You have no Flame of Destruction."));
      }
      if (state.player.discardPile.length === 0) {
        return noHits(log(state, "Your discard pile is empty — nothing to destroy."));
      }
      return noHits(
        log(
          { ...state, flameDestroyPending: true },
          "Flame of Destruction — choose a card in your discard pile to destroy.",
        ),
      );
    }

    case "RESOLVE_FLAME_DESTROY": {
      if (!state.flameDestroyPending) return noHits(state);
      if (cmd.cardId === null) {
        return noHits(
          log({ ...state, flameDestroyPending: false }, "You withhold the Flame of Destruction."),
        );
      }
      const removed = removeOneFromDiscard(state, cmd.cardId);
      if (!removed) {
        return noHits(log(state, "That card is not in your discard pile."));
      }
      const nm = state.cardDefs.get(cmd.cardId)?.name ?? cmd.cardId;
      let s = clearEquippedIfGone(removed);
      s = {
        ...s,
        flameDestroyPending: false,
        player: {
          ...s.player,
          flameOfDestruction: Math.max(0, state.player.flameOfDestruction - 1),
        },
      };
      return noHits(log(s, `Flame of Destruction consumes ${nm} from your discard pile.`));
    }

    case "USE_UNBOUND_TOME": {
      if (state.phase !== "player" || state.pending || choiceModalBlocksProgression(state)) {
        return noHits(state);
      }
      if (state.player.unboundTomes <= 0) {
        return noHits(log(state, "You have no Unbound Magic Tome."));
      }
      const hasMagic = state.player.hand.some((id) =>
        state.cardDefs.get(id)?.types.includes("Magic"),
      );
      if (!hasMagic) {
        return noHits(log(state, "You need a Magic card in hand to bind into the Tome."));
      }
      return noHits(
        log(
          { ...state, bindTomePending: true },
          "Unbound Magic Tome — discard a Magic card from your hand to bind it.",
        ),
      );
    }

    case "RESOLVE_BIND_TOME": {
      if (!state.bindTomePending) return noHits(state);
      if (cmd.handIndex === null) {
        return noHits(
          log({ ...state, bindTomePending: false }, "You leave the Magic Tome unbound."),
        );
      }
      const cardId = state.player.hand[cmd.handIndex];
      if (!cardId) return noHits(state);
      const def = state.cardDefs.get(cardId);
      if (!def?.types.includes("Magic")) {
        return noHits(log(state, "Only a Magic card can be bound into a Tome."));
      }
      const hand = [...state.player.hand];
      hand.splice(cmd.handIndex, 1);
      const bound = {
        id: nextBoundTomeId(state),
        cardId,
        charges: 3,
      };
      const nm = def.name;
      return noHits(
        log(
          {
            ...state,
            bindTomePending: false,
            player: {
              ...state.player,
              hand,
              discardPile: [...state.player.discardPile, cardId],
              unboundTomes: state.player.unboundTomes - 1,
              boundTomes: [...state.player.boundTomes, bound],
            },
          },
          `The Tome binds ${nm} — three charges.`,
        ),
      );
    }

    case "USE_BOUND_TOME": {
      if (state.phase !== "player" || state.pending || choiceModalBlocksProgression(state)) {
        return noHits(state);
      }
      if (state.tomeCast) {
        return noHits(log(state, "Finish or cancel the current Bound Tome cast first."));
      }
      const tome = state.player.boundTomes.find((t) => t.id === cmd.tomeId);
      if (!tome || tome.charges <= 0) {
        return noHits(log(state, "That Bound Tome is spent."));
      }
      const def = state.cardDefs.get(tome.cardId);
      if (!def) return noHits(state);
      if (state.player.hasteThisTurn) {
        const blockedTypes = ["Attack", "Protection", "Aid", "Deck"];
        if (def.types.some((t) => blockedTypes.includes(t))) {
          return noHits(
            log(state, "Haste is active — that Bound Tome spell cannot be cast this turn."),
          );
        }
      }
      const hand = [...state.player.hand, tome.cardId];
      const handIndex = hand.length - 1;
      const withCast: GameState = {
        ...state,
        player: { ...state.player, hand },
        tomeCast: { tomeId: tome.id, handIndex },
      };
      return dispatchCore(withCast, { type: "REQUEST_PLAY_CARD", handIndex });
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
        case "defense":
          return noHits(
            log(
              {
                ...s,
                player: {
                  ...s.player,
                  defenseBonusThisTurn: s.player.defenseBonusThisTurn + 4,
                },
              },
              "Gem of Defense — +4 defense for the rest of this turn.",
            ),
          );
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
      if (state.flameDestroyPending || state.bindTomePending) {
        return noHits(log(state, "Finish the inventory choice before ending the turn."));
      }
      if (state.tomeCast) {
        return noHits(log(state, "Finish or cancel the Bound Tome cast before ending the turn."));
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
    s = finalizeTomeCast(state, s);
    const hits = r.hits;
    const anims = finalizeAnims(state, s, hits, r.anims, cmd);
    return { state: s, hits, anims };
  } finally {
    popRollChanceContext();
  }
}
