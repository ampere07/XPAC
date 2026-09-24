import React, { useState, useEffect, useRef } from 'react';
import { X, Check, Ban } from 'lucide-react';
import {
    PrepaidOverrideRequest,
    PrepaidOverrideEnforcement,
    prepaidOverrideService,
} from '../services/prepaidOverrideService';
import { ColorPalette } from '../services/settingsColorPaletteService';
import { useBillingStore } from '../store/billingStore';
import { getUserDisplayName } from '../utils/userDisplay';
import LoadingModal from './common/LoadingModalGlobal';

interface PrepaidOverrideDetailsProps {
    overrideRequest: PrepaidOverrideRequest;
    onClose: () => void;
    onRefresh?: () => void;
    isDarkMode?: boolean;
    colorPalette?: ColorPalette | null;
    onUpdate?: (updated: PrepaidOverrideRequest) => void;
    /** Whether this viewer may decide the request. Approve/Reject are hidden when false. */
    canDecide?: boolean;
}

type PendingDecision = 'approved' | 'rejected' | null;

const PrepaidOverrideDetails: React.FC<PrepaidOverrideDetailsProps> = ({
    overrideRequest,
    onClose,
    onRefresh,
    isDarkMode = true,
    colorPalette,
    onUpdate,
    canDecide = false,
}) => {
    const [detailsWidth, setDetailsWidth] = useState<number>(600);
    const [isResizing, setIsResizing] = useState<boolean>(false);
    const startXRef = useRef<number>(0);
    const startWidthRef = useRef<number>(0);

    const [loading, setLoading] = useState(false);
    const [loadingPercentage, setLoadingPercentage] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [pendingDecision, setPendingDecision] = useState<PendingDecision>(null);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [enforcement, setEnforcement] = useState<PrepaidOverrideEnforcement | null>(null);
    const [current, setCurrent] = useState<PrepaidOverrideRequest>(overrideRequest);

    const { refreshLatestData } = useBillingStore();

    useEffect(() => {
        setCurrent(overrideRequest);
        // A different request is on screen now — the previous one's outcome banner does not
        // describe it, so clear both rather than letting them bleed across selections.
        setEnforcement(null);
        setError(null);
    }, [overrideRequest]);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            const diff = startXRef.current - e.clientX;
            setDetailsWidth(Math.max(600, Math.min(1200, startWidthRef.current + diff)));
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

    const formatDateTime = (value?: string | null): string => {
        if (!value) return '-';
        const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
        if (isNaN(date.getTime())) return String(value);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const yyyy = date.getFullYear();
        const hh = String(date.getHours()).padStart(2, '0');
        const mi = String(date.getMinutes()).padStart(2, '0');
        return `${mm}/${dd}/${yyyy} ${hh}:${mi}`;
    };

    const renderField = (label: string, value: any) => (
        <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
            <div className={`w-44 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{label}</div>
            <div className={`flex-1 text-sm break-words ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{value || '-'}</div>
        </div>
    );

    const getStatusBadge = (status?: string) => {
        const s = (status || '').toLowerCase();
        const tone =
            s === 'processed' || s === 'approved'
                ? 'text-green-500 border-green-500'
                : s === 'pending'
                  ? 'text-yellow-500 border-yellow-500'
                  : s === 'rejected'
                    ? 'text-red-500 border-red-500'
                    : 'text-gray-400 border-gray-400';
        return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold capitalize border bg-opacity-10 ${tone}`}>
                {status || 'Unknown'}
            </span>
        );
    };

    const getCurrentUserEmail = () => {
        try {
            const authData = localStorage.getItem('authData');
            if (authData) return JSON.parse(authData).email_address || '';
        } catch (e) {}
        return '';
    };

    const handleDecision = async (decision: 'approved' | 'rejected') => {
        setPendingDecision(null);
        setLoading(true);
        setLoadingPercentage(10);
        setError(null);
        setEnforcement(null);

        try {
            setLoadingPercentage(30);
            const result = await prepaidOverrideService.updateOverrideStatus(current.id, decision, getCurrentUserEmail());
            setLoadingPercentage(80);

            if (!result.success) {
                setError(result.message || 'Failed to update this request.');
                return;
            }

            setLoadingPercentage(100);

            // An approval moves prepaid_expires_at, which the billing list renders — refresh it so
            // the customer row does not keep showing the old date.
            if (decision === 'approved') {
                try {
                    await refreshLatestData();
                } catch (refreshErr) {
                    console.error('Failed to refresh billing records:', refreshErr);
                }
            }

            await new Promise((resolve) => setTimeout(resolve, 400));

            const updated = (result.data || {
                ...current,
                status: decision === 'approved' ? 'processed' : 'rejected',
            }) as PrepaidOverrideRequest;

            setCurrent(updated);
            if (onUpdate) onUpdate(updated);
            setEnforcement(result.enforcement ?? null);
            setSuccessMessage(
                result.message ||
                    (decision === 'approved'
                        ? 'The prepaid expiration has been adjusted.'
                        : 'The request has been rejected.')
            );
            setShowSuccessModal(true);
            if (onRefresh) onRefresh();
        } catch (err: any) {
            setError(err.message || 'Failed to update this request.');
        } finally {
            setLoading(false);
            setLoadingPercentage(0);
        }
    };

    if (!overrideRequest) return null;

    const account = current.billing_account;
    const isPending = (current.status || '').toLowerCase() === 'pending';
    const days = Number(current.days_adjustment || 0);
    const daysLabel = days > 0 ? `+${days} day(s)` : `${days} day(s)`;

    /**
     * What the enforcement outcome means for the customer, in plain words.
     *
     * Shown because 'queued' is a genuinely different situation from 'reconnected' — the days are
     * granted either way, but in one case the customer is back online now and in the other they
     * are waiting on the RADIUS retry cron.
     */
    const enforcementBanner = (() => {
        if (!enforcement) return null;
        const map: Record<string, { tone: string; text: string }> = {
            reconnected: { tone: 'green', text: 'Customer reconnected — the extended period is live in RADIUS.' },
            restricted: { tone: 'yellow', text: 'Customer restricted — the shortened period has already lapsed.' },
            queued: {
                tone: 'yellow',
                text: `RADIUS did not respond, so the change was queued for retry${enforcement.reason ? ` (${enforcement.reason})` : ''}. The expiration itself is already saved.`,
            },
            skipped: { tone: 'gray', text: `No RADIUS change needed${enforcement.reason ? ` — ${enforcement.reason}` : ''}.` },
            error: {
                tone: 'red',
                text: `The expiration was saved, but RADIUS enforcement failed${enforcement.reason ? `: ${enforcement.reason}` : ''}. The nightly run will pick this account up.`,
            },
        };
        const entry = map[enforcement.action] || map.skipped;
        const toneClass =
            entry.tone === 'green'
                ? 'border-green-600 text-green-500'
                : entry.tone === 'yellow'
                  ? 'border-yellow-600 text-yellow-500'
                  : entry.tone === 'red'
                    ? 'border-red-600 text-red-500'
                    : isDarkMode
                      ? 'border-gray-700 text-gray-400'
                      : 'border-gray-300 text-gray-600';
        return (
            <div className={`border p-3 m-3 rounded text-sm bg-opacity-10 ${toneClass}`}>{entry.text}</div>
        );
    })();

    return (
        <>
            <LoadingModal
                isOpen={loading}
                type="loading"
                title="Processing Override"
                message="Applying prepaid override..."
                loadingPercentage={loadingPercentage}
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
            />

            <div
                className={`flex flex-col h-full relative transition-all duration-300 ${isDarkMode ? 'bg-gray-900 border-l border-gray-800' : 'bg-white border-l border-gray-200'}`}
                style={{ width: `${detailsWidth}px` }}
            >
                <div
                    className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-purple-500 hover:w-1.5 transition-all z-50"
                    onMouseDown={handleMouseDownResize}
                    style={{ backgroundColor: isResizing ? colorPalette?.primary || '#7c3aed' : 'transparent' }}
                />

                {/* Header */}
                <div className={`px-4 py-3 flex items-center justify-between border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                    <div className="flex items-center min-w-0 flex-1">
                        <h2 className={`font-medium truncate pr-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            Override #{current.id} — {current.account_no}
                        </h2>
                    </div>

                    <div className="flex items-center space-x-2">
                        {isPending && canDecide && (
                            <>
                                <button
                                    onClick={() => setPendingDecision('approved')}
                                    disabled={loading}
                                    className="flex items-center space-x-1.5 text-white px-3 py-1.5 rounded text-sm transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                                    style={{ backgroundColor: loading ? '#4b5563' : '#16a34a' }}
                                    onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#15803d'; }}
                                    onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#16a34a'; }}
                                >
                                    <Check size={16} />
                                    <span>Approve</span>
                                </button>
                                <button
                                    onClick={() => setPendingDecision('rejected')}
                                    disabled={loading}
                                    className="flex items-center space-x-1.5 text-white px-3 py-1.5 rounded text-sm transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                                    style={{ backgroundColor: loading ? '#4b5563' : '#ef4444' }}
                                    onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#dc2626'; }}
                                    onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#ef4444'; }}
                                >
                                    <Ban size={16} />
                                    <span>Reject</span>
                                </button>
                            </>
                        )}
                        <button
                            onClick={onClose}
                            className={isDarkMode ? 'hover:text-white text-gray-400 pl-1' : 'hover:text-gray-900 text-gray-600 pl-1'}
                            aria-label="Close"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {error && (
                    <div className={`border p-3 m-3 rounded text-sm ${isDarkMode ? 'bg-red-900 bg-opacity-20 border-red-700 text-red-400' : 'bg-red-100 border-red-300 text-red-900'}`}>
                        {error}
                    </div>
                )}

                {enforcementBanner}

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                    <div className={`mx-auto py-1 px-4 ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
                        <div className="space-y-1">
                            {renderField('Request ID', `#${current.id}`)}
                            <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
                                <div className={`w-44 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Status</div>
                                <div className="flex-1">{getStatusBadge(current.status)}</div>
                            </div>
                            <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
                                <div className={`w-44 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Adjustment</div>
                                <div className={`flex-1 text-lg font-bold ${days > 0 ? 'text-green-500' : 'text-red-500'}`}>{daysLabel}</div>
                            </div>
                            {renderField('Requested By', getUserDisplayName(current.requester, current.requester?.email_address) || (current.requested_by ? `User ID: ${current.requested_by}` : '-'))}
                            {renderField('Decided By', getUserDisplayName(current.updater, current.updater?.email_address) || (current.updated_by ? `User ID: ${current.updated_by}` : '-'))}
                            <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
                                <div className={`w-44 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Reason</div>
                                <div className={`flex-1 text-sm whitespace-pre-wrap ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{current.reason || '-'}</div>
                            </div>
                            {renderField('Remarks', current.remarks || 'No remarks')}
                            {renderField('Submitted At', formatDateTime(current.created_at))}
                            {renderField('Decided At', formatDateTime(current.processed_at))}
                        </div>

                        {/* Expiration movement — only meaningful once the request has been applied. */}
                        <div className={`mt-6 mb-2 text-xs font-semibold uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            Prepaid Period
                        </div>
                        <div className="space-y-1">
                            {renderField(
                                'Current Expiration',
                                formatDateTime(account?.prepaid_expires_at)
                            )}
                            {renderField('Expiration Before', formatDateTime(current.expiry_before))}
                            {renderField('Expiration After', formatDateTime(current.expiry_after))}
                            {isPending && (
                                <p className={`text-xs pt-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                    Before/after are filled in on approval. The adjustment is applied to the expiration as it stands at that
                                    moment, so a payment in the meantime shifts the result by the same number of days.
                                </p>
                            )}
                        </div>

                        {/* Customer context */}
                        {account && (
                            <>
                                <div className={`mt-6 mb-2 text-xs font-semibold uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                    Customer
                                </div>
                                <div className="space-y-1">
                                    {renderField('Account No.', account.account_no)}
                                    {renderField('Full Name', account.customer?.full_name)}
                                    {renderField('Contact No.', account.customer?.contact_number_primary)}
                                    {renderField('Plan', account.customer?.desired_plan)}
                                    {renderField('Billing Type', account.generation_type)}
                                    {renderField('Billing Status', account.billing_status?.status_name)}
                                    {renderField('Barangay', account.customer?.barangay)}
                                    {renderField('City', account.customer?.city)}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Confirm decision */}
            {pendingDecision && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className={`rounded-lg p-6 max-w-md w-full mx-4 border shadow-2xl ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
                        <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {pendingDecision === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}
                        </h3>
                        <p className={`mb-6 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {pendingDecision === 'approved' ? (
                                <>
                                    This will move account <span className="font-semibold">{current.account_no}</span>'s prepaid expiration by{' '}
                                    <span className={`font-semibold ${days > 0 ? 'text-green-500' : 'text-red-500'}`}>{daysLabel}</span> and
                                    bring their connection in line with the new date. This cannot be undone from here.
                                </>
                            ) : (
                                <>
                                    This will reject the request for <span className="font-semibold">{current.account_no}</span>. No expiration
                                    date will change.
                                </>
                            )}
                        </p>
                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => setPendingDecision(null)}
                                className={`px-6 py-2.5 rounded font-medium transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'}`}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDecision(pendingDecision)}
                                className={`text-white px-6 py-2.5 rounded font-medium transition-all active:scale-95 ${pendingDecision === 'approved' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
                            >
                                {pendingDecision === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Success */}
            {showSuccessModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className={`rounded-lg p-6 max-w-md w-full mx-4 border shadow-2xl ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
                        <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Success</h3>
                        <p className={`mb-6 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{successMessage}</p>
                        <div className="flex justify-end">
                            <button
                                onClick={() => setShowSuccessModal(false)}
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

export default PrepaidOverrideDetails;
