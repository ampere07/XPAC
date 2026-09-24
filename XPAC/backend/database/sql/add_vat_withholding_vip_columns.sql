-- ============================================================
-- VAT (boolean) / Withholding / VIP columns
--
-- Replaces the free-text `vat_type` ('Vat Included' | 'Excluded Vat' | 'No Vat')
-- with a boolean `vat_enabled`, and adds Withholding + VIP to the JO Assign Form.
--
-- VIP is NOT a new mechanism. billing_accounts already has `vip_expiration` and
-- the VIP billing status, driven by the vip:check-expiration command. The two
-- columns added to `job_orders` only let the JO Assign Form capture VIP up front
-- so approval creates the account as VIP directly — no editing the customer
-- afterwards. Nothing is added to billing_accounts for VIP.
--
-- `vat_type` is deliberately NOT dropped: older clients and the customer-details
-- screens still read it, and the billing generator falls back to it when
-- `vat_enabled` is NULL. Drop it only after those readers are migrated.
--
-- Run against the GoWiser database. MySQL 8 / MariaDB 10.4+.
-- ============================================================

-- ------------------------------------------------------------
-- 1. job_orders — values captured on the JO Assign Form
--
--    `vip_expiration` deliberately mirrors billing_accounts.vip_expiration in
--    both name and type, because approval copies it across verbatim.
--
--    VIP is mutually exclusive with VAT and withholding: when vip_enabled = 1
--    the other two are forced off on write.
-- ------------------------------------------------------------
ALTER TABLE `job_orders`
    ADD COLUMN `vat_enabled`            TINYINT(1)    NOT NULL DEFAULT 0 AFTER `vat_type`,
    ADD COLUMN `withholding_enabled`    TINYINT(1)    NOT NULL DEFAULT 0 AFTER `vat_enabled`,
    ADD COLUMN `withholding_percentage` DECIMAL(5, 2) NULL     DEFAULT NULL AFTER `withholding_enabled`,
    ADD COLUMN `vip_enabled`            TINYINT(1)    NOT NULL DEFAULT 0 AFTER `withholding_percentage`,
    ADD COLUMN `vip_expiration`         DATETIME      NULL     DEFAULT NULL AFTER `vip_enabled`;

-- ------------------------------------------------------------
-- 2. billing_accounts — copied from the job order at approval,
--    and read by the billing generation service.
--
--    No VIP columns here: `vip_expiration` already exists, and VIP membership
--    is the billing status itself.
-- ------------------------------------------------------------
ALTER TABLE `billing_accounts`
    ADD COLUMN `vat_enabled`            TINYINT(1)    NOT NULL DEFAULT 0 AFTER `vat_type`,
    ADD COLUMN `withholding_enabled`    TINYINT(1)    NOT NULL DEFAULT 0 AFTER `vat_enabled`,
    ADD COLUMN `withholding_percentage` DECIMAL(5, 2) NULL     DEFAULT NULL AFTER `withholding_enabled`;

-- ------------------------------------------------------------
-- 3. Backfill `vat_enabled` from the legacy `vat_type` text
--
--    'Excluded Vat' -> 1  VAT is added on top of the plan price.
--    'Vat Included' -> 0  Already billed a total EQUAL to the plan price, which
--                         is exactly what vat_enabled = 0 produces, so no
--                         existing customer's total changes.
--    'No Vat'       -> 0
--    NULL / unknown -> 0
--
--    This mirrors the fallback in EnhancedBillingGenerationServiceWithNotifications,
--    so running it changes no amounts — it just makes the value explicit.
-- ------------------------------------------------------------
UPDATE `billing_accounts`
SET `vat_enabled` = CASE
        WHEN LOWER(REPLACE(COALESCE(`vat_type`, ''), ' ', '')) LIKE '%exclu%' THEN 1
        ELSE 0
    END;

UPDATE `job_orders`
SET `vat_enabled` = CASE
        WHEN LOWER(REPLACE(COALESCE(`vat_type`, ''), ' ', '')) LIKE '%exclu%' THEN 1
        ELSE 0
    END;

-- ------------------------------------------------------------
-- 4. Sanity check — confirms the VIP billing status this feature
--    relies on exists and shows the id it resolves to.
--    Approval looks it up by name and falls back to 7.
-- ------------------------------------------------------------
SELECT `id`, `status_name` FROM `billing_status` WHERE `status_name` = 'VIP';

-- ------------------------------------------------------------
-- Rollback
-- ------------------------------------------------------------
-- ALTER TABLE `billing_accounts`
--     DROP COLUMN `vat_enabled`,
--     DROP COLUMN `withholding_enabled`,
--     DROP COLUMN `withholding_percentage`;
-- ALTER TABLE `job_orders`
--     DROP COLUMN `vat_enabled`,
--     DROP COLUMN `withholding_enabled`,
--     DROP COLUMN `withholding_percentage`,
--     DROP COLUMN `vip_enabled`,
--     DROP COLUMN `vip_expiration`;
