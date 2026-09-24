/**
 * Shared option lists and value normalisation for the VIP / VAT Type / Generation Type /
 * Prepaid Expiration filters.
 *
 * Customers and job orders store these four attributes on different tables with different
 * column names and casings, and the funnel filters compare values as lowercased strings.
 * Keeping the derivation here means the customer filter and the job order filter cannot
 * drift apart, and that what the filter matches is exactly what the details panels display.
 */

export const VIP_OPTIONS = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' }
];

export const VAT_TYPE_OPTIONS = [
  { label: 'VAT Included', value: 'VAT Included' },
  { label: 'VAT Excluded', value: 'VAT Excluded' },
  { label: 'No VAT', value: 'No VAT' }
];

export const GENERATION_TYPE_OPTIONS = [
  { label: 'Prepaid', value: 'Prepaid' },
  { label: 'Postpaid', value: 'Postpaid' }
];

/**
 * Generation type is written inconsistently across the system — 'Prepaid', 'Pre Paid',
 * 'PRE-PAID' all occur — so compare on letters alone, the same test TransactionFormModal
 * uses to decide whether an account is prepaid.
 */
const lettersOnly = (value: unknown): string =>
  String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');

export const normalizeGenerationType = (value: unknown): 'Prepaid' | 'Postpaid' | '' => {
  const letters = lettersOnly(value);
  if (letters === 'prepaid') return 'Prepaid';
  if (letters === 'postpaid') return 'Postpaid';
  return '';
};

export const isPrepaidGeneration = (value: unknown): boolean =>
  normalizeGenerationType(value) === 'Prepaid';

/**
 * The VAT label a record displays, matching CustomerDetails.vatType and JobOrderDetails.vatType
 * exactly: the boolean is authoritative, and the legacy free-text column is only consulted for
 * records created before vat_enabled existed. Filtering on the derived label rather than on the
 * raw column keeps the filter honest — a row matches the option the UI shows for it.
 */
export const deriveVatTypeLabel = (
  vatEnabled: boolean | null | undefined,
  legacyVatType?: string | null
): 'VAT Included' | 'VAT Excluded' | 'No VAT' | '' => {
  if (typeof vatEnabled === 'boolean') {
    return vatEnabled ? 'VAT Included' : 'No VAT';
  }

  const legacy = lettersOnly(legacyVatType);
  if (!legacy) return '';
  if (legacy.includes('excluded')) return 'VAT Excluded';
  if (legacy.includes('included')) return 'VAT Included';
  if (legacy.includes('novat')) return 'No VAT';
  return '';
};

/**
 * Job orders carry an explicit vip_enabled boolean. Customers have no such column — a customer
 * is VIP when their billing status is VIP (status id 7), which is what CheckVipExpiration acts
 * on. Both collapse to the same Yes/No the filter offers.
 */
export const deriveVipLabel = (isVip: boolean | null | undefined): 'Yes' | 'No' =>
  isVip === true ? 'Yes' : 'No';

/** Billing status id for VIP, per the billing_status table. */
export const VIP_BILLING_STATUS_ID = 7;
