-- ===========================================================================
--  ATSS — Agent module schema
--  Weekly/monthly achievements, payout approval, and weekly referral invoices.
--
--  Run once, top to bottom. Requires MySQL 5.7+ / MariaDB 10.2+.
--
--  NOTE: run this ONCE. The ALTER TABLE statements will error with
--  "Duplicate column name" if run a second time — that error is harmless,
--  it just means the column is already there.
-- ===========================================================================

SET NAMES utf8mb4;


-- ===========================================================================
--  1. PAYOUT APPROVAL
--  A payout is recorded as Pending and moves no money. Approving it is what
--  applies it to the agent's balance.
-- ===========================================================================

ALTER TABLE `agent_commission_history`
    ADD COLUMN `status`        VARCHAR(20)  NULL DEFAULT 'Pending',
    ADD COLUMN `approve_by`    VARCHAR(255) NULL,
    ADD COLUMN `job_order_ids` TEXT         NULL;

ALTER TABLE `agent_bonus_history`
    ADD COLUMN `status`     VARCHAR(20)  NULL DEFAULT 'Pending',
    ADD COLUMN `approve_by` VARCHAR(255) NULL;

-- Everything recorded before this change has already reached the agent's
-- balance, so it is approved by definition. Without this, those rows would read
-- as Pending and could be approved a second time.
UPDATE `agent_commission_history` SET `status` = 'Approved' WHERE `status` IS NULL;
UPDATE `agent_bonus_history`      SET `status` = 'Approved' WHERE `status` IS NULL;


