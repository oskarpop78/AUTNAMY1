// Правила мира: размеры, препятствия и физика движения игрока.
// Этот файл используется сервером. Здесь удобно менять карту и скорость.
//
// Движение сделано как в Counter-Strike / Quake, поэтому работает БАНИХОП:
//  - зажми ПРОБЕЛ: игрок прыгает снова и снова, сразу при касании земли;
//  - пока игрок в воздухе, зажми A (или D) и плавно поворачивай мышь в ту же
//    сторону (A - мышь влево, D - мышь вправо): скорость будет расти.

const BOUNDS = 40;        // карта: от -40 до +40 по обеим осям
const RADIUS = 0.4;       // «толщина» игрока
const EYE = 1.6;          // высота глаз над землёй

const TICK = 1 / 30;      // длительность одного шага сервера (30 шагов в секунду)
const SPEED = 0.17;       // скорость ходьбы за один шаг
const GROUND_ACCEL = 10;  // как быстро разгоняешься на земле
const FRICTION = 6;       // как быстро тормозишь на земле, если ничего не нажато
const STOP_SPEED = 0.05;  // ниже этой скорости торможение резкое
const AIR_ACCEL = 12;     // сила «воздушного разгона» (стрейф)
const AIR_CAP = 0.05;     // предел воздушного разгона за шаг (чем больше, тем легче разгоняться)
const MAX_SPEED = 0.5;    // потолок скорости (почти в 3 раза быстрее ходьбы)
const JUMP = 0.24;        // сила прыжка
const GRAVITY = 0.024;    // сила притяжения

// ---------- Карты ----------
// Препятствия: x, z — центр, w — ширина, d — глубина, h — высота.
// Игрок запрыгивает на всё, что ниже ~1.2. Выбрать карту: переменная MAP (arena или city).

// Стены комнаты с проёмами (двери). doors: [{ side: 'N'|'S'|'E'|'W', at: смещение, width }]
function room(cx, cz, w, d, h, doors, color) {
  const T = 1;
  const out = [];
  const edge = (horizontal, fixed, c, len, side) => {
    const door = doors.find((q) => q.side === side);
    const parts = door
      ? [[-len / 2, door.at - door.width / 2], [door.at + door.width / 2, len / 2]]
      : [[-len / 2, len / 2]];
    for (const [a, b] of parts) {
      if (b - a < 0.05) continue;
      const mid = c + (a + b) / 2;
      out.push(horizontal
        ? { x: mid, z: fixed, w: b - a, d: T, h, color }
        : { x: fixed, z: mid, w: T, d: b - a, h, color });
    }
  };
  edge(true, cz - d / 2, cx, w, 'N');
  edge(true, cz + d / 2, cx, w, 'S');
  edge(false, cx - w / 2, cz, d, 'W');
  edge(false, cx + w / 2, cz, d, 'E');
  return out;
}

const ARENA_BOXES = [
  // лестница (на неё можно запрыгнуть)
  { x: 8,   z: -6,  w: 2, d: 4, h: 0.7, color: '#c9a66b' },
  { x: 10,  z: -6,  w: 2, d: 4, h: 1.4, color: '#c28f5a' },
  { x: 12,  z: -6,  w: 2, d: 4, h: 2.1, color: '#b9784a' },
  // башня и стены
  { x: -10, z: -10, w: 3, d: 3, h: 4,   color: '#8e6bbf' },
  { x: 0,   z: -15, w: 12, d: 1, h: 3,  color: '#7f8c8d' },
  { x: -15, z: 5,   w: 1, d: 10, h: 3,  color: '#7f8c8d' },
  // колонны и кубы
  { x: 5,   z: 8,   w: 1.5, d: 1.5, h: 2.5, color: '#e74c3c' },
  { x: -6,  z: 10,  w: 1.5, d: 1.5, h: 1.5, color: '#3498db' },
  { x: 15,  z: 12,  w: 3, d: 3, h: 1,   color: '#f1c40f' },
  { x: -20, z: -4,  w: 2, d: 2, h: 2,   color: '#1abc9c' },
  { x: 0,   z: 20,  w: 8, d: 1, h: 1.2, color: '#e67e22' },
  { x: 20,  z: -20, w: 4, d: 4, h: 5,   color: '#2c3e50' },
  { x: -25, z: 25,  w: 5, d: 5, h: 0.8, color: '#27ae60' },
  { x: 28,  z: 5,   w: 1, d: 8, h: 2.2, color: '#d35400' },
];

