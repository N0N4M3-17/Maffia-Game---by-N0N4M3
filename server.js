const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;

const state = {
  phase: 'lobby',
  players: [],
  config: {
    mafia: 2,
    sheriff: 1,
    doctor: 1,
    vigilante: 1,
    town: 1,
  },
  round: 0,
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getLanUrls(port) {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(interfaces)) {
    for (const item of iface || []) {
      if (item.family === 'IPv4' && !item.internal) {
        addresses.push(`http://${item.address}:${port}`);
      }
    }
  }
  return addresses;
}

function createRolePool(config) {
  const pool = [];
  for (let i = 0; i < config.mafia; i += 1) pool.push('Mafia');
  for (let i = 0; i < config.sheriff; i += 1) pool.push('Sheriff');
  for (let i = 0; i < config.doctor; i += 1) pool.push('Doctor');
  for (let i = 0; i < config.vigilante; i += 1) pool.push('Vigilante');
  for (let i = 0; i < config.town; i += 1) pool.push('Town');
  return pool;
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function assignRoles() {
  const pool = createRolePool(state.config);
  if (pool.length !== state.players.length) {
    throw new Error(`Role count (${pool.length}) must equal player count (${state.players.length}).`);
  }
  const shuffled = shuffle(pool);
  state.players.forEach((p, idx) => {
    p.role = shuffled[idx];
    p.alive = true;
  });
}

function publicPlayer(player) {
  return { id: player.id, name: player.name, alive: player.alive };
}

function handleApi(req, res, urlObj) {
  if (req.method === 'GET' && urlObj.pathname === '/api/server-info') {
    return json(res, 200, {
      port: Number(PORT),
      localhost: `http://localhost:${PORT}`,
      lanUrls: getLanUrls(PORT),
    });
  }

  if (req.method === 'GET' && urlObj.pathname === '/api/gm-state') {
    const aliveCount = state.players.filter((p) => p.alive).length;
    return json(res, 200, {
      phase: state.phase,
      round: state.round,
      players: state.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, role: p.role || null })),
      playerCount: state.players.length,
      aliveCount,
      config: state.config,
      expectedRoleTotal: createRolePool(state.config).length,
    });
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/join') {
    return readBody(req)
      .then((body) => {
        if (state.phase !== 'lobby') return json(res, 409, { error: 'Game already started.' });
        const name = String(body.name || '').trim();
        if (!name) return json(res, 400, { error: 'Name is required.' });
        if (name.length > 24) return json(res, 400, { error: 'Name max length is 24.' });
        const player = { id: randomUUID(), name, alive: true, role: null };
        state.players.push(player);
        return json(res, 201, { playerId: player.id });
      })
      .catch(() => json(res, 400, { error: 'Invalid JSON body.' }));
  }

  if (req.method === 'GET' && urlObj.pathname.startsWith('/api/player-state/')) {
    const playerId = urlObj.pathname.split('/').pop();
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return json(res, 404, { error: 'Player not found.' });

    return json(res, 200, {
      id: player.id,
      name: player.name,
      phase: state.phase,
      alive: player.alive,
      role: state.phase === 'night0' ? player.role : null,
      players: state.players.map(publicPlayer),
    });
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/gm/config') {
    return readBody(req)
      .then((body) => {
        if (state.phase !== 'lobby') return json(res, 409, { error: 'Cannot update config after game start.' });
        const next = {
          mafia: Number(body.mafia),
          sheriff: Number(body.sheriff),
          doctor: Number(body.doctor),
          vigilante: Number(body.vigilante),
          town: Number(body.town),
        };

        for (const [key, val] of Object.entries(next)) {
          if (!Number.isInteger(val) || val < 0) {
            return json(res, 400, { error: `${key} must be an integer >= 0.` });
          }
        }

        state.config = next;
        return json(res, 200, { ok: true, config: state.config, expectedRoleTotal: createRolePool(state.config).length });
      })
      .catch(() => json(res, 400, { error: 'Invalid JSON body.' }));
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/gm/start') {
    if (state.phase !== 'lobby') return json(res, 409, { error: 'Game already started.' });
    if (state.players.length < 4) return json(res, 400, { error: 'Need at least 4 players to start.' });

    try {
      assignRoles();
      state.phase = 'night0';
      state.round = 0;
      return json(res, 200, { ok: true, phase: state.phase });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/gm/reset') {
    state.phase = 'lobby';
    state.round = 0;
    state.players = [];
    state.config = { mafia: 2, sheriff: 1, doctor: 1, vigilante: 1, town: 1 };
    return json(res, 200, { ok: true });
  }

  return false;
}

function serveStatic(req, res, urlObj) {
  const isRoot = urlObj.pathname === '/';
  const relPath = isRoot ? '/public/index.html' : urlObj.pathname;
  const safePath = path.normalize(relPath).replace(/^\.+/, '');
  const filePath = path.join(__dirname, safePath.startsWith('/public') ? safePath.slice(1) : `public${safePath}`);

  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain; charset=utf-8' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  if (urlObj.pathname.startsWith('/api/')) {
    const handled = handleApi(req, res, urlObj);
    if (handled === false) {
      json(res, 404, { error: 'API route not found.' });
    }
    return;
  }
  serveStatic(req, res, urlObj);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mafia LAN host running on http://0.0.0.0:${PORT}`);
  console.log(`Local access: http://localhost:${PORT}`);
  getLanUrls(PORT).forEach((url) => console.log(`LAN access: ${url}`));
});
