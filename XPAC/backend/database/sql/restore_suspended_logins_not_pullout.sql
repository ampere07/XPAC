-- Re-enable the customer logins that are switched off while the account is NOT
-- pulled out.
--
-- Population is identical to suspended_logins_not_pullout.sql — run that first
-- and read the rows before running anything here. As of the last check it is 28
-- accounts: 23 on billing status Active, 5 on Inactive.
--
-- These are accounts that were pulled out at some point (which correctly sets
-- users.active = 0), then brought back — reconnected, paid, or re-installed —
-- with nothing to clear the flag, because the only code path that writes
-- users.active = 1 is a service order whose concern or repair category is
-- Reactivate/Reactivation being resolved.
--
-- IMPORTANT: this does not stop it happening again. It repairs the rows that are
-- stuck today. The recurrence is a separate fix in the reconnection/payment
-- paths, which currently restore billing_status_id without touching this column.
--
-- Run the steps in order. Steps 1 and 2 are read-only / recoverable; step 3 is
-- the write.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — see exactly what will change, and how many.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
    u.id,
    u.username        AS account_no,
    u.email_address,
    u.active          AS active_now,
    bs.status_name    AS billing_status,
    ba.account_balance,
    u.updated_at      AS login_row_last_changed
FROM users u
INNER JOIN billing_accounts ba
        ON ba.account_no = u.username
LEFT JOIN billing_status bs
        ON bs.id = ba.billing_status_id
WHERE u.role_id = 3
  AND (u.active = 0 OR u.active IS NULL)
  AND (ba.billing_status_id <> 5 OR ba.billing_status_id IS NULL)
ORDER BY ba.billing_status_id, u.updated_at DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — snapshot the rows first, so the change can be undone.
--
-- Keeps the pre-change active value and updated_at. Without this the original
-- deactivation timestamp is lost, and that timestamp is currently the only clue
-- to when each account was switched off.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users_active_restore_backup (
    user_id           BIGINT UNSIGNED NOT NULL,
    username          VARCHAR(255),
    previous_active   TINYINT,
    previous_updated  DATETIME,
    billing_status_id INT,
    backed_up_at      DATETIME NOT NULL,
    PRIMARY KEY (user_id, backed_up_at)
);

INSERT INTO users_active_restore_backup
    (user_id, username, previous_active, previous_updated, billing_status_id, backed_up_at)
SELECT u.id, u.username, u.active, u.updated_at, ba.billing_status_id, NOW()
FROM users u
INNER JOIN billing_accounts ba
        ON ba.account_no = u.username
WHERE u.role_id = 3
  AND (u.active = 0 OR u.active IS NULL)
  AND (ba.billing_status_id <> 5 OR ba.billing_status_id IS NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — the write.
--
-- Wrapped in a transaction: run the UPDATE, check the reported row count against
-- what step 1 showed, then COMMIT. If the number is not what you expect, ROLLBACK
-- instead and nothing has changed. Both tables are InnoDB, so the rollback is real.
--
-- The WHERE clause is character-for-character the one in step 1, so the update
-- cannot reach a row the preview did not show — including any pulled-out account,
-- which stays switched off as it should.
-- ─────────────────────────────────────────────────────────────────────────────

START TRANSACTION;

UPDATE users u
INNER JOIN billing_accounts ba
        ON ba.account_no = u.username
SET u.active     = 1,
    u.updated_at = NOW()
WHERE u.role_id = 3
  AND (u.active = 0 OR u.active IS NULL)
  AND (ba.billing_status_id <> 5 OR ba.billing_status_id IS NULL);

SELECT ROW_COUNT() AS rows_updated;   -- expect the count from step 1

COMMIT;
-- ROLLBACK;   -- use this instead of COMMIT if the count looks wrong


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4 — confirm. The first query should now return 0 rows.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT COUNT(*) AS still_suspended_and_not_pullout
FROM users u
INNER JOIN billing_accounts ba
        ON ba.account_no = u.username
WHERE u.role_id = 3
  AND (u.active = 0 OR u.active IS NULL)
  AND (ba.billing_status_id <> 5 OR ba.billing_status_id IS NULL);

-- Pulled-out accounts must be untouched — this count should not have moved.
SELECT COUNT(*) AS still_suspended_pullout
FROM users u
INNER JOIN billing_accounts ba
        ON ba.account_no = u.username
WHERE u.role_id = 3
  AND (u.active = 0 OR u.active IS NULL)
  AND ba.billing_status_id = 5;


-- ─────────────────────────────────────────────────────────────────────────────
-- UNDO — restores the exact previous values from the most recent snapshot.
-- ─────────────────────────────────────────────────────────────────────────────

-- UPDATE users u
-- INNER JOIN users_active_restore_backup b
--         ON b.user_id = u.id
--        AND b.backed_up_at = (SELECT MAX(backed_up_at) FROM users_active_restore_backup)
-- SET u.active = b.previous_active,
--     u.updated_at = b.previous_updated;
