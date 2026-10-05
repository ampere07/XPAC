// Approving a pending transaction: the one implementation behind every Approve
// button for a transaction — the Transaction List's details pane and the For
// Approval queue's.
//
// It owns the whole act, not only the API call: who is recorded as approving,
// the billing-store refresh that keeps customer balances current, and the
// message the user is shown. Each screen keeps only its own presentation (its
// confirm dialog, loading modal and success dialog), so approving from any of
// them leaves the system in exactly the same state.

import { useCallback } from 'react';
import { transactionService } from '../services/transactionService';
import { useBillingStore } from '../store/billingStore';

export interface TransactionApprovalOutcome {
  success: boolean;
  /** What to show the user: the success text, or why it failed. */
  message: string;
  /** The transaction's status after a successful approval. */
  status?: string;
}

/**
 * The rule the Approve button is drawn by: the approve key, on a transaction
 * that is still pending. The server re-checks both.
 */
export const canApproveTransaction = (
  status: string | null | undefined,
  can: (permission: string) => boolean
): boolean => can('transaction-list.approve') && (status || '').toLowerCase() === 'pending';

/** The signed-in user's email, recorded as the approver. */
const currentUserEmail = (): string => {
  try {
    const authData = localStorage.getItem('authData');
    if (authData) {
      const parsed = JSON.parse(authData);
      return parsed.email_address || parsed.email || parsed.user?.email_address || parsed.user?.email || '';
    }
  } catch (err) {
    console.error('Error getting current user email:', err);
  }
  return '';
};

export const useTransactionApproval = () => {
  // A selector, so a screen that only approves is not re-rendered on every billing update.
  const refreshLatestData = useBillingStore(state => state.refreshLatestData);

  /**
   * Approve one transaction. Never throws: a failure comes back as an outcome
   * with success false. `onProgress` receives the same 20 / 60 / 100 steps the
   * Transaction List's loading modal has always shown.
   */
  const approveTransaction = useCallback(async (
    transactionId: string,
    onProgress?: (percentage: number) => void
  ): Promise<TransactionApprovalOutcome> => {
    try {
      onProgress?.(20);

      const result = await transactionService.approveTransaction(transactionId, currentUserEmail());

      onProgress?.(60);

      if (!result.success) {
        return { success: false, message: result.message || 'Failed to approve transaction' };
      }

      onProgress?.(100);

      const status = result.data?.status || 'Done';

      // Auto-refresh customer data
      try {
        await refreshLatestData();
      } catch (refreshErr) {
        console.error('Failed to auto-refresh customer data:', refreshErr);
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      return { success: true, status, message: `Transaction approved successfully. Status: ${status}` };
    } catch (err: any) {
      console.error('Approve transaction error:', err);
      return { success: false, message: `Failed to approve transaction: ${err.message}` };
    }
  }, [refreshLatestData]);

  return { approveTransaction };
};

export default useTransactionApproval;
