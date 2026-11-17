import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type Paginated,
  type RejectVerificationInput,
  RejectVerificationSchema,
  type ReviewVerificationInput,
  ReviewVerificationSchema,
  type SubmitVerificationInput,
  SubmitVerificationSchema,
  type VerificationDto,
  type VerificationListQuery,
  VerificationListQuerySchema,
} from '@kavach/shared';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { IdPipe } from '../../common/validation/id.pipe';
import { zod } from '../../common/validation/zod.pipe';
import { VerificationService } from './verification.service';

@Controller('stock-verifications')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  @RequirePermission('stock:view')
  list(
    @Ctx() ctx: RequestContext,
    @Query(zod(VerificationListQuerySchema)) query: VerificationListQuery,
  ): Promise<Paginated<VerificationDto>> {
    return this.verification.list(ctx, query);
  }

  @Post()
  @RequirePermission('stock_verification:submit')
  submit(
    @Ctx() ctx: RequestContext,
    @Body(zod(SubmitVerificationSchema)) body: SubmitVerificationInput,
  ): Promise<VerificationDto> {
    return this.verification.submit(ctx, body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('stock_verification:review')
  approve(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(ReviewVerificationSchema)) body: ReviewVerificationInput,
  ): Promise<VerificationDto> {
    return this.verification.approve(ctx, id, body);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('stock_verification:review')
  reject(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(RejectVerificationSchema)) body: RejectVerificationInput,
  ): Promise<VerificationDto> {
    return this.verification.reject(ctx, id, body);
  }
}
