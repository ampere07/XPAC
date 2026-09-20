-- ---------------------------------------------------------------------------
-- job_orders.technician_enabled
--
-- 0 = disabled/locked for the technician (default)
-- 1 = enabled/clickable for the technician
--
-- A technician works their queue oldest first: only the oldest job order that
-- has not moved forward yet is actionable. An administrator sets this flag to 1
-- to release a newer job order early.
--
-- Equivalent to the Laravel migration
-- database/migrations/2026_08_15_000001_add_technician_enabled_to_job_orders.php
-- Run this only if you apply schema changes by hand instead of via `php artisan migrate`.
-- ---------------------------------------------------------------------------

ALTER TABLE `job_orders`
    ADD COLUMN `technician_enabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `assigned_email`;

ALTER TABLE `job_orders`
    ADD INDEX `job_orders_technician_enabled_index` (`assigned_email`, `technician_enabled`);
