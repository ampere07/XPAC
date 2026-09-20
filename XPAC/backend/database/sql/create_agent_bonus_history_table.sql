-- ============================================================
-- Agent Bonus History Table
-- ------------------------------------------------------------
-- Stores every bonus transaction recorded through the
-- "New Bonus Payout" form (frontend: BonusPayoutModal.tsx).
--
-- Each row is either:
--   • type = 'Bonus'          -> an ADDITION to the agent's bonus balance
--   • type = 'Bonus_payout'   -> a PAYOUT (deduction) from the bonus balance
--
-- Mirrors the shape of agent_commission_history so the same
-- reporting/UI columns (ref_number, total_amount, created_by, etc.)
-- apply directly.
--
-- Ready to copy/paste directly into phpMyAdmin (MySQL / MariaDB).
-- ============================================================

CREATE TABLE IF NOT EXISTS `agent_bonus_history` (
    `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `agent_id`         INT NOT NULL,                                  -- agent_balance.agent_id / users.id
    `ref_number`       VARCHAR(100) NOT NULL,                         -- reference number entered on the form
    `total_amount`     DECIMAL(15,2) NOT NULL DEFAULT 0.00,           -- bonus amount added or paid out
    `type`             VARCHAR(50) NULL DEFAULT NULL,                 -- 'Bonus' (add) or 'Bonus_payout' (payout)
    `proof_of_payment` VARCHAR(255) NULL DEFAULT NULL,                -- Google Drive URL of the uploaded proof image
    `remarks`          TEXT NULL DEFAULT NULL,                        -- free-text notes entered on the form
    `created_by`       VARCHAR(255) NULL DEFAULT NULL,                -- user who recorded the transaction
    `updated_by`       VARCHAR(255) NULL DEFAULT NULL,
    `approve_by`       VARCHAR(255) NULL DEFAULT NULL,
    `organization_id`  BIGINT NULL DEFAULT NULL,                      -- multi-tenant scope, copied from the user
    `created_at`       TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`       TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),

    -- Reporting / lookup indexes.
    KEY `idx_abh_agent_id` (`agent_id`),
    KEY `idx_abh_organization_id` (`organization_id`),
    KEY `idx_abh_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
