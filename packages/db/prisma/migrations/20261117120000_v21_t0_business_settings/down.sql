-- Reverts 20261117120000_v21_t0_business_settings: removes the v2.1 business-settings keys and any
-- per-project feature-flag overrides. The v2.0 `confidence` key is kept.
-- Note: values a Project Admin changed after the migration are removed too.

UPDATE "projects"
SET "settings" = "settings" - ARRAY[
      'buffer_days',
      'mr_expiry_days',
      'ack_overdue_hours',
      'emergency_regularise_hours',
      'emergency_rate_threshold_pct',
      'return_request_overdue_days',
      'se_stock_visibility',
      'features'
    ];
