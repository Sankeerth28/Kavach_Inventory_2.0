import { Controller, Get, Query } from '@nestjs/common';
import {
  type Paginated,
  type TransactionDto,
  type TransactionListQuery,
  TransactionListQuerySchema,
} from '@kavach/shared';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { zod } from '../../common/validation/zod.pipe';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @RequirePermission('transaction:view')
  list(
    @Ctx() ctx: RequestContext,
    @Query(zod(TransactionListQuerySchema)) query: TransactionListQuery,
  ): Promise<Paginated<TransactionDto>> {
    return this.transactions.list(ctx, query);
  }
}
