'use strict';
// Правила игры: раунды, деньги, магазин, оружие, стрельба и урон.
// Всё считает сервер, поэтому жульничать через браузер нельзя.
// Здесь удобно менять цены, урон, скорострельность и время раунда.

const world = require('./world');
const nav = require('./nav');

// ---------- время (в миллисекундах) ----------
const BUY_MS = 15000;            // время на покупки в начале раунда
const LIVE_MS = 100000;          // длительность боя
const END_MS = 5000;             // пауза после раунда
const DUMMY_RESPAWN_MS = 3000;   // мишень вставать заново через...

// ---------- деньги ----------
const START_MONEY = 800;
const MAX_MONEY = 16000;
const WIN_BONUS = 3250;          // награда победителю раунда
const LOSE_BONUS = 1400;         // всем остальным

// ---------- стрельба ----------
const MAX_RANGE = 200;
const HEAD_MULT = 4;             // урон в голову
const RECOIL_MAX = 0.12;         // предел отдачи (радианы, ~7 градусов)
const ARMOR_PRICE = 650;

// Оружие. slot: 1 = основное, 2 = пистолет.
// dmg - урон в тело, rate - миллисекунд между выстрелами, reload - время перезарядки,
// spread - разброс (радианы), recoil - подброс прицела за выстрел.
const WEAPONS = {
  pistol: { id: 'pistol', name: 'Пистолет',      slot: 2, price: 0,    mag: 12, reserve: 24, dmg: 33,  rate: 150,  auto: false, reload: 2200, spread: 0.006, recoil: 0.012, reward: 300 },
  deagle: { id: 'deagle', name: 'Desert Eagle',  slot: 2, price: 700,  mag: 7,  reserve: 35, dmg: 63,  rate: 225,  auto: false, reload: 2200, spread: 0.004, recoil: 0.040, reward: 300 },
  ak47:   { id: 'ak47',   name: 'AK-47',         slot: 1, price: 2700, mag: 30, reserve: 90, dmg: 36,  rate: 100,  auto: true,  reload: 2500, spread: 0.004, recoil: 0.014, reward: 300 },
  knife:  { id: 'knife', name: 'Нож', slot: 3, price: 0, melee: true, dmg: 40, rate: 450, reward: 1500,
            altDmg: 65, altRate: 1100, range: 2.1, altRange: 1.8, backMult: 2.25, altBackDmg: 180 },
  he:     { id: 'he',    name: 'Осколочная граната', slot: 3, price: 300, nade: true, max: 1, reward: 300 },
  flash:  { id: 'flash', name: 'Светошумовая',       slot: 3, price: 200, nade: true, max: 2, reward: 0 },
  smoke:  { id: 'smoke', name: 'Дымовая',            slot: 3, price: 300, nade: true, max: 1, reward: 0 },
  molotov: { id: 'molotov', name: 'Коктейль Молотова', slot: 3, price: 400, nade: true, max: 1, reward: 300, fire: true },
  awp:    { id: 'awp',    name: 'AWP',           slot: 1, price: 4750, mag: 10, reserve: 30, dmg: 115, rate: 1470, auto: false, reload: 3700, spread: 0.000, recoil: 0.000, reward: 100, scope: true, unscopedSpread: 0.09 },
};

// Что продаётся в магазине (как в CS:GO: сначала раздел, потом товар)
const SHOP = [
  { name: 'Пистолеты', items: [{ id: 'deagle' }] },
  { name: 'Винтовки',  items: [{ id: 'ak47' }, { id: 'awp' }] },
  { name: 'Гранаты',    items: [{ id: 'he' }, { id: 'flash' }, { id: 'smoke' }, { id: 'molotov' }] },
  { name: 'Снаряжение', items: [{ id: 'armor', name: 'Бронежилет', price: ARMOR_PRICE }] },
];

// ---------- персонажи со способностями (клавиша E) ----------
const CHARS = {
  soldier: { name: 'Солдат',  hp: 100, speed: 1,    ab: 'Адреналин',    desc: 'На 4 сек бежишь на 35% быстрее',          cd: 25000, dur: 4000 },
  tank:    { name: 'Танк',    hp: 150, speed: 0.9,  ab: 'Силовой щит',  desc: 'На 4 сек получаешь на 70% меньше урона',  cd: 30000, dur: 4000 },
  ghost:   { name: 'Призрак', hp: 80,  speed: 1.08, ab: 'Невидимость',  desc: 'На 5 сек тебя не видно (выстрел выдаёт)', cd: 30000, dur: 5000 },
  medic:   { name: 'Медик',   hp: 100, speed: 1,    ab: 'Аптечка',      desc: 'Мгновенно лечит +60 здоровья',            cd: 25000, dur: 700 },
  ninja:   { name: 'Ниндзя',  hp: 90,  speed: 1.05, ab: 'Рывок',        desc: 'Мощный рывок вперёд (или куда идёшь)',    cd: 7000,  dur: 330 },
};
const CHAR_IDS = Object.keys(CHARS);
const HASTE_MULT = 1.35;
const SHIELD_MULT = 0.3;
const MEDIC_HEAL = 60;
const DASH_SPEED = 0.48;

// ---------- гранаты ----------
const NADE_GRAVITY = 0.02;       // падение за шаг
const NADE_SPEED = 0.75;         // скорость броска
const HE_RADIUS = 9;             // радиус взрыва осколочной
const HE_DAMAGE = 100;           // урон в центре взрыва
const FLASH_RADIUS = 30;
const FLASH_MAX = 4.5;           // максимум ослепления (секунды)
const SMOKE_RADIUS = 3.8;
const SMOKE_TICKS = 18 * 30;     // дым держится 18 секунд
const FUSE = { he: 55, flash: 45, smoke: 60, molotov: 100 };
const FIRE_RADIUS = 3.2;
const FIRE_TICKS = 7 * 30;      // огонь горит 7 секунд
const FIRE_DMG = 8;             // урон за каждые полсекунды в огне
const FIRE_EVERY = 15;
const KNIFE_SPEED = 1.2;         // с ножом бегаешь быстрее (как в CS)   // шагов до взрыва (30 шагов = 1 секунда)

