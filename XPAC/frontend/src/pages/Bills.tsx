import React, { useState, useEffect } from 'react';
import { Download, FileText, CreditCard, Clock, Activity, CheckCircle, AlertCircle, File, DollarSign, Loader, X } from 'lucide-react';
import apiClient from '../config/api';
import { soaService } from '../services/soaService';
import { invoiceService } from '../services/invoiceService';
import { paymentPortalLogsService } from '../services/paymentPortalLogsService';
import { transactionService } from '../services/transactionService';
import { paymentService, PendingPayment } from '../services/paymentService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useCustomerDashboardStore } from '../store/customerDashboardStore';
import pusher from '../services/pusherService';

// Interfaces
interface SOARecord {
    id: number;
    statement_date?: string;
    statement_no?: string; // Derived or mapped
    print_link?: string;
    total_amount_due?: number;
}

interface InvoiceRecord {
    id: number;
    invoice_date?: string;
    invoice_balance?: number;
    print_link?: string; // Might not exist yet
    status?: string;
}

interface PaymentRecord {
    id: string;
    date: string;
    reference: string;
    amount: number;
    source: 'Online' | 'Manual';
    status?: string;
}

interface BillsProps {
    initialTab?: 'soa' | 'invoices' | 'payments' | 'service-charges';
    onNavigate?: (section: string, tab?: string) => void;
}

