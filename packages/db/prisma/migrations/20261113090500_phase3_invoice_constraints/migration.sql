-- Hand-written constraints for Phase 3 (ARCHITECTURE §4.4): suppliers, documents, AI logs.

-- AI call log is append-only (PRD §18.3: AI results are auditable).
CREATE TRIGGER ai_processing_logs_append_only BEFORE UPDATE OR DELETE ON ai_processing_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ai_processing_logs_no_truncate BEFORE TRUNCATE ON ai_processing_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- A posted invoice names its supplier, and its receipt time is recorded.
ALTER TABLE invoices
  ADD CONSTRAINT inv_posted_shape CHECK (status NOT IN ('POSTED', 'REVERSED') OR (supplier_id IS NOT NULL AND posted_at IS NOT NULL)),
  -- The duplicate keys exist only while the invoice counts as received (PRD §13).
  ADD CONSTRAINT inv_dup_keys_only_when_posted CHECK (
    status = 'POSTED' OR (dup_header_key IS NULL AND dup_fingerprint_key IS NULL AND dup_challan_key IS NULL)),
  -- An override is always attributed and explained (DECISIONS Q6).
  ADD CONSTRAINT inv_override_shape CHECK (
    duplicate_override_at IS NULL
    OR (duplicate_override_by_id IS NOT NULL AND length(btrim(coalesce(duplicate_override_note, ''))) >= 3)),
  ADD CONSTRAINT inv_total_nonneg CHECK (invoice_total IS NULL OR invoice_total >= 0);

ALTER TABLE invoice_pages
  ADD CONSTRAINT ip_page_no_pos CHECK (page_no >= 1 AND page_count >= 1 AND size_bytes > 0),
  ADD CONSTRAINT ip_mime CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf'));

-- Quantities on a draft line are never negative; a discrepancy carries its reason (PRD §10.2 screen 4).
ALTER TABLE invoice_items
  ADD CONSTRAINT ii_qty_nonneg CHECK (
    coalesce(invoice_qty, 0) >= 0 AND coalesce(accepted_qty, 0) >= 0
    AND damaged_qty >= 0 AND rejected_qty >= 0 AND short_qty >= 0),
  ADD CONSTRAINT ii_score_range CHECK (match_score IS NULL OR (match_score >= 0 AND match_score <= 1)),
  -- A line resolves to an existing material or to a proposal, never both.
  ADD CONSTRAINT ii_one_resolution CHECK (material_id IS NULL OR proposed_material IS NULL);

-- One live mapping per supplier description (PRD §9.2).
ALTER TABLE supplier_material_mappings
  ADD CONSTRAINT smm_live_key CHECK ((status = 'CONFIRMED') = (live_key IS NOT NULL)),
  ADD CONSTRAINT smm_times_used CHECK (times_used >= 1);

ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_gstin_format CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$');

-- A receipt from an invoice names the invoice and its supplier; nothing else names an invoice.
ALTER TABLE postings
  ADD CONSTRAINT postings_invoice_ref CHECK ((type = 'RECEIPT_INVOICE') = (invoice_id IS NOT NULL)),
  ADD CONSTRAINT postings_invoice_supplier CHECK (type <> 'RECEIPT_INVOICE' OR supplier_id IS NOT NULL);

-- Only Material In rows carry an invoice line.
ALTER TABLE material_transactions
  ADD CONSTRAINT mt_invoice_item_in_only CHECK (invoice_item_id IS NULL OR type = 'MATERIAL_IN');
