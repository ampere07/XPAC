import apiClient from '../config/api';
import { BillingRecord, BillingDetailRecord } from '../types/billing';

export type { BillingRecord, BillingDetailRecord };

interface BillingApiResponse {
  data?: BillingRecord[];
  message?: string;
  status?: string;
}

interface BillingDetailApiResponse {
  data?: BillingDetailRecord;
  message?: string;
  status?: string;
}

export const getBillingRecords = async (page: number = 1, perPage: number = 50): Promise<{ data: BillingRecord[], total: number, hasMore: boolean }> => {
  try {
    const response = await apiClient.get<any>('/billing', {
      params: { page, per_page: perPage }
    });
    const responseData = response.data;

    if (responseData?.data && Array.isArray(responseData.data)) {
      const data = responseData.data.map((item: any): BillingRecord => ({
        id: item.Account_No || item.id,
        applicationId: item.Account_No || '',
        accountNo: item.Account_No || '',
        account_no: item.Account_No || '',
        customerName: item.Full_Name || '',
        firstName: item.First_Name || item.first_name || '',
        middleInitial: item.Middle_Initial || item.middle_initial || '',
        lastName: item.Last_Name || item.last_name || '',
        address: item.Address || '',
        status: item.Status || 'Inactive',
        balance: parseFloat(item.account_balance) || parseFloat(item.Account_Balance) || 0,
        onlineStatus: item.Online_Session_Status || 'Offline',
        cityId: null,
        regionId: null,
        timestamp: item.Modified_Date || '',
        billingStatus: item.Billing_Status_Name || (item.Billing_Status_ID ? `Status ${item.Billing_Status_ID}` : ''),
        billing_status_id: item.Billing_Status_ID,
        dateInstalled: item.Date_Installed || '',
        contactNumber: item.Contact_Number || '',
        secondContactNumber: item.Second_Contact_Number || '',
        emailAddress: item.email_address || item.Email_Address || '',
        plan: item.Plan || item.Desired_Plan || '',
        username: item.Username || '',
        connectionType: item.Connection_Type || '',
        routerModel: item.Router_Model || '',
        routerModemSN: item.Router_Modem_SN || '',
        lcpnap: item.LCPNAP || '',
        port: item.PORT || '',
        vlan: item.VLAN || '',
        billingDay: item.Billing_Day === 'Every end of month' ? 0 : (item.Billing_Day || 0),
        totalPaid: item.Total_Paid || 0,
        provider: item.Provider || '',
        lcp: item.LCP || '',
        nap: item.NAP || '',
        modifiedBy: item.Modified_By || '',
        modifiedDate: item.Modified_Date || '',
        barangay: item.Barangay || '',
        city: item.City || '',
        region: item.Region || '',
        usageType: item.Usage_Type || item.usage_type || '',
        lcpnapport: item.LCP_NAP_PORT || item.LCPNAPPORT || ''
      }));

      return {
        data,
        total: responseData.total || data.length,
        hasMore: responseData.pagination?.has_more || false
      };
    }

    return { data: [], total: 0, hasMore: false };
  } catch (error) {
    console.error('Error fetching billing records:', error);
    return { data: [], total: 0, hasMore: false };
  }
};

