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
const gameRules = read('src/main/java/com/maffia/GameRules.java');
const gameRulesTest = read('src/test/java/com/maffia/GameRulesTest.java');
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
assert(read('pom.xml').includes('junit-jupiter') && read('pom.xml').includes('maven-surefire-plugin'), 'Maven must include JUnit and Surefire for executable tests');
assert(gameRules.includes('majorityTarget') && gameRules.includes('tallyVotes'), 'vote resolution helpers must live in testable GameRules');
assert(gameRulesTest.includes('strictMajorityRequiresMoreThanHalfOfAliveVoters') && gameRulesTest.includes('strictMajorityIgnoresAbstentionsAndSkipsNoMajority') && gameRulesTest.includes('tiesDoNotResolveEvenWhenVoteCountMeetsThreshold'), 'JUnit vote tests must cover majority, abstentions, and ties');
assert(gameRules.includes('winnerFor') && gameRulesTest.includes('mafiaWinsAtParityOrMajority') && gameRulesTest.includes('townWinsOnlyAfterAssignedRolesWhenNoMafiaRemain'), 'JUnit rule tests must cover win-condition decisions');
assert(gameRules.includes('nextNightRolePhase') && gameRulesTest.includes('nightPhaseOrderSkipsDeadOrMissingOptionalRoles') && gameRulesTest.includes('nightPhaseOrderContinuesFromCurrentRoleOnly'), 'JUnit rule tests must cover night role phase ordering');
assert(backend.includes('PBKDF2WithHmacSHA256'), 'password hashing must use PBKDF2-HMAC-SHA256');
assert(backend.includes('"POST".equals(method) && "/api/admin/users".equals(path)'), 'admin must be able to create user accounts');
assert(backend.includes('"/api/gm/void"') && backend.includes('"Voided"') && backend.includes('No scores were recorded'), 'GM must be able to void a game without recording scores');
assert(backend.includes('"/api/gm/return-lobby"') && backend.includes('returnToLobbyKeepingSeats'), 'GM must be able to return from outcome scene to lobby while keeping seats');
assert(backend.includes('pendingActionPlayers') && backend.includes('pendingActionPlayerNames') && backend.includes('currentActionName'), 'GM state must expose current pending action names');
assert(backend.includes('adminCount()') && backend.includes('At least one admin account must remain.'), 'admin management must prevent last-admin lockout');
assert(backend.includes('majorityTarget(STATE.dayVotes, aliveCount())'), 'day vote resolution must use strict majority');
assert(backend.includes('payload.put("mafiaTeam"'), 'mafia teammate identities must be in private mafia payload');
assert(backend.includes('PUBLIC_CHAT_PHASES') && backend.includes('PUBLIC_CHAT_VISIBLE_PHASES'), 'public chat send and visibility restrictions must be server-side');
assert(backend.includes('final_statements') && backend.includes('finalStatementPlayerIds'), 'final-statements phase must be implemented server-side');
assert(backend.includes('Final statement already submitted'), 'final statements must be limited to one per eligible player');
assert(backend.includes('majorityTarget(STATE.mafiaVotes, alivePlayersByRole("Mafia").size()) != null'), 'mafia votes must early-lock on majority');
assert(backend.includes('majorityTarget(STATE.dayVotes, aliveCount()) != null || pending == 0'), 'day votes must resolve on majority or all votes submitted');
assert((backend.match(/"locked", true, "phase", STATE\.phase/g) || []).length >= 2 && (backend.match(/"locked", true, "hold", true, "phase", STATE\.phase/g) || []).length >= 2, 'night and vote submits must return immediate locks or visible hold locks when action resolution completes');
assert(backend.includes('startPhaseTicker') && backend.includes('scheduleAtFixedRate'), 'server must run an independent phase ticker');
assert(backend.includes('lastDoctorTarget') && backend.includes('sheriffResultTargetName'), 'player payload must include action guidance context');
assert(backend.includes('sheriffTargetCurrent') && backend.includes('doctorProtectCurrent') && backend.includes('vigilanteTargetCurrent'), 'player payload must preserve submitted action choices');
assert(backend.includes('boolean mafia = "Mafia".equals(p.role)') && backend.includes('pendingMafiaVotes", mafia ?') && backend.includes('sheriffResult", sheriff ?') && backend.includes('lastDoctorTarget", doctor ?'), 'player payload must role-gate private action context');
assert(backend.includes('ACTION_RESULT_HOLD_MS') && backend.includes('holdActionResult') && backend.includes('actionNoticeTitle'), 'Sheriff and Doctor submits must hold the phase briefly with visible action notices');
assert(backend.includes('"/api/gm/players/"') && backend.includes('Seats can only be removed before the game starts'), 'GM must be able to remove lobby player seats before launch');
assert(backend.includes('!Objects.equals(previous, stored)') && backend.includes('!target.equals(previous)'), 'unchanged repeated votes must not duplicate system messages');
assert(backend.includes('boolean manager = canManageGame(account)') && backend.includes('manager ? chatPayload(STATE.mafiaChat) : List.of()'), 'GM state must hide private console data from non-managers');
assert(backend.includes('observerPlayers') && backend.includes('observerPendingActionPlayers') && backend.includes('observerLastSheriffResult'), 'dead player payload must expose read-only observer table overview fields');
assert(backend.includes('activeRoomId'), 'local database must track the active hosted room');
assert(backend.includes('Another room is active'), 'room switching must be blocked while a table is in progress');
assert(backend.includes('"/api/my-player"') && backend.includes('findPlayerByAccount(account.id)'), 'server must expose account-based player seat recovery');
assert(backend.includes('PUBLIC_URL') && backend.includes('publicUrlSecure'), 'server info must expose secure public URL status');
assert(html.includes('data-copy-target="lan-url"') && html.includes('data-copy-target="public-url"'), 'invite links must have copy controls');
assert(html.includes('admin-create-user-form'), 'admin create-user form must exist');
assert(html.includes('void-game-btn') && app.includes('gmVoidGame') && html.includes('return-lobby-btn') && app.includes('gmReturnLobby'), 'GM screen must expose void-game and return-lobby actions');
assert(html.includes('action-panel-shell') && html.includes('table-panel'), 'play screen must expose dedicated action/table layout regions');
assert(html.includes('mobile-action-tray') && html.includes('tray-phase') && html.includes('tray-target'), 'play screen must expose a mobile action tray');
assert(html.includes('gm-phase-guide') && html.includes('player-phase-guide'), 'GM and player screens must expose phase guidance regions');
assert(html.includes('gm-setup-panel') && html.includes('gm-timer-panel') && html.includes('gm-console-panel'), 'Host screen must separate setup, timers, and GM console regions');
assert(html.includes('dead-overview-panel') && html.includes('dead-overview'), 'dead player play screen must include an observer overview mount');
assert(html.includes('deal-stage') && html.includes('role-symbol'), 'Night 0 role reveal must include the animated deal stage and role symbol slot');
assert(app.includes('copyInvite') && app.includes('navigator.clipboard.writeText'), 'invite copy action must be wired');
assert(app.includes('submit-final') && app.includes('final-statement-input'), 'final statement action must be wired in the UI');
assert(app.includes('target-tile') && app.includes('data-target-id') && !app.includes('function actionSelect'), 'player actions must use clickable target tiles instead of dropdown selects');
assert(app.includes('ps.round') && app.includes('doctorProtectCurrent') && app.includes('vigilanteTargetCurrent'), 'action choices must be keyed by round and restored after submit');
assert(app.includes('Doctor rule: you cannot protect the same target') && app.includes('lastDoctorTarget'), 'doctor repeat-target warning must be wired');
assert(app.includes('sheriffResultMarkup') && app.includes('sheriffResultTargetName') && app.includes('Mafia alignment confirmed'), 'sheriff result visual must be wired');
assert(app.includes('life-badge'), 'player list must use explicit alive/dead status badges');
assert(app.includes('gmGuidanceMarkup') && app.includes('playerGuidanceMarkup') && app.includes('Vote submitted'), 'GM and player phase guidance must be wired');
assert(app.includes('publicChatCanSend') && app.includes('publicChatVisible') && app.includes('player-chat-status'), 'player public chat must reflect server chat permissions');
assert(app.includes("gm.phase === 'lobby'") && app.includes('gmConsoleMarkup') && !app.includes('textContent = JSON.stringify'), 'GM active-round feed must be rendered as UI instead of raw JSON');
assert(app.includes("chatPreview('Mafia channel'") && app.includes("chatPreview('Public channel'") && app.includes('Day vote tally'), 'GM console must include separated chats and action summaries');
assert(app.includes('pendingActionMarkup') && app.includes('pending-chip'), 'GM console must render current pending action players');
assert(app.includes('gmCommand') || (app.includes('gm-command-shell') && app.includes('gmVisiblePlayers') && app.includes('data-gm-button')), 'GM active screen must render as a command-center scene excluding the GM account from displayed players');
assert(app.includes('renderDeadOverview') && app.includes('deadOverviewMarkup') && app.includes('observerPlayers'), 'dead players must render a read-only GM-style overview');
assert(app.includes('gm-action-notice') && app.includes('result.hold'), 'GM/player action result hold notices must be rendered before auto-advance');
assert(app.includes("document.querySelector('[data-tab=\"host\"]')") && app.includes('!gm.canManage'), 'Host tab must be hidden for non-managers');
assert(app.includes('renderDealStage') && app.includes('--card-count') && app.includes('Cards are being dealt'), 'Night 0 must render one animated card per seated player');
assert(app.includes('dealRenderKey') && app.includes('stage.querySelectorAll') && app.includes('This copied card becomes your private role card below.'), 'Night 0 deal animation must render once per deal and then update existing cards');
assert(app.includes("playGrid.classList.toggle('deal-scene', ps.phase === 'night0')") && app.includes('boundReveal'), 'Night 0 must switch to a full deal scene with a clickable dealt player card');
assert(app.includes('roleIcon') && app.includes("kind === 'Sheriff'") && app.includes("kind === 'Vigilante'"), 'role symbols must cover the supported role set');
assert(html.includes('role="button"') && app.includes('toggleRolePeek') && app.includes('roleCardKeydown'), 'role card peek toggle must be clickable and keyboard accessible');
assert(app.includes('role-peeking') && app.includes('Tap to peek. Tap again to hide'), 'role card must support reveal/hide peeking beyond startup');
assert(app.includes('selected-target-summary') && app.includes('Action committed. Advanced to'), 'action picker must show selected target and refresh after locked submits');
assert(app.includes('renderMobileActionTray') && app.includes('currentTargetLabel') && app.includes('phaseRemainingSec'), 'mobile action tray must render phase, timer, alive count, and selected target');
assert(app.includes('role-mini-icon') && app.includes('Vigilante shots'), 'setup role controls must show role symbols and vigilante ammunition setup');
assert(app.includes('state.settingsDirty = true') && app.includes("public-day-tally').addEventListener('change'"), 'timer controls must preserve edited values while polling');
assert(app.includes('removeSeat') && app.includes('data-remove-seat') && app.includes('manager-seat'), 'host roster must support manager-only lobby seat removal');
assert(app.includes('createAdminUser') && app.includes("'/api/admin/users'"), 'admin create-user action must be wired');
assert(app.includes('state.rooms.find((candidate) => candidate.active) || state.rooms[0]'), 'join shortcut must prefer the active hosted room');
assert(app.includes('recoverPlayerSeat') && app.includes("api('/api/my-player')"), 'client must recover player seat by account');
assert(read('src/main/resources/public/styles.css').includes('grid-template-areas') && read('src/main/resources/public/styles.css').includes('@media (orientation: portrait)'), 'play layout must keep separate landscape and portrait rules');
assert(read('src/main/resources/public/styles.css').includes('@keyframes dealShuffle') && read('src/main/resources/public/styles.css').includes('prefers-reduced-motion'), 'role deal animation must include reduced-motion support');
assert(read('src/main/resources/public/styles.css').includes('.play-grid.deal-scene') && read('src/main/resources/public/styles.css').includes('min-height: clamp(420px, 62vh, 700px)'), 'Night 0 deal scene must use the main play space');
assert(read('src/main/resources/public/styles.css').includes('.play-grid.role-peeking') && read('src/main/resources/public/styles.css').includes('.selected-target-summary'), 'role peek and selected-target UI states must be styled');
assert(read('src/main/resources/public/styles.css').includes('.mobile-action-tray') && read('src/main/resources/public/styles.css').includes('#tray-timer'), 'mobile action tray must be styled for portrait play');
assert(read('src/main/resources/public/styles.css').includes('.pending-card') && read('src/main/resources/public/styles.css').includes('.pending-chip'), 'GM pending helper must be styled as UI chips');
assert(read('src/main/resources/public/styles.css').includes('.gm-action-notice'), 'GM action result notice must be styled as a feed element');
assert(read('src/main/resources/public/styles.css').includes('.gm-command-shell') && read('src/main/resources/public/styles.css').includes('.gm-event-log') && read('src/main/resources/public/styles.css').includes('.gm-player-card'), 'GM command center scene must be styled with table stage and event log');
assert(read('src/main/resources/public/styles.css').includes('.dead-overview-panel') && read('src/main/resources/public/styles.css').includes('.dead-command-shell'), 'dead player observer overview must be styled as a wide command scene');
assert(read('src/main/resources/public/styles.css').includes('.host-grid.gm-command-view') && read('src/main/resources/public/styles.css').includes('width: min(980px, calc(100% - 56px))') && !read('src/main/resources/public/styles.css').includes('width: min(520px, 88%)'), 'active GM command view must use the available workspace width');
assert(read('src/main/resources/public/styles.css').includes('.seat-remove') && read('src/main/resources/public/styles.css').includes('.manager-seat'), 'host roster seat management must be styled');
assert(read('src/main/resources/public/styles.css').includes('.chat-status') && read('src/main/resources/public/styles.css').includes('.chat-form.disabled'), 'closed public chat state must be styled');
assert(read('.gitignore').includes('data/'), 'local database folder must be ignored');

if (!process.exitCode) {
  console.log('Static checks passed.');
}
