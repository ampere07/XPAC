-- ===========================================================================
--  ATSS — Job order settlement columns
--
--  Just the new columns for: settling a job order with its referring agent on
--  approval, and holding the commission that settlement earns.
--
--  Everything else for the agent module is in agent_module_schema.sql. This
--  file is only these two ALTERs, so it can be pasted on its own.
--
--  Run once. Re-running errors with "Duplicate column name", which is harmless
--  — it just means the column is already there.
-- ===========================================================================

SET NAMES utf8mb4;


-- ---------------------------------------------------------------------------
--  job_orders — what an approved job order paid, and at what rates
--
--  The two rates are snapshots on purpose. An administrator may change either
--  setting later, and a job order approved last month must keep the figure it
--  was actually settled at — otherwise a change to the current rate would
--  silently restate money already paid. Historical job orders are never
--  recalculated from the current setting.
--
--  agent_paid_at is what stops a second approval paying twice: it is written
--  in the same transaction as the credit, so a row carrying it has been paid.
-- ---------------------------------------------------------------------------

ALTER TABLE `job_orders`
    -- What one referral was worth toward the quota incentive at approval.
    -- The incentive cron reads this rather than the current setting.
    ADD COLUMN `incentive_value`  DECIMAL(10,2) NULL,

    -- What the referral paid in commission at approval.
    ADD COLUMN `commission_value` DECIMAL(10,2) NULL,

    -- When the agent was credited, and which agent. NULL means not yet paid.
    ADD COLUMN `agent_paid_at`    TIMESTAMP NULL DEFAULT NULL,
    ADD COLUMN `agent_paid_to`    BIGINT UNSIGNED NULL DEFAULT NULL,

    -- Read on every approval and every cron pass.
    ADD INDEX `job_orders_agent_paid_index` (`agent_paid_to`, `agent_paid_at`);


-- ---------------------------------------------------------------------------
--  agent_balance — where commission earnings are held
--
--  This table already has a `commission` column, but that is the RATE one
--  referral pays — the figure the payout screens read to work out what a job
--  order is worth. It is a setting, not a running total, so earnings cannot go
--  into it.
--
--      commission        what one referral pays     (a setting)
--      commission_value  what the agent has earned  (a balance)
--
--  Approving a job order credits commission_value. The Commission payout type
--  draws from it; the new Balance payout type draws from `balance`.
-- ---------------------------------------------------------------------------

ALTER TABLE `agent_balance`
    ADD COLUMN `commission_value` DECIMAL(12,2) NOT NULL DEFAULT 0.00;


-- ---------------------------------------------------------------------------
--  Tell Laravel these are done, or `php artisan migrate` will try again.
--  Set the batch to (SELECT MAX(batch) FROM migrations) + 1.
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO `migrations` (`migration`, `batch`) VALUES
  ('2026_08_14_000001_add_agent_payment_columns_to_job_orders', 99),
  ('2026_08_14_000002_add_commission_value_to_agent_balance',   99);


-- ---------------------------------------------------------------------------
--  Verify — both should return their columns.
-- ---------------------------------------------------------------------------

-- SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
--   FROM information_schema.COLUMNS
--  WHERE TABLE_SCHEMA = DATABASE()
--    AND (   (TABLE_NAME = 'job_orders'
--             AND COLUMN_NAME IN ('incentive_value','commission_value','agent_paid_at','agent_paid_to'))
--         OR (TABLE_NAME = 'agent_balance' AND COLUMN_NAME = 'commission_value'))
--  ORDER BY TABLE_NAME, COLUMN_NAME;
