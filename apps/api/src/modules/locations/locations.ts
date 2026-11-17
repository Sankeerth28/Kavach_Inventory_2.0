import { Body, Controller, Get, Injectable, Param, Patch, Post } from '@nestjs/common';
import { type Location, Prisma } from '@kavach/db';
import {
  CreateLocationSchema,
  type LocationDto,
  UpdateLocationSchema,
  normalise,
} from '@kavach/shared';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { conflict, invalid, notFound } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdPipe } from '../../common/validation/id.pipe';
import { zod } from '../../common/validation/zod.pipe';

type CreateLocation = z.output<typeof CreateLocationSchema>;
type UpdateLocation = z.output<typeof UpdateLocationSchema>;

const SEP = ' / ';

const toDto = (l: Location): LocationDto => ({
  id: l.id,
  parentId: l.parentId,
  name: l.name,
  type: l.type,
  path: l.path,
  isActive: l.isActive,
});

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Issue destinations and return sources: Tower → Floor → Work area (PRD §14.3).
 * Locations never hold stock (DECISIONS Q3).
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext): Promise<LocationDto[]> {
    const rows = await this.prisma.db.location.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { path: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(ctx: RequestContext, input: CreateLocation): Promise<LocationDto> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        let path = input.name;
        if (input.parentId) {
          const parent = await tx.location.findFirst({
            where: { projectId: ctx.projectId, id: input.parentId },
          });
          if (!parent) throw notFound('Parent location');
          if (!parent.isActive) throw invalid('The parent location is inactive.');
          path = parent.path + SEP + input.name;
        }
        const location = await tx.location.create({
          data: {
            projectId: ctx.projectId,
            parentId: input.parentId,
            name: input.name,
            normalizedName: normalise(input.name),
            type: input.type,
            path,
          },
        });
        await this.audit.write(tx, ctx, {
          action: 'location.create',
          entityType: 'location',
          entityId: location.id,
          after: toDto(location),
        });
        return toDto(location);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('A location with this name already exists here.');
      throw e;
    }
  }

  async update(ctx: RequestContext, id: string, input: UpdateLocation): Promise<LocationDto> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const all = await tx.location.findMany({ where: { projectId: ctx.projectId } });
        const before = all.find((l) => l.id === id);
        if (!before) throw notFound('Location');

        const descendants: Location[] = [];
        const collect = (parentId: string) => {
          for (const l of all) {
            if (l.parentId === parentId) {
              descendants.push(l);
              collect(l.id);
            }
          }
        };
        collect(id);

        if (input.isActive === true && !before.isActive && before.parentId) {
          const parent = all.find((l) => l.id === before.parentId);
          if (parent && !parent.isActive) throw invalid('Activate the parent location first.');
        }

        const name = input.name ?? before.name;
        const parentPath = before.parentId
          ? before.path.slice(0, -(before.name.length + SEP.length))
          : '';
        const path = parentPath ? parentPath + SEP + name : name;

        const after = await tx.location.update({
          where: { projectId_id: { projectId: ctx.projectId, id } },
          data: {
            name,
            normalizedName: normalise(name),
            type: input.type,
            isActive: input.isActive,
            path,
          },
        });

        // A rename changes the path of everything below; deactivating closes everything below.
        for (const d of descendants) {
          const newPath = path + d.path.slice(before.path.length);
          const deactivate = input.isActive === false && d.isActive;
          if (newPath !== d.path || deactivate) {
            await tx.location.update({
              where: { projectId_id: { projectId: ctx.projectId, id: d.id } },
              data: { path: newPath, ...(deactivate ? { isActive: false } : {}) },
            });
          }
        }

        await this.audit.write(tx, ctx, {
          action: 'location.update',
          entityType: 'location',
          entityId: id,
          before: toDto(before),
          after: toDto(after),
          metadata: { descendantsAffected: descendants.length },
        });
        return toDto(after);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('A location with this name already exists here.');
      throw e;
    }
  }
}

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermission('location:view')
  list(@Ctx() ctx: RequestContext): Promise<LocationDto[]> {
    return this.locations.list(ctx);
  }

  @Post()
  @RequirePermission('location:manage')
  create(
    @Ctx() ctx: RequestContext,
    @Body(zod(CreateLocationSchema)) body: CreateLocation,
  ): Promise<LocationDto> {
    return this.locations.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('location:manage')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(UpdateLocationSchema)) body: UpdateLocation,
  ): Promise<LocationDto> {
    return this.locations.update(ctx, id, body);
  }
}
