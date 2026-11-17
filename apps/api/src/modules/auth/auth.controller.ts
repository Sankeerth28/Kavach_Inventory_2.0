import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  type AuthResponse,
  ChangePasswordSchema,
  LoginSchema,
  type MeResponse,
  RefreshSchema,
} from '@kavach/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requestIdOf } from '../../app.setup';
import { Authenticated, Public } from '../../common/auth/access.decorators';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { Auth, type AuthContext } from '../../common/context/request-context';
import { forbidden, unauthenticated } from '../../common/errors/domain-error';
import { zod } from '../../common/validation/zod.pipe';
import { type AuthResult, AuthService, type RequestMeta } from './auth.service';

const REFRESH_COOKIE = 'kavach_refresh';

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

const meta = (req: Request): RequestMeta => ({
  requestId: requestIdOf(req),
  ip: req.ip ?? null,
  userAgent: req.headers['user-agent'] ?? null,
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Public()
  async login(
    @Body(zod(LoginSchema)) body: z.output<typeof LoginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.login(body.identifier, body.password, meta(req));
    return this.respond(res, result, body.client === 'web');
  }

  /**
   * Web sends the httpOnly cookie; mobile sends the token in the body.
   * The cookie path is checked against the allowed web origins, so another site cannot use it.
   */
  @Post('refresh')
  @HttpCode(200)
  @Public()
  async refresh(
    @Body(zod(RefreshSchema)) body: z.output<typeof RefreshSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const fromCookie = body.refreshToken === undefined;
    const token = body.refreshToken ?? this.cookieToken(req);
    if (!token) throw unauthenticated();
    try {
      const result = await this.auth.refresh(token, meta(req));
      return this.respond(res, result, fromCookie);
    } catch (e) {
      if (fromCookie) this.clearCookie(res);
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @Public()
  async logout(
    @Body(zod(RefreshSchema)) body: z.output<typeof RefreshSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken ?? this.cookieToken(req));
    this.clearCookie(res);
  }

  @Post('change-password')
  @HttpCode(200)
  @Authenticated({ allowPasswordChangePending: true })
  async changePassword(
    @Auth() auth: AuthContext,
    @Body(zod(ChangePasswordSchema)) body: z.output<typeof ChangePasswordSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.changePassword(auth, body.currentPassword, body.newPassword);
    // Keep whichever transport the client already uses.
    return this.respond(res, result, readCookie(req, REFRESH_COOKIE) !== undefined);
  }

  @Get('me')
  @Authenticated({ allowPasswordChangePending: true })
  me(@Auth() auth: AuthContext): Promise<MeResponse> {
    return this.auth.me(auth.userId);
  }

  private cookieToken(req: Request): string | undefined {
    const token = readCookie(req, REFRESH_COOKIE);
    if (!token) return undefined;
    const origin = req.headers.origin;
    if (origin && !this.config.webOrigins.includes(origin)) throw forbidden();
    return token;
  }

  private respond(res: Response, result: AuthResult, useCookie: boolean): AuthResponse {
    const { tokens, ...body } = result;
    if (!useCookie) return { ...body, refreshToken: tokens.refreshToken };
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'strict',
      path: this.config.cookiePath,
      expires: tokens.refreshExpiresAt,
    });
    return body;
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'strict',
      path: this.config.cookiePath,
    });
  }
}
