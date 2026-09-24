// Define the JobOrder interface to match job_orders database table
export interface JobOrderItem {
  id: number;
  job_order_id: number;
  item_name: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export interface JobOrder {
  // Primary identifiers
  id?: string | number;
  JobOrder_ID?: string;
  Application_ID?: string;

  // Timestamps
  Timestamp?: string | null;
  StartTimeStamp?: string | null;
  EndTimeStamp?: string | null;
  Duration?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  Date_Installed?: string | null;
  Modified_Date?: string | null;
  Created_At?: string;
  Updated_At?: string | null;

  // Personal Information
  First_Name?: string | null;
  Middle_Initial?: string | null;
  Last_Name?: string | null;
  Contact_Number?: string | null;
  Mobile_Number?: string | null;
  Second_Contact_Number?: string | null;
  Secondary_Mobile_Number?: string | null;
  Email_Address?: string | null;
  Applicant_Email_Address?: string | null;

  // Address Information
  Address?: string | null;
  Installation_Address?: string | null;
  installation_address?: string | null;

  Village?: string | null;
  Barangay?: string | null;
  City?: string | null;
  Region?: string | null;
  Installation_Landmark?: string | null;
  Coordinates?: string | null;

  // Service Information
  Choose_Plan?: string | null;
  Desired_Plan?: string | null;
  Connection_Type?: string | null;
  Usage_Type?: string | null;
  Username?: string | null;
  pppoe_username?: string | null;
  pppoe_password?: string | null;
  PPPoE_Username?: string | null;
  PPPoE_Password?: string | null;

  // Contract and Billing
  Contract_Template?: string | null;
  Contract_Link?: string | null;
  Installation_Fee?: number | null;
  Billing_Day?: string | null;
  Preferred_Day?: string | null;
  Billing_Status?: string | null;
  billing_status?: string | null;
  Generation_Type?: string | null;
  generation_type?: string | null;
  // Legacy free-text VAT mode. Kept in sync with vat_enabled for older readers; billing
  // generation reads vat_enabled.
  Vat_Type?: string | null;
  vat_type?: string | null;
  /** false = No VAT (bill the plan price). true = VAT Included (VAT added on top). */
  vat_enabled?: boolean | null;
  withholding_enabled?: boolean | null;
  /** Percent of the VAT-inclusive subtotal, e.g. 5 / 10 / 15. */
  withholding_percentage?: number | null;
  /** Approves the account into the VIP billing status. Excludes VAT and withholding. */
  vip_enabled?: boolean | null;
  /** Copied to billing_accounts.vip_expiration at approval — the existing VIP expiry. */
  vip_expiration?: string | null;
  /**
   * Read from the linked billing account, not stored on job_orders. Present only once the
   * job order has an approved account, and only meaningful when generation_type is Prepaid.
   */
  prepaid_expires_at?: string | null;

  // Technical Information
  Modem_Router_SN?: string | null;
  Router_Model?: string | null;
  LCP?: string | null;
  NAP?: string | null;
  PORT?: string | null;
  VLAN?: string | null;
  LCPNAP?: string | null;
  LCPNAPPORT?: string | null;
  Port?: string | null;
  Label?: string | null;
  IP?: string | null;

  // Status Information
  Status?: string | null;
  Onsite_Status?: string | null;
  Billing_Status_ID?: number | null;
  billing_status_id?: number | null;

  // Assignment and Tracking
  Assigned_Email?: string | null;
  Visit_By?: string | null;
  Visit_With?: string | null;
  Visit_With_Other?: string | null;
  Referred_By?: string | null;
  Verified_By?: string | null;
  Modified_By?: string | null;
  Created_By?: string | null;

  // Remarks and Notes
  Remarks?: string | null;
  JO_Remarks?: string | null;
  Status_Remarks?: string | null;
  Onsite_Remarks?: string | null;

  // Images and Documents
  Setup_Image?: string | null;
  Speedtest_Image?: string | null;
  Client_Signature?: string | null;
  Signed_Contract_Image?: string | null;
  Box_Reading_Image?: string | null;
  Router_Reading_Image?: string | null;
  House_Front_Picture?: string | null;
  Image?: string | null;

  // Items
  job_order_items?: JobOrderItem[];

  // Organization
  organization_id?: number | null;

  // Additional Fields
  Renter?: string | null;
  Installation?: string | null;
  Second?: string | null;
  Account_No?: string | null;
  Account_Number?: string | null;
  Referrers?: string | null;

  // Flexible property for additional fields
  [key: string]: any;
}

// Export JobOrderData for compatibility with existing code
export type JobOrderData = JobOrder;

// Define component prop interfaces
export interface JobOrderDetailsProps {
  jobOrder: JobOrder;
  onClose: () => void;
  onRefresh?: () => void;
  isMobile?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onExpandSection?: (sectionKey: string, title: string, data: any[], columns: any[], count: number) => void;
}

// Create status type definitions
export type JobOrderStatus =
  | 'Pending'
  | 'Confirmed'
  | 'In Progress'
  | 'Completed'
  | 'Cancelled'
  | 'On Hold';

export type OnsiteStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Completed'
  | 'Cancelled'
  | 'Pending';

export type BillingStatus =
  | 'Pending'
  | 'Active'
  | 'Suspended'
  | 'Cancelled'
  | 'Failed'
  | 'Overdue';
