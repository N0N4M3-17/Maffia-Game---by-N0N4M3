const app = document.getElementById('app');

const client = {
  mode: null,
  playerId: localStorage.getItem('playerId') || null,
  gmPolling: null,
  playerPolling: null,
};

function html(strings, ...vals) {
  return strings.map((s, i) => s + (vals[i] ?? '')).join('');
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function renderHome() {
  app.innerHTML = html`
    <div class="grid two">
      <section class="card">
        <h1>Mafia 2.0 — LAN Browser Host</h1>
        <p class="small">Landscape-first responsive UI for phone and browser clients.</p>
        <p class="small landscape-note">Tip: rotate phones to landscape for the best layout.</p>
      </section>
      <section class="card">
        <h2>Choose client mode</h2>
        <div class="row">
          <button class="primary" id="gmBtn">Host as GM</button>
          <button id="playerBtn">Join as Player</button>
        </div>
      </section>
    </div>
  `;

  document.getElementById('gmBtn').onclick = () => {
    client.mode = 'gm';
    renderGm();
  };
  document.getElementById('playerBtn').onclick = () => {
    client.mode = 'player';
    renderPlayerJoin();
  };
}

async function renderGm() {
  clearIntervals();
  app.innerHTML = '<section class="card"><p>Loading GM dashboard...</p></section>';
  const [info, gm] = await Promise.all([api('/api/server-info'), api('/api/gm-state')]);

  app.innerHTML = html`
    <div class="grid two">
      <section class="card">
        <h2>GM Lobby</h2>
        <p class="small">Share one of these LAN URLs with players:</p>
        <ul class="list">
          ${(info.lanUrls || []).map((u) => `<li><code>${u}</code></li>`).join('') || '<li>No LAN IP detected</li>'}
        </ul>
        <p class="small">Local: <code>${info.localhost}</code></p>
        <p class="small">Phase: <span class="pill">${gm.phase}</span></p>
        <p class="small">Players joined: ${gm.playerCount}</p>
      </section>

      <section class="card">
        <h3>Role Setup</h3>
        <div class="grid">
          ${['mafia', 'sheriff', 'doctor', 'vigilante', 'town'].map((r) => `
            <label>${r[0].toUpperCase() + r.slice(1)}
              <input type="number" min="0" id="role-${r}" value="${gm.config[r]}" />
            </label>
          `).join('')}
          <p class="small">Role total: <b id="roleTotal">${gm.expectedRoleTotal}</b> (must equal player count)</p>
          <div class="row">
            <button id="saveConfig">Save setup</button>
            <button class="good" id="startGame">Launch Game (Night 0)</button>
            <button class="warn" id="resetLobby">Reset Lobby</button>
          </div>
          <p class="small" id="gmMsg"></p>
        </div>
      </section>

      <section class="card" style="grid-column: 1 / -1;">
        <h3>Connected Players</h3>
        <ul class="list" id="playerList">
          ${gm.players.map((p) => `<li>${p.name}${gm.phase === 'night0' && p.role ? ` — <b>${p.role}</b>` : ''}</li>`).join('') || '<li>No players yet</li>'}
        </ul>
      </section>
    </div>
  `;

  wireGmActions();
  client.gmPolling = setInterval(refreshGmState, 1200);
}

async function refreshGmState() {
  try {
    const gm = await api('/api/gm-state');
    const list = document.getElementById('playerList');
    if (!list) return;
    list.innerHTML = gm.players.map((p) => `<li>${p.name}${gm.phase === 'night0' && p.role ? ` — <b>${p.role}</b>` : ''}</li>`).join('') || '<li>No players yet</li>';
    const badge = document.querySelector('.pill');
    if (badge) badge.textContent = gm.phase;
  } catch (e) {}
}

function wireGmActions() {
  const msg = document.getElementById('gmMsg');
  const roleInputs = ['mafia', 'sheriff', 'doctor', 'vigilante', 'town'];

  const updateTotal = () => {
    const total = roleInputs.reduce((sum, r) => sum + Number(document.getElementById(`role-${r}`).value || 0), 0);
    document.getElementById('roleTotal').textContent = String(total);
  };

  roleInputs.forEach((r) => document.getElementById(`role-${r}`).addEventListener('input', updateTotal));

  document.getElementById('saveConfig').onclick = async () => {
    try {
      const body = Object.fromEntries(roleInputs.map((r) => [r, Number(document.getElementById(`role-${r}`).value)]));
      await api('/api/gm/config', { method: 'POST', body: JSON.stringify(body) });
      msg.textContent = 'Setup saved.';
      await refreshGmState();
    } catch (e) {
      msg.textContent = e.message;
    }
  };

  document.getElementById('startGame').onclick = async () => {
    try {
      await api('/api/gm/start', { method: 'POST' });
      msg.textContent = 'Game launched. Night 0 role reveal active.';
      await refreshGmState();
    } catch (e) {
      msg.textContent = e.message;
    }
  };

  document.getElementById('resetLobby').onclick = async () => {
    await api('/api/gm/reset', { method: 'POST' });
    msg.textContent = 'Lobby reset.';
    renderGm();
  };
}

function renderPlayerJoin() {
  clearIntervals();
  app.innerHTML = html`
    <section class="card">
      <h2>Join Lobby</h2>
      <p class="small">Enter only your name, then wait for the GM to launch Night 0.</p>
      <div class="row">
        <input id="playerName" maxlength="24" placeholder="Your name" />
        <button class="primary" id="joinBtn">Join</button>
      </div>
      <p class="small" id="joinMsg"></p>
    </section>
  `;

  document.getElementById('joinBtn').onclick = async () => {
    const name = document.getElementById('playerName').value;
    const msg = document.getElementById('joinMsg');
    try {
      const res = await api('/api/join', { method: 'POST', body: JSON.stringify({ name }) });
      localStorage.setItem('playerId', res.playerId);
      client.playerId = res.playerId;
      renderPlayerState();
    } catch (e) {
      msg.textContent = e.message;
    }
  };
}

async function renderPlayerState() {
  clearIntervals();
  if (!client.playerId) return renderPlayerJoin();

  app.innerHTML = '<section class="card"><p>Loading player state...</p></section>';
  try {
    const st = await api(`/api/player-state/${client.playerId}`);
    app.innerHTML = html`
      <div class="grid two">
        <section class="card">
          <h2>Player: ${st.name}</h2>
          <p class="small">Phase: <span class="pill">${st.phase}</span></p>
          <p class="small landscape-note">Rotate device to landscape for improved readability.</p>
          ${st.phase === 'night0' && st.role ? `<div class="role">Your role: ${st.role}</div>` : '<p>Waiting for GM to launch game...</p>'}
        </section>

        <section class="card">
          <h3>Lobby Roster</h3>
          <ul class="list">
            ${st.players.map((p) => `<li>${p.name}${p.alive ? '' : ' (dead)'}</li>`).join('')}
          </ul>
          <p class="small">Night 0: role is shown privately in the app, then identities are handled by GM in person.</p>
        </section>
      </div>
    `;
  } catch (e) {
    localStorage.removeItem('playerId');
    client.playerId = null;
    return renderPlayerJoin();
  }

  client.playerPolling = setInterval(async () => {
    if (!client.playerId) return;
    try {
      const st = await api(`/api/player-state/${client.playerId}`);
      const badge = document.querySelector('.pill');
      if (badge) badge.textContent = st.phase;
      const roleBox = document.querySelector('.role');
      if (st.phase === 'night0' && st.role && !roleBox) {
        renderPlayerState();
      }
    } catch (_) {}
  }, 1200);
}

function clearIntervals() {
  if (client.gmPolling) clearInterval(client.gmPolling);
  if (client.playerPolling) clearInterval(client.playerPolling);
  client.gmPolling = null;
  client.playerPolling = null;
}

if (client.playerId) {
  renderPlayerState();
} else {
  renderHome();
}
