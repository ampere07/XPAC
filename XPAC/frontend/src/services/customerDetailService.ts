import apiClient from '../config/api';
import { reportClientEvent } from './clientLogService';
import { BillingDetailRecord } from '../types/billing';
import { accountStatusFrom, sessionStatusFrom } from '../utils/onlineStatus';

export interface CustomerDetailData {
  id: number;
  firstName: string;
  middleInitial?: string;
  lastName: string;
  fullName: string;
  emailAddress?: string;
  contactNumberPrimary: string;
  contactNumberSecondary?: string;
  address: string;
  barangay?: string;
  city?: string;
  region?: string;
  addressCoordinates?: string;
  housingStatus?: string;
  referredBy?: string;
  referredByAgentId?: number | null;
  desiredPlan?: string;
  houseFrontPictureUrl?: string;
  proofOfBillingUrl?: string;
  governmentValidIdUrl?: string;
  secondGovernmentValidIdUrl?: string;
  documentAttachmentUrl?: string;
  otherIspBillUrl?: string;
  accountNoCustomer?: string;
  updatedBy?: string;
  groupId?: number;
  groupName?: string;

  billingAccount?: {
    id: number;
    accountNo: string;
    dateInstalled?: string;
    billingDay: number;
    billingStatusId: number;
    billingStatusName?: string;
    accountBalance: number;
    balanceUpdateDate?: string;
    createdAt?: string;
    createdBy?: string;
    updatedAt?: string;
    updatedBy?: string;
    vip_expiration?: string;
    vip_remarks?: string;
    vat_type?: string;
    vat_enabled?: boolean | null;
    withholding_enabled?: boolean | null;
    withholding_percentage?: number | string | null;
  };

  technicalDetails?: {
    id: number;
    username?: string;
    usernameStatus?: string;
    connectionType?: string;
    routerModel?: string;
    routerModemSn?: string;
    ipAddress?: string;
    lcp?: string;
    nap?: string;
    port?: string;
    vlan?: string;
    lcpnap?: string;
    usageTypeId?: number;
    usageType?: string;
    createdAt?: string;
    createdBy?: string;
    updatedAt?: string;
    updatedBy?: string;
  };

  createdAt?: string;
  updatedAt?: string;
  onlineSessionStatus?: string;
  session_group?: string;
  session_ip?: string;
  onlineStatusData?: any;
}

interface CustomerDetailApiResponse {
  success: boolean;
  data?: CustomerDetailData;
  message?: string;
}

/**
 * The fuller payload: profile, plan, technical details, and the balance as a
 * fallback for when the pay-summary request has failed.
 *
 * A longer leash than the balance request — four eager-loaded relations and two
 * payment SUMs is genuinely more work than reading one row, so a few seconds
 * here is slow rather than stalled. Still well short of apiClient's 60s default,
 * which is long enough that a hung request looks to the customer like a page
 * that simply never loads.
 */
const CUSTOMER_DETAIL_TIMEOUT_MS = 20000;

export const getCustomerDetail = async (accountNo: string): Promise<CustomerDetailData | null> => {
  // Two attempts. The dashboard can render its most important half without this
  // — the balance and Pay Now come from the pay-summary — so a failure here is
  // survivable, but it costs the customer their plan, install date and location,
  // and a second try is cheap enough to be worth it.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await apiClient.get<CustomerDetailApiResponse>(
        `/customer-detail/${accountNo}`,
        { timeout: CUSTOMER_DETAIL_TIMEOUT_MS }
      );

      if (response.data?.success && response.data?.data) {
        if (attempt > 1) {
          console.info('[CustomerDetail] Recovered on attempt', attempt);
        }
        return response.data.data;
      }

      console.warn('[CustomerDetail] Response carried no data', {
        accountNo,
        attempt,
        success: response.data?.success,
      });
    } catch (error: any) {
      console.error('[CustomerDetail] Request failed', {
        accountNo,
        attempt,
        status: error?.response?.status ?? null,
        message: error?.response?.data?.message || error?.message || 'unknown',
      });
    }

    if (attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  return null;
};

/**
 * Everything the customer dashboard's balance card and Pay Now button need, and nothing
 * else. Three indexed single-row reads on the server against getCustomerDetail's four
 * eager-loaded relations and two payment SUMs, so the amount due no longer queues behind
 * data that belongs to other parts of the app.
 */
export interface CustomerPaySummary {
  accountNo: string;
  accountBalance: number;
  balanceUpdateDate: string | null;
  billingDay: number | null;
  dueDate: string | null;
  /**
   * Whether a payment is already in progress, which is all the button label needs. The
   * payment URL is deliberately not part of this response — Pay Now re-checks and gets
   * it on click, so a live payment link is not handed out just to render a label.
   */
  hasPendingPayment: boolean;
}

