#!/usr/bin/env node
/**
 * pnpm share: run KAVACH on this computer and give it a public https:// link (prototype demos).
 *
 * 1. Builds the apps with the API served through the web app at /kapi (one address, so the
 *    login cookie works).
 * 2. Opens a free Cloudflare quick tunnel to the web app (no account needed).
 * 3. Starts the API, the worker and the web app, and prints the link.
 *
 * The link works only while this window stays open and the computer stays on. It changes every
 * time you run the command. Press Ctrl + C to stop everything.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const children = [];

const say = (msg = '') => console.log(msg);
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  stopAll(1);
};

function stopAll(code = 0) {
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exit(code);
}
process.on('SIGINT', () => {
  say('\nStopping…');
  stopAll(0);
});

/** Reads one variable from the repo-root .env without loading it into this process. */
function envFileValue(name) {
  try {
    const line = readFileSync(path.join(root, '.env'), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 2000 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
  });
}

/** Runs a command, prefixing each output line with a tag so the logs stay readable. */
function run(tag, command, env = {}) {
  const child = spawn(command, {
    cwd: root,
    shell: true,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const print = (buf) => {
    for (const line of buf.toString().split(/\r?\n/)) if (line.trim()) say(`[${tag}] ${line}`);
  };
  child.stdout.on('data', print);
  child.stderr.on('data', print);
  child.on('exit', (code) => {
    if (code !== 0 && code !== null)
      fail(`${tag} stopped (exit code ${code}). See the lines above.`);
  });
  return child;
}

// ── 1. Checks ────────────────────────────────────────────────────────────────────────────────
if (spawnSync('cloudflared', ['--version'], { shell: true }).status !== 0) {
  fail(
    'cloudflared is not installed.\n' +
      '  Install it once:   winget install --id Cloudflare.cloudflared\n' +
      '  Then close this terminal, open a new one, and run pnpm share again.',
  );
}
if (!envFileValue('JWT_SECRET'))
  fail('No .env file with JWT_SECRET. Do the first-time setup in README.md.');

const dbUrl = envFileValue('DATABASE_URL') ?? '';
const dbMatch = /@([^:/]+):(\d+)\//.exec(dbUrl);
if (dbMatch && !(await canConnect(dbMatch[1], Number(dbMatch[2])))) {
  fail(
    `The database is not running on port ${dbMatch[2]}.\n` +
      '  Start it first (README, "Step 2. Start the database"), then run pnpm share again.',
  );
}

// ── 2. Build in "one address" mode ───────────────────────────────────────────────────────────
const buildEnv = { NEXT_PUBLIC_API_URL: '/kapi', API_PROXY_TARGET: 'http://localhost:3001' };
say('Building the apps (1–3 minutes)…');
const build = spawnSync('pnpm build', {
  cwd: root,
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, ...buildEnv },
});
if (build.status !== 0) fail('The build failed. See the errors above.');

// ── 3. Tunnel ────────────────────────────────────────────────────────────────────────────────
say('\nOpening the public link…');
const tunnel = spawn(
  'cloudflared',
  ['tunnel', '--no-autoupdate', '--url', 'http://localhost:3000'],
  {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
children.push(tunnel);
const publicUrl = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 60_000);
  const look = (buf) => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
    if (m) (clearTimeout(timer), resolve(m[0]));
  };
  tunnel.stdout.on('data', look);
  tunnel.stderr.on('data', look);
});
if (!publicUrl)
  fail('Cloudflare did not give a link within a minute. Check the internet connection.');

mkdirSync(path.join(root, '.local'), { recursive: true });
writeFileSync(path.join(root, '.local', 'share-url.txt'), publicUrl);

// ── 4. Start the apps ────────────────────────────────────────────────────────────────────────
const runEnv = {
  ...buildEnv,
  WEB_ORIGIN: `${publicUrl},http://localhost:3000`,
  COOKIE_PATH: '/kapi/auth',
  COOKIE_SECURE: 'true',
};
run('api', 'pnpm --filter @kavach/api start', runEnv);
run('worker', 'pnpm --filter @kavach/worker start', runEnv);
run('web', 'pnpm --filter @kavach/web start', runEnv);

const line = '═'.repeat(64);
setTimeout(() => {
  say(`\n${line}`);
  say('  KAVACH is online. Share this link:');
  say(`\n      ${publicUrl}\n`);
  say('  Demo logins (after pnpm db:seed), password Kavach@123:');
  say('      admin@kavach.local   (Project Admin)');
  say('      store@kavach.local   (Store Manager)');
  say('  Mobile app:  open a SECOND terminal and run   pnpm share:mobile');
  say('  Keep this window open. Ctrl + C stops everything.');
  say(`${line}\n`);
}, 8000);
