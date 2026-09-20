-- ---------------------------------------------------------------------------
-- service_orders.technician_enabled
--
-- 0 = disabled/locked for the technician (default)
-- 1 = enabled/clickable for the technician
--
-- The Service Order twin of job_orders.technician_enabled. A technician works
-- their queue In Progress first, oldest first within that: only the record at the
-- top is actionable. An administrator sets this flag to 1 to release another one
-- early.
--
-- Equivalent to the Laravel migration
-- database/migrations/2026_08_15_000002_add_technician_enabled_to_service_orders.php
-- Run this only if you apply schema changes by hand instead of via `php artisan migrate`.
-- ---------------------------------------------------------------------------

ALTER TABLE `service_orders`
    ADD COLUMN `technician_enabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `assigned_email`;

ALTER TABLE `service_orders`
    ADD INDEX `service_orders_technician_enabled_index` (`assigned_email`, `technician_enabled`);
