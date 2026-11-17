import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { APP_CONFIG, type AppConfig } from '../config';
import { unauthenticated } from '../errors/domain-error';
import { type Db, PrismaService } from '../prisma/prisma.service';

const ISSUER = 'kavach-api';

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Short-lived JWT access tokens plus opaque, rotating refresh tokens (ARCHITECTURE §8).
 * Only the SHA-256 of a refresh token is stored. Presenting a token that was already rotated
 * means it was copied, so the whole family is revoked.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private static sha256(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async signAccessToken(userId: string): Promise<string> {
    return new SignJWT({ typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTokenTtlSeconds}s`)
      .sign(this.config.jwtSecret);
  }

  /** Returns the user id, or throws UNAUTHENTICATED. */
  async verifyAccessToken(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, {
        issuer: ISSUER,
        algorithms: ['HS256'],
      });
      if (payload.typ !== 'access' || typeof payload.sub !== 'string') throw new Error('bad token');
      return payload.sub;
    } catch {
      throw unauthenticated('Your session has expired. Please sign in again.');
    }
  }

  /** Starts a new refresh-token family (login) or continues one (rotation). */
  async issue(userId: string, userAgent: string | null, familyId?: string): Promise<IssuedTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.config.refreshTokenTtlDays * 86_400_000);
    await this.prisma.unscoped.refreshToken.create({
      data: {
        userId,
        tokenHash: TokenService.sha256(refreshToken),
        familyId: familyId ?? randomUUID(),
        userAgent: userAgent?.slice(0, 300) ?? null,
        expiresAt: refreshExpiresAt,
      },
    });
    return {
      accessToken: await this.signAccessToken(userId),
      expiresIn: this.config.accessTokenTtlSeconds,
      refreshToken,
      refreshExpiresAt,
    };
  }

  /** Exchanges a refresh token for a new pair. Each token works once. */
  async rotate(
    refreshToken: string,
    userAgent: string | null,
  ): Promise<IssuedTokens & { userId: string }> {
    const db = this.prisma.unscoped;
    const row = await db.refreshToken.findUnique({
      where: { tokenHash: TokenService.sha256(refreshToken) },
    });
    if (!row) throw unauthenticated();

    // Atomic claim: of two concurrent uses, only one sees count = 1.
    const claimed = await db.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(row.familyId); // reuse of a rotated token: assume theft
      throw unauthenticated();
    }
    if (row.expiresAt <= new Date()) throw unauthenticated();

    const tokens = await this.issue(row.userId, userAgent, row.familyId);
    return { ...tokens, userId: row.userId };
  }

  /** Logout: revokes the token's family. Unknown tokens are ignored. */
  async revokeByToken(refreshToken: string): Promise<void> {
    const row = await this.prisma.unscoped.refreshToken.findUnique({
      where: { tokenHash: TokenService.sha256(refreshToken) },
    });
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.unscoped.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Signs the user out everywhere: password change or reset. */
  async revokeAllForUser(db: Db, userId: string): Promise<void> {
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
