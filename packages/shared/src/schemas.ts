import { z } from 'zod';
import { normaliseEmail, normalisePhone } from './normalise';
import { ROLE_CODES } from './permissions';
import { UNIT_DIMENSIONS } from './units';

/**
 * Request contracts for the Phase 1 API. The API validates with these; web and mobile build
 * their forms from the same schemas (ARCHITECTURE §8).
 */

// ── Building blocks ──────────────────────────────────────────────────────────

export const IdSchema = z.uuid();

const requiredText = (max: number) => z.string().trim().min(1, 'Required').max(max);

/** Optional text. On update: absent = leave unchanged, null or '' = clear. */
const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

/** Quantities travel as decimal strings: up to 15 digits and 3 decimals. Never JS floats. */
export const QuantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,3})?$/, 'Enter a number with up to 3 decimals');

const optionalQuantity = z
  .union([QuantitySchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Up to 500 so a picker can load a whole master list in one request.
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
});

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const PasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export const EmailSchema = z.string().trim().max(254).pipe(z.email()).transform(normaliseEmail);

export const PhoneSchema = z
  .string()
  .trim()
  .transform(normalisePhone)
  .refine((v) => /^\d{10}$/.test(v), 'Enter a 10-digit mobile number');

export const LoginSchema = z.object({
  /** E-mail or mobile number (DECISIONS Q36). */
  identifier: requiredText(254),
  password: z.string().min(1).max(128),
  /** web keeps the refresh token in an httpOnly cookie; mobile receives it in the body. */
  client: z.enum(['web', 'mobile']).default('web'),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: PasswordSchema,
});

// ── Project, stores, locations ───────────────────────────────────────────────

export const UpdateProjectSchema = z.object({
  name: requiredText(120).optional(),
  address: optionalText(500),
  timezone: requiredText(64).optional(),
});

const StoreCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Use 2–20 letters, digits or hyphens');

export const CreateStoreSchema = z.object({
  code: StoreCodeSchema,
  name: requiredText(120),
  address: optionalText(500),
});

export const UpdateStoreSchema = z.object({
  name: requiredText(120).optional(),
  address: optionalText(500),
  isActive: z.boolean().optional(),
});

export const LOCATION_TYPES = ['TOWER', 'BLOCK', 'FLOOR', 'WORK_AREA', 'OTHER'] as const;

export const CreateLocationSchema = z.object({
  name: requiredText(120),
  type: z.enum(LOCATION_TYPES),
  parentId: IdSchema.nullish().transform((v) => v ?? null),
});

export const UpdateLocationSchema = z.object({
  name: requiredText(120).optional(),
  type: z.enum(LOCATION_TYPES).optional(),
  isActive: z.boolean().optional(),
});

// ── Categories and units ─────────────────────────────────────────────────────

export const CreateCategorySchema = z.object({
  name: requiredText(80),
  /** Set to create a subcategory (PRD §6.2). */
  parentId: IdSchema.nullish().transform((v) => v ?? null),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const UpdateCategorySchema = z.object({
  name: requiredText(80).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export const CreateUnitSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{0,11}$/, 'Use up to 12 letters or digits, starting with a letter'),
  name: requiredText(60),
  symbol: requiredText(12),
  dimension: z.enum(UNIT_DIMENSIONS),
  /** 0 for count units such as Nos and Bags (DECISIONS Q12). */
  decimalPlaces: z.number().int().min(0).max(3),
  aliases: z.array(requiredText(30)).max(20).default([]),
});

export const UpdateUnitSchema = z.object({
  name: requiredText(60).optional(),
  symbol: requiredText(12).optional(),
  aliases: z.array(requiredText(30)).max(20).optional(),
  isActive: z.boolean().optional(),
});

export const ConversionFactorSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, 'Enter a positive number with up to 6 decimals')
  .refine((v) => Number(v) > 0, 'Must be greater than zero');

export const CreateConversionSchema = z
  .object({
    fromUnitId: IdSchema,
    toUnitId: IdSchema,
    factor: ConversionFactorSchema,
    /** Set to approve the conversion for one material only. */
    materialId: IdSchema.nullish().transform((v) => v ?? null),
  })
  .refine((v) => v.fromUnitId !== v.toUnitId, {
    message: 'Choose two different units',
    path: ['toUnitId'],
  });

export const UpdateConversionSchema = z.object({ isActive: z.boolean() });

// ── Material Master ──────────────────────────────────────────────────────────

