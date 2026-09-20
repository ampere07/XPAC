-- Hybrid roles: a custom role that starts from one of the eight seeded roles.
--
-- Mirrors database/migrations/2026_08_23_000002_add_base_role_id_to_roles_table.php
-- for deployments that apply schema changes by hand.
--
-- NULL means a standalone custom role (the old behaviour). A locked role id
-- (1-8) means "everything that role holds, resolved live from
-- App\Support\Permissions, plus whatever this role's own `permissions` adds".

ALTER TABLE `roles`
    ADD COLUMN `base_role_id` BIGINT UNSIGNED NULL DEFAULT NULL AFTER `description`;
