-- Which generation of the permission model a custom role was saved under.
--
-- Mirrors database/migrations/2026_09_05_000001_add_permissions_version_to_roles_table.php
-- for deployments that apply schema changes by hand. Apply together with
-- add_base_role_id_to_roles.sql BEFORE deploying the Roles Module backend:
-- RoleController writes both columns on every create and update.
--
-- 0 = saved before per-action keys existed (every existing row). Such a role is
-- granted every action key of each page it holds, so nothing changes for it.
-- 1 = saved from Role Management with the per-action checkboxes on screen; the
-- stored list is read exactly as written.

ALTER TABLE `roles`
    ADD COLUMN `permissions_version` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `permissions`;