const SAND = '#c9b38a';
const SAND2 = '#b89d6e';
const CITY_BOXES = [
  // четыре двора по углам (по два проёма в каждом)
  ...room(-22, -22, 14, 14, 4, [{ side: 'E', at: 0, width: 3.5 }, { side: 'S', at: 0, width: 3.5 }], SAND),
  ...room(22, -22, 14, 14, 4, [{ side: 'W', at: 0, width: 3.5 }, { side: 'S', at: 0, width: 3.5 }], SAND2),
  ...room(-22, 22, 14, 14, 4, [{ side: 'E', at: 0, width: 3.5 }, { side: 'N', at: 0, width: 3.5 }], SAND2),
  ...room(22, 22, 14, 14, 4, [{ side: 'W', at: 0, width: 3.5 }, { side: 'N', at: 0, width: 3.5 }], SAND),
  // внутри дворов: ящики и перегородки
  { x: -25, z: -25, w: 2, d: 2, h: 1.2, color: '#8d6e3f' },
  { x: -20, z: -19, w: 5, d: 1, h: 3, color: '#a68a56' },
  { x: 25, z: -25, w: 2, d: 2, h: 1.2, color: '#8d6e3f' },
  { x: 20, z: -20, w: 1, d: 5, h: 3, color: '#a68a56' },
  { x: -25, z: 25, w: 2, d: 2, h: 1.2, color: '#8d6e3f' },
  { x: -20, z: 20, w: 1, d: 5, h: 3, color: '#a68a56' },
  { x: 25, z: 25, w: 2, d: 2, h: 1.2, color: '#8d6e3f' },
  { x: 20, z: 19, w: 5, d: 1, h: 3, color: '#a68a56' },
  // площадь в центре: фонтан и колонны
  { x: 0, z: 0, w: 4, d: 4, h: 0.6, color: '#7fa6b8' },
  { x: 0, z: 0, w: 1, d: 1, h: 2.2, color: '#9bbccc' },
  { x: 7, z: 7, w: 1.5, d: 1.5, h: 3, color: '#d8c9a3' },
  { x: -7, z: 7, w: 1.5, d: 1.5, h: 3, color: '#d8c9a3' },
  { x: 7, z: -7, w: 1.5, d: 1.5, h: 3, color: '#d8c9a3' },
  { x: -7, z: -7, w: 1.5, d: 1.5, h: 3, color: '#d8c9a3' },
  // укрытия на улицах (низкие стенки и ящики, через них можно перепрыгнуть)
  { x: 0, z: -11, w: 4, d: 1, h: 1.1, color: '#8d6e3f' },
  { x: 0, z: 11, w: 4, d: 1, h: 1.1, color: '#8d6e3f' },
  { x: -11, z: 0, w: 1, d: 4, h: 1.1, color: '#8d6e3f' },
  { x: 11, z: 0, w: 1, d: 4, h: 1.1, color: '#8d6e3f' },
  { x: -11, z: -11, w: 2, d: 2, h: 1.6, color: '#6e8b5a' },
  { x: 11, z: 11, w: 2, d: 2, h: 1.6, color: '#6e8b5a' },
  // контейнеры у края карты
  { x: 35, z: 0, w: 3, d: 9, h: 2.6, color: '#b5523b' },
  { x: -35, z: 0, w: 3, d: 9, h: 2.6, color: '#3b6fb5' },
  { x: 0, z: 35, w: 9, d: 3, h: 2.6, color: '#3bb57a' },
  { x: 0, z: -35, w: 9, d: 3, h: 2.6, color: '#b59b3b' },
  // две башни со ступенями (на башню можно забраться и держать площадь под прицелом)
  { x: 0, z: -25, w: 6, d: 6, h: 3.5, color: '#9c8a64' },
  { x: 0, z: -21.5, w: 4, d: 1, h: 2.8, color: '#b7a47a' },
  { x: 0, z: -20.5, w: 4, d: 1, h: 2.1, color: '#b7a47a' },
  { x: 0, z: -19.5, w: 4, d: 1, h: 1.4, color: '#b7a47a' },
  { x: 0, z: -18.5, w: 4, d: 1, h: 0.7, color: '#b7a47a' },
  { x: 0, z: 25, w: 6, d: 6, h: 3.5, color: '#9c8a64' },
  { x: 0, z: 21.5, w: 4, d: 1, h: 2.8, color: '#b7a47a' },
  { x: 0, z: 20.5, w: 4, d: 1, h: 2.1, color: '#b7a47a' },
  { x: 0, z: 19.5, w: 4, d: 1, h: 1.4, color: '#b7a47a' },
  { x: 0, z: 18.5, w: 4, d: 1, h: 0.7, color: '#b7a47a' },
];

