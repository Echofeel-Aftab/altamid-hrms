/**
 * Hostinger Nest entry (must be .js).
 * Loads the built HRMS API in-process so Hostinger sees listen() on this PID
 * (spawning a child caused "App did not call listen() within 3 seconds" / 504).
 */
const { join } = require('path');

const apiDir = join(__dirname, 'apps', 'api');
process.chdir(apiDir);
require(join(apiDir, 'dist', 'main.js'));
