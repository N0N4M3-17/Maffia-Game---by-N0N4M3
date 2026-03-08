const state = {
  playerId: localStorage.getItem('playerId') || null,
  roles: { mafia: 1, sheriff: 1, doctor: 0, vigilante: 0, town: 1 },
  vigilanteShots: 1,
  roleDirty: false,
  gmPoll: null,
  playerPoll: null,
  lanUrls: [],
  localhost: '',
  playerState: null,
};

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  if (id === 'screen-gm') startGmPolling();
  else if (id === 'screen-player') startPlayerPolling();
  else stopPolling();
}

function stopPolling() {
  if (state.gmPoll) clearInterval(state.gmPoll);
  if (state.playerPoll) clearInterval(state.playerPoll);
  state.gmPoll = null;
  state.playerPoll = null;
}

function roleTotal() {
  return state.roles.mafia + state.roles.sheriff + state.roles.doctor + state.roles.vigilante + state.roles.town;
}

function updateRoleInputs() {
  for (const r of ['mafia','sheriff','doctor','vigilante','town']) document.getElementById(`${r}-count`).textContent = String(state.roles[r]);
  document.getElementById('vigi-shots-count').textContent = String(state.vigilanteShots);
  document.getElementById('total-roles').textContent = String(roleTotal());
}

function updateValidation(playerCount) {
  const hasPower = state.roles.sheriff + state.roles.doctor + state.roles.vigilante >= 1;
  const total = roleTotal();
  const ok = playerCount >= 3 && total === playerCount && state.roles.mafia >= 1 && hasPower && state.roles.town >= 1;
  document.getElementById('validation-status').textContent = ok
    ? 'Ready to start.'
    : total !== playerCount
      ? `Role total (${total}) must equal connected players (${playerCount}).`
      : 'Need >=3 players, >=1 Mafia, >=1 Sheriff/Doctor/Vigilante, >=1 Town.';
  document.getElementById('validation-status').className = `text-sm ${ok ? 'text-green-400' : 'text-yellow-300'}`;
}

function adjustRole(role, delta) {
  state.roles[role] = Math.max(0, Math.min(20, state.roles[role] + delta));
  state.roleDirty = true;
  updateRoleInputs();
  updateValidation(Number(document.getElementById('player-count').textContent || 0));
}

function adjustVigiShots(delta) {
  state.vigilanteShots = Math.max(0, Math.min(10, state.vigilanteShots + delta));
  state.roleDirty = true;
  updateRoleInputs();
}

async function refreshGm() {
  const [info, gm] = await Promise.all([api('/api/server-info'), api('/api/gm-state')]);
  state.lanUrls = info.lanUrls || [];
  state.localhost = info.localhost || '';

  document.getElementById('gm-primary-lan').textContent = state.lanUrls[0] || 'No LAN IP detected';
  document.getElementById('gm-local-url').textContent = state.localhost;
  document.getElementById('gm-phase-pill').textContent = gm.phase;
  document.getElementById('player-count').textContent = String(gm.playerCount);
  document.getElementById('roster-count').textContent = String(gm.playerCount);

  if (gm.phase === 'lobby' && !state.roleDirty) {
    state.roles = {
      mafia: gm.config.mafia,
      sheriff: gm.config.sheriff,
      doctor: gm.config.doctor,
      vigilante: gm.config.vigilante,
      town: gm.config.town,
    };
    state.vigilanteShots = gm.config.vigilanteShots || 1;
    updateRoleInputs();
  }

  updateValidation(gm.playerCount);

  document.getElementById('player-roster').innerHTML = gm.players.length
    ? gm.players.map((p) => `<div class="bg-midnight rounded p-2 flex justify-between"><span>${p.name}${p.role ? ` (${p.role})` : ''}</span><span class="${p.alive ? 'text-green-400' : 'text-red-400'}">${p.alive ? 'Alive' : 'Dead'}</span></div>`).join('')
    : '<p class="text-mist">No players.</p>';

  document.getElementById('gm-action-status').textContent = JSON.stringify({
    round: gm.round,
    nightStep: gm.nightStep,
    discussionRemainingSec: gm.discussionRemainingSec,
    sheriffResult: gm.lastSheriffResult,
    morningDeaths: gm.morningDeaths,
    dayVoteTally: gm.dayVoteTally,
    mafiaVoteTally: gm.mafiaVoteTally,
    winner: gm.winner,
  }, null, 2);
}