// ---------- Дастовая карта (по мотивам Dust 2) ----------
// Сверху (север, z < 0) база «КТ», внизу (юг) база «Т». Слева туннели и точка B, в центре мид с дверями,
// справа длинный коридор (Long) и точка A.
function seg(x1, z1, x2, z2, h, color) {
  return x1 === x2
    ? { x: x1, z: (z1 + z2) / 2, w: 1, d: Math.abs(z2 - z1), h, color }
    : { x: (x1 + x2) / 2, z: z1, w: Math.abs(x2 - x1), d: 1, h, color };
}
const DW = '#cdb27a';     // стены
const DW2 = '#bfa066';
const DC = '#8b6a3a';     // ящики
const DOOR = '#4f7fb0';   // синие двери
const DUST_BOXES = [
  // граница базы «Т» (юг) с проёмами: туннели, мид, длинный коридор
  seg(-30, 20, -4, 20, 4, DW), seg(4, 20, 30, 20, 4, DW),
  // туннели (слева): коридор вдоль левого края карты, сужение у входа
  seg(-30, 20, -30, -12, 4, DW2), seg(-40, 8, -34.5, 8, 4, DW2), seg(-31.5, 8, -30, 8, 4, DW2),
  // мид: коридор и «двери»
  seg(-4, 20, -4, -8, 4, DW), seg(4, 20, 4, -8, 4, DW),
  seg(-4, -8, -1.5, -8, 3, DOOR), seg(1.5, -8, 4, -8, 3, DOOR),
  // длинный коридор (справа) и длинные двери
  seg(30, 20, 30, -8, 4, DW2), seg(30, 14, 33.5, 14, 4, DOOR), seg(36.5, 14, 40, 14, 4, DOOR),
  // сплошные здания между коридорами
  { x: -17, z: 5.5, w: 24, d: 27, h: 4, color: DW },
  { x: 17, z: 10, w: 24, d: 18, h: 4, color: DW2 },
  // стены баз: КТ - точка A и КТ - точка B
  seg(14, -40, 14, -24, 4, DW), seg(-12, -40, -12, -24, 4, DW),
  // ящики: база Т
  { x: -20, z: 30, w: 3, d: 3, h: 1.5, color: DC }, { x: 10, z: 30, w: 2, d: 2, h: 1.2, color: DC },
  { x: 22, z: 27, w: 4, d: 1, h: 1.2, color: DC }, { x: -8, z: 26, w: 2, d: 2, h: 1.2, color: DC },
  // мид
  { x: 0, z: 12, w: 2, d: 2, h: 1.2, color: DC }, { x: -2.5, z: 2, w: 1.5, d: 1.5, h: 1.2, color: DC },
  { x: 2.5, z: -3, w: 1.5, d: 1.5, h: 1.0, color: DC },
  // длинный коридор: ящики, «синий ящик»
  { x: 35, z: 4, w: 2, d: 2, h: 1.2, color: DC }, { x: 34, z: -4, w: 3, d: 3, h: 2.2, color: DOOR },
  // туннели
  { x: -36, z: 0, w: 2, d: 2, h: 1.2, color: DC },
  // точка A: ящики, платформа со ступенями
  { x: 22, z: -31, w: 3, d: 3, h: 1.5, color: DC }, { x: 28, z: -22, w: 2, d: 2, h: 1.2, color: DC },
  { x: 34, z: -34, w: 3, d: 3, h: 2, color: DC }, { x: 36, z: -16, w: 4, d: 4, h: 1.2, color: DC },
  { x: 24, z: -37, w: 10, d: 4, h: 1.4, color: '#a58a58' }, { x: 24, z: -34.5, w: 4, d: 1, h: 0.7, color: '#b99d68' },
  // точка B: ящики, платформа
  { x: -30, z: -30, w: 3, d: 3, h: 1.5, color: DC }, { x: -22, z: -34, w: 4, d: 2, h: 1.2, color: DC },
  { x: -20, z: -20, w: 2, d: 2, h: 2, color: DC }, { x: -35, z: -22, w: 4, d: 4, h: 0.7, color: '#a58a58' },
  // КТ база
  { x: 0, z: -30, w: 4, d: 2, h: 1.2, color: DC }, { x: -6, z: -16, w: 2, d: 2, h: 1.5, color: DC },
  { x: 8, z: -18, w: 3, d: 1, h: 1.2, color: DC },
];

