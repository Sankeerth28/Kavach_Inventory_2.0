import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { type HealthResponse, healthResponse } from '@kavach/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process answers. */
  check(): HealthResponse {
    return healthResponse('api');
  }

  /** Readiness: the database answers too. A load balancer should send traffic only then. */
  async ready(): Promise<HealthResponse> {
    try {
      await this.prisma.db.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('The database is not reachable.');
    }
    return healthResponse('api');
  }
}
