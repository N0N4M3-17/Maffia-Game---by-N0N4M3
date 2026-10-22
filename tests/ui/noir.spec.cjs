const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const account = { id: 'a1', displayName: 'Alex', username: 'alex', email: 'alex@example.test', isAdmin: true, scores: { games: 3, wins: 2, losses: 1 } };
const players = [
  { id: 'p1', accountId: 'a1', name: 'Alex', role: 'Sheriff', alive: true },
  { id: 'p2', accountId: 'a2', name: 'An exceptionally long player display name', role: 'Mafia', alive: true },
  { id: 'p3', accountId: 'a3', name: 'Morgan', role: 'Doctor', alive: true },
  { id: 'p4', accountId: 'a4', name: 'Jules', role: 'Jester', alive: false },
];
const timers = { nightMafiaSec: 200, nightSheriffSec: 200, nightDoctorSec: 200, nightVigilanteSec: 200, morningSec: 200, finalStatementSec: 45, discussionSec: 400, dayVoteSec: 200 };
test.beforeAll(() => fs.mkdirSync('artifacts/screenshots', { recursive: true }));

async function table(page, options = {}) {
  const snapshot = { phase: 'discussion', role: 'Sheriff', alive: true, winner: null, ...options };
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('playerId', 'p1'));
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const gm = { ...snapshot, round: 1, phaseRemainingSec: 100, autoReturnRemainingSec: 30, interactionTimeoutSec: 800, canManage: true,
      config: { mafia: 1, sheriff: 1, doctor: 1, vigilante: 0, jester: 1, town: 0, vigilanteShots: 1 },
      timerSettings: timers, players, playerCount: 4, room: { id: 'r1', name: 'The Midnight Table' }, playerChat: [], mafiaChat: [], pendingActionPlayers: [] };
    const ps = { ...gm, id: 'p1', name: 'Alex', account, aliveCount: 3, players: players.map((p) => ({ ...p, role: undefined, revealedRole: p.alive ? null : p.role })),
      roleDescription: 'Investigate one player each night.', publicChatVisible: true, publicChatCanSend: true,
      observerPlayers: !snapshot.alive || snapshot.phase === 'game_over' ? players : [] };
    let payload = { ok: true };
    if (pathname === '/api/me') payload = { account };
    if (pathname === '/api/gm-state') payload = gm;
    if (pathname.startsWith('/api/player-state/')) payload = ps;
    if (pathname === '/api/server-info') payload = { localhost: 'http://localhost:3028', lanUrls: ['http://192.168.1.10:3028'] };
    if (pathname === '/api/rooms') payload = { rooms: [{ id: 'r1', name: 'The Midnight Table', active: true }] };
    await route.fulfill({ json: payload });
  });
  await page.goto('/');
  await page.locator('[data-tab="play"]').click();
  await expect(page.locator(options.alive === false ? '#dead-overview' : '#role-card')).toBeVisible();
  return { snapshot, errors };
}

test('local assets and all responsive scenes render without overflow or JS errors', async ({ page, request }) => {
  const assets = ['/noir.css', '/vendor/lucide.js', '/assets/card-back.svg', '/assets/joker.svg'];
  for (const asset of assets) {
    const response = await request.get(asset);
    expect(response.ok()).toBeTruthy();
    if (asset.endsWith('.svg')) expect(response.headers()['content-type']).toContain('image/svg+xml');
  }
  const { snapshot, errors } = await table(page);
  fs.mkdirSync('artifacts/screenshots', { recursive: true });
  for (const [name, width, height] of [['desktop', 1440, 1000], ['portrait', 390, 844], ['landscape', 844, 390]]) {
    await page.setViewportSize({ width, height });
    for (const tab of ['rooms', 'profile', 'admin', 'host', 'play']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} ${tab} overflows`).toBeTruthy();
    }
    await page.screenshot({ path: `artifacts/screenshots/play-${name}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  snapshot.phase = 'lobby';
  await page.evaluate(() => refreshAll());
  await page.locator('[data-tab="host"]').click();
  const timer = page.locator('#set-discussionSec');
  await timer.fill('650');
  await page.evaluate(() => refreshAll());
  await expect(timer).toHaveValue('650');
  await expect(timer).toBeFocused();
  await page.screenshot({ path: 'artifacts/screenshots/lobby-desktop.png', fullPage: true });
  await page.locator('[data-tab="play"]').click();
  for (const role of ['Mafia', 'Sheriff', 'Doctor', 'Town', 'Vigilante', 'Jester']) {
    snapshot.role = role;
    snapshot.phase = 'night0';
    await page.evaluate(() => refreshAll());
    await page.locator('.deal-card.mine').click();
    await expect(page.locator('#role-name')).toHaveText(role.toUpperCase());
    await page.locator('.deal-card.mine .deal-card-inner').evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))));
    await page.screenshot({ path: `artifacts/screenshots/deal-${role.toLowerCase()}.png`, fullPage: true });
    await page.locator('.deal-card.mine').click();
    await expect(page.locator('#role-name')).toHaveText('HIDDEN');
  }
  expect(errors).toEqual([]);
});

