import { applyDefense, rollInt } from "../engine/combat";
import { addRoomsToDiscovered, collectRoomIdsAdjacentToPlayer } from "../engine/discovery";
import { keyOf, magicMissilePathClear, magicMissilePathClearToPoint, tileAt } from "../engine/grid";
import { manhattan, reachableOrthogonal } from "../engine/movement";
import { generateFloor } from "../engine/floorGen";
import { buildFreshDungeonDeck, DUNGEON_DEADLIER_ID } from "./dungeonDeck";
import {
  appendGoldSeekerBonusCoin,
  createNextFloorState,
  pickMonsterId,
  pickWeightedDefId,
} from "./initialState";
import { runMonsterPhaseWithHooks } from "./monsterAi";
import { createMonsterInstance, monsterDefenseForIncoming } from "./monsterSpawn";
import { attachStairRoom } from "./stairRoom";
import {
  pickChestOfferCards,
  pickDeckBuilderThreeForType,
  pickPedestalOfferCards,
  rollChestLoot,
  rollPotLoot,
} from "./loot";
import { addExp } from "./progression";
import {
  attackStrengthBonus,
  breadHealBonus,
  descendantSkipDungeonDraw,
  fighterTrainingBonus,
  hasSkill,
  heavyPunchBonus,
  incomingDamageToPlayer,
  knockbackTokensGrantedPerTurn,
  mageTrainingBonus,
  moveTokensGrantedPerTurn,
  playerDrawCountPerTurn,
  potLootHitChance,
  SID,
  sprinterExtraMoveRange,
} from "./skillsRuntime";
import { getSkillDef } from "./skillDefs";
import type {
  DispatchResult,
  GameCommand,
  GameState,
  GroundLootInstance,
  HitVisual,
  MonsterDef,
  MonsterInstance,
  Point,
  RockInstance,
  RoomKind,
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
    !!s.deckBuilderOffer
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
    const options = pickDeckBuilderThreeForType(state.cardDefs, cmd.cardType);
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
    if (removed) return noHits(log(removed, `Command: removed one ${nm}.`));
    if (state.player.equipped === cmd.cardId) {
      return noHits(
        log(
          { ...state, player: { ...state.player, equipped: null } },
          `Command: removed equipped ${nm}.`,
        ),
      );
    }
    return noHits(log(state, `Command: ${nm} is not in your deck.`));
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

  return noHits(state);
}

function applyMonsterKillRewards(state: GameState, defId: string): GameState {
  const power = state.monsterDefs.get(defId)?.power ?? 3;
  const withGold = { ...state, player: { ...state.player, gold: state.player.gold + 2 } };
  return addExp(withGold, power);
}

function tryKnockMonsterFromPlayer(s: GameState, mon: MonsterInstance): GameState {
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
  const monsters = s.monsters.map((m) => (m.id === mon.id ? { ...m, x: nx, y: ny } : m));
  return log({ ...s, monsters }, "Knockback sends them reeling!");
}

function weaponAttackRollRaw(s: GameState, cardId: string | undefined, minD: number, maxD: number): number {
  const def = cardId ? s.cardDefs.get(cardId) : undefined;
  let r = rollInt(minD, maxD);
  r += attackStrengthBonus(s);
  r += fighterTrainingBonus(s, def);
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
  return { state: s, hits: [] };
}

function withHits(s: GameState, hits: HitVisual[]): DispatchResult {
  return { state: s, hits };
}

function occupiedByMonsters(state: GameState): Set<string> {
  const s = new Set<string>();
  for (const m of state.monsters) {
    if (m.hp > 0) s.add(keyOf(m));
  }
  return s;
}

function occupiedForPlayerMove(state: GameState): Set<string> {
  return occupiedByMonsters(state);
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
  const attempts = 1 + s.depth;
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
    const defId = pickMonsterId(kind, next.monsterDefs);
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
      if (Math.random() >= 1 / 8) continue;
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
  const pool = [...state.cardDefs.entries()]
    .filter(([, d]) => d.effect.type !== "bonus_chit")
    .map(([id]) => id);
  if (pool.length === 0) return "move";
  return pool[rollInt(0, pool.length - 1)]!;
}

function enqueueCardPickup(s: GameState, cardId: string): GameState {
  const prev = s.cardPickupOffer?.queue ?? [];
  return { ...s, cardPickupOffer: { queue: [...prev, cardId] } };
}

