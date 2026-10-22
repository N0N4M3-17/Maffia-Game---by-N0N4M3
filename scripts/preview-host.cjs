const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const jdkRoot = path.join(os.homedir(), '.jdks');
const candidates = [process.env.JAVA_HOME, ...(fs.existsSync(jdkRoot) ? fs.readdirSync(jdkRoot).map((name) => path.join(jdkRoot, name)) : [])].filter(Boolean);
const java = candidates.map((dir) => path.join(dir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')).find(fs.existsSync) || 'java';
const gson = path.join(os.homedir(), '.m2/repository/com/google/code/gson/gson/2.11.0/gson-2.11.0.jar');
const classes = path.join(root, 'target/classes');
if (!fs.existsSync(path.join(classes, 'com/maffia/Main.class')) || !fs.existsSync(gson)) {
  throw new Error('Run mvn test first to compile Java and obtain Gson.');
}
const runtime = path.join(root, '.local-backups', 'ui-preview-runtime');
fs.mkdirSync(runtime, { recursive: true });
const child = spawn(java, ['-cp', [path.join(root, 'src/main/resources'), classes, gson].join(path.delimiter), 'com.maffia.Main'], {
  cwd: runtime, stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT || '3028' }, windowsHide: true,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('exit', (code) => process.exit(code || 0));
