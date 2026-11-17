import { parseArgs } from 'node:util';
import { createPrismaClient } from '@kavach/db';
import { ZodError } from 'zod';
import { addToProject, resetPassword } from './operator';

/**
 * Operator commands for accounts a Project Admin cannot manage, because the account reaches more
 * than one project (DECISIONS Q36; PROGRESS "Must fix before production" item 3).
 *
 *   pnpm user:reset-password -- --login asha@example.com --password "Initial#123"
 *   pnpm user:add-member -- --login 9876543210 --project SKY --role STORE_MANAGER --stores MAIN,YARD
 *
 * Both are written to the audit log as SYSTEM actions. Run them only on the owner's instruction.
 */
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      login: { type: 'string' },
      password: { type: 'string' },
      project: { type: 'string' },
      role: { type: 'string' },
      stores: { type: 'string' },
    },
  });
  const command = positionals[0];
  const need = (key: keyof typeof values): string => {
    const v = values[key];
    if (!v) throw new Error(`Missing --${key}`);
    return v;
  };
  const prisma = createPrismaClient();
  try {
    if (command === 'reset-password') {
      await resetPassword(prisma, need('login'), need('password'));
    } else if (command === 'add-member') {
      const role = (values.role ?? 'STORE_MANAGER').toUpperCase();
      if (role !== 'PROJECT_ADMIN' && role !== 'STORE_MANAGER') {
        throw new Error('--role must be PROJECT_ADMIN or STORE_MANAGER');
      }
      const stores = (values.stores ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await addToProject(prisma, need('login'), need('project'), role, stores);
    } else {
      throw new Error('Use: reset-password | add-member');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  if (e instanceof ZodError) console.error(e.issues.map((i) => i.message).join('; '));
  else console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
