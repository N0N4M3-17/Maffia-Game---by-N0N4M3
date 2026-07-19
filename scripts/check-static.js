const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Static check failed: ${message}`);
    process.exitCode = 1;
  }
}

function nodeCheck(rel) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exitCode = 1;
  }
}

for (const file of ['index.html', 'app.js', 'styles.css']) {
  assert(read(`public/${file}`) === read(`src/main/resources/public/${file}`), `${file} differs between public mirrors`);
}

nodeCheck('src/main/resources/public/app.js');
nodeCheck('public/app.js');

const backend = read('src/main/java/com/maffia/Main.java');
const html = read('src/main/resources/public/index.html');
const app = read('src/main/resources/public/app.js');
const readme = read('README.md');
const gmRunbook = read('docs/GM_RUNBOOK.md');
const releaseChecklist = read('docs/RELEASE_CHECKLIST.md');
const ciWorkflow = read('.github/workflows/ci.yml');
const packageJson = JSON.parse(read('package.json'));
const nodeEntry = read('server.js');
const nodeLauncher = read('scripts/start-java-host.js');
assert(packageJson.scripts.start === 'node scripts/start-java-host.js', 'npm start must launch the Java host wrapper');
assert(nodeEntry.includes("require('./scripts/start-java-host')"), 'server.js must delegate to the Java host wrapper');
assert(nodeLauncher.includes("['exec:java']"), 'Node launcher must run Maven exec:java');
assert(readme.includes('docs/GM_RUNBOOK.md'), 'README must link the GM runbook');
assert(readme.includes('docs/RELEASE_CHECKLIST.md'), 'README must link the release checklist');
assert(gmRunbook.includes('First Admin Login') && gmRunbook.includes('Secure Public Hosting'), 'GM runbook must cover admin login and public hosting');
assert(releaseChecklist.includes('Clean Host Smoke Test') && releaseChecklist.includes('Known Limitations'), 'release checklist must cover smoke tests and known limitations');
assert(releaseChecklist.includes('PUBLIC_URL=https://your-secure-host.example mvn exec:java'), 'release checklist must cover secure public hosting verification');
assert(ciWorkflow.includes('actions/setup-java@v4') && ciWorkflow.includes('mvn -q test'), 'CI must run Maven tests with Java');
assert(ciWorkflow.includes('npm test'), 'CI must run static checks');
assert(backend.includes('PBKDF2WithHmacSHA256'), 'password hashing must use PBKDF2-HMAC-SHA256');
assert(backend.includes('"POST".equals(method) && "/api/admin/users".equals(path)'), 'admin must be able to create user accounts');
assert(backend.includes('adminCount()') && backend.includes('At least one admin account must remain.'), 'admin management must prevent last-admin lockout');
assert(backend.includes('majorityTarget(STATE.dayVotes, aliveCount())'), 'day vote resolution must use strict majority');
assert(backend.includes('payload.put("mafiaTeam"'), 'mafia teammate identities must be in private mafia payload');
assert(backend.includes('PUBLIC_CHAT_PHASES'), 'public chat phase restrictions must be server-side');
assert(backend.includes('final_statements') && backend.includes('finalStatementPlayerIds'), 'final-statements phase must be implemented server-side');
assert(backend.includes('Final statement already submitted'), 'final statements must be limited to one per eligible player');
assert(backend.includes('majorityTarget(STATE.mafiaVotes, alivePlayersByRole("Mafia").size()) != null'), 'mafia votes must early-lock on majority');
assert(backend.includes('majorityTarget(STATE.dayVotes, aliveCount()) != null || pending == 0'), 'day votes must resolve on majority or all votes submitted');
assert(backend.includes('startPhaseTicker') && backend.includes('scheduleAtFixedRate'), 'server must run an independent phase ticker');
assert(backend.includes('lastDoctorTarget') && backend.includes('sheriffResultTargetName'), 'player payload must include action guidance context');
assert(backend.includes('sheriffTargetCurrent') && backend.includes('doctorProtectCurrent') && backend.includes('vigilanteTargetCurrent'), 'player payload must preserve submitted action choices');
assert(backend.includes('!Objects.equals(previous, stored)') && backend.includes('!target.equals(previous)'), 'unchanged repeated votes must not duplicate system messages');
assert(backend.includes('activeRoomId'), 'local database must track the active hosted room');
assert(backend.includes('Another room is active'), 'room switching must be blocked while a table is in progress');
assert(backend.includes('"/api/my-player"') && backend.includes('findPlayerByAccount(account.id)'), 'server must expose account-based player seat recovery');
assert(backend.includes('PUBLIC_URL') && backend.includes('publicUrlSecure'), 'server info must expose secure public URL status');
assert(html.includes('data-copy-target="lan-url"') && html.includes('data-copy-target="public-url"'), 'invite links must have copy controls');
assert(html.includes('admin-create-user-form'), 'admin create-user form must exist');
assert(html.includes('action-panel-shell') && html.includes('table-panel'), 'play screen must expose dedicated action/table layout regions');
assert(html.includes('gm-phase-guide') && html.includes('player-phase-guide'), 'GM and player screens must expose phase guidance regions');
assert(html.includes('gm-setup-panel') && html.includes('gm-timer-panel') && html.includes('gm-console-panel'), 'Host screen must separate setup, timers, and GM console regions');
assert(app.includes('copyInvite') && app.includes('navigator.clipboard.writeText'), 'invite copy action must be wired');
assert(app.includes('submit-final') && app.includes('final-statement-input'), 'final statement action must be wired in the UI');
assert(app.includes('target-tile') && app.includes('data-target-id') && !app.includes('function actionSelect'), 'player actions must use clickable target tiles instead of dropdown selects');
assert(app.includes('ps.round') && app.includes('doctorProtectCurrent') && app.includes('vigilanteTargetCurrent'), 'action choices must be keyed by round and restored after submit');
assert(app.includes('Doctor rule: you cannot protect the same target') && app.includes('lastDoctorTarget'), 'doctor repeat-target warning must be wired');
assert(app.includes('sheriffResultMarkup') && app.includes('sheriffResultTargetName') && app.includes('Mafia alignment confirmed'), 'sheriff result visual must be wired');
assert(app.includes('life-badge'), 'player list must use explicit alive/dead status badges');
assert(app.includes('gmGuidanceMarkup') && app.includes('playerGuidanceMarkup') && app.includes('Vote submitted'), 'GM and player phase guidance must be wired');
assert(app.includes("gm.phase === 'lobby' || gm.phase === 'game_over'") && app.includes('gmConsoleMarkup') && !app.includes("'gm-action-status').textContent = JSON.stringify"), 'GM active-round feed must be rendered as UI instead of raw JSON');
assert(app.includes("chatPreview('Mafia channel'") && app.includes("chatPreview('Public channel'") && app.includes('Day vote tally'), 'GM console must include separated chats and action summaries');
assert(app.includes('createAdminUser') && app.includes("'/api/admin/users'"), 'admin create-user action must be wired');
assert(app.includes('state.rooms.find((candidate) => candidate.active) || state.rooms[0]'), 'join shortcut must prefer the active hosted room');
assert(app.includes('recoverPlayerSeat') && app.includes("api('/api/my-player')"), 'client must recover player seat by account');
assert(read('src/main/resources/public/styles.css').includes('grid-template-areas') && read('src/main/resources/public/styles.css').includes('@media (orientation: portrait)'), 'play layout must keep separate landscape and portrait rules');
assert(read('.gitignore').includes('data/'), 'local database folder must be ignored');

if (!process.exitCode) {
  console.log('Static checks passed.');
}
