import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import apiClient from '../config/api';

/**
 * Approving and rejecting a Pending payout on agent_commission_history.
 *
 * POST /commissions/history records a payout as Pending; it moves the agent's
 * balance only when approved through /commissions/history/{id}/approve. The
 * server allows that only to holders of agent-payout.approve, so callers offer
 * it only when usePermissions().can('agent-payout.approve').
 *
 * APPROVING NEVER RE-TYPES A RECORD. A record that already carries an amount
 * and a proof of payment is approved as it stands, with no body at all, so the
 * server applies it with the type it was raised with. Sending a type from a form
 * (the payout form defaults to "All Balance" on web) re-typed a commission
 * payout into a full-balance payout and drained every bucket.
 *
 * Only a record that is missing those details (a payout raised from an agent
 * invoice, which is recorded with the agent and invoice number alone) needs the
 * approval form; `approveRecord` is set for the caller to open it, and the form
 * sends the record's own type back.
 */
export const payoutNeedsDetails = (record: any): boolean => {
  const amount = Number(record?.total_amount);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const hasProof = !!String(record?.proof_of_payment ?? '').trim();
  return !(hasAmount && hasProof);
};

const confirm = (title: string, message: string, confirmLabel: string, destructive = false): Promise<boolean> =>
  new Promise(resolve => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });

const describe = (record: any): string => {
  const ref = record?.ref_number || `#${record?.id}`;
  const amount = Number(record?.total_amount);
  const money = Number.isFinite(amount) && amount > 0
    ? ` for ₱${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
    : '';
  const who = record?.agent_name ? ` (${record.agent_name})` : '';
  return `${ref}${who}${money}`;
};

export const usePayoutApproval = (onSettled: (record: any, status: 'Approved' | 'Rejected') => void) => {
  const [approvalPending, setApprovalPending] = useState(false);
  // Set when the record needs the approval form (no amount / proof yet).
  const [approveRecord, setApproveRecord] = useState<any | null>(null);

  const handleApproval = useCallback(async (record: any, action: 'approve' | 'reject') => {
    if (approvalPending || !record?.id) return;

    if (action === 'approve' && payoutNeedsDetails(record)) {
      setApproveRecord(record);
      return;
    }

    const ok = action === 'approve'
      ? await confirm('Approve payout', `Approve ${describe(record)}? This applies it to the agent's balance.`, 'Approve')
      : await confirm('Reject payout', `Reject ${describe(record)}? The agent's balance is not changed.`, 'Reject', true);
    if (!ok) return;

    setApprovalPending(true);
    try {
      // No body on approve: the record is applied exactly as it was raised.
      const res = await apiClient.post<{ success: boolean; message?: string }>(
        `/commissions/history/${record.id}/${action}`
      );
      if (!res.data?.success) {
        throw new Error(res.data?.message || `Failed to ${action} the payout.`);
      }
      onSettled(record, action === 'approve' ? 'Approved' : 'Rejected');
    } catch (err: any) {
      Alert.alert(
        action === 'approve' ? 'Approve failed' : 'Reject failed',
        err?.response?.data?.message || err?.message || `Failed to ${action} the payout.`
      );
    } finally {
      setApprovalPending(false);
    }
  }, [approvalPending, onSettled]);

  return { handleApproval, approvalPending, approveRecord, setApproveRecord };
};

export default usePayoutApproval;
