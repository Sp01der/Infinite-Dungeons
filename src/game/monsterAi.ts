import { applyDefense, monsterDamageBonus, monsterMaxHp, rollInt } from "../engine/combat";
import { keyOf, magicMissilePathClearToPlayer, tileAt, chebyshev } from "../engine/grid";
import { manhattan } from "../engine/movement";
import { cullMonstersWithDouvlonPairs, setMonsterHpWithDouvlonSync } from "./douvlon";
import { addExp } from "./progression";
import { SHADE_DECK_TEMPLATE } from "./monsterSpawn";
import { incomingDamageToPlayer } from "./skillsRuntime";
import type { GameState, HitVisual, MonsterInstance, Point, SkeletonWeapon, TangleweedPropInstance } from "./types";

const ORTHO: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const ALL8: Point[] = [
  ...ORTHO,
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export type MonsterPhaseHooks = {
  resolvePlayerEnter: (s: GameState, x: number, y: number) => GameState;
  breakPotMonster: (s: GameState, x: number, y: number) => GameState;
};

function appendLog(state: GameState, line: string): GameState {
  return { ...state, log: [...state.log.slice(-50), line] };
}

function occupiedByMonsters(state: GameState): Set<string> {
  const s = new Set<string>();
  for (const m of state.monsters) {
    if (m.hp > 0) s.add(keyOf(m));
  }
  return s;
}

function bridgeKeySet(s: GameState): Set<string> {
  return new Set(s.bridgeTiles.map(keyOf));
}

/** Walkable tile for this monster (land vs aquatic). */
export function monsterTilePassable(s: GameState, m: MonsterInstance, p: Point): boolean {
  const t = tileAt(s.tiles, p);
  if (m.aquatic) return t === "water";
  if (t === "floor") return true;
  if (t === "water" && bridgeKeySet(s).has(keyOf(p))) return true;
  return false;
}

function movementOcc(s: GameState, excludeMonsterId: string): Set<string> {
  const occ = new Set<string>();
  for (const m of s.monsters) {
    if (m.hp <= 0 || m.id === excludeMonsterId) continue;
    occ.add(keyOf(m));
  }
  occ.add(keyOf({ x: s.player.x, y: s.player.y }));
  for (const r of s.rocks) occ.add(keyOf(r));
  for (const tw of s.tangleweeds) {
    if (tw.hp > 0) occ.add(keyOf(tw));
  }
  return occ;
}

function playerInSlimePlusRange(slime: Point, p: Point): boolean {
  const dx = p.x - slime.x;
  const dy = p.y - slime.y;
  if (dx !== 0 && dy !== 0) return false;
  const d = Math.abs(dx) + Math.abs(dy);
  return d >= 1 && d <= 2;
}

function bestOrthoToward(s: GameState, m: MonsterInstance, occ: Set<string>): Point | null {
  const playerPos: Point = { x: s.player.x, y: s.player.y };
  let best: Point | null = null;
  let bestDist = Infinity;
  for (const o of ORTHO) {
    const np = { x: m.x + o.x, y: m.y + o.y };
    if (occ.has(keyOf(np)) || !monsterTilePassable(s, m, np)) continue;
    const d = manhattan(np, playerPos);
    if (d < bestDist) {
      bestDist = d;
      best = np;
    }
  }
  return best;
}

function bestOrthoAway(s: GameState, m: MonsterInstance, occ: Set<string>): Point | null {
  const playerPos: Point = { x: s.player.x, y: s.player.y };
  let best: Point | null = null;
  let bestDist = -1;
  for (const o of ORTHO) {
    const np = { x: m.x + o.x, y: m.y + o.y };
    if (occ.has(keyOf(np)) || !monsterTilePassable(s, m, np)) continue;
    const d = manhattan(np, playerPos);
    if (d > bestDist) {
      bestDist = d;
      best = np;
    }
  }
  return best;
}

function best8Toward(s: GameState, m: MonsterInstance, occ: Set<string>): Point | null {
  const playerPos: Point = { x: s.player.x, y: s.player.y };
  let best: Point | null = null;
  let bestDist = Infinity;
  for (const o of ALL8) {
    const np = { x: m.x + o.x, y: m.y + o.y };
    if (occ.has(keyOf(np)) || !monsterTilePassable(s, m, np)) continue;
    const d = chebyshev(np, playerPos);
    if (d < bestDist) {
      bestDist = d;
      best = np;
    }
  }
  return best;
}

function best8Away(s: GameState, m: MonsterInstance, occ: Set<string>): Point | null {
  const playerPos: Point = { x: s.player.x, y: s.player.y };
  let best: Point | null = null;
  let bestDist = -1;
  for (const o of ALL8) {
    const np = { x: m.x + o.x, y: m.y + o.y };
    if (occ.has(keyOf(np)) || !monsterTilePassable(s, m, np)) continue;
    const d = chebyshev(np, playerPos);
    if (d > bestDist) {
      bestDist = d;
      best = np;
    }
  }
  return best;
}

function playerOnOpenSegmentBetween(red: Point, blue: Point, p: Point): boolean {
  if (red.x === blue.x && red.x === p.x) {
    const lo = Math.min(red.y, blue.y);
    const hi = Math.max(red.y, blue.y);
    return p.y > lo && p.y < hi;
  }
  if (red.y === blue.y && red.y === p.y) {
    const lo = Math.min(red.x, blue.x);
    const hi = Math.max(red.x, blue.x);
    return p.x > lo && p.x < hi;
  }
  const drx = blue.x - red.x;
  const dry = blue.y - red.y;
  if (drx === 0 || dry === 0) return false;
  if (Math.abs(drx) !== Math.abs(dry)) return false;
  const dpx = p.x - red.x;
  const dpy = p.y - red.y;
  if (dpx === 0 && dpy === 0) return false;
  if (Math.sign(drx) !== Math.sign(dpx) || Math.sign(dry) !== Math.sign(dpy)) return false;
  if (Math.abs(dpx) !== Math.abs(dpy)) return false;
  const tr = Math.abs(drx);
  const tp = Math.abs(dpx);
  return tp > 0 && tp < tr;
}

function monsterKillRewards(state: GameState, defId: string): GameState {
  const power = state.monsterDefs.get(defId)?.power ?? 3;
  const withGold = { ...state, player: { ...state.player, gold: state.player.gold + 2 } };
  return addExp(withGold, power);
}

function best8Align(s: GameState, m: MonsterInstance, occ: Set<string>): Point | null {
  const px = s.player.x;
  const py = s.player.y;
  let best: Point | null = null;
  let bestScore = Infinity;
  for (const o of ALL8) {
    const np = { x: m.x + o.x, y: m.y + o.y };
    if (occ.has(keyOf(np)) || tileAt(s.tiles, np) !== "floor") continue;
    const dx = px - np.x;
    const dy = py - np.y;
    const aligned = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    const score = aligned ? 0 : Math.abs(dx) + Math.abs(dy);
    if (score < bestScore) {
      bestScore = score;
      best = np;
    }
  }
  return best;
}

function damagePlayer(
  s: GameState,
  raw: number,
  monName: string,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  const dmg = incomingDamageToPlayer(s, raw);
  const px = s.player.x;
  const py = s.player.y;
  const hp = Math.max(0, s.player.hp - dmg);
  hits.push({ gridX: px, gridY: py, damage: dmg });
  let next = appendLog(s, `${monName} hits you for ${dmg}.`);
  next = { ...next, player: { ...next.player, hp } };
  return { state: next, dead: hp <= 0 };
}

function skeletonCanHit(w: SkeletonWeapon, mon: Point, p: Point, movedThisTurn: boolean): boolean {
  if (w === "axe" && movedThisTurn) return false;
  const dx = p.x - mon.x;
  const dy = p.y - mon.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  switch (w) {
    case "sword":
    case "axe":
      return adx + ady === 1;
    case "spear":
      if (dx !== 0 && dy !== 0) return false;
      return adx + ady === 1 || adx + ady === 2;
    case "scimitar":
      return adx === 1 && ady === 1;
    default:
      return false;
  }
}

function skeletonRollDamage(w: SkeletonWeapon, bonus: number): number {
  switch (w) {
    case "sword":
      return rollInt(2, 4) + bonus;
    case "spear":
      return rollInt(2, 3) + bonus;
    case "axe":
      return rollInt(3, 6) + bonus;
    case "scimitar":
      return rollInt(2, 5) + bonus;
  }
}

function knockCellFree(s: GameState, x: number, y: number, excludeIds: Set<string>): boolean {
  if (tileAt(s.tiles, { x, y }) !== "floor") return false;
  if (s.rocks.some((r) => r.x === x && r.y === y)) return false;
  if (s.player.x === x && s.player.y === y) return false;
  for (const m of s.monsters) {
    if (m.hp <= 0 || excludeIds.has(m.id)) continue;
    if (m.x === x && m.y === y) return false;
  }
  return true;
}

function applySlimeLeap(
  s: GameState,
  m: MonsterInstance,
  target: Point,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): GameState {
  const dx = Math.sign(target.x - m.x) || 0;
  const dy = Math.sign(target.y - m.y) || 0;
  const dmgRaw = rollInt(2, 4) + monsterDamageBonus(m.level);
  const monName = s.monsterDefs.get(m.defId)?.name ?? "Slime";
  let next = s;

  const atPlayer = s.player.x === target.x && s.player.y === target.y;
  const victimMon = s.monsters.find(
    (x) => x.hp > 0 && x.id !== m.id && x.x === target.x && x.y === target.y,
  );

  if (atPlayer) {
    const r = damagePlayer(next, dmgRaw, monName, hits);
    next = r.state;
    if (r.dead) return next;
    const kx = target.x + dx;
    const ky = target.y + dy;
    const ex = new Set<string>([m.id]);
    if (knockCellFree(next, kx, ky, ex)) {
      next = {
        ...next,
        player: { ...next.player, x: kx, y: ky },
      };
      next = appendLog(next, "You are knocked back!");
      next = hooks.resolvePlayerEnter(next, kx, ky);
    }
  } else if (victimMon) {
    const defV = next.monsterDefs.get(victimMon.defId);
    const defVal = victimMon.defenseOverride ?? defV?.defense ?? 0;
    const dmg = applyDefense(dmgRaw, defVal);
    const nh = Math.max(0, victimMon.hp - dmg);
    hits.push({ gridX: target.x, gridY: target.y, damage: dmg });
    let monsters = setMonsterHpWithDouvlonSync(next.monsters, victimMon.id, nh);
    if (nh <= 0) {
      if (victimMon.defId === "douvlon" && victimMon.douvlonPairId) {
        monsters = cullMonstersWithDouvlonPairs(monsters);
        next = appendLog({ ...next, monsters }, `${defV?.name ?? "Douvlon"} pair defeated.`);
        next = monsterKillRewards(next, victimMon.defId);
      } else {
        monsters = monsters.filter((x) => x.hp > 0);
        next = appendLog({ ...next, monsters }, `${defV?.name ?? "Monster"} defeated.`);
      }
    } else {
      monsters = cullMonstersWithDouvlonPairs(monsters);
      next = { ...next, monsters };
      const kx = target.x + dx;
      const ky = target.y + dy;
      const ex = new Set<string>([m.id, victimMon.id]);
      if (knockCellFree(next, kx, ky, ex)) {
        next = {
          ...next,
          monsters: next.monsters.map((x) =>
            x.id === victimMon.id ? { ...x, x: kx, y: ky } : x,
          ),
        };
      }
    }
  }

  next = {
    ...next,
    monsters: next.monsters.map((x) =>
      x.id === m.id ? { ...x, x: target.x, y: target.y, leapTarget: null } : x,
    ),
  };
  next = hooks.breakPotMonster(next, target.x, target.y);
  next = appendLog(next, `${monName} leaps!`);
  return next;
}

function moveMonsterTo(s: GameState, m: MonsterInstance, dest: Point, hooks: MonsterPhaseHooks): GameState {
  let next = {
    ...s,
    monsters: s.monsters.map((x) => (x.id === m.id ? { ...x, x: dest.x, y: dest.y } : x)),
  };
  next = hooks.breakPotMonster(next, dest.x, dest.y);
  return next;
}

function takeSkeletonTurn(
  s: GameState,
  m: MonsterInstance,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  const w = m.skeletonWeapon ?? "sword";
  const bonus = monsterDamageBonus(m.level);
  const name = s.monsterDefs.get(m.defId)?.name ?? "Skeleton";
  const P: Point = { x: s.player.x, y: s.player.y };
  let movedThisTurn = false;
  let moveBudget = 2;
  let cur = m;

  const tryStrike = (
    state: GameState,
    mon: MonsterInstance,
    moved: boolean,
  ): { state: GameState; dead: boolean } | null => {
    if (!skeletonCanHit(w, { x: mon.x, y: mon.y }, P, moved)) return null;
    const raw = skeletonRollDamage(w, bonus);
    return damagePlayer(state, raw, name, hits);
  };

  let next = s;
  const strikeFirst = tryStrike(next, cur, movedThisTurn);
  if (strikeFirst) {
    if (strikeFirst.dead) return strikeFirst;
    next = strikeFirst.state;
    cur = next.monsters.find((x) => x.id === m.id)!;
    if (w !== "axe") {
      for (let i = 0; i < 2; i++) {
        const occ = movementOcc(next, cur.id);
        const away = bestOrthoAway(next, cur, occ);
        if (!away) break;
        next = moveMonsterTo(next, cur, away, hooks);
        cur = next.monsters.find((x) => x.id === m.id)!;
      }
    }
    return { state: next, dead: false };
  }

  while (moveBudget > 0) {
    const occ = movementOcc(next, cur.id);
    const toward = bestOrthoToward(next, cur, occ);
    if (!toward) break;
    next = moveMonsterTo(next, cur, toward, hooks);
    cur = next.monsters.find((x) => x.id === m.id)!;
    moveBudget -= 1;
    movedThisTurn = true;
    if (w !== "axe") {
      const st = tryStrike(next, cur, movedThisTurn);
      if (st) {
        if (st.dead) return st;
        next = st.state;
        cur = next.monsters.find((x) => x.id === m.id)!;
        while (moveBudget > 0) {
          const occ2 = movementOcc(next, cur.id);
          const away = bestOrthoAway(next, cur, occ2);
          if (!away) break;
          next = moveMonsterTo(next, cur, away, hooks);
          cur = next.monsters.find((x) => x.id === m.id)!;
          moveBudget -= 1;
        }
        return { state: next, dead: false };
      }
    }
  }
  return { state: next, dead: false };
}

function takeMysticTurn(
  s: GameState,
  m: MonsterInstance,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  const name = s.monsterDefs.get(m.defId)?.name ?? "Mystic Core";
  const P: Point = { x: s.player.x, y: s.player.y };
  const mp: Point = { x: m.x, y: m.y };
  let next = s;

  if (chebyshev(mp, P) <= 1) {
    const occ = movementOcc(next, m.id);
    const away = best8Away(next, m, occ) ?? best8Toward(next, m, occ);
    if (away) {
      next = {
        ...next,
        monsters: next.monsters.map((x) => (x.id === m.id ? { ...x, x: away.x, y: away.y } : x)),
      };
    }
    return { state: next, dead: false };
  }

  if (
    magicMissilePathClearToPlayer(next.tiles, next.monsters, mp, P, m.id)
  ) {
    const raw = rollInt(1, 6) + monsterDamageBonus(m.level);
    const px = next.player.x;
    const py = next.player.y;
    const hp = Math.max(0, next.player.hp - raw);
    hits.push({ gridX: px, gridY: py, damage: raw });
    next = appendLog(next, `${name} magic missile hits you for ${raw} (ignores defense).`);
    next = { ...next, player: { ...next.player, hp } };
    return { state: next, dead: hp <= 0 };
  }

  const occ = movementOcc(next, m.id);
  const step = best8Align(next, m, occ) ?? best8Toward(next, m, occ);
  if (step) {
    next = {
      ...next,
      monsters: next.monsters.map((x) => (x.id === m.id ? { ...x, x: step.x, y: step.y } : x)),
    };
  }
  return { state: next, dead: false };
}

function takeDustRatTurn(
  s: GameState,
  curMon: MonsterInstance,
  playerPos: Point,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  const nm = s.monsterDefs.get(curMon.defId)?.name ?? "Dust Rat";

  const tryAttack = (
    state: GameState,
    mon: MonsterInstance,
  ): { state: GameState; dead: boolean } | null => {
    if (manhattan({ x: mon.x, y: mon.y }, playerPos) !== 1) return null;
    const raw = rollInt(1, 3) + monsterDamageBonus(mon.level);
    return damagePlayer(state, raw, nm, hits);
  };

  const tryMove = (state: GameState, mon: MonsterInstance): GameState => {
    const occ = movementOcc(state, mon.id);
    const step = bestOrthoToward(state, mon, occ);
    if (!step) return state;
    return moveMonsterTo(state, mon, step, hooks);
  };

  let next = s;
  let mon = curMon;
  const startAdjacent = manhattan({ x: mon.x, y: mon.y }, playerPos) === 1;

  if (!startAdjacent) {
    next = tryMove(next, mon);
    mon = next.monsters.find((x) => x.id === curMon.id)!;
    const atk = tryAttack(next, mon);
    if (atk) {
      if (atk.dead) return atk;
      next = atk.state;
    }
    return { state: next, dead: false };
  }

  const moveFirst = Math.random() < 0.5;
  if (moveFirst) {
    next = tryMove(next, mon);
    mon = next.monsters.find((x) => x.id === curMon.id)!;
    const atk = tryAttack(next, mon);
    if (atk) {
      if (atk.dead) return atk;
      next = atk.state;
    }
  } else {
    const atk = tryAttack(next, mon);
    if (atk) {
      if (atk.dead) return atk;
      next = atk.state;
    }
    mon = next.monsters.find((x) => x.id === curMon.id)!;
    next = tryMove(next, mon);
  }

  return { state: next, dead: false };
}

function takeSkeletonArcherTurn(
  s: GameState,
  m: MonsterInstance,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  const bonus = monsterDamageBonus(m.level);
  const name = s.monsterDefs.get(m.defId)?.name ?? "Skeleton Archer";
  const P: Point = { x: s.player.x, y: s.player.y };
  let next = s;
  let cur = m;
  const mp: Point = { x: cur.x, y: cur.y };

  // Orthogonal or diagonal neighbor: back off before bow logic (orthogonal moves).
  if (chebyshev(mp, P) <= 1) {
    let budget = 2;
    while (budget > 0) {
      cur = next.monsters.find((x) => x.id === m.id)!;
      if (!cur || chebyshev({ x: cur.x, y: cur.y }, P) > 1) break;
      const occ = movementOcc(next, cur.id);
      const away = bestOrthoAway(next, cur, occ);
      if (!away) break;
      next = moveMonsterTo(next, cur, away, hooks);
      budget -= 1;
    }
    return { state: next, dead: false };
  }

  // In bow range (Manhattan "radius" + clear queen-line shot) but not adjacent.
  if (
    manhattan(mp, P) <= 6 &&
    magicMissilePathClearToPlayer(next.tiles, next.monsters, mp, P, cur.id)
  ) {
    if (cur.bowLoaded) {
      const raw = rollInt(2, 4) + bonus;
      const d = damagePlayer(next, raw, name, hits);
      if (d.dead) return d;
      next = d.state;
      next = {
        ...next,
        monsters: next.monsters.map((x) =>
          x.id === m.id ? { ...x, bowLoaded: false } : x,
        ),
      };
    } else {
      next = {
        ...next,
        monsters: next.monsters.map((x) =>
          x.id === m.id ? { ...x, bowLoaded: true } : x,
        ),
      };
      next = appendLog(next, `${name} loads the bow.`);
    }
    return { state: next, dead: false };
  }

  let moveBudget = 2;
  while (moveBudget > 0) {
    cur = next.monsters.find((x) => x.id === m.id)!;
    const occ = movementOcc(next, cur.id);
    const toward = bestOrthoToward(next, cur, occ);
    if (!toward) break;
    next = moveMonsterTo(next, cur, toward, hooks);
    moveBudget -= 1;
  }
  return { state: next, dead: false };
}

function takeShadowRodentTurn(
  s: GameState,
  curMon: MonsterInstance,
  playerPos: Point,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  const nm = s.monsterDefs.get(curMon.defId)?.name ?? "Shadow Rodent";
  const P = playerPos;
  const bonus = monsterDamageBonus(curMon.level);

  const distToPlayer = (mon: MonsterInstance): number =>
    manhattan({ x: mon.x, y: mon.y }, P);

  const tryAttack = (
    state: GameState,
    mon: MonsterInstance,
  ): { state: GameState; dead: boolean } | null => {
    if (distToPlayer(mon) !== 1) return null;
    const raw = rollInt(2, 4) + bonus;
    return damagePlayer(state, raw, nm, hits);
  };

  const tryMove = (state: GameState, mon: MonsterInstance): GameState => {
    const occ = movementOcc(state, mon.id);
    const step = bestOrthoToward(state, mon, occ);
    if (!step) return state;
    return moveMonsterTo(state, mon, step, hooks);
  };

  const tryMoveAway = (state: GameState, mon: MonsterInstance): GameState => {
    const occ = movementOcc(state, mon.id);
    const step = bestOrthoAway(state, mon, occ);
    if (!step) return state;
    return moveMonsterTo(state, mon, step, hooks);
  };

  let next = s;
  let mon = curMon;
  let movesLeft = 2;
  let attacked = false;

  while (movesLeft > 0 && distToPlayer(mon) > 1) {
    next = tryMove(next, mon);
    mon = next.monsters.find((x) => x.id === curMon.id)!;
    if (!mon) return { state: next, dead: false };
    movesLeft -= 1;
  }

  if (distToPlayer(mon) === 1) {
    const atk = tryAttack(next, mon);
    if (atk) {
      if (atk.dead) return atk;
      next = atk.state;
      attacked = true;
    }
    mon = next.monsters.find((x) => x.id === curMon.id)!;
  }

  while (movesLeft > 0 && attacked) {
    if (!mon) break;
    next = tryMoveAway(next, mon);
    mon = next.monsters.find((x) => x.id === curMon.id)!;
    movesLeft -= 1;
  }

  return { state: next, dead: false };
}

/** Weapons sorted by minimum damage descending: axe (3) first, then all min-2 weapons. */
const ELITE_WEAPON_PRIORITY: SkeletonWeapon[] = ["axe", "scimitar", "sword", "spear"];

function bestEliteWeaponToHit(
  monPos: Point,
  P: Point,
  movedThisTurn: boolean,
): SkeletonWeapon | null {
  for (const w of ELITE_WEAPON_PRIORITY) {
    if (skeletonCanHit(w, monPos, P, movedThisTurn)) return w;
  }
  return null;
}

function takeEliteSkeletonTurn(
  s: GameState,
  m: MonsterInstance,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  const bonus = monsterDamageBonus(m.level);
  const name = s.monsterDefs.get(m.defId)?.name ?? "Elite Skeleton";
  const P: Point = { x: s.player.x, y: s.player.y };
  let movedThisTurn = false;
  let moveBudget = 3;
  let cur = m;
  let next = s;

  // Phase 1: attack in place if any weapon is already in range
  const wInPlace = bestEliteWeaponToHit({ x: cur.x, y: cur.y }, P, false);
  if (wInPlace) {
    const raw = skeletonRollDamage(wInPlace, bonus);
    const d = damagePlayer(next, raw, name, hits);
    if (d.dead) return d;
    next = d.state;
    cur = next.monsters.find((x) => x.id === m.id)!;
    // Back off using remaining move budget
    for (let i = 0; i < 3; i++) {
      cur = next.monsters.find((x) => x.id === m.id)!;
      if (!cur) break;
      const occ = movementOcc(next, cur.id);
      const away = bestOrthoAway(next, cur, occ);
      if (!away) break;
      next = moveMonsterTo(next, cur, away, hooks);
    }
    return { state: next, dead: false };
  }

  // Phase 2: move up to 3 steps toward player; strike with best available weapon after each step
  while (moveBudget > 0) {
    cur = next.monsters.find((x) => x.id === m.id)!;
    if (!cur) break;
    const occ = movementOcc(next, cur.id);
    const toward = bestOrthoToward(next, cur, occ);
    if (!toward) break;
    next = moveMonsterTo(next, cur, toward, hooks);
    cur = next.monsters.find((x) => x.id === m.id)!;
    moveBudget -= 1;
    movedThisTurn = true;

    const wAfterMove = bestEliteWeaponToHit({ x: cur.x, y: cur.y }, P, movedThisTurn);
    if (wAfterMove) {
      const raw = skeletonRollDamage(wAfterMove, bonus);
      const d = damagePlayer(next, raw, name, hits);
      if (d.dead) return d;
      next = d.state;
      cur = next.monsters.find((x) => x.id === m.id)!;
      // Back off remaining budget
      while (moveBudget > 0) {
        cur = next.monsters.find((x) => x.id === m.id)!;
        if (!cur) break;
        const occ2 = movementOcc(next, cur.id);
        const away = bestOrthoAway(next, cur, occ2);
        if (!away) break;
        next = moveMonsterTo(next, cur, away, hooks);
        moveBudget -= 1;
      }
      return { state: next, dead: false };
    }
  }

  return { state: next, dead: false };
}

function takeMimicTurn(
  s: GameState,
  m: MonsterInstance,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  if (m.mimicAsleep) return { state: s, dead: false };
  const name = s.monsterDefs.get(m.defId)?.name ?? "Mimic";
  const P = { x: s.player.x, y: s.player.y };
  let next = s;
  let cur: MonsterInstance | undefined = m;
  const order = Math.random() < 0.5 ? (["move", "attack"] as const) : (["attack", "move"] as const);
  for (const phase of order) {
    cur = next.monsters.find((x) => x.id === m.id && x.hp > 0);
    if (!cur) return { state: next, dead: false };
    if (phase === "attack") {
      if (chebyshev({ x: cur.x, y: cur.y }, P) <= 1) {
        const raw = rollInt(3, 4) + monsterDamageBonus(cur.level);
        const d = damagePlayer(next, raw, name, hits);
        if (d.dead) return d;
        next = d.state;
      }
    } else {
      for (let i = 0; i < 2; i++) {
        cur = next.monsters.find((x) => x.id === m.id && x.hp > 0);
        if (!cur) return { state: next, dead: false };
        const occ = movementOcc(next, cur.id);
        const step = bestOrthoToward(next, cur, occ);
        if (!step) break;
        next = moveMonsterTo(next, cur, step, hooks);
      }
    }
  }
  return { state: next, dead: false };
}

function takeDouvlonPairTurn(
  s: GameState,
  pairId: string,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  let red = s.monsters.find(
    (m) => m.douvlonPairId === pairId && m.douvlonColor === "red" && m.hp > 0,
  );
  let blue = s.monsters.find(
    (m) => m.douvlonPairId === pairId && m.douvlonColor === "blue" && m.hp > 0,
  );
  if (!red || !blue) return { state: s, dead: false };
  let next = s;

  {
    const occ = movementOcc(next, red.id);
    const step = best8Toward(next, red, occ);
    if (step) next = moveMonsterTo(next, red, step, hooks);
    red = next.monsters.find((m) => m.id === red!.id && m.hp > 0);
    if (red) {
      const P = { x: next.player.x, y: next.player.y };
      if (chebyshev({ x: red.x, y: red.y }, P) <= 1) {
        const raw = rollInt(2, 5) + monsterDamageBonus(red.level);
        const nm = next.monsterDefs.get(red.defId)?.name ?? "Douvlon";
        const d = damagePlayer(next, raw, nm, hits);
        if (d.dead) return d;
        next = d.state;
      }
    }
  }

  blue = next.monsters.find(
    (m) => m.douvlonPairId === pairId && m.douvlonColor === "blue" && m.hp > 0,
  );
  red = next.monsters.find(
    (m) => m.douvlonPairId === pairId && m.douvlonColor === "red" && m.hp > 0,
  );
  if (!blue || !red) return { state: next, dead: false };

  const P = { x: next.player.x, y: next.player.y };
  if (chebyshev({ x: blue.x, y: blue.y }, P) <= 1) {
    const occ = movementOcc(next, blue.id);
    const away = best8Away(next, blue, occ);
    if (away) next = moveMonsterTo(next, blue, away, hooks);
  } else {
    for (let i = 0; i < 2; i++) {
      blue = next.monsters.find((m) => m.id === blue!.id && m.hp > 0);
      if (!blue) return { state: next, dead: false };
      const occ = movementOcc(next, blue.id);
      const step = best8Align(next, blue, occ) ?? best8Toward(next, blue, occ);
      if (!step) break;
      next = moveMonsterTo(next, blue, step, hooks);
    }
  }

  red = next.monsters.find(
    (m) => m.douvlonPairId === pairId && m.douvlonColor === "red" && m.hp > 0,
  );
  blue = next.monsters.find(
    (m) => m.douvlonPairId === pairId && m.douvlonColor === "blue" && m.hp > 0,
  );
  if (red && blue) {
    const rp = { x: red.x, y: red.y };
    const bp = { x: blue.x, y: blue.y };
    if (playerOnOpenSegmentBetween(rp, bp, P)) {
      const d = damagePlayer(next, 5, next.monsterDefs.get(blue.defId)?.name ?? "Douvlon", hits);
      if (d.dead) return d;
      next = appendLog(d.state, "The Douvlons' line sears you!");
    }
  }
  return { state: next, dead: false };
}

function shuffleShadeDeck(arr: string[]): string[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function shadeDrawHand(
  deck: string[],
  discard: string[],
  n: number,
): { hand: string[]; deck: string[]; discard: string[] } {
  let d = [...deck];
  let dc = [...discard];
  const hand: string[] = [];
  for (let i = 0; i < n; i++) {
    if (d.length === 0) {
      if (dc.length === 0) break;
      d = shuffleShadeDeck(dc);
      dc = [];
    }
    hand.push(d.shift()!);
  }
  return { hand, deck: d, discard: dc };
}

function shadeShadowStep(
  s: GameState,
  mId: string,
  toward: boolean,
  P: Point,
): GameState {
  const cur = s.monsters.find((x) => x.id === mId);
  if (!cur) return s;
  const roomId = s.roomIds[cur.y]?.[cur.x] ?? -1;
  if (roomId < 0) return s;
  const occ = new Set(s.monsters.filter((x) => x.hp > 0 && x.id !== mId).map((x) => keyOf(x)));
  let bestScore = toward ? Infinity : -1;
  let bestTile: Point | null = null;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (s.tiles[y][x] !== "floor") continue;
      if (s.roomIds[y]?.[x] !== roomId) continue;
      if (occ.has(keyOf({ x, y }))) continue;
      if (x === cur.x && y === cur.y) continue;
      const d = manhattan({ x, y }, P);
      if (toward ? d < bestScore : d > bestScore) {
        bestScore = d;
        bestTile = { x, y };
      }
    }
  }
  if (!bestTile) return s;
  return {
    ...s,
    monsters: s.monsters.map((x) =>
      x.id === mId ? { ...x, x: bestTile!.x, y: bestTile!.y } : x,
    ),
  };
}

