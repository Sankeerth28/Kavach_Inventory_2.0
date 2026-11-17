/**
 * Rolls back ONE applied migration using the `down.sql` stored next to its `migration.sql`
 * (Prisma has no built-in down migrations). v2.1 rule: every migration ships a working down.sql.
 *
 *   pnpm db:migrate:down <migration_folder_name>
 *
 * Roll back newest first. Runs down.sql, then marks the migration as rolled back so a later
 * `pnpm db:deploy` applies it again.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!name) {
  console.error('Usage: pnpm db:migrate:down <migration_folder_name>');
  process.exit(1);
}
const down = path.join(pkg, 'prisma', 'migrations', name, 'down.sql');
if (!existsSync(down)) {
  console.error(`No down.sql for migration "${name}" (looked for ${down}).`);
  process.exit(1);
}
const prisma = createRequire(path.join(pkg, 'package.json')).resolve('prisma/build/index.js');
const run = (args) =>
  execFileSync(process.execPath, [prisma, ...args], {
    cwd: pkg,
    stdio: 'inherit',
  });

run(['db', 'execute', '--file', down, '--schema', 'prisma/schema.prisma']);
run(['migrate', 'resolve', '--rolled-back', name]);
console.log(`Rolled back ${name}.`);
