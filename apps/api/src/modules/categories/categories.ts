import { Body, Controller, Get, Injectable, Param, Patch, Post } from '@nestjs/common';
import { type MaterialCategory, Prisma } from '@kavach/db';
import {
  type CategoryDto,
  CreateCategorySchema,
  UpdateCategorySchema,
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

type CreateCategory = z.output<typeof CreateCategorySchema>;
type UpdateCategory = z.output<typeof UpdateCategorySchema>;

const toDto = (c: MaterialCategory): CategoryDto => ({
  id: c.id,
  parentId: c.parentId,
  name: c.name,
  isActive: c.isActive,
  sortOrder: c.sortOrder,
});

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Material categories and subcategories (PRD §6.2, §6.3). Two levels. */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext): Promise<CategoryDto[]> {
    const rows = await this.prisma.db.materialCategory.findMany({
      where: { projectId: ctx.projectId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(ctx: RequestContext, input: CreateCategory): Promise<CategoryDto> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        if (input.parentId) {
          const parent = await tx.materialCategory.findFirst({
            where: { projectId: ctx.projectId, id: input.parentId },
          });
          if (!parent) throw notFound('Parent category');
          if (parent.parentId) throw invalid('A subcategory cannot have its own subcategories.');
        }
        const category = await tx.materialCategory.create({
          data: {
            projectId: ctx.projectId,
            parentId: input.parentId,
            name: input.name,
            normalizedName: normalise(input.name),
            sortOrder: input.sortOrder ?? 0,
          },
        });
        await this.audit.write(tx, ctx, {
          action: 'category.create',
          entityType: 'category',
          entityId: category.id,
          after: toDto(category),
        });
        return toDto(category);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('A category with this name already exists.');
      throw e;
    }
  }

  async update(ctx: RequestContext, id: string, input: UpdateCategory): Promise<CategoryDto> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const before = await tx.materialCategory.findFirst({
          where: { projectId: ctx.projectId, id },
        });
        if (!before) throw notFound('Category');
        const after = await tx.materialCategory.update({
          where: { projectId_id: { projectId: ctx.projectId, id } },
          data: {
            name: input.name,
            normalizedName: input.name === undefined ? undefined : normalise(input.name),
            sortOrder: input.sortOrder,
            isActive: input.isActive,
          },
        });
        await this.audit.write(tx, ctx, {
          action: 'category.update',
          entityType: 'category',
          entityId: id,
          before: toDto(before),
          after: toDto(after),
        });
        return toDto(after);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('A category with this name already exists.');
      throw e;
    }
  }
}

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission('category:view')
  list(@Ctx() ctx: RequestContext): Promise<CategoryDto[]> {
    return this.categories.list(ctx);
  }

  @Post()
  @RequirePermission('category:manage')
  create(
    @Ctx() ctx: RequestContext,
    @Body(zod(CreateCategorySchema)) body: CreateCategory,
  ): Promise<CategoryDto> {
    return this.categories.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('category:manage')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(UpdateCategorySchema)) body: UpdateCategory,
  ): Promise<CategoryDto> {
    return this.categories.update(ctx, id, body);
  }
}