/** Keeps `equipped` set; removes that id from draw/discard so one copy sits on top of the draw pile. */
function ensureEquippedOnDeckTop(s: GameState): GameState {
  const eq = s.player.equipped;
  if (!eq) return s;
  const drawPile = s.player.drawPile.filter((c) => c !== eq);
  const discardPile = s.player.discardPile.filter((c) => c !== eq);
  return {
    ...s,
    player: { ...s.player, drawPile: [eq, ...drawPile], discardPile },
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

function gauntletPowerPartitions(maxMonsters: number): number[][] {
  const res: number[][] = [];
  function bt(rem: number, path: number[]) {
    if (path.length > maxMonsters) return;
    if (rem === 0) {
      res.push([...path]);
      return;
    }
    for (const p of [2, 4, 5]) {
      if (p <= rem) bt(rem - p, [...path, p]);
    }
  }
  bt(10, []);
  return res;
}

function defIdForGauntletPower(p: number, monsterDefs: Map<string, MonsterDef>): string {
  if (p === 5) return "rockling";
  if (p === 4) return pickWeightedDefId(["skeleton", "mystic_core"], monsterDefs);
  return pickWeightedDefId(["slime", "dune_rat"], monsterDefs);
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
  const options = gauntletPowerPartitions(candidates.length);
  if (options.length === 0) {
    return log(s, "Gauntlet spawn failed — not enough space.");
  }
  const powers = options[Math.floor(Math.random() * options.length)]!;
  const roster = powers.map((p) => defIdForGauntletPower(p, s.monsterDefs));
  shuffleInPlace(roster);
  shuffleInPlace(candidates);
  let serial = nextMonsterSerial(s.monsters);
  const newMons = [...s.monsters];
  for (let i = 0; i < roster.length; i++) {
    const defId = roster[i]!;
    const p = candidates[i]!;
    newMons.push(
      createMonsterInstance(`monster_${serial++}`, defId, p.x, p.y, s.monsterDefs, s.danger),
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
  let next = collectAdjacentLoot(openChestAsPlayer(breakPotAsPlayer(s, x, y), x, y));
  next = maybeCommenceGauntlet(next, x, y);
  return next;
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
    player: { ...next.player, gold, bread },
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
  const pool = [...next.cardDefs.entries()]
    .filter(([, d]) => d.effect.type !== "bonus_chit")
    .map(([id]) => id);
  const loot = rollPotLoot(pool, potLootHitChance(next));
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
  const pool = [...s.cardDefs.entries()]
    .filter(([, d]) => d.effect.type !== "bonus_chit")
    .map(([id]) => id);
  const loot = rollPotLoot(pool, potLootHitChance(next));
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
      const cards = pickChestOfferCards(next.cardDefs, loot.tier);
      return log(
        { ...next, chestOffer: { cards } },
        "Inside: inscribed cards — take one, or leave them all.",
      );
    }
  }
}

function drawFromPlayerDeck(state: GameState, n: number): GameState {
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
    if (s.player.drawPile.length === 0) break;
    const [top, ...rest] = s.player.drawPile;
    hand = [...hand, top];
    s = { ...s, player: { ...s.player, drawPile: rest, hand } };
  }
  return s;
}

function shuffleInPlace<T>(xs: T[]): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
}

function reshufflePlayerDeck(s: GameState): GameState {
  const all = [...s.player.drawPile, ...s.player.discardPile, ...s.player.hand];
  shuffleInPlace(all);
  return {
    ...s,
    player: {
      ...s.player,
      drawPile: all,
      discardPile: [],
      hand: [],
      suppressNextMove: false,
      defenseBonusThisTurn: 0,
      doublePunchThisTurn: false,
      moveTokens: 0,
      knockbackTokens: 0,
      knockbackPrimed: false,
    },
  };
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
  const cards = pickPedestalOfferCards(s.cardDefs);
  return { ...s, pedestalOffer: { cards } };
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
  const eq = s.player.equipped;
  const toDiscard: string[] = [];
  for (const id of s.player.hand) {
    const def = s.cardDefs.get(id);
    if (def?.effect.type === "bonus_chit") continue;
    if (eq && id === eq) continue;
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
      knockbackPrimed: false,
    },
  };
}

