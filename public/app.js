const state = {
  playerId: localStorage.getItem('playerId') || null,
  playerRole: null,
  roles: { mafia: 1, sheriff: 1, doctor: 0, vigilante: 0 },
  gmPoll: null,
  playerPoll: null,
  lanUrls: [],
  localhost: '',
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  const next = document.getElementById(screenId);
  if (next) next.classList.add('active');

  if (screenId === 'screen-gm-setup') {
    startGmPolling();
  } else if (screenId === 'screen-night0-player' || screenId === 'screen-player-join') {
    startPlayerPolling();
  } else {
    stopPolling();
  }
}

function stopPolling() {
  if (state.gmPoll) clearInterval(state.gmPoll);
  if (state.playerPoll) clearInterval(state.playerPoll);
  state.gmPoll = null;
  state.playerPoll = null;
}

function roleDescription(role) {
  const map = {
    Mafia: 'Eliminate town each night with your team. Blend in by day.',
    Sheriff: 'Investigate one player each night for alignment.',
    Doctor: 'Protect one player each night (self-protect allowed, no repeat).',
    Vigilante: 'Optional night shot with limited ammo. Use carefully.',
    Town: 'Find and eliminate all mafia through discussion and voting.',
  };
  return map[role] || 'Unknown role.';
}

function roleCardClass(role) {
  if (role === 'Mafia') return 'mafia';
  if (role === 'Town') return 'town';
  return 'special';
}

async function refreshGm() {
  try {
    const [info, gm] = await Promise.all([api('/api/server-info'), api('/api/gm-state')]);
    state.lanUrls = info.lanUrls || [];
    state.localhost = info.localhost || '';

    document.getElementById('gm-primary-lan').textContent = state.lanUrls[0] || 'No LAN IP detected';
    document.getElementById('gm-local-url').textContent = state.localhost;
    document.getElementById('gm-phase-pill').textContent = gm.phase;
    document.getElementById('player-count').textContent = String(gm.playerCount);
    document.getElementById('roster-count').textContent = String(gm.playerCount);

    const roster = document.getElementById('player-roster');
    roster.innerHTML = gm.players.length
      ? gm.players.map((p) => `<div class="player-row flex items-center justify-between p-3 bg-midnight rounded-lg"><span>${p.name}</span><span class="text-xs ${p.alive ? 'text-green-400' : 'text-red-400'}">${p.alive ? 'Ready' : 'Dead'}</span></div>`).join('')
      : '<p class="text-mist text-sm">No players joined yet.</p>';

    // pull server config to keep UI in sync when refreshed
    if (gm.phase === 'lobby') {
      state.roles.mafia = gm.config.mafia;
      state.roles.sheriff = gm.config.sheriff;
      state.roles.doctor = gm.config.doctor;
      state.roles.vigilante = gm.config.vigilante;
      updateRoleInputs();
    }

    updateTownAndValidation(gm.playerCount);
  } catch (err) {
    const msg = document.getElementById('gm-msg');
    if (msg) msg.textContent = err.message;
  }
}

function startGmPolling() {
  stopPolling();
  refreshGm();
  state.gmPoll = setInterval(refreshGm, 1200);
}

async function attemptJoin() {
  const input = document.getElementById('player-name-input');
  const err = document.getElementById('name-error');
  const status = document.getElementById('join-status');
  const name = input.value.trim();
  if (!name) {
    err.textContent = 'Name is required.';
    err.classList.remove('hidden');
    return;
  }
  err.classList.add('hidden');
  status.textContent = 'Joining game...';

  try {
    const res = await api('/api/join', { method: 'POST', body: JSON.stringify({ name }) });
    state.playerId = res.playerId;
    localStorage.setItem('playerId', res.playerId);
    status.textContent = 'Joined successfully. Waiting for GM to start...';
    startPlayerPolling();
  } catch (e) {
    status.textContent = e.message;
  }
}

async function refreshPlayer() {
  if (!state.playerId) return;
  try {
    const st = await api(`/api/player-state/${state.playerId}`);
    document.getElementById('player-name-label').textContent = st.name;
    state.playerRole = st.role;

    if (st.phase === 'night0') {
      showScreen('screen-night0-player');
      if (st.role) {
        const roleName = document.getElementById('role-name');
        const roleDesc = document.getElementById('role-desc');
        const roleCard = document.getElementById('role-card');
        roleName.textContent = st.role.toUpperCase();
        roleDesc.textContent = roleDescription(st.role);
        roleCard.classList.remove('mafia', 'town', 'special');
        roleCard.classList.add(roleCardClass(st.role));
      }
    }
  } catch (e) {
    localStorage.removeItem('playerId');
    state.playerId = null;
    const status = document.getElementById('join-status');
    if (status) status.textContent = 'Session expired. Join again.';
  }
}