interface CustomerPaySummaryApiResponse {
  success: boolean;
  data?: CustomerPaySummary;
  message?: string;
}

/**
 * Null on any failure, matching getCustomerDetail: the caller falls back to the balance
 * carried on the full detail payload, so losing the fast path costs speed rather than
 * the ability to pay.
 */
/**
 * The balance's leash, lengthening with each attempt.
 *
 * apiClient's default timeout is 60 seconds. That is a sensible ceiling for a
 * report and a terrible one here: this endpoint reads a single row, so a
 * request still unanswered after a few seconds on a healthy connection has
 * stalled rather than gone slow, and the customer spends a minute watching a
 * shimmer.
 *
 * But a flat short leash cannot tell those two apart. Every attempt capped at
 * 8s meant a genuinely slow connection — where the request needed twelve
 * seconds and would have succeeded — was cut off three times over, and the card
 * gave up on a server that was answering perfectly well. The balance is the one
 * figure the page exists to show, so it is the last thing that should be
 * abandoned for being slow.
 *
 * The ladder keeps both properties. The first attempt is short, so a stalled
 * request is spotted and retried in seconds rather than after a minute. Each
 * one after it is longer, so a slow line is given the room it actually needs
 * instead of being asked the same impossible question three times.
 */
export const PAY_SUMMARY_TIMEOUTS_MS = [8000, 20000, 45000];

export const getCustomerPaySummary = async (
  accountNo: string,
  timeoutMs: number = PAY_SUMMARY_TIMEOUTS_MS[0]
): Promise<CustomerPaySummary | null> => {
  try {
    const response = await apiClient.get<CustomerPaySummaryApiResponse>(
      `/customer-detail/${accountNo}/pay-summary`,
      { timeout: timeoutMs }
    );

    if (response.data?.success && response.data?.data) {
      return response.data.data;
    }

    // A 200 that carries nothing usable. Worth saying so: this returns the same
    // null a thrown request does, and the dashboard then shows "Balance
    // unavailable" with no way to tell the two apart from the outside.
    console.warn('[PaySummary] Response carried no data', {
      accountNo,
      success: response.data?.success,
      hasData: !!response.data?.data,
    });

    // Reported as well as logged. A console line is only readable by somebody
    // with DevTools open on the device it happened to, which is never the
    // customer this is failing for.
    reportClientEvent('pay-summary-empty', {
      accountNo,
      success: String(response.data?.success),
      hasData: String(!!response.data?.data),
    });

    return null;
  } catch (error: any) {
    // Swallowed for the caller's sake — the dashboard falls back to the fuller
    // detail request — but never silently. A transient failure here is the
    // difference between a balance and "Balance unavailable", so the reason has
    // to be readable when somebody comes to ask why.
    console.error('[PaySummary] Request failed', {
      accountNo,
      timeoutMs,
      status: error?.response?.status ?? null,
      message: error?.response?.data?.message || error?.message || 'unknown',
    });

    // `code` matters as much as `status` here: axios reports a timeout as
    // ECONNABORTED with no status at all, which is precisely the case that
    // cannot be told apart from a network drop without it.
    reportClientEvent('pay-summary-failed', {
      accountNo,
      timeoutMs,
      status: error?.response?.status ?? 'none',
      code: error?.code ?? 'none',
      message: error?.response?.data?.message || error?.message || 'unknown',
    });

    return null;
  }
};

/**
 * The single mapping from a customer-detail payload to the record CustomerDetails renders.
 *
 * This lived as sixteen near-copies - one in every screen that can open the panel through
 * the arrow beside Account No. - and they drifted. The stale copies read the subscriber's
 * IP only from `technicalDetails.ipAddress`, which is null for every dynamic-PPPoE line,
 * and omitted `session_group` altogether: the panel opened from Service Orders,
 * Transactions, Invoices or SOA showed a blank IP and no session group, while the same
 * panel opened from Billing > Customer showed both. Exported from here so there is one
 * mapping to fix rather than sixteen to keep in step.
 *
 * `session_ip` (from `online_status.ip_address`) is the live RADIUS address and wins;
 * `technicalDetails.ipAddress` is the statically provisioned one and is the fallback.
 */
