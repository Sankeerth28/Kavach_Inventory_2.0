import { Injectable } from '@nestjs/common';
import type { Contractor } from '@kavach/db';
import type {
  ContractorDto,
  CreateContractorInput,
  MergeContractorInput,
  SimilarContractorsDetails,
  UpdateContractorInput,
} from '@kavach/shared';
import { normalise } from '@kavach/shared';
import { AuditService } from '../../common/audit/audit.service';
import { type RequestContext } from '../../common/context/request-context';
import { conflict, invalid, notFound } from '../../common/errors/domain-error';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';

function cleanTokens(s: string): string {
  return normalise(s)
    .replace(/\bAND\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function areSimilar(name1: string, name2: string): boolean {
  const c1 = cleanTokens(name1);
  const c2 = cleanTokens(name2);
  if (c1 === c2) return true;

  const t1 = new Set(c1.split(' ').filter(Boolean));
  const t2 = new Set(c2.split(' ').filter(Boolean));
  let intersection = 0;
  for (const token of t1) {
    if (t2.has(token)) intersection++;
  }
  const score = (2 * intersection) / (t1.size + t2.size);
  return score >= 0.6;
}

@Injectable()
export class ContractorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toDto(c: Contractor): ContractorDto {
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      isActive: c.isActive,
      mergedIntoId: c.mergedIntoId,
    };
  }

  async list(ctx: RequestContext): Promise<ContractorDto[]> {
    const rows = await this.prisma.db.contractor.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(ctx: RequestContext, input: CreateContractorInput): Promise<ContractorDto> {
    const normalizedName = normalise(input.name);

    // Exact check
    const exact = await this.prisma.db.contractor.findFirst({
      where: { projectId: ctx.projectId, normalizedName },
    });
    if (exact) {
      throw conflict(`A contractor named ${input.name} already exists.`);
    }

    // Similar names check
    const existing = await this.prisma.db.contractor.findMany({
      where: { projectId: ctx.projectId, isActive: true },
    });

    const similar = existing.filter((c) => areSimilar(c.name, input.name));

    if (similar.length > 0 && !input.confirmNotDuplicate) {
      const details: SimilarContractorsDetails = {
        similar: similar.map((c) => this.toDto(c)),
      };
      throw new DomainError(
        'POSSIBLE_DUPLICATE',
        'A similar contractor already exists.',
        409,
        details,
      );
    }

    return this.prisma.db.$transaction(async (tx) => {
      const c = await tx.contractor.create({
        data: {
          projectId: ctx.projectId,
          name: input.name.trim(),
          normalizedName,
          phone: input.phone ? String(input.phone) : null,
          createdById: ctx.userId,
        },
      });

      await this.audit.write(tx, ctx, {
        action: 'contractor.create',
        entityType: 'contractor',
        entityId: c.id,
        after: this.toDto(c),
      });

      return this.toDto(c);
    });
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateContractorInput,
  ): Promise<ContractorDto> {
    const c = await this.prisma.db.contractor.findFirst({
      where: { id, projectId: ctx.projectId },
    });
    if (!c) throw notFound('Contractor');

    return this.prisma.db.$transaction(async (tx) => {
      await tx.contractor.updateMany({
        where: { id, projectId: ctx.projectId },
        data: {
          name: input.name ? input.name.trim() : undefined,
          normalizedName: input.name ? normalise(input.name) : undefined,
          phone: input.phone !== undefined ? input.phone : undefined,
          isActive: input.isActive !== undefined ? input.isActive : undefined,
        },
      });

      const updated = await tx.contractor.findFirstOrThrow({
        where: { id, projectId: ctx.projectId },
      });

      await this.audit.write(tx, ctx, {
        action: 'contractor.update',
        entityType: 'contractor',
        entityId: id,
        before: this.toDto(c),
        after: this.toDto(updated),
      });

      return this.toDto(updated);
    });
  }

  async merge(
    ctx: RequestContext,
    id: string,
    input: MergeContractorInput,
  ): Promise<ContractorDto> {
    if (id === input.intoId) {
      throw invalid('Cannot merge a contractor into itself.');
    }

    const c = await this.prisma.db.contractor.findFirst({
      where: { id, projectId: ctx.projectId },
    });
    if (!c) throw notFound('Contractor to merge');

    const into = await this.prisma.db.contractor.findFirst({
      where: { id: input.intoId, projectId: ctx.projectId },
    });
    if (!into) throw notFound('Surviving contractor');

    return this.prisma.db.$transaction(async (tx) => {
      await tx.contractor.updateMany({
        where: { id, projectId: ctx.projectId },
        data: {
          mergedIntoId: input.intoId,
          isActive: false,
        },
      });

      const updated = await tx.contractor.findFirstOrThrow({
        where: { id, projectId: ctx.projectId },
      });

      await this.audit.write(tx, ctx, {
        action: 'contractor.merge',
        entityType: 'contractor',
        entityId: id,
        after: { mergedIntoId: input.intoId },
      });

      return this.toDto(updated);
    });
  }
}
