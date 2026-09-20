import React, { useState, useEffect, useRef } from 'react';
import {
    X, ExternalLink, Receipt, CheckCircle,
    ChevronRight, ChevronLeft, DollarSign, Calendar,
    User, Hash, MessageSquare, Image as ImageIcon
} from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { CommissionData, PayoutHistoryData } from '../types/commission';

interface CommissionDetailsProps {
    data: CommissionData | PayoutHistoryData;
    type: 'earnings' | 'payouts' | 'incentives' | 'bonus';
    onClose: () => void;
    onPrevious?: () => void;
    onNext?: () => void;
    isMobile?: boolean;
    /** Approve the record on screen. Omitted when the viewer may not approve. */
    onApprove?: (record: any) => void;
    /** Reject the record on screen. Omitted when the viewer may not approve. */
    onReject?: (record: any) => void;
    /** True while an approval or rejection is in flight. */
    approvalPending?: boolean;
}

const CommissionDetails: React.FC<CommissionDetailsProps> = ({
    data, type, onClose, onPrevious, onNext, isMobile = false,
    onApprove, onReject, approvalPending = false
}) => {
    const [localIsMobile, setLocalIsMobile] = useState<boolean>(window.innerWidth < 768);
    useEffect(() => {
        const handleResize = () => {
            setLocalIsMobile(window.innerWidth < 768);
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    const activeIsMobile = isMobile || localIsMobile;

    const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [detailsWidth, setDetailsWidth] = useState<number>(600);
    const [isResizing, setIsResizing] = useState<boolean>(false);
    const [proofImageSrc, setProofImageSrc] = useState<string>('');
    const [proofImageLoading, setProofImageLoading] = useState<boolean>(false);
    const [proofImageError, setProofImageError] = useState<boolean>(false);
    const startXRef = useRef<number>(0);
    const startWidthRef = useRef<number>(0);

    useEffect(() => {
        const observer = new MutationObserver(() => {
            setIsDarkMode(localStorage.getItem('theme') === 'dark');
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const fetchColorPalette = async () => {
            const activePalette = await settingsColorPaletteService.getActive();
            setColorPalette(activePalette);
        };
        fetchColorPalette();
    }, []);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            const diff = startXRef.current - e.clientX;
            const newWidth = Math.max(400, Math.min(1200, startWidthRef.current + diff));
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

    const getImageUrl = (url: string) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
        const baseUrl = process.env.REACT_APP_API_URL || 'https://backend.atssfiber.ph';
        return `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
    };

    const loadProofImage = async (url: string) => {
        if (!url) return;
        setProofImageLoading(true);
        setProofImageError(false);
        setProofImageSrc('');

        const apiUrl = process.env.REACT_APP_API_BASE_URL;
        const proxied = `${apiUrl}/proxy/image?url=${encodeURIComponent(url)}`;
        setProofImageSrc(proxied);
        setProofImageLoading(false);
    };

    const getDisplayText = () => {
        if (type === 'earnings') {
            const earning = data as CommissionData;
            return `${earning.id} | ${earning.customer} | ${earning.service}`;
        } else {
            const payout = data as PayoutHistoryData;
            return `${payout.ref_number} | ${payout.agent_name ?? ''}`;
        }
    };

    const renderField = (label: string, value: any, icon: any = null, isBold: boolean = false) => (
        <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {label}
            </div>
            <div className={`flex-1 flex items-center ${isBold ? 'font-bold text-lg' : ''} ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {value || '-'}
            </div>
        </div>
    );

    const isEarning = type === 'earnings';
    const earning = data as CommissionData;
    const payout = data as PayoutHistoryData;

    useEffect(() => {
        if (!isEarning && payout.proof_of_payment) {
            loadProofImage(payout.proof_of_payment);
        } else {
            setProofImageSrc('');
            setProofImageError(false);
        }
    }, [payout.proof_of_payment, isEarning, type]);

    return (
        <div className={`${activeIsMobile
                ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]'
                : 'h-full flex flex-col overflow-hidden md:border-l relative w-full md:w-auto transition-all duration-300'
            } flex flex-col overflow-hidden border-l relative ${isDarkMode
                ? 'bg-gray-950 border-white border-opacity-30'
                : 'bg-white border-gray-300'
            }`} style={!activeIsMobile && window.innerWidth >= 768 ? { width: `${detailsWidth}px` } : undefined}>

            {/* Resize Handle */}
            {!activeIsMobile && (
                <div className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-50"
                    style={{ backgroundColor: isResizing ? (colorPalette?.primary || '#7c3aed') : 'transparent' }}
                    onMouseDown={handleMouseDownResize} />
            )}

            {/* Header */}
            <div className={`p-3 flex items-center justify-between border-b ${isDarkMode
                ? 'bg-gray-800 border-gray-700'
                : 'bg-gray-100 border-gray-200'
                }`}>
                <div className="flex items-center min-w-0 flex-1">
                    <h2 className={`font-medium truncate pr-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {getDisplayText()}
                    </h2>
                </div>

                <div className="flex items-center space-x-3">
                    {/* Approve / Reject, ahead of the record arrows.
                        Offered only while the record is Pending and only to a
                        viewer permitted to approve — the same test the detail
                        section used before these moved up here. */}
                    {!isEarning && (onApprove || onReject) && ((payout as any).status ?? 'Pending') === 'Pending' && (
                        <div className="flex items-center gap-2">
                            {onApprove && (
                                <button
                                    type="button"
                                    disabled={approvalPending}
                                    onClick={() => onApprove(payout)}
                                    title="Approve this payout and apply it to the agent's balance"
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                                >
                                    {approvalPending ? 'Working…' : 'Approve'}
                                </button>
                            )}
                            {onReject && (
                                <button
                                    type="button"
                                    disabled={approvalPending}
                                    onClick={() => onReject(payout)}
                                    title="Reject this payout. No money is moved."
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                                >
                                    Reject
                                </button>
                            )}
                        </div>
                    )}

                    <div className="flex items-center">
                        <button onClick={onPrevious} disabled={!onPrevious}
                            className={`p-2 rounded transition-colors ${!onPrevious ? 'opacity-50 cursor-not-allowed' : ''} ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'}`}
                            title="Previous Record">
                            <ChevronLeft size={18} />
                        </button>
                        <button onClick={onNext} disabled={!onNext}
                            className={`p-2 rounded transition-colors ${!onNext ? 'opacity-50 cursor-not-allowed' : ''} ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'}`}
                            title="Next Record">
                            <ChevronRight size={18} />
                        </button>
                    </div>
                    <button onClick={onClose} className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}>
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className={`flex-1 overflow-y-auto w-full ${activeIsMobile ? 'pb-24' : ''}`}>
                <div className={`mx-auto py-1 px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-white'}`}>
                    <div className="space-y-1">
                        {isEarning ? (
                            <>
                                {renderField('Transaction ID', earning.id)}
                                {renderField('Customer', earning.customer, null, true)}
                                {renderField('Service Type', earning.service)}
                                {renderField('Date Earned', earning.date)}
                                <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
                                    <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Status</div>
                                    <div className="flex-1">
                                        <div className={`capitalize ${earning.status === 'Paid' ? 'text-green-500' : 'text-yellow-500'}`}>
                                            {earning.status}
                                        </div>
                                    </div>
                                </div>
                                {renderField('Commission Amount', earning.amount, null, true)}
                            </>
                        ) : (
                            <>
                                {renderField('ID', payout.id)}
                                {renderField('Reference No.', payout.ref_number)}
                                {payout.type && (payout.type === 'incentives' || payout.type === 'incentives_payout') && renderField('Transaction Type', payout.type === 'incentives_payout' ? 'Payout' : 'Add Incentives')}
                                {type !== 'incentives' && renderField('Job Orders', payout.commission_id_list ? payout.commission_id_list.split(',').map((id: string) => `#${id.trim()}`).join(', ') : '---')}
                                {renderField('Date Processed', new Date(payout.created_at).toLocaleString())}
                                {renderField('Processed By', payout.created_by)}
                                {renderField('Agent Name', payout.agent_name)}
                                {/* Approval, shown the same way as on a transaction. */}
                                {renderField('Status', (payout as any).status || 'Pending')}
                                {renderField('Approved By', (payout as any).approved_by || (payout as any).approve_by || 'Not yet approved')}
                                {renderField('Remarks', payout.remarks || 'No remarks provided')}

                                <div className="mt-4">
                                    <p className={`text-xs font-bold uppercase tracking-wider mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Proof of Payment</p>
                                    {payout.proof_of_payment ? (
                                        <div className="mt-2">
                                            {proofImageLoading && (
                                                <p className="text-sm text-gray-500 italic">Loading image...</p>
                                            )}
                                            {proofImageError && (
                                                <p className="text-sm text-red-500 italic">Failed to load image. <a href={payout.proof_of_payment} target="_blank" rel="noreferrer" className="underline">Open link</a></p>
                                            )}
                                            {proofImageSrc && !proofImageLoading && (
                                                <div className="relative group cursor-pointer" onClick={() => window.open(payout.proof_of_payment!, '_blank')}>
                                                    <img src={proofImageSrc} alt="Proof" className="max-w-full rounded border border-inherit" />
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded">
                                                        <ExternalLink size={20} className="text-white" />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-gray-500 italic">No proof attached</p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CommissionDetails;
