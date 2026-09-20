import apiClient from '../config/api';

/**
 * The Reports API, in one place.
 *
 * Reports.tsx and AddReportModal.tsx previously called `apiClient` inline, which meant
 * the request shapes lived in two components and drifted from each other. Everything
 * the reporting screens need now goes through here, the way every other module in this
 * app is wired.
 */

export interface ReportRecord {
    id: number;
    report_name: string;
    report_type: string;
    report_schedule: string;
    report_weekday?: string | null;
    report_month?: number | null;
    day?: string | null;
    report_time?: string | null;
    date_range?: string | null;
    send_to?: string | null;
    is_active?: boolean | number | null;
    last_dispatched_at?: string | null;
    last_period_end?: string | null;
    created_by?: string | null;
    created_at?: string | null;
    file_url?: string | null;
    csv_file_url?: string | null;
}

/** The draft a preview is rendered from, before any report exists. */
export interface ReportDraft {
    report_name?: string;
    report_type: string;
    /** "YYYY-MM-DD to YYYY-MM-DD". */
    date_range: string;
}

const BASE = '/reports';

/**
 * A PDF response turned into an object URL the browser can display inline.
 *
 * The endpoints are authenticated, so an <iframe src="/api/..."> would be an
 * unauthenticated request and render a 401 page instead of the document. Fetching it
 * through the configured client and wrapping the bytes in a blob URL is what lets the
 * preview appear inside the app.
 *
 * The caller owns the returned URL and must revokeObjectURL it, or the PDF stays in
 * memory for the lifetime of the tab - a report is not a small object.
 */
const toBlobUrl = (data: BlobPart): string =>
    window.URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));

/**
 * Pull a readable message out of a failed blob request.
 *
 * These endpoints answer with a PDF on success and JSON on failure, and because the
 * request asks for a blob the error body arrives as a Blob too - so it has to be read
 * back as text before the message inside it can be surfaced. Without this the operator
 * saw "Request failed with status code 500" instead of what actually broke.
 */
const readBlobError = async (error: any): Promise<string> => {
    const payload = error?.response?.data;

    if (payload instanceof Blob) {
        try {
            const parsed = JSON.parse(await payload.text());
            if (parsed?.message) return String(parsed.message);
        } catch {
            // Not JSON - fall through to the generic message below.
        }
    }

    return payload?.message || error?.message || 'The preview could not be generated.';
};

export const reportService = {
    list: async (): Promise<ReportRecord[]> => {
        const response = await apiClient.get<{ success: boolean; data: ReportRecord[] }>(BASE);
        return response.data.data ?? [];
    },

    options: async (): Promise<any> => {
        const response = await apiClient.get<{ success: boolean; data: any }>(`${BASE}/options`);
        return response.data.data;
    },

    create: (payload: Record<string, any>) => apiClient.post(BASE, payload),

    update: (id: number, payload: Record<string, any>) => apiClient.put(`${BASE}/${id}`, payload),

    remove: (id: number) => apiClient.delete(`${BASE}/${id}`),

    sendNow: (id: number) => apiClient.post(`${BASE}/${id}/send-now`),

    regenerate: (id: number) => apiClient.post(`${BASE}/${id}/regenerate`),

    dispatches: async (id: number): Promise<any[]> => {
        const response = await apiClient.get<{ success: boolean; data: any[] }>(`${BASE}/${id}/dispatches`);
        return response.data.data ?? [];
    },

    getSettings: async (): Promise<{ auto_send_enabled: boolean }> => {
        const response = await apiClient.get<{ success: boolean; data: any }>(`${BASE}/settings`);
        return response.data.data;
    },

    updateSettings: (payload: Record<string, any>) => apiClient.put(`${BASE}/settings`, payload),

    /** Render a saved report and return a blob URL for inline display. */
    previewSaved: async (id: number): Promise<string> => {
        try {
            const response = await apiClient.get(`${BASE}/${id}/preview`, { responseType: 'blob' });
            return toBlobUrl(response.data as BlobPart);
        } catch (error) {
            throw new Error(await readBlobError(error));
        }
    },

    /**
     * Render a report that does not exist yet, from the form's current values.
     *
     * Nothing is persisted and nobody is emailed - this is only ever a look at the
     * document, rendered by the same service that produces the real one.
     */
    previewDraft: async (draft: ReportDraft): Promise<string> => {
        try {
            const response = await apiClient.post(`${BASE}/preview`, draft, { responseType: 'blob' });
            return toBlobUrl(response.data as BlobPart);
        } catch (error) {
            throw new Error(await readBlobError(error));
        }
    },

    /** Release a blob URL returned by either preview call. */
    releasePreview: (url: string | null): void => {
        if (url) window.URL.revokeObjectURL(url);
    },
};