function takeCorruptedShadeTurn(
  s: GameState,
  m: MonsterInstance,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  const name = s.monsterDefs.get(m.defId)?.name ?? "Corrupted Shade";
  const P: Point = { x: s.player.x, y: s.player.y };
  let next = s;
  let cur = m;

  // Clear black shield at start of turn
  next = {
    ...next,
    monsters: next.monsters.map((x) =>
      x.id === m.id ? { ...x, blackShieldActive: false } : x,
    ),
  };
  cur = next.monsters.find((x) => x.id === m.id)!;

  // Fire dark bolt if ready and player in magic missile range
  if (cur.darkBoltReady) {
    next = {
      ...next,
      monsters: next.monsters.map((x) => (x.id === m.id ? { ...x, darkBoltReady: false } : x)),
    };
    cur = next.monsters.find((x) => x.id === m.id)!;
    const mp: Point = { x: cur.x, y: cur.y };
    if (magicMissilePathClearToPlayer(next.tiles, next.monsters, mp, P, cur.id)) {
      next = appendLog(next, `${name} releases the Dark Bolt!`);
      const d = damagePlayer(next, rollInt(4, 7), name, hits);
      if (d.dead) return d;
      next = d.state;
      cur = next.monsters.find((x) => x.id === m.id)!;
    }
  }

  // Draw 3 cards
  const deckIn = cur.shadeDeck ?? shuffleShadeDeck(SHADE_DECK_TEMPLATE);
  const discardIn = cur.shadeDiscard ?? [];
  const drawn = shadeDrawHand(deckIn, discardIn, 3);
  let deck = drawn.deck;
  let discard = drawn.discard;
  const hand = [...drawn.hand];

  next = {
    ...next,
    monsters: next.monsters.map((x) =>
      x.id === m.id ? { ...x, shadeDeck: deck, shadeDiscard: discard } : x,
    ),
  };
  cur = next.monsters.find((x) => x.id === m.id)!;

  // Helper: move shade 2 orthogonal steps toward/away player
  const shadeMove = (toward: boolean) => {
    for (let step = 0; step < 2; step++) {
      cur = next.monsters.find((x) => x.id === m.id)!;
      if (!cur) break;
      const occ = movementOcc(next, cur.id);
      const dest = toward ? bestOrthoToward(next, cur, occ) : bestOrthoAway(next, cur, occ);
      if (!dest) break;
      next = moveMonsterTo(next, cur, dest, hooks);
    }
    cur = next.monsters.find((x) => x.id === m.id)!;
  };

  // Helper: discard a played shade card
  const playCard = (card: string) => {
    discard = [...discard, card];
    next = {
      ...next,
      monsters: next.monsters.map((x) => (x.id === m.id ? { ...x, shadeDiscard: discard } : x)),
    };
    cur = next.monsters.find((x) => x.id === m.id)!;
  };

  const takeFromHand = (card: string): boolean => {
    const idx = hand.indexOf(card);
    if (idx < 0) return false;
    hand.splice(idx, 1);
    return true;
  };

  const isAdjacent = () => cur && manhattan({ x: cur.x, y: cur.y }, P) === 1;

  // 1. Black Shield — play first if drawn
  if (takeFromHand("shade_black_shield")) {
    next = {
      ...next,
      monsters: next.monsters.map((x) => (x.id === m.id ? { ...x, blackShieldActive: true } : x)),
    };
    cur = next.monsters.find((x) => x.id === m.id)!;
    next = appendLog(next, `${name} raises the Black Shield!`);
    playCard("shade_black_shield");
  }

  // 2. Attack phase: maneuver to get adjacent and slash with Blade(s), then retreat
  if (hand.includes("shade_blade")) {
    // Approach with Move cards
    while (hand.includes("shade_move") && !isAdjacent()) {
      takeFromHand("shade_move");
      shadeMove(true);
      playCard("shade_move");
    }
    // Approach with Shadow Step if still not adjacent
    if (!isAdjacent() && hand.includes("shade_shadow_step")) {
      takeFromHand("shade_shadow_step");
      next = shadeShadowStep(next, m.id, true, P);
      cur = next.monsters.find((x) => x.id === m.id)!;
      next = appendLog(next, `${name} shadow-steps closer!`);
      playCard("shade_shadow_step");
    }
    // Slash all Blade(s)
    while (hand.includes("shade_blade")) {
      takeFromHand("shade_blade");
      if (isAdjacent()) {
        const raw = next.danger + rollInt(4, 5);
        next = appendLog(next, `${name} slashes with the Blade of Darkness!`);
        const d = damagePlayer(next, raw, name, hits);
        playCard("shade_blade");
        if (d.dead) return d;
        next = d.state;
        cur = next.monsters.find((x) => x.id === m.id)!;
      } else {
        playCard("shade_blade");
      }
    }
    // Retreat with remaining Move cards
    while (hand.includes("shade_move")) {
      takeFromHand("shade_move");
      shadeMove(false);
      playCard("shade_move");
    }
    // Shadow Step away if still held
    if (hand.includes("shade_shadow_step")) {
      takeFromHand("shade_shadow_step");
      next = shadeShadowStep(next, m.id, false, P);
      cur = next.monsters.find((x) => x.id === m.id)!;
      playCard("shade_shadow_step");
    }
  } else {
    // No Blade — approach and set up ranged
    while (hand.includes("shade_move")) {
      takeFromHand("shade_move");
      shadeMove(true);
      playCard("shade_move");
    }
    if (hand.includes("shade_shadow_step")) {
      takeFromHand("shade_shadow_step");
      next = shadeShadowStep(next, m.id, true, P);
      cur = next.monsters.find((x) => x.id === m.id)!;
      next = appendLog(next, `${name} shadow-steps!`);
      playCard("shade_shadow_step");
    }
  }

  // 3. Dark Bolt — charge if not already ready and still in hand
  if (hand.includes("shade_dark_bolt") && !cur.darkBoltReady) {
    takeFromHand("shade_dark_bolt");
    next = {
      ...next,
      monsters: next.monsters.map((x) => (x.id === m.id ? { ...x, darkBoltReady: true } : x)),
    };
    cur = next.monsters.find((x) => x.id === m.id)!;
    next = appendLog(next, `${name} charges the Dark Bolt...`);
    playCard("shade_dark_bolt");
  }

  return { state: next, dead: false };
}

