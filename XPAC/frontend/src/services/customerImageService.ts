import apiClient from '../config/api';

/** One image stored against a customer, with where it came from. */
export interface CustomerImage {
  id: string;
  /** The stored link. */
  url: string;
  /** Small preview for the grid. */
  thumbnail_url: string;
  /** Large version for the full-screen viewer. */
  full_url: string;
  /** Tried when full_url / thumbnail_url will not load (the server-side Drive proxy). */
  fallback_url: string | null;
  /** Where "Open original" goes. */
  open_url: string;
  /** e.g. "Service Order", "Customer Profile", "LCP/NAP". */
  source: string;
  source_key: string;
  table: string;
  record_id: number | string;
  field: string;
  /** e.g. "Speed Test", "Government ID". */
  field_label: string;
  date: string | null;
}

export interface CustomerImageFolder {
  account_no: string;
  full_name: string | null;
  image_count: number;
  cover: string | null;
  sources: string[];
}

export interface CustomerImageSource {
  key: string;
  label: string;
}

export interface CustomerImageListResponse {
  data: CustomerImageFolder[];
  total: number;
  page: number;
  per_page: number;
  last_page: number;
  sources: CustomerImageSource[];
}

export const customerImageService = {
  async list(params: { search?: string; page?: number; perPage?: number; withImages?: boolean }): Promise<CustomerImageListResponse> {
    const response = await apiClient.get<{ success: boolean; message?: string } & CustomerImageListResponse>('/customer-images', {
      params: {
        search: params.search || undefined,
        page: params.page ?? 1,
        per_page: params.perPage ?? 24,
        with_images: params.withImages === false ? '0' : '1',
      },
    });
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to load customer images');
    }
    return response.data;
  },

  async forCustomer(accountNo: string): Promise<{ account_no: string; full_name: string | null; images: CustomerImage[] }> {
    const response = await apiClient.get<{ success: boolean; message?: string; data: { account_no: string; full_name: string | null; images: CustomerImage[] } }>(
      `/customer-images/${encodeURIComponent(accountNo)}`
    );
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to load images');
    }
    return response.data.data;
  },
};
