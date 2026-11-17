-- CreateEnum
CREATE TYPE "AliasSource" AS ENUM ('MANUAL', 'CONFIRMED_INVOICE');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('CONFIRMED', 'DISABLED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'CHALLAN', 'INVOICE_WITH_CHALLAN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UPLOADING', 'QUEUED', 'PROCESSING', 'NEEDS_RECAPTURE', 'READY_FOR_REVIEW', 'POSTED', 'REVERSED', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ProcessingStage" AS ENUM ('UPLOADED', 'QUALITY_CHECK', 'READING', 'IDENTIFYING', 'MATCHING', 'PREPARING', 'DONE');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('MATCHED', 'NEW_MATERIAL', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('SUPPLIER_MAPPING', 'EXACT', 'NORMALISED', 'DB_SEARCH', 'SEMANTIC', 'AI_TIEBREAK', 'MANUAL');

-- CreateEnum
CREATE TYPE "LineStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "DiscrepancyReason" AS ENUM ('SHORT_SUPPLY', 'DAMAGED', 'REJECTED', 'EXCESS', 'OTHER');

-- CreateEnum
CREATE TYPE "AiStage" AS ENUM ('QUALITY_CHECK', 'EXTRACTION', 'MATCH_TIEBREAK');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('SUCCESS', 'INVALID_OUTPUT', 'PROVIDER_ERROR', 'TIMEOUT', 'REFUSED');

-- AlterTable
ALTER TABLE "material_transactions" ADD COLUMN     "invoice_item_id" UUID;

-- AlterTable
ALTER TABLE "postings" ADD COLUMN     "invoice_id" UUID,
ADD COLUMN     "supplier_id" UUID;

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "gstin" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_aliases" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized_alias" TEXT NOT NULL,
    "source" "AliasSource" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_material_mappings" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "normalized_description" TEXT NOT NULL,
    "material_id" UUID NOT NULL,
    "status" "MappingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "live_key" TEXT,
    "confirmed_by_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_invoice_item_id" UUID,
    "times_used" INTEGER NOT NULL DEFAULT 1,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_reason" TEXT,

    CONSTRAINT "supplier_material_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL DEFAULT 'UNKNOWN',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UPLOADING',
    "stage" "ProcessingStage" NOT NULL DEFAULT 'UPLOADED',
    "quality_report" JSONB,
    "quality_overridden" BOOLEAN NOT NULL DEFAULT false,
    "supplier_id" UUID,
    "supplier_name_raw" TEXT,
    "supplier_gstin_raw" TEXT,
    "supplier_address_raw" TEXT,
    "invoice_no" TEXT,
    "normalized_invoice_no" TEXT,
    "invoice_date" DATE,
    "challan_no" TEXT,
    "normalized_challan_no" TEXT,
    "invoice_total" DECIMAL(18,2),
    "tax_details" JSONB,
    "extracted_header" JSONB,
    "extraction_version" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "document_fingerprint" TEXT,
    "duplicate_override_by_id" UUID,
    "duplicate_override_at" TIMESTAMPTZ(3),
    "duplicate_override_note" TEXT,
    "dup_header_key" TEXT,
    "dup_fingerprint_key" TEXT,
    "dup_challan_key" TEXT,
    "posted_at" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "processing_started_at" TIMESTAMPTZ(3),
    "next_attempt_at" TIMESTAMPTZ(3),
    "failure_code" TEXT,
    "failure_message" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_pages" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "page_no" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "original_name" TEXT,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "page_count" INTEGER NOT NULL DEFAULT 1,
    "width_px" INTEGER,
    "height_px" INTEGER,
    "quality" JSONB,
    "purged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "page_no" INTEGER,
    "is_manual_entry" BOOLEAN NOT NULL DEFAULT false,
    "extracted" JSONB,
    "original_description" TEXT NOT NULL,
    "normalized_description" TEXT NOT NULL,
    "hsn_code" TEXT,
    "match_status" "MatchStatus" NOT NULL,
    "match_method" "MatchMethod",
    "match_score" DECIMAL(5,4),
    "candidates" JSONB,
    "spec_conflicts" JSONB,
    "material_id" UUID,
    "proposed_material" JSONB,
    "created_material_id" UUID,
    "invoice_qty" DECIMAL(18,3),
    "invoice_unit_id" UUID,
    "invoice_unit_raw" TEXT,
    "unit_price" DECIMAL(18,4),
    "line_total" DECIMAL(18,2),
    "accepted_qty" DECIMAL(18,3),
    "damaged_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rejected_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "short_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "discrepancy_reason" "DiscrepancyReason",
    "notes" TEXT,
    "line_status" "LineStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_processing_logs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "invoice_id" UUID,
    "line_no" INTEGER,
    "triggered_by_id" UUID NOT NULL,
    "stage" "AiStage" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "AiCallStatus" NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "response" JSONB,
    "validation_errors" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_processing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_name_trgm" ON "suppliers" USING GIN ("normalized_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_project_id_id_key" ON "suppliers"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_project_id_gstin_key" ON "suppliers"("project_id", "gstin");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_project_id_normalized_name_key" ON "suppliers"("project_id", "normalized_name");

-- CreateIndex
CREATE INDEX "supplier_aliases_supplier_id_idx" ON "supplier_aliases"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_aliases_project_id_normalized_alias_key" ON "supplier_aliases"("project_id", "normalized_alias");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_material_mappings_live_key_key" ON "supplier_material_mappings"("live_key");

-- CreateIndex
CREATE INDEX "supplier_material_mappings_project_id_supplier_id_normalize_idx" ON "supplier_material_mappings"("project_id", "supplier_id", "normalized_description");

-- CreateIndex
CREATE INDEX "supplier_material_mappings_material_id_idx" ON "supplier_material_mappings"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_dup_header_key_key" ON "invoices"("dup_header_key");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_dup_fingerprint_key_key" ON "invoices"("dup_fingerprint_key");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_dup_challan_key_key" ON "invoices"("dup_challan_key");

-- CreateIndex
CREATE INDEX "invoices_project_id_status_created_at_idx" ON "invoices"("project_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "invoices_project_id_uploaded_by_id_created_at_idx" ON "invoices"("project_id", "uploaded_by_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_project_id_supplier_id_normalized_invoice_no_idx" ON "invoices"("project_id", "supplier_id", "normalized_invoice_no");

-- CreateIndex
CREATE INDEX "invoices_project_id_document_fingerprint_idx" ON "invoices"("project_id", "document_fingerprint");

-- CreateIndex
CREATE INDEX "invoices_status_next_attempt_at_idx" ON "invoices"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_project_id_id_key" ON "invoices"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_pages_storage_key_key" ON "invoice_pages"("storage_key");

-- CreateIndex
CREATE INDEX "invoice_pages_project_id_sha256_idx" ON "invoice_pages"("project_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_pages_invoice_id_page_no_key" ON "invoice_pages"("invoice_id", "page_no");

-- CreateIndex
CREATE INDEX "invoice_items_project_id_material_id_idx" ON "invoice_items"("project_id", "material_id");

-- CreateIndex
CREATE INDEX "invoice_items_project_id_match_status_idx" ON "invoice_items"("project_id", "match_status");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_invoice_id_line_no_key" ON "invoice_items"("invoice_id", "line_no");

-- CreateIndex
CREATE INDEX "ai_processing_logs_project_id_created_at_idx" ON "ai_processing_logs"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_processing_logs_project_id_triggered_by_id_created_at_idx" ON "ai_processing_logs"("project_id", "triggered_by_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_processing_logs_invoice_id_idx" ON "ai_processing_logs"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_transactions_invoice_item_id_bucket_key" ON "material_transactions"("invoice_item_id", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "postings_invoice_id_key" ON "postings"("invoice_id");

-- CreateIndex
CREATE INDEX "postings_project_id_supplier_id_posted_at_idx" ON "postings"("project_id", "supplier_id", "posted_at");

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_project_id_supplier_id_fkey" FOREIGN KEY ("project_id", "supplier_id") REFERENCES "suppliers"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_aliases" ADD CONSTRAINT "supplier_aliases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_aliases" ADD CONSTRAINT "supplier_aliases_project_id_supplier_id_fkey" FOREIGN KEY ("project_id", "supplier_id") REFERENCES "suppliers"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_aliases" ADD CONSTRAINT "supplier_aliases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_material_mappings" ADD CONSTRAINT "supplier_material_mappings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_material_mappings" ADD CONSTRAINT "supplier_material_mappings_project_id_supplier_id_fkey" FOREIGN KEY ("project_id", "supplier_id") REFERENCES "suppliers"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_material_mappings" ADD CONSTRAINT "supplier_material_mappings_project_id_material_id_fkey" FOREIGN KEY ("project_id", "material_id") REFERENCES "materials"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_material_mappings" ADD CONSTRAINT "supplier_material_mappings_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_material_mappings" ADD CONSTRAINT "supplier_material_mappings_source_invoice_item_id_fkey" FOREIGN KEY ("source_invoice_item_id") REFERENCES "invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_store_id_fkey" FOREIGN KEY ("project_id", "store_id") REFERENCES "stores"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_supplier_id_fkey" FOREIGN KEY ("project_id", "supplier_id") REFERENCES "suppliers"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_duplicate_override_by_id_fkey" FOREIGN KEY ("duplicate_override_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_pages" ADD CONSTRAINT "invoice_pages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_pages" ADD CONSTRAINT "invoice_pages_project_id_invoice_id_fkey" FOREIGN KEY ("project_id", "invoice_id") REFERENCES "invoices"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_project_id_invoice_id_fkey" FOREIGN KEY ("project_id", "invoice_id") REFERENCES "invoices"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_project_id_material_id_fkey" FOREIGN KEY ("project_id", "material_id") REFERENCES "materials"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_created_material_id_fkey" FOREIGN KEY ("created_material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_unit_id_fkey" FOREIGN KEY ("invoice_unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_processing_logs" ADD CONSTRAINT "ai_processing_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_processing_logs" ADD CONSTRAINT "ai_processing_logs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_processing_logs" ADD CONSTRAINT "ai_processing_logs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

