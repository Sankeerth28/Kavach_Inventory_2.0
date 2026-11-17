import { parseArgs } from 'node:util';
import { Prisma, addMember, createPrismaClient, createProject, syncSystemData } from '@kavach/db';
import { EmailSchema, PasswordSchema, PhoneSchema } from '@kavach/shared';
import { ZodError } from 'zod';
import { hashPassword } from '../common/auth/password.service';

/**
 * Operator command: creates a project and its first Project Admin (DECISIONS Q1).
 *
 *   pnpm project:create -- --code SKY --name "Skyline Residency" \
 *     --admin-name "Asha Rao" --admin-email asha@example.com --admin-password "Initial#123"
 *
 * Use --admin-phone instead of (or with) --admin-email. The admin must change the password at
 * first login. If the e-mail or phone already belongs to a user, that user is added to the new
 * project as its admin and the password is left alone.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      code: { type: 'string' },
      name: { type: 'string' },
      address: { type: 'string' },
      timezone: { type: 'string' },
      'admin-name': { type: 'string' },
      'admin-email': { type: 'string' },
      'admin-phone': { type: 'string' },
      'admin-password': { type: 'string' },
    },
  });
  const need = (key: keyof typeof values): string => {
    const v = values[key];
    if (!v) throw new Error(`Missing --${key}`);
    return v;
  };
  const code = need('code').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code))
    throw new Error('--code: 2–20 letters, digits or hyphens');
  const name = need('name');
  const email = values['admin-email'] ? EmailSchema.parse(values['admin-email']) : null;
  const phone = values['admin-phone'] ? PhoneSchema.parse(values['admin-phone']) : null;
  if (!email && !phone) throw new Error('Give --admin-email or --admin-phone');

  const prisma = createPrismaClient();
  try {
    await syncSystemData(prisma);
    const existing = await prisma.user.findFirst({
      where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
    });
    const passwordHash = existing
      ? null
      : await hashPassword(PasswordSchema.parse(need('admin-password')));

    const result = await prisma.$transaction(async (tx) => {
      const project = await createProject(tx, {
        code,
        name,
        address: values.address,
        timezone: values.timezone,
      });
      const user =
        existing ??
        (await tx.user.create({
          data: {
            name: need('admin-name'),
            email,
            phone,
            passwordHash: passwordHash!,
            mustChangePassword: true,
          },
        }));
      await addMember(tx, { projectId: project.id, userId: user.id, roleCode: 'PROJECT_ADMIN' });
      await tx.auditLog.create({
        data: {
          projectId: project.id,
          actorType: 'SYSTEM',
          action: 'user.create',
          entityType: 'user',
          entityId: user.id,
          after: {
            name: user.name,
            email: user.email,
            phone: user.phone,
            roleCode: 'PROJECT_ADMIN',
          },
          metadata: { source: 'operator-cli', existingUser: existing !== null },
        },
      });
      return { project, user };
    });
    console.log(`Project ${result.project.code} created (${result.project.id}).`);
    console.log(
      existing
        ? `Existing user ${result.user.name} added as Project Admin.`
        : `Project Admin ${result.user.name} created. They must change the password at first login.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  if (e instanceof ZodError) console.error(e.issues.map((i) => i.message).join('; '));
  else if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    console.error('A project with this code already exists.');
  } else console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
