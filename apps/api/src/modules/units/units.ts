import { Body, Controller, Get, Injectable, Param, Patch, Post } from '@nestjs/common';
import { Prisma, type Unit, type UnitConversion } from '@kavach/db';
import {
  type ConversionDto,
  CreateConversionSchema,
  CreateUnitSchema,
  type UnitDto,
  UpdateConversionSchema,
  UpdateUnitSchema,
} from '@kavach/shared';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { conflict, forbidden, invalid, notFound } from '../../common/errors/domain-error';
import { type Db, PrismaService } from '../../common/prisma/prisma.service';
import { IdPipe } from '../../common/validation/id.pipe';
import { zod } from '../../common/validation/zod.pipe';

type CreateUnit = z.output<typeof CreateUnitSchema>;
type UpdateUnit = z.output<typeof UpdateUnitSchema>;
type CreateConversion = z.output<typeof CreateConversionSchema>;

export const unitToDto = (u: Unit): UnitDto => ({
  id: u.id,
  code: u.code,
  name: u.name,
  symbol: u.symbol,
  dimension: u.dimension,
  decimalPlaces: u.decimalPlaces,
  aliases: u.aliases,
  isActive: u.isActive,
  isSystem: u.projectId === null,
});

const conversionToDto = (c: UnitConversion): ConversionDto => ({
  id: c.id,
  fromUnitId: c.fromUnitId,
  toUnitId: c.toUnitId,
  factor: c.factor.toString(),
  materialId: c.materialId,
  isActive: c.isActive,
  isSystem: c.projectId === null,
});

/** System rows (project_id NULL) plus this project's own rows. Never another project's. */
export const visibleTo = (projectId: string) => ({ OR: [{ projectId: null }, { projectId }] });

/** Loads a unit this project may use: a system unit or one of its own. */
export async function findVisibleUnit(db: Db, projectId: string, id: string): Promise<Unit | null> {
  return db.unit.findFirst({ where: { id, ...visibleTo(projectId) } });
}

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Unit master and approved conversions (PRD §12.2, §12.4). System units are seeded and read-only;
 * a Project Admin adds project units and approves conversions. Nothing else converts.
 */
