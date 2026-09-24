import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Minus, Plus } from 'lucide-react';
import { prepaidOverrideService } from '../services/prepaidOverrideService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

/** Mirrors PrepaidOverrideRequest::MAX_DAYS_ADJUSTMENT — the server rejects anything beyond this. */
const MAX_DAYS = 365;

/** One-tap amounts covering the periods support actually grants. */
const QUICK_DAYS = [1, 3, 7, 15, 30];

interface PrepaidOverrideModalProps {
    isOpen: boolean;
    onClose: () => void;
    accountNo: string;
    customerName?: string;
    /** Current billing_accounts.prepaid_expires_at, empty when the prepaid clock has not started. */
    currentExpiration?: string | null;
    onSuccess?: () => void;
}

const formatDateTime = (value?: string | null): string => {
    if (!value) return 'Not set';
    const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
    if (isNaN(date.getTime())) return String(value);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${mm}/${dd}/${yyyy} ${hh}:${mi}`;
};

const PrepaidOverrideModal: React.FC<PrepaidOverrideModalProps> = ({
    isOpen,
    onClose,
    accountNo,
    customerName,
    currentExpiration,
    onSuccess,
}) => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [requestedBy, setRequestedBy] = useState('');
    // Held as a string so the field can be emptied while typing — a number state would snap a
    // cleared input back to 0 and make the minus sign impossible to type.
    const [daysInput, setDaysInput] = useState('');
    const [remarks, setRemarks] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingPercentage, setLoadingPercentage] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => {
        const checkDarkMode = () => {
            const theme = localStorage.getItem('theme');
            setIsDarkMode(theme === 'dark' || theme === null);
        };

        checkDarkMode();
        const observer = new MutationObserver(checkDarkMode);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const fetchColorPalette = async () => {
            try {
                setColorPalette(await settingsColorPaletteService.getActive());
            } catch (err) {
                console.error('Failed to fetch color palette:', err);
            }
        };
        fetchColorPalette();
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        try {
            const authData = localStorage.getItem('authData');
            if (authData) {
                const parsed = JSON.parse(authData);
                setRequestedBy(parsed.email_address || parsed.email || parsed.username || '');
            }
        } catch (err) {
            console.error('Error getting user email:', err);
        }

        setDaysInput('');
        setRemarks('');
        setReason('');
        setError(null);
        setShowSuccess(false);
    }, [isOpen]);

    const days = useMemo(() => {
        const parsed = parseInt(daysInput, 10);
        return isNaN(parsed) ? 0 : parsed;
    }, [daysInput]);

    /**
     * The expiry this request would produce, computed the same way the server does at approval:
     * days added to the CURRENT expiry, or to now when the prepaid clock has not started yet.
     *
     * Labelled an estimate in the UI because it is one — if the customer pays before this is
     * approved, the real result is the same number of days on top of their renewed expiry.
     */
    const projectedExpiry = useMemo(() => {
        if (!days) return null;
        const base = currentExpiration
            ? new Date(currentExpiration.includes('T') ? currentExpiration : currentExpiration.replace(' ', 'T'))
            : new Date();
        if (isNaN(base.getTime())) return null;
        const projected = new Date(base.getTime());
        projected.setDate(projected.getDate() + days);
        return projected.toISOString();
    }, [days, currentExpiration]);

    // A deduction needs an existing period to come off; the server refuses this case too, but
    // catching it here saves the approver a pointless review.
    const deductingWithoutPeriod = days < 0 && !currentExpiration;

    const validationMessage = useMemo(() => {
        if (daysInput.trim() === '') return 'Enter the number of days to add or deduct.';
        if (days === 0) return 'Enter a non-zero number of days.';
        if (Math.abs(days) > MAX_DAYS) return `Adjustments are capped at ${MAX_DAYS} days.`;
        if (deductingWithoutPeriod) return 'This account has no prepaid period yet, so days cannot be deducted.';
        if (!reason.trim()) return 'Reason is required.';
        return null;
    }, [daysInput, days, deductingWithoutPeriod, reason]);

    const adjustDays = (delta: number) => {
        const next = days + delta;
        const clamped = Math.max(-MAX_DAYS, Math.min(MAX_DAYS, next));
        setDaysInput(String(clamped));
    };

    const handleSubmit = async () => {
        if (validationMessage) {
            setError(validationMessage);
            return;
        }

        setLoading(true);
        setLoadingPercentage(0);
        setError(null);

        const progressInterval = setInterval(() => {
            setLoadingPercentage((prev) => (prev >= 95 ? 95 : prev + 5));
        }, 100);

        try {
            const result = await prepaidOverrideService.createOverrideRequest({
                account_no: accountNo,
                days_adjustment: days,
                reason: reason.trim(),
                remarks: remarks.trim() || undefined,
                requested_by: requestedBy,
            });

            clearInterval(progressInterval);
            setLoadingPercentage(100);
            await new Promise((resolve) => setTimeout(resolve, 300));

            if (result.success) {
                setShowSuccess(true);
                if (onSuccess) onSuccess();
            } else {
                setError(result.message || 'Failed to submit prepaid override request.');
            }
        } catch (err: any) {
            clearInterval(progressInterval);
            setError(err.message || 'Failed to submit prepaid override request.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const inputBase = `w-full px-4 py-3 rounded-lg border text-sm transition-all focus:outline-none ${
        isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
    }`;
    const readOnlyBase = `w-full px-4 py-3 rounded-lg border text-sm cursor-not-allowed opacity-70 ${
        isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-gray-50 border-gray-300 text-gray-500'
    }`;

    const applyFocusRing = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (colorPalette?.primary) {
            e.currentTarget.style.borderColor = colorPalette.primary;
            e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
        }
    };
    const clearFocusRing = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
        e.currentTarget.style.boxShadow = 'none';
    };

    // Portalled to body and raised above the mobile panel roots (`fixed inset-0 z-[9999]` in
    // CustomerDetails). Rendered as a SIBLING of such a panel, a z-50 root loses to z-[9999] and
    // this form never appears in phone view.
    return createPortal(
        <>
            {loading && !showSuccess && (
                <div className="fixed inset-0 bg-black bg-opacity-70 z-[10020] flex items-center justify-center">
                    <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                        <Loader2 className="w-20 h-20 animate-spin" style={{ color: colorPalette?.primary || '#7c3aed' }} />
                        <div className="text-center">
                            <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{loadingPercentage}%</p>
                            <p className={`text-sm mt-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Submitting request...</p>
                        </div>
                    </div>
                </div>
            )}

            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-[10010]">
                <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
                    {/* Header */}
                    <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                        <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            Prepaid Expiration Override
                        </h2>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={onClose}
                                className={`px-4 py-2 rounded text-sm transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'}`}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={loading || showSuccess || validationMessage !== null}
                                className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center shadow-sm"
                                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                                onMouseEnter={(e) => {
                                    if (colorPalette?.accent && !loading && !showSuccess && !validationMessage) {
                                        e.currentTarget.style.backgroundColor = colorPalette.accent;
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                                }}
                            >
                                <span>{loading ? 'Submitting...' : 'Submit'}</span>
                            </button>
                            <button
                                onClick={onClose}
                                className={`transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                                aria-label="Close"
                            >
                                <X size={24} />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {showSuccess ? (
                            <div className="flex flex-col items-center justify-center h-full text-center space-y-6 py-12">
                                <div className="w-24 h-24 rounded-full bg-green-500 bg-opacity-20 flex items-center justify-center animate-bounce">
                                    <svg className="w-12 h-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                                <div className="space-y-2">
                                    <h3 className={`text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Request Submitted!</h3>
                                    <p className={`text-lg px-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                        Your request to adjust account{' '}
                                        <span className="text-orange-500 font-bold">{accountNo}</span> by{' '}
                                        <span className="text-orange-500 font-bold">{days > 0 ? `+${days}` : days} day(s)</span> has been sent
                                        for approval.
                                    </p>
                                    <p className={`text-sm px-8 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                        The expiration date will not change until the request is approved in Billing &rarr; Prepaid Override.
                                    </p>
                                </div>
                                <div className={`text-sm px-4 py-2 rounded-full ${isDarkMode ? 'bg-gray-800 text-yellow-500' : 'bg-yellow-50 text-yellow-700'}`}>
                                    Status: <span className="font-bold uppercase">Pending Review</span>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="px-12 py-3 text-white rounded-lg font-bold text-lg transition-transform hover:scale-105 active:scale-95 shadow-lg"
                                    style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                                >
                                    Close
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-6 max-w-xl mx-auto">
                                <div className="space-y-4">
                                    {/* Account context — read-only, so the requester can confirm they are on
                                        the right customer before asking for free service days. */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                                Account No.
                                            </label>
                                            <input type="text" value={accountNo} readOnly className={readOnlyBase} />
                                        </div>
                                        <div className="space-y-2">
                                            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                                Customer
                                            </label>
                                            <input type="text" value={customerName || '-'} readOnly className={readOnlyBase} />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                            Requested By
                                        </label>
                                        <input type="text" value={requestedBy} readOnly className={readOnlyBase} />
                                    </div>

                                    <div className="space-y-2">
                                        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                            Current Prepaid Expiration
                                        </label>
                                        <input type="text" value={formatDateTime(currentExpiration)} readOnly className={readOnlyBase} />
                                        {!currentExpiration && (
                                            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                The prepaid clock has not started for this account. Adding days starts it from today.
                                            </p>
                                        )}
                                    </div>

                                    {/* Days adjustment */}
                                    <div className="space-y-2">
                                        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                            Days to Add / Deduct <span className="text-red-500">*</span>
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => adjustDays(-1)}
                                                className={`p-3 rounded-lg border transition-colors flex-shrink-0 ${isDarkMode ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                                                aria-label="Deduct one day"
                                            >
                                                <Minus size={16} />
                                            </button>
                                            <input
                                                type="number"
                                                value={daysInput}
                                                onChange={(e) => setDaysInput(e.target.value)}
                                                placeholder="e.g. 7 to add, -7 to deduct"
                                                min={-MAX_DAYS}
                                                max={MAX_DAYS}
                                                className={`${inputBase} text-center font-semibold`}
                                                onFocus={applyFocusRing}
                                                onBlur={clearFocusRing}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => adjustDays(1)}
                                                className={`p-3 rounded-lg border transition-colors flex-shrink-0 ${isDarkMode ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                                                aria-label="Add one day"
                                            >
                                                <Plus size={16} />
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-2 pt-1">
                                            {QUICK_DAYS.map((quick) => (
                                                <button
                                                    key={quick}
                                                    type="button"
                                                    onClick={() => setDaysInput(String(quick))}
                                                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${isDarkMode ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                                                >
                                                    +{quick}d
                                                </button>
                                            ))}
                                            {QUICK_DAYS.map((quick) => (
                                                <button
                                                    key={`minus-${quick}`}
                                                    type="button"
                                                    onClick={() => setDaysInput(String(-quick))}
                                                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${isDarkMode ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                                                >
                                                    -{quick}d
                                                </button>
                                            ))}
                                        </div>
                                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                            Positive extends the prepaid period, negative shortens it. Maximum {MAX_DAYS} days per request.
                                        </p>
                                    </div>

                                    {/* Projected result */}
                                    {projectedExpiry && !deductingWithoutPeriod && (
                                        <div className={`rounded-lg border p-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                                            <div className={`text-xs uppercase tracking-widest mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                Estimated New Expiration
                                            </div>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className={`text-sm line-through ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                    {formatDateTime(currentExpiration)}
                                                </span>
                                                <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>&rarr;</span>
                                                <span className={`text-base font-bold ${days > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                    {formatDateTime(projectedExpiry)}
                                                </span>
                                            </div>
                                            <p className={`text-xs mt-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                Estimate only. The adjustment is applied to the expiration as it stands when the request is
                                                approved, so a payment in the meantime shifts this forward by the same number of days.
                                            </p>
                                        </div>
                                    )}

                                    {/* Reason */}
                                    <div className="space-y-2">
                                        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                            Reason for Override <span className="text-red-500">*</span>
                                        </label>
                                        <textarea
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            placeholder="Why does this customer's prepaid period need adjusting?"
                                            rows={4}
                                            className={`${inputBase} resize-none`}
                                            onFocus={applyFocusRing}
                                            onBlur={clearFocusRing}
                                        />
                                    </div>

                                    {/* Remarks */}
                                    <div className="space-y-2">
                                        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                            Remarks (Optional)
                                        </label>
                                        <input
                                            type="text"
                                            value={remarks}
                                            onChange={(e) => setRemarks(e.target.value)}
                                            placeholder="Add any additional notes..."
                                            className={inputBase}
                                            onFocus={applyFocusRing}
                                            onBlur={clearFocusRing}
                                        />
                                    </div>

                                    {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>,
        document.body
    );
};

export default PrepaidOverrideModal;
