import apiClient from '../config/api';
import { reportClientEvent } from './clientLogService';

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
  // The agent id behind referredBy, when the referral names one. Carried so an
  // edit form writes the same referral back instead of the resolved name.
  referredBy?: string;
  referredByAgentId?: number | null;
  desiredPlan?: string;
  houseFrontPictureUrl?: string;
  proof_of_billing_url?: string;
  proofOfBillingUrl?: string;
  government_valid_id_url?: string;
  governmentValidIdUrl?: string;
  second_government_valid_id_url?: string;
  secondGovernmentValidIdUrl?: string;
  document_attachment_url?: string;
  documentAttachmentUrl?: string;
  other_isp_bill_url?: string;
  otherIspBillUrl?: string;
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
  };

  createdAt?: string;
  updatedAt?: string;
  onlineSessionStatus?: string;
  onlineStatusData?: any;
}

interface CustomerDetailApiResponse {
  success: boolean;
  data?: CustomerDetailData;
  message?: string;
}

/**
 * Everything the dashboard's balance card and Pay Now button need, and nothing else.
 * Three indexed single-row reads on the server against getCustomerDetail's four
 * eager-loaded relations and two payment SUMs, so the amount due no longer queues behind
 * data that belongs to other screens.
 */
export interface CustomerPaySummary {
  accountNo: string;
  accountBalance: number;
  balanceUpdateDate: string | null;
  /** Carried so the due date can still fall back to the billing day with no invoice. */
  billingDay: number | null;
  dueDate: string | null;
  /**
   * Whether a payment is already in progress, which is all the button label needs. The
   * payment URL is deliberately not part of this response — handlePayNow re-checks and
   * gets it on tap, so a live payment link is not handed out just to render a label.
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
 * Not apiClient's 60s default: this reads a single row, so a request unanswered
 * after a few seconds on a healthy connection has stalled rather than gone slow,
 * and waiting a minute to find that out means a minute of shimmer.
 *
 * But a flat short leash cannot tell a stalled request from a slow one. Every
 * attempt capped at 8s meant a phone on a weak signal — where the request needed
 * twelve seconds and would have succeeded — was cut off three times over, and the
 * card gave up on a server that was answering. On mobile that is the common case,
 * not the edge one, and the balance is the figure the screen exists to show.
 *
 * The ladder keeps both properties: a short first attempt spots a stall in
 * seconds, and each attempt after it gives a slow line the room it actually needs.
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

    // A 200 carrying nothing usable returns the same null a failed request does,
    // and the dashboard then shows the balance as unavailable. Distinguish them
    // here or there is no way to tell from the outside which happened.
    console.warn('[PaySummary] Response carried no data', {
      accountNo,
      success: response.data?.success,
      hasData: !!response.data?.data,
    });

    // Reported as well as logged. A console line on a phone is readable by
    // nobody — least of all the customer it is failing for.
    reportClientEvent('pay-summary-empty', {
      accountNo,
      success: String(response.data?.success),
      hasData: String(!!response.data?.data),
    });

    return null;
  } catch (error: any) {
    console.error('[PaySummary] Request failed', {
      accountNo,
      timeoutMs,
      status: error?.response?.status ?? null,
      message: error?.response?.data?.message || error?.message || 'unknown',
    });

    // `code` matters as much as `status`: axios reports a timeout as
    // ECONNABORTED with no status at all, which is exactly the case that cannot
    // be told apart from a dropped connection without it.
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

export const getCustomerDetail = async (accountNo: string): Promise<CustomerDetailData | null> => {
  // Two attempts, on a 20s leash rather than apiClient's 60s default.
  //
  // This payload is heavier than the balance — four eager-loaded relations and
  // two payment SUMs — so it earns a longer wait than the 8s the pay-summary
  // gets, but 60s is long enough that a hung request reads as a page that never
  // loads. The dashboard survives losing this: the balance and Pay Now come from
  // the pay-summary. What it costs is the plan, install date and location, which
  // is worth one more try.
  // Kept across the attempts so the report below can name the status that ended
  // it. Without this the log recorded only that the detail request failed, which
  // is the one thing that does not distinguish a dead token from a dead network —
  // and an expired session presents here exactly as a flat failure would.
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await apiClient.get<CustomerDetailApiResponse>(
        `/customer-detail/${accountNo}`,
        { timeout: 20000 }
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
      lastStatus = error?.response?.status ?? null;
      console.error('[CustomerDetail] Request failed', {
        accountNo,
        attempt,
        status: lastStatus,
        message: error?.response?.data?.message || error?.message || 'unknown',
      });
    }

    if (attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  // Both attempts gone. Reported once here rather than inside the loop, so the
  // log records a customer who ended up without their details — not every
  // individual retry along the way.
  reportClientEvent('customer-detail-failed', { accountNo, attempts: 2, status: lastStatus ?? 'none' });

  return null;
};
