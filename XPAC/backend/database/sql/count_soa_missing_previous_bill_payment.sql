-- ---------------------------------------------------------------------------
-- How many SOAs lost the previous-bill payment, and which ones
--
-- Affected = a statement whose "Payment Received From Previous Bill" AND
-- "Remaining Balance From Previous Bill" are both blank/zero, even though an
-- approved payment exists inside the cycle that statement reports on.
--
-- The cycle is: after the previous statement's day, through this statement's
-- day -- the same window the fixed
-- app/Services/EnhancedBillingGenerationServiceWithNotifications.php now uses.
--
-- Read-only. MySQL 8.0+ (LAG).
-- ---------------------------------------------------------------------------


-- 1. THE NUMBERS
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
),
priced AS (
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
        ) AS payment_missed
    FROM soa
)
SELECT
    COUNT(*)                             AS affected_soa_count,
    COUNT(DISTINCT account_no)           AS affected_accounts,
    MIN(DATE(statement_date))            AS earliest_statement,
    MAX(DATE(statement_date))            AS latest_statement,
    ROUND(SUM(payment_missed), 2)        AS total_unreported_payments
FROM priced
WHERE COALESCE(payment_received_previous, 0) = 0
  AND COALESCE(remaining_balance_previous, 0) = 0
  AND payment_missed > 0;


-- 2. THE LIST
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
),
priced AS (
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
        ) AS payment_missed
    FROM soa
)
SELECT
    id AS soa_id,
    account_no,
    DATE(statement_date)          AS statement_date,
    payment_received_previous     AS shown_payment,
    remaining_balance_previous    AS shown_remaining,
    ROUND(payment_missed, 2)      AS should_have_shown,
    total_amount_due
FROM priced
WHERE COALESCE(payment_received_previous, 0) = 0
  AND COALESCE(remaining_balance_previous, 0) = 0
  AND payment_missed > 0
ORDER BY statement_date DESC, account_no;
