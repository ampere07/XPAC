/**
 * Billing-type (generation_type) resolution for the client portal.
 *
 * The backend stores this on `billing_accounts.generation_type` and accepts several spellings
 * ('Prepaid', 'PrePaid', 'Pre Paid'). This module is the single client-side mirror of
 * BillingAccount::isPrepaidType() — letters-only, lower-cased comparison — so an account that has
 * not been through the rename still resolves correctly.
 *
 * Every screen that needs to branch on prepaid/postpaid MUST go through here rather than
 * re-deriving the comparison, so the rule can never drift between screens or from the server.
 */

export type BillingType = 'Prepaid' | 'Postpaid';

/** Strip everything but letters and lower-case, so 'Pre Paid' and 'PREPAID' both collapse. */
const canonicalize = (raw?: string | null): string =>
    String(raw ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** Mirrors BillingAccount::isPrepaidType(). */
export const isPrepaidGenerationType = (raw?: string | null): boolean =>
    canonicalize(raw) === 'prepaid';

/**
 * The label shown to the customer.
 *
 * Anything that is not recognisably prepaid reads as 'Postpaid' — that is the system's original
 * and still-default account type, so an account with a blank/legacy generation_type keeps the
 * postpaid experience rather than being shown an empty field.
 */
export const resolveBillingType = (raw?: string | null): BillingType =>
    isPrepaidGenerationType(raw) ? 'Prepaid' : 'Postpaid';