function vineWhipPullDestination(s: GameState, v: Point, p: Point, excludeMonsterId: string): Point | null {
  if (!magicMissilePathClearToPlayer(s.tiles, s.monsters, v, p, excludeMonsterId)) return null;
  let x = p.x;
  let y = p.y;
  for (let guard = 0; guard < 64; guard++) {
    if (chebyshev({ x, y }, v) <= 1) return { x, y };
    const dx = Math.sign(v.x - x);
    const dy = Math.sign(v.y - y);
    if (dx !== 0 && dy !== 0) {
      x += dx;
      y += dy;
    } else if (dx !== 0) x += dx;
    else if (dy !== 0) y += dy;
    else return null;
  }
  return null;
}

function takeVineshonTurn(
  s: GameState,
  m: MonsterInstance,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  const P: Point = { x: s.player.x, y: s.player.y };
  const name = s.monsterDefs.get(m.defId)?.name ?? "Vineshon";
  let next = s;
  let cur = m;
  if (manhattan({ x: cur.x, y: cur.y }, P) > 4) {
    for (let i = 0; i < 2; i++) {
      const occ = movementOcc(next, cur.id);
      const step = best8Toward(next, cur, occ);
      if (!step) break;
      next = moveMonsterTo(next, cur, step, hooks);
      cur = next.monsters.find((x) => x.id === m.id)!;
    }
  } else {
    const dest = vineWhipPullDestination(next, { x: cur.x, y: cur.y }, P, cur.id);
    if (dest && tileAt(next.tiles, dest) === "floor") {
      next = { ...next, player: { ...next.player, x: dest.x, y: dest.y } };
      next = appendLog(next, `${name}'s vines haul you in!`);
      next = hooks.resolvePlayerEnter(next, dest.x, dest.y);
    }
  }
  cur = next.monsters.find((x) => x.id === m.id)!;
  if (manhattan({ x: cur.x, y: cur.y }, { x: next.player.x, y: next.player.y }) <= 1) {
    const raw = rollInt(1, 3) + monsterDamageBonus(cur.level);
    const d = damagePlayer(next, raw, name, hits);
    if (d.dead) return { state: d.state, dead: true };
    next = d.state;
  }
  return { state: next, dead: false };
}

