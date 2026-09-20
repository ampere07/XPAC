-- ---------------------------------------------------------------------------
-- Duplicate "pullout" service orders on the same day
--
-- A pullout should be raised once per account per day. When the same account_no
-- gets two or more pullout service orders dated the same day, one of them is a
-- double entry: it splits the technician queue, double-counts in the pullout
-- report, and gives AutoDisconnectService / PulloutServiceOrderCloser more than
-- one row to act on for a single physical pullout.
--
-- The duplicate key is:  organization_id + account_no + the pullout date.
--
-- concern is stored inconsistently ('Pullout', 'For Pullout', 'for pullout'),
-- so it is always normalised with LOWER(TRIM(...)) -- the same normalisation
-- app/Services/PulloutServiceOrderCloser.php uses.
--
-- The day comes from COALESCE(`timestamp`, created_at): `timestamp` is the
-- Asia/Manila service-order date set by the form, created_at is the fallback
-- for rows saved without one.
--
-- Read-only. Nothing here changes data; section 4 is a commented-out cleanup.
-- Sections 1 and 2 run on MySQL 5.7+, sections 3 and 4 need MySQL 8.0+
-- (window functions).
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. SUMMARY -- one row per account/day that has more than one pullout.
--    Start here: this is the list of concerns to check.
-- ---------------------------------------------------------------------------
SELECT
    d.organization_id,
    d.account_no,
    d.pullout_date,
    d.dupe_count,
    d.so_ids,
    d.concerns,
    d.support_statuses,
    d.visit_statuses,
    d.assigned_emails,
    d.created_by_users,
    d.first_created_at,
    d.last_created_at,
    TIMESTAMPDIFF(MINUTE, d.first_created_at, d.last_created_at) AS minutes_apart
FROM (
    SELECT
        so.organization_id,
        so.account_no,
        DATE(COALESCE(so.`timestamp`, so.created_at))                 AS pullout_date,
        COUNT(*)                                                      AS dupe_count,
        GROUP_CONCAT(so.id ORDER BY so.id)                            AS so_ids,
        GROUP_CONCAT(DISTINCT so.concern)                             AS concerns,
        GROUP_CONCAT(DISTINCT COALESCE(so.support_status, '(none)'))  AS support_statuses,
        GROUP_CONCAT(DISTINCT COALESCE(so.visit_status, '(none)'))    AS visit_statuses,
        GROUP_CONCAT(DISTINCT COALESCE(so.assigned_email, '(none)'))  AS assigned_emails,
        GROUP_CONCAT(DISTINCT COALESCE(so.created_by_user, '(none)')) AS created_by_users,
        MIN(so.created_at)                                            AS first_created_at,
        MAX(so.created_at)                                            AS last_created_at
    FROM service_orders so
    WHERE so.account_no IS NOT NULL
      AND TRIM(so.account_no) <> ''
      AND LOWER(TRIM(COALESCE(so.concern, ''))) IN ('pullout', 'for pullout')
      -- Narrow the window when the table is large:
      -- AND COALESCE(so.`timestamp`, so.created_at) >= '2026-01-01 00:00:00'
      -- AND so.organization_id = 1
    GROUP BY
        so.organization_id,
        so.account_no,
        DATE(COALESCE(so.`timestamp`, so.created_at))
    HAVING COUNT(*) > 1
) AS d
ORDER BY d.dupe_count DESC, d.pullout_date DESC, d.account_no;


-- ---------------------------------------------------------------------------
-- 2. DETAIL -- every individual service order behind the groups above, so you
--    can see which copy is the real one and which is the accidental re-entry.
-- ---------------------------------------------------------------------------
SELECT
    so.id,
    so.organization_id,
    so.account_no,
    DATE(COALESCE(so.`timestamp`, so.created_at)) AS pullout_date,
    so.`timestamp`,
    so.ticket_id,
    so.invoice_id,
    so.concern,
    so.concern_remarks,
    so.status,
    so.support_status,
    so.visit_status,
    so.priority_level,
    so.requested_by,
    so.assigned_email,
    so.created_by_user,
    so.updated_by_user,
    so.service_charge,
    so.created_at,
    so.updated_at
FROM service_orders so
JOIN (
    SELECT
        organization_id,
        account_no,
        DATE(COALESCE(`timestamp`, created_at)) AS pullout_date
    FROM service_orders
    WHERE account_no IS NOT NULL
      AND TRIM(account_no) <> ''
      AND LOWER(TRIM(COALESCE(concern, ''))) IN ('pullout', 'for pullout')
    GROUP BY
        organization_id,
        account_no,
        DATE(COALESCE(`timestamp`, created_at))
    HAVING COUNT(*) > 1
) AS dupes
  ON  dupes.account_no   = so.account_no
  AND dupes.pullout_date = DATE(COALESCE(so.`timestamp`, so.created_at))
  AND (dupes.organization_id = so.organization_id
       OR (dupes.organization_id IS NULL AND so.organization_id IS NULL))
