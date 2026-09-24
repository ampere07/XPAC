import apiClient from '../config/api';

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
    // These come back snake_cased from CustomerDetailController, unlike the fields above.
    // 'Pre Paid' | 'Post Paid' — drives the plan picker in the Pay Now modal.
    generation_type?: string | null;
    vat_type?: string | null;
    // End of the current prepaid service period.
    prepaid_expires_at?: string | null;
    // A plan already paid for that takes effect when the current period lapses.
    pending_plan_id?: number | null;
    pending_plan_name?: string | null;
    pending_plan_effective_at?: string | null;
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
  /** Live RADIUS sessions on this account. Fallback for `sessionStatusFrom()` when
   *  session_status is absent — see utils/onlineStatus.ts. */
  active_sessions?: number;
  /** When the RADIUS sync last wrote this account's online_status row. */
  session_updated_at?: string | null;
  onlineStatusData?: any;
}

interface CustomerDetailApiResponse {
  success: boolean;
  data?: CustomerDetailData;
  message?: string;
}

export const getCustomerDetail = async (accountNo: string): Promise<CustomerDetailData | null> => {
  try {
    console.log('Fetching customer detail for account:', accountNo);
    const response = await apiClient.get<CustomerDetailApiResponse>(`/customer-detail/${accountNo}`);

    console.log('Customer detail API response:', response.data);

    if (response.data?.success && response.data?.data) {
      const data = response.data.data;
      console.log('House front picture URL from API:', data.houseFrontPictureUrl);
      return data;
    }

    return null;
  } catch (error) {
    console.error('Error fetching customer detail:', error);
    return null;
  }
};