function tileBlockedForTangleweedSpawn(s: GameState, x: number, y: number): boolean {
  if (tileAt(s.tiles, { x, y }) !== "floor") return true;
  if (s.player.x === x && s.player.y === y) return true;
  if (s.monsters.some((m) => m.hp > 0 && m.x === x && m.y === y)) return true;
  if (s.rocks.some((r) => r.x === x && r.y === y)) return true;
  if (s.tangleweeds.some((t) => t.hp > 0 && t.x === x && t.y === y)) return true;
  if (s.monsters.some((m) => m.defId === "tangleweed_bloom" && m.hp > 0 && m.x === x && m.y === y))
    return true;
  return false;
}

function takeTangleweedBloomTurn(s: GameState, m: MonsterInstance): GameState {
  const bloomId = m.id;
  const candidates: Point[] = [];
  for (const o of ORTHO) {
    const p = { x: m.x + o.x, y: m.y + o.y };
    if (!tileBlockedForTangleweedSpawn(s, p.x, p.y)) candidates.push(p);
  }
  if (candidates.length === 0) {
    for (const tw of s.tangleweeds) {
      if (tw.bloomId !== bloomId || tw.hp <= 0) continue;
      for (const o of ORTHO) {
        const n = { x: tw.x + o.x, y: tw.y + o.y };
        if (!tileBlockedForTangleweedSpawn(s, n.x, n.y)) candidates.push(n);
      }
    }
  }
  if (candidates.length === 0) return s;
  const dest = candidates[rollInt(0, candidates.length - 1)]!;
  const id = `tangle_${s.tangleweeds.length}_${Math.floor(Math.random() * 1e6)}`;
  return {
    ...s,
    tangleweeds: [...s.tangleweeds, { id, x: dest.x, y: dest.y, hp: 1, bloomId }],
    log: [...s.log.slice(-50), "Tangleweed spreads."],
  };
}

