const { spawn } = require('child_process');

const command = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
const child = spawn(command, ['exec:java'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error('Maven was not found on PATH.');
    console.error('Install Java 17+ and Maven 3.9+, then run `mvn exec:java` or `npm start` again.');
    process.exit(1);
    return;
  }
  console.error(error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