WHERE LOWER(TRIM(COALESCE(so.concern, ''))) IN ('pullout', 'for pullout')
ORDER BY so.account_no, pullout_date, so.id;


-- ---------------------------------------------------------------------------
-- 3. KEEP / DROP -- MySQL 8.0+. Ranks each duplicate group so the row to keep
--    is obvious. Rule used: a resolved copy wins over an unresolved one (the
--    closing work already happened against it), otherwise the oldest id wins
--    as the original entry.
--
--    keep_or_drop = 'KEEP'  -> rn = 1, the survivor
--    keep_or_drop = 'DROP?' -> the extra copies, to review before touching
-- ---------------------------------------------------------------------------
WITH pullouts AS (
    SELECT
        so.*,
        DATE(COALESCE(so.`timestamp`, so.created_at)) AS pullout_date
    FROM service_orders so
    WHERE so.account_no IS NOT NULL
      AND TRIM(so.account_no) <> ''
      AND LOWER(TRIM(COALESCE(so.concern, ''))) IN ('pullout', 'for pullout')
),
ranked AS (
    SELECT
        p.*,
        COUNT(*)     OVER (PARTITION BY p.organization_id, p.account_no, p.pullout_date) AS dupe_count,
        ROW_NUMBER() OVER (
            PARTITION BY p.organization_id, p.account_no, p.pullout_date
            ORDER BY
                CASE WHEN LOWER(TRIM(COALESCE(p.support_status, ''))) = 'resolved' THEN 0 ELSE 1 END,
                p.id
        ) AS rn
    FROM pullouts p
)
SELECT
    CASE WHEN rn = 1 THEN 'KEEP' ELSE 'DROP?' END AS keep_or_drop,
    rn,
    dupe_count,
    id,
    organization_id,
    account_no,
    pullout_date,
    `timestamp`,
    ticket_id,
    concern,
    support_status,
    visit_status,
    assigned_email,
    created_by_user,
    created_at
FROM ranked
WHERE dupe_count > 1
ORDER BY account_no, pullout_date, rn;


-- ---------------------------------------------------------------------------
-- 4. CLEANUP -- intentionally commented out. Review section 3 first, confirm
--    with the team, back up the table, then run inside a transaction.
--
--    Soft option (preferred): mark the extra copies as cancelled instead of
--    deleting them, so the audit trail survives.
-- ---------------------------------------------------------------------------
-- START TRANSACTION;
--
-- UPDATE service_orders so
-- JOIN (
--     SELECT r.id FROM (
--         SELECT
--             so2.id,
--             COUNT(*)     OVER (PARTITION BY so2.organization_id, so2.account_no,
--                                             DATE(COALESCE(so2.`timestamp`, so2.created_at))) AS dupe_count,
--             ROW_NUMBER() OVER (
--                 PARTITION BY so2.organization_id, so2.account_no,
--                              DATE(COALESCE(so2.`timestamp`, so2.created_at))
--                 ORDER BY
--                     CASE WHEN LOWER(TRIM(COALESCE(so2.support_status, ''))) = 'resolved' THEN 0 ELSE 1 END,
--                     so2.id
--             ) AS rn
--         FROM service_orders so2
--         WHERE so2.account_no IS NOT NULL
--           AND TRIM(so2.account_no) <> ''
--           AND LOWER(TRIM(COALESCE(so2.concern, ''))) IN ('pullout', 'for pullout')
--     ) AS r
--     WHERE r.dupe_count > 1 AND r.rn > 1
-- ) AS extra ON extra.id = so.id
-- SET so.support_status  = 'Cancelled',
--     so.visit_status    = 'Cancelled',
--     so.support_remarks = CONCAT(COALESCE(so.support_remarks, ''),
--                                 ' [duplicate pullout, superseded]'),
--     so.updated_by_user = 'dedupe-script',
--     so.updated_at      = NOW();
--
-- -- Check the affected row count against section 3 before deciding:
-- -- ROLLBACK;
-- -- COMMIT;
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- Variant: MonitorController also treats a service order as a pullout when
-- concern_remarks mentions one. To catch those too, swap every
--
--     LOWER(TRIM(COALESCE(concern, ''))) IN ('pullout', 'for pullout')
--
-- for
--
--     (LOWER(TRIM(COALESCE(concern, ''))) IN ('pullout', 'for pullout')
--      OR LOWER(COALESCE(concern_remarks, '')) LIKE '%pullout%')
--
-- That widens the net and will pick up notes that merely mention a pullout, so
-- read the results before acting on them.
-- ---------------------------------------------------------------------------
