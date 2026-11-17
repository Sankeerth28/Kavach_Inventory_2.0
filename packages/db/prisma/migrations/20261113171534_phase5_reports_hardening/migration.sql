-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits"("window_start");

-- CreateIndex
CREATE INDEX "audit_logs_project_id_action_created_at_idx" ON "audit_logs"("project_id", "action", "created_at");

-- CreateIndex
CREATE INDEX "invoices_project_id_created_at_idx" ON "invoices"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "material_transactions_project_id_store_id_created_at_idx" ON "material_transactions"("project_id", "store_id", "created_at");

-- CreateIndex
CREATE INDEX "materials_project_id_created_at_idx" ON "materials"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_verifications_project_id_submitted_at_idx" ON "stock_verifications"("project_id", "submitted_at");
