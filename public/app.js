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
  roleReveal: { revealed: false, acknowledged: false, lastPhase: '', lastRound: -1, lastRole: '' },
  dealRenderKey: '',
  lastPlayerState: null,
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
  await recoverPlayerSeat();
  await Promise.all([refreshRooms(), refreshServerInfo()]);
  startPolling();
}

async function recoverPlayerSeat() {
  try {
    const seat = await api('/api/my-player');
    if (seat.joined && seat.playerId) {
      state.playerId = seat.playerId;
      localStorage.setItem('playerId', seat.playerId);
      return true;
    }
  } catch {
    // Recovery is opportunistic; normal join still works if this fails.
  }
  return false;
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
      <span><span class="role-mini-icon ${key}">${roleIcon(roleLabels[key])}</span>${roleLabels[key]}</span>
      <div>
        <button data-role-dec="${key}" aria-label="Decrease ${roleLabels[key]}">-</button>
        <strong id="${key}-count">${state.roles[key]}</strong>
        <button data-role-inc="${key}" aria-label="Increase ${roleLabels[key]}">+</button>
      </div>
    </div>
  `).join('') + `
    <div class="stepper">
      <span><span class="role-mini-icon vigilante">${roleIcon('Vigilante')}</span>Vigilante shots</span>
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
  $('timer-controls').querySelectorAll('input').forEach((input) => input.addEventListener('input', () => {
    state.settingsDirty = true;
  }));
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

async function gmVoidGame() {
  await api('/api/gm/void', { method: 'POST', body: '{}' });
  await refreshAll();
  setMessage('Game voided. No scores were recorded.');
}

async function gmReturnLobby() {
  await api('/api/gm/return-lobby', { method: 'POST', body: '{}' });
  state.roleReveal = { revealed: false, acknowledged: false, lastPhase: '', lastRound: -1, lastRole: '' };
  state.dealRenderKey = '';
  state.lastActionRenderKey = '';
  await refreshAll();
  setMessage('Returned to lobby with seated players.');
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
  const visiblePlayers = gmVisiblePlayers(gm);
  const hostTab = document.querySelector('[data-tab="host"]');
  if (hostTab) hostTab.classList.toggle('hidden', !gm.canManage);
  if (!gm.canManage && document.querySelector('#tab-host.active')) showTab('play');
  const setupVisible = gm.phase === 'lobby';
  const hostGrid = document.querySelector('#tab-host .host-grid');
  if (hostGrid) hostGrid.classList.toggle('gm-command-view', !setupVisible);
  document.querySelector('#tab-host')?.classList.toggle('scene-tab', !setupVisible);
  $('gm-setup-panel').classList.toggle('hidden', !setupVisible);
  $('gm-timer-panel').classList.toggle('hidden', !setupVisible);
  $('phase-pill').textContent = gm.phase;
  $('timer-pill').textContent = fmtSec(gm.phaseRemainingSec || 0);
  $('phase-heading').textContent = phaseTitle(gm.phase, gm.round);
  $('void-game-btn').disabled = gm.phase === 'lobby';
  $('start-night-btn').disabled = gm.phase === 'game_over';
  $('next-phase-btn').disabled = gm.phase === 'game_over';
  $('return-lobby-btn').classList.toggle('hidden', gm.phase !== 'game_over');
  $('room-kicker').textContent = gm.room?.name || 'Table One';
  $('roster-count').textContent = setupVisible ? String(gm.playerCount) : String(visiblePlayers.length);
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
  renderRoster(setupVisible ? (gm.players || []) : visiblePlayers, gm.canManage && setupVisible);
  $('gm-phase-guide').innerHTML = gmGuidanceMarkup(gm);
  $('gm-action-status').innerHTML = gmConsoleMarkup(gm);
  $('gm-action-status').querySelectorAll('[data-gm-button]').forEach((button) => {
    if (button.dataset.gmButton === 'next') button.addEventListener('click', () => gmNextPhase().catch((err) => setMessage(err.message, true)));
    if (button.dataset.gmButton === 'night') button.addEventListener('click', () => gmStartNight().catch((err) => setMessage(err.message, true)));
    if (button.dataset.gmButton === 'void') button.addEventListener('click', () => gmVoidGame().catch((err) => setMessage(err.message, true)));
  });
}

function statCard(label, value, tone = '') {
  return `<div class="stat-card ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function gmVisiblePlayers(gm) {
  const accountId = state.account?.id;
  const players = gm.players || [];
  if (!gm.canManage || !accountId) return players;
  return players.filter((player) => player.accountId !== accountId);
}

function gmEventLines(gm, players) {
  const lines = [];
  const phase = phaseTitle(gm.phase, gm.round);
  lines.push({ time: 'now', tone: 'gold', text: `${phase} active` });
  if (gm.actionNoticeTitle) lines.push({ time: 'now', tone: 'red', text: `${gm.actionNoticeTitle}: ${gm.actionNoticeBody || ''}` });
  if (gm.lastSheriffResult) lines.push({ time: 'last', tone: 'blue', text: gm.lastSheriffResult });
  (gm.morningDeaths || []).forEach((death) => lines.push({ time: 'night', tone: 'red', text: `${death.name} died (${death.role || 'unknown'})` }));
  (gm.mafiaChat || []).slice(-3).forEach((message) => lines.push({ time: 'mafia', tone: 'red', text: `${message.author}: ${message.message}` }));
  (gm.playerChat || []).slice(-3).forEach((message) => lines.push({ time: 'chat', tone: '', text: `${message.author}: ${message.message}` }));
  if (!lines.length) lines.push({ time: '--', tone: '', text: `${players.length} player(s) seated` });
  return lines.slice(-9).map((line) => `
    <div class="gm-log-line ${line.tone}">
      <span>${escapeHtml(line.time)}</span>
      <strong>${escapeHtml(line.text)}</strong>
    </div>
  `).join('');
}

function gmRoleDistribution(players) {
  const counts = players.reduce((acc, player) => {
    const role = player.role || 'Unassigned';
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});
  const roles = ['Mafia', 'Sheriff', 'Doctor', 'Vigilante', 'Town', 'Unassigned'];
  return roles.filter((role) => counts[role]).map((role) => `
    <div class="gm-role-row ${role.toLowerCase()}">
      <span>${roleIcon(role)} ${escapeHtml(role)}</span>
      <strong>${counts[role]}</strong>
    </div>
  `).join('') || '<p class="muted">No roles dealt yet.</p>';
}

function gmPlayerCard(player) {
  return `
    <article class="gm-player-card ${player.alive ? 'alive' : 'dead'} ${String(player.role || '').toLowerCase()}">
      <div class="gm-player-token">${escapeHtml(initials(player.name).slice(0, 1))}</div>
      <strong>${escapeHtml(player.name)}</strong>
      <span>${escapeHtml(player.role || 'Waiting')}</span>
      <em>${player.alive ? 'Alive' : 'Dead'}</em>
    </article>
  `;
}

function chatPreview(title, messages) {
  const lines = (messages || []).slice(-5).map((m) => `<div><strong>${escapeHtml(m.author)}</strong> ${escapeHtml(m.message)}</div>`).join('');
  return `
    <section class="feed-card">
      <h4>${escapeHtml(title)}</h4>
      <div class="feed-lines">${lines || '<p class="muted">No messages yet.</p>'}</div>
    </section>
  `;
}

function tallyMarkup(title, tally, players) {
  const entries = Object.entries(tally || {});
  return `
    <section class="feed-card">
      <h4>${escapeHtml(title)}</h4>
      <div class="feed-lines">${entries.length ? entries.map(([id, count]) => {
        const player = players.find((p) => p.id === id);
        return `<div><strong>${escapeHtml(player?.name || id)}</strong> ${count} vote(s)</div>`;
      }).join('') : '<p class="muted">No votes locked in yet.</p>'}</div>
    </section>
  `;
}

function pendingActionMarkup(gm) {
  const pending = gm.pendingActionPlayers || [];
  const actionName = gm.currentActionName || 'Current action';
  const notice = gm.actionNoticeTitle ? `
    <div class="gm-action-notice">
      <strong>${escapeHtml(gm.actionNoticeTitle)}</strong>
      <span>${escapeHtml(gm.actionNoticeBody || '')}</span>
    </div>
  ` : '';
  const body = pending.length
    ? pending.map((name) => `<span class="pending-chip">${escapeHtml(name)}</span>`).join('')
    : '<p class="muted">No one is pending right now.</p>';
  return `
    <section class="feed-card pending-card">
      <h4>${escapeHtml(actionName)}</h4>
      ${notice}
      <div class="pending-list">${body}</div>
    </section>
  `;
}

function gmConsoleMarkup(gm) {
  const players = gmVisiblePlayers(gm);
  const alive = players.filter((player) => player.alive).length;
  const dead = Math.max(0, players.length - alive);
  const deaths = gm.morningDeaths?.length
    ? gm.morningDeaths.map((d) => `<div><strong>${escapeHtml(d.name)}</strong> ${escapeHtml(d.role || 'Unknown')}</div>`).join('')
    : '<p class="muted">No announced deaths.</p>';
  const finals = Object.entries(gm.finalStatements || {}).map(([id, message]) => {
    const player = players.find((p) => p.id === id);
    return `<div><strong>${escapeHtml(player?.name || id)}</strong> ${escapeHtml(message)}</div>`;
  }).join('');
  return `
    <div class="gm-command-shell">
      <aside class="gm-command-rail">
        <div class="gm-master-badge">${roleIcon('Sheriff')}<strong>Game Master</strong></div>
        <div class="gm-phase-box">
          <span>Phase</span>
          <strong>${escapeHtml(phaseTitle(gm.phase, gm.round))}</strong>
          <em>${fmtSec(gm.phaseRemainingSec || 0)} remaining</em>
        </div>
        <div class="gm-control-stack">
          <button class="secondary-button" data-gm-button="next" ${gm.phase === 'game_over' ? 'disabled' : ''}>Advance phase</button>
          <button class="secondary-button" data-gm-button="night" ${gm.phase === 'game_over' ? 'disabled' : ''}>Start night</button>
          <button class="danger-button" data-gm-button="void" ${gm.phase === 'lobby' ? 'disabled' : ''}>Void game</button>
        </div>
        <section class="gm-rail-section">
          <h4>Role distribution</h4>
          ${gmRoleDistribution(players)}
        </section>
      </aside>
      <main class="gm-table-stage">
        <header class="gm-stage-header">
          <h4>Players</h4>
          <span>${players.length} total / ${alive} alive / ${dead} dead</span>
        </header>
        <div class="gm-player-grid">
          ${players.length ? players.map(gmPlayerCard).join('') : '<p class="muted">No table players seated.</p>'}
        </div>
      </main>
      <aside class="gm-event-log">
        <h4>Event log <span>GM only</span></h4>
        <div class="gm-log-lines">${gmEventLines(gm, players)}</div>
        <div class="gm-night-summary">
          <h5>Night actions summary</h5>
          ${pendingActionMarkup(gm)}
          <div class="feed-lines">${deaths}</div>
          <div class="feed-lines">${finals || '<p class="muted">No final statements submitted.</p>'}</div>
        </div>
      </aside>
    </div>
    <div class="gm-detail-drawer">
      <div class="gm-stat-grid">
        ${statCard('Round', gm.round ?? 0)}
        ${statCard('Alive', `${alive}/${players.length}`, 'ok')}
        ${statCard('Mafia pending', gm.pendingMafiaVotes ?? 0)}
        ${statCard('Day votes pending', gm.pendingDayVotes ?? 0)}
      </div>
    <div class="gm-feed-grid">
      <section class="feed-card">
        <h4>Night / vote outcomes</h4>
        <div class="feed-lines">${deaths}</div>
      </section>
      <section class="feed-card">
        <h4>Final statements</h4>
        <div class="feed-lines">${finals || '<p class="muted">No final statements submitted.</p>'}</div>
      </section>
      ${tallyMarkup('Day vote tally', gm.dayVoteTally, players)}
      ${chatPreview('Mafia channel', gm.mafiaChat)}
      ${chatPreview('Public channel', gm.playerChat)}
    </div>
    </div>
  `;
}

function deadOverviewMarkup(ps) {
  const players = ps.observerPlayers || [];
  const alive = players.filter((player) => player.alive).length;
  const dead = Math.max(0, players.length - alive);
  const deaths = ps.morningDeaths?.length
    ? ps.morningDeaths.map((d) => `<div><strong>${escapeHtml(d.name)}</strong> ${escapeHtml(d.role || 'Unknown')}</div>`).join('')
    : '<p class="muted">No announced deaths.</p>';
  const finals = Object.entries(ps.finalStatements || {}).map(([id, message]) => {
    const player = players.find((p) => p.id === id);
    return `<div><strong>${escapeHtml(player?.name || id)}</strong> ${escapeHtml(message)}</div>`;
  }).join('');
  const observerState = {
    phase: ps.phase,
    round: ps.round,
    phaseRemainingSec: ps.phaseRemainingSec,
    actionNoticeTitle: ps.observerActionNoticeTitle || '',
    actionNoticeBody: ps.observerActionNoticeBody || '',
    lastSheriffResult: ps.observerLastSheriffResult || '',
    morningDeaths: ps.morningDeaths || [],
    mafiaChat: [],
    playerChat: ps.playerChat || [],
    currentActionName: ps.observerCurrentActionName || 'Current action',
    pendingActionPlayers: ps.observerPendingActionPlayers || [],
  };
  return `
    <div class="gm-command-shell dead-command-shell">
      <aside class="gm-command-rail">
        <div class="gm-master-badge">${roleIcon('Hidden')}<strong>Observer</strong></div>
        <div class="gm-phase-box">
          <span>Phase</span>
          <strong>${escapeHtml(phaseTitle(ps.phase, ps.round))}</strong>
          <em>${fmtSec(ps.phaseRemainingSec || 0)} remaining</em>
        </div>
        <section class="gm-rail-section">
          <h4>Role distribution</h4>
          ${gmRoleDistribution(players)}
        </section>
      </aside>
      <main class="gm-table-stage">
        <header class="gm-stage-header">
          <h4>Players</h4>
          <span>${players.length} total / ${alive} alive / ${dead} dead</span>
        </header>
        <div class="gm-player-grid">
          ${players.length ? players.map(gmPlayerCard).join('') : '<p class="muted">No table players seated.</p>'}
        </div>
      </main>
      <aside class="gm-event-log">
        <h4>Event log <span>Observer</span></h4>
        <div class="gm-log-lines">${gmEventLines(observerState, players)}</div>
        <div class="gm-night-summary">
          <h5>Table summary</h5>
          ${pendingActionMarkup(observerState)}
          <div class="feed-lines">${deaths}</div>
          <div class="feed-lines">${finals || '<p class="muted">No final statements submitted.</p>'}</div>
        </div>
      </aside>
    </div>
    <div class="gm-detail-drawer dead-detail-drawer">
      <div class="gm-stat-grid">
        ${statCard('Round', ps.round ?? 0)}
        ${statCard('Alive', `${alive}/${players.length}`, 'ok')}
        ${statCard('Pending', (ps.observerPendingActionPlayers || []).length)}
        ${statCard('Result', ps.winner || 'Playing')}
      </div>
      <div class="gm-feed-grid">
        <section class="feed-card">
          <h4>Night / vote outcomes</h4>
          <div class="feed-lines">${deaths}</div>
        </section>
        <section class="feed-card">
          <h4>Final statements</h4>
          <div class="feed-lines">${finals || '<p class="muted">No final statements submitted.</p>'}</div>
        </section>
        ${tallyMarkup('Mafia vote tally', ps.observerMafiaVoteTally, players)}
        ${tallyMarkup('Day vote tally', ps.observerDayVoteTally, players)}
        ${chatPreview('Public channel', ps.playerChat)}
      </div>
    </div>
  `;
}

function renderDeadOverview(ps) {
  const panel = $('dead-overview-panel');
  const target = $('dead-overview');
  if (!panel || !target) return;
  const canObserve = !!ps && (!ps.alive || ps.phase === 'game_over') && (ps.observerPlayers || []).length;
  document.querySelector('#tab-play')?.classList.toggle('scene-tab', canObserve);
  document.querySelector('#tab-play .play-grid')?.classList.toggle('dead-scene-view', canObserve);
  panel.classList.toggle('hidden', !canObserve);
  if (!canObserve) {
    target.innerHTML = '';
    return;
  }
  target.innerHTML = deadOverviewMarkup(ps);
}

function gmGuidanceMarkup(gm) {
  const deaths = gm.morningDeaths?.length ? gm.morningDeaths.map((d) => d.name).join(', ') : '';
  const guides = {
    lobby: ['Seat the table', 'Create or select the room, confirm players, save role counts, then launch roles.'],
    night0: ['Private role reveal', 'Give players time to reveal and confirm roles. Start night when the table is ready.'],
    night_mafia: ['Mafia action', `${gm.pendingMafiaVotes || 0} Mafia vote(s) still pending. The phase can auto-advance on timer or majority lock.`],
    night_sheriff: ['Sheriff action', 'The Sheriff chooses one alive player. The result stays private to the Sheriff.'],
    night_doctor: ['Doctor action', 'The Doctor protects one alive player and cannot repeat last night\'s target.'],
    night_vigilante: ['Vigilante action', 'The Vigilante may shoot one alive non-self target or skip to save the shot.'],
    morning: ['Resolve the night', deaths ? `Announce night deaths: ${deaths}.` : 'Announce that no one died overnight.'],
    final_statements: ['Final statements', `${gm.finalStatementPending || 0} final statement(s) still pending.`],
    discussion: ['Table discussion', 'Let alive players discuss. Move to voting when the room is ready or when the timer expires.'],
    day_vote: ['Day voting', `${gm.pendingDayVotes || 0} alive player vote(s) still pending. Strict majority is required for elimination.`],
    game_over: ['Game over', gm.winner === 'Voided' ? 'The GM voided this game. No scores were recorded. Reset to return to lobby setup.' : `Winner: ${gm.winner || 'unknown'}. Review scores, then reset for another table.`],
  };
  const [title, body] = guides[gm.phase] || ['Current phase', gm.phase || 'Waiting for game state.'];
  return `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span>`;
}

function phaseTitle(phase, round) {
  const nightLabel = round ? `Night ${round}` : 'Night';
  const titles = {
    lobby: 'Lobby',
    night0: 'Night 0 role reveal',
    night_mafia: `${nightLabel}: Mafia`,
    night_sheriff: `${nightLabel}: Sheriff`,
    night_doctor: `${nightLabel}: Doctor`,
    night_vigilante: `${nightLabel}: Vigilante`,
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

function renderRoster(players, canManageSeats = false) {
  $('player-roster').innerHTML = players.length ? players.map((p) => `
    <article class="player-row ${p.alive ? '' : 'dead'} ${p.accountId === state.account?.id ? 'manager-seat' : ''}">
      ${avatar(p)}
      <div><strong>${escapeHtml(p.name)}</strong><span>${p.role || 'Waiting'}</span></div>
      <em>${p.alive ? 'Alive' : 'Dead'}</em>
      ${canManageSeats ? `<button class="ghost-button seat-remove" data-remove-seat="${escapeHtml(p.id)}" aria-label="Remove ${escapeHtml(p.name)} from lobby">Remove</button>` : ''}
    </article>
  `).join('') : '<div class="empty-state">No players seated yet.</div>';
  $('player-roster').querySelectorAll('[data-remove-seat]').forEach((btn) => {
    btn.addEventListener('click', () => removeSeat(btn.dataset.removeSeat).catch((err) => setMessage(err.message, true)));
  });
}

async function removeSeat(playerId) {
  await api(`/api/gm/players/${encodeURIComponent(playerId)}`, { method: 'DELETE' });
  if (state.playerId === playerId) {
    state.playerId = null;
    localStorage.removeItem('playerId');
  }
  await refreshAll();
  setMessage('Seat removed from lobby.');
}

async function refreshPlayer() {
  if (!state.playerId) {
    state.lastPlayerState = null;
    renderMobileActionTray(null);
    renderDeadOverview(null);
    $('join-state').classList.remove('hidden');
    $('role-state').classList.add('hidden');
    $('player-phase-guide').innerHTML = '<strong>Take a seat</strong><span>Join the current room to enter the table.</span>';
    $('player-action-panel').innerHTML = '<p class="muted">Join a room to receive actions.</p>';
    return;
  }
  try {
    const ps = await api(`/api/player-state/${state.playerId}`);
    state.lastPlayerState = ps;
    $('join-state').classList.add('hidden');
    $('role-state').classList.remove('hidden');
    renderRole(ps);
    renderMobileActionTray(ps);
    $('player-phase-guide').innerHTML = playerGuidanceMarkup(ps);
    renderPlayerAction(ps);
    renderPlayerList(ps.players || []);
    renderChats(ps);
    renderDeadOverview(ps);
  } catch (err) {
    localStorage.removeItem('playerId');
    state.playerId = null;
    state.lastPlayerState = null;
    if (await recoverPlayerSeat()) {
      state.lastActionRenderKey = '';
      await refreshPlayer();
      return;
    }
    $('join-state').classList.remove('hidden');
    $('role-state').classList.add('hidden');
    renderMobileActionTray(null);
    renderDeadOverview(null);
    $('player-phase-guide').innerHTML = '<strong>Seat lost</strong><span>Join the current room again to reconnect.</span>';
  }
}

function actionForPhase(ps) {
  if (!ps) return '';
  if (ps.phase === 'night_mafia' && ps.role === 'Mafia') return 'submit-mafia';
  if (ps.phase === 'night_sheriff' && ps.role === 'Sheriff') return 'submit-sheriff';
  if (ps.phase === 'night_doctor' && ps.role === 'Doctor') return 'submit-doctor';
  if (ps.phase === 'night_vigilante' && ps.role === 'Vigilante') return 'submit-vigilante';
  if (ps.phase === 'day_vote') return 'submit-day';
  return '';
}

function currentTargetLabel(ps) {
  const action = actionForPhase(ps);
  if (!action) return ps?.phase === 'night0' ? 'Role card' : 'None';
  const storeKey = actionStoreKey(ps, action);
  const selected = Object.prototype.hasOwnProperty.call(state.pendingTargetByPhase, storeKey)
    ? state.pendingTargetByPhase[storeKey]
    : submittedTarget(ps, action);
  if ((action === 'submit-day' || action === 'submit-vigilante') && selected === '') {
    return action === 'submit-day' ? 'Abstain' : 'Skip shot';
  }
  return (ps.players || []).find((player) => player.id === selected)?.name || 'None';
}

function renderMobileActionTray(ps) {
  const tray = $('mobile-action-tray');
  if (!tray) return;
  tray.classList.toggle('hidden', !ps);
  if (!ps) return;
  $('tray-phase').textContent = phaseTitle(ps.phase, ps.round);
  $('tray-timer').textContent = fmtSec(ps.phaseRemainingSec || 0);
  $('tray-alive').textContent = `${ps.aliveCount || 0} alive`;
  $('tray-target').textContent = currentTargetLabel(ps);
}

function playerGuidanceMarkup(ps) {
  if (ps.phase === 'game_over' && ps.winner === 'Voided') return '<strong>Game voided</strong><span>The GM voided this game. No scores were recorded.</span>';
  if (ps.phase === 'game_over') return `<strong>Game over</strong><span>Winner: ${escapeHtml(ps.winner || 'unknown')}. Your score has been recorded.</span>`;
  if (!ps.alive && ps.phase !== 'final_statements') return '<strong>Observe only</strong><span>You are out of the round. Watch the table and keep private information private.</span>';
  if (ps.phase === 'night0') return '<strong>Role reveal</strong><span>Reveal privately, confirm when ready, then wait for the GM.</span>';
  if (ps.phase === 'night_mafia') {
    if (ps.role === 'Mafia') return ps.mafiaVoteSubmitted
      ? `<strong>Vote submitted</strong><span>${ps.pendingMafiaVotes || 0} Mafia vote(s) still pending.</span>`
      : '<strong>Mafia vote</strong><span>Choose an alive target with your team, then submit.</span>';
    return '<strong>Night action</strong><span>Wait silently while Mafia acts.</span>';
  }
  if (ps.phase === 'night_sheriff') {
    if (ps.role === 'Sheriff') return ps.sheriffResult || ps.actionNoticeTitle
      ? `<strong>${escapeHtml(ps.actionNoticeTitle || 'Investigation complete')}</strong><span>${escapeHtml(ps.actionNoticeBody || 'Your result is shown below. Keep it private until discussion.')}</span>`
      : '<strong>Investigate</strong><span>Choose one alive player to inspect.</span>';
    return '<strong>Night action</strong><span>Wait silently while the Sheriff acts.</span>';
  }
  if (ps.phase === 'night_doctor') {
    if (ps.role === 'Doctor') return ps.doctorProtectCurrent || ps.actionNoticeTitle
      ? `<strong>${escapeHtml(ps.actionNoticeTitle || 'Protection submitted')}</strong><span>${escapeHtml(ps.actionNoticeBody || 'Your protected target is selected below.')}</span>`
      : '<strong>Protect</strong><span>Choose one alive player. You cannot repeat last night.</span>';
    return '<strong>Night action</strong><span>Wait silently while the Doctor acts.</span>';
  }
  if (ps.phase === 'night_vigilante') {
    if (ps.role === 'Vigilante') return ps.vigilanteTargetCurrent
      ? '<strong>Shot submitted</strong><span>Your target is selected below.</span>'
      : '<strong>Vigilante choice</strong><span>Choose a target or skip to save your shot.</span>';
    return '<strong>Night action</strong><span>Wait silently while the Vigilante acts.</span>';
  }
  if (ps.phase === 'morning') return '<strong>Morning report</strong><span>Review what happened overnight, then prepare for discussion.</span>';
  if (ps.phase === 'final_statements') {
    if (ps.finalStatementEligible && !ps.finalStatementSubmitted) return '<strong>Final words</strong><span>You may send one final public statement.</span>';
    if (ps.finalStatementEligible) return '<strong>Final words sent</strong><span>Wait for the table to continue.</span>';
    return '<strong>Final statements</strong><span>Listen while eliminated players speak.</span>';
  }
  if (ps.phase === 'discussion') return '<strong>Discussion open</strong><span>Talk at the table or use public chat. Watch the timer.</span>';
  if (ps.phase === 'day_vote') return ps.dayVoteSubmitted
    ? `<strong>Vote submitted</strong><span>${ps.pendingDayVotes || 0} alive player vote(s) still pending.</span>`
    : '<strong>Day vote</strong><span>Choose an alive player or abstain. Strict majority is required.</span>';
  return '<strong>Waiting</strong><span>No action is needed right now.</span>';
}

function renderRole(ps) {
  state.currentPlayerPhase = ps.phase;
  const role = ps.role || '';
  const roleClass = String(role || 'town').toLowerCase();
  const team = ps.role === 'Mafia' && ps.mafiaTeam?.length
    ? ` Team: ${ps.mafiaTeam.map((mate) => mate.name).join(', ')}.`
    : '';
  if (state.roleReveal.lastPhase !== ps.phase || state.roleReveal.lastRound !== ps.round || state.roleReveal.lastRole !== role) {
    state.roleReveal = { revealed: false, acknowledged: false, lastPhase: ps.phase, lastRound: ps.round, lastRole: role };
  }
  renderDealStage(ps);
  const canPeek = !!role && ps.phase !== 'lobby';
  const cardRevealed = canPeek && (state.roleReveal.revealed || state.roleReveal.acknowledged);
  const cardMasked = canPeek && !cardRevealed;
  $('role-symbol').innerHTML = roleIcon(cardRevealed ? role : 'Hidden');
  $('role-name').textContent = cardRevealed ? role.toUpperCase() : (canPeek ? 'HIDDEN' : 'WAITING');
  $('role-desc').textContent = cardRevealed
    ? `${ps.roleDescription || 'Role appears after the host launches the game.'}${team}`
    : (canPeek ? 'Tap to peek. Tap again to hide before handing the screen around.' : 'Role appears after the host launches the game.');
  $('vigi-ammo').textContent = cardRevealed && ps.role === 'Vigilante' ? `Shots remaining: ${ps.vigilanteShotsRemaining}` : '';
  $('role-card').className = `role-card ${cardRevealed ? 'revealed ' + roleClass : 'neutral'} ${cardMasked ? 'masked' : ''}`;
  $('role-card').setAttribute('aria-pressed', cardRevealed ? 'true' : 'false');
  $('role-card').setAttribute('aria-label', cardRevealed ? 'Hide role card' : 'Reveal role card');
  const playGrid = document.querySelector('#tab-play .play-grid');
  if (playGrid) {
    playGrid.classList.toggle('deal-scene', ps.phase === 'night0');
    playGrid.classList.remove('role-peeking', 'role-mafia', 'role-sheriff', 'role-doctor', 'role-vigilante', 'role-town');
    if (cardRevealed) playGrid.classList.add('role-peeking', `role-${roleClass}`);
  }
  $('night0-controls').classList.toggle('hidden', ps.phase !== 'night0');
}

function toggleRolePeek() {
  if (!$('role-state') || $('role-state').classList.contains('hidden')) return;
  state.roleReveal.revealed = !state.roleReveal.revealed;
  state.roleReveal.acknowledged = false;
  state.lastActionRenderKey = '';
  refreshPlayer().catch((err) => setMessage(err.message, true));
}

function roleCardKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleRolePeek();
}

function renderDealStage(ps) {
  const stage = $('deal-stage');
  if (!stage) return;
  const showDeal = ps.phase === 'night0';
  stage.classList.toggle('hidden', !showDeal);
  if (!showDeal) {
    stage.innerHTML = '';
    state.dealRenderKey = '';
    return;
  }
  const players = ps.players || [];
  const selfIndex = Math.max(0, players.findIndex((p) => p.id === ps.id));
  const revealed = state.roleReveal.revealed || state.roleReveal.acknowledged;
  const dealKey = `${ps.round}|${ps.id}|${ps.role}|${players.map((player) => player.id).join(',')}`;
  if (state.dealRenderKey !== dealKey || !stage.innerHTML) {
    state.dealRenderKey = dealKey;
    stage.innerHTML = `
    <div class="deal-header">
      <strong></strong>
      <span></span>
    </div>
    <div class="deal-table" style="--card-count:${Math.max(players.length, 1)}">
      ${players.map((player, index) => {
        const isSelf = index === selfIndex;
        return `
          <article class="deal-card ${isSelf ? 'mine' : ''}" style="--deal-index:${index}; --deal-mid:${selfIndex}">
            <div class="deal-card-inner">
              <div class="deal-card-back"><span></span></div>
              <div class="deal-card-front ${String(ps.role || '').toLowerCase()}">
                ${roleIcon(ps.role)}
                <strong>${escapeHtml(ps.role || 'Role')}</strong>
                <small>${isSelf ? 'Your card' : 'Hidden'}</small>
              </div>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
  }
  stage.classList.toggle('role-revealed', revealed);
  stage.querySelector('.deal-header strong').textContent = revealed ? `You are the ${ps.role || 'Unknown'}` : 'Cards are being dealt';
  stage.querySelector('.deal-header span').textContent = revealed ? 'This copied card becomes your private role card below.' : `${players.length} role card(s) for ${players.length} seated player(s).`;
  stage.querySelectorAll('.deal-card').forEach((card, index) => {
    const isSelf = index === selfIndex;
    if (isSelf) {
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', revealed ? 'Hide your dealt role card' : 'Reveal your dealt role card');
      card.setAttribute('aria-pressed', revealed ? 'true' : 'false');
      if (!card.dataset.boundReveal) {
        card.dataset.boundReveal = 'true';
        card.addEventListener('click', toggleRolePeek);
        card.addEventListener('keydown', roleCardKeydown);
      }
    }
    card.classList.toggle('revealed', index === selfIndex && revealed);
  });
}

function aliveTargets(ps, allowSelf = false) {
  return (ps.players || []).filter((p) => p.alive && (allowSelf || p.id !== ps.id));
}

function submittedTarget(ps, action) {
  if (action === 'submit-mafia') return ps.mafiaVoteCurrent || '';
  if (action === 'submit-sheriff') return ps.sheriffTargetCurrent || '';
  if (action === 'submit-doctor') return ps.doctorProtectCurrent || '';
  if (action === 'submit-vigilante') return ps.vigilanteTargetCurrent || '';
  if (action === 'submit-day') return ps.dayVoteCurrent || '';
  return '';
}

function actionStoreKey(ps, action) {
  return `${ps.round}|${ps.phase}|${ps.role}|${action}`;
}

function roleIcon(kind) {
  if (kind === 'Mafia') {
    return '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M9 23h22l4 6H5l4-6Z"/><path d="M14 11h12l3 12H11l3-12Z"/><path d="M11 22h18"/></svg>';
  }
  if (kind === 'Sheriff') {
    return '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 6 4 6 7 1-2 7 3 6-7 2-5 5-5-5-7-2 3-6-2-7 7-1 4-6Z"/><path d="M16 20h8"/><path d="M20 16v8"/></svg>';
  }
  if (kind === 'Doctor') {
    return '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m27 5 8 8"/><path d="m22 10 8 8-15 15-8 2 2-8 15-15Z"/><path d="m11 25 4 4"/><path d="M5 35l7-7"/></svg>';
  }
  if (kind === 'Vigilante') {
    return '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 18h17l5 4v4H17l-2 6h-5l2-6H8v-8Z"/><path d="M25 18v-4h6"/><path d="M13 26h6"/></svg>';
  }
  if (kind === 'Town') {
    return '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 20 20 10l12 10"/><path d="M12 19v13h16V19"/><path d="M17 32v-8h6v8"/></svg>';
  }
  if (kind === 'Hidden') {
    return '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 8 32 20 20 32 8 20 20 8Z"/></svg>';
  }
  return '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m11 21 6 6 13-15"/></svg>';
}

function sheriffResultMarkup(ps) {
  if (!ps.sheriffResult) return '';
  const target = ps.sheriffResultTargetName ? `${escapeHtml(ps.sheriffResultTargetName)} is` : 'Result';
  return `
    <div class="result-card ${ps.sheriffResult === 'Mafia' ? 'mafia' : 'town'}">
      <span class="result-icon">${roleIcon(ps.sheriffResult)}</span>
      <div><strong>${target} ${escapeHtml(ps.sheriffResult)}</strong><span>${ps.sheriffResult === 'Mafia' ? 'Mafia alignment confirmed.' : 'Town alignment confirmed.'}</span></div>
    </div>
  `;
}

function targetTile(player, selected) {
  return `
    <button class="target-tile ${selected ? 'selected' : ''}" type="button" data-target-id="${escapeHtml(player.id)}" aria-pressed="${selected ? 'true' : 'false'}">
      <span class="target-frame">
        ${avatar(player, 'avatar target-avatar')}
        <span class="target-check">${roleIcon('check')}</span>
      </span>
      <span>${escapeHtml(player.name)}</span>
    </button>
  `;
}

function selectedTargetName(ps, selected, options) {
  if (options.includeAbstain && selected === '') return options.skipLabel || 'Skip';
  return (ps.players || []).find((player) => player.id === selected)?.name || '';
}

function actionPicker(action, ps, options) {
  const storeKey = actionStoreKey(ps, action);
  const existing = Object.prototype.hasOwnProperty.call(state.pendingTargetByPhase, storeKey)
    ? state.pendingTargetByPhase[storeKey]
    : submittedTarget(ps, action);
  const selected = existing ?? '';
  const targets = aliveTargets(ps, !!options.allowSelf);
  const selectedName = selectedTargetName(ps, selected, options);
  const tiles = targets.map((player) => targetTile(player, selected === player.id)).join('');
  const abstainTile = options.includeAbstain
    ? `<button class="target-tile skip ${selected === '' ? 'selected' : ''}" type="button" data-target-id="" aria-pressed="${selected === '' ? 'true' : 'false'}"><span class="target-frame"><span class="skip-mark">--</span><span class="target-check">${roleIcon('check')}</span></span><span>${escapeHtml(options.skipLabel || 'Skip')}</span></button>`
    : '';
  const doctorRepeat = action === 'submit-doctor' && selected && selected === ps.lastDoctorTarget;
  const needsTarget = !options.includeAbstain && !selected;
  const locked = (action === 'submit-sheriff' && !!ps.sheriffTargetCurrent) || (action === 'submit-doctor' && !!ps.doctorProtectCurrent);
  return `
    <div class="target-action" data-target-action="${action}" data-store-key="${escapeHtml(storeKey)}" data-requires-target="${options.includeAbstain ? 'false' : 'true'}" data-last-doctor-target="${escapeHtml(ps.lastDoctorTarget || '')}" data-locked="${locked ? 'true' : 'false'}">
      <input id="act-target" type="hidden" value="${escapeHtml(selected)}">
      <div class="target-grid">${abstainTile}${tiles || '<p class="muted">No alive targets available.</p>'}</div>
      <p id="selected-target-summary" class="selected-target-summary ${selectedName ? '' : 'hidden'}">Selected: <strong>${escapeHtml(selectedName)}</strong></p>
      <button class="primary-button" data-action="${action}" ${locked || doctorRepeat || needsTarget ? 'disabled' : ''}>${escapeHtml(locked ? 'Submitted' : options.label)}</button>
      <p id="action-warning" class="action-warning ${doctorRepeat ? '' : 'hidden'}">Doctors cannot protect the same player on consecutive nights. Choose another alive player.</p>
      <p class="muted">${escapeHtml(options.hint)}</p>
      ${options.extra || ''}
    </div>
  `;
}

function actionMarkup(ps) {
  if (ps.phase === 'final_statements') {
    if (ps.finalStatementEligible && !ps.finalStatementSubmitted) {
      return '<div class="form-stack"><textarea id="final-statement-input" maxlength="240" placeholder="Your final statement"></textarea><button class="primary-button" data-action="submit-final">Submit final statement</button><p class="muted">One message, max 240 characters.</p></div>';
    }
    if (ps.finalStatementEligible) return '<p class="muted">Final statement submitted. Waiting for the table.</p>';
    return '<p class="muted">Final statements are in progress. Listen carefully.</p>';
  }
  if (!ps.alive) return '<p class="danger-text">You are dead. Observe only. The table overview is open below.</p>';
  if (ps.phase === 'night_mafia' && ps.role === 'Mafia') return actionPicker('submit-mafia', ps, { label: 'Submit mafia vote', hint: `${ps.pendingMafiaVotes || 0} mafia pending.` });
  if (ps.phase === 'night_sheriff' && ps.role === 'Sheriff') return actionPicker('submit-sheriff', ps, { label: 'Investigate', hint: 'Choose one alive player to inspect.', extra: sheriffResultMarkup(ps) });
  if (ps.phase === 'night_doctor' && ps.role === 'Doctor') return actionPicker('submit-doctor', ps, { label: 'Protect', hint: 'You may protect yourself, but cannot repeat last night.', allowSelf: true });
  if (ps.phase === 'night_vigilante' && ps.role === 'Vigilante') return actionPicker('submit-vigilante', ps, { label: 'Shoot / skip', hint: 'Choose an alive player or skip to save the shot.', includeAbstain: true, skipLabel: 'Skip shot' });
  if (ps.phase === 'day_vote') return actionPicker('submit-day', ps, { label: 'Submit vote', hint: `Strict majority required. ${ps.pendingDayVotes || 0} players pending.`, includeAbstain: true, skipLabel: 'Abstain' });
  if (ps.phase === 'morning') return `<p>${ps.morningDeaths?.length ? ps.morningDeaths.map((d) => escapeHtml(d.name)).join(', ') + ' died.' : 'No one died.'}</p>`;
  if (ps.phase === 'discussion') return '<p>Discussion is open. Use the public channel or talk at the table.</p>';
  if (ps.phase === 'game_over' && ps.winner === 'Voided') return '<p class="winner-text">Game voided by GM</p><p class="muted">No scores were recorded. Wait for the lobby reset.</p>';
  if (ps.phase === 'game_over') return `<p class="winner-text">Winner: ${escapeHtml(ps.winner || 'Unknown')}</p>`;
  return '<p class="muted">No action right now.</p>';
}

function refreshActionChoice(panel) {
  const selected = panel.querySelector('#act-target')?.value || '';
  const button = panel.querySelector('[data-action]');
  const warning = panel.querySelector('#action-warning');
  const summary = panel.querySelector('#selected-target-summary');
  const selectedTile = panel.querySelector('.target-tile.selected');
  const doctorRepeat = panel.dataset.targetAction === 'submit-doctor' && selected && selected === panel.dataset.lastDoctorTarget;
  const needsTarget = panel.dataset.requiresTarget === 'true' && !selected;
  const locked = panel.dataset.locked === 'true';
  if (button) button.disabled = locked || doctorRepeat || needsTarget;
  if (warning) warning.classList.toggle('hidden', !doctorRepeat);
  if (summary) {
    const label = selectedTile?.querySelector('span:last-child')?.textContent || '';
    summary.classList.toggle('hidden', !label);
    summary.innerHTML = label ? `Selected: <strong>${escapeHtml(label)}</strong>` : '';
  }
  if (doctorRepeat) setMessage('Doctor rule: you cannot protect the same target on consecutive nights.', true);
}

function bindActionTargets(panel) {
  const targetInput = panel.querySelector('#act-target');
  if (!targetInput) return;
  if (panel.dataset.locked === 'true') {
    panel.querySelectorAll('[data-target-id]').forEach((tile) => {
      tile.disabled = true;
      tile.setAttribute('aria-disabled', 'true');
    });
    refreshActionChoice(panel);
    return;
  }
  panel.querySelectorAll('[data-target-id]').forEach((tile) => tile.addEventListener('click', () => {
    targetInput.value = tile.dataset.targetId || '';
    state.pendingTargetByPhase[panel.dataset.storeKey] = targetInput.value;
    panel.querySelectorAll('[data-target-id]').forEach((candidate) => {
      const selected = candidate === tile;
      candidate.classList.toggle('selected', selected);
      candidate.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    refreshActionChoice(panel);
    if (state.lastPlayerState) renderMobileActionTray(state.lastPlayerState);
  }));
  refreshActionChoice(panel);
}

function renderPlayerAction(ps) {
  const actionKey = `${ps.round}|${ps.phase}|${ps.role}|${ps.alive}|${ps.mafiaVoteSubmitted}|${ps.dayVoteSubmitted}|${ps.mafiaVoteCurrent}|${ps.sheriffTargetCurrent}|${ps.doctorProtectCurrent}|${ps.vigilanteTargetCurrent}|${ps.dayVoteCurrent}|${ps.pendingMafiaVotes}|${ps.pendingDayVotes}|${ps.sheriffResult}|${ps.sheriffResultTargetName}|${ps.lastDoctorTarget}|${ps.finalStatementEligible}|${ps.finalStatementSubmitted}`;
  if (state.lastActionRenderKey === actionKey) return;
  state.lastActionRenderKey = actionKey;
  $('player-action-panel').innerHTML = actionMarkup(ps);
  $('player-action-panel').querySelectorAll('[data-action]').forEach((btn) => btn.addEventListener('click', () => submitAction(btn.dataset.action)));
  $('player-action-panel').querySelectorAll('.target-action').forEach(bindActionTargets);
}

function renderPlayerList(players) {
  $('player-list').innerHTML = players.map((p) => `
    <article class="player-row ${p.alive ? '' : 'dead'}">
      ${avatar(p)}
      <div><strong>${escapeHtml(p.name)}</strong><span>${p.revealedRole || (p.alive ? 'In play' : 'Unknown')}</span></div>
      <em class="life-badge ${p.alive ? 'alive' : 'dead'}">${p.alive ? 'Alive' : 'Dead'}</em>
    </article>
  `).join('') || '<div class="empty-state">Waiting for players.</div>';
}

function renderChats(ps) {
  const mafiaPanel = $('mafia-chat-panel');
  const publicVisible = !!ps.publicChatVisible;
  const publicCanSend = !!ps.publicChatCanSend;
  mafiaPanel.classList.toggle('hidden', !(ps.role === 'Mafia' && ps.phase === 'night_mafia' && ps.alive));
  $('mafia-chat-log').innerHTML = chatLines(ps.mafiaChat || []);
  $('player-chat-log').innerHTML = publicVisible ? chatLines(ps.playerChat || []) : '<p class="muted">Public chat is hidden during private night actions.</p>';
  $('player-chat-input').disabled = !publicCanSend;
  $('player-chat-form').querySelector('button').disabled = !publicCanSend;
  $('player-chat-form').classList.toggle('disabled', !publicCanSend);
  $('player-chat-status').textContent = publicCanSend
    ? 'Public chat is open for alive players.'
    : (publicVisible ? 'Public chat is read-only right now.' : 'Public chat opens during morning, discussion, and voting.');
}

function chatLines(items) {
  return items.length ? items.map((m) => `<div><strong>${escapeHtml(m.author)}</strong> ${escapeHtml(m.message)}</div>`).join('') : '<p class="muted">No messages yet.</p>';
}

async function submitAction(action) {
  const targetId = $('act-target')?.value || null;
  const storeKey = document.querySelector('.target-action')?.dataset.storeKey || '';
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
  if (result.locked) {
    if (storeKey) delete state.pendingTargetByPhase[storeKey];
    setMessage(result.hold ? 'Action committed. Showing the result before the phase advances.' : `Action committed. Advanced to ${phaseTitle(result.phase, '')}.`);
    state.lastActionRenderKey = '';
    await refreshAll();
    return;
  }
  else if (action === 'submit-sheriff') setMessage('Investigation complete.');
  else if (action === 'submit-doctor') setMessage('Protection submitted.');
  else if (action === 'submit-vigilante') setMessage(targetId ? 'Shot submitted.' : 'Shot skipped.');
  else if (action === 'submit-mafia') setMessage('Mafia vote submitted.');
  else if (action === 'submit-day') setMessage('Vote submitted.');
  state.lastActionRenderKey = '';
  await refreshPlayer();
}

async function sendChat(kind) {
  const input = kind === 'mafia' ? $('mafia-chat-input') : $('player-chat-input');
  if (kind === 'player' && state.lastPlayerState && !state.lastPlayerState.publicChatCanSend) {
    setMessage('Public chat is closed right now.', true);
    return;
  }
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

async function createAdminUser(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  values.isAdmin = form.elements.isAdmin.checked;
  values.scoreGames = Number(values.scoreGames || 0);
  values.scoreWins = Number(values.scoreWins || 0);
  values.scoreLosses = Number(values.scoreLosses || 0);
  await api('/api/admin/users', { method: 'POST', body: JSON.stringify(values) });
  form.reset();
  form.elements.scoreGames.value = '0';
  form.elements.scoreWins.value = '0';
  form.elements.scoreLosses.value = '0';
  await refreshAdminUsers();
  setMessage('Player account created.');
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
    const room = state.rooms.find((candidate) => candidate.active) || state.rooms[0];
    if (room) joinRoom(room.id).catch((err) => setMessage(err.message, true));
    else setMessage('No room is available yet.', true);
  });
  $('save-setup-btn').addEventListener('click', () => saveSetup().catch((err) => setMessage(err.message, true)));
  $('launch-game-btn').addEventListener('click', () => launchGame().catch((err) => setMessage(err.message, true)));
  $('save-timers-btn').addEventListener('click', () => saveTimerSettings().catch((err) => setMessage(err.message, true)));
  $('public-day-tally').addEventListener('change', () => { state.settingsDirty = true; });
  $('start-night-btn').addEventListener('click', () => gmStartNight().catch((err) => setMessage(err.message, true)));
  $('next-phase-btn').addEventListener('click', () => gmNextPhase().catch((err) => setMessage(err.message, true)));
  $('void-game-btn').addEventListener('click', () => gmVoidGame().catch((err) => setMessage(err.message, true)));
  $('return-lobby-btn').addEventListener('click', () => gmReturnLobby().catch((err) => setMessage(err.message, true)));
  $('reset-lobby-btn').addEventListener('click', () => resetLobby().catch((err) => setMessage(err.message, true)));
  $('reveal-role-btn').addEventListener('click', () => { state.roleReveal.revealed = true; state.lastActionRenderKey = ''; refreshPlayer(); });
  $('hide-role-btn').addEventListener('click', () => { state.roleReveal.revealed = false; refreshPlayer(); });
  $('ack-role-btn').addEventListener('click', () => { state.roleReveal.acknowledged = true; state.roleReveal.revealed = true; refreshPlayer(); });
  $('role-card').addEventListener('click', toggleRolePeek);
  $('role-card').addEventListener('keydown', roleCardKeydown);
  $('mafia-chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat('mafia').catch((err) => setMessage(err.message, true)); });
  $('player-chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat('player').catch((err) => setMessage(err.message, true)); });
  $('profile-form').addEventListener('submit', (e) => { e.preventDefault(); saveProfile(e.currentTarget).catch((err) => setMessage(err.message, true)); });
  $('admin-create-user-form').addEventListener('submit', (e) => { e.preventDefault(); createAdminUser(e.currentTarget).catch((err) => setMessage(err.message, true)); });
  $('refresh-users-btn').addEventListener('click', () => refreshAdminUsers().catch((err) => setMessage(err.message, true)));
}

renderRoleControls();
renderTimerControls();
bindEvents();
refreshMe();
