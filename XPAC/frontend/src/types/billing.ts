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
  vip_expiration?: string;
  vip_remarks?: string;
  generationType?: string;
  prepaidExpiration?: string;
  // Prepaid plan change already paid for, taking effect when the current period lapses.
  pendingPlanId?: number | null;
  pendingPlanEffectiveAt?: string;
  /** Legacy free-text VAT mode. vatEnabled below is what billing generation actually reads. */
  vatType?: string;
  /** false = No VAT (plan price billed as-is). true = VAT Included (VAT added on top). */
  vatEnabled?: boolean | null;
  withholdingEnabled?: boolean | null;
  /** Percent of the VAT-inclusive subtotal, e.g. 5 / 10 / 15. */
  withholdingPercentage?: number | null;
  dateInstalled?: string;
  contactNumber?: string;
  secondContactNumber?: string;
  emailAddress?: string;
  plan?: string;
  username?: string;
  /**
   * PPPoE password. Read from the account's job order, not technical_details — the technician
   * sets it when completing the install, so accounts predating that flow have none.
   */
  pppoePassword?: string;
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
  referredBy?: string;
  sessionIP?: string;
  houseFrontPicture?: string;
  housingStatus?: string;
  addressCoordinates?: string;
  location?: string;
  groupName?: string;
  desiredPlan?: string;
  accountBalance?: number;
  balanceUpdateDate?: string;
  billingAccountCreatedBy?: string;
  billingAccountCreatedAt?: string;
  billingAccountUpdatedBy?: string;
  billingAccountUpdatedAt?: string;
  customerCreatedAt?: string;
  customerCreatedBy?: string;
  customerUpdatedAt?: string;
  customerUpdatedBy?: string;
  usernameStatus?: string;
  techCreatedAt?: string;
  techCreatedBy?: string;
  techUpdatedAt?: string;
  techUpdatedBy?: string;
  proofOfBillingUrl?: string;
  governmentValidIdUrl?: string;
  secondGovernmentValidIdUrl?: string;
  documentAttachmentUrl?: string;
  otherIspBillUrl?: string;
  accountNoCustomer?: string;
  organization_id?: number | null;
  sessionGroup?: string;
  active_sessions?: number;
}

export interface BillingDetailRecord extends BillingRecord {
  // referredBy is the agent's NAME, for display. referredByAgentId is who the
  // referral actually points at, and is what gets written back.
  referredBy?: string;
  referredByAgentId?: number | null;
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
  /** Raw document URL, kept alongside houseFrontPicture for the attachment viewer. */
  houseFrontPictureUrl?: string;
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