function takeDrosirTurn(
  s: GameState,
  m: MonsterInstance,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  const name = s.monsterDefs.get(m.defId)?.name ?? "Drosir";
  let next = s;
  let cur = m;
  const P = { x: next.player.x, y: next.player.y };
  const canAttackNow = () =>
    tileAt(next.tiles, { x: cur.x, y: cur.y }) === "water" &&
    manhattan({ x: cur.x, y: cur.y }, P) === 1;
  const doAttack = (): boolean => {
    const raw = rollInt(2, 3) + monsterDamageBonus(cur.level);
    const d = damagePlayer(next, raw, name, hits);
    if (d.dead) return true;
    next = d.state;
    cur = next.monsters.find((x) => x.id === m.id)!;
    return false;
  };
  const moveOnce = (): void => {
    const occ = movementOcc(next, cur.id);
    let best: Point | null = null;
    let bestDist = Infinity;
    for (const o of ORTHO) {
      const np = { x: cur.x + o.x, y: cur.y + o.y };
      if (occ.has(keyOf(np)) || !monsterTilePassable(next, cur, np)) continue;
      const d = manhattan(np, P);
      if (d < bestDist) {
        bestDist = d;
        best = np;
      }
    }
    if (best) {
      next = moveMonsterTo(next, cur, best, hooks);
      cur = next.monsters.find((x) => x.id === m.id)!;
    }
  };
  if (Math.random() < 0.5) {
    for (let i = 0; i < 3; i++) moveOnce();
    if (canAttackNow() && doAttack()) return { state: { ...next, phase: "defeat" }, dead: true };
  } else {
    if (canAttackNow() && doAttack()) return { state: { ...next, phase: "defeat" }, dead: true };
    for (let i = 0; i < 3; i++) moveOnce();
    if (canAttackNow() && doAttack()) return { state: { ...next, phase: "defeat" }, dead: true };
  }
  return { state: next, dead: false };
}

