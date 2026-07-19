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
assert(backend.includes('PBKDF2WithHmacSHA256'), 'password hashing must use PBKDF2-HMAC-SHA256');
assert(backend.includes('majorityTarget(STATE.dayVotes, aliveCount())'), 'day vote resolution must use strict majority');
assert(backend.includes('payload.put("mafiaTeam"'), 'mafia teammate identities must be in private mafia payload');
assert(backend.includes('PUBLIC_CHAT_PHASES'), 'public chat phase restrictions must be server-side');
assert(backend.includes('activeRoomId'), 'local database must track the active hosted room');
assert(backend.includes('Another room is active'), 'room switching must be blocked while a table is in progress');
assert(read('.gitignore').includes('data/'), 'local database folder must be ignored');

if (!process.exitCode) {
  console.log('Static checks passed.');
}