function drawDungeonTop(s: GameState): { state: GameState; hits: HitVisual[] } {
  let draw = [...s.dungeonDraw];
  let disc = [...s.dungeonDiscard];
  if (draw.length === 0) {
    if (disc.length === 0) {
      return { state: log(s, "The dungeon deck is empty."), hits: [] };
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
    return { state: log(base, `Unknown dungeon card: ${id}`), hits: [] };
  }

  if (s.stabilityBuffActive && id !== DUNGEON_DEADLIER_ID && Math.random() < 0.5) {
    const summary = "Stability holds — the card triggers but nothing happens.";
    const st = log(
      { ...base, stabilityBuffActive: false, dungeonCardReveal: { title: def.name, summary } },
      `Dungeon: ${def.name} — ${summary}`,
    );
    return { state: st, hits: [] };
  }

  const working: GameState = { ...base, stabilityBuffActive: false };

  if (descendantSkipDungeonDraw(working)) {
    const summary = "Descendant — the dungeon's pull slips past you this turn.";
    const st = log(
      { ...working, dungeonCardReveal: { title: def.name, summary } },
      `Dungeon: ${def.name} — ${summary}`,
    );
    return { state: st, hits: [] };
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
      return { state: st, hits: [] };
    }
    case "add_noise": {
      const noise = working.noise + def.effect.amount;
      summary = `+${def.effect.amount} Noise (total ${noise}).`;
      const st = log(
        { ...working, noise, dungeonCardReveal: { title, summary } },
        `Dungeon: ${title} — ${summary}`,
      );
      return { state: st, hits: [] };
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
      return { state: st, hits: fr.hits };
    }
    case "monsters_from_deep": {
      const sp = spawnMonstersFromDeep(working);
      summary = sp.lines.join(" ");
      const st = log(
        { ...sp.state, dungeonCardReveal: { title, summary } },
        `Dungeon: ${title} — ${summary}`,
      );
      return { state: st, hits: [] };
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
      return { state: st, hits: [] };
    }
    case "stability": {
      summary = "The next dungeon card may not take effect (except THE DUNGEON IS DEADLIER).";
      const st = log(
        { ...working, stabilityBuffActive: true, dungeonCardReveal: { title, summary } },
        `Dungeon: ${title} — ${summary}`,
      );
      return { state: st, hits: [] };
    }
    case "dust_settles": {
      summary = "You cannot scout this turn.";
      const st = log(
        { ...working, scoutBlockedThisTurn: true, dungeonCardReveal: { title, summary } },
        `Dungeon: ${title} — ${summary}`,
      );
      return { state: st, hits: [] };
    }
    default:
      return { state: log(working, "Unknown dungeon card effect."), hits: [] };
  }
}

function runMonsterPhase(state: GameState): { state: GameState; hits: HitVisual[] } {
  return runMonsterPhaseWithHooks(state, {
    resolvePlayerEnter: resolvePlayerEnterTile,
    breakPotMonster: breakPotAsMonster,
  });
}