const materialFields = {
  name: requiredText(160),
  categoryId: IdSchema,
  subcategoryId: IdSchema.nullish(),
  brand: optionalText(80),
  specification: optionalText(500),
  grade: optionalText(40),
  size: optionalText(60),
  stockUnitId: IdSchema,
  packSize: optionalQuantity,
  packUnitId: IdSchema.nullish(),
  isVariableWeight: z.boolean().optional(),
  minimumStock: optionalQuantity,
  description: optionalText(1000),
};

export const MaterialInputSchema = z.object(materialFields);

export const CreateMaterialSchema = z.object({
  ...materialFields,
  /** Must be true to create a material that looks like an existing one (PRD §6.5). */
  confirmNotDuplicate: z.boolean().default(false),
});

export const UpdateMaterialSchema = z.object({
  ...materialFields,
  name: materialFields.name.optional(),
  categoryId: IdSchema.optional(),
  stockUnitId: IdSchema.optional(),
  confirmNotDuplicate: z.boolean().default(false),
  /** Optimistic concurrency: the version the user was looking at. */
  version: z.number().int().min(0),
});

export const CheckDuplicatesSchema = z.object({
  ...materialFields,
  /** When editing: the material being edited, so it does not match itself. */
  excludeId: IdSchema.optional(),
});

export const MATERIAL_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export const MaterialListQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  categoryId: IdSchema.optional(),
  status: z.enum(MATERIAL_STATUSES).optional(),
});

// ── Users ────────────────────────────────────────────────────────────────────

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const CreateUserSchema = z
  .object({
    name: requiredText(120),
    email: z.preprocess(emptyToUndefined, EmailSchema.optional()),
    phone: z.preprocess(emptyToUndefined, PhoneSchema.optional()),
    roleCode: z.enum(ROLE_CODES),
    /** Stores a Store Manager operates (DECISIONS Q2). Ignored for Project Admins, who see all. */
    storeIds: z.array(IdSchema).max(50).default([]),
    /** Initial password; the user must change it at first login (DECISIONS Q36). */
    password: PasswordSchema,
  })
  .refine((v) => v.email !== undefined || v.phone !== undefined, {
    message: 'Enter an e-mail or a mobile number',
    path: ['email'],
  })
  .refine((v) => v.roleCode !== 'STORE_MANAGER' || v.storeIds.length > 0, {
    message: 'Assign at least one store',
    path: ['storeIds'],
  });

export const MEMBER_STATUSES = ['ACTIVE', 'REMOVED'] as const;

export const UpdateUserSchema = z.object({
  name: requiredText(120).optional(),
  roleCode: z.enum(ROLE_CODES).optional(),
  storeIds: z.array(IdSchema).max(50).optional(),
  status: z.enum(MEMBER_STATUSES).optional(),
});

export const ResetPasswordSchema = z.object({ password: PasswordSchema });

// ── Audit ────────────────────────────────────────────────────────────────────

export const AuditListQuerySchema = PageQuerySchema.extend({
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(60).optional(),
  action: z.string().trim().max(60).optional(),
  actorUserId: IdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// ── Inferred input types ─────────────────────────────────────────────────────

export type LoginInput = z.input<typeof LoginSchema>;
export type ChangePasswordInput = z.input<typeof ChangePasswordSchema>;
export type UpdateProjectInput = z.input<typeof UpdateProjectSchema>;
export type CreateStoreInput = z.input<typeof CreateStoreSchema>;
export type UpdateStoreInput = z.input<typeof UpdateStoreSchema>;
export type LocationType = (typeof LOCATION_TYPES)[number];
export type CreateLocationInput = z.input<typeof CreateLocationSchema>;
export type UpdateLocationInput = z.input<typeof UpdateLocationSchema>;
export type CreateCategoryInput = z.input<typeof CreateCategorySchema>;
export type UpdateCategoryInput = z.input<typeof UpdateCategorySchema>;
export type CreateUnitInput = z.input<typeof CreateUnitSchema>;
export type UpdateUnitInput = z.input<typeof UpdateUnitSchema>;
export type CreateConversionInput = z.input<typeof CreateConversionSchema>;
export type MaterialInput = z.input<typeof MaterialInputSchema>;
export type MaterialData = z.output<typeof MaterialInputSchema>;
export type CreateMaterialInput = z.input<typeof CreateMaterialSchema>;
export type UpdateMaterialInput = z.input<typeof UpdateMaterialSchema>;
export type CheckDuplicatesInput = z.input<typeof CheckDuplicatesSchema>;
export type MaterialListQuery = z.input<typeof MaterialListQuerySchema>;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];
export type CreateUserInput = z.input<typeof CreateUserSchema>;
export type UpdateUserInput = z.input<typeof UpdateUserSchema>;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export type AuditListQuery = z.input<typeof AuditListQuerySchema>;
