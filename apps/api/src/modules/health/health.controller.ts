import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/auth/access.decorators';
import type { HealthResponse } from '@kavach/shared';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Public()
  check(): HealthResponse {
    return this.health.check();
  }

  @Get('ready')
  @Public()
  ready(): Promise<HealthResponse> {
    return this.health.ready();
  }
}
