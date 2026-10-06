// An agent records a payment Under My Account (their own referrals, Collected
// Payment + Agent Collected) or Under XPACS (any customer, Received Payment
// only). The choice decides which accounts can be picked, which payment fields
// are shown, and what is sent to the server.
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import TransactionFormModal from './TransactionFormModal';
import { transactionService } from '../services/transactionService';

const ACCOUNTS = [
  { id: '1001', accountNo: '1001', customerName: 'Own Customer', address: 'Wawa', referredByAgentId: 44 },
  { id: '2002', accountNo: '2002', customerName: 'Other Customer', address: 'Bayambang', referredByAgentId: 99 },
];

// Plain functions, not jest.fn(): CRA's jest config resets mock implementations before each test.
jest.mock('../store/billingStore', () => {
  const state = { billingRecords: ACCOUNTS, fetchBillingRecords: () => Promise.resolve() };
  return { useBillingStore: (selector: (s: typeof state) => unknown) => selector(state) };
});
jest.mock('../services/billingService', () => ({
  getBillingRecordDetails: (accountNo: string) => {
    const account = ACCOUNTS.find(a => a.accountNo === accountNo)!;
    return Promise.resolve({
      applicationId: account.accountNo, customerName: account.customerName, address: account.address,
      contactNumber: '09170000000', plan: 'Fiber 1500', accountBalance: 0, generationType: 'Postpaid',
    });
  },
}));
jest.mock('../services/settingsColorPaletteService', () => ({
  settingsColorPaletteService: { getActive: () => Promise.resolve(null) },
}));
jest.mock('../services/userService', () => ({ userService: { getUsersByRoleId: () => Promise.resolve({ success: false }) } }));
jest.mock('../services/paymentMethodService', () => ({
  paymentMethodService: { getAll: () => Promise.resolve({ success: true, data: [{ id: 1, payment_method: 'Cash' }] }) },
}));
jest.mock('../services/planService', () => ({ planService: { getAllPlans: () => Promise.resolve([]) } }));
jest.mock('../services/paymentService', () => ({ paymentService: { getAvailableDiscount: () => Promise.resolve({ checkout: 0, discountsOnFile: 0 }) } }));
jest.mock('../services/imageSettingsService', () => ({
  getActiveImageSize: () => Promise.resolve(null),
  resizeImage: (file: File) => Promise.resolve(file),
}));
jest.mock('../services/technicianService', () => ({ technicianService: { getAllTechnicians: () => Promise.resolve({ data: [] }) } }));
jest.mock('../utils/imageWatermark', () => ({ stampTextTopRight: (file: File) => Promise.resolve(file) }));
jest.mock('../services/transactionService', () => ({
  transactionService: { createTransaction: jest.fn(), uploadTransactionImage: jest.fn(), updateTransaction: jest.fn() },
}));
jest.mock('../config/api', () => ({ __esModule: true, default: {}, API_BASE_URL: '' }));

/** The input, select or textarea under the label whose own text is `label`. */
const field = (label: string): HTMLInputElement => {
  const labelEl = Array.from(document.querySelectorAll('label'))
    .find(el => (el.childNodes[0]?.textContent || '').trim() === label);
  if (!labelEl) throw new Error(`No field labelled "${label}"`);
  return labelEl.parentElement!.querySelector('input, select, textarea') as HTMLInputElement;
};

const hasField = (label: string) =>
  Array.from(document.querySelectorAll('label')).some(el => (el.childNodes[0]?.textContent || '').trim() === label);

const accountInput = () => screen.getByPlaceholderText(/^Search/) as HTMLInputElement;

const openAccountList = () => fireEvent.focus(accountInput());

const pickAccount = async (accountNo: string) => {
  openAccountList();
  fireEvent.mouseDown(screen.getByRole('button', { name: new RegExp(`^${accountNo} \\|`) }));
  await waitFor(() => expect(accountInput().value).toMatch(new RegExp(`^${accountNo} \\|`)));
};

const renderForm = (props: Partial<React.ComponentProps<typeof TransactionFormModal>> = {}) =>
  render(<TransactionFormModal isOpen onClose={() => {}} onSave={() => {}} {...props} />);

beforeAll(() => {
  // jsdom has no object URLs; the payment proof preview needs one.
  (URL as any).createObjectURL = () => 'blob:proof';
  (URL as any).revokeObjectURL = () => {};
});

