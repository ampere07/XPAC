import React, { useState, useEffect, useRef } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { TransactionRevert, transactionRevertService } from '../services/transactionRevertService';
import { ColorPalette } from '../services/settingsColorPaletteService';

import { useBillingStore } from '../store/billingStore';
import LoadingModal from './common/LoadingModalGlobal';

interface TransactionsRevertDetailsProps {
    revert: TransactionRevert;
    onClose: () => void;
    onRefresh?: () => void;
    isDarkMode?: boolean;
    colorPalette?: ColorPalette | null;
    onUpdate?: (updated: TransactionRevert) => void;
}

const TransactionsRevertDetails: React.FC<TransactionsRevertDetailsProps> = ({
    revert,
    onClose,
    onRefresh,
    isDarkMode = true,
    colorPalette,
    onUpdate,
}) => {
    const [detailsWidth, setDetailsWidth] = useState<number>(600);
    const [isResizing, setIsResizing] = useState<boolean>(false);
    const startXRef = useRef<number>(0);
    const startWidthRef = useRef<number>(0);

    const [loading, setLoading] = useState(false);
    const [loadingPercentage, setLoadingPercentage] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [showConfirmRevert, setShowConfirmRevert] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [currentRevert, setCurrentRevert] = useState<TransactionRevert>(revert);

    const { refreshLatestData } = useBillingStore();

    // Update local state when revert prop changes
    useEffect(() => {
        setCurrentRevert(revert);
    }, [revert]);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            const diff = startXRef.current - e.clientX;
            const newWidth = Math.max(600, Math.min(1200, startWidthRef.current + diff));
            setDetailsWidth(newWidth);
        };

        const handleMouseUp = () => setIsResizing(false);

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    const handleMouseDownResize = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        startXRef.current = e.clientX;
        startWidthRef.current = detailsWidth;
    };

    const formatDate = (dateStr?: string): string => {
        if (!dateStr) return 'N/A';
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

    const formatCurrency = (amount?: number | string) => {
        if (amount === undefined || amount === null) return '₱0.00';
        const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
        return `₱${numAmount.toFixed(2)}`;
    };

    const renderField = (label: string, value: any) => (
        <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
            <div className={`w-40 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{label}</div>
            <div className={`flex-1 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{value || '-'}</div>
        </div>
    );

    const getStatusBadge = (status?: string) => {
        const s = (status || '').toLowerCase();
        const colors = {
            pending: 'text-yellow-500 bg-yellow-500',
            done: 'text-green-500 bg-green-500',
            rejected: 'text-red-500 bg-red-500',
        };
        const c = colors[s as keyof typeof colors] || 'text-gray-400 bg-gray-400';
        return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold capitalize border ${isDarkMode
                    ? `${c.split(' ')[0]} ${c.split(' ')[1]} bg-opacity-10 border-opacity-20`
                    : `${c.split(' ')[0]} ${c.split(' ')[1]} bg-opacity-10 border ${c.split(' ')[1]} border-opacity-30`
                }`}>
                {status || 'Unknown'}
            </span>
        );
    };

    // Get logged-in user email for updatedBy
    const getCurrentUserEmail = () => {
        try {
            const authData = localStorage.getItem('authData');
            if (authData) {
                const parsed = JSON.parse(authData);
                return parsed.email_address || '';
            }
        } catch (e) { }
        return '';
    };

    const getCurrentUserRole = () => {
        try {
            const authData = localStorage.getItem('authData');
            if (authData) {
                const parsed = JSON.parse(authData);
                return parsed.role_name || '';
            }
        } catch (e) { }
        return '';
    };

    const getCurrentUserRoleId = () => {
        try {
            const authData = localStorage.getItem('authData');
            if (authData) {
                const parsed = JSON.parse(authData);
                return String(parsed.role_id || '');
            }
        } catch (e) { }
        return '';
    };

    const handleRevertConfirm = async () => {
        setShowConfirmRevert(false);
        setLoading(true);
        setLoadingPercentage(10);
        setError(null);

        try {
            const userEmail = getCurrentUserEmail();
            setLoadingPercentage(30);

            // Update revert request status to 'done' — the backend will also perform the actual transaction revert
            const result = await transactionRevertService.updateRevertStatus(currentRevert.id, 'done', userEmail);

            setLoadingPercentage(80);

            if (result.success) {
                setLoadingPercentage(100);

                // Refresh billing data
                try {
                    await refreshLatestData();
                } catch (refreshErr) {
                    console.error('Failed to refresh billing records:', refreshErr);
                }

                await new Promise(resolve => setTimeout(resolve, 500));

                const updated = result.data || { ...currentRevert, status: 'done' };
                setCurrentRevert(updated as TransactionRevert);
                if (onUpdate) onUpdate(updated as TransactionRevert);

                setSuccessMessage('Transaction has been reverted successfully and revert request marked as done.');
                setShowSuccessModal(true);
                if (onRefresh) onRefresh();
            } else {
                setError(result.message || 'Failed to process revert.');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to process revert.');
        } finally {
            setLoading(false);
            setLoadingPercentage(0);
        }
    };

    if (!revert) return null;

    const transaction = currentRevert.transaction;
    const isPending = (currentRevert.status || '').toLowerCase() === 'pending';

    return (
        <>
            <LoadingModal
                isOpen={loading}
                type="loading"
                title="Processing Revert"
                message="Processing revert..."
                loadingPercentage={loadingPercentage}
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
            />

            <div
                className={`flex flex-col h-full relative transition-all duration-300 ${isDarkMode ? 'bg-gray-900 border-l border-gray-800' : 'bg-white border-l border-gray-200'}`}
                style={{ width: `${detailsWidth}px` }}
            >
                {/* Resize handle */}
                <div
                    className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-purple-500 hover:w-1.5 transition-all z-50"
                    onMouseDown={handleMouseDownResize}
                    style={{ backgroundColor: isResizing ? (colorPalette?.primary || '#7c3aed') : 'transparent' }}
                />

                {/* Header */}
                <div className={`px-4 py-3 flex items-center justify-between border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                    <div className="flex items-center min-w-0 flex-1">
                        <h2 className={`font-medium truncate pr-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            Revert Request #{currentRevert.id}
                            {transaction?.account_no && ` — ${transaction.account_no}`}
                        </h2>
                    </div>

                    <div className="flex items-center space-x-3">
                        {/* Show Revert button only if status is pending and user is a superadmin or role_id 7 */}
                        {isPending && (getCurrentUserRole().toLowerCase() === 'superadmin' || getCurrentUserRoleId() === '7') && (
                            <button
                                onClick={() => setShowConfirmRevert(true)}
                                disabled={loading}
                                className="flex items-center space-x-2 text-white px-3 py-1.5 rounded text-sm transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                                style={{ backgroundColor: loading ? '#4b5563' : '#ef4444' }}
                                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#dc2626'; }}
                                onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#ef4444'; }}
                            >
                                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                                <span>{loading ? 'Reverting...' : 'Revert'}</span>
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
                            aria-label="Close"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className={`border p-3 m-3 rounded text-sm ${isDarkMode ? 'bg-red-900 bg-opacity-20 border-red-700 text-red-400' : 'bg-red-100 border-red-300 text-red-900'}`}>
                        {error}
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                    <div className={`mx-auto py-1 px-4 ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
                        <div className="space-y-1">
                            {renderField('Request ID', `#${currentRevert.id}`)}
                            <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
                                <div className={`w-40 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Status</div>
                                <div className="flex-1">{getStatusBadge(currentRevert.status)}</div>
                            </div>
                            {renderField('Requested By', currentRevert.requester?.email_address || `User ID: ${currentRevert.requested_by}` || '-')}
                            {renderField('Updated By', currentRevert.updater?.email_address || (currentRevert.updated_by ? `User ID: ${currentRevert.updated_by}` : '-'))}
                            {renderField('Remarks', currentRevert.remarks || 'No remarks')}
                            <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
                                <div className={`w-40 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Reason</div>
                                <div className={`flex-1 text-sm whitespace-pre-wrap ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{currentRevert.reason || '-'}</div>
                            </div>
                            {renderField('Submitted At', formatDate(currentRevert.created_at))}
                            {renderField('Updated At', formatDate(currentRevert.updated_at))}
                        </div>

                        {/* Transaction Info Section */}
                        {transaction && (
                            <>
                                <div className={`mt-6 mb-2 text-xs font-semibold uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                    Transaction Details
                                </div>
                                <div className="space-y-1">
                                    {renderField('Transaction ID', `#${transaction.id}`)}
                                    {renderField('Account No.', transaction.account_no)}
                                    {renderField('Full Name', transaction.account?.customer?.full_name)}
                                    {renderField('Transaction Type', transaction.transaction_type)}
                                    <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
                                        <div className={`w-40 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Amount</div>
                                        <div className={`flex-1 text-sm font-bold text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                            {formatCurrency(transaction.received_payment)}
                                        </div>
                                    </div>
                                    {renderField('Payment Method', transaction.payment_method_info?.payment_method || transaction.payment_method)}
                                    {renderField('Reference No.', transaction.reference_no)}
                                    {renderField('OR No.', transaction.or_no)}
                                    {renderField('Processed By', transaction.processor?.email_address || transaction.processed_by_user)}
                                    {renderField('Approved By', transaction.approved_by)}
                                    <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
                                        <div className={`w-40 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Tx Status</div>
                                        <div className={`flex-1 text-sm capitalize font-medium ${(transaction.status || '').toLowerCase() === 'done' ? 'text-green-500' :
                                                (transaction.status || '').toLowerCase() === 'pending' ? 'text-yellow-500' : 'text-gray-400'
                                            }`}>{transaction.status || '-'}</div>
                                    </div>
                                    {renderField('Payment Date', formatDate(transaction.payment_date))}
                                    {renderField('Barangay', transaction.account?.customer?.barangay)}
                                    {renderField('City', transaction.account?.customer?.city)}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Confirm Revert Modal */}
            {showConfirmRevert && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className={`rounded-lg p-6 max-w-md w-full mx-4 border shadow-2xl ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
                        <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Confirm Revert</h3>
                        <p className={`mb-6 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Are you sure you want to revert this transaction? This will add the payment amount back to the account balance and mark paid invoices as unpaid. The revert request will be marked as <span className="font-semibold text-green-500">Done</span>.
                        </p>
                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => setShowConfirmRevert(false)}
                                className={`px-6 py-2.5 rounded font-medium transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'}`}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRevertConfirm}
                                className="bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded font-medium transition-all active:scale-95"
                            >
                                Confirm Revert
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Success Modal */}
            {showSuccessModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className={`rounded-lg p-6 max-w-md w-full mx-4 border shadow-2xl ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
                        <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Success</h3>
                        <p className={`mb-6 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{successMessage}</p>
                        <div className="flex justify-end">
                            <button
                                onClick={() => {
                                    setShowSuccessModal(false);
                                }}
                                className="text-white px-8 py-2.5 rounded font-medium transition-all active:scale-95"
                                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                                onMouseEnter={(e) => { if (colorPalette?.accent) e.currentTarget.style.backgroundColor = colorPalette.accent; }}
                                onMouseLeave={(e) => { if (colorPalette?.primary) e.currentTarget.style.backgroundColor = colorPalette.primary; }}
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default TransactionsRevertDetails;