function startGmPolling() { stopPolling(); refreshGm().catch(setGmMsg); state.gmPoll = setInterval(() => refreshGm().catch(setGmMsg), 1200); }
function setGmMsg(e){ document.getElementById('gm-msg').textContent = e.message; }

async function saveSetup() {
  const payload = { ...state.roles, vigilanteShots: state.vigilanteShots };
  await api('/api/gm/config', { method: 'POST', body: JSON.stringify(payload) });
  state.roleDirty = false;
  document.getElementById('gm-msg').textContent = 'Setup saved.';
  await refreshGm();
}

async function launchGame() {
  try {
    await saveSetup();
    await api('/api/gm/start', { method: 'POST', body: '{}' });
    document.getElementById('gm-msg').textContent = 'Night 0 started.';
  } catch (e) { setGmMsg(e); }
}

async function gmStartNight() {
  try { await api('/api/gm/start-night', { method: 'POST', body: '{}' }); document.getElementById('gm-msg').textContent = 'Night loop started.'; }
  catch (e) { setGmMsg(e); }
}
async function gmNextPhase() {
  try { await api('/api/gm/next-phase', { method: 'POST', body: '{}' }); }
  catch (e) { setGmMsg(e); }
}
async function gmStartDiscussion() {
  try { await api('/api/gm/start-discussion', { method: 'POST', body: JSON.stringify({ seconds: 300 }) }); }
  catch (e) { setGmMsg(e); }
}
async function resetLobby() {
  await api('/api/gm/reset', { method: 'POST', body: '{}' });
  state.roleDirty = false;
  state.roles = { mafia: 1, sheriff: 1, doctor: 0, vigilante: 0, town: 1 };
  state.vigilanteShots = 1;
  updateRoleInputs();
}

async function attemptJoin() {
  const name = document.getElementById('player-name-input').value.trim();
  if (!name) {
    const err = document.getElementById('name-error');
    err.textContent = 'Name is required.';
    err.classList.remove('hidden');
    return;
  }
  const res = await api('/api/join', { method: 'POST', body: JSON.stringify({ name }) });
  state.playerId = res.playerId;
  localStorage.setItem('playerId', res.playerId);
  document.getElementById('join-status').textContent = 'Joined. Waiting for game events...';
  document.getElementById('join-panel').classList.add('hidden');
  document.getElementById('role-panel').classList.remove('hidden');
}

function phaseActionButtons(ps) {
  const alive = ps.alive;
  if (!alive) return '<p class="text-red-400">You are dead. Observe only.</p>';

  const players = ps.players.filter((p) => p.alive);
  const options = players.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');

  if (ps.phase === 'night_mafia' && ps.role === 'Mafia') {
    return `<select id="act-target" class="w-full bg-midnight p-2 rounded">${options}</select><button onclick="submitMafiaVote()" class="w-full bg-blood p-2 rounded">Submit Mafia Vote</button>`;
  }
  if (ps.phase === 'night_sheriff' && ps.role === 'Sheriff') {
    return `<select id="act-target" class="w-full bg-midnight p-2 rounded">${options}</select><button onclick="submitSheriff()" class="w-full bg-blood p-2 rounded">Investigate</button><p class="text-xs text-gold">Result: ${ps.sheriffResult || '-'}</p>`;
  }
  if (ps.phase === 'night_doctor' && ps.role === 'Doctor') {
    return `<select id="act-target" class="w-full bg-midnight p-2 rounded">${options}</select><button onclick="submitDoctor()" class="w-full bg-blood p-2 rounded">Protect</button>`;
  }
  if (ps.phase === 'night_vigilante' && ps.role === 'Vigilante') {
    return `<select id="act-target" class="w-full bg-midnight p-2 rounded"><option value="">No shot</option>${options.filter(o=>!o.includes(ps.id)).join('')}</select><button onclick="submitVigilante()" class="w-full bg-blood p-2 rounded">Shoot / Skip</button>`;
  }
  if (ps.phase === 'day_vote') {
    return `<select id="act-target" class="w-full bg-midnight p-2 rounded"><option value="">Abstain</option>${options}</select><button onclick="submitDayVote()" class="w-full bg-blood p-2 rounded">Submit Day Vote</button>`;
  }
  return '<p class="text-mist">No action right now. Wait for GM phase progression.</p>';
}

