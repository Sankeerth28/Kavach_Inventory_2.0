import { type PrismaClient, addMember } from '@kavach/db';
import { PasswordSchema, normaliseEmail, normalisePhone } from '@kavach/shared';
import { hashPassword } from '../common/auth/password.service';

/**
 * Operator actions on accounts a Project Admin cannot manage, because the account reaches more
 * than one project (DECISIONS Q36). Used by `user-admin.ts`; tested in
 * `apps/api/test/operator.spec.ts`. Both write SYSTEM audit rows.
 */
async function findUser(prisma: PrismaClient, login: string) {
  const user = login.includes('@')
    ? await prisma.user.findUnique({ where: { email: normaliseEmail(login) } })
    : await prisma.user.findUnique({ where: { phone: normalisePhone(login) } });
  if (!user) throw new Error(`No user with the login "${login}".`);
  return user;
}

export async function resetPassword(
  prisma: PrismaClient,
  login: string,
  password: string,
): Promise<void> {
  const user = await findUser(prisma, login);
  const passwordHash = await hashPassword(PasswordSchema.parse(password));
  const memberships = await prisma.projectMember.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: true },
    });
    // Every session ends: whoever holds the old password is signed out everywhere.
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // One row per project the account reaches, so each Project Admin sees it in their audit log.
    const projects = memberships.length > 0 ? memberships.map((m) => m.projectId) : [null];
    for (const projectId of projects) {
      await tx.auditLog.create({
        data: {
          projectId,
          actorType: 'SYSTEM',
          action: 'user.password_reset',
          entityType: 'user',
          entityId: user.id,
          metadata: { source: 'operator-cli' },
        },
      });
    }
  });
  console.log(`Password of ${user.name} reset. They must change it at the next login.`);
}

export async function addToProject(
  prisma: PrismaClient,
  login: string,
  projectCode: string,
  roleCode: 'PROJECT_ADMIN' | 'STORE_MANAGER',
  storeCodes: string[],
): Promise<void> {
  const user = await findUser(prisma, login);
  const project = await prisma.project.findUnique({ where: { code: projectCode.toUpperCase() } });
  if (!project) throw new Error(`No project with the code "${projectCode}".`);
  const existing = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: user.id } },
  });
  if (existing) throw new Error(`${user.name} is already a member of ${project.code}.`);

  const stores = await prisma.store.findMany({
    where: { projectId: project.id, code: { in: storeCodes.map((c) => c.toUpperCase()) } },
  });
  const missing = storeCodes.filter((c) => !stores.some((s) => s.code === c.toUpperCase()));
  if (missing.length > 0)
    throw new Error(`No such store in ${project.code}: ${missing.join(', ')}`);
  if (roleCode === 'STORE_MANAGER' && stores.length === 0) {
    throw new Error('A Store Manager needs at least one store: --stores CODE[,CODE]');
  }

  await prisma.$transaction(async (tx) => {
    await addMember(tx, {
      projectId: project.id,
      userId: user.id,
      roleCode,
      storeIds: stores.map((s) => s.id),
    });
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
          roleCode,
          stores: stores.map((s) => s.code),
        },
        metadata: { source: 'operator-cli', existingUser: true },
      },
    });
  });
  console.log(`${user.name} added to ${project.code} as ${roleCode}. Their password is unchanged.`);
}
