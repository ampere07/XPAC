-- ============================================================================
-- Build LCP-NAP rows from the lcp and nap tables: every LCP x every NAP.
--
-- Each new row matches what the app's "Add LCP-NAP" form creates:
--   lcpnap_name = '<LCP name> <NAP name>'   (e.g. 'LCP01 NAP03')
--   lcp / nap   = the LCP and NAP names
--   port_total  = 16
--
-- Safe to run more than once:
--   * an LCP-NAP whose name already exists is skipped, never changed;
--   * existing rows (with their photos, coordinates, ports) are not touched;
--   * nothing is deleted.
-- An LCP is only paired with a NAP of the same organization (or both with none).
--
-- Run STEP 1 first and check the numbers, then run STEP 2.
-- ============================================================================


-- STEP 1 — PREVIEW (read only) ----------------------------------------------

-- How many LCPs, NAPs, and existing LCP-NAP rows there are now.
SELECT
    (SELECT COUNT(*) FROM lcp)    AS lcp_count,
    (SELECT COUNT(*) FROM nap)    AS nap_count,
    (SELECT COUNT(*) FROM lcpnap) AS lcpnap_rows_now;

-- How many rows STEP 2 will add.
SELECT COUNT(DISTINCT CONCAT(TRIM(l.lcp_name), ' ', TRIM(n.nap_name))) AS rows_to_add
FROM lcp l
JOIN nap n ON l.organization_id <=> n.organization_id
WHERE TRIM(l.lcp_name) <> '' AND TRIM(n.nap_name) <> ''
  AND CHAR_LENGTH(CONCAT(TRIM(l.lcp_name), ' ', TRIM(n.nap_name))) <= 255
  AND NOT EXISTS (
      SELECT 1 FROM lcpnap x
      WHERE x.lcpnap_name = CONCAT(TRIM(l.lcp_name), ' ', TRIM(n.nap_name))
  );

-- First 20 rows STEP 2 will add.
SELECT CONCAT(TRIM(l.lcp_name), ' ', TRIM(n.nap_name)) AS lcpnap_name,
       TRIM(l.lcp_name) AS lcp, TRIM(n.nap_name) AS nap, l.organization_id
FROM lcp l
JOIN nap n ON l.organization_id <=> n.organization_id
WHERE TRIM(l.lcp_name) <> '' AND TRIM(n.nap_name) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM lcpnap x
      WHERE x.lcpnap_name = CONCAT(TRIM(l.lcp_name), ' ', TRIM(n.nap_name))
  )
ORDER BY l.lcp_name, n.nap_name
LIMIT 20;


-- STEP 2 — INSERT ------------------------------------------------------------

START TRANSACTION;

-- INSERT IGNORE also skips the rare case where two different LCP/NAP pairs
-- produce the same name (lcpnap_name is unique), instead of failing the batch.
INSERT IGNORE INTO lcpnap (organization_id, lcpnap_name, lcp, nap, port_total, modified_by, modified_date)
SELECT
    l.organization_id,
    CONCAT(TRIM(l.lcp_name), ' ', TRIM(n.nap_name)),
    TRIM(l.lcp_name),
    TRIM(n.nap_name),
    16,
    'LCP x NAP import 2026-09-30',
    NOW()
FROM lcp l
JOIN nap n ON l.organization_id <=> n.organization_id
WHERE TRIM(l.lcp_name) <> '' AND TRIM(n.nap_name) <> ''
  AND CHAR_LENGTH(CONCAT(TRIM(l.lcp_name), ' ', TRIM(n.nap_name))) <= 255
  AND NOT EXISTS (
      SELECT 1 FROM lcpnap x
      WHERE x.lcpnap_name = CONCAT(TRIM(l.lcp_name), ' ', TRIM(n.nap_name))
  )
ORDER BY l.lcp_name, n.nap_name;

SELECT ROW_COUNT() AS rows_added;

COMMIT;


-- UNDO (only if needed) -------------------------------------------------------
-- Removes exactly the rows this script added; rows created in the app are untouched.
-- Do not run this after customers or job orders have been assigned to the new rows.
--
-- DELETE FROM lcpnap WHERE modified_by = 'LCP x NAP import 2026-09-30';
