// Сервер 3D-игры. Запускается на твоём компьютере.
// Нужен только Node.js, больше ничего устанавливать не надо.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const HOSTED = !!process.env.PORT;                 // true, если игра запущена на хостинге в интернете
const PORT = Number(process.env.PORT) || 3000;     // порт, по которому подключаются игроки
const TICK_MS = 33;     // шаг игры: ~30 раз в секунду

// ---------- 1. Обычный веб-сервер: отдаёт страницу игры браузеру ----------
function onRequest(req, res) {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Не найден index.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}
const server = http.createServer(onRequest);

// ---------- 2. Мини-реализация WebSocket (связь с игроками в реальном времени) ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function sendFrame(socket, opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function sendText(socket, text) {
  if (!socket.destroyed) sendFrame(socket, 0x1, Buffer.from(text, 'utf8'));
}

// Разбираем входящие данные от игрока на сообщения
function attachParser(socket, onMessage, onClose, onBinary) {
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let len = buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        len = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (len > 1024 * 64) { socket.destroy(); return; } // защита от огромных сообщений
      const maskLen = masked ? 4 : 0;
      if (buffer.length < offset + maskLen + len) return; // ждём остальные данные
      let payload = buffer.slice(offset + maskLen, offset + maskLen + len);
      if (masked) {
        const mask = buffer.slice(offset, offset + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      }
      buffer = buffer.slice(offset + maskLen + len);

      if (opcode === 0x1) onMessage(payload.toString('utf8'));
      else if (opcode === 0x2) { if (onBinary) onBinary(payload); }
      else if (opcode === 0x8) { sendFrame(socket, 0x8, Buffer.alloc(0)); socket.end(); return; }
      else if (opcode === 0x9) sendFrame(socket, 0xA, payload); // ping -> pong
    }
  });
  socket.on('close', onClose);
  socket.on('error', () => socket.destroy());
}

// ---------- 3. Игра ----------
const world = require('./world');
world.setMap(process.env.MAP || 'dust');   // карта: dust (Dust), city (город) или arena (арена)
const { createGame } = require('./game');

let nextId = 1;
const socketById = new Map(); // id игрока -> сокет

const game = createGame({
  startMoney: Number(process.env.START_MONEY) || undefined, // для тренировки: start-training.bat
  bots: Number(process.env.BOTS) || 0,                      // сколько ботов-противников
  botLevel: Number(process.env.BOT_LEVEL) || 2,             // сложность ботов: 1 лёгкие, 2 средние, 3 сложные
  // сообщение одному игроку
  send: (id, msg) => {
    const s = socketById.get(id);
    if (s) sendText(s, JSON.stringify(msg));
  },
  // сообщение всем
  broadcast: (msg) => {
    const text = JSON.stringify(msg);
    for (const s of socketById.values()) sendText(s, text);
  },
});

function onUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);

  const id = nextId++;
  socketById.set(id, socket);
  sendText(socket, JSON.stringify(game.hello(id))); // номер игрока, карта, магазин
  game.addPlayer(id);
  console.log(`Игрок ${id} зашёл. Сейчас игроков: ${socketById.size}`);

  attachParser(
    socket,
    (text) => {
      try {
        game.onMessage(id, JSON.parse(text));
      } catch (e) {
        // игнорируем неправильные сообщения
      }
    },
    () => {
      socketById.delete(id);
      game.removePlayer(id);
      console.log(`Игрок ${id} вышел. Сейчас игроков: ${socketById.size}`);
    },
    // голосовой чат: пересылаем звук всем остальным (2 байта - номер говорящего, дальше звук)
    (audio) => {
      if (audio.length < 2 || audio.length > 8192) return;
      const frame = Buffer.concat([Buffer.from([id & 255, (id >> 8) & 255]), audio]);
      for (const [oid, s] of socketById) if (oid !== id && !s.destroyed) sendFrame(s, 0x2, frame);
    }
  );
}
server.on('upgrade', onUpgrade);

// ---------- 4. Главный цикл игры ----------
setInterval(() => {
  game.tick();
  for (const [id, s] of socketById) {
    if (game.players.has(id)) sendText(s, JSON.stringify(game.snapshot(id)));
  }
}, TICK_MS);

// Защищённый вариант (https): нужен, чтобы у друзей по сети работал микрофон
const HTTPS_PORT = 3443;
let secure = null;
try {
  if (HOSTED) throw new Error('hosted');   // на хостинге https даёт сам хостинг
  secure = https.createServer({
    key: fs.readFileSync(path.join(__dirname, 'cert', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'cert', 'cert.pem')),
  }, onRequest);
  secure.on('upgrade', onUpgrade);
  secure.on('error', (e) => console.log('Защищённый порт ' + HTTPS_PORT + ' не запустился: ' + e.message));
  secure.listen(HTTPS_PORT);
} catch (e) {
  secure = null;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('=== Сервер игры AUTNAMY запущен ===');
  console.log(`Карта: ${world.MAP.name}.  Ботов: ${Number(process.env.BOTS) || 0}`);
  console.log(`Ты:                    http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`Друзья (тот же Wi-Fi): http://${net.address}:${PORT}`);
        if (secure) console.log(`Друзья с микрофоном:   https://${net.address}:${HTTPS_PORT}  (браузер предупредит: «Дополнительно» -> «Всё равно перейти»)`);
      }
    }
  }
  console.log('Чтобы остановить сервер, закрой это окно.');
  console.log('');
});
