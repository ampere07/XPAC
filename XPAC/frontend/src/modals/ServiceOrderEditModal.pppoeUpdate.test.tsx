// A "PPPoE Update" service order shows editable PPPoE Username / Password fields, filled with the
// account's current credentials. Saving it as Resolved sends them to the server, which changes
// them in RADIUS and technical details and refuses the save if either fails. Every other concern,
// and a PPPoE Update that is not being resolved, sends no credentials at all.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ServiceOrderEditModal from './ServiceOrderEditModal';

// Plain functions, not jest.fn(): CRA's jest config resets mock implementations before each test.
const mockPutCalls: Array<{ url: string; body: any }> = [];
let mockPutResult: () => Promise<any> = () => Promise.resolve({ data: { success: true } });

jest.mock('../config/api', () => ({
  __esModule: true,
  default: {
    get: () => Promise.resolve({ data: { success: true, data: [] } }),
    post: () => Promise.resolve({ data: { success: true, data: {} } }),
    delete: () => Promise.resolve({ data: { success: true } }),
    put: (url: string, body: any) => {
      mockPutCalls.push({ url, body });
      return mockPutResult();
    },
  },
  API_BASE_URL: '',
}));
jest.mock('react-signature-canvas', () => () => null);
jest.mock('../services/inventoryItemService', () => ({ getAllInventoryItems: () => Promise.resolve({ success: true, data: [] }) }));
jest.mock('../services/serviceOrderItemService', () => ({
  createServiceOrderItems: () => Promise.resolve({ success: true }),
  deleteServiceOrderItems: () => Promise.resolve({ success: true }),
}));
jest.mock('../services/settingsColorPaletteService', () => ({ settingsColorPaletteService: { getActive: () => Promise.resolve(null) } }));
jest.mock('../services/imageSettingsService', () => ({
  getActiveImageSize: () => Promise.resolve(null),
  resizeImage: (file: File) => Promise.resolve(file),
}));
jest.mock('../services/concernService', () => ({
  concernService: {
    getAllConcerns: () => Promise.resolve([
      { id: 1, concern_name: 'PPPoE Update' },
      { id: 2, concern_name: 'No Internet' },
    ]),
  },
}));
jest.mock('../services/portService', () => ({ getUsedPorts: () => Promise.resolve({ success: true, data: [] }) }));
jest.mock('../services/lcpnapService', () => ({ getAllLCPNAPs: () => Promise.resolve({ success: true, data: [] }) }));
jest.mock('../services/routerModelService', () => ({ routerModelService: { getAllRouterModels: () => Promise.resolve([]) } }));
jest.mock('../services/billingService', () => ({ getBillingRecordDetails: () => Promise.resolve(null) }));
jest.mock('../store/billingStore', () => ({ useBillingStore: { getState: () => ({ removeByAccountNo: () => {} }) } }));
jest.mock('../services/technicianService', () => ({ technicianService: { getAllTechnicians: () => Promise.resolve({ data: [] }) } }));
jest.mock('../services/serviceOrderService', () => ({ logBlockedTechnicianTransfer: () => Promise.resolve() }));

const serviceOrder = (overrides: Record<string, any> = {}) => ({
  id: 7,
  account_no: '1001',
  concern: 'PPPoE Update',
  concern_remarks: 'Customer asked for a new password',
  support_status: 'In Progress',
  visit_status: 'In Progress',
  username: 'OLD_user',
  pppoe_username: 'OLD_user',
  pppoe_password: 'oldpass',
  service_charge: '0',
  ...overrides,
});

const renderModal = (data = serviceOrder()) =>
  render(<ServiceOrderEditModal isOpen onClose={() => {}} onSave={() => {}} serviceOrderData={data} isTech={false} />);

const setSupportStatus = (value: string) =>
  fireEvent.change(screen.getByLabelText('Support Status'), { target: { value } });

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

beforeEach(() => {
  mockPutCalls.length = 0;
  mockPutResult = () => Promise.resolve({ data: { success: true } });
});

