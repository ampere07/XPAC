-- ============================================================
-- SMS Logs Table
-- Stores a record of every SMS sent (single + blast, all providers)
-- ============================================================

CREATE TABLE IF NOT EXISTS `sms_logs` (
    `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `organization_id`   BIGINT UNSIGNED NULL,
    `account_no`        VARCHAR(50) NULL,
    `contact_no`        VARCHAR(50) NOT NULL,
    `message`           TEXT NOT NULL,
    `message_length`    INT NULL,
    `provider`          VARCHAR(50) NULL DEFAULT 'itexmo',   -- itexmo | semaphore | etc.
    `sender_id`         VARCHAR(50) NULL,
    `status`            ENUM('sent','failed') NOT NULL DEFAULT 'sent',
    `attempts`          INT NOT NULL DEFAULT 1,
    `error_message`     TEXT NULL,
    `provider_response` TEXT NULL,                            -- raw API response
    `source`            VARCHAR(50) NULL,                     -- e.g. billing, manual, blast, auto_disconnect
    `reference_id`      BIGINT UNSIGNED NULL,                 -- optional FK to blast/queue/etc.
    `sent_at`           TIMESTAMP NULL,
    `created_by_user_id` BIGINT UNSIGNED NULL,
    `created_at`        TIMESTAMP NULL,
    `updated_at`        TIMESTAMP NULL,
    PRIMARY KEY (`id`),
    INDEX `idx_sms_logs_contact_no` (`contact_no`),
    INDEX `idx_sms_logs_account_no` (`account_no`),
    INDEX `idx_sms_logs_status` (`status`),
    INDEX `idx_sms_logs_provider` (`provider`),
    INDEX `idx_sms_logs_sent_at` (`sent_at`),
    INDEX `idx_sms_logs_organization_id` (`organization_id`),
    INDEX `idx_sms_logs_created_by_user_id` (`created_by_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
