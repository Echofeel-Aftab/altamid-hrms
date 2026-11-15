/**
 * Hostinger Nest entry (must be .js). Boots the built HRMS API.
 */
const { spawn } = require('child_process');
const { join } = require('path');

const apiDir = join(__dirname, 'apps', 'api');
const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: apiDir,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code == null ? 1 : code);
});
