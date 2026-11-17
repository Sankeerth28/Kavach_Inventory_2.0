import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CheckDuplicatesSchema,
  CreateMaterialSchema,
  type DuplicateCheckResult,
  type MaterialDto,
  MaterialListQuerySchema,
  type Paginated,
  UpdateMaterialSchema,
} from '@kavach/shared';
import type { z } from 'zod';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { IdPipe } from '../../common/validation/id.pipe';
import { zod } from '../../common/validation/zod.pipe';
import { MaterialsService } from './materials.service';

@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get()
  @RequirePermission('material:view')
  list(
    @Ctx() ctx: RequestContext,
    @Query(zod(MaterialListQuerySchema)) query: z.output<typeof MaterialListQuerySchema>,
  ): Promise<Paginated<MaterialDto>> {
    return this.materials.list(ctx, query);
  }

  /** PRD §6.5. Read-only, so anyone who can view materials may ask. */
  @Post('check-duplicates')
  @HttpCode(200)
  @RequirePermission('material:view')
  checkDuplicates(
    @Ctx() ctx: RequestContext,
    @Body(zod(CheckDuplicatesSchema)) body: z.output<typeof CheckDuplicatesSchema>,
  ): Promise<DuplicateCheckResult> {
    return this.materials.checkDuplicates(ctx, body);
  }

  @Get(':id')
  @RequirePermission('material:view')
  get(@Ctx() ctx: RequestContext, @Param('id', IdPipe) id: string): Promise<MaterialDto> {
    return this.materials.get(ctx, id);
  }

  /** Manual creation, PRD §6.4 method A: Project Admin only. */
  @Post()
  @RequirePermission('material:create')
  create(
    @Ctx() ctx: RequestContext,
    @Body(zod(CreateMaterialSchema)) body: z.output<typeof CreateMaterialSchema>,
  ): Promise<MaterialDto> {
    return this.materials.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('material:update')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(UpdateMaterialSchema)) body: z.output<typeof UpdateMaterialSchema>,
  ): Promise<MaterialDto> {
    return this.materials.update(ctx, id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('material:deactivate')
  deactivate(@Ctx() ctx: RequestContext, @Param('id', IdPipe) id: string): Promise<MaterialDto> {
    return this.materials.setStatus(ctx, id, 'INACTIVE');
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermission('material:deactivate')
  activate(@Ctx() ctx: RequestContext, @Param('id', IdPipe) id: string): Promise<MaterialDto> {
    return this.materials.setStatus(ctx, id, 'ACTIVE');
  }
}