beforeEach(() => {
  localStorage.setItem('authData', JSON.stringify({
    id: 44, role: 'agent', role_id: 4, full_name: 'Ana Agent', email_address: 'ana@example.com',
  }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test('starts Under My Account: own customers only, with the Agent Collected split', () => {
  renderForm();

  expect(screen.getByRole('radio', { name: 'Under My Account' }).getAttribute('aria-checked')).toBe('true');
  expect(hasField('Collected Payment')).toBe(true);
  expect(hasField('Agent Collected')).toBe(true);
  expect(field('Received Payment').readOnly).toBe(true);

  openAccountList();
  expect(screen.getByRole('button', { name: /^1001 \|/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^2002 \|/ })).toBeNull();
});

test('Under XPACS offers every customer and only an editable Received Payment', () => {
  renderForm();
  fireEvent.click(screen.getByRole('radio', { name: 'Under XPACS' }));

  expect(hasField('Collected Payment')).toBe(false);
  expect(hasField('Agent Collected')).toBe(false);
  expect(field('Received Payment').readOnly).toBe(false);

  openAccountList();
  expect(screen.getByRole('button', { name: /^1001 \|/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^2002 \|/ })).toBeTruthy();
});

test('switching back to My Account drops a customer the agent did not refer', async () => {
  renderForm();
  fireEvent.click(screen.getByRole('radio', { name: 'Under XPACS' }));
  await pickAccount('2002');

  fireEvent.click(screen.getByRole('radio', { name: 'Under My Account' }));

  expect(accountInput().value).toBe('');
  expect(field('Full Name').value).toBe('');
});

test('switching keeps an own customer and carries the amount over', async () => {
  renderForm();
  fireEvent.click(screen.getByRole('radio', { name: 'Under XPACS' }));
  await pickAccount('1001');
  fireEvent.change(field('Received Payment'), { target: { value: '₱ 500' } });

  fireEvent.click(screen.getByRole('radio', { name: 'Under My Account' }));

  expect(accountInput().value).toMatch(/^1001 \|/);
  expect(field('Collected Payment').value).toBe('₱ 500');
  await waitFor(() => expect(field('Received Payment').value).toBe('₱ 500.00'));
});

test('saving Under XPACS sends the Received Payment and no split', async () => {
  (transactionService.uploadTransactionImage as jest.Mock).mockResolvedValue({
    success: true, data: { payment_proof_image_url: 'https://drive/proof' },
  });
  (transactionService.createTransaction as jest.Mock).mockResolvedValue({
    success: true, data: { image_url: 'https://drive/proof' },
  });

  renderForm();
  fireEvent.click(screen.getByRole('radio', { name: 'Under XPACS' }));
  await pickAccount('2002');

  fireEvent.change(field('Received Payment'), { target: { value: '₱ 750' } });
  await screen.findByRole('option', { name: 'Cash' });
  fireEvent.change(field('Payment Method'), { target: { value: 'Cash' } });
  fireEvent.change(field('Reference No.'), { target: { value: 'REF-750' } });
  fireEvent.change(field('OR No.'), { target: { value: 'OR-750' } });
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File(['proof'], 'proof.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(document.querySelector('img[src="blob:proof"]')).toBeTruthy());

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(transactionService.createTransaction).toHaveBeenCalledTimes(1));
  const payload = (transactionService.createTransaction as jest.Mock).mock.calls[0][0];
  expect(payload).toEqual(expect.objectContaining({ account_no: '2002', received_payment: 750 }));
  expect(payload).not.toHaveProperty('collected_payment');
  expect(payload).not.toHaveProperty('agent_collected');
});

test('an edit keeps the way the row was recorded and cannot switch it', () => {
  const billingRecord = { applicationId: '2002', customerName: 'Other Customer', plan: 'Fiber 1500', accountBalance: 0 };
  const row = {
    id: 9, received_payment: 800, collected_payment: null, agent_collected: null,
    payment_date: '2026-10-01', transaction_type: 'Recurring Fee', image_url: 'https://drive/proof',
  };

  renderForm({ billingRecord, initialTransactionData: row });

  const xpacs = screen.getByRole('radio', { name: 'Under XPACS' }) as HTMLButtonElement;
  expect(xpacs.getAttribute('aria-checked')).toBe('true');
  expect(xpacs.disabled).toBe(true);
  expect(hasField('Collected Payment')).toBe(false);
  expect(field('Received Payment').value).toBe('₱ 800');

  cleanup();
  renderForm({ billingRecord, initialTransactionData: { ...row, collected_payment: 700, agent_collected: 100 } });

  expect(screen.getByRole('radio', { name: 'Under My Account' }).getAttribute('aria-checked')).toBe('true');
  expect(field('Collected Payment').value).toBe('₱ 700');
});