const Bills: React.FC<BillsProps> = ({ initialTab = 'soa', onNavigate }) => {
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'soa' | 'invoices' | 'payments' | 'service-charges'>(initialTab);
    const [displayName, setDisplayName] = useState('');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

    const { soaRecords, invoiceRecords, paymentRecords, serviceChargeRecords, customerDetail, isLoading, fetchCustomerData } = useCustomerDashboardStore();

    const accountNo = customerDetail?.billingAccount?.accountNo || '';
    const balance = customerDetail?.billingAccount?.accountBalance || 0;

    // Pagination States
    const [soaPage, setSoaPage] = useState(1);
    const [invoicePage, setInvoicePage] = useState(1);
    const [paymentPage, setPaymentPage] = useState(1);
    const [serviceChargePage, setServiceChargePage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    // Payment State (Mirrored from Dashboard)
    const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
    const [showPaymentVerifyModal, setShowPaymentVerifyModal] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState(0);
    const [showPaymentLinkModal, setShowPaymentLinkModal] = useState(false);
    const [paymentLinkData, setPaymentLinkData] = useState<{ referenceNo: string; amount: number; paymentUrl: string } | null>(null);
    const [showPendingPaymentModal, setShowPendingPaymentModal] = useState(false);
    const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
    const [errorMessage, setErrorMessage] = useState('');

    // PDF Generation State
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const [generatingPdfId, setGeneratingPdfId] = useState<number | null>(null);
    const [pdfError, setPdfError] = useState<string | null>(null);

    const isGoogleDriveLink = (url: string | null | undefined): boolean => {
        if (!url) return false;
        return url.includes('drive.google.com') || url.includes('docs.google.com');
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                const storedUser = localStorage.getItem('authData');
                if (storedUser) {
                    const parsedUser = JSON.parse(storedUser);
                    setDisplayName(parsedUser.full_name || 'Customer');

                    if (parsedUser.username) {
                        await fetchCustomerData(parsedUser.username, parsedUser.role === 'customer');

                        const updatedDetail = useCustomerDashboardStore.getState().customerDetail;
                        if (updatedDetail && updatedDetail.billingAccount) {
                            try {
                                const accNo = updatedDetail.billingAccount.accountNo;
                                const pending = await paymentService.checkPendingPayment(accNo);
                                setPendingPayment(pending);
                            } catch (pendingErr) {
                                console.error("Error checking pending payment on load:", pendingErr);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Error fetching bills data:", err);
            } finally {
                setLoading(false);
            }
        };

        const fetchColorPalette = async () => {
            try {
                const activePalette = await settingsColorPaletteService.getActive();
                setColorPalette(activePalette);
            } catch (err) {
                console.error('Failed to fetch color palette:', err);
            }
        };

        fetchData();
        fetchColorPalette();
    }, []);

    // Real-time updates via Pusher/Soketi
    useEffect(() => {
        const handleUpdate = async (data: any) => {
            console.log('[Bills Soketi] Update received, refreshing:', data);
            try {
                const storedUser = localStorage.getItem('authData');
                if (storedUser) {
                    const parsedUser = JSON.parse(storedUser);
                    if (parsedUser.username) {
                        await fetchCustomerData(parsedUser.username, parsedUser.role === 'customer');
                        console.log('[Bills Soketi] Data refreshed successfully');
                    }
                }
            } catch (err) {
                console.error('[Bills Soketi] Failed to refresh data:', err);
            }
        };

        const txChannel = pusher.subscribe('transactions');
        const invChannel = pusher.subscribe('invoices');
        const soaChannel = pusher.subscribe('soa');
        const payChannel = pusher.subscribe('payments');

        txChannel.bind('transaction-updated', handleUpdate);
        invChannel.bind('invoice-updated', handleUpdate);
        soaChannel.bind('soa-updated', handleUpdate);
        payChannel.bind('payment-updated', handleUpdate);

        return () => {
            txChannel.unbind('transaction-updated', handleUpdate);
            invChannel.unbind('invoice-updated', handleUpdate);
            soaChannel.unbind('soa-updated', handleUpdate);
            payChannel.unbind('payment-updated', handleUpdate);
            pusher.unsubscribe('transactions');
            pusher.unsubscribe('invoices');
            pusher.unsubscribe('soa');
            pusher.unsubscribe('payments');
        };
    }, [fetchCustomerData]);

    // Restriction logic removed as requested

    useEffect(() => {
        if (initialTab) {
            setActiveTab(initialTab);
        }
    }, [initialTab]);

    // --- Payment Handlers (Redirect to Dashboard) ---
    const handlePayNow = () => {
        if (onNavigate) {
            onNavigate('customer-dashboard', 'paynow');
        }
    };



    const handleSOADownloadPDF = async (record: SOARecord) => {
        const linkToCheck = record.print_link;

        if (isGoogleDriveLink(linkToCheck)) {
            window.open(linkToCheck as string, '_blank', 'noopener,noreferrer');
            return;
        }

        try {
            setGeneratingPdfId(record.id);
            setIsGeneratingPdf(true);
            setPdfError(null);

            const response = await apiClient.post<{ success: boolean; print_link?: string; message?: string; error?: string }>(
                `/soa/${record.id}/generate-pdf`
            );

            if (response.data.success && response.data.print_link) {
                try {
                    const storedUser = localStorage.getItem('authData');
                    if (storedUser) {
                        const parsedUser = JSON.parse(storedUser);
                        if (parsedUser.username) {
                            await fetchCustomerData(parsedUser.username, parsedUser.role === 'customer');
                        }
                    }
                } catch (refreshErr) {
                    console.error('Failed to refresh data after PDF generation:', refreshErr);
                }
                
                setIsGeneratingPdf(false);
                setGeneratingPdfId(null);
                window.open(response.data.print_link, '_blank', 'noopener,noreferrer');
            } else {
                setIsGeneratingPdf(false);
                setGeneratingPdfId(null);
                setPdfError(response.data.message || 'Failed to generate PDF');
            }
        } catch (err: any) {
            console.error('Error generating SOA PDF:', err);
            setIsGeneratingPdf(false);
            setGeneratingPdfId(null);
            setPdfError(err?.response?.data?.message || err?.message || 'Failed to generate PDF. Please try again.');
        }
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        
        // Extract YYYY-MM-DD directly from string to prevent timezone shifts
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
            const [, yyyy, mm, dd] = match;
            return `${mm}/${dd}/${yyyy}`;
        }

        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return dateStr;
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            const yyyy = date.getFullYear();
            return `${mm}/${dd}/${yyyy}`;
        } catch (e) {
            return dateStr;
        }
    };

    const formatCurrency = (amount?: number) => {
        return `₱ ${(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
    };

    const currentSoaRecords = soaRecords.slice((soaPage - 1) * ITEMS_PER_PAGE, soaPage * ITEMS_PER_PAGE);
    const totalSoaPages = Math.ceil(soaRecords.length / ITEMS_PER_PAGE);

    const currentInvoiceRecords = invoiceRecords.slice((invoicePage - 1) * ITEMS_PER_PAGE, invoicePage * ITEMS_PER_PAGE);
    const totalInvoicePages = Math.ceil(invoiceRecords.length / ITEMS_PER_PAGE);

    const currentPaymentRecords = paymentRecords.slice((paymentPage - 1) * ITEMS_PER_PAGE, paymentPage * ITEMS_PER_PAGE);
    const totalPaymentPages = Math.ceil(paymentRecords.length / ITEMS_PER_PAGE);

    const currentServiceChargeRecords = serviceChargeRecords.slice((serviceChargePage - 1) * ITEMS_PER_PAGE, serviceChargePage * ITEMS_PER_PAGE);
    const totalServiceChargePages = Math.ceil(serviceChargeRecords.length / ITEMS_PER_PAGE);

    if (loading) return <div className="p-8 flex justify-center bg-gray-50 min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div></div>;

    return (
        <div className="p-4 md:p-12 min-h-screen bg-gray-50 font-sans">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div className="w-full">
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Billing History</h1>
                    <p className="text-gray-500 mt-1 text-sm md:text-base">View your statements and payment records.</p>
                </div>
                <button
                    onClick={handlePayNow}
                    disabled={isPaymentProcessing}
                    className="w-full md:w-auto flex flex-col items-center justify-center text-white px-6 py-3 rounded-full font-bold transition disabled:opacity-50 leading-tight"
                    style={{ backgroundColor: colorPalette?.primary || '#0f172a' }}
                >
                    <div className="flex items-center space-x-2">
                        <CreditCard className="w-5 h-5" />
                        <span>{isPaymentProcessing ? 'PROCESSING' : (pendingPayment && pendingPayment.payment_url) ? 'PROCEED PAYMENT' : 'PAY NOW'}</span>
                    </div>
                </button>
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-t-2xl border-b border-gray-200 px-4 md:px-6 pt-2 overflow-x-auto no-scrollbar">
                <div className="flex space-x-6 md:space-x-8 min-w-max">
                    <button
                        onClick={() => setActiveTab('soa')}
                        className={`pb-4 px-1 md:px-2 text-sm font-bold flex items-center space-x-2 border-b-2 transition whitespace-nowrap ${activeTab === 'soa' ? 'text-slate-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                        style={{ borderBottomColor: activeTab === 'soa' ? (colorPalette?.primary || '#0f172a') : 'transparent' }}
                    >
                        <FileText className="w-4 h-4" />
                        <span>Statement of Account</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('invoices')}
                        className={`pb-4 px-1 md:px-2 text-sm font-bold flex items-center space-x-2 border-b-2 transition whitespace-nowrap ${activeTab === 'invoices' ? 'text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                        style={{ borderBottomColor: activeTab === 'invoices' ? (colorPalette?.primary || '#2563eb') : 'transparent' }}
                    >
                        <File className="w-4 h-4" />
                        <span>Invoices</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('payments')}
                        className={`pb-4 px-1 md:px-2 text-sm font-bold flex items-center space-x-2 border-b-2 transition whitespace-nowrap ${activeTab === 'payments' ? 'text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                        style={{ borderBottomColor: activeTab === 'payments' ? (colorPalette?.primary || '#2563eb') : 'transparent' }}
                    >
                        <Clock className="w-4 h-4" />
                        <span>Payment History</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('service-charges')}
                        className={`pb-4 px-1 md:px-2 text-sm font-bold flex items-center space-x-2 border-b-2 transition whitespace-nowrap ${activeTab === 'service-charges' ? 'text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                        style={{ borderBottomColor: activeTab === 'service-charges' ? (colorPalette?.primary || '#2563eb') : 'transparent' }}
                    >
                        <DollarSign className="w-4 h-4" />
                        <span>Service Charges</span>
                    </button>
                </div>
            </div>

            {/* Content Content */}
            <div className="bg-white rounded-b-2xl shadow-sm border border-gray-100 border-t-0 overflow-hidden min-h-[400px]">
                {activeTab === 'soa' && (
                    <div className="w-full">
                        {/* Mobile List View */}
                        <div className="md:hidden">
                            {currentSoaRecords.length === 0 ? (
                                <div className="p-8 text-center text-gray-500">No statements found.</div>
                            ) : (
                                currentSoaRecords.map((record) => (
                                    <div key={record.id} className="p-4 border-b border-gray-100 last:border-0">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <p className="text-xs font-bold text-gray-400 uppercase">Date</p>
                                                <p className="text-sm text-gray-700">{formatDate(record.statement_date)}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs font-bold text-gray-400 uppercase">Amount Due</p>
                                                <p className="text-sm font-bold text-gray-900">{formatCurrency(record.total_amount_due)}</p>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center mt-3">
                                            <p className="text-sm font-medium text-gray-500">Ref: {record.id}</p>
                                            <button
                                                onClick={() => handleSOADownloadPDF(record)}
                                                disabled={generatingPdfId === record.id}
                                                className="inline-flex items-center space-x-2 px-4 py-2 border border-red-500 text-red-500 rounded-full text-xs font-bold hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {generatingPdfId === record.id ? <Loader className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                                <span>{generatingPdfId === record.id ? 'Wait...' : 'PDF'}</span>
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Statement Date</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Statement No</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Amount Due</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {currentSoaRecords.length === 0 ? (
                                        <tr><td colSpan={4} className="p-8 text-center text-gray-500">No statements found.</td></tr>
                                    ) : (
                                        currentSoaRecords.map((record) => (
                                            <tr key={record.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                                                <td className="p-6 text-sm text-gray-600">{formatDate(record.statement_date)}</td>
                                                <td className="p-6 text-sm font-bold text-gray-900">{record.id}</td>
                                                <td className="p-6 text-sm font-bold text-gray-900">{formatCurrency(record.total_amount_due)}</td>
                                                <td className="p-6 text-right">
                                                    <button
                                                        onClick={() => handleSOADownloadPDF(record)}
                                                        disabled={generatingPdfId === record.id}
                                                        className="inline-flex items-center space-x-2 px-4 py-2 border border-red-500 text-red-500 rounded-full text-xs font-bold hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                                                    >
                                                        {generatingPdfId === record.id ? <Loader className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                                        <span>{generatingPdfId === record.id ? 'Generating...' : 'Download PDF'}</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* SOA Pagination */}
                        {totalSoaPages > 1 && (
                            <div className="flex justify-center items-center p-4 border-t border-gray-100 gap-4">
                                <button
                                    onClick={() => setSoaPage(prev => Math.max(prev - 1, 1))}
                                    disabled={soaPage === 1}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition font-bold"
                                >
                                    &lt;
                                </button>
                                <span className="text-sm font-medium text-gray-600">
                                    Page {soaPage} of {totalSoaPages}
                                </span>
                                <button
                                    onClick={() => setSoaPage(prev => Math.min(prev + 1, totalSoaPages))}
                                    disabled={soaPage === totalSoaPages}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition font-bold"
                                >
                                    &gt;
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'invoices' && (
                    <div className="w-full">
                        {/* Mobile List View */}
                        <div className="md:hidden">
                            {currentInvoiceRecords.length === 0 ? (
                                <div className="p-8 text-center text-gray-500">No invoices found.</div>
                            ) : (
                                currentInvoiceRecords.map((record) => (
                                    <div key={record.id} className="p-4 border-b border-gray-100 last:border-0">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <p className="text-xs font-bold text-gray-400 uppercase">Date</p>
                                                <p className="text-sm text-gray-700">{formatDate(record.invoice_date)}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs font-bold text-gray-400 uppercase">Amount</p>
                                                <p className="text-sm font-bold text-gray-900">{formatCurrency(record.invoice_balance)}</p>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center mt-3">
                                            <p className="text-sm font-medium text-gray-500">Ref: {record.id}</p>
                                            <span className={`px-2 py-1 rounded text-xs font-bold ${
                                                record.status === 'Paid' || record.status === 'Completed' ? 'bg-green-100 text-green-700' : 
                                                record.status === 'Partial' ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-red-100 text-red-700'
                                            }`}>
                                                {record.status || 'Unpaid'}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Invoice Date</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Invoice Ref</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Amount</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase text-right">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {currentInvoiceRecords.length === 0 ? (
                                        <tr><td colSpan={4} className="p-8 text-center text-gray-500">No invoices found.</td></tr>
                                    ) : (
                                        currentInvoiceRecords.map((record) => (
                                            <tr key={record.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                                                <td className="p-6 text-sm text-gray-600">{formatDate(record.invoice_date)}</td>
                                                <td className="p-6 text-sm font-bold text-gray-900">{record.id}</td>
                                                <td className="p-6 text-sm font-bold text-gray-900">{formatCurrency(record.invoice_balance)}</td>
                                                <td className="p-6 text-right">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                                                        record.status === 'Paid' || record.status === 'Completed' ? 'bg-green-100 text-green-700' : 
                                                        record.status === 'Partial' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-red-100 text-red-700'
                                                    }`}>
                                                        {record.status || 'Unpaid'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Invoices Pagination */}
                        {totalInvoicePages > 1 && (
                            <div className="flex justify-center items-center p-4 border-t border-gray-100 gap-4">
                                <button
                                    onClick={() => setInvoicePage(prev => Math.max(prev - 1, 1))}
                                    disabled={invoicePage === 1}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition font-bold"
                                >
                                    &lt;
                                </button>
                                <span className="text-sm font-medium text-gray-600">
                                    Page {invoicePage} of {totalInvoicePages}
                                </span>
                                <button
                                    onClick={() => setInvoicePage(prev => Math.min(prev + 1, totalInvoicePages))}
                                    disabled={invoicePage === totalInvoicePages}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition font-bold"
                                >
                                    &gt;
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'payments' && (
                    <div className="w-full">
                        {/* Mobile List View */}
                        <div className="md:hidden">
                            {currentPaymentRecords.length === 0 ? (
                                <div className="p-8 text-center text-gray-500">No payment history found.</div>
                            ) : (
                                currentPaymentRecords.map((record) => (
                                    <div key={record.id} className="p-4 border-b border-gray-100 last:border-0">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <p className="text-xs font-bold text-gray-400 uppercase">Date</p>
                                                <p className="text-sm text-gray-700">{formatDate(record.date)}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className={`px-2 py-0.5 rounded text-[10px] font-bold ${record.status === 'Completed' || record.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                                                    {record.status || 'Posted'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-end mt-2">
                                            <div>
                                                <p className="text-xs font-bold text-gray-400 uppercase">Reference</p>
                                                <p className="text-xs font-mono text-gray-500 truncate max-w-[150px]">{record.reference}</p>
                                                <p className="text-[10px] text-gray-400 mt-0.5">{record.source} Source</p>
                                            </div>
                                            <p className="text-sm font-bold text-green-600">+{formatCurrency(record.amount)}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Date</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Reference</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Source</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Status</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase text-right">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {currentPaymentRecords.length === 0 ? (
                                        <tr><td colSpan={5} className="p-8 text-center text-gray-500">No payment history found.</td></tr>
                                    ) : (
                                        currentPaymentRecords.map((record) => (
                                            <tr key={record.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                                                <td className="p-6 text-sm text-gray-600">{formatDate(record.date)}</td>
                                                <td className="p-6 text-sm font-mono text-gray-500">{record.reference}</td>
                                                <td className="p-6 text-sm text-gray-600">{record.source}</td>
                                                <td className="p-6 text-sm">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${record.status === 'Completed' || record.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                                                        }`}>
                                                        {record.status || 'Posted'}
                                                    </span>
                                                </td>
                                                <td className="p-6 text-sm font-bold text-green-600 text-right">+{formatCurrency(record.amount)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Payments Pagination */}
                        {totalPaymentPages > 1 && (
                            <div className="flex justify-center items-center p-4 border-t border-gray-100 gap-4">
                                <button
                                    onClick={() => setPaymentPage(prev => Math.max(prev - 1, 1))}
                                    disabled={paymentPage === 1}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition font-bold"
                                >
                                    &lt;
                                </button>
                                <span className="text-sm font-medium text-gray-600">
                                    Page {paymentPage} of {totalPaymentPages}
                                </span>
                                <button
                                    onClick={() => setPaymentPage(prev => Math.min(prev + 1, totalPaymentPages))}
                                    disabled={paymentPage === totalPaymentPages}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition font-bold"
                                >
                                    &gt;
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'service-charges' && (
                    <div className="w-full">
                        {/* Mobile List View */}
                        <div className="md:hidden">
                            {currentServiceChargeRecords.length === 0 ? (
                                <div className="p-8 text-center text-gray-500">No service charges found.</div>
                            ) : (
                                currentServiceChargeRecords.map((record) => (
                                    <div key={record.id} className="p-4 border-b border-gray-100 last:border-0">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <p className="text-xs font-bold text-gray-400 uppercase">Date</p>
                                                <p className="text-sm text-gray-700">{formatDate(record.date)}</p>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-end mt-2">
                                            <div className="flex-1">
                                                <p className="text-xs font-bold text-gray-400 uppercase">Description</p>
                                                <p className="text-xs text-gray-700 font-medium">{record.type}</p>
                                                {record.remarks && <p className="text-[10px] text-gray-400 mt-0.5 italic">"{record.remarks}"</p>}
                                            </div>
                                            <p className="text-sm font-bold text-gray-900">{formatCurrency(record.amount)}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Date</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase">Type / Concern</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase text-right">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {currentServiceChargeRecords.length === 0 ? (
                                        <tr><td colSpan={4} className="p-8 text-center text-gray-500">No service charges found.</td></tr>
                                    ) : (
                                        currentServiceChargeRecords.map((record) => (
                                            <tr key={record.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                                                <td className="p-6 text-sm text-gray-600">{formatDate(record.date)}</td>
                                                <td className="p-6 text-sm">
                                                    <p className="font-bold text-gray-900">{record.type}</p>
                                                    {record.remarks && <p className="text-xs text-gray-500 mt-1">{record.remarks}</p>}
                                                </td>
                                                <td className="p-6 text-sm font-bold text-gray-900 text-right">{formatCurrency(record.amount)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Service Charges Pagination */}
                        {totalServiceChargePages > 1 && (
                            <div className="flex justify-center items-center p-4 border-t border-gray-100 gap-4">
                                <button
                                    onClick={() => setServiceChargePage(prev => Math.max(prev - 1, 1))}
                                    disabled={serviceChargePage === 1}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition font-bold"
                                >
                                    &lt;
                                </button>
                                <span className="text-sm font-medium text-gray-600">
                                    Page {serviceChargePage} of {totalServiceChargePages}
                                </span>
                                <button
                                    onClick={() => setServiceChargePage(prev => Math.min(prev + 1, totalServiceChargePages))}
                                    disabled={serviceChargePage === totalServiceChargePages}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition font-bold"
                                >
                                    &gt;
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>



            {/* PDF Generation Loading Modal */}
            {isGeneratingPdf && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50">
                    <div className="rounded-xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center bg-white text-gray-900">
                        <div className="flex justify-center mb-4">
                            <Loader className="w-10 h-10 animate-spin" style={{ color: colorPalette?.primary || '#7c3aed' }} />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">Generating PDF</h3>
                        <p className="text-sm text-gray-600">
                            Creating SOA PDF and uploading to Google Drive...
                        </p>
                        <p className="text-xs mt-2 text-gray-400">
                            This may take a few moments
                        </p>
                    </div>
                </div>
            )}

            {/* PDF Error Modal */}
            {pdfError && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50">
                    <div className="rounded-xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center bg-white text-gray-900">
                        <div className="flex justify-center mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                                <X className="w-6 h-6 text-red-600" />
                            </div>
                        </div>
                        <h3 className="text-lg font-semibold mb-2">PDF Generation Failed</h3>
                        <p className="text-sm mb-4 text-gray-600">
                            {pdfError}
                        </p>
                        <button
                            onClick={() => setPdfError(null)}
                            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                            style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Bills;