function beginNextPlayerTurn(s: GameState): GameState {
  if (s.phase === "defeat") return s;
  let next = { ...s, turn: s.turn + 1 };
  next = ensureEquippedOnDeckTop(next);
  const drawN = playerDrawCountPerTurn(next);
  next = drawFromPlayerDeck(next, drawN);
  next = {
    ...next,
    player: {
      ...next.player,
      defenseBonusThisTurn: 0,
      doublePunchThisTurn: false,
      moveTokens: moveTokensGrantedPerTurn(next),
      knockbackTokens: knockbackTokensGrantedPerTurn(next),
      knockbackPrimed: false,
      movementCardsPlayedThisTurn: 0,
      scoutUsesThisTurn: 0,
    },
  };
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

function dispatchCore(state: GameState, cmd: GameCommand): DispatchResult {
  if (
    cmd.type === "DEV_SET_VARIABLE" ||
    cmd.type === "DEV_CARD" ||
    cmd.type === "DEV_DUNGEON_TOP"
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

  if (state.phase === "peace") {
    if (cmd.type === "PEACE_MOVE_TO") {
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
        const gen = generateFloor({ depth: state.depth + 1 });
        let next = createNextFloorState(state, gen);
        next = reshufflePlayerDeck(next);
        next = ensureEquippedOnDeckTop(next);
        next = drawFromPlayerDeck(next, 3);
        next = revealAtPlayer(next);
        next = collectAdjacentLoot(next);
        next = log(
          next,
          `You descend — floor ${next.depth}, danger ${next.danger}. Decks reshuffled; new hand drawn.`,
        );
        next = log(next, `— Turn ${next.turn} — You draw 3 cards.`);
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
          { ...removed, deckDestroyPending: false, pedestalUsed: true },
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
      let s = ensureEquippedOnDeckTop({ ...state, turn: 1 });
      const n = playerDrawCountPerTurn(s);
      s = drawFromPlayerDeck(s, n);
      s = {
        ...s,
        player: {
          ...s.player,
          moveTokens: moveTokensGrantedPerTurn(s),
          knockbackTokens: knockbackTokensGrantedPerTurn(s),
          knockbackPrimed: false,
          movementCardsPlayedThisTurn: 0,
          scoutUsesThisTurn: 0,
        },
      };
      s = revealAtPlayer(s);
      s = collectAdjacentLoot(s);
      return noHits(log(s, `— Turn 1 — You draw ${n} cards.`));
    }

    case "CANCEL_PENDING": {
      if (!state.pending) return noHits(state);
      return noHits({ ...state, pending: null });
    }

    case "REQUEST_EQUIP": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      const idx = cmd.handIndex;
      const cardId = state.player.hand[idx];
      if (!cardId || state.player.equipped) return noHits(state);
      if (state.cardDefs.get(cardId)?.effect.type === "bonus_chit") {
        return noHits(log(state, "Bonus Cards can't be equipped."));
      }
      const hand = state.player.hand.filter((_, i) => i !== idx);
      const drawPile = state.player.drawPile.filter((c) => c !== cardId);
      const discardPile = state.player.discardPile.filter((c) => c !== cardId);
      return noHits(
        log(
          {
            ...state,
            player: { ...state.player, hand, equipped: cardId, drawPile, discardPile },
          },
          `Equipped ${state.cardDefs.get(cardId)?.name ?? cardId}.`,
        ),
      );
    }

    case "UNEQUIP": {
      if (!state.player.equipped) return noHits(state);
      const top = state.player.equipped;
      const drawPile = [top, ...state.player.drawPile.filter((c) => c !== top)];
      return noHits(
        log(
          { ...state, player: { ...state.player, equipped: null, drawPile } },
          `Unequipped — ${state.cardDefs.get(top)?.name ?? top} placed on top of your deck.`,
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

      if (def.effect.type === "bonus_chit") {
        return noHits(log(state, "Bonus Cards can't be played — discard one for a bonus action."));
      }

      if (def.effect.type === "tactical_approach") {
        let s = state;
        const hand = [...s.player.hand];
        hand.splice(idx, 1);
        const discardPile = [...s.player.discardPile, cardId];
        s = { ...s, player: { ...s.player, hand, discardPile } };
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
        const discardPile = [...s.player.discardPile, cardId];
        s = { ...s, player: { ...s.player, hand, discardPile } };
        s = drawFromPlayerDeck(s, def.effect.amount);
        return noHits(log(s, `Played ${def.name} — draw ${def.effect.amount}.`));
      }

      if (def.effect.type === "move") {
        const range = def.effect.range + sprinterExtraMoveRange(state, def);
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
        const discardPile = [...s.player.discardPile, cardId];
        const sprinterExtra =
          s.player.movementCardsPlayedThisTurn === 0 && hasSkill(s, SID.MOB_SPRINTER) ? 1 : 0;
        const maxRange = 1 + sprinterExtra;
        s = {
          ...s,
          player: { ...s.player, hand, discardPile },
          pending: { kind: "discard_move1", maxRange, fromQuickstep: true },
        };
        s = drawFromPlayerDeck(s, def.effect.draw);
        const stepMsg =
          maxRange > 1
            ? `Played ${def.name} — draw, then step up to ${maxRange} spaces (Sprinter).`
            : `Played ${def.name} — draw, then step 1 space.`;
        return noHits(log(s, stepMsg));
      }

      if (def.effect.type === "parry") {
        let s = state;
        const hand = [...s.player.hand];
        hand.splice(idx, 1);
        const discardPile = [...s.player.discardPile, cardId];
        const defenseBonusThisTurn = s.player.defenseBonusThisTurn + def.effect.defenseBonus;
        s = { ...s, player: { ...s.player, hand, discardPile, defenseBonusThisTurn } };
        return noHits(log(s, `Played ${def.name} — +${def.effect.defenseBonus} defense this turn.`));
      }

      if (def.effect.type === "flurry") {
        let s = state;
        const hand = [...s.player.hand];
        hand.splice(idx, 1);
        const discardPile = [...s.player.discardPile, cardId];
        s = { ...s, player: { ...s.player, hand, discardPile, doublePunchThisTurn: true } };
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
        return noHits({
          ...state,
          pending: { kind: "play_card_seeker", cardHandIndex: idx },
        });
      }

      return noHits(state);
    }

    case "REQUEST_DISCARD_BONUS": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      const idx = cmd.handIndex;
      const cardId = state.player.hand[idx];
      if (!cardId) return noHits(state);
      const hand = state.player.hand.filter((_, i) => i !== idx);
      const isBonus = state.cardDefs.get(cardId)?.effect.type === "bonus_chit";
      const discardPile = isBonus ? state.player.discardPile : [...state.player.discardPile, cardId];
      let s: GameState = { ...state, player: { ...state.player, hand, discardPile } };
      const name = state.cardDefs.get(cardId)?.name ?? cardId;
      if (cmd.bonus === "move1") {
        s = log(
          s,
          isBonus ? `Bonus Card destroyed — bonus move (1 space).` : `Discarded ${name} for a bonus move (1 space).`,
        );
        return noHits({
          ...s,
          pending: { kind: "discard_move1", maxRange: 1, fromQuickstep: false },
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
              ...state.player,
              hand,
              discardPile: [...state.player.discardPile, cardId],
              suppressNextMove: false,
            },
            pending: null,
          };
          return noHits(log(s, "The axe's weight cancels your move — card spent, you stay put."));
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
        );
        if (!reach.has(keyOf(dest))) return noHits(state);
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        let s: GameState = {
          ...state,
          player: {
            ...state.player,
            x: dest.x,
            y: dest.y,
            hand,
            discardPile,
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
                  ...state.player,
                  hand,
                  discardPile: [...state.player.discardPile, cardId],
                  suppressNextMove: false,
                },
                pending: null,
              },
              "The axe's weight cancels your move — Card Seeker spent, you stay put.",
            ),
          );
        }
        const occ = occupiedForPlayerMove(state);
        const reach = reachableOrthogonal(
          state.tiles,
          state.width,
          state.height,
          from,
          1,
          occ,
          rockKeySet(state),
        );
        if (!reach.has(keyOf(dest))) return noHits(state);
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        const nm = state.cardDefs.get(cardId)?.name ?? cardId;
        let s: GameState = {
          ...state,
          player: { ...state.player, x: dest.x, y: dest.y, hand, discardPile },
          pending: null,
        };
        s = revealAtPlayer(s);
        s = log(s, `Played ${nm} — moved 1.`);
        s = resolvePlayerEnterTile(s, dest.x, dest.y);
        s = spawnGroundCardLootInDiscovered(s, 2);
        return noHits(s);
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
        const reach = reachableOrthogonal(
          state.tiles,
          state.width,
          state.height,
          from,
          dm.maxRange,
          occ,
          rockKeySet(state),
        );
        if (!reach.has(keyOf(dest))) return noHits(state);
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
            ? "Quickstep — moved (Sprinter bonus range)."
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
        const reach = reachableOrthogonal(
          state.tiles,
          state.width,
          state.height,
          from,
          1,
          occ,
          rockKeySet(state),
        );
        if (!reach.has(keyOf(dest))) return noHits(state);
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

      return noHits(state);
    }

    case "CONFIRM_TARGET_MONSTER": {
      if (!state.pending) return noHits(state);
      const mid = cmd.monsterInstanceId;
      const mon = state.monsters.find((m) => m.id === mid && m.hp > 0);
      if (!mon) return noHits(state);
      if (state.fogOfWar && !state.discovered.has(keyOf(mon))) return noHits(state);

      if (state.pending.kind === "play_melee") {
        const p = state.pending;
        if (manhattan({ x: state.player.x, y: state.player.y }, mon) !== 1) return noHits(state);
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        const raw = weaponAttackRollRaw(state, cardId, p.minDamage, p.maxDamage);
        const def = state.monsterDefs.get(mon.defId);
        const defVal = monsterDefenseForIncoming(mon, def);
        const dmg = applyDefense(raw, defVal);
        const hp = Math.max(0, mon.hp - dmg);
        const monsters = state.monsters.map((m) => (m.id === mon.id ? { ...m, hp } : m));
        let s = log(
          { ...state, player: { ...state.player, hand, discardPile }, monsters, pending: null },
          `You strike for ${dmg} damage.`,
        );
        if (hp <= 0) {
          s = log(s, `${def?.name ?? "Enemy"} defeated.`);
          s = applyMonsterKillRewards(s, mon.defId);
        }
        let kbPending = state.player.knockbackPrimed;
        s = { ...s, player: { ...s.player, knockbackPrimed: false } };
        if (kbPending && hp > 0) {
          const cur = s.monsters.find((m) => m.id === mon.id && m.hp > 0);
          if (cur) s = tryKnockMonsterFromPlayer(s, cur);
        }
        return withHits(s, [{ gridX: mon.x, gridY: mon.y, damage: dmg }]);
      }

      if (state.pending.kind === "play_spear") {
        const p = state.pending;
        const P: Point = { x: state.player.x, y: state.player.y };
        const d = manhattan(P, mon);
        if (d !== 1 && d !== 2) return noHits(state);
        const dx = Math.sign(mon.x - P.x);
        const dy = Math.sign(mon.y - P.y);
        if (dx !== 0 && dy !== 0) return noHits(state);

        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        let s: GameState = {
          ...state,
          player: { ...state.player, hand, discardPile },
          pending: null,
        };

        const raw = weaponAttackRollRaw(state, cardId, p.minDamage, p.maxDamage);
        const hits: HitVisual[] = [];
        let kbPending = state.player.knockbackPrimed;

        const strike = (target: MonsterInstance) => {
          const mdef = s.monsterDefs.get(target.defId);
          const dmg = applyDefense(raw, monsterDefenseForIncoming(target, mdef));
          const hp = Math.max(0, target.hp - dmg);
          s = { ...s, monsters: s.monsters.map((m) => (m.id === target.id ? { ...m, hp } : m)) };
          hits.push({ gridX: target.x, gridY: target.y, damage: dmg });
          if (hp <= 0) {
            s = log(s, `${mdef?.name ?? "Enemy"} defeated.`);
            s = applyMonsterKillRewards(s, target.defId);
          }
          if (kbPending) {
            kbPending = false;
            s = { ...s, player: { ...s.player, knockbackPrimed: false } };
            if (hp > 0) {
              const cur = s.monsters.find((m) => m.id === target.id && m.hp > 0);
              if (cur) s = tryKnockMonsterFromPlayer(s, cur);
            }
          }
        };

        strike(mon);

        const m2pos = { x: mon.x + dx, y: mon.y + dy };
        const m2 = s.monsters.find((m) => m.hp > 0 && m.x === m2pos.x && m.y === m2pos.y);
        if (m2) strike(m2);

        s = log(s, m2 ? "The spear pierces the line!" : "You thrust with the spear.");
        return withHits(s, hits);
      }

      if (state.pending.kind === "play_knife") {
        const p = state.pending;
        if (manhattan({ x: state.player.x, y: state.player.y }, mon) !== 1) return noHits(state);
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        const raw = weaponAttackRollRaw(state, cardId, p.minDamage, p.maxDamage);
        const defM = state.monsterDefs.get(mon.defId);
        const dmg = applyDefense(raw, monsterDefenseForIncoming(mon, defM));
        const hp = Math.max(0, mon.hp - dmg);
        const monsters = state.monsters.map((m) => (m.id === mon.id ? { ...m, hp } : m));
        let s = log(
          { ...state, player: { ...state.player, hand, discardPile }, monsters, pending: null },
          `Knife for ${dmg} damage.`,
        );
        if (hp <= 0) {
          s = log(s, `${defM?.name ?? "Enemy"} defeated.`);
          s = applyMonsterKillRewards(s, mon.defId);
        }
        let kbPending = state.player.knockbackPrimed;
        s = { ...s, player: { ...s.player, knockbackPrimed: false } };
        if (kbPending && hp > 0) {
          const cur = s.monsters.find((m) => m.id === mon.id && m.hp > 0);
          if (cur) s = tryKnockMonsterFromPlayer(s, cur);
        }
        s = drawFromPlayerDeck(s, 1);
        s = log(s, "You draw a card.");
        return withHits(s, [{ gridX: mon.x, gridY: mon.y, damage: dmg }]);
      }

      if (state.pending.kind === "play_axe") {
        const p = state.pending;
        if (manhattan({ x: state.player.x, y: state.player.y }, mon) !== 1) return noHits(state);
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        const raw = weaponAttackRollRaw(state, cardId, p.minDamage, p.maxDamage);
        const defM = state.monsterDefs.get(mon.defId);
        const dmg = applyDefense(raw, monsterDefenseForIncoming(mon, defM));
        const hp = Math.max(0, mon.hp - dmg);
        const monsters = state.monsters.map((m) => (m.id === mon.id ? { ...m, hp } : m));
        let s = log(
          {
            ...state,
            player: {
              ...state.player,
              hand,
              discardPile,
              suppressNextMove: true,
            },
            monsters,
            pending: null,
          },
          `Axe cleaves for ${dmg} damage — your next move will fail.`,
        );
        if (hp <= 0) {
          s = log(s, `${defM?.name ?? "Enemy"} defeated.`);
          s = applyMonsterKillRewards(s, mon.defId);
        }
        let kbPending = state.player.knockbackPrimed;
        s = { ...s, player: { ...s.player, knockbackPrimed: false } };
        if (kbPending && hp > 0) {
          const cur = s.monsters.find((m) => m.id === mon.id && m.hp > 0);
          if (cur) s = tryKnockMonsterFromPlayer(s, cur);
        }
        return withHits(s, [{ gridX: mon.x, gridY: mon.y, damage: dmg }]);
      }

      if (state.pending.kind === "play_magic_missile") {
        const p = state.pending;
        const from: Point = { x: state.player.x, y: state.player.y };
        if (!magicMissilePathClear(state.tiles, state.monsters, from, mon)) return noHits(state);
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        const dmg = magicAttackRollRaw(state, cardId, p.minDamage, p.maxDamage);
        const defM = state.monsterDefs.get(mon.defId);
        const hp = Math.max(0, mon.hp - dmg);
        const monsters = state.monsters.map((m) => (m.id === mon.id ? { ...m, hp } : m));
        let s = log(
          {
            ...state,
            player: { ...state.player, hand, discardPile },
            monsters,
            pending: null,
          },
          `Magic Missile hits for ${dmg} (ignores defense).`,
        );
        if (hp <= 0) {
          s = log(s, `${defM?.name ?? "Enemy"} defeated.`);
          s = applyMonsterKillRewards(s, mon.defId);
        }
        return withHits(s, [{ gridX: mon.x, gridY: mon.y, damage: dmg }]);
      }

      if (state.pending.kind === "discard_punch") {
        if (manhattan({ x: state.player.x, y: state.player.y }, mon) !== 1) return noHits(state);
        const defM = state.monsterDefs.get(mon.defId);
        const defVal = monsterDefenseForIncoming(mon, defM);
        const strikes = state.player.doublePunchThisTurn ? 2 : 1;
        let s: GameState = { ...state, pending: null };
        const hits: HitVisual[] = [];
        const dmgParts: number[] = [];
        for (let i = 0; i < strikes; i++) {
          const cur = s.monsters.find((m) => m.id === mon.id && m.hp > 0);
          if (!cur) break;
          const raw = rollInt(1, 2) + attackStrengthBonus(s) + heavyPunchBonus(s);
          const dmg = applyDefense(raw, defVal);
          const hp = Math.max(0, cur.hp - dmg);
          s = { ...s, monsters: s.monsters.map((m) => (m.id === mon.id ? { ...m, hp } : m)) };
          hits.push({ gridX: cur.x, gridY: cur.y, damage: dmg });
          dmgParts.push(dmg);
          if (hp <= 0) {
            s = log(s, `${defM?.name ?? "Enemy"} defeated.`);
            s = applyMonsterKillRewards(s, mon.defId);
            break;
          }
        }
        let msg: string;
        if (strikes === 2 && dmgParts.length === 2) {
          msg = `Double punch — ${dmgParts[0]} and ${dmgParts[1]} damage.`;
        } else if (strikes === 2 && dmgParts.length === 1) {
          msg = `Double punch — ${dmgParts[0]} damage.`;
        } else {
          msg = `Punch for ${dmgParts[0]!} damage.`;
        }
        s = log(s, msg);
        let kbPending = state.player.knockbackPrimed;
        s = { ...s, player: { ...s.player, knockbackPrimed: false } };
        if (kbPending) {
          const live = s.monsters.find((m) => m.id === mon.id && m.hp > 0);
          if (live) s = tryKnockMonsterFromPlayer(s, live);
        }
        return withHits(s, hits);
      }

      return noHits(state);
    }

    case "CONFIRM_TARGET_POT": {
      if (!state.pending) return noHits(state);
      const pot = state.pots.find((p) => p.id === cmd.potId);
      if (!pot) return noHits(state);
      if (state.fogOfWar && !state.discovered.has(keyOf(pot))) return noHits(state);
      const P: Point = { x: state.player.x, y: state.player.y };

      if (state.pending.kind === "play_melee") {
        const pv = state.pending;
        if (manhattan(P, pot) !== 1) return noHits(state);
        const hand = [...state.player.hand];
        const cardId = hand[pv.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(pv.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        let s: GameState = {
          ...state,
          player: { ...state.player, hand, discardPile },
          pending: null,
        };
        s = log(s, "You shatter the pot with your strike.");
        s = breakPotFromAttack(s, pot.x, pot.y);
        return withHits(s, [{ gridX: pot.x, gridY: pot.y, damage: 1 }]);
      }

      if (state.pending.kind === "play_spear") {
        const p = state.pending;
        const d = manhattan(P, pot);
        if (d !== 1 && d !== 2) return noHits(state);
        const dx = Math.sign(pot.x - P.x);
        const dy = Math.sign(pot.y - P.y);
        if (dx !== 0 && dy !== 0) return noHits(state);
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        let s: GameState = {
          ...state,
          player: { ...state.player, hand, discardPile },
          pending: null,
        };
        s = log(s, "Your spear splinters the pot.");
        s = breakPotFromAttack(s, pot.x, pot.y);
        return withHits(s, [{ gridX: pot.x, gridY: pot.y, damage: 1 }]);
      }

      if (state.pending.kind === "play_knife") {
        const p = state.pending;
        if (manhattan(P, pot) !== 1) return noHits(state);
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        let s: GameState = {
          ...state,
          player: { ...state.player, hand, discardPile },
          pending: null,
        };
        s = log(s, "You stab the pot.");
        s = breakPotFromAttack(s, pot.x, pot.y);
        s = drawFromPlayerDeck(s, 1);
        s = log(s, "You draw a card.");
        return withHits(s, [{ gridX: pot.x, gridY: pot.y, damage: 1 }]);
      }

      if (state.pending.kind === "play_axe") {
        const p = state.pending;
        if (manhattan(P, pot) !== 1) return noHits(state);
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        let s: GameState = {
          ...state,
          player: {
            ...state.player,
            hand,
            discardPile,
            suppressNextMove: true,
          },
          pending: null,
        };
        s = log(s, "The axe smashes the pot — your next move will fail.");
        s = breakPotFromAttack(s, pot.x, pot.y);
        return withHits(s, [{ gridX: pot.x, gridY: pot.y, damage: 1 }]);
      }

      if (state.pending.kind === "play_magic_missile") {
        const p = state.pending;
        if (
          !magicMissilePathClearToPoint(
            state.tiles,
            state.monsters,
            state.pots,
            P,
            pot.x,
            pot.y,
          )
        ) {
          return noHits(state);
        }
        const hand = [...state.player.hand];
        const cardId = hand[p.cardHandIndex];
        if (!cardId) return noHits(state);
        hand.splice(p.cardHandIndex, 1);
        const discardPile = [...state.player.discardPile, cardId];
        let s: GameState = {
          ...state,
          player: { ...state.player, hand, discardPile },
          pending: null,
        };
        s = log(s, "Magic Missile shatters the pot.");
        s = breakPotFromAttack(s, pot.x, pot.y);
        return withHits(s, [{ gridX: pot.x, gridY: pot.y, damage: 1 }]);
      }

      if (state.pending.kind === "discard_punch") {
        if (manhattan(P, pot) !== 1) return noHits(state);
        let s: GameState = { ...state, pending: null };
        s = log(s, "You punch the pot apart.");
        s = breakPotFromAttack(s, pot.x, pot.y);
        return withHits(s, [{ gridX: pot.x, gridY: pot.y, damage: 1 }]);
      }

      return noHits(state);
    }

    case "USE_BREAD": {
      if (state.phase !== "player" || state.pending) return noHits(state);
      if (state.player.bread <= 0) return noHits(log(state, "You have no bread."));
      if (state.player.hp >= state.player.maxHp) {
        return noHits(log(state, "You're not hungry."));
      }
      let heal = Math.floor(state.player.maxHp * 0.2);
      if (heal < 1) heal = 1;
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
              knockbackPrimed: true,
            },
          },
          "Knockback primed — your next weapon hit may push the enemy back.",
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
      s = ensureEquippedOnDeckTop(s);
      let dungeonHits: HitVisual[] = [];
      if (!s.gauntletCommenced) {
        const drawn = drawDungeonTop(s);
        s = drawn.state;
        dungeonHits = drawn.hits;
      }
      if (s.phase === "defeat") return { state: s, hits: dungeonHits };
      const { state: afterMon, hits: monHits } = runMonsterPhase(s);
      if (afterMon.phase === "defeat") return { state: afterMon, hits: [...dungeonHits, ...monHits] };
      const cleared = processGauntletVictory(afterMon);
      if (cleared.phase === "peace") {
        return { state: cleared, hits: [...dungeonHits, ...monHits] };
      }
      return { state: beginNextPlayerTurn(cleared), hits: [...dungeonHits, ...monHits] };
    }

    case "UNLOCK_SKILL":
      return unlockSkillDispatch(state, cmd.skillId);

    default:
      return noHits(state);
  }
}

export function dispatch(state: GameState, cmd: GameCommand): DispatchResult {
  const r = dispatchCore(state, cmd);
  return { state: processGauntletVictory(r.state), hits: r.hits };
}
