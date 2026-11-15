/**
 * Hostinger Nest entry (must be .js).
 * Loads the built HRMS API in-process so Hostinger sees listen() on this PID
 * (spawning a child caused "App did not call listen() within 3 seconds" / 504).
 */
const { join } = require('path');

// Long-lived Node app on Hostinger + Neon pooler: keep a small Prisma pool.
if (process.env.DATABASE_URL && !/[?&]connection_limit=/.test(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL += (process.env.DATABASE_URL.includes('?') ? '&' : '?') + 'connection_limit=15&pool_timeout=20';
}

const apiDir = join(__dirname, 'apps', 'api');
process.chdir(apiDir);
require(join(apiDir, 'dist', 'main.js'));
