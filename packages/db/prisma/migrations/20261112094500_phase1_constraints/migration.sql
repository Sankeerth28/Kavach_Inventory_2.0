-- Hand-written constraints Prisma cannot express (ARCHITECTURE §4.4), Phase 1 subset.
-- The ledger, invoice and supplier constraints arrive with their tables.

-- Append-only audit log (PRD §18.3, §26 rule 16; CLAUDE.md invariant 10).
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- A user logs in with an e-mail or a mobile number: at least one must exist (DECISIONS Q36).
ALTER TABLE users ADD CONSTRAINT users_identifier_present CHECK (email IS NOT NULL OR phone IS NOT NULL);
ALTER TABLE users ADD CONSTRAINT users_email_lower CHECK (email = lower(email));

-- NULLS NOT DISTINCT uniques (PostgreSQL 15+). Prisma created these as plain unique indexes, which
-- would allow two system units with the same code or two top-level categories with the same name.
DROP INDEX units_code_uq;
CREATE UNIQUE INDEX units_code_uq ON units (project_id, code) NULLS NOT DISTINCT;
DROP INDEX conv_uq;
CREATE UNIQUE INDEX conv_uq ON unit_conversions (project_id, material_id, from_unit_id, to_unit_id) NULLS NOT DISTINCT;
DROP INDEX cat_name_uq;
CREATE UNIQUE INDEX cat_name_uq ON material_categories (project_id, parent_id, normalized_name) NULLS NOT DISTINCT;
DROP INDEX loc_name_uq;
CREATE UNIQUE INDEX loc_name_uq ON locations (project_id, parent_id, normalized_name) NULLS NOT DISTINCT;

-- Approved conversions only (PRD §12.4).
ALTER TABLE unit_conversions ADD CONSTRAINT conv_factor_pos CHECK (factor > 0 AND from_unit_id <> to_unit_id);
ALTER TABLE units ADD CONSTRAINT units_decimal_places CHECK (decimal_places BETWEEN 0 AND 3);

-- Material Master sanity (PRD §6.2, §12.4).
ALTER TABLE materials
  ADD CONSTRAINT materials_pack_pair CHECK ((pack_size IS NULL) = (pack_unit_id IS NULL)),
  ADD CONSTRAINT materials_pack_pos CHECK (pack_size IS NULL OR pack_size > 0),
  ADD CONSTRAINT materials_min_stock_nonneg CHECK (minimum_stock IS NULL OR minimum_stock >= 0);

ALTER TABLE id_sequences ADD CONSTRAINT id_sequences_positive CHECK (next_value >= 1);

