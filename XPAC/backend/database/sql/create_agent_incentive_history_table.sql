-- ============================================================
-- Agent Incentive History Table
-- ------------------------------------------------------------
-- Records every Job Order that has already been counted toward an
-- agent quota incentive award. This is the idempotency ledger used by
-- the AgentIncentiveService cron: a Job Order present here is NEVER
-- counted again, so re-running the cron can never double-pay incentives.
--
-- Job Orders that have NOT yet completed a quota are simply absent from this
-- table, which is what makes an unfinished quota accumulate across runs instead
-- of resetting: the next run finds them still uncounted and adds them to the
-- same progress. Once a quota completes, every Job Order in it is written here
-- carrying the `batch_number` of that cycle, and is locked out of every later
-- one.
--
-- `agent_invoice_id` closes the loop on the paying side: it names the weekly
-- invoice that billed a completed quota, so the same incentive can never be
-- billed on a second invoice.
--
-- Ready to copy/paste directly into phpMyAdmin (MySQL / MariaDB).
-- ============================================================

CREATE TABLE IF NOT EXISTS `agent_incentive_history` (
    `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `agent_id`        INT NOT NULL,                                   -- agent_balance.agent_id / users.id
    `job_order_id`    BIGINT UNSIGNED NOT NULL,                       -- job_orders.id that was counted
    `quota_reached`   INT NOT NULL DEFAULT 0,                         -- the quota value satisfied when this JO was processed
    `batch_number`    INT NOT NULL DEFAULT 0,                         -- per-agent incrementing quota cycle number this JO belonged to
    `incentive_value` DECIMAL(15,2) NOT NULL DEFAULT 0.00,           -- incentive amount awarded for the cycle this JO belonged to
    `organization_id` BIGINT NULL DEFAULT NULL,                       -- copied from agent_balance for multi-tenant reporting
    `processed_at`    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,       -- when the cron awarded this JO; decides which billing week it belongs to
    `agent_invoice_id` BIGINT UNSIGNED NULL DEFAULT NULL,             -- invoice that billed this quota; NULL = earned but not yet billed
    `invoiced_at`     TIMESTAMP NULL DEFAULT NULL,                    -- when the weekly invoice run claimed it
    `created_at`      TIMESTAMP NULL DEFAULT NULL,
    `updated_at`      TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),

    -- HARD GUARANTEE: a Job Order can be recorded only once, ever.
    -- This is the ultimate guard against duplicate counting / double incentives,
    -- independent of any application-level checks.
    UNIQUE KEY `uq_aih_job_order_id` (`job_order_id`),

    -- Performance indexes for the cron lookups and reporting.
    KEY `idx_aih_agent_id` (`agent_id`),
    KEY `idx_aih_agent_job` (`agent_id`, `job_order_id`),
    KEY `idx_aih_agent_batch` (`agent_id`, `batch_number`),
    KEY `idx_aih_organization_id` (`organization_id`),

    -- The shape of the weekly invoice run's claim query: this agent, not yet
    -- billed, awarded inside this billing week.
    KEY `idx_aih_invoice` (`agent_invoice_id`),
    KEY `idx_aih_agent_invoice_processed` (`agent_id`, `agent_invoice_id`, `processed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
