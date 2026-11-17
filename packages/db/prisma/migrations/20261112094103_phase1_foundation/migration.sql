-- Trigram search on material names (ARCHITECTURE §4.4). Needed before the GIN index below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('TOWER', 'BLOCK', 'FLOOR', 'WORK_AREA', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitDimension" AS ENUM ('COUNT', 'MASS', 'LENGTH', 'VOLUME', 'AREA');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CreationSource" AS ENUM ('MANUAL', 'AI_INVOICE', 'QUICK_RECEIVE', 'SEED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'WORKER');

-- CreateEnum
CREATE TYPE "SequenceScope" AS ENUM ('MATERIAL', 'RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'REVERSAL', 'TRANSACTION');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_member_stores" (
    "project_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,

    CONSTRAINT "project_member_stores_pkey" PRIMARY KEY ("member_id","store_id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "path" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_categories" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "material_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "dimension" "UnitDimension" NOT NULL,
    "decimal_places" INTEGER NOT NULL DEFAULT 3,
    "aliases" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_conversions" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "material_id" UUID,
    "from_unit_id" UUID NOT NULL,
    "to_unit_id" UUID NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "subcategory_id" UUID,
    "brand" TEXT,
    "normalized_brand" TEXT,
    "specification" TEXT,
    "grade" TEXT,
    "size" TEXT,
    "stock_unit_id" UUID NOT NULL,
    "pack_size" DECIMAL(18,3),
    "pack_unit_id" UUID,
    "is_variable_weight" BOOLEAN NOT NULL DEFAULT false,
    "minimum_stock" DECIMAL(18,3),
    "description" TEXT,
    "status" "MaterialStatus" NOT NULL DEFAULT 'ACTIVE',
    "creation_source" "CreationSource" NOT NULL,
    "identity_key" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deactivated_by_id" UUID,
    "deactivated_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_specifications" (
    "id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value_text" TEXT,
    "value_numeric" DECIMAL(18,4),
    "unit_id" UUID,
    "normalized_value" TEXT NOT NULL,

    CONSTRAINT "material_specifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "project_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "request_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "id_sequences" (
    "project_id" UUID NOT NULL,
    "scope" "SequenceScope" NOT NULL,
    "year" INTEGER NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "id_sequences_pkey" PRIMARY KEY ("project_id","scope","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_id_key" ON "project_members"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_project_id_code_key" ON "stores"("project_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stores_project_id_id_key" ON "stores"("project_id", "id");

-- CreateIndex
CREATE INDEX "locations_project_id_parent_id_idx" ON "locations"("project_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_project_id_id_key" ON "locations"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "loc_name_uq" ON "locations"("project_id", "parent_id", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "material_categories_project_id_id_key" ON "material_categories"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cat_name_uq" ON "material_categories"("project_id", "parent_id", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "units_code_uq" ON "units"("project_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "conv_uq" ON "unit_conversions"("project_id", "material_id", "from_unit_id", "to_unit_id");

-- CreateIndex
CREATE INDEX "materials_project_id_category_id_idx" ON "materials"("project_id", "category_id");

-- CreateIndex
CREATE INDEX "materials_project_id_status_idx" ON "materials"("project_id", "status");

-- CreateIndex
CREATE INDEX "materials_name_trgm" ON "materials" USING GIN ("normalized_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "materials_project_id_id_key" ON "materials"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "materials_project_id_code_key" ON "materials"("project_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "materials_project_id_identity_key_key" ON "materials"("project_id", "identity_key");

-- CreateIndex
CREATE INDEX "material_specifications_key_normalized_value_idx" ON "material_specifications"("key", "normalized_value");

-- CreateIndex
CREATE UNIQUE INDEX "material_specifications_material_id_key_key" ON "material_specifications"("material_id", "key");

-- CreateIndex
CREATE INDEX "audit_logs_project_id_created_at_idx" ON "audit_logs"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member_stores" ADD CONSTRAINT "project_member_stores_project_id_member_id_fkey" FOREIGN KEY ("project_id", "member_id") REFERENCES "project_members"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member_stores" ADD CONSTRAINT "project_member_stores_project_id_store_id_fkey" FOREIGN KEY ("project_id", "store_id") REFERENCES "stores"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_project_id_parent_id_fkey" FOREIGN KEY ("project_id", "parent_id") REFERENCES "locations"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_categories" ADD CONSTRAINT "material_categories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_categories" ADD CONSTRAINT "material_categories_project_id_parent_id_fkey" FOREIGN KEY ("project_id", "parent_id") REFERENCES "material_categories"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_from_unit_id_fkey" FOREIGN KEY ("from_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_to_unit_id_fkey" FOREIGN KEY ("to_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_project_id_category_id_fkey" FOREIGN KEY ("project_id", "category_id") REFERENCES "material_categories"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_project_id_subcategory_id_fkey" FOREIGN KEY ("project_id", "subcategory_id") REFERENCES "material_categories"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_stock_unit_id_fkey" FOREIGN KEY ("stock_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_pack_unit_id_fkey" FOREIGN KEY ("pack_unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_deactivated_by_id_fkey" FOREIGN KEY ("deactivated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_specifications" ADD CONSTRAINT "material_specifications_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_specifications" ADD CONSTRAINT "material_specifications_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "id_sequences" ADD CONSTRAINT "id_sequences_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
