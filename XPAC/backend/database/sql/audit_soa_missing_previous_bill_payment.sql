-- ---------------------------------------------------------------------------
-- SOA rows missing the previous-bill payment
--
-- Finds statements where BOTH
--     payment_received_previous   (Payment Received From Previous Bill)
--     remaining_balance_previous  (Remaining Balance From Previous Bill)
-- are blank/zero, even though money was actually collected for that cycle --
-- either the previous invoice carries invoices.received_payment > 0, or there
-- are approved transactions inside the cycle.
--
-- These are the rows produced by the two bugs in
-- app/Services/EnhancedBillingGenerationServiceWithNotifications.php:
--   1. calculatePaymentReceived() looked only at the CALENDAR MONTH before the
--      statement date. A bill dated the 25th falls due after month end, so the
--      payment lands in the same calendar month as the NEXT statement and fell
--      outside the window -> 0.00.
--   2. getPreviousBalance() returned account_balance, which is already net of
--      payments, so remaining = balance - payment subtracted the payment twice.
--
-- The cycle window used here is the one the fixed code uses:
--     after the previous statement's day, through the end of this statement's day
-- with a one-month fallback for an account's first statement.
--
-- Transaction filter matches TransactionController::approve -- every approved
-- type except Security Deposit moves account_balance, so every other type counts.
--
-- Read-only. Section 5 is a commented-out backfill.
-- Requires MySQL 8.0+ (LAG window function).
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. THE AFFECTED ROWS -- one row per statement that lost its payment figure.
--    Start here.
-- ---------------------------------------------------------------------------
WITH soa AS (
    SELECT
        s.id,
        s.organization_id,
        s.account_no,
        s.statement_date,
        s.balance_from_previous_bill,
        s.payment_received_previous,
        s.remaining_balance_previous,
        s.amount_due,
        s.total_amount_due,
        s.created_at,
        LAG(s.statement_date) OVER (
            PARTITION BY s.account_no
            ORDER BY s.statement_date, s.id
        ) AS prev_statement_date
    FROM statement_of_accounts s
    WHERE s.statement_date IS NOT NULL
),
checked AS (
    SELECT
        soa.*,
        -- Start of the cycle this statement reports on (exclusive of the previous
        -- statement's own day). First statement ever: fall back one month.
        COALESCE(
            DATE_ADD(DATE(soa.prev_statement_date), INTERVAL 1 DAY),
            DATE(DATE_SUB(soa.statement_date, INTERVAL 1 MONTH))
        ) AS cycle_start,
        DATE(soa.statement_date) AS cycle_end,

        -- What the fixed calculatePaymentReceived() would have written.
        (
            SELECT COALESCE(SUM(t.received_payment), 0)
            FROM transactions t
            WHERE t.account_no = soa.account_no
              AND t.status = 'Done'
              AND LOWER(TRIM(COALESCE(t.transaction_type, ''))) <> 'security deposit'
              AND t.payment_date IS NOT NULL
              AND DATE(t.payment_date) >= COALESCE(
                      DATE_ADD(DATE(soa.prev_statement_date), INTERVAL 1 DAY),
                      DATE(DATE_SUB(soa.statement_date, INTERVAL 1 MONTH))
                  )
              AND DATE(t.payment_date) <= DATE(soa.statement_date)
        ) AS txn_paid_in_cycle,

        -- The bill this statement is reporting on: the last invoice dated before it.
        (
            SELECT i.id
            FROM invoices i
            WHERE i.account_no = soa.account_no
              AND i.invoice_date IS NOT NULL
              AND DATE(i.invoice_date) < DATE(soa.statement_date)
            ORDER BY i.invoice_date DESC, i.id DESC
            LIMIT 1
        ) AS prev_invoice_id
    FROM soa
),
joined AS (
    SELECT
        c.*,
        pi.invoice_date     AS prev_invoice_date,
        pi.total_amount     AS prev_invoice_total,
        pi.received_payment AS prev_invoice_received,
        pi.status           AS prev_invoice_status
    FROM checked c
    LEFT JOIN invoices pi ON pi.id = c.prev_invoice_id
)
SELECT
    j.id AS soa_id,
    j.organization_id,
    j.account_no,
    DATE(j.statement_date)      AS statement_date,
    DATE(j.prev_statement_date) AS prev_statement_date,
    j.cycle_start,
    j.cycle_end,

    -- What the SOA says
    j.balance_from_previous_bill,
    j.payment_received_previous,
    j.remaining_balance_previous,
    j.total_amount_due,

    -- What was actually collected
    j.prev_invoice_id,
    DATE(j.prev_invoice_date) AS prev_invoice_date,
    j.prev_invoice_total,
    j.prev_invoice_received,
    j.prev_invoice_status,
    j.txn_paid_in_cycle,

    -- What the fixed code would write instead
    ROUND(j.txn_paid_in_cycle, 2)                        AS should_be_payment_received,
    ROUND(j.total_amount_due + j.txn_paid_in_cycle, 2)   AS should_be_total_amount_due,

    CASE
        WHEN j.txn_paid_in_cycle > 0 AND COALESCE(j.prev_invoice_received, 0) > 0
            THEN 'payment in cycle AND on invoice -- SOA missed it'
        WHEN j.txn_paid_in_cycle > 0
            THEN 'approved payment inside the cycle -- SOA missed it'
        ELSE 'invoice shows a payment, but none dated inside this cycle'
    END AS diagnosis
FROM joined j
WHERE COALESCE(j.payment_received_previous, 0) = 0
  AND COALESCE(j.remaining_balance_previous, 0) = 0
  AND (COALESCE(j.prev_invoice_received, 0) > 0 OR j.txn_paid_in_cycle > 0)
  -- Narrow the window when the table is large:
  -- AND j.statement_date >= '2026-01-01'
  -- AND j.account_no = '20220000005'
ORDER BY j.account_no, j.statement_date;


-- ---------------------------------------------------------------------------
-- 2. PER-ACCOUNT SUMMARY -- how many statements each account lost, and how much
--    money went unreported. Use this to size the problem before backfilling.
-- ---------------------------------------------------------------------------
WITH soa AS (
    SELECT
        s.id,
        s.account_no,
        s.statement_date,
        s.payment_received_previous,
        s.remaining_balance_previous,
        LAG(s.statement_date) OVER (
            PARTITION BY s.account_no
            ORDER BY s.statement_date, s.id
        ) AS prev_statement_date
    FROM statement_of_accounts s
    WHERE s.statement_date IS NOT NULL
),
checked AS (
    SELECT
        soa.*,
        (
            SELECT COALESCE(SUM(t.received_payment), 0)
            FROM transactions t
            WHERE t.account_no = soa.account_no
              AND t.status = 'Done'
              AND LOWER(TRIM(COALESCE(t.transaction_type, ''))) <> 'security deposit'
              AND t.payment_date IS NOT NULL
              AND DATE(t.payment_date) >= COALESCE(
                      DATE_ADD(DATE(soa.prev_statement_date), INTERVAL 1 DAY),
                      DATE(DATE_SUB(soa.statement_date, INTERVAL 1 MONTH))
                  )
              AND DATE(t.payment_date) <= DATE(soa.statement_date)
        ) AS txn_paid_in_cycle
    FROM soa
)
SELECT
    account_no,
    COUNT(*)                                  AS affected_statements,
    MIN(DATE(statement_date))                 AS first_affected,
    MAX(DATE(statement_date))                 AS last_affected,
    ROUND(SUM(txn_paid_in_cycle), 2)          AS unreported_payments,
    GROUP_CONCAT(id ORDER BY statement_date)  AS soa_ids
FROM checked
WHERE COALESCE(payment_received_previous, 0) = 0
  AND COALESCE(remaining_balance_previous, 0) = 0
  AND txn_paid_in_cycle > 0
GROUP BY account_no
ORDER BY unreported_payments DESC, affected_statements DESC;


-- ---------------------------------------------------------------------------
-- 3. LOOSER VARIANT -- payment_received_previous alone is blank/zero, whatever
--    remaining_balance_previous says.
--
--    Section 1 requires both columns to be empty, which is the exact symptom
--    reported. This one also catches statements where the remaining balance
--    happens to be non-zero but the payment still went unrecorded.
-- ---------------------------------------------------------------------------
WITH soa AS (
    SELECT
        s.id,
        s.account_no,
        s.statement_date,
        s.balance_from_previous_bill,
        s.payment_received_previous,
        s.remaining_balance_previous,
        s.total_amount_due,
        LAG(s.statement_date) OVER (
            PARTITION BY s.account_no
            ORDER BY s.statement_date, s.id
        ) AS prev_statement_date
    FROM statement_of_accounts s
    WHERE s.statement_date IS NOT NULL
)
, priced AS (
    SELECT
        soa.*,
        (
            SELECT COALESCE(SUM(t.received_payment), 0)
            FROM transactions t
            WHERE t.account_no = soa.account_no
              AND t.status = 'Done'
              AND LOWER(TRIM(COALESCE(t.transaction_type, ''))) <> 'security deposit'
              AND t.payment_date IS NOT NULL
              AND DATE(t.payment_date) >= COALESCE(
                      DATE_ADD(DATE(soa.prev_statement_date), INTERVAL 1 DAY),
                      DATE(DATE_SUB(soa.statement_date, INTERVAL 1 MONTH))
                  )
              AND DATE(t.payment_date) <= DATE(soa.statement_date)
        ) AS txn_paid_in_cycle
    FROM soa
)
SELECT
    id AS soa_id,
    account_no,
    DATE(statement_date)      AS statement_date,
    DATE(prev_statement_date) AS prev_statement_date,
    balance_from_previous_bill,
    payment_received_previous,
    remaining_balance_previous,
    total_amount_due,
    ROUND(txn_paid_in_cycle, 2) AS should_be_payment_received
FROM priced
WHERE COALESCE(payment_received_previous, 0) = 0
  AND txn_paid_in_cycle > 0
ORDER BY account_no, statement_date;


-- ---------------------------------------------------------------------------
-- 4. RECONCILIATION CHECK -- the three columns must satisfy
--        balance_from_previous_bill - payment_received_previous
--            = remaining_balance_previous
--
--    Any row failing this was written by the double-subtraction bug, or by an
--    older generation service. No transaction lookup needed: it is pure
--    arithmetic on the statement itself.
-- ---------------------------------------------------------------------------
SELECT
    id AS soa_id,
    organization_id,
    account_no,
    DATE(statement_date) AS statement_date,
    balance_from_previous_bill,
    payment_received_previous,
    remaining_balance_previous,
    ROUND(COALESCE(balance_from_previous_bill, 0)
          - COALESCE(payment_received_previous, 0), 2) AS remaining_should_be,
    ROUND(COALESCE(remaining_balance_previous, 0)
          - (COALESCE(balance_from_previous_bill, 0)
             - COALESCE(payment_received_previous, 0)), 2) AS discrepancy,
    total_amount_due,
    created_at
FROM statement_of_accounts
WHERE statement_date IS NOT NULL
  AND ABS(
        COALESCE(remaining_balance_previous, 0)
        - (COALESCE(balance_from_previous_bill, 0) - COALESCE(payment_received_previous, 0))
      ) > 0.01
ORDER BY ABS(
        COALESCE(remaining_balance_previous, 0)
        - (COALESCE(balance_from_previous_bill, 0) - COALESCE(payment_received_previous, 0))
      ) DESC,
    account_no,
    statement_date;


-- ---------------------------------------------------------------------------
-- 5. BACKFILL -- intentionally commented out.
--
--    Rewrites the three previous-bill columns on the affected statements using
--    the cycle window, the same way the fixed service now does:
--        payment_received_previous  = payments approved inside the cycle
--        balance_from_previous_bill = remaining + payment  (pre-payment figure)
--        remaining_balance_previous = the balance already stored, unchanged
--
--    total_amount_due is deliberately NOT touched. Those statements were already
--    issued to customers and, for arrears accounts, restating the total changes
--    what was billed -- decide that separately, per account.
--
--    Any statement whose PDF is already on Google Drive (print_link) keeps a
--    stale PDF: the file has to be regenerated for the numbers to match.
--
--    Review sections 1 and 2, back up statement_of_accounts, then run in a
--    transaction.
-- ---------------------------------------------------------------------------
-- START TRANSACTION;
--
-- UPDATE statement_of_accounts s
-- JOIN (
--     SELECT
--         w.id,
--         (
--             SELECT COALESCE(SUM(t.received_payment), 0)
--             FROM transactions t
--             WHERE t.account_no = w.account_no
--               AND t.status = 'Done'
--               AND LOWER(TRIM(COALESCE(t.transaction_type, ''))) <> 'security deposit'
--               AND t.payment_date IS NOT NULL
--               AND DATE(t.payment_date) >= COALESCE(
--                       DATE_ADD(DATE(w.prev_date), INTERVAL 1 DAY),
--                       DATE(DATE_SUB(w.statement_date, INTERVAL 1 MONTH))
--                   )
--               AND DATE(t.payment_date) <= DATE(w.statement_date)
--         ) AS paid
--     FROM (
--         SELECT
--             s2.id,
--             s2.account_no,
--             s2.statement_date,
--             LAG(s2.statement_date) OVER (
--                 PARTITION BY s2.account_no
--                 ORDER BY s2.statement_date, s2.id
--             ) AS prev_date
--         FROM statement_of_accounts s2
--         WHERE s2.statement_date IS NOT NULL
--     ) AS w
-- ) AS fix ON fix.id = s.id
-- SET s.payment_received_previous  = ROUND(fix.paid, 2),
--     s.balance_from_previous_bill = ROUND(COALESCE(s.remaining_balance_previous, 0) + fix.paid, 2),
--     s.updated_by                 = 'soa-payment-backfill',
--     s.updated_at                 = NOW()
-- WHERE COALESCE(s.payment_received_previous, 0) = 0
--   AND fix.paid > 0;
--
-- -- Compare the affected row count with section 2 before deciding:
-- -- ROLLBACK;
-- -- COMMIT;
-- ---------------------------------------------------------------------------