it('shows the PPPoE fields for a PPPoE Update, filled with the current credentials', async () => {
  renderModal();

  const username = await screen.findByLabelText('PPPoE Username') as HTMLInputElement;
  const password = screen.getByLabelText('PPPoE Password') as HTMLInputElement;
  expect(username.value).toBe('OLD_user');
  expect(password.value).toBe('oldpass');
  expect(password.type).toBe('password');

  fireEvent.click(screen.getByRole('button', { name: 'Show PPPoE password' }));
  expect(password.type).toBe('text');
});

it('sends the new credentials when a PPPoE Update is saved as Resolved', async () => {
  mockPutResult = () => Promise.resolve({ data: { success: true, pppoe_update_status: 'success' } });
  renderModal();

  fireEvent.change(await screen.findByLabelText('PPPoE Username'), { target: { value: ' NEW_user ' } });
  fireEvent.change(screen.getByLabelText('PPPoE Password'), { target: { value: 'newpass' } });
  setSupportStatus('Resolved');
  expect(screen.getByText('PPPoE Update Trigger Detected')).toBeInTheDocument();
  save();

  await waitFor(() => expect(mockPutCalls).toHaveLength(1));
  expect(mockPutCalls[0].url).toBe('/service-orders/7');
  expect(mockPutCalls[0].body).toMatchObject({ support_status: 'Resolved', pppoe_username: 'NEW_user', pppoe_password: 'newpass' });
  expect(await screen.findByText(/PPPoE credentials updated in RADIUS and technical details/)).toBeInTheDocument();
});

it('does not send credentials for a PPPoE Update that is not being resolved', async () => {
  renderModal();

  fireEvent.change(await screen.findByLabelText('PPPoE Password'), { target: { value: 'newpass' } });
  save();

  await waitFor(() => expect(mockPutCalls).toHaveLength(1));
  expect(mockPutCalls[0].body).not.toHaveProperty('pppoe_username');
  expect(mockPutCalls[0].body).not.toHaveProperty('pppoe_password');
});

it('refuses to resolve a PPPoE Update without both credentials', async () => {
  renderModal();

  fireEvent.change(await screen.findByLabelText('PPPoE Password'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('PPPoE Username'), { target: { value: 'has space' } });
  setSupportStatus('Resolved');
  save();

  expect(await screen.findByText('PPPoE Password is required')).toBeInTheDocument();
  expect(screen.getByText('PPPoE Username cannot contain spaces')).toBeInTheDocument();
  expect(mockPutCalls).toHaveLength(0);
});

it('shows the server error when the PPPoE update fails, and marks the field', async () => {
  mockPutResult = () => Promise.reject({
    response: {
      status: 422,
      data: {
        success: false,
        pppoe_update_status: 'failed',
        message: "PPPoE Username 'TAKEN_user' is already used by another account.",
        errors: { pppoe_username: ["'TAKEN_user' is already used by another account"] },
      },
    },
  });
  renderModal();

  fireEvent.change(await screen.findByLabelText('PPPoE Username'), { target: { value: 'TAKEN_user' } });
  setSupportStatus('Resolved');
  save();

  expect(await screen.findByText('PPPoE Update Failed')).toBeInTheDocument();
  expect(screen.getByText("PPPoE Username 'TAKEN_user' is already used by another account.")).toBeInTheDocument();
  expect(screen.getByText("'TAKEN_user' is already used by another account")).toBeInTheDocument();
});

it('leaves other concerns alone: no PPPoE fields, no credentials sent', async () => {
  renderModal(serviceOrder({ concern: 'No Internet' }));

  await screen.findByLabelText('Support Status');
  expect(screen.queryByLabelText('PPPoE Username')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('PPPoE Password')).not.toBeInTheDocument();

  setSupportStatus('Resolved');
  expect(screen.queryByText('PPPoE Update Trigger Detected')).not.toBeInTheDocument();
  save();

  await waitFor(() => expect(mockPutCalls).toHaveLength(1));
  expect(mockPutCalls[0].body).toMatchObject({ concern: 'No Internet', support_status: 'Resolved' });
  expect(mockPutCalls[0].body).not.toHaveProperty('pppoe_username');
  expect(mockPutCalls[0].body).not.toHaveProperty('pppoe_password');
});