export const getBillingRecordDetails = async (id: string): Promise<BillingDetailRecord | null> => {
  try {
    const response = await apiClient.get<any>(`/billing/${id}`);
    const responseData = response.data;

    console.log('Raw API Response:', responseData);
    console.log('House Front Picture URL from API:', responseData?.data?.house_front_picture_url);

    if (responseData?.data) {
      const item = responseData.data;
      const basicRecord: BillingRecord = {
        id: item.Account_No || item.id,
        applicationId: item.Account_No || '',
        customerName: item.Full_Name || '',
        address: item.Address || '',
        status: item.Status || 'Inactive',
        balance: parseFloat(item.account_balance) || parseFloat(item.Account_Balance) || 0,
        onlineStatus: item.Online_Session_Status || 'Offline',
        cityId: null,
        regionId: null,
        timestamp: item.Modified_Date || '',
        billingStatus: item.Billing_Status_Name || (item.Billing_Status_ID ? `Status ${item.Billing_Status_ID}` : ''),
        billing_status_id: item.Billing_Status_ID,
        dateInstalled: item.Date_Installed || '',
        contactNumber: item.Contact_Number || '',
        secondContactNumber: item.Second_Contact_Number || '',
        emailAddress: item.Email_Address || '',
        plan: item.Plan || item.Desired_Plan || '',
        username: item.Username || '',
        connectionType: item.Connection_Type || '',
        routerModel: item.Router_Model || '',
        routerModemSN: item.Router_Modem_SN || '',
        lcpnap: item.LCPNAP || '',
        port: item.PORT || '',
        vlan: item.VLAN || '',
        billingDay: item.Billing_Day === 'Every end of month' ? 0 : (item.Billing_Day || 0),
        totalPaid: item.Total_Paid || 0,
        provider: item.Provider || '',
        lcp: item.LCP || '',
        nap: item.NAP || '',
        modifiedBy: item.Modified_By || '',
        modifiedDate: item.Modified_Date || '',
        barangay: item.Barangay || '',
        city: item.City || '',
        region: item.Region || '',
        usageType: item.Usage_Type || item.usage_type || ''
      };

      const detailRecord: BillingDetailRecord = {
        ...basicRecord,
        lcpnapport: item.LCPNAPPORT || '',
        referredBy: item.Referred_By || '',
        referrersAccountNumber: '',
        group: item.Group_ID ? `Group ${item.Group_ID}` : '',
        groupName: item.Group_Name || item.group_name || '',
        mikrotikId: '',
        sessionIP: item.IP_Address || '',
        sessionIp: item.IP_Address || item.ip_address || '',
        emailAddress: item.email_address || item.Email_Address || '',
        accountBalance: parseFloat(item.Account_Balance) || parseFloat(item.account_balance) || 0,
        houseFrontPicture: item.house_front_picture_url || '',
        referralContactNo: item.Referral_Contact_No || item.referral_contact_no || '',
        housingStatus: item.Housing_Status || item.housing_status || '',
        addressCoordinates: item.Address_Coordinates || item.address_coordinates || '',
        relatedInvoices: 'Related Invoices (0)',
        relatedStatementOfAccount: 'Related Statement of Account...',
        relatedDiscounts: 'Related Discounts (0)',
        relatedStaggeredInstallation: 'Related Staggered Installation...',
        relatedStaggeredPayments: 'Related Staggered Payments (0)',
        relatedOverdues: 'Related Overdues (0)',
        relatedDCNotices: 'Related DC Notices (0)',
        relatedServiceOrders: 'Related Service Orders (0)',
        relatedDisconnectedLogs: 'Related Disconnected Logs (0)',
        relatedReconnectionLogs: 'Related Reconnection Logs (0)',
        relatedChangeDueLogs: 'Related Change Due Logs (0)',
        relatedTransactions: 'Related Transactions',
        relatedDetailsUpdateLogs: 'Related Details Update Logs (0)',
        computedAddress: item.Address ? (item.Address.length > 25 ? `${item.Address.substring(0, 25)}...` : item.Address) : '',
        computedStatus: `${item.Status || 'Inactive'} | P ${parseFloat(item.Account_Balance) || 0}`,
        relatedAdvancedPayments: 'Related Advanced Payments (0)',
        relatedPaymentPortalLogs: 'Related Payment Portal Logs (0)',
        relatedInventoryLogs: 'Related Inventory Logs (0)',
        computedAccountNo: `${item.Account_No} | ${item.Full_Name || ''}${item.Address ? (' | ' + item.Address.substring(0, 10) + '...') : ''}`,
        relatedOnlineStatus: 'Related Online Status (1)',
        relatedBorrowedLogs: 'Related Borrowed Logs (0)',
        relatedPlanChangeLogs: 'Related Plan Change Logs (0)',
        relatedServiceChargeLogs: 'Related Service Charge Logs (0)',
        relatedAdjustedAccountLogs: 'Related Adjusted Account Log...',
        relatedSecurityDeposits: 'Related Security Deposits (0)',
        relatedApprovedTransactions: 'Related Approved Transaction...',
        relatedAttachments: '',
        logs: 'Logs (0)'
      };

      console.log('Mapped houseFrontPicture value:', detailRecord.houseFrontPicture);
      console.log('Full detailRecord:', detailRecord);

      return detailRecord;
    }

    return null;
  } catch (error) {
    console.error('Error fetching billing record details:', error);
    return null;
  }
};

