import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type AddInvoiceItem,
  AddInvoiceItemSchema,
  type ConfirmInvoiceInput,
  ConfirmInvoiceSchema,
  type CreateInvoiceInput,
  CreateInvoiceSchema,
  type DuplicateOverrideInput,
  DuplicateOverrideSchema,
  type InvoiceDetailDto,
  type InvoiceListQuery,
  InvoiceListQuerySchema,
  type InvoiceSummaryDto,
  type Paginated,
  type PostingDto,
  SubmitInvoiceSchema,
  type UpdateInvoiceHeader,
  UpdateInvoiceHeaderSchema,
  type UpdateInvoiceItem,
  UpdateInvoiceItemSchema,
} from '@kavach/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { IdPipe } from '../../common/validation/id.pipe';
import { IdempotencyKey } from '../../common/validation/idempotency-key.decorator';
import { zod } from '../../common/validation/zod.pipe';
import { InvoicesService } from './invoices.service';

type Submit = z.output<typeof SubmitInvoiceSchema>;

/** The original file name, for display only. A malformed header is ignored. */
function fileName(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  try {
    return decodeURIComponent(header);
  } catch {
    return null;
  }
}

/**
 * Material In from a scanned document (PRD §10.2). Viewing is open to both roles
 * (`material_in:view`); uploading, reviewing and receiving are Store Manager actions
 * (`material_in:create`, DECISIONS Q4). Authorising a duplicate is the Project Admin's (Q6).
 */
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('material_in:view')
  list(
    @Ctx() ctx: RequestContext,
    @Query(zod(InvoiceListQuerySchema)) query: InvoiceListQuery,
  ): Promise<Paginated<InvoiceSummaryDto>> {
    return this.invoices.list(ctx, query);
  }

  @Post()
  @RequirePermission('material_in:create')
  create(
    @Ctx() ctx: RequestContext,
    @Body(zod(CreateInvoiceSchema)) body: CreateInvoiceInput,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.create(ctx, body.storeId);
  }

  @Get(':id')
  @RequirePermission('material_in:view')
  get(@Ctx() ctx: RequestContext, @Param('id', IdPipe) id: string): Promise<InvoiceDetailDto> {
    return this.invoices.get(ctx, id);
  }

  /** Body: the file bytes (JPG, PNG or PDF). `X-File-Name` may carry the original name. */
  @Post(':id/pages')
  @RequirePermission('material_in:create')
  addPage(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Req() req: Request,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.addPage(
      ctx,
      id,
      req.body as unknown,
      fileName(req.headers['x-file-name']),
    );
  }

  @Get(':id/pages/:pageNo/content')
  @RequirePermission('material_in:view')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async pageContent(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Param('pageNo', ParseIntPipe) pageNo: number,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.invoices.pageContent(ctx, id, pageNo);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${file.name}"`);
    res.send(file.data);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('material_in:create')
  submit(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(SubmitInvoiceSchema)) body: Submit,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.submit(ctx, id, body.overrideQuality);
  }

  @Post(':id/reprocess')
  @HttpCode(200)
  @RequirePermission('material_in:create')
  reprocess(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(SubmitInvoiceSchema)) body: Submit,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.reprocess(ctx, id, body.overrideQuality);
  }

  @Post(':id/manual-entry')
  @HttpCode(200)
  @RequirePermission('material_in:create')
  manualEntry(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.manualEntry(ctx, id);
  }

  @Post(':id/discard')
  @HttpCode(200)
  @RequirePermission('material_in:create')
  discard(@Ctx() ctx: RequestContext, @Param('id', IdPipe) id: string): Promise<InvoiceDetailDto> {
    return this.invoices.discard(ctx, id);
  }

  @Patch(':id')
  @RequirePermission('material_in:create')
  updateHeader(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(UpdateInvoiceHeaderSchema)) body: UpdateInvoiceHeader,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.updateHeader(ctx, id, body);
  }

  @Post(':id/items')
  @RequirePermission('material_in:create')
  addItem(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(AddInvoiceItemSchema)) body: AddInvoiceItem,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.addItem(ctx, id, body);
  }

  @Patch(':id/items/:itemId')
  @RequirePermission('material_in:create')
  updateItem(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Param('itemId', IdPipe) itemId: string,
    @Body(zod(UpdateInvoiceItemSchema)) body: UpdateInvoiceItem,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.updateItem(ctx, id, itemId, body);
  }

  /** PRD §13.3 "authorised resolution": Project Admin only (DECISIONS Q6). */
  @Post(':id/duplicate-override')
  @HttpCode(200)
  @RequirePermission('invoice:duplicate_override')
  overrideDuplicate(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(DuplicateOverrideSchema)) body: DuplicateOverrideInput,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.overrideDuplicate(ctx, id, body.note);
  }

  /** CONFIRM & RECEIVE (PRD §10.2 screen 5). Idempotent: a retry returns the same receipt. */
  @Post(':id/confirm')
  @RequirePermission('material_in:create')
  confirm(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(ConfirmInvoiceSchema)) body: ConfirmInvoiceInput,
    @IdempotencyKey() key: string,
  ): Promise<PostingDto> {
    return this.invoices.confirm(ctx, id, body.version, key);
  }
}