function takeBeetleTurn(
  s: GameState,
  m: MonsterInstance,
  hooks: MonsterPhaseHooks,
  hits: HitVisual[],
): { state: GameState; dead: boolean } {
  const def = s.monsterDefs.get(m.defId);
  const name = def?.name ?? "Beetle";
  const maxHp = monsterMaxHp(def?.hp ?? 4, m.level);
  const P = { x: s.player.x, y: s.player.y };
  let next = s;
  let cur = m;
  const startAdj = manhattan({ x: cur.x, y: cur.y }, P) === 1;
  const flee = cur.hp * 2 <= maxHp;
  const doAttack = (): boolean => {
    const raw = rollInt(2, 4) + monsterDamageBonus(cur.level);
    const d = damagePlayer(next, raw, name, hits);
    if (d.dead) return true;
    next = d.state;
    cur = next.monsters.find((x) => x.id === m.id)!;
    return false;
  };
  const fleeTwo = () => {
    for (let i = 0; i < 2; i++) {
      const occ = movementOcc(next, cur.id);
      const away = best8Away(next, cur, occ);
      if (!away) break;
      next = moveMonsterTo(next, cur, away, hooks);
      cur = next.monsters.find((x) => x.id === m.id)!;
    }
  };
  const closeTwo = () => {
    for (let i = 0; i < 2; i++) {
      const occ = movementOcc(next, cur.id);
      const toward = best8Toward(next, cur, occ);
      if (!toward) break;
      next = moveMonsterTo(next, cur, toward, hooks);
      cur = next.monsters.find((x) => x.id === m.id)!;
    }
  };
  if (startAdj) {
    if (doAttack()) return { state: { ...next, phase: "defeat" }, dead: true };
    if (flee) fleeTwo();
    return { state: next, dead: false };
  }
  if (flee) {
    fleeTwo();
    return { state: next, dead: false };
  }
  if (Math.random() < 0.5) {
    closeTwo();
    if (manhattan({ x: cur.x, y: cur.y }, P) === 1 && doAttack())
      return { state: { ...next, phase: "defeat" }, dead: true };
  } else {
    if (manhattan({ x: cur.x, y: cur.y }, P) === 1 && doAttack())
      return { state: { ...next, phase: "defeat" }, dead: true };
    closeTwo();
    if (manhattan({ x: cur.x, y: cur.y }, P) === 1 && doAttack())
      return { state: { ...next, phase: "defeat" }, dead: true };
  }
  return { state: next, dead: false };
}

