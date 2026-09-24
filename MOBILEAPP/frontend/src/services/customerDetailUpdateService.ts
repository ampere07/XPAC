import apiClient, { API_BASE_URL as API_URL } from '../config/api';

export interface CustomerDetailsUpdate {
  firstName: string;
  middleInitial?: string;
  lastName: string;
  emailAddress: string;
  contactNumberPrimary: string;
  contactNumberSecondary?: string;
  address: string;
  region: string;
  city: string;
  barangay: string;
  location: string;
  addressCoordinates?: string;
  housingStatus?: string;
  referredBy?: string;
  groupName?: string;
  houseFrontPicture?: File | string;
}

export interface BillingDetailsUpdate {
  plan: string;
  billingDay?: number;
  billingStatus: string;
  dateInstalled?: string;
  accountBalance?: number | string;
}

export interface TechnicalDetailsUpdate {
  username: string;
  usernameStatus?: string;
  connectionType: string;
  routerModel: string;
  routerModemSn?: string;
  ipAddress?: string;
  lcp?: string;
  nap?: string;
  port?: string;
  vlan?: string;
  usageType?: string;
}

export const customerDetailUpdateService = {
  /**
   * Unified update method that takes editType
   */
  async update(accountNo: string, editType: string, data: any) {
    try {
      const isFormData = data.houseFrontPicture instanceof File;
      let body: any;
      let headers: Record<string, string> = {};

      const method = (isFormData || editType === 'customer_details') ? 'POST' : 'PUT';

      if (isFormData || editType === 'customer_details') {
        const formData = new FormData();
        formData.append('_method', 'PUT');
        formData.append('editType', editType);
        Object.keys(data).forEach(key => {
          if (data[key] !== undefined && data[key] !== null) {
            formData.append(key, data[key]);
          }
        });
        body = formData;
      } else {
        body = JSON.stringify({
          ...data,
          editType
        });
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(`${API_URL}/customer-detail/${accountNo}`, {
        method,
        headers,
        body,
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 422 && errorData.errors) {
          console.error('[Validation Failed]', errorData.errors);
          const errorMessages = Object.values(errorData.errors).flat().join(', ');
          throw new Error(`Validation failed: ${errorMessages}`);
        }
        throw new Error(errorData.message || `Failed to update ${editType.replace('_', ' ')}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Error updating ${editType}:`, error);
      throw error;
    }
  },

  async updateCustomerDetails(accountNo: string, data: CustomerDetailsUpdate) {
    return this.update(accountNo, 'customer_details', data);
  },

  async updateBillingDetails(accountNo: string, data: BillingDetailsUpdate) {
    return this.update(accountNo, 'billing_details', data);
  },

  async updateTechnicalDetails(accountNo: string, data: TechnicalDetailsUpdate) {
    return this.update(accountNo, 'technical_details', data);
  },
};

