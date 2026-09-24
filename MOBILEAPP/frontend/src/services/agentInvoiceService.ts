import * as WebBrowser from 'expo-web-browser';
import apiClient from '../config/api';

/**
 * Weekly agent referral invoices.
 *
 * The JSON half of this is the web portal's service unchanged — same endpoints,
 * same shapes — because both clients read the same API. The PDF half differs: the
 * phone opens the invoice's Drive link in the device browser. See openPdf().
 */

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

export interface AgentInvoiceListParams {
    search?: string;
    type?: string;
    page?: number;
    per_page?: number;
    group_by_period?: boolean;
}

/**
 * What opening a PDF did.
 *
 * `opened` — handed to the browser, nothing else to do.
 * `saved`  — the server sent bytes rather than a link, so the file is on the
 *            device at `uri` and the caller reports where. Without a share
 *            sheet available there is nothing further this can do with it, and
 *            saying so is better than a spinner that ends in silence.
 * `failed` — with the server's own message where it gave one.
 */
export type PdfOutcome =
    | { kind: 'opened'; url: string }
    | { kind: 'saved'; uri: string }
    | { kind: 'failed'; message: string };

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
                total: number;
                unit?: 'period' | 'invoice';
                invoice_count?: number;
            };
        };
    },

    async get(id: number) {
        const response = await apiClient.get(`/agent-invoices/${id}`);
        return response.data as { success: boolean; data: AgentInvoiceRecord };
    },

    /**
     * Open one invoice's PDF.
     *
     * The GOWISER API answers with JSON naming the invoice's Google Drive link
     * (rendering and uploading it first when needed), which opens in the device
     * browser. It is fetched through apiClient so the session cookie goes with
     * it: GOWISER authenticates by session, and a bare download carrying only a
     * token header would be refused.
     */
    async openPdf(record: AgentInvoiceRecord): Promise<PdfOutcome> {
        try {
            const response = await apiClient.get(`/agent-invoices/${record.id}/pdf`);
            const url = response.data?.url as string | undefined;

            if (url) {
                await WebBrowser.openBrowserAsync(url);
                return { kind: 'opened', url };
            }

            return { kind: 'failed', message: response.data?.message || 'The invoice PDF could not be opened.' };
        } catch (error: any) {
            return {
                kind: 'failed',
                message: error?.response?.data?.message || error?.message || 'The invoice PDF could not be opened.',
            };
        }
    },

    /**
     * The billing weeks that have invoices, newest first.
     *
     * Asked of the server rather than derived from the list on screen: the list
     * is one page, and a picker has to offer every week.
     */
    async periods() {
        const response = await apiClient.get('/agent-invoices/periods');
        return response.data as { success: boolean; data: AgentInvoicePeriod[] };
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

export default agentInvoiceService;
