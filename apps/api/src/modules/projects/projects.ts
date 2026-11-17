import { Body, Controller, Get, Injectable, Patch } from '@nestjs/common';
import type { Project } from '@kavach/db';
import { type ProjectDto, UpdateProjectSchema } from '@kavach/shared';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { invalid } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { zod } from '../../common/validation/zod.pipe';

type UpdateProject = z.output<typeof UpdateProjectSchema>;

const toDto = (p: Project): ProjectDto => ({
  id: p.id,
  code: p.code,
  name: p.name,
  address: p.address,
  timezone: p.timezone,
  status: p.status,
});

function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The current project (PRD §28 "Project setup"). Projects are created by the operator CLI (Q1). */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async current(ctx: RequestContext): Promise<ProjectDto> {
    // `projects` is the tenant table itself: the id comes from the verified membership.
    return toDto(await this.prisma.db.project.findUniqueOrThrow({ where: { id: ctx.projectId } }));
  }

  async update(ctx: RequestContext, input: UpdateProject): Promise<ProjectDto> {
    if (input.timezone !== undefined && !isTimezone(input.timezone)) {
      throw invalid('Unknown time zone.');
    }
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
      const after = await tx.project.update({
        where: { id: ctx.projectId },
        data: { name: input.name, address: input.address, timezone: input.timezone },
      });
      await this.audit.write(tx, ctx, {
        action: 'project.update',
        entityType: 'project',
        entityId: after.id,
        before: toDto(before),
        after: toDto(after),
      });
      return toDto(after);
    });
  }
}

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('current')
  @RequirePermission('project:view')
  current(@Ctx() ctx: RequestContext): Promise<ProjectDto> {
    return this.projects.current(ctx);
  }

  @Patch('current')
  @RequirePermission('settings:manage')
  update(
    @Ctx() ctx: RequestContext,
    @Body(zod(UpdateProjectSchema)) body: UpdateProject,
  ): Promise<ProjectDto> {
    return this.projects.update(ctx, body);
  }
}