const MAPS = {
  arena: {
    id: 'arena', name: 'Арена', floor: [0.36, 0.62, 0.36], sky: [0.53, 0.81, 0.92], wall: [0.55, 0.55, 0.6],
    boxes: ARENA_BOXES, dummies: [[0, -6], [-6, 2], [10, 6]],
  },
  dust: {
    id: 'dust', name: 'Дастовая', floor: [0.82, 0.72, 0.5], sky: [0.72, 0.84, 0.95], wall: [0.7, 0.6, 0.42],
    boxes: DUST_BOXES, dummies: [[0, 6], [20, -26], [-25, -25]],
    spawns: [[-36, -12, 24, 37], [12, 36, 24, 37], [-10, 12, -38, -27]],
  },
  city: {
    id: 'city', name: 'Пустынный город', floor: [0.78, 0.7, 0.52], sky: [0.74, 0.84, 0.93], wall: [0.62, 0.55, 0.42],
    boxes: CITY_BOXES, dummies: [[0, -8], [-8, 8], [9, 8]],
  },
};

const BOXES = [];          // текущая карта (один и тот же массив, его заполняет setMap)
let MAP = MAPS.arena;
function setMap(name) {
  MAP = MAPS[name] || MAPS.arena;
  BOXES.length = 0;
  for (const b of MAP.boxes) BOXES.push(b);
  module.exports.MAP = MAP;
}

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ec407a'];

function insideFootprint(b, x, z, pad) {
  return Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad;
}

// На какой высоте «пол» под игроком (земля или верх коробки, если стоим над ней)
function groundAt(x, z, y) {
  let g = 0;
  for (const b of BOXES) {
    if (insideFootprint(b, x, z, 0) && y >= b.h - 0.05 && b.h > g) g = b.h;
  }
  return g;
}

// Выталкиваем игрока из препятствий, в которые он «влез» сбоку,
// и гасим скорость в сторону стены (вдоль стены можно скользить)
function pushOut(p) {
  for (const b of BOXES) {
    if (p.y >= b.h - 0.05) continue; // мы выше коробки, она не мешает
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const ox = b.w / 2 + RADIUS - Math.abs(dx);
    const oz = b.d / 2 + RADIUS - Math.abs(dz);
    if (ox > 0 && oz > 0) {
      if (ox < oz) {
        const s = dx >= 0 ? 1 : -1;
        p.x += s * ox;
        if (p.vx * s < 0) p.vx = 0;
      } else {
        const s = dz >= 0 ? 1 : -1;
        p.z += s * oz;
        if (p.vz * s < 0) p.vz = 0;
      }
    }
  }
}

function createPlayer(id) {
  let x = 0;
  let z = 0;
  for (let i = 0; i < 100; i++) {
    if (MAP.spawns) {                    // у карты есть свои зоны появления
      const r = MAP.spawns[Math.floor(Math.random() * MAP.spawns.length)];
      x = r[0] + Math.random() * (r[1] - r[0]);
      z = r[2] + Math.random() * (r[3] - r[2]);
    } else {
      x = (Math.random() * 2 - 1) * (BOUNDS - 10);
      z = (Math.random() * 2 - 1) * (BOUNDS - 10);
    }
    if (!BOXES.some((b) => insideFootprint(b, x, z, 1.5))) break;
  }
  return {
    x, y: 0, z,
    vx: 0, vz: 0, vy: 0,
    yaw: 0,
    pitch: 0,
    onGround: true,
    color: PLAYER_COLORS[id % PLAYER_COLORS.length],
    keys: { f: false, b: false, l: false, r: false, j: false },
  };
}

