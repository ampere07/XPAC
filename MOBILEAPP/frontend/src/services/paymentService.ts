import apiClient from '../config/api';

// Every call here goes through the shared apiClient, so it carries the session
// cookie, Origin and XSRF token the API authenticates on. It used to call axios
// directly with `Authorization: Bearer <authData.token>` (copied from the web
// client), but authData never holds a token (Login stores it as `authToken`,
// and the server does not read it), so these requests reached the API signed
// out and worked only while the payment routes stayed open.
//
// Nothing else changed: same endpoints, bodies, return values and error
// messages. The direct calls had no timeout, and some of these wait on the
// payment gateway (creating or cancelling a checkout), where a client-side
// timeout would report failure for an action the server may still complete,
// so they keep having none rather than taking apiClient's 60 s.
const NO_TIMEOUT = { timeout: 0 };

export interface PlanChangeQuote {
  status: string;
  /** false when the account is outside the never-paid prepaid onboarding window. */
  eligible: boolean;
  reason?: string | null;
  plan?: string;
  plan_amount?: number;
  vat?: number;
  withholding?: number;
  /** The re-priced total the customer would actually be charged. */
  amount?: number;
  previous_amount?: number;
}

export interface PendingPayment {
  reference_no: string;
  payment_url: string;
  /** Gross — the bill plus the convenience fee, i.e. what the gateway will collect. */
  amount: number;
  /** Part of `amount` that is the convenience fee. 0 when none was charged. */
  convenience_fee?: number;
  status: string;
  payment_date: string;
}

export interface PaymentResponse {
  status: string;
  reference_no?: string;
  payment_url?: string;
  payment_id?: string;
  /** The amount applied to the customer's invoices — fee NOT included. */
  amount?: number;
  convenience_fee_percentage?: number;
  convenience_fee?: number;
  /** What the gateway actually collects: `amount` + `convenience_fee`. */
  total_charged?: number;
  account_balance?: number;
  message?: string;
  pending_payment?: PendingPayment;
}

export interface PaymentStatusResponse {
  status: string;
  payment?: {
    reference_no: string;
    amount: number;
    status: string;
    transaction_status: string;
    date_time: string;
  };
  message?: string;
}

export const paymentService = {
  getAccountBalance: async (accountNo: string): Promise<number> => {
    try {
      const response = await apiClient.post<{ status: string; account_balance?: number }>(
        `/payments/account-balance`,
        { account_no: accountNo },
        NO_TIMEOUT
      );

      return response.data.account_balance || 0;
    } catch (error: any) {
      console.error('Get account balance error:', error.response?.data || error.message);
      return 0;
    }
  },

  /**
   * Read-only: what an unpaid prepaid ONBOARDING bill would come to under a different plan.
   *
   * Returns eligible:false for any account outside that never-paid window — callers should then
   * keep their existing amount behaviour. The VAT/withholding maths stays server-side so the
   * client never reimplements it.
   */
  quotePlanChange: async (accountNo: string, planId: number): Promise<PlanChangeQuote | null> => {
    try {
      const response = await apiClient.post<PlanChangeQuote>(
        `/payments/quote-plan-change`,
        { account_no: accountNo, plan_id: planId },
        NO_TIMEOUT
      );

      return response.data;
    } catch (error: any) {
      // Non-fatal: the caller falls back to the plan price.
      console.error('Quote plan change error:', error.response?.data || error.message);
      return null;
    }
  },

  /**
   * The convenience fee rate added on top of an online payment, as a percentage (2.5 = 2.5%).
   *
   * Returns 0 on any failure so a payment screen never blocks on it — the server computes the
   * real charge at checkout regardless of what was disclosed here.
   */
  getConvenienceFeePercentage: async (): Promise<number> => {
    try {
      const response = await apiClient.get<{ status: string; convenience_fee_percentage?: number }>(
        `/payments/convenience-fee`,
        NO_TIMEOUT
      );

      return Number(response.data.convenience_fee_percentage) || 0;
    } catch (error: any) {
      console.error('Get convenience fee error:', error.response?.data || error.message);
      return 0;
    }
  },

  checkPendingPayment: async (accountNo: string): Promise<PendingPayment | null> => {
    try {
      const response = await apiClient.post<{ status: string; pending_payment?: PendingPayment }>(
        `/payments/check-pending`,
        { account_no: accountNo },
        NO_TIMEOUT
      );

      return response.data.pending_payment || null;
    } catch (error: any) {
      console.error('Check pending payment error:', error.response?.data || error.message);
      return null;
    }
  },

  /**
   * Create a payment link.
   *
   * `planId` is only sent by prepaid customers who picked a plan in the Pay Now modal. The
   * backend holds it on the pending payment and, once the payment settles, either queues the
   * switch for when the current prepaid period lapses or applies it immediately if the period
   * had already expired.
   *
   * `activateNow` overrides that queueing: the plan starts the moment the payment settles and the
   * days left on the current one are forfeited. Only sent alongside a planId; the backend ignores
   * it without a genuine plan switch.
   */
  createPayment: async (
    accountNo: string,
    amount: number,
    redirectUrl?: string,
    planId?: number | null,
    activateNow?: boolean
  ): Promise<PaymentResponse> => {
    try {
      console.log('Payment Service - Creating payment:', { accountNo, amount });

      if (!accountNo || accountNo.trim() === '') {
        throw new Error('Account number is missing from user session. Please log in again.');
      }

      const payload: any = {
        account_no: accountNo,
        amount: amount
      };

      if (redirectUrl) {
        payload.redirect_url = redirectUrl;
      }

      if (planId) {
        payload.plan_id = planId;
        // Only meaningful with a plan. Sent explicitly (not omitted when false) so the row records
        // a deliberate "queue it" rather than an absence the server has to guess at.
        payload.activate_now = !!activateNow;
      }

      console.log('Payment payload:', payload);

      const response = await apiClient.post<PaymentResponse>(
        `/payments/create`,
        payload,
        NO_TIMEOUT
      );

      return response.data as PaymentResponse;
    } catch (error: any) {
      console.error('Payment creation error:', error.response?.data || error.message);

      if (error.response?.data) {
        throw new Error(error.response.data.message || 'Payment creation failed');
      }
      throw new Error(error.message || 'Network error. Please check your connection.');
    }
  },

  checkPaymentStatus: async (referenceNo: string): Promise<PaymentStatusResponse> => {
    try {
      const response = await apiClient.post<PaymentStatusResponse>(
        `/payments/status`,
        {
          reference_no: referenceNo
        },
        NO_TIMEOUT
      );

      return response.data as PaymentStatusResponse;
    } catch (error: any) {
      if (error.response?.data) {
        throw new Error(error.response.data.message || 'Failed to check payment status');
      }
      throw new Error('Network error. Please check your connection.');
    }
  },

  cancelPayment: async (referenceNo: string): Promise<{ status: string; message?: string }> => {
    try {
      const response = await apiClient.post<{ status: string; message?: string }>(
        `/payments/cancel`,
        { reference_no: referenceNo },
        NO_TIMEOUT
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.data) {
        throw new Error(error.response.data.message || 'Failed to cancel payment');
      }
      throw new Error('Network error. Please check your connection.');
    }
  }
};
