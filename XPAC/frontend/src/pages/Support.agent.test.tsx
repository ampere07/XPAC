// Support for agents: an agent raises a ticket for a customer they referred, picked from the
// accounts the server returns for them (GET service-orders/agent-accounts), and sees every ticket
// the server scopes to them. A customer keeps their own page: no account field, their own
// account on the ticket, and only their latest request in the list.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Support from './Support';

// Plain functions, not jest.fn(): CRA's jest config resets mock implementations before each test.
const mockCreated: any[] = [];
const mockFetchCalls: any[] = [];
let mockCreateResult: () => Promise<any> = () => Promise.resolve({ success: true });
let mockAgentAccounts: () => Promise<any[]> = () => Promise.resolve([]);
let mockOrders: any[] = [];

jest.mock('../services/serviceOrderService', () => ({
  createServiceOrder: (payload: any) => { mockCreated.push(payload); return mockCreateResult(); },
  getAgentSupportAccounts: () => mockAgentAccounts(),
}));
jest.mock('../store/serviceOrderStore', () => ({
  useServiceOrderStore: () => ({
    serviceOrders: mockOrders,
    isLoading: false,
    fetchServiceOrders: (...args: any[]) => { mockFetchCalls.push(args); return Promise.resolve(); },
    fetchUpdates: () => Promise.resolve(),
  }),
}));
jest.mock('../services/pusherService', () => ({
  __esModule: true,
  default: { subscribe: () => ({ bind: () => {}, unbind: () => {} }), unsubscribe: () => {} },
}));
jest.mock('../services/settingsColorPaletteService', () => ({ settingsColorPaletteService: { getActive: () => Promise.resolve(null) } }));
jest.mock('../components/common/LoadingModalGlobal', () => () => null);

const order = (id: string, accountNo: string, fullName: string, timestamp: string, concern = 'No Internet') => ({
  id, ticketId: `T-${id}`, accountNumber: accountNo, username: '', fullName, timestamp, concern,
  concernRemarks: 'details', supportStatus: 'Pending', supportRemarks: '', assignedEmail: '', visitRemarks: '',
  visitStatus: 'Pending', serviceCharge: '0', priorityLevel: 'Medium',
});

const signIn = (user: Record<string, any>) => localStorage.setItem('authData', JSON.stringify(user));

const describeDetails = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText('Describe your issue...'), { target: { value: text } });

const submitAndConfirm = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'SUBMIT TICKET' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
};

beforeEach(() => {
  mockCreated.length = 0;
  mockFetchCalls.length = 0;
  mockCreateResult = () => Promise.resolve({ success: true });
  mockAgentAccounts = () => Promise.resolve([]);
  mockOrders = [];
  localStorage.clear();
});

describe('as an agent', () => {
  beforeEach(() => {
    signIn({ role_id: 4, role: 'Agent', username: 'agent.ana', email: 'ana@agents.test' });
    mockAgentAccounts = () => Promise.resolve([
      { account_no: '1001', customer_name: 'Own Customer' },
      { account_no: '1002', customer_name: 'Second Customer' },
    ]);
  });

  it('offers only the accounts the server returns for the agent', async () => {
    render(<Support />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open options' }));
    expect(await screen.findByRole('option', { name: 'Select 1001 | Own Customer' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Select 1002 | Second Customer' })).toBeInTheDocument();
    // Only the two accounts — the Concern <select>'s own options are left out.
    expect(screen.getAllByRole('option', { name: /^Select / })).toHaveLength(2);
  });

  it('will not submit without an account, then submits the one picked', async () => {
    render(<Support />);
    describeDetails('Customer has no signal');

    fireEvent.click(screen.getByRole('button', { name: 'SUBMIT TICKET' }));
    expect(await screen.findByText('Select the account this ticket is for.')).toBeInTheDocument();
    expect(mockCreated).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Open options' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Select 1002 | Second Customer' }));
    await submitAndConfirm();

    await waitFor(() => expect(mockCreated).toHaveLength(1));
    expect(mockCreated[0]).toMatchObject({ account_no: '1002', concern: 'No Internet', concern_remarks: 'Customer has no signal', reject_if_open: true });
  });

  it('shows the server refusal when the account is not theirs', async () => {
    mockCreateResult = () => Promise.reject({
      response: { status: 403, data: { success: false, message: 'You can only raise a support ticket for a customer you referred.' } },
    });
    render(<Support />);
    describeDetails('x');
    fireEvent.click(await screen.findByRole('button', { name: 'Open options' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Select 1001 | Own Customer' }));
    await submitAndConfirm();

    expect(await screen.findByText('You can only raise a support ticket for a customer you referred.')).toBeInTheDocument();
  });

  it('names the customer when their account already has an open request', async () => {
    mockCreateResult = () => Promise.reject({
      response: { status: 422, data: { success: false, open_service_order: { ticket_id: '2026000042' } } },
    });
    render(<Support />);
    describeDetails('x');
    fireEvent.click(await screen.findByRole('button', { name: 'Open options' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Select 1001 | Own Customer' }));
    await submitAndConfirm();

    expect(await screen.findByText(/Account 1001 already has an open request \(Ticket 2026000042\)/)).toBeInTheDocument();
  });

  it('lists every ticket the server returns, with its account, and fetches without an account filter', async () => {
    mockOrders = [
      order('1', '1001', 'Own Customer', '2026-10-01T08:00:00'),
      order('2', '1002', 'Second Customer', '2026-10-05T08:00:00', 'Slow Internet'),
    ];
    render(<Support />);

    expect(await screen.findByText('Support Tickets')).toBeInTheDocument();
    expect(screen.getByText('T-1')).toBeInTheDocument();
    expect(screen.getByText('T-2')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByText('Second Customer')).toBeInTheDocument();

    await waitFor(() => expect(mockFetchCalls.length).toBeGreaterThan(0));
    expect(mockFetchCalls[0][3]).toBeUndefined();
  });

  it('says so when the accounts cannot be loaded', async () => {
    mockAgentAccounts = () => Promise.reject({ response: { data: { message: 'Only agents choose an account here.' } } });
    render(<Support />);

    expect(await screen.findByText('Only agents choose an account here.')).toBeInTheDocument();
  });
});

describe('as a customer', () => {
  beforeEach(() => signIn({ role_id: 3, role: 'Customer', username: '1001', email: 'cust@example.test' }));

  it('has no account field and raises the ticket for their own account', async () => {
    render(<Support />);

    expect(screen.queryByText('Account Number')).not.toBeInTheDocument();
    describeDetails('No signal');
    await submitAndConfirm();

    await waitFor(() => expect(mockCreated).toHaveLength(1));
    expect(mockCreated[0]).toMatchObject({ account_no: '1001', concern_remarks: 'No signal', reject_if_open: true });
  });

  it('still shows only their own latest request, fetched for their account', async () => {
    mockOrders = [
      order('1', '1001', 'Me', '2026-10-01T08:00:00'),
      order('2', '1001', 'Me', '2026-10-05T08:00:00'),
      order('3', '9999', 'Someone Else', '2026-10-06T08:00:00'),
    ];
    render(<Support />);

    expect(await screen.findByText('Latest Request')).toBeInTheDocument();
    expect(screen.getByText('T-2')).toBeInTheDocument();
    expect(screen.queryByText('T-1')).not.toBeInTheDocument();
    expect(screen.queryByText('T-3')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Account' })).not.toBeInTheDocument();

    await waitFor(() => expect(mockFetchCalls.length).toBeGreaterThan(0));
    expect(mockFetchCalls[0][3]).toBe('1001');
  });
});
