-- GOWISER: new tables and columns for the Agent Module and Roles Module.
-- Back up first. Run once, before deploying the new backend.

-- ===================== AGENT MODULE =====================

-- Payout approval. Keep this order: existing payouts become 'Approved'
-- before new ones default to 'Pending'.
ALTER TABLE agent_commission_history
    ADD COLUMN status VARCHAR(20) NULL,
    ADD COLUMN job_order_ids TEXT NULL;

ALTER TABLE agent_bonus_history
    ADD COLUMN status VARCHAR(20) NULL;

UPDATE agent_commission_history SET status = 'Approved' WHERE status IS NULL;
UPDATE agent_bonus_history      SET status = 'Approved' WHERE status IS NULL;

ALTER TABLE agent_commission_history ALTER COLUMN status SET DEFAULT 'Pending';
ALTER TABLE agent_bonus_history      ALTER COLUMN status SET DEFAULT 'Pending';

-- Achievement periods on claims
ALTER TABLE agent_achievement_claims
    ADD COLUMN period_type VARCHAR(20) NULL,
    ADD COLUMN period_key VARCHAR(20) NULL,
    ADD COLUMN cycle_start TIMESTAMP NULL DEFAULT NULL,
    ADD COLUMN cycle_end TIMESTAMP NULL DEFAULT NULL,
    ADD COLUMN job_order_ids LONGTEXT NULL,
    ADD INDEX agent_achievement_claims_period_type_index (period_type),
    ADD INDEX agent_achievement_claims_period_key_index (period_key),
    ADD INDEX claim_anchor_index (agent_id, period_type, cycle_end);

UPDATE agent_achievement_claims
   SET period_type = 'lifetime', period_key = 'lifetime'
 WHERE period_type IS NULL;

-- Closed achievement periods
CREATE TABLE agent_achievement_periods (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    agent_id BIGINT UNSIGNED NOT NULL,
    period_type VARCHAR(20) NOT NULL,
    period_key VARCHAR(20) NOT NULL,
    period_start DATE NULL,
    period_end DATE NULL,
    target INT NOT NULL DEFAULT 0,
    onboarded INT NOT NULL DEFAULT 0,
    reached TINYINT(1) NOT NULL DEFAULT 0,
    claimed TINYINT(1) NOT NULL DEFAULT 0,
    claim_id BIGINT UNSIGNED NULL,
    reward_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    carried_over INT NOT NULL DEFAULT 0,
    closed_at TIMESTAMP NULL DEFAULT NULL,
    closed_by VARCHAR(255) NULL,
    closed_reason VARCHAR(20) NULL,
    organization_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY agent_period_unique (agent_id, period_type, period_key),
    KEY agent_achievement_periods_agent_id_index (agent_id),
    KEY agent_achievement_periods_organization_id_index (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Weekly agent invoices
CREATE TABLE agent_invoices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    invoice_number VARCHAR(40) NOT NULL,
    invoice_type VARCHAR(10) NOT NULL,
    owner_key VARCHAR(40) NOT NULL,
    team_id BIGINT UNSIGNED NULL,
    agent_id BIGINT UNSIGNED NULL,
    team_name VARCHAR(255) NULL,
    agent_name VARCHAR(255) NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    invoice_date DATE NOT NULL,
    total_customers INT NOT NULL DEFAULT 0,
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    installation_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    commission DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    pdf_path VARCHAR(255) NULL,
    pdf_drive_url VARCHAR(500) NULL,
    pdf_drive_id VARCHAR(191) NULL,
    pdf_uploaded_at TIMESTAMP NULL DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Generated',
    organization_id BIGINT UNSIGNED NULL,
    created_by VARCHAR(255) NULL,
    updated_by VARCHAR(255) NULL,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY agent_invoices_invoice_number_unique (invoice_number),
    UNIQUE KEY agent_invoice_owner_period_unique (owner_key, period_start),
    KEY agent_invoices_invoice_type_index (invoice_type),
    KEY agent_invoices_owner_key_index (owner_key),
    KEY agent_invoices_team_id_index (team_id),
    KEY agent_invoices_agent_id_index (agent_id),
    KEY agent_invoices_status_index (status),
    KEY agent_invoices_organization_id_index (organization_id),
    KEY agent_invoice_owner_date_index (owner_key, invoice_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Customers listed on each agent invoice
CREATE TABLE agent_invoice_customers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    agent_invoice_id BIGINT UNSIGNED NOT NULL,
    application_id BIGINT UNSIGNED NOT NULL,
    job_order_id BIGINT UNSIGNED NULL,
    owner_key VARCHAR(40) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    referred_by_agent_id BIGINT UNSIGNED NULL,
    referred_by_name VARCHAR(255) NULL,
    referred_by_raw VARCHAR(255) NULL,
    installed_date DATE NULL,
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    quantity INT NOT NULL DEFAULT 1,
    total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY agent_invoice_customer_unique (agent_invoice_id, application_id),
    UNIQUE KEY agent_invoice_owner_customer_unique (owner_key, application_id),
    KEY agent_invoice_customers_job_order_id_index (job_order_id),
    KEY agent_invoice_customers_owner_key_index (owner_key),
    KEY agent_invoice_customers_referred_by_agent_id_index (referred_by_agent_id),
    CONSTRAINT agent_invoice_customers_agent_invoice_id_foreign
        FOREIGN KEY (agent_invoice_id) REFERENCES agent_invoices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent payment on job orders
ALTER TABLE job_orders
    ADD COLUMN incentive_value DECIMAL(10,2) NULL,
    ADD COLUMN commission_value DECIMAL(10,2) NULL,
    ADD COLUMN agent_paid_at TIMESTAMP NULL DEFAULT NULL,
    ADD COLUMN agent_paid_to BIGINT UNSIGNED NULL,
    ADD INDEX job_orders_agent_paid_index (agent_paid_to, agent_paid_at);

-- Agent commission bucket
ALTER TABLE agent_balance
    ADD COLUMN commission_value DECIMAL(12,2) NOT NULL DEFAULT 0.00;

-- Which invoice billed each completed quota
ALTER TABLE agent_incentive_history
    ADD COLUMN agent_invoice_id BIGINT UNSIGNED NULL,
    ADD COLUMN invoiced_at TIMESTAMP NULL DEFAULT NULL,
    ADD INDEX idx_aih_invoice (agent_invoice_id),
    ADD INDEX idx_aih_agent_invoice_processed (agent_id, agent_invoice_id, processed_at);

-- ===================== ROLES MODULE =====================

-- Leave permissions_version at 0 for existing roles (keeps their current access).
ALTER TABLE roles
    ADD COLUMN base_role_id BIGINT UNSIGNED NULL,
    ADD COLUMN permissions_version TINYINT UNSIGNED NOT NULL DEFAULT 0;
