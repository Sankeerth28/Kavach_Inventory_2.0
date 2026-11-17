import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { PermissionCode, RoleCode } from '@kavach/shared';
import type { Request } from 'express';
import { forbidden } from '../errors/domain-error';

/** Who is calling. Present on every authenticated request. */
export interface AuthContext {
  userId: string;
  userName: string;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Who is calling, in which project, with which role. Present on every project-scoped request. */
export interface RequestContext extends AuthContext {
  projectId: string;
  memberId: string;
  roleCode: RoleCode;
  permissions: ReadonlySet<PermissionCode>;
  /** Stores this member may operate. 'ALL' for Project Admins (DECISIONS Q2). */
  storeIds: readonly string[] | 'ALL';
}

export interface KavachRequest extends Request {
  auth?: AuthContext;
  ctx?: RequestContext;
}

/** The project-scoped context. Only available on routes declared with @RequirePermission. */
export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): RequestContext => {
  const ctx = host.switchToHttp().getRequest<KavachRequest>().ctx;
  if (!ctx) throw new Error('@Ctx() used on a route without @RequirePermission');
  return ctx;
});

/** The authenticated user, with or without a project. */
export const Auth = createParamDecorator((_: unknown, host: ExecutionContext): AuthContext => {
  const req = host.switchToHttp().getRequest<KavachRequest>();
  const auth = req.ctx ?? req.auth;
  if (!auth) throw new Error('@Auth() used on a public route');
  return auth;
});

/** Stock is store-level data: every stock operation checks the store (CLAUDE.md invariant 6). */
export function assertStoreAccess(ctx: RequestContext, storeId: string): void {
  if (ctx.storeIds !== 'ALL' && !ctx.storeIds.includes(storeId)) {
    throw forbidden('You are not assigned to this store.');
  }
}
