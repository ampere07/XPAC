// For Approval approves through the same code path as the record's own page:
// the shared approval hooks, the same service call with the same arguments,
// and the same rule deciding whether the Approve button is drawn at all.
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ForApprovalDetails, { ForApprovalRecord } from './ForApprovalDetails';
import { transactionService } from '../services/transactionService';
import { approveJobOrder } from '../services/jobOrderService';

jest.mock('../services/settingsColorPaletteService', () => ({
  settingsColorPaletteService: { getActive: () => Promise.resolve(null) },
}));
jest.mock('../hooks/useUserDirectory', () => ({ useUserDirectory: () => ({}) }));
jest.mock('../store/billingStore', () => {
  const state = { refreshLatestData: jest.fn(() => Promise.resolve()) };
  return { useBillingStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
jest.mock('../services/transactionService', () => ({
  transactionService: { approveTransaction: jest.fn() },
}));
jest.mock('../services/jobOrderService', () => ({ approveJobOrder: jest.fn() }));
jest.mock('../config/api', () => ({
  __esModule: true,
  default: { post: jest.fn() },
  API_BASE_URL: '',
}));

const signInAs = (roleId: number, role: string) =>
  localStorage.setItem('authData', JSON.stringify({ id: 1, role, role_id: roleId, email_address: 'approver@example.com' }));

const pendingTransaction: ForApprovalRecord = {
  category: 'transactions',
  transaction: {
    id: '501', account_no: 'ACC-1', transaction_type: 'Recurring Fee', received_payment: 1499,
    payment_date: '2026-10-01', date_processed: '', processed_by_user: 'cashier@example.com',
    payment_method: 'Cash', reference_no: 'REF-1', or_no: 'OR-1', remarks: '', status: 'Pending',
    image_url: null, created_at: '2026-10-01 09:00:00', updated_at: '2026-10-01 09:00:00',
  },
};

const doneJobOrder: ForApprovalRecord = {
  category: 'job-orders',
  jobOrder: {
    id: 77, Onsite_Status: 'Done', billing_status: 'In Progress', First_Name: 'Juan', Last_Name: 'Dela Cruz',
    modem_router_sn: 'SN123', Username: 'juan.pppoe', Barangay: 'Wawa', City: 'Bayambang', Mobile_Number: '09170000000',
  },
};

const renderPanel = (record: ForApprovalRecord, onApproved = jest.fn()) => {
  render(
    <ForApprovalDetails
      record={record}
      onClose={() => {}}
      onApproved={onApproved}
      isDarkMode={false}
      colorPalette={null}
      paymentMethods={[]}
    />
  );
  return onApproved;
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  jest.clearAllMocks();
});

test('approves a pending transaction through the Transaction List approval', async () => {
  signInAs(1, 'administrator');
  (transactionService.approveTransaction as jest.Mock).mockResolvedValue({ success: true, data: {} });
  const onApproved = renderPanel(pendingTransaction);

  fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
  fireEvent.click(screen.getByRole('button', { name: /confirm approve/i }));

  await waitFor(() => expect(onApproved).toHaveBeenCalledTimes(1), { timeout: 3000 });
  expect(transactionService.approveTransaction).toHaveBeenCalledWith('501', 'approver@example.com');
  expect(screen.getByText('Transaction approved successfully. Status: Done')).toBeTruthy();
  // The button cannot be pressed a second time once the record is approved.
  expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
});

test('shows the server refusal and does not report an approval', async () => {
  signInAs(1, 'administrator');
  (transactionService.approveTransaction as jest.Mock).mockResolvedValue({
    success: false, message: 'Only pending transactions can be approved',
  });
  const onApproved = renderPanel(pendingTransaction);

  fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
  fireEvent.click(screen.getByRole('button', { name: /confirm approve/i }));

  expect(await screen.findByText('Only pending transactions can be approved')).toBeTruthy();
  expect(onApproved).not.toHaveBeenCalled();
});

test('approves a done job order through the Job Order approval, SmartOLT update included', async () => {
  signInAs(7, 'superadmin');
  (approveJobOrder as jest.Mock).mockResolvedValue({
    success: true, data: { account_number: 'ACC-9', contact_number_primary: '09170000000', user_created: true },
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const apiClient = require('../config/api').default;
  // Set here rather than in the mock factory: CRA's jest config resets mocks before each test.
  apiClient.post.mockResolvedValue({ data: { success: true, updated: {} } });
  const onApproved = renderPanel(doneJobOrder);

  fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
  // The Job Order page's own confirmation modal, whose confirm button reads "Approve".
  const approveButtons = screen.getAllByRole('button', { name: /^approve$/i });
  fireEvent.click(approveButtons[approveButtons.length - 1]);

  await waitFor(() => expect(onApproved).toHaveBeenCalledTimes(1));
  expect(approveJobOrder).toHaveBeenCalledWith(77);
  expect(apiClient.post).toHaveBeenCalledWith('/smart-olt/update-name', expect.objectContaining({
    sn: 'SN123', pppoe_username: 'juan.pppoe', address_or_comment: 'Wawa, Bayambang', contact: '09170000000',
  }));
  expect(screen.getByText(/Username: ACC-9/)).toBeTruthy();
  expect(screen.getByText(/SmartOLT ONU updated — name: juan\.pppoe/)).toBeTruthy();
});

test('draws no Approve button for a role without the approve key', () => {
  signInAs(2, 'technician');
  renderPanel(pendingTransaction);
  expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
});

test('draws no Approve button for a job order whose billing is already Done', () => {
  signInAs(1, 'administrator');
  renderPanel({ category: 'job-orders', jobOrder: { ...(doneJobOrder as any).jobOrder, billing_status: 'Done' } });
  expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
});
