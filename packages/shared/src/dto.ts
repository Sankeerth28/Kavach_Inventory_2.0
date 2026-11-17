import type { DuplicateVerdict } from './material-duplicates';
import type { PermissionCode, RoleCode } from './permissions';
import type { LocationType, MaterialStatus, MemberStatus } from './schemas';
import type { UnitDimension } from './units';

/** Response shapes of the Phase 1 API. Dates are ISO strings; quantities are decimal strings. */

export interface UserDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  mustChangePassword: boolean;
}

export interface MembershipDto {
  projectId: string;
  projectCode: string;
  projectName: string;
  roleCode: RoleCode;
  roleName: string;
  permissions: PermissionCode[];
  /** Stores this member operates. Empty for Project Admins, who see every store. */
  storeIds: string[];
}

export interface MeResponse {
  user: UserDto;
  memberships: MembershipDto[];
}

export interface AuthResponse extends MeResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Only for `client: "mobile"`. Web receives an httpOnly cookie instead. */
  refreshToken?: string;
}

export interface ProjectDto {
  id: string;
  code: string;
  name: string;
  address: string | null;
  timezone: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface StoreDto {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
}

export interface LocationDto {
  id: string;
  parentId: string | null;
  name: string;
  type: LocationType;
  /** "Tower A / Floor 3 / Flat 302" */
  path: string;
  isActive: boolean;
}

export interface CategoryDto {
  id: string;
  parentId: string | null;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface UnitDto {
  id: string;
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  decimalPlaces: number;
  aliases: string[];
  isActive: boolean;
  /** System units are seeded and read-only. */
  isSystem: boolean;
}

export interface ConversionDto {
  id: string;
  fromUnitId: string;
  toUnitId: string;
  factor: string;
  materialId: string | null;
  isActive: boolean;
  isSystem: boolean;
}

export interface MaterialDto {
  id: string;
  /** User-facing Material ID, e.g. MAT-000123 (PRD §6.2). */
  code: string;
  name: string;
  categoryId: string;
  categoryName: string;
  subcategoryId: string | null;
  subcategoryName: string | null;
  brand: string | null;
  specification: string | null;
  grade: string | null;
  size: string | null;
  stockUnitId: string;
  stockUnitCode: string;
  packSize: string | null;
  packUnitId: string | null;
  packUnitCode: string | null;
  isVariableWeight: boolean;
  minimumStock: string | null;
  description: string | null;
  status: MaterialStatus;
  creationSource: 'MANUAL' | 'AI_INVOICE' | 'QUICK_RECEIVE' | 'SEED';
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface DuplicateCandidateDto {
  material: Pick<
    MaterialDto,
    'id' | 'code' | 'name' | 'brand' | 'grade' | 'size' | 'stockUnitCode' | 'status'
  > & { packSize: string | null; packUnitCode: string | null; categoryName: string };
  verdict: DuplicateVerdict;
  nameScore: number;
  /** Attributes that differ, in plain words: "SIZE: 12MM vs 16MM". */
  conflicts: { key: string; proposed: string; existing: string }[];
}

export interface DuplicateCheckResult {
  /** True when an identical material exists. Creation is blocked. */
  exact: boolean;
  /** True when a similar material with no conflicting attribute exists. Creation needs confirmation. */
  needsConfirmation: boolean;
  candidates: DuplicateCandidateDto[];
}

export interface MemberDto {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleCode: RoleCode;
  roleName: string;
  status: MemberStatus;
  storeIds: string[];
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType: 'USER' | 'SYSTEM' | 'WORKER';
  actorUserId: string | null;
  actorName: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
}

/** Phase 1 dashboard summary response. */
export interface DashboardSummaryDto {
  view: 'FULL' | 'OPERATIONAL';
  materialCount: number;
  inactiveMaterialCount: number;
  categoryCount: number;
  storeCount: number;
  locationCount: number;
  memberCount: number | null;
}
