export interface BillingRecord {
  id: string;
  applicationId: string;
  accountNo?: string;
  account_no?: string;
  customerName: string;
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  address: string;
  status: string;
  balance: number;
  onlineStatus: string;
  cityId?: number | null;
  regionId?: number | null;
  timestamp?: string;
  billingStatus?: string;
  billing_status_id?: number;
  dateInstalled?: string;
  contactNumber?: string;
  secondContactNumber?: string;
  emailAddress?: string;
  plan?: string;
  username?: string;
  connectionType?: string;
  routerModel?: string;
  routerModemSN?: string;
  lcpnap?: string;
  port?: string;
  vlan?: string;
  billingDay?: number;
  totalPaid?: number;
  provider?: string;
  lcp?: string;
  nap?: string;
  modifiedBy?: string;
  modifiedDate?: string;
  barangay?: string;
  city?: string;
  region?: string;
  usageType?: string;
  lcpnapport?: string;
}

export interface BillingDetailRecord extends BillingRecord {
  referredBy?: string;
  referralContactNo?: string;
  groupName?: string;
  mikrotikId?: string;
  sessionIp?: string;
  houseFrontPicture?: string;
  accountBalance?: number;
  email?: string;
  housingStatus?: string;
  addressCoordinates?: string;

  // Extended fields for detailed view
  lcpnapport?: string;
  referrersAccountNumber?: string;
  balanceUpdateDate?: string;
  billingAccountCreatedBy?: string;
  billingAccountCreatedAt?: string;
  billingAccountUpdatedBy?: string;
  billingAccountUpdatedAt?: string;
  relatedInvoices?: string;
  relatedStatementOfAccount?: string;
  relatedDiscounts?: string;
  relatedStaggeredInstallation?: string;
  relatedStaggeredPayments?: string;
  relatedOverdues?: string;
  relatedDCNotices?: string;
  relatedServiceOrders?: string;
  relatedDisconnectedLogs?: string;
  relatedReconnectionLogs?: string;
  relatedChangeDueLogs?: string;
  relatedTransactions?: string;
  relatedDetailsUpdateLogs?: string;
  computedAddress?: string;
  computedStatus?: string;
  relatedAdvancedPayments?: string;
  relatedPaymentPortalLogs?: string;
  relatedInventoryLogs?: string;
  computedAccountNo?: string;
  relatedOnlineStatus?: string;
  group?: string;
  sessionIP?: string;
  relatedBorrowedLogs?: string;
  relatedPlanChangeLogs?: string;
  relatedServiceChargeLogs?: string;
  relatedAdjustedAccountLogs?: string;
  relatedSecurityDeposits?: string;
  relatedApprovedTransactions?: string;
  relatedAttachments?: string;
  logs?: string;
  vip_expiration?: string | null;
  vip_remarks?: string | null;
  accountNoCustomer?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  proofOfBillingUrl?: string | null;
  governmentValidIdUrl?: string | null;
  secondGovernmentValidIdUrl?: string | null;
  documentAttachmentUrl?: string | null;
  otherIspBillUrl?: string | null;
  customerCreatedAt?: string | null;
  customerUpdatedAt?: string | null;
  customerUpdatedBy?: string | null;
  techCreatedAt?: string | null;
  techUpdatedAt?: string | null;
  techCreatedBy?: string | null;
  techUpdatedBy?: string | null;
  usernameStatus?: string | null;
  location?: string | null;
}

export interface OnlineStatusRecord {
  id: string;
  status: string;
  accountNo: string;
  username: string;
  group: string;
  splynxId: string;
}

// API response types
export interface BillingApiResponse {
  data: BillingRecord[];
  message?: string;
  status?: string;
}

export interface BillingDetailApiResponse {
  data: BillingDetailRecord;
  message?: string;
  status?: string;
}