// Разгон в нужную сторону (wx, wz — направление, wishspeed — желаемая скорость).
// Это формула из Quake/Source: именно из-за неё работает воздушный стрейф.
function accelerate(p, wx, wz, wishspeed, accel, cap) {
  const limited = cap === undefined ? wishspeed : Math.min(wishspeed, cap);
  const current = p.vx * wx + p.vz * wz;  // насколько уже летим в нужную сторону
  const add = limited - current;
  if (add <= 0) return;
  const a = Math.min(accel * wishspeed * TICK, add);
  p.vx += a * wx;
  p.vz += a * wz;
}

// Один шаг игры для одного игрока
function stepPlayer(p) {
  // направление взгляда (yaw = 0 смотрит «вперёд», в сторону -Z)
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);

  // куда игрок хочет идти
  let mx = 0;
  let mz = 0;
  if (p.keys.f) { mx += fx; mz += fz; }
  if (p.keys.b) { mx -= fx; mz -= fz; }
  if (p.keys.r) { mx += rx; mz += rz; }
  if (p.keys.l) { mx -= rx; mz -= rz; }
  const len = Math.hypot(mx, mz);
  const wx = len > 0 ? mx / len : 0;
  const wz = len > 0 ? mz / len : 0;
  const base = SPEED * (p.speedMul || 1);  // с тяжёлым оружием ходишь медленнее

  // прыжок: пока пробел зажат, прыгаем сразу при касании земли (авто-хоп)
  if (p.keys.j && p.onGround) {
    p.vy = JUMP;
    p.onGround = false;
  }

  if (p.onGround) {
    // трение о землю
    const speed = Math.hypot(p.vx, p.vz);
    if (speed > 0) {
      const drop = Math.max(speed, STOP_SPEED) * FRICTION * TICK;
      const k = Math.max(speed - drop, 0) / speed;
      p.vx *= k;
      p.vz *= k;
    }
    if (len > 0) accelerate(p, wx, wz, base, GROUND_ACCEL);
  } else if (len > 0) {
    // в воздухе: трения нет, а разгон ограничен AIR_CAP.
    // Если летишь медленнее обычной ходьбы, управлять в воздухе можно свободно,
    // чтобы прыжок с места или после остановки не «застревал».
    const flying = Math.hypot(p.vx, p.vz);
    accelerate(p, wx, wz, base, AIR_ACCEL, flying < base ? undefined : AIR_CAP);
  }

  // потолок скорости
  const hs = Math.hypot(p.vx, p.vz);
  if (hs > MAX_SPEED) {
    p.vx *= MAX_SPEED / hs;
    p.vz *= MAX_SPEED / hs;
  }

  // двигаемся
  p.x += p.vx;
  p.z += p.vz;

  const lim = BOUNDS - RADIUS;
  if (p.x > lim) { p.x = lim; if (p.vx > 0) p.vx = 0; }
  if (p.x < -lim) { p.x = -lim; if (p.vx < 0) p.vx = 0; }
  if (p.z > lim) { p.z = lim; if (p.vz > 0) p.vz = 0; }
  if (p.z < -lim) { p.z = -lim; if (p.vz < 0) p.vz = 0; }
  pushOut(p);
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));

  // падение
  p.vy -= GRAVITY;
  const ground = groundAt(p.x, p.z, p.y);
  const ny = p.y + p.vy;
  if (ny <= ground) {
    p.y = ground;
    p.vy = 0;
    p.onGround = true;
  } else {
    p.y = ny;
    p.onGround = false;
  }
}

setMap('arena');

module.exports = { BOUNDS, RADIUS, EYE, BOXES, MAPS, MAP, setMap, TICK, SPEED, createPlayer, stepPlayer };
