-- Hand-written ledger constraints (ARCHITECTURE §4.4), Phase 2.

-- Append-only ledger and posting headers (CLAUDE.md invariant 1; PRD §18.3, §26 rule 9).
CREATE TRIGGER material_transactions_append_only BEFORE UPDATE OR DELETE ON material_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER material_transactions_no_truncate BEFORE TRUNCATE ON material_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER postings_append_only BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER postings_no_truncate BEFORE TRUNCATE ON postings
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Ledger row sanity.
ALTER TABLE material_transactions
  ADD CONSTRAINT mt_qty_nonzero    CHECK (quantity <> 0),
  ADD CONSTRAINT mt_balance_nonneg CHECK (balance_after >= 0),
  ADD CONSTRAINT mt_in_sign        CHECK (type <> 'MATERIAL_IN' OR (quantity > 0 AND bucket IN ('AVAILABLE', 'DAMAGED'))),
  -- PRD §26 rule 6: Material Out requires a destination, and only draws on available stock.
  ADD CONSTRAINT mt_out_shape      CHECK (type <> 'MATERIAL_OUT' OR (quantity < 0 AND bucket = 'AVAILABLE' AND location_id IS NOT NULL)),
  -- PRD §26 rule 7: a return requires a source location and a condition that matches its bucket.
  ADD CONSTRAINT mt_return_shape   CHECK (type <> 'MATERIAL_RETURN' OR (
        quantity > 0 AND location_id IS NOT NULL AND return_condition IS NOT NULL
        AND ((return_condition = 'GOOD' AND bucket = 'AVAILABLE')
          OR (return_condition = 'DAMAGED' AND bucket = 'DAMAGED')
          OR (return_condition = 'SCRAP' AND bucket = 'SCRAP')))),
  -- PRD §26 rule 10: a reversal references its original; nothing else does.
  ADD CONSTRAINT mt_reversal_ref   CHECK ((type = 'REVERSAL') = (reverses_transaction_id IS NOT NULL));

ALTER TABLE postings
  ADD CONSTRAINT postings_reversal_ref CHECK ((type = 'REVERSAL') = (reverses_posting_id IS NOT NULL));

-- Negative stock: the last line of defence (CLAUDE.md invariant 3). The engine checks first, under a row lock.
ALTER TABLE stock_balances ADD CONSTRAINT sb_nonneg
  CHECK (available_qty >= 0 AND damaged_qty >= 0 AND scrap_qty >= 0);

ALTER TABLE stock_verifications
  ADD CONSTRAINT sv_qty_nonneg  CHECK (physical_qty >= 0 AND system_qty >= 0),
  ADD CONSTRAINT sv_difference  CHECK (difference_qty = physical_qty - system_qty),
  ADD CONSTRAINT sv_open_key    CHECK ((status = 'SUBMITTED') = (open_key IS NOT NULL)),
  ADD CONSTRAINT sv_reviewed    CHECK (status NOT IN ('APPROVED', 'REJECTED') OR (reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL));

ALTER TABLE stock_adjustments ADD CONSTRAINT sa_delta_nonzero CHECK (quantity_delta <> 0);