test('account screen renders locally and real Java auth accepts email and username', async ({ page, request, playwright }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await expect(page.locator('#auth-view')).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: `artifacts/screenshots/account-${width}.png`, fullPage: true });
  }
  const username = `uitest${Date.now()}`;
  const email = `${username}@example.test`;
  const password = 'test-only-password';
  const registered = await request.post('/api/auth/register', { data: { email, username, password } });
  expect(registered.status()).toBe(201);
  const independent = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3028' });
  for (const login of [username, email]) {
    const response = await independent.post('/api/auth/login', { data: { login, password } });
    expect(response.ok()).toBeTruthy();
  }
  await independent.dispose();
  expect(errors).toEqual([]);
});

test('polling retains controls, draft messages, and selected targets', async ({ page }) => {
  await table(page, { phase: 'day_vote' });
  await page.locator('[data-target-id="p2"]').click();
  const target = await page.locator('[data-target-id="p2"]').elementHandle();
  await page.locator('#player-chat-input').fill('A private unfinished draft');
  await page.evaluate(() => refreshAll());
  await expect(page.locator('#player-chat-input')).toHaveValue('A private unfinished draft');
  await expect(page.locator('#player-chat-input')).toBeFocused();
  await expect(page.locator('[data-target-id="p2"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await target.evaluate((el) => el.isConnected)).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-play-tabs [data-mobile-pane="chat"]').click();
  await expect(page.locator('.chat-panel')).toBeVisible();
  await expect(page.locator('.table-panel')).toBeHidden();
});

test('GM actions require a cancellable keyboard-accessible confirmation', async ({ page }) => {
  await table(page, { phase: 'morning' });
  await page.locator('[data-tab="host"]').click();
  await page.locator('[data-gm-button="tools"]').click();
  await page.locator('[data-gm-spice="kill"]').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-dialog')).not.toBeVisible();
  await page.locator('[data-gm-spice="redraw"]').click();
  await page.locator('#confirm-dialog [value="confirm"]').click();
  await expect(page.locator('#app-message')).toContainText('Alive cards redrawn');
});

test('large observer tables keep long names and all role cards inside narrow layouts', async ({ page }) => {
  await table(page, { alive: false });
  await page.evaluate(() => {
    stopPolling();
    const ps = state.lastPlayerState;
    ps.observerPlayers = Array.from({ length: 20 }, (_, index) => ({ id: `large-${index}`, name: `Player ${index} with a long display name`, role: ['Mafia', 'Sheriff', 'Doctor', 'Town', 'Vigilante', 'Jester'][index % 6], alive: index % 4 !== 0 }));
    renderDeadOverview(ps);
  });
  for (const width of [360, 844, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await expect(page.locator('#dead-overview .gm-player-card')).toHaveCount(20);
    await page.screenshot({ path: `artifacts/screenshots/observer-${width}.png`, fullPage: true });
  }
});

test('outcomes, observer view, reduced motion, and inactivity warning', async ({ page }) => {
  const { snapshot } = await table(page);
  await page.evaluate(() => { state.lastLocalInteractionAt = Date.now() - 790000; updateActivityWarning(state.lastPlayerState); });
  await expect(page.locator('#inactivity-banner')).toBeVisible();
  await page.locator('#stay-in-game').click();
  await expect(page.locator('#inactivity-banner')).toBeHidden();
  snapshot.alive = false;
  await page.evaluate(() => refreshAll());
  await expect(page.locator('#dead-overview')).toBeVisible();
  for (const winner of ['Town', 'Mafia', 'Jester', 'Vigilante', 'Voided']) {
    snapshot.phase = 'game_over'; snapshot.winner = winner;
    snapshot.voidReason = 'A player left the table.';
    snapshot.winningPlayerId = winner === 'Jester' ? 'p4' : 'p1';
    snapshot.winningPlayerName = winner === 'Jester' ? 'Jules' : '';
    await page.evaluate(() => refreshAll());
    await expect(page.locator('#dead-overview .game-over-scene')).toBeVisible();
    await expect(page.locator('#dead-overview .victor-card strong')).toHaveText(winner === 'Voided' ? 'VOID' : winner);
    if (winner === 'Voided') await expect(page.locator('#dead-overview .outcome-copy')).toContainText('A player left');
    const card = await page.locator('#dead-overview .victor-card').elementHandle();
    await page.evaluate(() => refreshAll());
    expect(await card.evaluate((el) => el.isConnected)).toBeTruthy();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('#dead-overview .victor-card').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  snapshot.phase = 'lobby'; snapshot.winner = null; snapshot.alive = true;
  await page.evaluate(() => refreshAll());
  await expect(page.locator('#dead-overview-panel')).toBeHidden();
});