function cullDisconnectedTangleweeds(s: GameState): GameState {
  const bloomOf = new Map<string, Point>();
  for (const mon of s.monsters) {
    if (mon.defId === "tangleweed_bloom" && mon.hp > 0) bloomOf.set(mon.id, { x: mon.x, y: mon.y });
  }
  const byBloom = new Map<string, TangleweedPropInstance[]>();
  for (const tw of s.tangleweeds) {
    if (tw.hp <= 0) continue;
    if (!byBloom.has(tw.bloomId)) byBloom.set(tw.bloomId, []);
    byBloom.get(tw.bloomId)!.push(tw);
  }
  const kept: TangleweedPropInstance[] = [];
  for (const [bloomId, group] of byBloom) {
    const bp = bloomOf.get(bloomId);
    if (!bp) continue;
    const adjBloom = new Set(ORTHO.map((o) => keyOf({ x: bp.x + o.x, y: bp.y + o.y })));
    const cells = new Set(group.map(keyOf));
    const visited = new Set<string>();
    for (const tw of group) {
      const start = keyOf(tw);
      if (visited.has(start)) continue;
      const stack = [start];
      const comp: TangleweedPropInstance[] = [];
      let touches = false;
      while (stack.length) {
        const k = stack.pop()!;
        if (visited.has(k)) continue;
        visited.add(k);
        const [x, y] = k.split(",").map(Number) as [number, number];
        if (adjBloom.has(k)) touches = true;
        const here = group.find((t) => keyOf(t) === k);
        if (here) comp.push(here);
        for (const o of ORTHO) {
          const nk = keyOf({ x: x + o.x, y: y + o.y });
          if (cells.has(nk) && !visited.has(nk)) stack.push(nk);
        }
      }
      if (touches) kept.push(...comp);
    }
  }
  return { ...s, tangleweeds: kept };
}