@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listUnits(ctx: RequestContext): Promise<UnitDto[]> {
    const rows = await this.prisma.db.unit.findMany({
      where: visibleTo(ctx.projectId),
      orderBy: { code: 'asc' },
    });
    return rows.map(unitToDto);
  }

  async createUnit(ctx: RequestContext, input: CreateUnit): Promise<UnitDto> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const clash = await tx.unit.findFirst({ where: { projectId: null, code: input.code } });
        if (clash) throw conflict(`${input.code} is already a system unit.`);
        const unit = await tx.unit.create({ data: { projectId: ctx.projectId, ...input } });
        await this.audit.write(tx, ctx, {
          action: 'unit.create',
          entityType: 'unit',
          entityId: unit.id,
          after: unitToDto(unit),
        });
        return unitToDto(unit);
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw conflict(`A unit with the code ${input.code} already exists.`);
      throw e;
    }
  }

  async updateUnit(ctx: RequestContext, id: string, input: UpdateUnit): Promise<UnitDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await findVisibleUnit(tx, ctx.projectId, id);
      if (!before) throw notFound('Unit');
      if (before.projectId === null) throw forbidden('System units cannot be changed.');
      if (input.isActive === false) {
        const used = await tx.material.count({
          where: {
            projectId: ctx.projectId,
            status: 'ACTIVE',
            OR: [{ stockUnitId: id }, { packUnitId: id }],
          },
        });
        if (used > 0) throw conflict(`This unit is used by ${used} active material(s).`);
      }
      await tx.unit.updateMany({ where: { id, projectId: ctx.projectId }, data: input });
      const after = await tx.unit.findFirstOrThrow({ where: { id, projectId: ctx.projectId } });
      await this.audit.write(tx, ctx, {
        action: 'unit.update',
        entityType: 'unit',
        entityId: id,
        before: unitToDto(before),
        after: unitToDto(after),
      });
      return unitToDto(after);
    });
  }

  async listConversions(ctx: RequestContext): Promise<ConversionDto[]> {
    const rows = await this.prisma.db.unitConversion.findMany({
      where: visibleTo(ctx.projectId),
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(conversionToDto);
  }

  async createConversion(ctx: RequestContext, input: CreateConversion): Promise<ConversionDto> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const [from, to] = await Promise.all([
          findVisibleUnit(tx, ctx.projectId, input.fromUnitId),
          findVisibleUnit(tx, ctx.projectId, input.toUnitId),
        ]);
        if (!from || !to) throw notFound('Unit');
        if (!from.isActive || !to.isActive) throw invalid('Both units must be active.');
        if (input.materialId) {
          const material = await tx.material.findFirst({
            where: { projectId: ctx.projectId, id: input.materialId },
          });
          if (!material) throw notFound('Material');
        }
        // One approved factor per pair, in either direction, at each level (general or material).
        const existing = await tx.unitConversion.findFirst({
          where: {
            AND: [
              visibleTo(ctx.projectId),
              { materialId: input.materialId },
              {
                OR: [
                  { fromUnitId: from.id, toUnitId: to.id },
                  { fromUnitId: to.id, toUnitId: from.id },
                ],
              },
            ],
          },
        });
        if (existing) {
          throw conflict(`A conversion between ${from.code} and ${to.code} already exists.`);
        }
        const conversion = await tx.unitConversion.create({
          data: {
            projectId: ctx.projectId,
            fromUnitId: from.id,
            toUnitId: to.id,
            factor: input.factor,
            materialId: input.materialId,
          },
        });
        await this.audit.write(tx, ctx, {
          action: 'unit_conversion.create',
          entityType: 'unit_conversion',
          entityId: conversion.id,
          after: { ...conversionToDto(conversion), from: from.code, to: to.code },
        });
        return conversionToDto(conversion);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('This conversion already exists.');
      throw e;
    }
  }

  async setConversionActive(
    ctx: RequestContext,
    id: string,
    isActive: boolean,
  ): Promise<ConversionDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.unitConversion.findFirst({
        where: { id, ...visibleTo(ctx.projectId) },
      });
      if (!before) throw notFound('Conversion');
      if (before.projectId === null) throw forbidden('System conversions cannot be changed.');
      await tx.unitConversion.updateMany({
        where: { id, projectId: ctx.projectId },
        data: { isActive },
      });
      const after = { ...before, isActive };
      await this.audit.write(tx, ctx, {
        action: 'unit_conversion.update',
        entityType: 'unit_conversion',
        entityId: id,
        before: conversionToDto(before),
        after: conversionToDto(after),
      });
      return conversionToDto(after);
    });
  }
}

@Controller()
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get('units')
  @RequirePermission('unit:view')
  list(@Ctx() ctx: RequestContext): Promise<UnitDto[]> {
    return this.units.listUnits(ctx);
  }

  @Post('units')
  @RequirePermission('unit:manage')
  create(
    @Ctx() ctx: RequestContext,
    @Body(zod(CreateUnitSchema)) body: CreateUnit,
  ): Promise<UnitDto> {
    return this.units.createUnit(ctx, body);
  }

  @Patch('units/:id')
  @RequirePermission('unit:manage')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(UpdateUnitSchema)) body: UpdateUnit,
  ): Promise<UnitDto> {
    return this.units.updateUnit(ctx, id, body);
  }

  @Get('unit-conversions')
  @RequirePermission('unit:view')
  listConversions(@Ctx() ctx: RequestContext): Promise<ConversionDto[]> {
    return this.units.listConversions(ctx);
  }

  @Post('unit-conversions')
  @RequirePermission('unit:manage')
  createConversion(
    @Ctx() ctx: RequestContext,
    @Body(zod(CreateConversionSchema)) body: CreateConversion,
  ): Promise<ConversionDto> {
    return this.units.createConversion(ctx, body);
  }

  @Patch('unit-conversions/:id')
  @RequirePermission('unit:manage')
  updateConversion(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(UpdateConversionSchema)) body: z.output<typeof UpdateConversionSchema>,
  ): Promise<ConversionDto> {
    return this.units.setConversionActive(ctx, id, body.isActive);
  }
}
