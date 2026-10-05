// Approving a job order: the one implementation behind every Approve button
// for a job order — the Job Order page's details pane and the For Approval
// queue's.
//
// It owns the whole act, not only the API call: the backend approval (which
// creates the customer, billing account, technical details and login), the
// best-effort SmartOLT ONU update that follows it, and the messages the user is
// shown, including the duplicate SN / username wording. Each screen keeps only
// its own presentation, so approving from any of them leaves the system in
// exactly the same state.

import { useCallback } from 'react';
import apiClient from '../config/api';
import { approveJobOrder as requestJobOrderApproval } from '../services/jobOrderService';
import { JobOrder } from '../types/jobOrder';

export interface JobOrderApprovalOutcome {
  success: boolean;
  /** What to show the user: the success text (with credentials), or why it failed. */
  message: string;
}

/**
 * The rule the Approve button is drawn by: onsite work Done, billing not yet
 * Done, and the approve key. The server re-checks what it needs to.
 */
export const canApproveJobOrder = (
  jobOrder: JobOrder,
  can: (permission: string) => boolean
): boolean => {
  const onsiteStatus = (jobOrder.Onsite_Status || '').toLowerCase();
  const billingStatus = (jobOrder.billing_status || jobOrder.Billing_Status || '').toLowerCase();

  return onsiteStatus === 'done' && billingStatus !== 'done' && can('job-order.approve');
};

export const useJobOrderApproval = () => {
  /**
   * Approve one job order. Never throws: a failure comes back as an outcome
   * with success false. `jobOrder` must be the row as the Job Order list sends
   * it — the SmartOLT update reads the SN, PPPoE username, address and contact
   * off it. `onProgress` is optional; the Job Order page shows a spinner instead.
   */
  const approveJobOrder = useCallback(async (
    jobOrder: JobOrder,
    onProgress?: (percentage: number) => void
  ): Promise<JobOrderApprovalOutcome> => {
    try {
      if (!jobOrder.id) {
        throw new Error('Cannot approve job order: Missing ID');
      }

      onProgress?.(20);

      const response = await requestJobOrderApproval(jobOrder.id);

      onProgress?.(70);

      if (response.success) {
        const accountNumber = response.data?.account_number || 'N/A';
        const contactNumber = response.data?.contact_number_primary || 'N/A';
        const userCreated = response.data?.user_created;

        let message = 'Job Order approved successfully! Customer, billing account, and technical details have been created.';

        // A VIP job order is approved as a standard postpaid account, so the prepaid pay-first
        // steps are skipped even when the customer signed up under a prepaid billing type. Stated
        // here because the difference is otherwise invisible until someone opens the account.
        if (response.data?.vip_enabled) {
          message += '\n\nApproved as VIP: the account was created Active and is handled the same as a postpaid customer — no prepaid restriction was applied.';
        }

        if (userCreated) {
          message += `\n\nCustomer Login Credentials:\nUsername: ${accountNumber}\nPassword: ${contactNumber}`;
        }

        // Update the ONU's location details in SmartOLT — name, address and contact (best-effort).
        const sn = jobOrder.Modem_Router_SN || jobOrder.modem_router_sn || jobOrder.Modem_SN || jobOrder.modem_sn;
        const pppoeUsername = jobOrder.Username || jobOrder.username || jobOrder.pppoe_username;

        // SmartOLT's "Address or comment" is one free-text field, so the installation address is
        // composed into a single readable line. Empty parts are dropped rather than leaving
        // stray commas.
        const smartOltAddress = [
          jobOrder.Installation_Address || jobOrder.installation_address || jobOrder.Address,
          jobOrder.Barangay,
          jobOrder.City,
          jobOrder.Region,
        ].filter(Boolean).join(', ');

        const smartOltContact = jobOrder.Mobile_Number || jobOrder.Contact_Number || '';

        if (sn && pppoeUsername) {
          try {
            const smartOltResponse = await apiClient.post('/smart-olt/update-name', {
              sn,
              pppoe_username: pppoeUsername,
              // Omitted when blank so a missing value never blanks out what is already in SmartOLT.
              ...(smartOltAddress ? { address_or_comment: smartOltAddress } : {}),
              ...(smartOltContact ? { contact: smartOltContact } : {}),
            });

            if ((smartOltResponse.data as any)?.success) {
              const updated = (smartOltResponse.data as any)?.updated || {};
              const extras = [
                updated.address ? 'address' : null,
                updated.contact ? 'contact' : null,
              ].filter(Boolean).join(' and ');
              message += `\n\nSmartOLT ONU updated — name: ${pppoeUsername}`;
              if (extras) message += ` (also ${extras})`;
            } else {
              const smartOltMsg = (smartOltResponse.data as any)?.message || 'Unknown error';
              message += `\n\nNote: Could not update SmartOLT ONU name (${smartOltMsg}).`;
            }
          } catch (smartOltErr: any) {
            console.error('SmartOLT ONU name update error:', smartOltErr);
            const smartOltMsg = smartOltErr.response?.data?.message || smartOltErr.message || 'Connection error';
            message += `\n\nNote: Could not update SmartOLT ONU name (${smartOltMsg}).`;
          }
        }

        onProgress?.(100);

        return { success: true, message };
      }

      const backendMsg = response.error || response.message || 'Failed to approve job order';
      let displayMsg = backendMsg;

      // Map duplicate errors to more specific messages
      if (backendMsg.includes('already data') || backendMsg.includes('duplicate') || backendMsg.toLowerCase().includes('serial number')) {
        if (backendMsg.toLowerCase().includes('serial number') || backendMsg.toLowerCase().includes('modem')) {
          displayMsg = "SN Duplicate, Please check on Customer Details. SN Duplicate Detected.";
        } else if (backendMsg.includes("already data") || backendMsg.toLowerCase().includes('duplicate')) {
          displayMsg = "Username Duplicate, Please check on Customer Details. Username Duplicate Detected.";
        }

        if (response.table && !displayMsg.includes('Customer Details')) {
          displayMsg = `Duplicate Entry Error: ${displayMsg}\nTable: ${response.table}`;
        }
      }

      return { success: false, message: displayMsg };
    } catch (err: any) {
      let displayMsg = 'Failed to approve job order';
      let tableInfo = '';

      if (err.response?.data) {
        const data = err.response.data;
        const rawMsg = data.error || data.message || 'Failed to approve job order';
        displayMsg = rawMsg;

        // Map duplicate errors to more specific messages
        if (rawMsg.includes('already data') || rawMsg.includes('duplicate') || rawMsg.toLowerCase().includes('serial number') || rawMsg.includes('already been approved')) {
          if (rawMsg.toLowerCase().includes('serial number') || rawMsg.toLowerCase().includes('modem')) {
            displayMsg = "SN Duplicate, Please check on Customer Details. SN Duplicate Detected.";
          } else if (rawMsg.includes("already data") || rawMsg.toLowerCase().includes('duplicate')) {
            displayMsg = "Username Duplicate, Please check on Customer Details. Username Duplicate Detected.";
          }

          if (data.table && !displayMsg.includes('Customer Details')) {
            tableInfo = `\nTable: ${data.table}`;
          }
        }
      } else if (err.message) {
        displayMsg = err.message;
      }

      console.error('Approve error:', err);

      return { success: false, message: `${displayMsg}${tableInfo}` };
    }
  }, []);

  return { approveJobOrder };
};

export default useJobOrderApproval;