async function refreshPlayer() {
  if (!state.playerId) return;
  const ps = await api(`/api/player-state/${state.playerId}`);
  state.playerState = ps;
  document.getElementById('player-phase-pill').textContent = ps.phase;
  document.getElementById('player-name-label').textContent = ps.name;
  document.getElementById('role-name').textContent = (ps.role || 'Unknown').toUpperCase();
  document.getElementById('role-desc').textContent = ps.roleDescription || '';
  document.getElementById('vigi-ammo').textContent = ps.role === 'Vigilante' ? `Shots remaining: ${ps.vigilanteShotsRemaining}` : '';

  document.getElementById('player-action-panel').innerHTML = phaseActionButtons(ps);
  document.getElementById('player-list').innerHTML = ps.players.map((p) => `<div class="bg-midnight rounded p-1 flex justify-between"><span>${p.name}${p.revealedRole ? ` (${p.revealedRole})` : ''}</span><span class="${p.alive ? 'text-green-400':'text-red-400'}">${p.alive?'Alive':'Dead'}</span></div>`).join('');

  const chatPanel = document.getElementById('mafia-chat-panel');
  if (ps.role === 'Mafia' && ps.phase === 'night_mafia' && ps.alive) {
    chatPanel.classList.remove('hidden');
    document.getElementById('mafia-chat-log').innerHTML = (ps.mafiaChat || []).map((m) => `<div>[${m.author}] ${m.message}</div>`).join('');
  } else {
    chatPanel.classList.add('hidden');
  }
}

function startPlayerPolling() { stopPolling(); refreshPlayer().catch((e)=>document.getElementById('join-status').textContent=e.message); state.playerPoll = setInterval(()=>refreshPlayer().catch(()=>{}), 1200); }

async function postAction(path, body) {
  if (!state.playerId) return;
  await api(path, { method: 'POST', body: JSON.stringify({ playerId: state.playerId, ...body }) });
  await refreshPlayer();
}

function selectedTarget(){ return document.getElementById('act-target')?.value || ''; }
const submitMafiaVote = () => postAction('/api/player/mafia-vote', { targetId: selectedTarget() });
const submitSheriff = () => postAction('/api/player/sheriff-investigate', { targetId: selectedTarget() });
const submitDoctor = () => postAction('/api/player/doctor-protect', { targetId: selectedTarget() });
const submitVigilante = () => postAction('/api/player/vigilante-shoot', { targetId: selectedTarget() || null });
const submitDayVote = () => postAction('/api/player/day-vote', { targetId: selectedTarget() || null });

async function sendMafiaChat() {
  const text = document.getElementById('mafia-chat-input').value.trim();
  if (!text) return;
  await postAction('/api/player/mafia-chat', { message: text });
  document.getElementById('mafia-chat-input').value = '';
}

function copyToClipboard() { navigator.clipboard.writeText(state.lanUrls[0] || state.localhost || ''); }

window.showScreen = showScreen;
window.adjustRole = adjustRole;
window.adjustVigiShots = adjustVigiShots;
window.saveSetup = saveSetup;
window.launchGame = launchGame;
window.gmStartNight = gmStartNight;
window.gmNextPhase = gmNextPhase;
window.gmStartDiscussion = gmStartDiscussion;
window.resetLobby = resetLobby;
window.attemptJoin = attemptJoin;
window.submitMafiaVote = submitMafiaVote;
window.submitSheriff = submitSheriff;
window.submitDoctor = submitDoctor;
window.submitVigilante = submitVigilante;
window.submitDayVote = submitDayVote;
window.sendMafiaChat = sendMafiaChat;
window.copyToClipboard = copyToClipboard;

updateRoleInputs();
updateValidation(0);
if (state.playerId) showScreen('screen-player');
