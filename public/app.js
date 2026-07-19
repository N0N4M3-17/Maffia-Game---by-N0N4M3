const state = {
  account: null,
  playerId: localStorage.getItem('playerId') || null,
  roles: { mafia: 2, sheriff: 1, doctor: 1, vigilante: 0, town: 1 },
  vigilanteShots: 1,
  timerSettings: { nightMafiaSec: 60, nightSheriffSec: 60, nightDoctorSec: 60, nightVigilanteSec: 60, morningSec: 60, finalStatementSec: 45, discussionSec: 60, dayVoteSec: 60 },
  publicDayVoteTally: true,
  rooms: [],
  serverInfo: {},
  poll: null,
  roleDirty: false,
  settingsDirty: false,
  pendingTargetByPhase: {},
  roleReveal: { revealed: false, acknowledged: false, lastPhase: '' },
  lastActionRenderKey: '',
};

const roleLabels = {
  mafia: 'Mafia',
  sheriff: 'Sheriff',
  doctor: 'Doctor',
  vigilante: 'Vigilante',
  town: 'Town',
};

const timerLabels = {
  nightMafiaSec: 'Mafia',
  nightSheriffSec: 'Sheriff',
  nightDoctorSec: 'Doctor',
  nightVigilanteSec: 'Vigilante',
  morningSec: 'Morning',
  finalStatementSec: 'Final words',
  discussionSec: 'Discussion',
  dayVoteSec: 'Vote',
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

function avatar(accountOrPlayer, className = 'avatar') {
  const src = accountOrPlayer?.avatarDataUrl;
  const name = accountOrPlayer?.displayName || accountOrPlayer?.name || accountOrPlayer?.username || '?';
  if (src) return `<img class="${className}" src="${src}" alt="">`;
  return `<div class="${className}">${escapeHtml(initials(name))}</div>`;
}

function setMessage(text, isError = false) {
  const el = $('app-message');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

function setAuthMessage(text, isError = false) {
  const el = $('auth-message');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

function fmtSec(s) {
  const sec = Math.max(0, Number(s || 0));
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const r = (sec % 60).toString().padStart(2, '0');
  return `${m}:${r}`;
}

function showApp(authenticated) {
  $('auth-view').classList.toggle('hidden', authenticated);
  $('game-view').classList.toggle('hidden', !authenticated);
  $('logout-btn').classList.toggle('hidden', !authenticated);
}

function showTab(name) {
  document.querySelectorAll('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.id === `tab-${name}`));
  if (name === 'admin') refreshAdminUsers().catch((err) => setMessage(err.message, true));
}

function updateAccountUi() {
  const a = state.account;
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !a?.isAdmin));
  $('session-name').textContent = a ? a.displayName : 'Signed out';
  $('session-meta').textContent = a ? `${a.username} / ${a.email}` : 'Login to host or join';
  $('session-avatar').outerHTML = a?.avatarDataUrl
    ? `<img id="session-avatar" class="avatar" src="${a.avatarDataUrl}" alt="">`
    : `<div id="session-avatar" class="avatar">${escapeHtml(initials(a?.displayName))}</div>`;
  if (!a) return;
  $('profile-username').textContent = `@${a.username}`;
  $('profile-email').textContent = a.email;
  $('profile-avatar-preview').outerHTML = a.avatarDataUrl
    ? `<img id="profile-avatar-preview" class="avatar large" src="${a.avatarDataUrl}" alt="">`
    : `<div id="profile-avatar-preview" class="avatar large">${escapeHtml(initials(a.displayName))}</div>`;
  $('profile-form').elements.displayName.value = a.displayName;
  $('score-games').textContent = a.scores?.games ?? 0;
  $('score-wins').textContent = a.scores?.wins ?? 0;
  $('score-losses').textContent = a.scores?.losses ?? 0;
}

async function refreshMe() {
  try {
    const data = await api('/api/me');
    state.account = data.account;
    showApp(true);
    updateAccountUi();
    startPolling();
  } catch {
    state.account = null;
    showApp(false);
    stopPolling();
  }
}

async function authSubmit(form, path) {
  const payload = Object.fromEntries(new FormData(form).entries());
  const data = await api(path, { method: 'POST', body: JSON.stringify(payload) });
  state.account = data.account;
  setAuthMessage('');
  showApp(true);
  updateAccountUi();
  await afterLoginRefresh();
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  state.account = null;
  state.playerId = null;
  localStorage.removeItem('playerId');
  showApp(false);
  stopPolling();
}

async function afterLoginRefresh() {
  await Promise.all([refreshRooms(), refreshServerInfo()]);
  startPolling();
}

async function refreshServerInfo() {
  state.serverInfo = await api('/api/server-info');
  $('local-url').textContent = state.serverInfo.localhost || '';
  $('lan-url').textContent = state.serverInfo.lanUrls?.[0] || 'No LAN address detected';
  $('public-url').textContent = state.serverInfo.publicUrl || 'Set PUBLIC_URL when reverse proxied with HTTPS';
  $('public-status').textContent = state.serverInfo.publicUrlSecure ? 'HTTPS ready' : 'Not configured';
  $('public-status').classList.toggle('ok', !!state.serverInfo.publicUrlSecure);
}

async function refreshRooms() {
  const data = await api('/api/rooms');
  state.rooms = data.rooms || [];
  renderRooms();
}

function renderRooms() {
  const list = $('rooms-list');
  if (!state.rooms.length) {
    list.innerHTML = '<div class="empty-state">No rooms yet.</div>';
    return;
  }
  list.innerHTML = state.rooms.map((room) => `
    <article class="room-row">
      <div>
        <strong>${escapeHtml(room.name)}${room.active ? ' <em>Active</em>' : ''}</strong>
        <span>${room.networkMode === 'internet' ? 'Internet-ready' : 'Local LAN'}</span>
      </div>
      <button class="secondary-button" data-room-join="${room.id}">Join</button>
    </article>
  `).join('');
  list.querySelectorAll('[data-room-join]').forEach((btn) => btn.addEventListener('click', () => joinRoom(btn.dataset.roomJoin)));
}

async function createRoom(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  await api('/api/rooms', { method: 'POST', body: JSON.stringify(payload) });
  form.reset();
  await refreshRooms();
  setMessage('Room created.');
}

async function joinRoom(roomId) {
  const data = await api(`/api/rooms/${roomId}/join`, { method: 'POST', body: '{}' });
  state.playerId = data.playerId;
  localStorage.setItem('playerId', data.playerId);
  showTab('play');
  await refreshAll();
  setMessage(`Joined ${data.room?.name || 'room'}.`);
}

async function copyInvite(targetId) {
  const text = $(targetId)?.textContent?.trim() || '';
  if (!text || text.startsWith('Set PUBLIC_URL') || text.includes('No LAN address')) {
    setMessage('No invite link is available for that slot yet.', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  setMessage('Invite link copied.');
}

function roleTotal() {
  return Object.values(state.roles).reduce((sum, value) => sum + Number(value || 0), 0);
}

function renderRoleControls() {
  $('role-controls').innerHTML = Object.keys(roleLabels).map((key) => `
    <div class="stepper">
      <span>${roleLabels[key]}</span>
      <div>
        <button data-role-dec="${key}" aria-label="Decrease ${roleLabels[key]}">-</button>
        <strong id="${key}-count">${state.roles[key]}</strong>
        <button data-role-inc="${key}" aria-label="Increase ${roleLabels[key]}">+</button>
      </div>
    </div>
  `).join('') + `
    <div class="stepper">
      <span>Vigilante shots</span>
      <div>
        <button data-shot-dec aria-label="Decrease vigilante shots">-</button>
        <strong id="vigi-shots-count">${state.vigilanteShots}</strong>
        <button data-shot-inc aria-label="Increase vigilante shots">+</button>
      </div>
    </div>
  `;
  $('role-controls').querySelectorAll('[data-role-dec]').forEach((btn) => btn.addEventListener('click', () => adjustRole(btn.dataset.roleDec, -1)));
  $('role-controls').querySelectorAll('[data-role-inc]').forEach((btn) => btn.addEventListener('click', () => adjustRole(btn.dataset.roleInc, 1)));
  $('role-controls').querySelector('[data-shot-dec]').addEventListener('click', () => adjustVigiShots(-1));
  $('role-controls').querySelector('[data-shot-inc]').addEventListener('click', () => adjustVigiShots(1));
}

function renderTimerControls() {
  $('timer-controls').innerHTML = Object.keys(timerLabels).map((key) => `
    <label>${timerLabels[key]}<input id="set-${key}" type="number" min="1" value="${state.timerSettings[key]}"></label>
  `).join('');
}

function adjustRole(role, delta) {
  state.roles[role] = Math.max(0, Math.min(30, state.roles[role] + delta));
  state.roleDirty = true;
  renderRoleControls();
}

function adjustVigiShots(delta) {
  state.vigilanteShots = Math.max(0, Math.min(10, state.vigilanteShots + delta));
  state.roleDirty = true;
  renderRoleControls();
}

function readTimerInputs() {
  const next = {};
  for (const key of Object.keys(timerLabels)) {
    const value = Number($(`set-${key}`)?.value || 60);
    next[key] = Math.max(1, Number.isFinite(value) ? value : 60);
  }
  return next;
}

async function saveSetup() {
  await api('/api/gm/config', { method: 'POST', body: JSON.stringify({ ...state.roles, vigilanteShots: state.vigilanteShots }) });
  state.roleDirty = false;
  await refreshGm();
  setMessage('Setup saved.');
}

async function saveTimerSettings() {
  state.timerSettings = readTimerInputs();
  state.publicDayVoteTally = $('public-day-tally').checked;
  await api('/api/gm/settings', { method: 'POST', body: JSON.stringify({ ...state.timerSettings, publicDayVoteTally: state.publicDayVoteTally }) });
  state.settingsDirty = false;
  await refreshGm();
  setMessage('Timers saved.');
}

async function launchGame() {
  await saveSetup();
  await saveTimerSettings();
  await api('/api/gm/start', { method: 'POST', body: '{}' });
  await refreshAll();
  setMessage('Night 0 started. Roles are private.');
}

async function gmStartNight() {
  await api('/api/gm/start-night', { method: 'POST', body: '{}' });
  await refreshAll();
}

async function gmNextPhase() {
  await api('/api/gm/next-phase', { method: 'POST', body: '{}' });
  await refreshAll();
}

async function resetLobby() {
  await api('/api/gm/reset', { method: 'POST', body: '{}' });
  state.playerId = null;
  localStorage.removeItem('playerId');
  await refreshAll();
  setMessage('Lobby reset.');
}

async function refreshGm() {
  const gm = await api('/api/gm-state');
  $('phase-pill').textContent = gm.phase;
  $('timer-pill').textContent = fmtSec(gm.phaseRemainingSec || 0);
  $('phase-heading').textContent = phaseTitle(gm.phase, gm.round);
  $('room-kicker').textContent = gm.room?.name || 'Table One';
  $('roster-count').textContent = String(gm.playerCount);
  if (gm.phase === 'lobby' && !state.roleDirty) {
    state.roles = {
      mafia: gm.config.mafia,
      sheriff: gm.config.sheriff,
      doctor: gm.config.doctor,
      vigilante: gm.config.vigilante,
      town: gm.config.town,
    };
    state.vigilanteShots = gm.config.vigilanteShots || 1;
    renderRoleControls();
  }
  if (!state.settingsDirty && gm.timerSettings) {
    state.timerSettings = { ...state.timerSettings, ...gm.timerSettings };
    state.publicDayVoteTally = gm.publicDayVoteTally !== undefined ? gm.publicDayVoteTally : state.publicDayVoteTally;
    $('public-day-tally').checked = !!state.publicDayVoteTally;
    renderTimerControls();
  }
  updateValidation(gm.playerCount);
  renderRoster(gm.players || []);
  $('gm-action-status').textContent = JSON.stringify({
    round: gm.round,
    phase: gm.phase,
    remaining: gm.phaseRemainingSec,
    winner: gm.winner,
    morningDeaths: gm.morningDeaths,
    finalStatementPending: gm.finalStatementPending,
    finalStatements: gm.finalStatements,
    mafiaVotesPending: gm.pendingMafiaVotes,
    dayVotesPending: gm.pendingDayVotes,
    dayVoteTally: gm.dayVoteTally,
  }, null, 2);
}

function phaseTitle(phase, round) {
  const titles = {
    lobby: 'Lobby',
    night0: 'Night 0 role reveal',
    night_mafia: `Night ${round}: Mafia`,
    night_sheriff: `Night ${round}: Sheriff`,
    night_doctor: `Night ${round}: Doctor`,
    night_vigilante: `Night ${round}: Vigilante`,
    morning: 'Morning report',
    final_statements: 'Final statements',
    discussion: 'Discussion',
    day_vote: 'Day vote',
    game_over: 'Game over',
  };
  return titles[phase] || phase;
}

function updateValidation(playerCount) {
  const hasPower = state.roles.sheriff + state.roles.doctor + state.roles.vigilante >= 1;
  const total = roleTotal();
  const ok = playerCount >= 3 && total === playerCount && state.roles.mafia >= 1 && hasPower && state.roles.town >= 1;
  const el = $('validation-status');
  el.textContent = ok ? `Ready: ${total}/${playerCount}` : `Need matching roles: ${total}/${playerCount}`;
  el.classList.toggle('ok', ok);
}

function renderRoster(players) {
  $('player-roster').innerHTML = players.length ? players.map((p) => `
    <article class="player-row ${p.alive ? '' : 'dead'}">
      ${avatar(p)}
      <div><strong>${escapeHtml(p.name)}</strong><span>${p.role || 'Waiting'}</span></div>
      <em>${p.alive ? 'Alive' : 'Dead'}</em>
    </article>
  `).join('') : '<div class="empty-state">No players seated yet.</div>';
}

async function refreshPlayer() {
  if (!state.playerId) {
    $('join-state').classList.remove('hidden');
    $('role-state').classList.add('hidden');
    $('player-action-panel').innerHTML = '<p class="muted">Join a room to receive actions.</p>';
    return;
  }
  try {
    const ps = await api(`/api/player-state/${state.playerId}`);
    $('join-state').classList.add('hidden');
    $('role-state').classList.remove('hidden');
    renderRole(ps);
    renderPlayerAction(ps);
    renderPlayerList(ps.players || []);
    renderChats(ps);
  } catch (err) {
    state.playerId = null;
    localStorage.removeItem('playerId');
    $('join-state').classList.remove('hidden');
    $('role-state').classList.add('hidden');
  }
}

function renderRole(ps) {
  $('role-name').textContent = (ps.role || 'Waiting').toUpperCase();
  const team = ps.role === 'Mafia' && ps.mafiaTeam?.length
    ? ` Team: ${ps.mafiaTeam.map((mate) => mate.name).join(', ')}.`
    : '';
  $('role-desc').textContent = `${ps.roleDescription || 'Role appears after the host launches the game.'}${team}`;
  $('vigi-ammo').textContent = ps.role === 'Vigilante' ? `Shots remaining: ${ps.vigilanteShotsRemaining}` : '';
  if (state.roleReveal.lastPhase !== ps.phase) {
    state.roleReveal = { revealed: ps.phase !== 'night0', acknowledged: false, lastPhase: ps.phase };
  }
  $('role-card').classList.toggle('masked', ps.phase === 'night0' && !state.roleReveal.revealed && !state.roleReveal.acknowledged);
  $('role-card').className = `role-card ${String(ps.role || '').toLowerCase()} ${$('role-card').classList.contains('masked') ? 'masked' : ''}`;
  $('night0-controls').classList.toggle('hidden', ps.phase !== 'night0');
  if ($('role-card').classList.contains('masked')) {
    $('role-name').textContent = 'HIDDEN';
    $('role-desc').textContent = 'Tap reveal when nobody else can see your screen.';
  }
}

function targetOptions(ps, includeAbstain = false, allowSelf = false) {
  const alive = (ps.players || []).filter((p) => p.alive && (allowSelf || p.id !== ps.id));
  let options = includeAbstain ? '<option value="">Abstain / skip</option>' : '<option value="">Choose target</option>';
  for (const p of alive) options += `<option value="${p.id}">${escapeHtml(p.name)}</option>`;
  return options;
}

function actionMarkup(ps) {
  if (ps.phase === 'final_statements') {
    if (ps.finalStatementEligible && !ps.finalStatementSubmitted) {
      return '<div class="form-stack"><textarea id="final-statement-input" maxlength="240" placeholder="Your final statement"></textarea><button class="primary-button" data-action="submit-final">Submit final statement</button><p class="muted">One message, max 240 characters.</p></div>';
    }
    if (ps.finalStatementEligible) return '<p class="muted">Final statement submitted. Waiting for the table.</p>';
    return '<p class="muted">Final statements are in progress. Listen carefully.</p>';
  }
  if (!ps.alive) return '<p class="danger-text">You are dead. Observe only.</p>';
  if (ps.phase === 'night_mafia' && ps.role === 'Mafia') return actionSelect('submit-mafia', targetOptions(ps), 'Submit mafia vote', `${ps.pendingMafiaVotes || 0} mafia pending.`);
  if (ps.phase === 'night_sheriff' && ps.role === 'Sheriff') return actionSelect('submit-sheriff', targetOptions(ps), 'Investigate', ps.sheriffResult ? `Result: ${escapeHtml(ps.sheriffResult)}` : 'No result yet.');
  if (ps.phase === 'night_doctor' && ps.role === 'Doctor') return actionSelect('submit-doctor', targetOptions(ps, false, true), 'Protect', 'You may protect yourself, but not repeat last target.');
  if (ps.phase === 'night_vigilante' && ps.role === 'Vigilante') return actionSelect('submit-vigilante', targetOptions(ps, true), 'Shoot / skip', 'Leave blank to skip.');
  if (ps.phase === 'day_vote') return actionSelect('submit-day', targetOptions(ps, true), 'Submit vote', `Strict majority required. ${ps.pendingDayVotes || 0} players pending.`);
  if (ps.phase === 'morning') return `<p>${ps.morningDeaths?.length ? ps.morningDeaths.map((d) => escapeHtml(d.name)).join(', ') + ' died.' : 'No one died.'}</p>`;
  if (ps.phase === 'discussion') return '<p>Discussion is open. Use the public channel or talk at the table.</p>';
  if (ps.phase === 'game_over') return `<p class="winner-text">Winner: ${escapeHtml(ps.winner || 'Unknown')}</p>`;
  return '<p class="muted">No action right now.</p>';
}

function actionSelect(action, options, label, hint) {
  return `<div class="form-stack"><select id="act-target">${options}</select><button class="primary-button" data-action="${action}">${label}</button><p class="muted">${hint}</p></div>`;
}

function renderPlayerAction(ps) {
  const actionKey = `${ps.phase}|${ps.role}|${ps.alive}|${ps.mafiaVoteSubmitted}|${ps.dayVoteSubmitted}|${ps.pendingMafiaVotes}|${ps.pendingDayVotes}|${ps.sheriffResult}|${ps.finalStatementEligible}|${ps.finalStatementSubmitted}`;
  if (state.lastActionRenderKey === actionKey) return;
  state.lastActionRenderKey = actionKey;
  $('player-action-panel').innerHTML = actionMarkup(ps);
  $('player-action-panel').querySelectorAll('[data-action]').forEach((btn) => btn.addEventListener('click', () => submitAction(btn.dataset.action)));
}

function renderPlayerList(players) {
  $('player-list').innerHTML = players.map((p) => `
    <article class="player-row ${p.alive ? '' : 'dead'}">
      ${avatar(p)}
      <div><strong>${escapeHtml(p.name)}</strong><span>${p.revealedRole || (p.alive ? 'In play' : 'Unknown')}</span></div>
      <em>${p.alive ? 'Alive' : 'Dead'}</em>
    </article>
  `).join('') || '<div class="empty-state">Waiting for players.</div>';
}

function renderChats(ps) {
  const mafiaPanel = $('mafia-chat-panel');
  mafiaPanel.classList.toggle('hidden', !(ps.role === 'Mafia' && ps.phase === 'night_mafia' && ps.alive));
  $('mafia-chat-log').innerHTML = chatLines(ps.mafiaChat || []);
  $('player-chat-log').innerHTML = chatLines(ps.playerChat || []);
}

function chatLines(items) {
  return items.length ? items.map((m) => `<div><strong>${escapeHtml(m.author)}</strong> ${escapeHtml(m.message)}</div>`).join('') : '<p class="muted">No messages yet.</p>';
}

async function submitAction(action) {
  const targetId = $('act-target')?.value || null;
  const paths = {
    'submit-mafia': '/api/player/mafia-vote',
    'submit-sheriff': '/api/player/sheriff-investigate',
    'submit-doctor': '/api/player/doctor-protect',
    'submit-vigilante': '/api/player/vigilante-shoot',
    'submit-day': '/api/player/day-vote',
  };
  if (action === 'submit-final') {
    const message = $('final-statement-input')?.value.trim() || '';
    if (!message) {
      setMessage('Final statement cannot be empty.', true);
      return;
    }
    await api('/api/player/chat', { method: 'POST', body: JSON.stringify({ playerId: state.playerId, message }) });
    state.lastActionRenderKey = '';
    await refreshPlayer();
    return;
  }
  const result = await api(paths[action], { method: 'POST', body: JSON.stringify({ playerId: state.playerId, targetId }) });
  if (result.locked) setMessage(`Vote locked. Advanced to ${phaseTitle(result.phase, '')}.`);
  state.lastActionRenderKey = '';
  await refreshPlayer();
}

async function sendChat(kind) {
  const input = kind === 'mafia' ? $('mafia-chat-input') : $('player-chat-input');
  const message = input.value.trim();
  if (!message) return;
  await api(kind === 'mafia' ? '/api/player/mafia-chat' : '/api/player/chat', {
    method: 'POST',
    body: JSON.stringify({ playerId: state.playerId, message }),
  });
  input.value = '';
  await refreshPlayer();
}

function imageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/gif'].includes(file.type)) return reject(new Error('Use png, jpg, jpeg, or gif.'));
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        if (img.width > 100 || img.height > 100) reject(new Error('Image must be max 100x100 pixels.'));
        else resolve(reader.result);
      };
      img.onerror = () => reject(new Error('Image could not be read.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Image could not be loaded.'));
    reader.readAsDataURL(file);
  });
}

