-- ---------------------------------------------------------------------------------------
-- Monthly Payables module — schema for gowiser_sync_db1
--
-- Byte-for-byte equivalent of:
--   database/migrations/2026_08_02_000001_create_monthly_payables_table.php
--   database/migrations/2026_08_02_000002_create_payable_payments_table.php
--
-- PREFER `php artisan migrate` on the server. Use this file only when you cannot get a
-- shell there — paste it into phpMyAdmin / Hestia's DB manager against gowiser_sync_db1.
--
-- It also records both migrations in the `migrations` table, so a later `php artisan
-- migrate` skips them instead of failing on tables that already exist.
--
-- Safe to run more than once: the CREATEs are guarded and the migration rows are replaced
-- rather than appended.
--
-- Types were matched against the live schema snapshot (backend/db_schema.json):
--   expenses_category.id = bigint(20) unsigned, ENGINE=InnoDB, utf8mb4_unicode_ci
-- so the foreign key below is compatible as written.
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `monthly_payables` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint(20) unsigned DEFAULT NULL,
  `title` varchar(200) NOT NULL,
  `category_id` bigint(20) unsigned NOT NULL,
  `vendor_name` varchar(200) DEFAULT NULL,
  `account_number` varchar(100) DEFAULT NULL,
  `amount_due` decimal(12,2) NOT NULL,
  `amount_paid` decimal(12,2) NOT NULL DEFAULT 0.00,
  `due_date` date NOT NULL,
  `billing_month` varchar(7) NOT NULL,
  `status` enum('pending','partial','paid','overdue','cancelled') NOT NULL DEFAULT 'pending',
  `is_recurring` tinyint(1) NOT NULL DEFAULT 0,
  `notes` text,
  `receipt_path` varchar(500) DEFAULT NULL,
  `created_by` varchar(150) DEFAULT NULL,
  `modified_by` varchar(150) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  -- The list is always filtered by org + billing month first.
  KEY `monthly_payables_org_month_index` (`organization_id`,`billing_month`),
  -- Drives both the overdue sweep and the sidebar alert count.
  KEY `monthly_payables_status_due_index` (`status`,`due_date`),
  KEY `monthly_payables_category_id_index` (`category_id`),
  KEY `monthly_payables_is_recurring_index` (`is_recurring`),
  KEY `monthly_payables_deleted_at_index` (`deleted_at`),
  -- RESTRICT on delete: a category with payables against it must not vanish and leave the
  -- rows pointing at nothing — amounts owed have to stay attributable.
  CONSTRAINT `monthly_payables_category_id_foreign`
    FOREIGN KEY (`category_id`) REFERENCES `expenses_category` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `payable_payments` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `monthly_payable_id` bigint(20) unsigned NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `payment_date` date NOT NULL,
  `payment_method` varchar(100) DEFAULT NULL,
  `reference_no` varchar(150) DEFAULT NULL,
  `receipt_path` varchar(500) DEFAULT NULL,
  `notes` text,
  `recorded_by` varchar(150) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `payable_payments_payable_date_index` (`monthly_payable_id`,`payment_date`),
  -- CASCADE only fires on a hard delete; payables are soft-deleted in normal use.
  CONSTRAINT `payable_payments_monthly_payable_id_foreign`
    FOREIGN KEY (`monthly_payable_id`) REFERENCES `monthly_payables` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Mark both migrations as applied so artisan does not try to re-create these tables.
DELETE FROM `migrations` WHERE `migration` IN (
  '2026_08_02_000001_create_monthly_payables_table',
  '2026_08_02_000002_create_payable_payments_table'
);

SET @batch := (SELECT IFNULL(MAX(`batch`), 0) + 1 FROM `migrations`);

INSERT INTO `migrations` (`migration`, `batch`) VALUES
  ('2026_08_02_000001_create_monthly_payables_table', @batch),
  ('2026_08_02_000002_create_payable_payments_table', @batch);
