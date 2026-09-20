-- ---------------------------------------------------------------------------
-- job_orders.visit_remarks
--
-- A note about the visit itself, separate from the two remark fields the table
-- already has:
--
--   onsite_remarks  what happened on site (free text)
--   status_remarks  why the outcome was Failed or Reschedule (a chosen reason)
--   visit_remarks   this column — notes about the visit, matching the
--                   Visit_Remarks that Service Orders have always carried
--
-- Nullable, no default: existing job orders simply have none.
--
-- Equivalent to the Laravel migration
-- database/migrations/2026_08_15_000004_add_visit_remarks_to_job_orders.php
-- Run this only if you apply schema changes by hand instead of via `php artisan migrate`.
-- ---------------------------------------------------------------------------

ALTER TABLE `job_orders`
    ADD COLUMN `visit_remarks` TEXT NULL DEFAULT NULL AFTER `onsite_remarks`;
