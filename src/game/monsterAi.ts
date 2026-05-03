import { applyDefense, monsterDamageBonus, rollInt } from "../engine/combat";
import { keyOf, magicMissilePathClearToPlayer, tileAt } from "../engine/grid";
import { manhattan } from "../engine/movement";
import { incomingDamageToPlayer } from "./skillsRuntime";
import type { GameState, HitVisual, MonsterInstance, Point, SkeletonWeapon } from "./types";

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

function movementOcc(s: GameState, excludeMonsterId: string): Set<string> {
  const occ = new Set<string>();
  for (const m of s.monsters) {
    if (m.hp <= 0 || m.id === excludeMonsterId) continue;
    occ.add(keyOf(m));
  }
  occ.add(keyOf({ x: s.player.x, y: s.player.y }));
  for (const r of s.rocks) occ.add(keyOf(r));
  return occ;
}

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
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
    if (occ.has(keyOf(np)) || tileAt(s.tiles, np) !== "floor") continue;
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
    if (occ.has(keyOf(np)) || tileAt(s.tiles, np) !== "floor") continue;
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
    if (occ.has(keyOf(np)) || tileAt(s.tiles, np) !== "floor") continue;
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
    if (occ.has(keyOf(np)) || tileAt(s.tiles, np) !== "floor") continue;
    const d = chebyshev(np, playerPos);
    if (d > bestDist) {
      bestDist = d;
      best = np;
    }
  }
  return best;
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
    let monsters = next.monsters.map((x) => (x.id === victimMon.id ? { ...x, hp: nh } : x));
    if (nh <= 0) {
      monsters = monsters.filter((x) => x.id !== victimMon.id);
      next = appendLog({ ...next, monsters }, `${defV?.name ?? "Monster"} defeated.`);
    } else {
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

export function runMonsterPhaseWithHooks(
  state: GameState,
  hooks: MonsterPhaseHooks,
): { state: GameState; hits: HitVisual[] } {
  let s = state;
  const hits: HitVisual[] = [];
  const playerPos: Point = { x: s.player.x, y: s.player.y };

  for (const m of s.monsters) {
    if (m.hp <= 0 || !m.active) continue;
    let curMon = s.monsters.find((x) => x.id === m.id && x.hp > 0);
    if (!curMon) continue;

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

    if (curMon.defId === "mystic_core") {
      const r = takeMysticTurn(s, curMon, hits);
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

    if (curMon.defId === "cave_bat") {
      const def = s.monsterDefs.get(curMon.defId);
      const bonus = monsterDamageBonus(curMon.level);
      const baseD = def?.damage ?? 1;
      if (manhattan({ x: curMon.x, y: curMon.y }, playerPos) === 1) {
        const raw = rollInt(baseD, baseD) + bonus;
        const nm = def?.name ?? "Cave Bat";
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
      if (!occ.has(keyOf(np)) && tileAt(s.tiles, np) === "floor") {
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

  return { state: s, hits };
}
