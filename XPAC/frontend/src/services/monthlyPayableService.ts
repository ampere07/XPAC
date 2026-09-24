import apiClient from '../config/api';

interface ApiResponse<T> {
  status: string;
  data: T;
  message?: string;
}

/**
 * Status lifecycle. Only `pending` and `cancelled` are ever sent to the server — the
 * other three are derived from the payment ledger and the due date, so writing them
 * from here would just be a lie the backend immediately overwrites.
 */
export type PayableStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled';

export const PAYABLE_STATUSES: { value: PayableStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Tailwind classes per status, shared by the table badge and the modals. */
export const STATUS_STYLES: Record<PayableStatus, string> = {
  pending: 'bg-amber-500/10 text-amber-500',
  partial: 'bg-sky-500/10 text-sky-500',
  paid: 'bg-emerald-500/10 text-emerald-500',
  overdue: 'bg-red-500/10 text-red-500',
  cancelled: 'bg-gray-500/10 text-gray-500',
};

export interface PayablePayment {
  id: number;
  payableId: number;
  amount: number;
  paymentDate: string;
  paymentDateRaw: string;
  paymentMethod: string;
  referenceNo: string;
  receiptPath?: string | null;
  notes: string;
  recordedBy: string;
  recordedAt: string;
}

export interface MonthlyPayable {
  id: number;
  title: string;
  categoryId: number;
  categoryName: string;
  vendorName: string;
  accountNumber: string;
  amountDue: number;
  amountPaid: number;
  balance: number;
  dueDate: string;
  dueDateRaw: string;
  billingMonth: string;
  status: PayableStatus;
  isRecurring: boolean;
  /** Past its due date and still owing — drives the red highlight, independent of status. */
  isPastDue: boolean;
  daysOverdue: number;
  notes: string;
  receiptPath?: string | null;
  createdBy: string;
  modifiedBy: string;
  updatedAt: string;
  paymentCount: number;
  payments: PayablePayment[];
}

export interface PayableSummary {
  total_due: number;
  total_paid: number;
  outstanding: number;
  total_count: number;
  overdue_count: number;
  overdue_amount: number;
  due_today: number;
  by_status: Record<PayableStatus, number>;
}

export interface PayableMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  billing_month: string;
}

export interface PayableFilters {
  /** 'YYYY-MM', or 'all' to lift the period restriction. Defaults server-side to this month. */
  billing_month?: string;
  status?: PayableStatus | '';
  category_id?: number | '';
  search?: string;
  page?: number;
  per_page?: number;
}

export interface PayableListResult {
  data: MonthlyPayable[];
  summary: PayableSummary;
  meta: PayableMeta;
}

export interface PayablePayload {
  title: string;
  category_id: number | null;
  vendor_name?: string;
  account_number?: string;
  amount_due: number | string;
  due_date: string;
  billing_month: string;
  is_recurring?: boolean;
  status?: 'pending' | 'cancelled';
  notes?: string;
  receipt?: File | null;
  receipt_path?: string;
}

export interface PaymentPayload {
  amount: number | string;
  payment_date: string;
  payment_method?: string;
  reference_no?: string;
  notes?: string;
  receipt?: File | null;
  receipt_path?: string;
}

export interface AlertCount {
  overdue: number;
  due_today: number;
  count: number;
}

const EMPTY_SUMMARY: PayableSummary = {
  total_due: 0,
  total_paid: 0,
  outstanding: 0,
  total_count: 0,
  overdue_count: 0,
  overdue_amount: 0,
  due_today: 0,
  by_status: { pending: 0, partial: 0, paid: 0, overdue: 0, cancelled: 0 },
};

/** 'YYYY-MM' for today, matching the backend's default billing period. */
export const currentBillingMonth = (): string => new Date().toISOString().slice(0, 7);

const toQueryParams = (filters?: PayableFilters): Record<string, string> => {
  const params: Record<string, string> = {};
  if (!filters) return params;

  if (filters.billing_month) params.billing_month = filters.billing_month;
  if (filters.status) params.status = filters.status;
  if (filters.category_id) params.category_id = String(filters.category_id);
  if (filters.search) params.search = filters.search;
  if (filters.page) params.page = String(filters.page);
  if (filters.per_page) params.per_page = String(filters.per_page);

  return params;
};

/**
 * Writes go out as multipart because a receipt may ride along. Blank optional fields are
 * skipped rather than sent as "" — FormData stringifies everything, and the backend's
 * nullable rules would otherwise see an empty string where they expect a date or a null.
 */
const appendOptional = (form: FormData, key: string, value: unknown): void => {
  if (value !== undefined && value !== null && value !== '') {
    form.append(key, String(value));
  }
};

