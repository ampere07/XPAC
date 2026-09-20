import * as ExpoFileSystem from 'expo-file-system/legacy';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { API_BASE_URL } from '../config/api';

/**
 * Weekly agent referral invoices.
 *
 * The JSON half of this is the web portal's service unchanged — same endpoints,
 * same shapes — because both clients read the same API. The PDF half is not, and
 * could not be: the web version asks axios for a Blob, builds an object URL and
 * hands it to a new tab. React Native has no object URLs and axios cannot
 * reliably produce a Blob here, so the PDF is fetched with expo-file-system
 * instead and opened the way a phone opens things. See openPdf().
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

/** The headers the API expects, both spellings — see config/api.ts. */
const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await AsyncStorage.getItem('authToken');
    if (!token) return {};

    // Authorization is stripped by part of the chain between the phone and PHP,
    // which is why config/api.ts sends X-Auth-Token beside it. A download made
    // outside axios has to carry both for the same reason.
    return {
        Authorization: `Bearer ${token}`,
        'X-Auth-Token': token,
    };
};

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
     * The endpoint answers one of two ways. Normally the file is on Google
     * Drive and it replies with JSON naming the link, which opens in the
     * device browser. When Drive was unreachable the server renders the PDF
     * itself and replies with bytes.
     *
     * Both arrive here as a downloaded file, because that is the one fetch that
     * works for either: expo-file-system carries the auth headers and writes
     * whatever comes back, and the Content-Type then says which it was. Asking
     * axios for a blob — what the web client does — is what does not work on
     * this platform.
     */
    async openPdf(record: AgentInvoiceRecord): Promise<PdfOutcome> {
        const target = `${ExpoFileSystem.cacheDirectory}invoice-${record.id}.pdf`;

        try {
            const result = await ExpoFileSystem.downloadAsync(
                `${API_BASE_URL}/agent-invoices/${record.id}/pdf`,
                target,
                { headers: await authHeaders() }
            );

            const contentType = String(
                result.headers?.['content-type'] ?? result.headers?.['Content-Type'] ?? ''
            ).toLowerCase();

            // A JSON body is either the Drive link or an error explaining why
            // there is no file. Both are read out of the downloaded file rather
            // than guessed at from the status code.
            if (contentType.includes('application/json')) {
                const body = await ExpoFileSystem.readAsStringAsync(result.uri);
                const parsed = JSON.parse(body);

                if (parsed?.url) {
                    await WebBrowser.openBrowserAsync(parsed.url as string);
                    return { kind: 'opened', url: parsed.url as string };
                }

                return { kind: 'failed', message: parsed?.message || 'The invoice PDF could not be opened.' };
            }

            if (result.status >= 400) {
                return { kind: 'failed', message: `The invoice PDF could not be opened (HTTP ${result.status}).` };
            }

            return { kind: 'saved', uri: result.uri };
        } catch (error: any) {
            return { kind: 'failed', message: error?.message || 'The invoice PDF could not be opened.' };
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
