-- Set users.active = 1 for every customer login that is switched off while the
-- billing account is not Pullout (billing_status_id 5).
--
-- users.username holds the account number, which is what joins the two tables.
-- `IS NULL` is handled on both sides on purpose: a NULL active blocks sign-in the
-- same way 0 does, and `<> 5` alone would drop rows with no billing status,
-- because NULL <> 5 is NULL rather than true.

UPDATE users u
INNER JOIN billing_accounts ba
        ON ba.account_no = u.username
SET u.active     = 1,
    u.updated_at = NOW()
WHERE u.role_id = 3                                                -- customer logins only
  AND (u.active = 0 OR u.active IS NULL)
  AND (ba.billing_status_id <> 5 OR ba.billing_status_id IS NULL);


-- Should return 0 afterwards.
SELECT COUNT(*) AS still_suspended_and_not_pullout
FROM users u
INNER JOIN billing_accounts ba
        ON ba.account_no = u.username
WHERE u.role_id = 3
  AND (u.active = 0 OR u.active IS NULL)
  AND (ba.billing_status_id <> 5 OR ba.billing_status_id IS NULL);
