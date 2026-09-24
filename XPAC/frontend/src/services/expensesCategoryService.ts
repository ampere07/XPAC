import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ExpensesCategory {
  id: number;
  name: string;
  created_at?: string;
  updated_at?: string;
  modified_by?: string;
  modified_date?: string;
  expense_count?: number;
  organization_id?: number | null;
}

export interface ExpensesCategoryPayload {
  name: string;
  modified_by?: string;
}

export const getExpensesCategories = async (): Promise<ExpensesCategory[]> => {
  try {
    const response = await apiClient.get<ApiResponse<ExpensesCategory[]>>('/expenses-categories');
    const payload = response.data as any;

    if (Array.isArray(payload)) return payload;
    if (payload?.success && Array.isArray(payload.data)) return payload.data;

    return [];
  } catch (error: any) {
    console.error('Error fetching expenses categories:', error);
    return [];
  }
};

export const getExpensesCategoryById = async (id: number): Promise<ExpensesCategory | null> => {
  try {
    const response = await apiClient.get<ApiResponse<ExpensesCategory>>(`/expenses-categories/${id}`);
    if (response.data.success && response.data.data) return response.data.data;
    return null;
  } catch (error: any) {
    console.error('Error fetching expenses category:', error);
    return null;
  }
};

export const createExpensesCategory = async (
  data: ExpensesCategoryPayload
): Promise<ExpensesCategory> => {
  const response = await apiClient.post<ApiResponse<ExpensesCategory>>('/expenses-categories', data);
  if (response.data.success && response.data.data) return response.data.data;
  throw new Error(response.data.message || 'Failed to create expenses category');
};

export const updateExpensesCategory = async (
  id: number,
  data: ExpensesCategoryPayload
): Promise<ExpensesCategory> => {
  const response = await apiClient.put<ApiResponse<ExpensesCategory>>(`/expenses-categories/${id}`, data);
  if (response.data.success && response.data.data) return response.data.data;
  throw new Error(response.data.message || 'Failed to update expenses category');
};

export const deleteExpensesCategory = async (id: number): Promise<void> => {
  await apiClient.delete(`/expenses-categories/${id}`);
};