-- ===========================================================================
--  2. ACHIEVEMENT CLAIMS
--  One row per reward claimed. The columns below turn a once-ever milestone
--  into a reward that repeats every week and every month.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `agent_achievement_claims` (
    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `agent_id`   BIGINT UNSIGNED NOT NULL,
    `milestone`  INT NOT NULL,
    `amount`     DECIMAL(10,2) NOT NULL DEFAULT 1500.00,
    `created_at` TIMESTAMP NULL DEFAULT NULL,
    `updated_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    CONSTRAINT `agent_achievement_claims_agent_id_foreign`
        FOREIGN KEY (`agent_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `agent_achievement_claims`
    -- 'weekly' / 'monthly' / 'lifetime' (the retired model)
    ADD COLUMN `period_type`   VARCHAR(20) NULL,
    -- '2026-W33', '2026-08', or an anchored cycle key 'w@20260812-100000'
    ADD COLUMN `period_key`    VARCHAR(20) NULL,
    -- The span this reward was earned over. cycle_end is the moment of the
    -- claim, which is where the next cycle starts.
    ADD COLUMN `cycle_start`   TIMESTAMP NULL DEFAULT NULL,
    ADD COLUMN `cycle_end`     TIMESTAMP NULL DEFAULT NULL,
    -- The job orders that earned this reward, as a JSON array. This is what
    -- stops a referral earning the same tier twice, whatever its installation
    -- date is later edited to.
    ADD COLUMN `job_order_ids` LONGTEXT NULL,
    ADD INDEX `agent_achievement_claims_period_type_index` (`period_type`),
    ADD INDEX `agent_achievement_claims_period_key_index`  (`period_key`),
    ADD INDEX `claim_anchor_index` (`agent_id`, `period_type`, `cycle_end`);

-- Anything claimed before the repeating tiers existed belongs to the retired
-- lifetime milestone. Left unlabelled it could block a weekly or monthly claim
-- whose target happened to match.
UPDATE `agent_achievement_claims`
   SET `period_type` = 'lifetime', `period_key` = 'lifetime'
 WHERE `period_type` IS NULL;


-- ===========================================================================
--  3. ACHIEVEMENT PERIODS
--  The closing record of each cycle. Progress is counted from the referrals
--  inside the current cycle rather than held as a running total, so a new week
--  starts at zero on its own — this table is what records where the last one
--  finished, and that nothing carried over.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `agent_achievement_periods` (
    `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `agent_id`        BIGINT UNSIGNED NOT NULL,

    `period_type`     VARCHAR(20) NOT NULL,          -- 'weekly' | 'monthly'
    `period_key`      VARCHAR(20) NOT NULL,
    `period_start`    DATE NULL DEFAULT NULL,
    `period_end`      DATE NULL DEFAULT NULL,

    `target`          INT NOT NULL DEFAULT 0,
    `onboarded`       INT NOT NULL DEFAULT 0,
    `reached`         TINYINT(1) NOT NULL DEFAULT 0,

    `claimed`         TINYINT(1) NOT NULL DEFAULT 0,
    `claim_id`        BIGINT UNSIGNED NULL DEFAULT NULL,
    `reward_paid`     DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    -- Always zero: progress does not follow the agent into the next cycle.
    -- Stored rather than inferred, so the ledger states it outright.
    `carried_over`    INT NOT NULL DEFAULT 0,

    `closed_at`       TIMESTAMP NULL DEFAULT NULL,
    `closed_by`       VARCHAR(255) NULL DEFAULT NULL,
    -- 'period_ended' | 'claimed_early'. Without it a short cycle looks like a bug.
    `closed_reason`   VARCHAR(20) NULL DEFAULT NULL,

    `organization_id` BIGINT UNSIGNED NULL DEFAULT NULL,
    `created_at`      TIMESTAMP NULL DEFAULT NULL,
    `updated_at`      TIMESTAMP NULL DEFAULT NULL,

    PRIMARY KEY (`id`),

    -- One closure per agent per tier per cycle. Makes closing safe to attempt
    -- repeatedly: only the first attempt records it.
    UNIQUE KEY `agent_period_unique` (`agent_id`, `period_type`, `period_key`),

    KEY `agent_achievement_periods_agent_id_index` (`agent_id`),
    KEY `agent_achievement_periods_organization_id_index` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ===========================================================================
--  4. AGENT INVOICES
--  One invoice per owner per billing week, where an owner is a team or a solo
--  agent.
--
--  `owner_key` ('team:5' / 'solo:201') looks redundant beside team_id and
--  agent_id, but it is what makes the uniqueness work: MySQL treats NULLs as
--  distinct in a unique index, so a key built from the nullable columns would
--  let a team invoice with a NULL agent_id repeat unnoticed.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `agent_invoices` (
    `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    `invoice_number`   VARCHAR(40) NOT NULL,          -- never reused
    `invoice_type`     VARCHAR(10) NOT NULL,          -- 'team' | 'solo'
    `owner_key`        VARCHAR(40) NOT NULL,          -- 'team:5' | 'solo:201'

    `team_id`          BIGINT UNSIGNED NULL DEFAULT NULL,
    `agent_id`         BIGINT UNSIGNED NULL DEFAULT NULL,

    -- Names as they were when the invoice was raised, so a later rename does
    -- not rewrite an already-issued document.
    `team_name`        VARCHAR(255) NULL DEFAULT NULL,
    `agent_name`       VARCHAR(255) NULL DEFAULT NULL,

    `period_start`     DATE NOT NULL,
    `period_end`       DATE NOT NULL,
    `invoice_date`     DATE NOT NULL,

    `total_customers`  INT NOT NULL DEFAULT 0,
    `unit_price`       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    `installation_fee` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    `total_amount`     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    -- Earned per referral at the referring agent's own rate, so this is a sum
    -- across the invoice rather than a fixed figure.
    `commission`       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    -- total_amount + commission. The installation fee is stated on the document
    -- but does not form part of what is owed.
    `subtotal`         DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    `pdf_path`         VARCHAR(255) NULL DEFAULT NULL,
    `status`           VARCHAR(20) NOT NULL DEFAULT 'Generated',

    `organization_id`  BIGINT UNSIGNED NULL DEFAULT NULL,
    `created_by`       VARCHAR(255) NULL DEFAULT NULL,
    `updated_by`       VARCHAR(255) NULL DEFAULT NULL,
    `created_at`       TIMESTAMP NULL DEFAULT NULL,
    `updated_at`       TIMESTAMP NULL DEFAULT NULL,

    PRIMARY KEY (`id`),

    UNIQUE KEY `agent_invoices_invoice_number_unique` (`invoice_number`),
    -- One invoice per owner per week. A repeated run is refused here rather
    -- than relying on the schedule firing exactly once.
    UNIQUE KEY `agent_invoice_owner_period_unique` (`owner_key`, `period_start`),

    KEY `agent_invoices_invoice_type_index`    (`invoice_type`),
    KEY `agent_invoices_owner_key_index`       (`owner_key`),
    KEY `agent_invoices_team_id_index`         (`team_id`),
    KEY `agent_invoices_agent_id_index`        (`agent_id`),
    KEY `agent_invoices_status_index`          (`status`),
    KEY `agent_invoices_organization_id_index` (`organization_id`),
    KEY `agent_invoice_owner_date_index`       (`owner_key`, `invoice_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `agent_invoice_customers` (
    `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    `agent_invoice_id`     BIGINT UNSIGNED NOT NULL,
    `application_id`       BIGINT UNSIGNED NOT NULL,   -- the referred customer
    `job_order_id`         BIGINT UNSIGNED NULL DEFAULT NULL,

    -- Repeated from the invoice so the uniqueness below can be enforced by the
    -- database rather than by a query.
    `owner_key`            VARCHAR(40) NOT NULL,

    `customer_name`        VARCHAR(255) NOT NULL,
    -- Which agent in the team actually referred them, so a team invoice still
    -- shows who brought each customer in.
    `referred_by_agent_id` BIGINT UNSIGNED NULL DEFAULT NULL,
    `referred_by_name`     VARCHAR(255) NULL DEFAULT NULL,
    `referred_by_raw`      VARCHAR(255) NULL DEFAULT NULL,

    `installed_date`       DATE NULL DEFAULT NULL,
    `unit_price`           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    `quantity`             INT NOT NULL DEFAULT 1,
    `total`                DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    `created_at`           TIMESTAMP NULL DEFAULT NULL,
    `updated_at`           TIMESTAMP NULL DEFAULT NULL,

    PRIMARY KEY (`id`),

    -- A customer appears once on an invoice...
    UNIQUE KEY `agent_invoice_customer_unique` (`agent_invoice_id`, `application_id`),
    -- ...and once for an owner, ever. This is the duplicate prevention: a
    -- customer already billed to this team or agent cannot be written onto a
    -- later invoice for them.
    UNIQUE KEY `agent_invoice_owner_customer_unique` (`owner_key`, `application_id`),

    KEY `agent_invoice_customers_job_order_id_index`         (`job_order_id`),
    KEY `agent_invoice_customers_owner_key_index`            (`owner_key`),
    KEY `agent_invoice_customers_referred_by_agent_id_index` (`referred_by_agent_id`),

    CONSTRAINT `agent_invoice_customers_agent_invoice_id_foreign`
        FOREIGN KEY (`agent_invoice_id`) REFERENCES `agent_invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ===========================================================================
--  5. JOB ORDER SETTLEMENT
--  Approving a job order settles it with the referring agent: it is marked
--  Paid, the commission is credited, and the rates used are written onto the
--  row.
--
--  The rates are snapshots on purpose. An administrator may change either
--  setting later, and a job order approved last month must keep the figure it
--  was actually settled at — otherwise a change to the current rate would
--  silently restate money already paid.
--
--  `agent_paid_at` is what stops a second approval paying twice: it is written
--  in the same transaction as the credit, so a row carrying it has been paid.
-- ===========================================================================

ALTER TABLE `job_orders`
    -- What one referral was worth toward the quota incentive at approval.
    ADD COLUMN `incentive_value`  DECIMAL(10,2) NULL,
    -- What it paid in commission at approval.
    ADD COLUMN `commission_value` DECIMAL(10,2) NULL,
    -- When the agent was credited, and which agent.
    ADD COLUMN `agent_paid_at`    TIMESTAMP NULL DEFAULT NULL,
    ADD COLUMN `agent_paid_to`    BIGINT UNSIGNED NULL DEFAULT NULL,
    ADD INDEX `job_orders_agent_paid_index` (`agent_paid_to`, `agent_paid_at`);

-- Where the commission earned from approved job orders is held.
--
-- `agent_balance` already has a `commission` column, but that is the RATE one
-- referral pays — the figure the payout screens read to work out what a job
-- order is worth. It is a setting, not a running total, so earnings cannot go
-- into it.
--
--   commission        what one referral pays     (a setting)
--   commission_value  what the agent has earned  (a balance)
ALTER TABLE `agent_balance`
    ADD COLUMN `commission_value` DECIMAL(12,2) NOT NULL DEFAULT 0.00;


-- ===========================================================================
--  6. TELL LARAVEL THESE ARE DONE
--  Otherwise `php artisan migrate` will try to create these tables again.
--  Change the batch number to (SELECT MAX(batch) FROM migrations) + 1.
-- ===========================================================================

INSERT IGNORE INTO `migrations` (`migration`, `batch`) VALUES
  ('2026_08_11_000001_add_approval_status_to_agent_payout_tables',    99),
  ('2026_08_11_000002_add_period_to_agent_achievement_claims',        99),
  ('2026_08_12_000001_create_agent_achievement_periods_table',        99),
  ('2026_08_12_000002_add_cycle_bounds_to_agent_achievements',        99),
  ('2026_08_12_000003_add_job_order_ids_to_agent_achievement_claims', 99),
  ('2026_08_13_000001_create_agent_invoices_tables',                  99),
  ('2026_08_14_000001_add_agent_payment_columns_to_job_orders',        99),
  ('2026_08_14_000002_add_commission_value_to_agent_balance',          99);