const payableToFormData = (payload: PayablePayload): FormData => {
  const form = new FormData();

  form.append('title', payload.title);
  form.append('amount_due', String(payload.amount_due));
  form.append('due_date', payload.due_date);
  form.append('billing_month', payload.billing_month);
  // Always sent, both ways: omitting it on a toggle-off would leave the old value stood up.
  form.append('is_recurring', payload.is_recurring ? '1' : '0');

  if (payload.category_id) form.append('category_id', String(payload.category_id));
  if (payload.receipt) form.append('receipt', payload.receipt);

  appendOptional(form, 'vendor_name', payload.vendor_name);
  appendOptional(form, 'account_number', payload.account_number);
  appendOptional(form, 'status', payload.status);
  appendOptional(form, 'notes', payload.notes);
  appendOptional(form, 'receipt_path', payload.receipt_path);

  return form;
};

const paymentToFormData = (payload: PaymentPayload): FormData => {
  const form = new FormData();

  form.append('amount', String(payload.amount));
  form.append('payment_date', payload.payment_date);

  if (payload.receipt) form.append('receipt', payload.receipt);

  appendOptional(form, 'payment_method', payload.payment_method);
  appendOptional(form, 'reference_no', payload.reference_no);
  appendOptional(form, 'notes', payload.notes);
  appendOptional(form, 'receipt_path', payload.receipt_path);

  return form;
};

export const getMonthlyPayables = async (filters?: PayableFilters): Promise<PayableListResult> => {
  const response = await apiClient.get<ApiResponse<MonthlyPayable[]> & {
    summary: PayableSummary;
    meta: PayableMeta;
  }>('/monthly-payables', { params: toQueryParams(filters) });

  const payload = response.data;

  if (payload.status === 'success' && Array.isArray(payload.data)) {
    return {
      data: payload.data,
      summary: payload.summary ?? EMPTY_SUMMARY,
      meta: payload.meta,
    };
  }

  throw new Error(payload.message || 'Failed to load monthly payables');
};

/**
 * Feeds the sidebar badge. Swallows failures and reports zero on purpose — a badge that
 * cannot load must not surface an error over whatever page the user is actually on.
 */
export const getPayableAlertCount = async (): Promise<AlertCount> => {
  try {
    const response = await apiClient.get<ApiResponse<AlertCount>>('/monthly-payables/alert-count');
    if (response.data.status === 'success' && response.data.data) return response.data.data;
  } catch (error) {
    // Intentionally quiet.
  }
  return { overdue: 0, due_today: 0, count: 0 };
};

export const createMonthlyPayable = async (payload: PayablePayload): Promise<MonthlyPayable> => {
  const response = await apiClient.post<ApiResponse<MonthlyPayable>>(
    '/monthly-payables',
    payableToFormData(payload),
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );

  if (response.data.status === 'success' && response.data.data) return response.data.data;
  throw new Error(response.data.message || 'Failed to create payable');
};

export const updateMonthlyPayable = async (
  id: number,
  payload: PayablePayload
): Promise<MonthlyPayable> => {
  const form = payableToFormData(payload);
  // PHP does not populate $_FILES on a real PUT body, so multipart updates are POSTed
  // with a method override. The route accepts both.
  form.append('_method', 'PUT');

  const response = await apiClient.post<ApiResponse<MonthlyPayable>>(
    `/monthly-payables/${id}`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );

  if (response.data.status === 'success' && response.data.data) return response.data.data;
  throw new Error(response.data.message || 'Failed to update payable');
};

export const deleteMonthlyPayable = async (id: number): Promise<void> => {
  await apiClient.delete(`/monthly-payables/${id}`);
};

export const recordPayablePayment = async (
  id: number,
  payload: PaymentPayload
): Promise<MonthlyPayable> => {
  const response = await apiClient.post<ApiResponse<MonthlyPayable>>(
    `/monthly-payables/${id}/payments`,
    paymentToFormData(payload),
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );

  if (response.data.status === 'success' && response.data.data) return response.data.data;
  throw new Error(response.data.message || 'Failed to record payment');
};

export const deletePayablePayment = async (id: number, paymentId: number): Promise<void> => {
  await apiClient.delete(`/monthly-payables/${id}/payments/${paymentId}`);
};

export interface GenerateBatchResult {
  created: number;
  skipped: number;
  source_month: string;
  billing_month: string;
}

export const generateMonthlyBatch = async (
  billingMonth: string,
  sourceMonth?: string
): Promise<{ result: GenerateBatchResult; message: string }> => {
  const response = await apiClient.post<ApiResponse<GenerateBatchResult>>('/monthly-payables/generate', {
    billing_month: billingMonth,
    ...(sourceMonth ? { source_month: sourceMonth } : {}),
  });

  if (response.data.status === 'success' && response.data.data) {
    return { result: response.data.data, message: response.data.message || '' };
  }
  throw new Error(response.data.message || 'Failed to generate payables');
};
