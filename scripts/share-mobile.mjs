#!/usr/bin/env node
/**
 * pnpm share:mobile: start the mobile app for Expo Go, pointed at the public link that
 * `pnpm share` opened. Run it in a second terminal while `pnpm share` is running.
 *
 * Phones scan the QR code with the Expo Go app (Android) or the Camera app (iPhone).
 * --tunnel lets phones on any network reach it, not only the same Wi-Fi.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let publicUrl;
try {
  publicUrl = readFileSync(path.join(root, '.local', 'share-url.txt'), 'utf8').trim();
} catch {
  console.error('\n✖ Run "pnpm share" in another terminal first, and wait for the link.\n');
  process.exit(1);
}

const apiUrl = `${publicUrl}/kapi`;
console.log(`\nMobile app will talk to: ${apiUrl}\n`);

const child = spawn('pnpm exec expo start --tunnel --clear', {
  cwd: path.join(root, 'apps', 'mobile'),
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_API_URL: apiUrl },
});
child.on('exit', (code) => process.exit(code ?? 0));
