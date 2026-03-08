const state = {
  playerId: localStorage.getItem('playerId') || null,
  roles: { mafia: 1, sheriff: 1, doctor: 0, vigilante: 0, town: 1 },
  vigilanteShots: 1,
  timerSettings: { nightMafiaSec: 60, nightSheriffSec: 60, nightDoctorSec: 60, nightVigilanteSec: 60, morningSec: 60, discussionSec: 60, dayVoteSec: 60 },
  publicDayVoteTally: true,
  roleDirty: false,
  settingsDirty: false,
  gmPoll: null,
  playerPoll: null,
  lanUrls: [],
  localhost: '',
  pendingTargetByPhase: {},
  roleReveal: { revealed: false, acknowledged: false, lastPhase: '' },
  lastActionRenderKey: '',
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

function fmtSec(s) {
  const sec = Math.max(0, Number(s || 0));
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const r = (sec % 60).toString().padStart(2, '0');
  return `${m}:${r}`;
}

function setPlayerPanels(joinMode) {
  document.getElementById('join-panel').classList.toggle('hidden', !joinMode);
  document.getElementById('role-panel').classList.toggle('hidden', joinMode);
}


function setRoleRevealState(mode) {
  const hidden = document.getElementById('role-hidden');
  const shown = document.getElementById('role-revealed');
  const ack = document.getElementById('role-ack');
  if (!hidden || !shown || !ack) return;
  hidden.classList.toggle('hidden', mode !== 'hidden');
  shown.classList.toggle('hidden', mode !== 'revealed');
  ack.classList.toggle('hidden', mode !== 'ack');
}

function revealRole() {
  state.roleReveal.revealed = true;
  setRoleRevealState('revealed');
}

function hideRole() {
  state.roleReveal.revealed = false;
  setRoleRevealState('hidden');
}

function acknowledgeRole() {
  state.roleReveal.acknowledged = true;
  setRoleRevealState('ack');
}

function roleTotal() { return state.roles.mafia + state.roles.sheriff + state.roles.doctor + state.roles.vigilante + state.roles.town; }

function updateRoleInputs() {
  for (const r of ['mafia','sheriff','doctor','vigilante','town']) document.getElementById(`${r}-count`).textContent = String(state.roles[r]);
  document.getElementById('vigi-shots-count').textContent = String(state.vigilanteShots);
  document.getElementById('total-roles').textContent = String(roleTotal());
}

function updateTimerInputs() {
  for (const k of Object.keys(state.timerSettings)) {
    const el = document.getElementById(`set-${k}`);
    if (el) el.value = String(state.timerSettings[k]);
  }
}

function readTimerInputs() {
  const next = {};
  for (const k of Object.keys(state.timerSettings)) {
    const el = document.getElementById(`set-${k}`);
    const val = Number(el?.value || 60);
    next[k] = Math.max(1, Number.isFinite(val) ? val : 60);
  }
  return next;
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
  document.getElementById('gm-timer-live').textContent = fmtSec(gm.phaseRemainingSec || 0);
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

  if (!state.settingsDirty && gm.timerSettings) {
    state.timerSettings = { ...state.timerSettings, ...gm.timerSettings };
    state.publicDayVoteTally = gm.publicDayVoteTally !== undefined ? gm.publicDayVoteTally : state.publicDayVoteTally;
    const dayTallyToggle = document.getElementById('set-public-day-tally');
    if (dayTallyToggle) dayTallyToggle.checked = !!state.publicDayVoteTally;
    updateTimerInputs();
  }

  updateValidation(gm.playerCount);

  document.getElementById('player-roster').innerHTML = gm.players.length
    ? gm.players.map((p) => `<div class="bg-midnight rounded p-2 flex justify-between"><span>${p.name}${p.role ? ` (${p.role})` : ''}</span><span class="${p.alive ? 'text-green-400' : 'text-red-400'}">${p.alive ? 'Alive' : 'Dead'}</span></div>`).join('')
    : '<p class="text-mist">No players.</p>';

  document.getElementById('gm-action-status').textContent = JSON.stringify({
    round: gm.round,
    phase: gm.phase,
    phaseRemainingSec: gm.phaseRemainingSec,
    morningDeaths: gm.morningDeaths,
    winner: gm.winner,
    dayVoteTally: gm.dayVoteTally,
    mafiaVoteTally: gm.mafiaVoteTally,
  }, null, 2);

  const gmMafiaChat = document.getElementById('gm-mafia-chat-log');
  const gmPlayerChat = document.getElementById('gm-player-chat-log');
  if (gmMafiaChat) gmMafiaChat.innerHTML = (gm.mafiaChat || []).map((m) => `<div><span class="text-gold">[${m.author}]</span> ${m.message}</div>`).join('') || '<div class="text-mist">No mafia chat yet.</div>';
  if (gmPlayerChat) gmPlayerChat.innerHTML = (gm.playerChat || []).map((m) => `<div><span class="text-gold">[${m.author}]</span> ${m.message}</div>`).join('') || '<div class="text-mist">No player chat yet.</div>';
}

function startGmPolling() { stopPolling(); refreshGm().catch(setGmMsg); state.gmPoll = setInterval(() => refreshGm().catch(setGmMsg), 1000); }
function setGmMsg(e){ document.getElementById('gm-msg').textContent = e.message; }

async function saveSetup() {
  const payload = { ...state.roles, vigilanteShots: state.vigilanteShots };
  await api('/api/gm/config', { method: 'POST', body: JSON.stringify(payload) });
  state.roleDirty = false;
  document.getElementById('gm-msg').textContent = 'Setup saved.';
  await refreshGm();
}

async function saveTimerSettings() {
  state.timerSettings = readTimerInputs();
  const dayTallyToggle = document.getElementById('set-public-day-tally');
  state.publicDayVoteTally = dayTallyToggle ? !!dayTallyToggle.checked : state.publicDayVoteTally;
  await api('/api/gm/settings', { method: 'POST', body: JSON.stringify({ ...state.timerSettings, publicDayVoteTally: state.publicDayVoteTally }) });
  state.settingsDirty = false;
  document.getElementById('gm-msg').textContent = 'Timer settings saved.';
  await refreshGm();
}

async function launchGame() {
  try {
    await saveSetup();
    await saveTimerSettings();
    await api('/api/gm/start', { method: 'POST', body: '{}' });
    document.getElementById('gm-msg').textContent = 'Night 0 started. Roles are server-assigned.';
  } catch (e) { setGmMsg(e); }
}

async function gmStartNight() { try { await api('/api/gm/start-night', { method: 'POST', body: '{}' }); } catch (e) { setGmMsg(e); } }
async function gmNextPhase() { try { await api('/api/gm/next-phase', { method: 'POST', body: '{}' }); } catch (e) { setGmMsg(e); } }
async function resetLobby() {
  await api('/api/gm/reset', { method: 'POST', body: '{}' });
  state.roleDirty = false;
  state.settingsDirty = false;
  state.roles = { mafia: 1, sheriff: 1, doctor: 0, vigilante: 0, town: 1 };
  state.vigilanteShots = 1;
  state.timerSettings = { nightMafiaSec: 60, nightSheriffSec: 60, nightDoctorSec: 60, nightVigilanteSec: 60, morningSec: 60, discussionSec: 60, dayVoteSec: 60 };
  state.publicDayVoteTally = true;
  const dayTallyToggle = document.getElementById('set-public-day-tally');
  if (dayTallyToggle) dayTallyToggle.checked = true;
  updateRoleInputs();
  updateTimerInputs();
  await refreshGm();
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
  document.getElementById('join-status').textContent = `Joined as session ID: ${res.playerId}`;
  setPlayerPanels(false);
}

function targetOptions(ps, includeAbstain = false, allowSelf = false) {
  const alive = ps.players.filter((p) => p.alive && (allowSelf || p.id !== ps.id));
  let options = includeAbstain ? '<option value="">-- choose target (or abstain) --</option>' : '<option value="">-- choose target --</option>';
  for (const p of alive) options += `<option value="${p.id}">${p.name}</option>`;
  return options;
}

function chooseDefaultTarget(ps, current, includeAbstain = false) {
  if (current !== undefined && current !== null) return current;
  const alive = ps.players.filter((p) => p.alive && p.id !== ps.id);
  if (alive.length > 0) return alive[0].id;
  return includeAbstain ? '' : '';
}

function bindTargetSelection(phase, ps, currentFromServer, includeAbstain = false) {
  const select = document.getElementById('act-target');
  if (!select) return;
  const existing = state.pendingTargetByPhase[phase];
  const selected = chooseDefaultTarget(ps, existing ?? currentFromServer, includeAbstain);
  select.value = selected ?? '';
  state.pendingTargetByPhase[phase] = select.value;
  select.onchange = () => { state.pendingTargetByPhase[phase] = select.value; };
}

function phaseActionButtons(ps) {
  if (!ps.alive) return '<p class="text-red-400">You are dead. Observe only.</p>';

  if (ps.phase === 'night_mafia' && ps.role === 'Mafia') {
    if (ps.mafiaVoteSubmitted) return `<p class="text-gold">Vote submitted. ${ps.pendingMafiaVotes || 0} mafia player(s) did not vote yet.</p>`;
    return `<select id="act-target" class="w-full bg-midnight p-2 rounded">${targetOptions(ps, false, false)}</select><button onclick="submitMafiaVote()" class="w-full bg-blood p-2 rounded">Submit Mafia Vote</button><p class="text-xs text-mist">After voting: ${ps.pendingMafiaVotes || 0} mafia player(s) pending.</p>`;
  }
  if (ps.phase === 'night_sheriff' && ps.role === 'Sheriff') return `<select id="act-target" class="w-full bg-midnight p-2 rounded">${targetOptions(ps, false, false)}</select><button onclick="submitSheriff()" class="w-full bg-blood p-2 rounded">Investigate</button><p class="text-xs text-gold">Result: ${ps.sheriffResult || 'No investigation submitted yet.'}</p>`;
  if (ps.phase === 'night_doctor' && ps.role === 'Doctor') return `<select id="act-target" class="w-full bg-midnight p-2 rounded">${targetOptions(ps, false, true)}</select><button onclick="submitDoctor()" class="w-full bg-blood p-2 rounded">Protect</button>`;
  if (ps.phase === 'night_vigilante' && ps.role === 'Vigilante') return `<select id="act-target" class="w-full bg-midnight p-2 rounded">${targetOptions(ps, true, false)}</select><button onclick="submitVigilante()" class="w-full bg-blood p-2 rounded">Shoot / Skip</button>`;
  if (ps.phase === 'day_vote') {
    if (ps.dayVoteSubmitted) return `<p class="text-gold">Vote submitted. ${ps.pendingDayVotes || 0} player(s) did not vote yet.</p>`;
    return `<select id="act-target" class="w-full bg-midnight p-2 rounded">${targetOptions(ps, true, false)}</select><button onclick="submitDayVote()" class="w-full bg-blood p-2 rounded">Submit Day Vote</button><p class="text-xs text-mist">${ps.pendingDayVotes || 0} player(s) currently pending.</p>`;
  }
  if (ps.phase === 'discussion') return `<p class="text-gold">Discussion in progress.</p>`;
  if (ps.phase === 'morning') return `<p class="text-gold">Morning: ${ps.morningDeaths?.length ? ps.morningDeaths.map(d=>d.name).join(', ') + ' died.' : 'No one died.'}</p>`;
  if (ps.phase === 'game_over') return `<p class="text-gold text-lg">Game Over — Winner: ${ps.winner || 'Unknown'}</p>`;
  return '<p class="text-mist">No action right now. Wait for GM phase progression.</p>';
}

async function refreshPlayer() {
  if (!state.playerId) {
    setPlayerPanels(true);
    document.getElementById('player-name-label').textContent = '-';
    document.getElementById('player-timer-live').textContent = '00:00';
    state.lastActionRenderKey = '';
    return;
  }
  try {
    const ps = await api(`/api/player-state/${state.playerId}`);
    document.getElementById('player-phase-pill').textContent = ps.phase;
    document.getElementById('player-name-label').textContent = ps.name;
    document.getElementById('player-timer-live').textContent = fmtSec(ps.phaseRemainingSec || 0);
    document.getElementById('role-name').textContent = (ps.role || 'Unknown').toUpperCase();
    document.getElementById('role-desc').textContent = ps.roleDescription || '';
    document.getElementById('vigi-ammo').textContent = ps.role === 'Vigilante' ? `Shots remaining: ${ps.vigilanteShotsRemaining}` : '';

    setPlayerPanels(false);

    if (state.roleReveal.lastPhase !== ps.phase) {
      state.roleReveal.lastPhase = ps.phase;
      state.roleReveal.revealed = false;
      state.roleReveal.acknowledged = false;
    }

    if (ps.phase === 'night0') {
      if (state.roleReveal.acknowledged) setRoleRevealState('ack');
      else if (state.roleReveal.revealed) setRoleRevealState('revealed');
      else setRoleRevealState('hidden');
    } else {
      setRoleRevealState('revealed');
    }

    const actionKey = `${ps.phase}|${ps.role}|${ps.alive}|${ps.mafiaVoteSubmitted}|${ps.dayVoteSubmitted}|${ps.pendingMafiaVotes}|${ps.pendingDayVotes}`;
    if (state.lastActionRenderKey !== actionKey) {
      document.getElementById('player-action-panel').innerHTML = phaseActionButtons(ps);
      state.lastActionRenderKey = actionKey;
    }

    if (ps.phase === 'night_mafia' && ps.role === 'Mafia') bindTargetSelection('night_mafia', ps, ps.mafiaVoteCurrent, false);
    if (ps.phase === 'night_sheriff' && ps.role === 'Sheriff') bindTargetSelection('night_sheriff', ps, null, false);
    if (ps.phase === 'night_doctor' && ps.role === 'Doctor') bindTargetSelection('night_doctor', ps, null, false);
    if (ps.phase === 'night_vigilante' && ps.role === 'Vigilante') bindTargetSelection('night_vigilante', ps, null, true);
    if (ps.phase === 'day_vote') bindTargetSelection('day_vote', ps, ps.dayVoteCurrent, true);

    document.getElementById('player-list').innerHTML = ps.players.map((p) => `<div class="bg-midnight rounded p-1 flex justify-between"><span>${p.name}${p.revealedRole ? ` (${p.revealedRole})` : ''}</span><span class="${p.alive ? 'text-green-400':'text-red-400'}">${p.alive?'Alive':'Dead'}</span></div>`).join('');

    const chatPanel = document.getElementById('mafia-chat-panel');
    if (ps.role === 'Mafia' && ps.phase === 'night_mafia' && ps.alive) {
      chatPanel.classList.remove('hidden');
      document.getElementById('mafia-chat-log').innerHTML = (ps.mafiaChat || []).map((m) => `<div>[${m.author}] ${m.message}</div>`).join('');
    } else chatPanel.classList.add('hidden');

    document.getElementById('player-chat-log').innerHTML = (ps.playerChat || []).map((m) => `<div>[${m.author}] ${m.message}</div>`).join('');
  } catch (e) {
    localStorage.removeItem('playerId');
    state.playerId = null;
    document.getElementById('join-status').textContent = 'Session expired. Join lobby again.';
    setPlayerPanels(true);
    document.getElementById('player-name-label').textContent = '-';
    state.lastActionRenderKey = '';
  }
}

function startPlayerPolling() { stopPolling(); refreshPlayer().catch((e)=>document.getElementById('join-status').textContent=e.message); state.playerPoll = setInterval(()=>refreshPlayer().catch(()=>{}), 1000); }

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

async function sendPlayerChat() {
  const input = document.getElementById('player-chat-input');
  const text = input.value.trim();
  if (!text) return;
  await postAction('/api/player/chat', { message: text });
  input.value = '';
}

function copyToClipboard() { navigator.clipboard.writeText(state.lanUrls[0] || state.localhost || ''); }

window.showScreen = showScreen;
window.adjustRole = adjustRole;
window.adjustVigiShots = adjustVigiShots;
window.saveSetup = saveSetup;
window.saveTimerSettings = saveTimerSettings;
window.launchGame = launchGame;
window.gmStartNight = gmStartNight;
window.gmNextPhase = gmNextPhase;
window.resetLobby = resetLobby;
window.attemptJoin = attemptJoin;
window.submitMafiaVote = submitMafiaVote;
window.submitSheriff = submitSheriff;
window.submitDoctor = submitDoctor;
window.submitVigilante = submitVigilante;
window.submitDayVote = submitDayVote;
window.sendMafiaChat = sendMafiaChat;
window.sendPlayerChat = sendPlayerChat;
window.copyToClipboard = copyToClipboard;
window.revealRole = revealRole;
window.hideRole = hideRole;
window.acknowledgeRole = acknowledgeRole;

updateRoleInputs();
updateTimerInputs();
updateValidation(0);
setPlayerPanels(!state.playerId);
if (state.playerId) showScreen('screen-player');