export const updateBillingRecord = async (id: string, data: Partial<BillingDetailRecord>): Promise<BillingDetailRecord | null> => {
  try {
    const backendData = {
      Full_Name: data.customerName,
      Contact_Number: data.contactNumber,
      Email_Address: data.emailAddress,
      Address: data.address,
      Plan: data.plan,
      Provider: data.provider,
      Account_Balance: data.balance,
      Username: data.username,
      Connection_Type: data.connectionType,
      Router_Model: data.routerModel,
      Router_Modem_SN: data.routerModemSN,
      LCP: data.lcp,
      NAP: data.nap,
      PORT: data.port,
      VLAN: data.vlan,
      LCPNAP: data.lcpnap,
      Status: data.status,
      Billing_Status: data.billingStatus,
      Billing_Day: data.billingDay,
      Group: data.group,
      MIKROTIK_ID: data.mikrotikId,
      Usage_Type: data.usageType,
      Referred_By: data.referredBy,
      Second_Contact_Number: data.secondContactNumber,
      Referrers_Account_Number: data.referrersAccountNumber
    };

    await apiClient.put<any>(`/billing-details/${id}`, backendData);

    return getBillingRecordDetails(id);
  } catch (error) {
    console.error('Error updating billing record:', error);
    throw error;
  }
};

export const createBillingRecord = async (data: Partial<BillingDetailRecord>): Promise<BillingDetailRecord | null> => {
  try {
    const backendData = {
      Account_No: data.applicationId,
      Full_Name: data.customerName,
      Contact_Number: data.contactNumber,
      Email_Address: data.emailAddress,
      Address: data.address,
      Plan: data.plan,
      Provider: data.provider,
      Account_Balance: data.balance,
      Username: data.username,
      Connection_Type: data.connectionType,
      Router_Model: data.routerModel,
      Router_Modem_SN: data.routerModemSN,
      LCP: data.lcp,
      NAP: data.nap,
      PORT: data.port,
      VLAN: data.vlan,
      LCPNAP: data.lcpnap,
      Status: data.status,
      Billing_Status: data.billingStatus,
      Billing_Day: data.billingDay,
      Group: data.group,
      MIKROTIK_ID: data.mikrotikId,
      Usage_Type: data.usageType,
      Referred_By: data.referredBy,
      Second_Contact_Number: data.secondContactNumber,
      Referrers_Account_Number: data.referrersAccountNumber,
      Date_Installed: new Date().toISOString(),
      Modified_Date: new Date().toISOString(),
      Modified_By: 'System'
    };

    const response = await apiClient.post<any>('/billing-details', backendData);

    if (response.data.status === 'success' && response.data.data) {
      return getBillingRecordDetails(response.data.data.Account_No);
    }

    return null;
  } catch (error) {
    console.error('Error creating billing record:', error);
    throw error;
  }
};

export const deleteBillingRecord = async (id: string): Promise<boolean> => {
  try {
    await apiClient.delete(`/billing-details/${id}`);
    return true;
  } catch (error) {
    console.error('Error deleting billing record:', error);
    throw error;
  }
};