export const convertCustomerDataToBillingDetail = (customerData: CustomerDetailData): BillingDetailRecord => {
  return {
    id: customerData.billingAccount?.accountNo || '',
    applicationId: customerData.billingAccount?.accountNo || '',
    customerName: customerData.fullName,
    firstName: customerData.firstName,
    middleInitial: customerData.middleInitial,
    lastName: customerData.lastName,
    address: customerData.address,
    // Billing status and session status are separate facts and are resolved separately -
    // several of the old copies derived both from `billingStatusId`, and three of them
    // compared it against 2 (Blacklisted) rather than 1 (Active).
    status: accountStatusFrom(customerData),
    balance: customerData.billingAccount?.accountBalance || 0,
    onlineStatus: sessionStatusFrom(customerData),
    cityId: null,
    regionId: null,
    timestamp: customerData.updatedAt || '',
    billingStatus: customerData.billingAccount?.billingStatusName || (customerData.billingAccount?.billingStatusId ? `Status ${customerData.billingAccount.billingStatusId}` : ''),
    billing_status_id: customerData.billingAccount?.billingStatusId,
    dateInstalled: customerData.billingAccount?.dateInstalled || '',
    contactNumber: customerData.contactNumberPrimary,
    secondContactNumber: customerData.contactNumberSecondary || '',
    emailAddress: customerData.emailAddress || '',
    plan: customerData.desiredPlan || '',
    username: customerData.technicalDetails?.username || '',
    // Sourced from the account's job order by CustomerDetailController when technical_details
    // has none - PPPoE credentials were not backfilled onto that table.
    pppoePassword: (customerData.technicalDetails as any)?.pppoePassword || (customerData as any).pppoePassword || '',
    connectionType: customerData.technicalDetails?.connectionType || '',
    routerModel: customerData.technicalDetails?.routerModel || '',
    routerModemSN: customerData.technicalDetails?.routerModemSn || '',
    lcpnap: customerData.technicalDetails?.lcpnap || '',
    port: customerData.technicalDetails?.port || '',
    vlan: customerData.technicalDetails?.vlan || '',
    billingDay: customerData.billingAccount?.billingDay || 0,
    totalPaid: (customerData as any).totalPaid || (customerData as any).total_paid || 0,
    provider: customerData.groupName || '',
    lcp: customerData.technicalDetails?.lcp || '',
    nap: customerData.technicalDetails?.nap || '',
    modifiedBy: (customerData.billingAccount as any)?.updatedBy || '',
    modifiedDate: customerData.updatedAt || '',
    barangay: customerData.barangay || '',
    city: customerData.city || '',
    region: customerData.region || '',

    usageType: customerData.technicalDetails?.usageType || '',
    referredBy: customerData.referredBy || '',
    referredByAgentId: customerData.referredByAgentId ?? null,
    referralContactNo: '',
    groupName: customerData.groupName || '',
    mikrotikId: '',
    houseFrontPicture: customerData.houseFrontPictureUrl || '',
    accountBalance: customerData.billingAccount?.accountBalance || 0,
    housingStatus: customerData.housingStatus || '',
    addressCoordinates: customerData.addressCoordinates || '',
    lcpnapport: `${customerData.technicalDetails?.lcpnap || ''} ${customerData.technicalDetails?.port || ''}`.trim(),
    balanceUpdateDate: customerData.billingAccount?.balanceUpdateDate || '',
    billingAccountCreatedBy: customerData.billingAccount?.createdBy || '',
    billingAccountCreatedAt: customerData.billingAccount?.createdAt || '',
    billingAccountUpdatedBy: customerData.billingAccount?.updatedBy || '',
    billingAccountUpdatedAt: customerData.billingAccount?.updatedAt || '',
    proofOfBillingUrl: customerData.proofOfBillingUrl || '',
    governmentValidIdUrl: customerData.governmentValidIdUrl || '',
    secondGovernmentValidIdUrl: customerData.secondGovernmentValidIdUrl || '',
    documentAttachmentUrl: customerData.documentAttachmentUrl || '',
    otherIspBillUrl: customerData.otherIspBillUrl || '',
    houseFrontPictureUrl: customerData.houseFrontPictureUrl || '',
    accountNoCustomer: customerData.accountNoCustomer || '',
    customerUpdatedBy: customerData.updatedBy || '',
    customerUpdatedAt: customerData.updatedAt || '',
    techUpdatedBy: customerData.technicalDetails?.updatedBy || '',
    techUpdatedAt: customerData.technicalDetails?.updatedAt || '',
    sessionGroup: (customerData as any).session_group || '',
    // The live RADIUS address first, the provisioned one only as a fallback. Both keys are
    // populated because the panel and its related-data overlay read different casings.
    sessionIp: (customerData as any).session_ip || customerData.technicalDetails?.ipAddress || '',
    sessionIP: (customerData as any).session_ip || customerData.technicalDetails?.ipAddress || '',
    vip_expiration: customerData.billingAccount?.vip_expiration || '',
    vip_remarks: customerData.billingAccount?.vip_remarks || '',
    vatType: customerData.billingAccount?.vat_type || '',
    // Left as null when absent rather than coerced to false, so the UI can fall back to the
    // legacy vatType text for accounts predating the boolean column.
    vatEnabled: customerData.billingAccount?.vat_enabled ?? null,
    withholdingEnabled: customerData.billingAccount?.withholding_enabled ?? null,
    withholdingPercentage: customerData.billingAccount?.withholding_percentage != null
      ? Number(customerData.billingAccount.withholding_percentage)
      : null,
  };
};
