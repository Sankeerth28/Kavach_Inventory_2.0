import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditService } from './audit/audit.service';
import { AccessGuard } from './auth/access.guard';
import { PasswordService } from './auth/password.service';
import { TokenService } from './auth/token.service';
import { APP_CONFIG, loadConfig } from './config';
import { AllExceptionsFilter } from './errors/all-exceptions.filter';
import { RateLimiter } from './rate-limit/rate-limiter';

/** Cross-cutting providers: config, tokens, passwords, audit, the global guard and error filter. */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    TokenService,
    PasswordService,
    AuditService,
    RateLimiter,
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [APP_CONFIG, TokenService, PasswordService, AuditService, RateLimiter],
})
export class CommonModule {}
