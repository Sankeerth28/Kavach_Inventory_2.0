-- CreateEnum
CREATE TYPE "PostingType" AS ENUM ('RECEIPT_INVOICE', 'RECEIPT_MANUAL', 'RECEIPT_QUICK', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "TxnType" AS ENUM ('MATERIAL_IN', 'MATERIAL_OUT', 'MATERIAL_RETURN', 'STOCK_ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "StockBucket" AS ENUM ('AVAILABLE', 'DAMAGED', 'SCRAP');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('GOOD', 'DAMAGED', 'SCRAP');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('COUNT_CORRECTION', 'MANUAL_CORRECTION', 'DISPOSITION_WRITE_OFF', 'DISPOSITION_RESTORE');

-- CreateTable
CREATE TABLE "contractors" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "merged_into_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postings" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "type" "PostingType" NOT NULL,
    "reference_no" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "supplier_name" TEXT,
    "external_ref" TEXT,
    "reverses_posting_id" UUID,
    "created_material_id" UUID,
    "warnings" JSONB,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_transactions" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "project_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "posting_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "txn_no" TEXT NOT NULL,
    "type" "TxnType" NOT NULL,
    "bucket" "StockBucket" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_id" UUID NOT NULL,
    "balance_after" DECIMAL(18,3) NOT NULL,
    "entered_qty" DECIMAL(18,3),
    "entered_unit_id" UUID,
    "conversion_factor" DECIMAL(24,12),
    "location_id" UUID,
    "contractor_id" UUID,
    "return_condition" "ReturnCondition",
    "reverses_transaction_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "project_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "available_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "damaged_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "scrap_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "last_transaction_seq" BIGINT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("store_id","material_id")
);

-- CreateTable
CREATE TABLE "stock_verifications" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "bucket" "StockBucket" NOT NULL DEFAULT 'AVAILABLE',
    "system_qty" DECIMAL(18,3) NOT NULL,
    "system_seq" BIGINT,
    "physical_qty" DECIMAL(18,3) NOT NULL,
    "difference_qty" DECIMAL(18,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "open_key" TEXT,
    "submitted_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" TEXT,

    CONSTRAINT "stock_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "bucket" "StockBucket" NOT NULL,
    "quantity_delta" DECIMAL(18,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "verification_id" UUID,
    "posting_id" UUID NOT NULL,
    "approved_by_id" UUID NOT NULL,
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contractors_project_id_id_key" ON "contractors"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "contractors_project_id_normalized_name_key" ON "contractors"("project_id", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "postings_reverses_posting_id_key" ON "postings"("reverses_posting_id");

-- CreateIndex
CREATE INDEX "postings_project_id_type_posted_at_idx" ON "postings"("project_id", "type", "posted_at");

-- CreateIndex
CREATE INDEX "postings_project_id_external_ref_idx" ON "postings"("project_id", "external_ref");

-- CreateIndex
CREATE UNIQUE INDEX "postings_project_id_id_key" ON "postings"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "postings_project_id_reference_no_key" ON "postings"("project_id", "reference_no");

-- CreateIndex
CREATE UNIQUE INDEX "postings_project_id_idempotency_key_key" ON "postings"("project_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "material_transactions_seq_key" ON "material_transactions"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "material_transactions_reverses_transaction_id_key" ON "material_transactions"("reverses_transaction_id");

-- CreateIndex
CREATE INDEX "material_transactions_project_id_store_id_material_id_seq_idx" ON "material_transactions"("project_id", "store_id", "material_id", "seq");

-- CreateIndex
CREATE INDEX "material_transactions_project_id_type_created_at_idx" ON "material_transactions"("project_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "material_transactions_project_id_material_id_created_at_idx" ON "material_transactions"("project_id", "material_id", "created_at");

-- CreateIndex
CREATE INDEX "material_transactions_project_id_location_id_material_id_idx" ON "material_transactions"("project_id", "location_id", "material_id");

-- CreateIndex
CREATE INDEX "material_transactions_project_id_created_at_idx" ON "material_transactions"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "material_transactions_project_id_txn_no_key" ON "material_transactions"("project_id", "txn_no");

-- CreateIndex
CREATE UNIQUE INDEX "material_transactions_posting_id_line_no_key" ON "material_transactions"("posting_id", "line_no");

-- CreateIndex
CREATE INDEX "stock_balances_project_id_material_id_idx" ON "stock_balances"("project_id", "material_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_verifications_open_key_key" ON "stock_verifications"("open_key");

-- CreateIndex
CREATE INDEX "stock_verifications_project_id_status_submitted_at_idx" ON "stock_verifications"("project_id", "status", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_verifications_project_id_id_key" ON "stock_verifications"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_verification_id_key" ON "stock_adjustments"("verification_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_posting_id_key" ON "stock_adjustments"("posting_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_project_id_approved_at_idx" ON "stock_adjustments"("project_id", "approved_at");

-- AddForeignKey
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_project_id_merged_into_id_fkey" FOREIGN KEY ("project_id", "merged_into_id") REFERENCES "contractors"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_project_id_store_id_fkey" FOREIGN KEY ("project_id", "store_id") REFERENCES "stores"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_reverses_posting_id_fkey" FOREIGN KEY ("reverses_posting_id") REFERENCES "postings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_project_id_store_id_fkey" FOREIGN KEY ("project_id", "store_id") REFERENCES "stores"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_project_id_material_id_fkey" FOREIGN KEY ("project_id", "material_id") REFERENCES "materials"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_project_id_posting_id_fkey" FOREIGN KEY ("project_id", "posting_id") REFERENCES "postings"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_entered_unit_id_fkey" FOREIGN KEY ("entered_unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_project_id_location_id_fkey" FOREIGN KEY ("project_id", "location_id") REFERENCES "locations"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_project_id_contractor_id_fkey" FOREIGN KEY ("project_id", "contractor_id") REFERENCES "contractors"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_reverses_transaction_id_fkey" FOREIGN KEY ("reverses_transaction_id") REFERENCES "material_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_project_id_store_id_fkey" FOREIGN KEY ("project_id", "store_id") REFERENCES "stores"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_project_id_material_id_fkey" FOREIGN KEY ("project_id", "material_id") REFERENCES "materials"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_verifications" ADD CONSTRAINT "stock_verifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_verifications" ADD CONSTRAINT "stock_verifications_project_id_store_id_fkey" FOREIGN KEY ("project_id", "store_id") REFERENCES "stores"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_verifications" ADD CONSTRAINT "stock_verifications_project_id_material_id_fkey" FOREIGN KEY ("project_id", "material_id") REFERENCES "materials"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_verifications" ADD CONSTRAINT "stock_verifications_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_verifications" ADD CONSTRAINT "stock_verifications_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_project_id_store_id_fkey" FOREIGN KEY ("project_id", "store_id") REFERENCES "stores"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_project_id_material_id_fkey" FOREIGN KEY ("project_id", "material_id") REFERENCES "materials"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_verification_id_fkey" FOREIGN KEY ("verification_id") REFERENCES "stock_verifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_posting_id_fkey" FOREIGN KEY ("posting_id") REFERENCES "postings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
