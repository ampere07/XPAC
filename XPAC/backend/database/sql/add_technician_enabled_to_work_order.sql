-- ---------------------------------------------------------------------------
-- work_order.technician_enabled
--
-- 0 = disabled/locked for the technician (default)
-- 1 = enabled/clickable for the technician
--
-- The Work Order twin of job_orders.technician_enabled and
-- service_orders.technician_enabled. A technician works their queue In Progress
-- first, oldest first within that: only the record at the top is actionable. An
-- administrator sets this flag to 1 to release another one early.
--
-- NOTE the table name is `work_order`, SINGULAR. That is the existing name in
-- this schema, not a typo.
--
-- Equivalent to the Laravel migration
-- database/migrations/2026_08_15_000003_add_technician_enabled_to_work_order.php
-- Run this only if you apply schema changes by hand instead of via `php artisan migrate`.
-- ---------------------------------------------------------------------------

ALTER TABLE `work_order`
    ADD COLUMN `technician_enabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `assign_to`;

ALTER TABLE `work_order`
    ADD INDEX `work_order_technician_enabled_index` (`assign_to`, `technician_enabled`);
