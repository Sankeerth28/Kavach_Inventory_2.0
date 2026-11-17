import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  type Paginated,
  type ReconciliationDto,
  type StockDetailDto,
  type StockListQuery,
  StockListQuerySchema,
  type StockRowDto,
} from '@kavach/shared';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { IdPipe } from '../../common/validation/id.pipe';
import { zod } from '../../common/validation/zod.pipe';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @RequirePermission('stock:view')
  list(
    @Ctx() ctx: RequestContext,
    @Query(zod(StockListQuerySchema)) query: StockListQuery,
  ): Promise<Paginated<StockRowDto>> {
    return this.stock.list(ctx, query);
  }

  @Get('reconciliation')
  @RequirePermission('stock:reconcile')
  reconcile(@Ctx() ctx: RequestContext): Promise<ReconciliationDto> {
    return this.stock.reconcile(ctx);
  }

  @Get(':materialId')
  @RequirePermission('stock:view')
  getDetail(
    @Ctx() ctx: RequestContext,
    @Param('materialId', IdPipe) materialId: string,
  ): Promise<StockDetailDto> {
    return this.stock.getDetail(ctx, materialId);
  }
}
