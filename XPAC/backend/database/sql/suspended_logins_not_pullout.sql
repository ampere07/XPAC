-- Customer logins that are switched off while the account is NOT pulled out.
--
-- A customer login stores the account number in users.username, so that is what
-- joins a login row to its billing account.
--
-- Two pieces of NULL handling that matter here:
--
--   * users.active is nullable with no default, and the sign-in check is
--     `if (!$user->active)` — so a NULL locks the customer out exactly the way a
--     0 does. Both are matched, otherwise the report would miss real lockouts.
--
--   * billing_status_id can be NULL, and plain `<> 5` would silently drop those
--     rows: in SQL, NULL <> 5 evaluates to NULL, not true. An account with no
--     status is not pulled out, so it belongs in this list.
--
-- billing_status reference:
--   1 Active   2 Blacklisted   3 Freeze   4 Inactive
--   5 Pullout  6 Service Account          7 VIP
--
-- Note that u.* includes password_hash. Replace it with an explicit column list
-- if this output is going anywhere other than your own screen.

SELECT
    u.*,
    ba.account_no          AS billing_account_no,
    ba.billing_status_id,
    bs.status_name         AS billing_status,
    ba.account_balance,
    ba.date_installed
FROM users u
INNER JOIN billing_accounts ba
        ON ba.account_no = u.username
LEFT JOIN billing_status bs
        ON bs.id = ba.billing_status_id
WHERE u.role_id = 3                                                -- customer logins only
  AND (u.active = 0 OR u.active IS NULL)                           -- sign-in is blocked
  AND (ba.billing_status_id <> 5 OR ba.billing_status_id IS NULL)  -- but not pulled out
ORDER BY ba.billing_status_id, u.updated_at DESC;


-- Same population, counted by billing status — run this first to see the shape
-- of it before pulling the full rows.

SELECT
    COALESCE(bs.status_name, '(no status)') AS billing_status,
    COUNT(*)                                AS accounts
FROM users u
INNER JOIN billing_accounts ba
        ON ba.account_no = u.username
LEFT JOIN billing_status bs
        ON bs.id = ba.billing_status_id
WHERE u.role_id = 3
  AND (u.active = 0 OR u.active IS NULL)
  AND (ba.billing_status_id <> 5 OR ba.billing_status_id IS NULL)
GROUP BY billing_status
ORDER BY accounts DESC;


-- Optional cross-check: switched-off logins with no billing account row at all.
-- The joins above cannot show these, and a customer login without a billing
-- account is worth knowing about on its own.

SELECT u.id, u.username, u.email_address, u.active, u.created_at, u.updated_at
FROM users u
LEFT JOIN billing_accounts ba
       ON ba.account_no = u.username
WHERE u.role_id = 3
  AND (u.active = 0 OR u.active IS NULL)
  AND ba.id IS NULL
ORDER BY u.updated_at DESC;
