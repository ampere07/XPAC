import React, { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { transactionRevertService } from '../services/transactionRevertService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface TransactionRevertModalProps {
    isOpen: boolean;
    onClose: () => void;
    transactionId: number | string;
    onSuccess?: () => void;
}

const TransactionRevertModal: React.FC<TransactionRevertModalProps> = ({
    isOpen,
    onClose,
    transactionId,
    onSuccess,
}) => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [requestedBy, setRequestedBy] = useState('');
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

        const observer = new MutationObserver(() => {
            checkDarkMode();
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const fetchColorPalette = async () => {
            try {
                const activePalette = await settingsColorPaletteService.getActive();
                setColorPalette(activePalette);
            } catch (err) {
                console.error('Failed to fetch color palette:', err);
            }
        };
        fetchColorPalette();
    }, []);

    // Get logged-in user's email automatically
    useEffect(() => {
        if (isOpen) {
            try {
                const authData = localStorage.getItem('authData');
                if (authData) {
                    const parsed = JSON.parse(authData);
                    // Try to get email from email_address, then email, then use username as fallback
                    const userEmail = parsed.email_address || parsed.email || parsed.username || '';
                    setRequestedBy(userEmail);
                }
            } catch (err) {
                console.error('Error getting user email:', err);
            }
            // Reset form
            setRemarks('');
            setReason('');
            setError(null);
            setShowSuccess(false);
        }
    }, [isOpen]);

    const handleSubmit = async () => {
        if (!reason.trim()) {
            setError('Reason is required.');
            return;
        }

        setLoading(true);
        setLoadingPercentage(0);
        setError(null);

        const progressInterval = setInterval(() => {
            setLoadingPercentage(prev => {
                if (prev >= 95) return 95;
                return prev + 5;
            });
        }, 100);

        try {
            const result = await transactionRevertService.createRevertRequest({
                transaction_id: Number(transactionId),
                remarks: remarks.trim() || undefined,
                reason: reason.trim(),
                requested_by: requestedBy,
                updated_by: requestedBy,
                status: 'pending',
            });

            clearInterval(progressInterval);
            setLoadingPercentage(100);

            await new Promise(resolve => setTimeout(resolve, 300));

            if (result.success) {
                setShowSuccess(true);
                if (onSuccess) {
                    onSuccess();
                }
            } else {
                setError(result.message || 'Failed to submit revert request.');
                setLoading(false);
            }
        } catch (err: any) {
            clearInterval(progressInterval);
            setError(err.message || 'Failed to submit revert request.');
            setLoading(false);
        } finally {
            if (!showSuccess) {
                setLoading(false);
            }
        }
    };

    const handleCancel = () => {
        onClose();
    };

    if (!isOpen) return null;

    return (
        <>
            {loading && !showSuccess && (
                <div className="fixed inset-0 bg-black bg-opacity-70 z-[10000] flex items-center justify-center">
                    <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'
                        }`}>
                        <Loader2
                            className="w-20 h-20 animate-spin"
                            style={{ color: colorPalette?.primary || '#7c3aed' }}
                        />
                        <div className="text-center">
                            <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'
                                }`}>{loadingPercentage}%</p>
                            <p className={`text-sm mt-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                }`}>Submitting request...</p>
                        </div>
                    </div>
                </div>
            )}

            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
                <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
                    }`}>
                    {/* Header */}
                    <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
                        }`}>
                        <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            Transaction Revert Form
                        </h2>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleCancel}
                                className={`px-4 py-2 rounded text-sm transition-colors ${isDarkMode
                                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                                    : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                                    }`}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={loading || !reason.trim() || showSuccess}
                                className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center shadow-sm"
                                style={{
                                    backgroundColor: colorPalette?.primary || '#7c3aed'
                                }}
                                onMouseEnter={(e) => {
                                    if (colorPalette?.accent && !loading && !showSuccess) {
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
                                className={`transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                                    }`}
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
                                    <h3 className={`text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                        Request Submitted!
                                    </h3>
                                    <p className={`text-lg px-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                        Your revert request for Transaction <span className="text-orange-500 font-bold">#{transactionId}</span> has been successfully sent.
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
                                {/* Form Fields */}
                                <div className="space-y-4">
                                    {/* Requested By (read-only) */}
                                    <div className="space-y-2">
                                        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                            Requested By
                                        </label>
                                        <input
                                            type="text"
                                            value={requestedBy}
                                            readOnly
                                            className={`w-full px-4 py-3 rounded-lg border text-sm transition-all cursor-not-allowed opacity-70 ${isDarkMode
                                                ? 'bg-gray-800 border-gray-700 text-gray-400'
                                                : 'bg-gray-50 border-gray-300 text-gray-500'
                                                }`}
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
                                            className={`w-full px-4 py-3 rounded-lg border text-sm transition-all focus:outline-none ${isDarkMode
                                                ? 'bg-gray-800 border-gray-700 text-white'
                                                : 'bg-white border-gray-300 text-gray-900'
                                                }`}
                                            onFocus={(e) => {
                                                if (colorPalette?.primary) {
                                                    e.currentTarget.style.borderColor = colorPalette.primary;
                                                    e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                                                }
                                            }}
                                            onBlur={(e) => {
                                                e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
                                                e.currentTarget.style.boxShadow = 'none';
                                            }}
                                        />
                                    </div>

                                    {/* Reason */}
                                    <div className="space-y-2">
                                        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                            Reason for Revert <span className="text-red-500">*</span>
                                        </label>
                                        <textarea
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            placeholder="Detailed reason for this revert request..."
                                            rows={5}
                                            className={`w-full px-4 py-3 rounded-lg border text-sm transition-all focus:outline-none resize-none ${isDarkMode
                                                ? 'bg-gray-800 border-gray-700 text-white'
                                                : 'bg-white border-gray-300 text-gray-900'
                                                }`}
                                            onFocus={(e) => {
                                                if (colorPalette?.primary) {
                                                    e.currentTarget.style.borderColor = colorPalette.primary;
                                                    e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                                                }
                                            }}
                                            onBlur={(e) => {
                                                e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
                                                e.currentTarget.style.boxShadow = 'none';
                                            }}
                                        />
                                        {error && (
                                            <p className="text-xs text-red-500 mt-1 font-medium">{error}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};

export default TransactionRevertModal;
