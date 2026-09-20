import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';
import { agentInvoiceService, AgentInvoicePeriod } from '../services/agentInvoiceService';

/**
 * Chooses what the download button downloads.
 *
 * Two modes: every invoice, or one billing week. The week list comes from the
 * server rather than from the rows on screen — the list is paginated, so
 * deriving it here would offer only the weeks that happen to be on the current
 * page.
 *
 * The document is built server side and arrives as one PDF, every invoice in
 * it. Fetching each invoice separately and saving them one by one would be
 * dozens of requests, and browsers block a page that starts more than a couple
 * of downloads.
 */

const formatDate = (value?: string | null): string => {
    if (!value) return '-';
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
};

const formatCurrency = (amount: number): string =>
    `₱${Number(amount || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;

interface AgentInvoiceDownloadModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type Mode = 'all' | 'period';

const Body: React.FC<{
    mode: Mode;
    setMode: (mode: Mode) => void;
    periods: AgentInvoicePeriod[];
    selectedPeriod: string;
    setSelectedPeriod: (value: string) => void;
    isLoadingPeriods: boolean;
    error: string | null;
}> = ({ mode, setMode, periods, selectedPeriod, setSelectedPeriod, isLoadingPeriods, error }) => {
    const { isDarkMode } = useModalTheme();

    const selectClass = `w-full px-4 py-2.5 rounded-lg border transition-all duration-200 outline-none focus:ring-2 focus:ring-opacity-50 ${
        isDarkMode
            ? 'bg-gray-800 text-white border-gray-700 focus:ring-blue-500/20'
            : 'bg-white text-gray-900 border-gray-200 focus:ring-blue-500/20'
    }`;

    const labelClass = `block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`;

    const chosen = periods.find(p => p.period_start === selectedPeriod);

    return (
        <div className="space-y-4">
            {error && (
                <div className={`p-3 border rounded-xl text-sm font-medium ${
                    isDarkMode ? 'bg-red-900/20 border-red-800/30 text-red-400' : 'bg-red-50 border-red-200 text-red-600'
                }`}>
                    {error}
                </div>
            )}

            <div>
                <label className={labelClass}>What to download</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={selectClass}>
                    <option value="all">Download all</option>
                    <option value="period">Specific date</option>
                </select>
            </div>

            {mode === 'period' && (
                <div>
                    <label className={labelClass}>Billing period</label>

                    {isLoadingPeriods ? (
                        <div className={`flex items-center gap-2 px-4 py-2.5 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading billing periods…
                        </div>
                    ) : periods.length === 0 ? (
                        <p className={`text-sm px-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            There are no invoices to download yet.
                        </p>
                    ) : (
                        <select
                            value={selectedPeriod}
                            onChange={(e) => setSelectedPeriod(e.target.value)}
                            className={selectClass}
                        >
                            {periods.map(period => (
                                <option key={period.period_start} value={period.period_start}>
                                    {formatDate(period.period_start)} – {formatDate(period.period_end)}
                                    {'  ·  '}
                                    {period.invoice_count} {period.invoice_count === 1 ? 'invoice' : 'invoices'}
                                </option>
                            ))}
                        </select>
                    )}

                    {chosen && (
                        <p className={`text-xs mt-2 px-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            {chosen.invoice_count} {chosen.invoice_count === 1 ? 'invoice' : 'invoices'},
                            {' '}subtotal {formatCurrency(chosen.subtotal)}
                        </p>
                    )}
                </div>
            )}

            <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                The invoices arrive as one PDF, each starting on a new page.
            </p>
        </div>
    );
};

const AgentInvoiceDownloadModal: React.FC<AgentInvoiceDownloadModalProps> = ({ isOpen, onClose }) => {
    const [mode, setMode] = useState<Mode>('all');
    const [periods, setPeriods] = useState<AgentInvoicePeriod[]>([]);
    const [selectedPeriod, setSelectedPeriod] = useState('');
    const [isLoadingPeriods, setIsLoadingPeriods] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetched when the dialog opens rather than with the page: most visits never
    // open it, and a week added since the page loaded should still appear.
    useEffect(() => {
        if (!isOpen) return;

        setMode('all');
        setError(null);
        setIsLoadingPeriods(true);

        let cancelled = false;

        agentInvoiceService.periods()
            .then(response => {
                if (cancelled) return;
                const list = response?.success ? response.data ?? [] : [];
                setPeriods(list);
                setSelectedPeriod(list[0]?.period_start ?? '');
            })
            .catch(() => {
                if (!cancelled) setError('The billing periods could not be loaded.');
            })
            .finally(() => {
                if (!cancelled) setIsLoadingPeriods(false);
            });

        return () => { cancelled = true; };
    }, [isOpen]);

    /** Read the server's message out of a failed blob request. */
    const messageFromBlobError = async (err: any): Promise<string | null> => {
        const data = err?.response?.data;

        if (!(data instanceof Blob)) {
            return err?.response?.data?.message ?? null;
        }

        try {
            const parsed = JSON.parse(await data.text());
            return parsed?.message || parsed?.error || null;
        } catch {
            return null;
        }
    };

    const handleDownload = async () => {
        if (isDownloading) return;
        if (mode === 'period' && !selectedPeriod) {
            setError('Choose a billing period first.');
            return;
        }

        setIsDownloading(true);
        setError(null);

        try {
            const blob = await agentInvoiceService.archiveBlob(mode === 'period' ? selectedPeriod : undefined);
            const url = window.URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = mode === 'period'
                ? `agent-invoices-${selectedPeriod}.pdf`
                : 'agent-invoices-all.pdf';
            document.body.appendChild(link);
            link.click();
            link.remove();

            // Released on the next tick so the browser has taken the reference.
            window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);

            onClose();
        } catch (err: any) {
            setError(await messageFromBlobError(err) || 'The invoices could not be downloaded.');
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <ModalUITemplate
            isOpen={isOpen}
            onClose={onClose}
            title="Download invoices"
            loading={isDownloading}
            maxWidth="max-w-md"
            primaryAction={{
                label: isDownloading ? 'Preparing…' : 'Download',
                onClick: handleDownload,
                disabled: isDownloading || (mode === 'period' && (isLoadingPeriods || periods.length === 0)),
            }}
        >
            <Body
                mode={mode}
                setMode={setMode}
                periods={periods}
                selectedPeriod={selectedPeriod}
                setSelectedPeriod={setSelectedPeriod}
                isLoadingPeriods={isLoadingPeriods}
                error={error}
            />
        </ModalUITemplate>
    );
};

export default AgentInvoiceDownloadModal;