function startPlayerPolling() {
  stopPolling();
  refreshPlayer();
  state.playerPoll = setInterval(refreshPlayer, 1200);
}

function adjustRole(role, delta) {
  state.roles[role] = Math.max(0, Math.min(10, state.roles[role] + delta));
  updateRoleInputs();
  updateTownAndValidation(Number(document.getElementById('player-count').textContent || 0));
}

function updateRoleInputs() {
  document.getElementById('mafia-count').textContent = String(state.roles.mafia);
  document.getElementById('sheriff-count').textContent = String(state.roles.sheriff);
  document.getElementById('doctor-count').textContent = String(state.roles.doctor);
  document.getElementById('vigilante-count').textContent = String(state.roles.vigilante);
}

function calculatedTown(playerCount) {
  const specialTotal = state.roles.mafia + state.roles.sheriff + state.roles.doctor + state.roles.vigilante;
  return Math.max(0, playerCount - specialTotal);
}

function updateTownAndValidation(playerCount) {
  const town = calculatedTown(playerCount);
  const total = state.roles.mafia + state.roles.sheriff + state.roles.doctor + state.roles.vigilante + town;
  document.getElementById('town-count').textContent = String(town);
  document.getElementById('total-roles').textContent = String(total);

  const hasPower = state.roles.sheriff + state.roles.doctor + state.roles.vigilante >= 1;
  const valid = playerCount >= 3 && state.roles.mafia >= 1 && town >= 1 && hasPower && total === playerCount;
  const status = document.getElementById('validation-status');
  status.className = `mt-2 text-sm ${valid ? 'text-green-400' : 'text-yellow-300'}`;
  status.textContent = valid
    ? 'Ready to start (testing rules satisfied).'
    : 'Need >=3 players, 1 Mafia, 1 Sheriff/Doctor/Vigilante, 1 Town.';
}

async function saveSetup() {
  const playerCount = Number(document.getElementById('player-count').textContent || 0);
  const town = calculatedTown(playerCount);
  const payload = { ...state.roles, town };
  const msg = document.getElementById('gm-msg');
  try {
    await api('/api/gm/config', { method: 'POST', body: JSON.stringify(payload) });
    msg.textContent = `Setup saved: ${payload.mafia} Mafia, ${payload.sheriff} Sheriff, ${payload.doctor} Doctor, ${payload.vigilante} Vigilante, ${payload.town} Town.`;
    await refreshGm();
  } catch (e) {
    msg.textContent = e.message;
    throw e;
  }
}

async function launchGame() {
  const msg = document.getElementById('gm-msg');
  try {
    // Fixes stale-config launch bug: always save current stepper values right before start.
    await saveSetup();
    await api('/api/gm/start', { method: 'POST', body: '{}' });
    msg.textContent = 'Game launched. Night 0 is live.';
    await refreshGm();
  } catch (e) {
    msg.textContent = e.message;
  }
}

async function resetLobby() {
  const msg = document.getElementById('gm-msg');
  await api('/api/gm/reset', { method: 'POST', body: '{}' });
  msg.textContent = 'Lobby reset.';
  state.roles = { mafia: 1, sheriff: 1, doctor: 0, vigilante: 0 };
  updateRoleInputs();
  await refreshGm();
}

function revealRole() {
  document.getElementById('role-hidden').classList.add('hidden');
  document.getElementById('role-revealed').classList.remove('hidden');
}
function hideRole() {
  document.getElementById('role-revealed').classList.add('hidden');
  document.getElementById('role-hidden').classList.remove('hidden');
}
function acknowledgeRole() {
  document.getElementById('role-revealed').classList.add('hidden');
  document.getElementById('role-acknowledged').classList.remove('hidden');
}

function copyToClipboard() {
  const text = state.lanUrls[0] || state.localhost;
  if (!text) return;
  navigator.clipboard.writeText(text);
}

window.showScreen = showScreen;
window.attemptJoin = attemptJoin;
window.adjustRole = adjustRole;
window.saveSetup = saveSetup;
window.launchGame = launchGame;
window.resetLobby = resetLobby;
window.revealRole = revealRole;
window.hideRole = hideRole;
window.acknowledgeRole = acknowledgeRole;
window.copyToClipboard = copyToClipboard;

(function init() {
  updateRoleInputs();
  if (state.playerId) {
    showScreen('screen-player-join');
    startPlayerPolling();
  }
})();