async function saveProfile(form) {
  const avatarDataUrl = await imageToDataUrl(form.elements.avatar.files[0]);
  const payload = { displayName: form.elements.displayName.value.trim() };
  if (avatarDataUrl) payload.avatarDataUrl = avatarDataUrl;
  const data = await api('/api/profile', { method: 'PUT', body: JSON.stringify(payload) });
  state.account = data.account;
  updateAccountUi();
  await refreshAll();
  setMessage('Profile saved.');
}

async function refreshAdminUsers() {
  if (!state.account?.isAdmin) return;
  const data = await api('/api/admin/users');
  $('admin-users').innerHTML = (data.users || []).map((u) => `
    <form class="admin-row" data-user-id="${u.id}">
      ${avatar(u)}
      <input name="displayName" value="${escapeHtml(u.displayName)}" aria-label="Display name">
      <input name="username" value="${escapeHtml(u.username)}" aria-label="Username">
      <input name="email" value="${escapeHtml(u.email)}" aria-label="Email">
      <input name="scoreGames" type="number" min="0" value="${u.scores.games}" aria-label="Games">
      <input name="scoreWins" type="number" min="0" value="${u.scores.wins}" aria-label="Wins">
      <input name="scoreLosses" type="number" min="0" value="${u.scores.losses}" aria-label="Losses">
      <label class="check-label"><input name="isAdmin" type="checkbox" ${u.isAdmin ? 'checked' : ''}> Admin</label>
      <input name="password" type="password" placeholder="New password" aria-label="New password">
      <button class="secondary-button" type="submit">Save</button>
      <button class="ghost-button" type="button" data-delete-user="${u.id}">Delete</button>
    </form>
  `).join('');
  $('admin-users').querySelectorAll('.admin-row').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    values.isAdmin = form.elements.isAdmin.checked;
    await api(`/api/admin/users/${form.dataset.userId}`, { method: 'PUT', body: JSON.stringify(values) });
    await refreshAdminUsers();
    setMessage('User updated.');
  }));
  $('admin-users').querySelectorAll('[data-delete-user]').forEach((btn) => btn.addEventListener('click', async () => {
    await api(`/api/admin/users/${btn.dataset.deleteUser}`, { method: 'DELETE' });
    await refreshAdminUsers();
    setMessage('User deleted.');
  }));
}

