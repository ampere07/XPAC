import apiClient from '../config/api';

/** One referred customer billed on an agent invoice. */
export interface AgentInvoiceCustomer {
    id: number;
    application_id: number;
    job_order_id: number | null;
    customer_name: string;
    referred_by_agent_id: number | null;
    referred_by_name: string | null;
    installed_date: string | null;
    unit_price: number;
    quantity: number;
    total: number;
}

/** One week's referral invoice for a team or a solo agent. */
export interface AgentInvoiceRecord {
    id: number;
    invoice_number: string;
    invoice_type: 'team' | 'solo';
    team_id: number | null;
    team_name: string | null;
    agent_id: number | null;
    agent_name: string | null;
    billed_to: string;
    invoice_date: string | null;
    period_start: string | null;
    period_end: string | null;
    total_customers: number;
    unit_price: number;
    installation_fee: number;
    total_amount: number;
    commission: number;
    subtotal: number;
    status: string;
    has_pdf: boolean;
    /** Where the PDF is hosted, when one has been uploaded. */
    pdf_drive_url?: string | null;
    created_at: string | null;
    customers?: AgentInvoiceCustomer[];
}

/** One billing week that has invoices, for the download dialog's picker. */
export interface AgentInvoicePeriod {
    period_start: string;
    period_end: string;
    invoice_count: number;
    subtotal: number;
}

/**
 * Where an invoice's PDF came from.
 *
 * A Drive-hosted invoice answers with a link and is opened directly; a locally
 * rendered one (Drive unreachable) answers with bytes.
 */
export type PdfSource =
    | { kind: 'url'; url: string }
    | { kind: 'blob'; blob: Blob };

export interface AgentInvoiceListParams {
    search?: string;
    status?: string;
    type?: string;
    date_from?: string;
    date_to?: string;
    page?: number;
    /**
     * Page size. Counts billing periods when `group_by_period` is set, and
     * invoices otherwise.
     */
    per_page?: number;
    /**
     * Page by billing period instead of by invoice.
     *
     * The list renders as collapsible weeks, and paging by invoice splits a
     * week across two pages — its header then appears on both. With this set,
     * a page is N weeks and carries every invoice belonging to them.
     */
    group_by_period?: boolean;
}

/**
 * Reads the weekly agent referral invoices.
 *
 * Every endpoint is scoped server side to what the signed-in user may see, so
 * nothing here filters by agent or team — asking for an invoice that is not
 * theirs returns a 404 rather than somebody else's data.
 */
export const agentInvoiceService = {
    async list(params: AgentInvoiceListParams = {}) {
        const query = new URLSearchParams();

        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                query.append(key, String(value));
            }
        });

        const response = await apiClient.get(`/agent-invoices?${query.toString()}`);
        return response.data as {
            success: boolean;
            data: AgentInvoiceRecord[];
            meta: {
                current_page: number;
                last_page: number;
                per_page: number;
                /** Periods when `unit` is 'period', invoices when it is 'invoice'. */
                total: number;
                unit?: 'period' | 'invoice';
                /** Invoices on this page — only sent in period mode. */
                invoice_count?: number;
            };
        };
    },

    async get(id: number) {
        const response = await apiClient.get(`/agent-invoices/${id}`);
        return response.data as { success: boolean; data: AgentInvoiceRecord };
    },

    /**
     * The PDF as a blob, for viewing in a tab or saving.
     *
     * Fetched through the API client so the request carries the session — the
     * stored file is not reachable without one.
     */
    async pdfBlob(id: number, download = false): Promise<PdfSource> {
        const response = await apiClient.get(`/agent-invoices/${id}/pdf${download ? '?download=1' : ''}`, {
            responseType: 'blob',
        });

        const data = response.data as Blob;

        // The PDF normally lives on Google Drive, and the endpoint answers with
        // a link rather than bytes. That arrives here as a JSON blob because the
        // request asked for one, so it is read back out and reported as a link.
        // Bytes still come back when Drive was unreachable and the server fell
        // back to the local file.
        if (data && data.type && data.type.includes('application/json')) {
            const parsed = JSON.parse(await data.text());

            if (parsed?.url) {
                return { kind: 'url', url: parsed.url as string };
            }

            throw new Error(parsed?.message || 'The invoice PDF could not be opened.');
        }

        return { kind: 'blob', blob: data };
    },

    /**
     * The billing weeks that have invoices, newest first.
     *
     * Asked of the server rather than derived from the list on screen: the list
     * is one page, and the picker has to offer every week.
     */
    async periods() {
        const response = await apiClient.get('/agent-invoices/periods');
        return response.data as { success: boolean; data: AgentInvoicePeriod[] };
    },

    /**
     * Every invoice as one PDF — the whole set, or one billing week.
     *
     * Returned as a blob so the caller can hand it straight to a download. A
     * failure arrives as a JSON body inside that blob, which is why callers read
     * it back as text rather than trusting `err.response.data.message`.
     */
    async archiveBlob(periodStart?: string): Promise<Blob> {
        const response = await apiClient.get('/agent-invoices/archive', {
            params: periodStart ? { period_start: periodStart } : {},
            responseType: 'blob',
        });
        return response.data as Blob;
    },

    /**
     * Set one invoice's status — Generated, Paid or Unpaid.
     *
     * Administrators only; the server answers 403 otherwise. Sent and Cancelled
     * are still accepted so invoices already carrying them can be saved, they
     * are just no longer offered as choices. Returns the updated record.
     */
    async updateStatus(id: number, status: string) {
        const response = await apiClient.patch(`/agent-invoices/${id}/status`, { status });
        return response.data as { success: boolean; message?: string; data?: AgentInvoiceRecord };
    },

    /** Runs the weekly generation now. Administrators only; safe to repeat. */
    async generate(week?: string) {
        const response = await apiClient.post('/agent-invoices/generate', week ? { week } : {});
        return response.data as { success: boolean; message?: string; data?: Record<string, unknown> };
    },
};
