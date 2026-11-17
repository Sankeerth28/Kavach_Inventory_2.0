import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@kavach/shared';

/**
 * Every route must declare its access with exactly one of these decorators.
 * A route with no declaration is denied (default-deny, ARCHITECTURE §6.1).
 */
export type AccessRule =
  | { kind: 'public' }
  | { kind: 'authenticated'; allowPasswordChangePending: boolean }
  | { kind: 'permission'; anyOf: readonly PermissionCode[] };

export const ACCESS_KEY = 'kavach:access';

/** No login needed: health check, login, token refresh. */
export const Public = () => SetMetadata<string, AccessRule>(ACCESS_KEY, { kind: 'public' });

/** Any signed-in user, no project needed: own profile, change password. */
export const Authenticated = (opts: { allowPasswordChangePending?: boolean } = {}) =>
  SetMetadata<string, AccessRule>(ACCESS_KEY, {
    kind: 'authenticated',
    allowPasswordChangePending: opts.allowPasswordChangePending ?? false,
  });

/**
 * A member of the project in `X-Project-Id` whose role holds the permission
 * (any one of them when several are given). PRD §3.
 */
export const RequirePermission = (...anyOf: PermissionCode[]) =>
  SetMetadata<string, AccessRule>(ACCESS_KEY, { kind: 'permission', anyOf });