// ---------- боты ----------
const BOT_NAMES = ['Макс', 'Влад', 'Дима', 'Артём', 'Кирилл', 'Миша', 'Саша', 'Рома'];
// react - сколько мс бот «думает» перед первым выстрелом, turn - скорость наводки,
// err - неточность прицела, head - шанс целиться в голову
const BOT_LEVELS = {
  1: { react: 1100, turn: 0.03, err: 0.1, head: 0.02 },
  2: { react: 750, turn: 0.045, err: 0.07, head: 0.05 },
  3: { react: 400, turn: 0.08, err: 0.04, head: 0.15 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;

// Пересечение луча с коробкой (возвращает расстояние до входа в коробку или null)
function rayBox(o, d, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(d[axis]) < 1e-9) {
      if (o[axis] < min[axis] || o[axis] > max[axis]) return null;
    } else {
      let t1 = (min[axis] - o[axis]) / d[axis];
      let t2 = (max[axis] - o[axis]) / d[axis];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

function shopForClient() {
  return SHOP.map((cat) => ({
    name: cat.name,
    items: cat.items.map((it) => {
      const w = WEAPONS[it.id];
      return { id: it.id, name: it.name || w.name, price: it.price !== undefined ? it.price : w.price };
    }),
  }));
}

function createGame(opts) {
  const now = opts.now || Date.now;
  const send = opts.send || (() => {});
  const broadcast = opts.broadcast || (() => {});
  const rand = opts.rand || Math.random;
  const startMoney = opts.startMoney || START_MONEY;   // стартовые деньги (в режиме тренировки больше)
  const botCount = Math.max(0, Math.min(7, opts.bots || 0)); // сколько ботов-противников
  const botLevel = BOT_LEVELS[opts.botLevel] || BOT_LEVELS[2];

  const players = new Map();   // id -> игрок (и настоящие, и мишени)
  let phase = 'buy';           // buy (покупки) -> live (бой) -> end (итоги)
  let phaseEnd = now() + BUY_MS;
  let round = 1;
  let ticks = 0;
  const nades = [];            // гранаты в полёте
  const smokes = [];           // дымовые облака
  const fires = [];            // огонь от коктейлей Молотова
  let nextNade = 1;

  const realPlayers = () => [...players.values()].filter((p) => !p.dummy);       // игроки и боты
  const humans = () => [...players.values()].filter((p) => !p.dummy && !p.ai);   // только живые люди
  const label = (p) => (p.ai ? `Бот ${p.name}` : `Игрок ${p.id}`);
  const say = (p, text) => { if (!p.dummy && !p.ai) send(p.id, { type: 'msg', text }); };

  // ---------- игроки ----------
  function resetLoadout(p) {
    p.weapons = { primary: null, pistol: 'pistol' };
    p.nades = { he: 0, flash: 0, smoke: 0, molotov: 0 };
    p.cur = 'pistol';
    p.armor = 0;
    refillAmmo(p);
  }

  function refillAmmo(p) {
    p.ammo = {};
    for (const id of [p.weapons.primary, p.weapons.pistol]) {
      if (id) p.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    }
  }

  function makePlayer(id, dummy, ai) {
    const p = world.createPlayer(id);
    Object.assign(p, {
      id, dummy: !!dummy, ai: null, name: '', blindUntil: 0,
      hp: 100, armor: 0, money: startMoney, char: 'soldier', abUntil: 0, abReadyAt: 0, kills: 0, deaths: 0,
      alive: true, inRound: true, diedThisRound: false,
      weapons: null, ammo: {}, cur: 'pistol',
      reload: null, nextFire: 0, lastShot: 0, clickAt: 0, clicks: 0, altAt: 0, rclicks: 0,
      fireHeld: false, scoped: false, recoil: 0, respawnAt: 0,
    });
    resetLoadout(p);
    if (ai) { p.ai = newAi(); p.name = BOT_NAMES[(id - 201) % BOT_NAMES.length]; }
    return p;
  }

  function newAi() {
    return {
      targetId: null, reactAt: 0, aimHead: false, errYaw: 0, errPitch: 0, errUntil: 0,
      strafeDir: 1, strafeUntil: 0, path: null, pathAt: 0, pi: 0, lx: 0, lz: 0, stuck: 0, jumpUntil: 0,
    };
  }

  if (botCount === 0) {
    // без ботов стоят мишени для тренировки
    world.MAP.dummies.forEach(([x, z], i) => {
      const d = makePlayer(101 + i, true);
      d.x = x; d.z = z; d.y = 0; d.yaw = Math.PI;
      d.color = '#95a5a6';
      d.homeX = x; d.homeZ = z;
      players.set(d.id, d);
    });
  } else {
    for (let i = 0; i < botCount; i++) {
      const b = makePlayer(201 + i, false, true);
      b.alive = true;
      players.set(b.id, b);
    }
  }

  function respawn(p) {
    if (p.dummy) {
      p.x = p.homeX; p.z = p.homeZ; p.y = 0;
    } else {
      const sp = world.createPlayer(p.id);
      p.x = sp.x; p.z = sp.z; p.y = 0;
      p.yaw = 0; p.pitch = 0;
    }
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.onGround = true;
    p.hp = CHARS[p.char].hp;
    p.abUntil = 0; p.abReadyAt = 0;
    p.alive = true;
    p.inRound = true;
    p.diedThisRound = false;
    p.recoil = 0;
    p.reload = null;
    p.scoped = false;
    p.clickAt = 0;
    p.nextFire = 0;
    p.altAt = 0;
    p.blindUntil = 0;
    if (p.ai) p.ai = newAi();
  }

  // боты появляются подальше от людей
  function spreadBots() {
    const hs = humans().filter((h) => h.alive);
    for (const b of realPlayers().filter((p) => p.ai)) {
      let best = null;
      let bestD = -1;
      for (let i = 0; i < 25; i++) {
        const sp = world.createPlayer(b.id);
        const d = hs.length ? Math.min(...hs.map((h) => Math.hypot(h.x - sp.x, h.z - sp.z))) : 99;
        if (d > bestD) { bestD = d; best = sp; }
        if (d > 25) break;
      }
      if (best) { b.x = best.x; b.z = best.z; }
    }
  }

  function botBuy(p) {
    if (p.money >= 4750 && rand() < 0.35) buy(p, 'awp');
    else if (p.money >= 2700 && !p.weapons.primary) buy(p, 'ak47');
    if (!p.weapons.primary && p.money >= 700 && rand() < 0.6) buy(p, 'deagle');
    if (p.money >= 650 && p.armor < 100 && rand() < 0.7) buy(p, 'armor');
    if (p.money >= 1500 && rand() < 0.3) buy(p, 'molotov');
    p.char = CHAR_IDS[Math.floor(rand() * CHAR_IDS.length)];
    p.hp = CHARS[p.char].hp;
    p.cur = p.weapons.primary || p.weapons.pistol;
  }

  function startRound(t, fresh) {
    if (fresh) round = 1; else round++;
    phase = 'buy';
    phaseEnd = t + BUY_MS;
    nades.length = 0;
    smokes.length = 0;
    fires.length = 0;
    for (const p of players.values()) {
      if (p.diedThisRound) resetLoadout(p);   // погиб - теряешь оружие, выжил - оставляешь
      refillAmmo(p);
      respawn(p);
    }
    spreadBots();
    for (const p of players.values()) if (p.ai) botBuy(p);
    broadcast({ type: 'phase', phase: 'buy', round });
  }

  function addPlayer(id) {
    const t = now();
    const first = humans().length === 0;
    const p = makePlayer(id, false);
    players.set(id, p);
    if (first) {
      startRound(t, true);        // пришёл первый игрок: начинаем всё с начала
    } else if (phase === 'buy') {
      respawn(p);
    } else {
      p.alive = false;
      p.inRound = false;
      say(p, 'Раунд уже идёт. Ты войдёшь в игру в следующем раунде.');
    }
    return p;
  }

  function removePlayer(id) {
    players.delete(id);
  }

  // ---------- магазин ----------
  function buy(p, item) {
    if (!p.alive) return say(p, 'Ты мёртв');
    if (phase !== 'buy') return say(p, 'Покупать можно только в начале раунда');

    if (item === 'armor') {
      if (p.armor >= 100) return say(p, 'Бронежилет уже есть');
      if (p.money < ARMOR_PRICE) return say(p, 'Недостаточно денег');
      p.money -= ARMOR_PRICE;
      p.armor = 100;
      return say(p, 'Куплено: Бронежилет');
    }

    const w = WEAPONS[item];
    if (!w || w.price <= 0) return;
    if (w.nade) {
      if (p.nades[item] >= w.max) return say(p, `${w.name}: больше ${w.max} не унести`);
      if (p.money < w.price) return say(p, 'Недостаточно денег');
      p.money -= w.price;
      p.nades[item]++;
      return say(p, `Куплено: ${w.name}`);
    }
    if (p.weapons.primary === item || p.weapons.pistol === item) return say(p, `${w.name} уже есть`);
    if (p.money < w.price) return say(p, 'Недостаточно денег');

    p.money -= w.price;
    if (w.slot === 1) p.weapons.primary = item; else p.weapons.pistol = item;
    p.ammo[item] = { mag: w.mag, reserve: w.reserve };
    p.cur = item;               // сразу берём купленное оружие в руки
    p.reload = null;
    p.scoped = false;
    say(p, `Куплено: ${w.name}`);
  }

  function setChar(p, id) {
    if (!CHARS[id] || !p.alive) return;
    if (phase !== 'buy') return say(p, 'Персонажа можно менять только в начале раунда');
    p.char = id;
    p.hp = CHARS[id].hp;
    p.abUntil = 0; p.abReadyAt = 0;
    say(p, `Персонаж: ${CHARS[id].name}. Способность: ${CHARS[id].ab} (клавиша E)`);
  }

  const abActive = (p, t) => t < p.abUntil;
  const isCloaked = (p, t) => p.char === 'ghost' && abActive(p, t);

  function useAbility(p, t) {
    if (!p.alive || !p.inRound) return;
    if (phase !== 'live') return say(p, 'Способность работает только во время раунда');
    if (t < p.abReadyAt) return say(p, `${CHARS[p.char].ab}: ещё ${Math.ceil((p.abReadyAt - t) / 1000)} сек`);
    const c = CHARS[p.char];
    if (p.char === 'medic' && p.hp >= c.hp) return say(p, 'Здоровье уже полное');
    p.abReadyAt = t + c.cd;
    p.abUntil = t + c.dur;
    if (p.char === 'medic') p.hp = Math.min(c.hp, p.hp + MEDIC_HEAL);
    if (p.char === 'ninja') {
      const k = p.keys || {};
      let mx = 0; let mz = 0;
      const fx = -Math.sin(p.yaw); const fz = -Math.cos(p.yaw);
      const rx = Math.cos(p.yaw); const rz = -Math.sin(p.yaw);
      if (k.f) { mx += fx; mz += fz; }
      if (k.b) { mx -= fx; mz -= fz; }
      if (k.r) { mx += rx; mz += rz; }
      if (k.l) { mx -= rx; mz -= rz; }
      if (!mx && !mz) { mx = fx; mz = fz; }
      const l = Math.hypot(mx, mz);
      p.dash = { x: (mx / l) * DASH_SPEED, z: (mz / l) * DASH_SPEED };
    }
  }

  function select(p, slot) {
    const id = slot === 1 ? p.weapons.primary : slot === 3 ? 'knife' : p.weapons.pistol;
    if (!id || id === p.cur) return;
    p.cur = id;
    p.reload = null;
    p.scoped = false;
    p.recoil = 0;
    p.nextFire = Math.max(p.nextFire, now() + 250);
  }

  function selectNade(p, kind) {
    if (!p.nades || !(p.nades[kind] > 0) || p.cur === kind) return;
    p.cur = kind;
    p.reload = null;
    p.scoped = false;
    p.recoil = 0;
    p.nextFire = Math.max(p.nextFire, now() + 300);
  }

  // патроны в магазине/запас; для гранат - сколько их у игрока
  function curAmmo(p) {
    const w = WEAPONS[p.cur];
    if (w.nade) return { mag: p.nades[p.cur], reserve: 0 };
    if (w.melee) return { mag: 0, reserve: 0 };
    return p.ammo[p.cur];
  }

  function startReload(p, t) {
    const w = WEAPONS[p.cur];
    if (w.nade || w.melee) return;
    const a = p.ammo[p.cur];
    if (p.reload || a.mag >= w.mag || a.reserve <= 0) return;
    p.reload = { until: t + w.reload, total: w.reload, w: p.cur };
    p.scoped = false;
  }

  // ---------- стрельба ----------
  function trace(shooter, o, d) {
    let best = { t: MAX_RANGE, type: 'none' };

    if (d.y < -1e-9) {                       // пол
      const t = -o.y / d.y;
      if (t > 0 && t < best.t) best = { t, type: 'wall' };
    }
    for (const b of world.BOXES) {           // стены и препятствия
      const t = rayBox(o, d,
        { x: b.x - b.w / 2, y: 0, z: b.z - b.d / 2 },
        { x: b.x + b.w / 2, y: b.h, z: b.z + b.d / 2 });
      if (t !== null && t < best.t) best = { t, type: 'wall' };
    }
    for (const q of players.values()) {      // другие игроки и мишени
      if (q === shooter || !q.alive) continue;
      const th = rayBox(o, d,
        { x: q.x - 0.25, y: q.y + 1.35, z: q.z - 0.25 },
        { x: q.x + 0.25, y: q.y + 1.85, z: q.z + 0.25 });
      const tb = rayBox(o, d,
        { x: q.x - 0.35, y: q.y, z: q.z - 0.35 },
        { x: q.x + 0.35, y: q.y + 1.4, z: q.z + 0.35 });
      let t = null;
      let head = false;
      if (th !== null && (tb === null || th <= tb)) { t = th; head = true; }
      else if (tb !== null) { t = tb; }
      if (t !== null && t < best.t) best = { t, type: 'player', target: q, head };
    }
    return best;
  }

  function shoot(p, w, a, t) {
    a.mag--;
    if (p.char === 'ghost') p.abUntil = 0;
    p.lastShot = t;

    // разброс: больше при движении и в прыжке; AWP без прицела стреляет «в молоко»
    const speed = Math.hypot(p.vx, p.vz);
    let spread;
    if (w.scope) spread = p.scoped ? speed * 0.5 + (p.onGround ? 0 : 0.1) : w.unscopedSpread;
    else spread = w.spread + speed * 0.12 + (p.onGround ? 0 : 0.04);

    const yaw = p.yaw + (rand() * 2 - 1) * (spread + p.recoil * 0.5);
    const pitch = p.pitch + p.recoil + (rand() * 2 - 1) * spread;
    const cp = Math.cos(pitch);
    const d = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
    const o = { x: p.x, y: p.y + world.EYE, z: p.z };

    const hit = trace(p, o, d);
    const end = [r2(o.x + d.x * hit.t), r2(o.y + d.y * hit.t), r2(o.z + d.z * hit.t)];
    broadcast({ type: 'shot', id: p.id, w: w.id, from: [r2(o.x), r2(o.y - 0.15), r2(o.z)], to: end, hit: hit.type === 'player' ? 1 : 0 });

    if (hit.type === 'player') damage(p, hit.target, w, hit.head, t);

    p.recoil = Math.min(RECOIL_MAX, p.recoil + w.recoil);
    if (w.scope) p.scoped = false;           // AWP после выстрела выходит из прицела
  }

  function damage(shooter, target, w, head, t, rawDmg) {
    let dmg = rawDmg !== undefined ? rawDmg : w.dmg;
    if (head) dmg *= HEAD_MULT;
    if (target.char === 'tank' && abActive(target, t)) dmg *= SHIELD_MULT;
    let toHp = dmg;
    if (!head && target.armor > 0 && !w.fire) {   // бронежилет защищает тело, но не голову (от огня не спасает)
      toHp = dmg * 0.6;
      target.armor = Math.max(0, target.armor - dmg * 0.2);
    }
    toHp = Math.round(toHp);
    target.hp -= toHp;
    const killed = target.hp <= 0;
    if (!w.fire && toHp > 0) {                 // кровь: все видят брызги в месте попадания
      let bx = target.x - shooter.x; let bz = target.z - shooter.z;
      const bl = Math.hypot(bx, bz);
      if (bl < 0.01) { bx = rand() - 0.5; bz = rand() - 0.5; } else { bx /= bl; bz /= bl; }
      broadcast({ type: 'blood', x: r2(target.x), y: r2(target.y + (head ? 1.65 : 1.15)), z: r2(target.z), fy: r2(target.y), dx: r2(bx), dz: r2(bz), n: Math.min(60, toHp), head: head ? 1 : 0, kill: killed ? 1 : 0 });
    }
    send(shooter.id, { type: 'hitmark', head: head ? 1 : 0, kill: killed ? 1 : 0 });
    if (!target.dummy && !target.ai) send(target.id, { type: 'hurt', dmg: toHp });
    if (killed) kill(shooter, target, w, head, t);
  }

  function kill(shooter, target, w, head, t) {
    target.hp = 0;
    target.alive = false;
    target.reload = null;
    target.scoped = false;
    if (target.dummy) {
      target.respawnAt = t + DUMMY_RESPAWN_MS;
    } else {
      target.deaths++;
      target.diedThisRound = true;
      if (shooter !== target) {              // за самоубийство наград нет
        shooter.kills++;
        shooter.money = Math.min(MAX_MONEY, shooter.money + w.reward);
      }
    }
    broadcast({ type: 'kill', killer: shooter.id, victim: target.id, w: w.id, head: head ? 1 : 0, bot: target.dummy ? 1 : 0 });
  }

  function combatStep(p, t) {
    const w = WEAPONS[p.cur];
    if (w.melee) {                           // нож: левая кнопка - удар, правая - сильный удар
      if (p.clickAt && t - p.clickAt > 250) p.clickAt = 0;
      if (p.altAt && t - p.altAt > 250) p.altAt = 0;
      if (phase === 'live' && t >= p.nextFire && (p.altAt || p.clickAt || p.fireHeld)) {
        const alt = !!p.altAt;
        p.clickAt = 0; p.altAt = 0;
        knifeAttack(p, w, alt, t);
      }
      return;
    }
    if (w.nade) {                            // граната в руках: левая кнопка - бросок
      if (p.clickAt && t - p.clickAt > 250) p.clickAt = 0;
      if (phase === 'live' && p.clickAt && t >= p.nextFire) {
        p.clickAt = 0;
        if (p.nades[w.id] > 0) throwNade(p, w.id, t);
      }
      return;
    }
    const a = p.ammo[p.cur];

    if (p.reload && t >= p.reload.until) {   // перезарядка закончилась
      const take = Math.min(w.mag - a.mag, a.reserve);
      a.mag += take;
      a.reserve -= take;
      p.reload = null;
    }
    if (t - p.lastShot > w.rate + 50) p.recoil = Math.max(0, p.recoil - 0.006);
    if (p.clickAt && t - p.clickAt > 250) p.clickAt = 0;

    if (phase !== 'live' || p.reload) return;

    const trigger = (w.auto && p.fireHeld) || p.clickAt;
    if (trigger && t >= p.nextFire) {
      p.clickAt = 0;
      if (a.mag <= 0) {
        startReload(p, t);                   // магазин пуст: перезаряжаемся сами
        return;
      }
      shoot(p, w, a, t);
      p.nextFire = t + w.rate;
    }
  }

  // ---------- видимость (стены и дым) ----------
  function segBlocked(a, b) {
    const dx = b.x - a.x; const dy = b.y - a.y; const dz = b.z - a.z;
    const D = Math.hypot(dx, dy, dz);
    if (D < 1e-6) return false;
    const d = { x: dx / D, y: dy / D, z: dz / D };
    for (const bx of world.BOXES) {
      const t = rayBox(a, d, { x: bx.x - bx.w / 2, y: 0, z: bx.z - bx.d / 2 }, { x: bx.x + bx.w / 2, y: bx.h, z: bx.z + bx.d / 2 });
      if (t !== null && t < D - 0.05) return true;
    }
    return false;
  }

  function segSmoked(a, b) {
    for (const s of smokes) {
      const ax = b.x - a.x; const ay = b.y - a.y; const az = b.z - a.z;
      const L2 = ax * ax + ay * ay + az * az || 1;
      const u = clamp(((s.x - a.x) * ax + (s.y - a.y) * ay + (s.z - a.z) * az) / L2, 0, 1);
      if (Math.hypot(a.x + ax * u - s.x, a.y + ay * u - s.y, a.z + az * u - s.z) < s.r * 0.85) return true;
    }
    return false;
  }

  // ---------- гранаты ----------
  const NR = 0.12;   // «размер» гранаты

  function nadeHit(x, y, z) {
    for (const b of world.BOXES) {
      if (Math.abs(x - b.x) < b.w / 2 + NR && Math.abs(z - b.z) < b.d / 2 + NR && y - NR < b.h) return b;
    }
    return null;
  }

  function knifeAttack(p, w, alt, t) {
    const range = alt ? w.altRange : w.range;
    const cp = Math.cos(p.pitch);
    const f = { x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp };
    const eye = { x: p.x, y: p.y + world.EYE, z: p.z };
    let best = null;
    let bestD = Infinity;
    for (const q of players.values()) {
      if (q === p || !q.alive || (!q.dummy && !q.inRound)) continue;
      const c = { x: q.x, y: q.y + 1.0, z: q.z };
      const dx = c.x - eye.x; const dy = c.y - eye.y; const dz = c.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range + 0.4 || d < 1e-6) continue;
      if ((f.x * dx + f.y * dy + f.z * dz) / d < 0.55) continue;      // цель не перед нами
      if (segBlocked(eye, c)) continue;
      if (d < bestD) { bestD = d; best = q; }
    }
    p.nextFire = t + (alt ? w.altRate : w.rate);
    if (best) {
      // удар в спину: цель смотрит в ту же сторону, что и мы
      const hx = best.x - p.x; const hz = best.z - p.z;
      const hl = Math.hypot(hx, hz) || 1;
      const back = (-Math.sin(best.yaw) * hx + -Math.cos(best.yaw) * hz) / hl > 0.3;
      let dmg = alt ? w.altDmg : w.dmg;
      if (back) dmg = alt ? w.altBackDmg : Math.round(w.dmg * w.backMult);
      damage(p, best, w, false, t, dmg);
      broadcast({ type: 'slash', id: p.id, alt: alt ? 1 : 0, hit: 1, back: back ? 1 : 0 });
    } else {
      broadcast({ type: 'slash', id: p.id, alt: alt ? 1 : 0, hit: 0, back: 0 });
    }
  }

  function throwNade(p, kind, t) {
    p.nades[kind]--;
    const pitch = p.pitch + 0.2;
    const cp = Math.cos(pitch);
    const dir = { x: -Math.sin(p.yaw) * cp, y: Math.sin(pitch), z: -Math.cos(p.yaw) * cp };
    const ey = p.y + world.EYE - 0.2;
    let sx = p.x + dir.x * 0.5;
    let sy = ey + dir.y * 0.5;
    let sz = p.z + dir.z * 0.5;
    if (nadeHit(sx, sy, sz)) { sx = p.x; sy = ey; sz = p.z; }       // стоим вплотную к стене
    nades.push({
      id: nextNade++, kind, owner: p.id, x: sx, y: sy, z: sz,
      vx: dir.x * NADE_SPEED + p.vx * 0.5, vy: dir.y * NADE_SPEED + p.vy * 0.3, vz: dir.z * NADE_SPEED + p.vz * 0.5,
      fuse: FUSE[kind], grounded: false,
    });
    if (p.nades[kind] <= 0) {                // гранаты кончились: берём обратно оружие
      p.cur = p.weapons.primary || p.weapons.pistol;
      p.nextFire = t + 300;
    } else {
      p.nextFire = t + 700;
    }
    broadcast({ type: 'throw', id: p.id, kind });
  }

  function stepNade(n) {
    const B = world.BOUNDS - NR;
    n.vy -= NADE_GRAVITY;
    let nx = n.x + n.vx;
    if (Math.abs(nx) > B || nadeHit(nx, n.y, n.z)) { n.vx = -n.vx * 0.45; nx = n.x; n.hitWall = true; }
    let nz = n.z + n.vz;
    if (Math.abs(nz) > B || nadeHit(nx, n.y, nz)) { n.vz = -n.vz * 0.45; nz = n.z; n.hitWall = true; }
    let ny = n.y + n.vy;
    n.grounded = false;
    const b = nadeHit(nx, ny, nz);
    if (b) {
      if (n.vy < 0) {                        // упала на верх коробки
        ny = b.h + NR;
        n.grounded = true;
        n.vy = -n.vy > 0.06 ? -n.vy * 0.4 : 0;
      } else {
        ny = n.y;
        n.vy = -n.vy * 0.4;
      }
      n.vx *= 0.8; n.vz *= 0.8;
    } else if (ny < NR) {
      ny = NR;
      n.vy = Math.abs(n.vy) > 0.06 ? Math.abs(n.vy) * 0.4 : 0;
      n.vx *= 0.7; n.vz *= 0.7;
      n.grounded = true;
    }
    if (n.grounded) { n.vx *= 0.9; n.vz *= 0.9; }
    n.x = nx; n.y = ny; n.z = nz;
  }

  function stepFires(t) {
    for (let i = fires.length - 1; i >= 0; i--) if (ticks >= fires[i].until) fires.splice(i, 1);
    if (ticks % FIRE_EVERY !== 0) return;
    for (const f of fires) {
      const owner = players.get(f.owner) || { id: 0, kills: 0, money: 0, dummy: false, ai: null };
      for (const q of [...players.values()]) {
        if (!q.alive || (!q.inRound && !q.dummy)) continue;
        if (Math.hypot(q.x - f.x, q.z - f.z) > f.r || Math.abs(q.y - f.y) > 1.6) continue;
        damage(owner, q, WEAPONS.molotov, false, t, FIRE_DMG);
      }
    }
  }

  const inFire = (p) => fires.find((f) => Math.hypot(p.x - f.x, p.z - f.z) < f.r + 0.8 && Math.abs(p.y - f.y) < 1.6);

  function stepNades(t) {
    for (let i = smokes.length - 1; i >= 0; i--) if (ticks >= smokes[i].until) smokes.splice(i, 1);
    for (let i = nades.length - 1; i >= 0; i--) {
      const n = nades[i];
      stepNade(n);
      n.fuse--;
      if (n.kind === 'molotov' && (n.grounded || n.hitWall) && n.fuse < FUSE.molotov - 3) n.fuse = 0;   // разбивается при ударе
      if (n.fuse <= 0) { nades.splice(i, 1); explode(n, t); }
    }
  }

  function explode(n, t) {
    const pos = { x: n.x, y: n.y + 0.2, z: n.z };
    const owner = players.get(n.owner) || { id: 0, kills: 0, money: 0, dummy: false, ai: null };
    if (n.kind === 'he') {
      for (const q of [...players.values()]) {
        if (!q.alive || !q.inRound && !q.dummy) continue;
        const c = { x: q.x, y: q.y + 1.0, z: q.z };
        const d = Math.hypot(c.x - pos.x, c.y - pos.y, c.z - pos.z);
        if (d >= HE_RADIUS || segBlocked(pos, c)) continue;
        const raw = HE_DAMAGE * (1 - d / HE_RADIUS);
        if (raw >= 1) damage(owner, q, WEAPONS.he, false, t, raw);
      }
    } else if (n.kind === 'flash') {
      for (const q of players.values()) {
        if (!q.alive || q.dummy) continue;
        const e = { x: q.x, y: q.y + world.EYE, z: q.z };
        const d = Math.hypot(e.x - pos.x, e.y - pos.y, e.z - pos.z);
        if (d >= FLASH_RADIUS || segBlocked(pos, e)) continue;
        const cp = Math.cos(q.pitch);
        const fwd = { x: -Math.sin(q.yaw) * cp, y: Math.sin(q.pitch), z: -Math.cos(q.yaw) * cp };
        const dot = (fwd.x * (pos.x - e.x) + fwd.y * (pos.y - e.y) + fwd.z * (pos.z - e.z)) / (d || 1);
        const dur = FLASH_MAX * (1 - d / FLASH_RADIUS) * (0.2 + 0.8 * ((dot + 1) / 2));
        if (dur > 0.25) q.blindUntil = Math.max(q.blindUntil, t + dur * 1000);
      }
    } else if (n.kind === 'molotov') {
      fires.push({ x: n.x, y: Math.max(0, n.y - NR), z: n.z, r: FIRE_RADIUS, until: ticks + FIRE_TICKS, owner: n.owner });
    } else if (n.kind === 'smoke') {
      smokes.push({ x: n.x, y: n.y + 1.2, z: n.z, r: SMOKE_RADIUS, until: ticks + SMOKE_TICKS });
    }
    broadcast({ type: 'boom', kind: n.kind, x: r2(n.x), y: r2(n.y), z: r2(n.z) });
  }

  // ---------- боты ----------
  const angDiff = (a, b) => {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  function turnTo(p, yaw, pitch, rate) {
    p.yaw += clamp(angDiff(p.yaw, yaw), -rate, rate);
    p.pitch = clamp(p.pitch + clamp(pitch - p.pitch, -rate, rate), -1.5, 1.5);
  }

  function botThink(p, t) {
    const ai = p.ai;
    const L = botLevel;
    const keys = { f: false, b: false, l: false, r: false, j: false };
    p.keys = keys;
    p.fireHeld = false;
    p.scoped = false;
    if (phase !== 'live') return;

    const w = WEAPONS[p.cur];
    const a = curAmmo(p);
    if (!w.nade && a.mag === 0 && !p.reload) startReload(p, t);

    // выбираем ближайшего противника (раз в несколько шагов)
    if ((ticks + p.id) % 5 === 0 || ai.targetId === null) {
      let best = null;
      let bd = Infinity;
      for (const q of players.values()) {
        if (q === p || q.dummy || !q.alive || !q.inRound || isCloaked(q, t)) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bd) { bd = d; best = q; }
      }
      const id = best ? best.id : null;
      if (id !== ai.targetId) {
        ai.targetId = id; ai.reactAt = t + L.react; ai.aimHead = rand() < L.head; ai.path = null;
      }
    }
    const target = ai.targetId !== null ? players.get(ai.targetId) : null;
    if (!target || !target.alive || isCloaked(target, t)) { ai.targetId = null; return; }

    const eye = { x: p.x, y: p.y + world.EYE, z: p.z };
    const tp = { x: target.x, y: target.y + (ai.aimHead ? 1.6 : 1.05), z: target.z };
    const dx = tp.x - eye.x; const dy = tp.y - eye.y; const dz = tp.z - eye.z;
    const hd = Math.hypot(dx, dz);
    const blind = t < p.blindUntil;
    const visible = !blind && !segBlocked(eye, tp) && !segSmoked(eye, tp);

    if (t >= p.abReadyAt && ((p.char === 'medic' && p.hp < 55) || (visible && rand() < 0.02 && p.char !== 'medic' && p.char !== 'ninja'))) useAbility(p, t);
    let wx = 0; let wz = 0;                  // куда хочет идти бот (в мире)
    const burning = inFire(p);
    if (visible) {
      if (t > ai.errUntil) {
        ai.errYaw = (rand() * 2 - 1) * L.err;
        ai.errPitch = (rand() * 2 - 1) * L.err * 0.6;
        ai.errUntil = t + 350;
      }
      const wantYaw = Math.atan2(-dx, -dz) + ai.errYaw;
      const wantPitch = Math.atan2(dy, hd) + ai.errPitch - p.recoil;   // компенсируем отдачу
      turnTo(p, wantYaw, wantPitch, L.turn);

      const ideal = w.scope ? 24 : p.cur === 'ak47' ? 13 : 9;
      const ux = dx / (hd || 1); const uz = dz / (hd || 1);
      if (t > ai.strafeUntil) { ai.strafeDir = rand() < 0.5 ? -1 : 1; ai.strafeUntil = t + 600 + rand() * 900; }
      if (hd > ideal + 3) { wx = ux; wz = uz; }
      else if (hd < ideal - 3) { wx = -ux; wz = -uz; }
      else if (!w.scope) { wx = uz * ai.strafeDir; wz = -ux * ai.strafeDir; }

      const aligned = Math.abs(angDiff(p.yaw, wantYaw)) < 0.06;
      if (w.scope) p.scoped = !p.reload;
      if (t >= ai.reactAt && aligned && !w.nade) {
        if (w.auto) p.fireHeld = true; else p.clickAt = t;
      }
    } else {
      // не видим цель: идём к ней по карте
      if (!ai.path || t > ai.pathAt) {
        ai.path = nav.findPath(p.x, p.z, target.x, target.z);
        ai.pathAt = t + 700 + rand() * 400;
        ai.pi = 0;
      }
      if (ai.path) {
        while (ai.pi < ai.path.length - 1 && Math.hypot(ai.path[ai.pi].x - p.x, ai.path[ai.pi].z - p.z) < 0.8) ai.pi++;
        const wp = ai.path[ai.pi];
        const ddx = wp.x - p.x; const ddz = wp.z - p.z;
        const dd = Math.hypot(ddx, ddz);
        if (dd > 0.3) { wx = ddx / dd; wz = ddz / dd; }
        turnTo(p, Math.atan2(-wx, -wz), 0, L.turn * 1.5);
      }
      if (a.mag < w.mag * 0.4 && !p.reload && !w.nade) startReload(p, t);   // пока никого не видно - перезаряжаемся
    }

    if (burning) {                           // горим - бежим из огня
      const fx0 = p.x - burning.x; const fz0 = p.z - burning.z; const fl = Math.hypot(fx0, fz0) || 1;
      wx = fx0 / fl; wz = fz0 / fl;
    }
    // переводим направление в нажатия клавиш относительно взгляда
    const fx = -Math.sin(p.yaw); const fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw); const rz = -Math.sin(p.yaw);
    const df = wx * fx + wz * fz;
    const dr = wx * rx + wz * rz;
    keys.f = df > 0.3; keys.b = df < -0.3; keys.r = dr > 0.3; keys.l = dr < -0.3;

    // если упёрлись - прыгаем, потом ищем обход
    const moved = Math.hypot(p.x - ai.lx, p.z - ai.lz);
    ai.lx = p.x; ai.lz = p.z;
    if ((keys.f || keys.b || keys.l || keys.r) && moved < 0.02) ai.stuck++;
    else ai.stuck = Math.max(0, ai.stuck - 1);
    if (ai.stuck > 5) ai.jumpUntil = t + 500;
    if (ai.stuck > 14) { ai.strafeDir *= -1; ai.strafeUntil = t + 700; ai.path = null; ai.stuck = 0; }
    keys.j = t < ai.jumpUntil;
  }

  // ---------- раунды ----------
  function endRound(t, winner) {
    phase = 'end';
    phaseEnd = t + END_MS;
    for (const p of realPlayers()) {
      const bonus = winner && p.id === winner.id ? WIN_BONUS : LOSE_BONUS;
      p.money = Math.min(MAX_MONEY, p.money + bonus);
    }
    const text = winner ? `Раунд выиграл: ${label(winner)} (+$${WIN_BONUS})` : `Раунд окончен (+$${LOSE_BONUS})`;
    broadcast({ type: 'roundEnd', winner: winner ? winner.id : null, text });
  }

  function roundStep(t) {
    if (phase === 'buy') {
      if (t >= phaseEnd) {
        phase = 'live';
        phaseEnd = t + LIVE_MS;
        broadcast({ type: 'phase', phase: 'live', round });
      }
    } else if (phase === 'live') {
      const contenders = realPlayers().filter((p) => p.inRound);
      const alive = contenders.filter((p) => p.alive);
      const hs = humans().filter((p) => p.inRound);
      const humansDead = hs.length > 0 && hs.every((p) => !p.alive);   // все люди погибли - раунд окончен
      if (contenders.length >= 2 && alive.length <= 1) endRound(t, alive[0] || null);
      else if (contenders.length >= 2 && humansDead) endRound(t, null);
      else if (contenders.length === 1 && alive.length === 0) endRound(t, null);   // играешь один и погиб
      else if (t >= phaseEnd) endRound(t, null);
    } else if (phase === 'end') {
      if (t >= phaseEnd) startRound(t, false);
    }
  }

  // ---------- главный шаг (вызывается ~30 раз в секунду) ----------
  const NO_KEYS = { f: false, b: false, l: false, r: false, j: false };

  function tick() {
    const t = now();
    ticks++;
    if (botCount > 0 && humans().length === 0) { phaseEnd = t + BUY_MS; return; }   // людей нет - игра на паузе
    for (const p of players.values()) {
      if (p.dummy) {
        if (!p.alive && t >= p.respawnAt) { p.hp = CHARS[p.char].hp; p.alive = true; }
        continue;
      }
      if (!p.alive) p.keys = NO_KEYS;
      else if (p.ai) botThink(p, t);
      p.speedMul = (p.cur === 'knife' ? KNIFE_SPEED : 1) * CHARS[p.char].speed * (p.char === 'soldier' && abActive(p, t) ? HASTE_MULT : 1);
      if (p.dash) { if (abActive(p, t) && p.alive) { p.vx = p.dash.x; p.vz = p.dash.z; } else p.dash = null; }
      world.stepPlayer(p);
      if (p.alive) combatStep(p, t);
    }
    stepNades(t);
    stepFires(t);
    roundStep(t);
  }

  // ---------- сообщения от игроков ----------
  function onMessage(id, msg) {
    const p = players.get(id);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'input': {
        const k = msg.keys || {};
        p.keys = { f: !!k.f, b: !!k.b, l: !!k.l, r: !!k.r, j: !!k.j };
        if (isNum(msg.yaw)) p.yaw = msg.yaw;
        if (isNum(msg.pitch)) p.pitch = clamp(msg.pitch, -1.6, 1.6);
        p.fireHeld = !!msg.fire;
        p.scoped = !!msg.scope && !!WEAPONS[p.cur].scope && p.alive && !p.reload;
        if (isNum(msg.clicks)) {
          if (msg.clicks > p.clicks && p.alive) p.clickAt = now();
          p.clicks = msg.clicks;
        }
        if (isNum(msg.rclicks)) {
          if (msg.rclicks > p.rclicks && p.alive) p.altAt = now();
          p.rclicks = msg.rclicks;
        }
        break;
      }
      case 'buy':
        if (typeof msg.item === 'string') buy(p, msg.item);
        break;
      case 'chat': {
        if (typeof msg.text !== 'string') break;
        const text = msg.text.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
        const t = now();
        if (!text || t - (p.lastChat || 0) < 400) break;
        p.lastChat = t;
        broadcast({ type: 'chat', id: p.id, name: label(p), text });
        break;
      }
      case 'char':
        setChar(p, msg.id);
        break;
      case 'ability':
        useAbility(p, now());
        break;
      case 'reload':
        if (p.alive) startReload(p, now());
        break;
      case 'select':
        if (p.alive && (msg.slot === 1 || msg.slot === 2 || msg.slot === 3)) select(p, msg.slot);
        else if (p.alive && typeof msg.nade === 'string' && WEAPONS[msg.nade] && WEAPONS[msg.nade].nade) selectNade(p, msg.nade);
        break;
      default:
        break;
    }
  }

  // ---------- данные для клиентов ----------
  function hello(id) {
    const weapons = {};
    for (const [wid, w] of Object.entries(WEAPONS)) weapons[wid] = { name: w.name, auto: w.auto, scope: !!w.scope, mag: w.mag, nade: !!w.nade, melee: !!w.melee, max: w.max || 0 };
    const m = world.MAP;
    return { type: 'hello', id, bounds: world.BOUNDS, eye: world.EYE, boxes: world.BOXES, shop: shopForClient(), chars: CHARS, weapons,
      map: { id: m.id, name: m.name, floor: m.floor, sky: m.sky, wall: m.wall } };
  }

  function snapshot(forId) {
    const t = now();
    const list = [...players.values()].filter((p) => p.id === forId || !isCloaked(p, t)).map((p) => ({
      id: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z),
      yaw: r2(p.yaw), pitch: r2(p.pitch), color: p.color,
      spd: Math.round((Math.hypot(p.vx, p.vz) / world.TICK) * 10) / 10,
      hp: p.hp, armor: Math.round(p.armor), alive: p.alive ? 1 : 0,
      ch: p.char, w: p.cur, k: p.kills, d: p.deaths, bot: p.dummy ? 1 : 0, ai: p.ai ? 1 : 0, name: p.ai ? p.name : '',
    }));
    const me = players.get(forId);
    const a = curAmmo(me);
    return {
      type: 'state',
      round: { n: round, phase, left: Math.max(0, phaseEnd - t) },
      players: list,
      you: {
        money: me.money, hp: me.hp, armor: Math.round(me.armor), alive: me.alive ? 1 : 0,
        w: me.cur, mag: a.mag, reserve: a.reserve,
        reload: me.reload ? r2(1 - Math.max(0, me.reload.until - t) / me.reload.total) : 0,
        recoil: r2(me.recoil),
        primary: me.weapons.primary, pistol: me.weapons.pistol,
        nades: { he: me.nades.he, flash: me.nades.flash, smoke: me.nades.smoke, molotov: me.nades.molotov },
        blind: Math.max(0, r2((me.blindUntil - t) / 1000)),
        ch: me.char, maxHp: CHARS[me.char].hp,
        abLeft: Math.max(0, Math.ceil((me.abReadyAt - t) / 1000)), abOn: abActive(me, t) ? 1 : 0, cloak: isCloaked(me, t) ? 1 : 0,
      },
      nades: nades.map((n) => ({ k: n.kind, x: r2(n.x), y: r2(n.y), z: r2(n.z) })),
      fires: fires.map((f) => ({ x: r2(f.x), y: r2(f.y), z: r2(f.z), r: f.r, left: Math.max(0, Math.round((f.until - ticks) / 30)) })),
      smokes: smokes.map((m) => ({ x: r2(m.x), y: r2(m.y), z: r2(m.z), r: m.r, left: Math.max(0, Math.round((m.until - ticks) / 30)) })),
    };
  }

  return { players, addPlayer, removePlayer, onMessage, tick, hello, snapshot, getPhase: () => phase };
}

module.exports = { CHARS, createGame, rayBox, WEAPONS, SHOP, BUY_MS, LIVE_MS, END_MS, START_MONEY, WIN_BONUS, LOSE_BONUS };