export function runMonsterPhaseWithHooks(
  state: GameState,
  hooks: MonsterPhaseHooks,
): { state: GameState; hits: HitVisual[] } {
  let s = state;
  const hits: HitVisual[] = [];
  const playerPos: Point = { x: s.player.x, y: s.player.y };
  const processedDouvlonPairs = new Set<string>();

  for (const m of s.monsters) {
    if (m.hp <= 0 || !m.active) continue;
    let curMon = s.monsters.find((x) => x.id === m.id && x.hp > 0);
    if (!curMon) continue;

    if (curMon.defId === "douvlon" && curMon.douvlonPairId) {
      const pid = curMon.douvlonPairId;
      if (processedDouvlonPairs.has(pid)) continue;
      processedDouvlonPairs.add(pid);
      const r = takeDouvlonPairTurn(s, pid, hooks, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "slime") {
      const lt = curMon.leapTarget;
      if (lt != null) {
        s = applySlimeLeap(s, curMon, lt, hooks, hits);
        if (s.player.hp <= 0) return { state: { ...s, phase: "defeat" }, hits };
        continue;
      }
      const occ0 = movementOcc(s, curMon.id);
      const step0 = bestOrthoToward(s, curMon, occ0);
      if (step0) {
        s = moveMonsterTo(s, curMon, step0, hooks);
        curMon = s.monsters.find((x) => x.id === m.id)!;
      }
      if (playerInSlimePlusRange({ x: curMon.x, y: curMon.y }, playerPos)) {
        s = {
          ...s,
          monsters: s.monsters.map((x) =>
            x.id === m.id ? { ...x, leapTarget: { ...playerPos } } : x,
          ),
        };
        s = appendLog(s, "The slime coils to leap.");
      }
      continue;
    }

    if (curMon.defId === "skeleton") {
      const r = takeSkeletonTurn(s, curMon, hooks, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "skeleton_archer") {
      const r = takeSkeletonArcherTurn(s, curMon, hooks, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "mimic") {
      const r = takeMimicTurn(s, curMon, hooks, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "mystic_core") {
      const r = takeMysticTurn(s, curMon, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "vineshon") {
      const r = takeVineshonTurn(s, curMon, hooks, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "tangleweed_bloom") {
      s = takeTangleweedBloomTurn(s, curMon);
      continue;
    }

    if (curMon.defId === "drosir") {
      const r = takeDrosirTurn(s, curMon, hooks, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "beetle") {
      const r = takeBeetleTurn(s, curMon, hooks, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "dune_rat") {
      const r = takeDustRatTurn(s, curMon, playerPos, hooks, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "shadow_rodent") {
      const r = takeShadowRodentTurn(s, curMon, playerPos, hooks, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "elite_skeleton") {
      const r = takeEliteSkeletonTurn(s, curMon, hooks, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "corrupted_shade") {
      const r = takeCorruptedShadeTurn(s, curMon, hooks, hits);
      s = r.state;
      if (r.dead) return { state: { ...s, phase: "defeat" }, hits };
      continue;
    }

    if (curMon.defId === "rockling") {
      if (manhattan({ x: curMon.x, y: curMon.y }, playerPos) === 1) {
        const raw = rollInt(3, 4) + monsterDamageBonus(curMon.level);
        const nm = s.monsterDefs.get(curMon.defId)?.name ?? "Rockling";
        const d = damagePlayer(s, raw, nm, hits);
        if (d.dead) return { state: { ...d.state, phase: "defeat" }, hits };
        s = d.state;
      } else {
        const occ = movementOcc(s, curMon.id);
        const step = bestOrthoToward(s, curMon, occ);
        if (step) s = moveMonsterTo(s, curMon, step, hooks);
      }
      continue;
    }

    const mp: Point = { x: curMon.x, y: curMon.y };
    if (manhattan(mp, playerPos) === 1) {
      const def = s.monsterDefs.get(curMon.defId);
      const raw = rollInt(def?.damage ?? 2, def?.damage ?? 2) + monsterDamageBonus(curMon.level);
      const d = damagePlayer(s, raw, def?.name ?? "Monster", hits);
      if (d.dead) return { state: { ...d.state, phase: "defeat" }, hits };
      s = d.state;
      continue;
    }

    const occ = occupiedByMonsters(s);
    occ.delete(keyOf(curMon));
    occ.add(keyOf(playerPos));
    for (const rk of s.rocks.map((r) => keyOf(r))) occ.add(rk);

    let best: Point | null = null;
    let bestDist = Infinity;
    for (const o of ORTHO) {
      const np = { x: curMon.x + o.x, y: curMon.y + o.y };
      if (!occ.has(keyOf(np)) && monsterTilePassable(s, curMon, np)) {
        const d = manhattan(np, playerPos);
        if (d < bestDist) {
          bestDist = d;
          best = np;
        }
      }
    }
    if (best) {
      s = moveMonsterTo(s, curMon, best, hooks);
    }
  }

  s = cullDisconnectedTangleweeds(s);
  return { state: s, hits };
}
