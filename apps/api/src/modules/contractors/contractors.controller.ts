import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  type ContractorDto,
  type CreateContractorInput,
  CreateContractorSchema,
  type MergeContractorInput,
  MergeContractorSchema,
  type UpdateContractorInput,
  UpdateContractorSchema,
} from '@kavach/shared';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { IdPipe } from '../../common/validation/id.pipe';
import { zod } from '../../common/validation/zod.pipe';
import { ContractorsService } from './contractors.service';

@Controller('contractors')
export class ContractorsController {
  constructor(private readonly contractors: ContractorsService) {}

  @Get()
  @RequirePermission('contractor:view')
  list(@Ctx() ctx: RequestContext): Promise<ContractorDto[]> {
    return this.contractors.list(ctx);
  }

  @Post()
  @RequirePermission('contractor:create')
  create(
    @Ctx() ctx: RequestContext,
    @Body(zod(CreateContractorSchema)) body: CreateContractorInput,
  ): Promise<ContractorDto> {
    return this.contractors.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('contractor:manage')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(UpdateContractorSchema)) body: UpdateContractorInput,
  ): Promise<ContractorDto> {
    return this.contractors.update(ctx, id, body);
  }

  @Post(':id/merge')
  @HttpCode(200)
  @RequirePermission('contractor:manage')
  merge(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(MergeContractorSchema)) body: MergeContractorInput,
  ): Promise<ContractorDto> {
    return this.contractors.merge(ctx, id, body);
  }
}