async function refreshAll() {
  if (!state.account) return;
  await Promise.all([
    refreshServerInfo().catch(() => {}),
    refreshRooms().catch(() => {}),
    refreshGm().catch((err) => setMessage(err.message, true)),
    refreshPlayer().catch(() => {}),
  ]);
}

function startPolling() {
  stopPolling();
  refreshAll();
  state.poll = setInterval(refreshAll, 1000);
}

function stopPolling() {
  if (state.poll) clearInterval(state.poll);
  state.poll = null;
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  $('login-form').addEventListener('submit', (e) => { e.preventDefault(); authSubmit(e.currentTarget, '/api/auth/login').catch((err) => setAuthMessage(err.message, true)); });
  $('register-form').addEventListener('submit', (e) => { e.preventDefault(); authSubmit(e.currentTarget, '/api/auth/register').catch((err) => setAuthMessage(err.message, true)); });
  $('logout-btn').addEventListener('click', () => logout().catch((err) => setMessage(err.message, true)));
  $('room-form').addEventListener('submit', (e) => { e.preventDefault(); createRoom(e.currentTarget).catch((err) => setMessage(err.message, true)); });
  $('refresh-rooms-btn').addEventListener('click', () => refreshRooms().catch((err) => setMessage(err.message, true)));
  document.querySelectorAll('[data-copy-target]').forEach((btn) => btn.addEventListener('click', () => copyInvite(btn.dataset.copyTarget)));
  $('join-default-btn').addEventListener('click', () => {
    const room = state.rooms[0];
    if (room) joinRoom(room.id).catch((err) => setMessage(err.message, true));
  });
  $('save-setup-btn').addEventListener('click', () => saveSetup().catch((err) => setMessage(err.message, true)));
  $('launch-game-btn').addEventListener('click', () => launchGame().catch((err) => setMessage(err.message, true)));
  $('save-timers-btn').addEventListener('click', () => saveTimerSettings().catch((err) => setMessage(err.message, true)));
  $('start-night-btn').addEventListener('click', () => gmStartNight().catch((err) => setMessage(err.message, true)));
  $('next-phase-btn').addEventListener('click', () => gmNextPhase().catch((err) => setMessage(err.message, true)));
  $('reset-lobby-btn').addEventListener('click', () => resetLobby().catch((err) => setMessage(err.message, true)));
  $('reveal-role-btn').addEventListener('click', () => { state.roleReveal.revealed = true; state.lastActionRenderKey = ''; refreshPlayer(); });
  $('hide-role-btn').addEventListener('click', () => { state.roleReveal.revealed = false; refreshPlayer(); });
  $('ack-role-btn').addEventListener('click', () => { state.roleReveal.acknowledged = true; state.roleReveal.revealed = true; refreshPlayer(); });
  $('mafia-chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat('mafia').catch((err) => setMessage(err.message, true)); });
  $('player-chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat('player').catch((err) => setMessage(err.message, true)); });
  $('profile-form').addEventListener('submit', (e) => { e.preventDefault(); saveProfile(e.currentTarget).catch((err) => setMessage(err.message, true)); });
  $('refresh-users-btn').addEventListener('click', () => refreshAdminUsers().catch((err) => setMessage(err.message, true)));
}

renderRoleControls();
renderTimerControls();
bindEvents();
refreshMe();
