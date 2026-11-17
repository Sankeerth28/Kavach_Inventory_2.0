import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  type AdjustmentInput,
  AdjustmentSchema,
  type IssueInput,
  IssueSchema,
  type PostingDto,
  type QuickReceiveInput,
  QuickReceiveSchema,
  type ReceiptInput,
  ReceiptSchema,
  type ReturnInput,
  ReturnSchema,
  type ReverseInput,
  ReverseSchema,
} from '@kavach/shared';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { IdPipe } from '../../common/validation/id.pipe';
import { IdempotencyKey } from '../../common/validation/idempotency-key.decorator';
import { zod } from '../../common/validation/zod.pipe';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post('receipts')
  @RequirePermission('material_in:create')
  receipt(
    @Ctx() ctx: RequestContext,
    @Body(zod(ReceiptSchema)) body: ReceiptInput,
    @IdempotencyKey() key: string,
  ): Promise<PostingDto> {
    return this.inventory.postReceipt(ctx, body, key);
  }

  @Post('quick-receive')
  @RequirePermission('material_in:create')
  quickReceive(
    @Ctx() ctx: RequestContext,
    @Body(zod(QuickReceiveSchema)) body: QuickReceiveInput,
    @IdempotencyKey() key: string,
  ): Promise<PostingDto> {
    return this.inventory.postQuickReceive(ctx, body, key);
  }

  @Post('issues')
  @RequirePermission('material_out:create')
  issue(
    @Ctx() ctx: RequestContext,
    @Body(zod(IssueSchema)) body: IssueInput,
    @IdempotencyKey() key: string,
  ): Promise<PostingDto> {
    return this.inventory.postIssue(ctx, body, key);
  }

  @Post('returns')
  @RequirePermission('material_return:create')
  return(
    @Ctx() ctx: RequestContext,
    @Body(zod(ReturnSchema)) body: ReturnInput,
    @IdempotencyKey() key: string,
  ): Promise<PostingDto> {
    return this.inventory.postReturn(ctx, body, key);
  }

  @Post('adjustments')
  @RequirePermission('stock_adjustment:create')
  adjustment(
    @Ctx() ctx: RequestContext,
    @Body(zod(AdjustmentSchema)) body: AdjustmentInput,
    @IdempotencyKey() key: string,
  ): Promise<PostingDto> {
    return this.inventory.postAdjustment(ctx, body, key);
  }

  @Post('postings/:id/reverse')
  @RequirePermission('transaction:reverse')
  reverse(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(ReverseSchema)) body: ReverseInput,
    @IdempotencyKey() key: string,
  ): Promise<PostingDto> {
    return this.inventory.reversePosting(ctx, id, body, key);
  }

  @Get('postings/:id')
  @RequirePermission('transaction:view')
  getPosting(@Ctx() ctx: RequestContext, @Param('id', IdPipe) id: string): Promise<PostingDto> {
    return this.inventory.getPosting(ctx, id);
  }
}
