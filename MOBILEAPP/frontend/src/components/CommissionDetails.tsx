import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    Modal,
    ScrollView,
    TouchableOpacity,
    Image,
    ActivityIndicator,
    Linking,
    useWindowDimensions,
} from 'react-native';
import { X, ExternalLink, ChevronRight, ChevronLeft } from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { CommissionData, PayoutHistoryData } from '../types/commission';

interface CommissionDetailsProps {
    data: CommissionData | PayoutHistoryData;
    type: 'earnings' | 'payouts' | 'incentives' | 'bonus';
    onClose: () => void;
    onPrevious?: () => void;
    onNext?: () => void;
    isMobile?: boolean;
    /**
     * Settling a pending payout. Both are optional: the caller passes them only
     * for a viewer permitted to approve, so an unpermitted reader never sees the
     * buttons rather than seeing them and being refused.
     */
    onApprove?: (record: any) => void;
    onReject?: (record: any) => void;
    /** True while a decision is in flight, so neither can be pressed twice. */
    approvalPending?: boolean;
}

// Forced light mode to match the ~50 already-migrated pages.
const isDarkMode = false;

const CommissionDetails: React.FC<CommissionDetailsProps> = ({
    data, type, onClose, onPrevious, onNext,
    onApprove, onReject, approvalPending = false,
}) => {
    const { width } = useWindowDimensions();
    const isTablet = width >= 768;

    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [proofImageSrc, setProofImageSrc] = useState<string>('');
    const [proofImageLoading, setProofImageLoading] = useState<boolean>(false);
    const [proofImageError, setProofImageError] = useState<boolean>(false);

    useEffect(() => {
        const fetchColorPalette = async () => {
            const activePalette = await settingsColorPaletteService.getActive();
            setColorPalette(activePalette);
        };
        fetchColorPalette();
    }, []);

    const loadProofImage = async (url: string) => {
        if (!url) return;
        setProofImageLoading(true);
        setProofImageError(false);
        setProofImageSrc('');

        // Build a proxy URL from the API base if available; otherwise use the raw url.
        const apiUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || '');
        if (apiUrl) {
            const proxied = `${apiUrl}/proxy/image?url=${encodeURIComponent(url)}`;
            setProofImageSrc(proxied);
        } else {
            setProofImageSrc(url);
        }
        setProofImageLoading(false);
    };

    const getDisplayText = () => {
        if (type === 'earnings') {
            const earning = data as CommissionData;
            return `${earning.id} | ${earning.customer} | ${earning.service}`;
        }
        const payout = data as PayoutHistoryData;
        return `${payout.ref_number} | ${payout.agent_name ?? ''}`;
    };

    const primaryColor = colorPalette?.primary || '#7c3aed';
    const pageBg = '#ffffff';
    const headerBg = '#f3f4f6';
    const borderColor = '#e5e7eb';
    const rowBorder = '#e5e7eb';
    const labelColor = '#6b7280';
    const valueColor = '#111827';
    const mutedColor = '#9ca3af';

    const renderField = (label: string, value: any, isBold: boolean = false) => (
        <View style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: rowBorder }}>
            <Text style={{ width: 140, fontSize: 13, color: labelColor }}>{label}</Text>
            <Text style={{ flex: 1, color: valueColor, fontWeight: isBold ? '700' : '400', fontSize: isBold ? 17 : 14 }}>
                {value !== undefined && value !== null && value !== '' ? String(value) : '-'}
            </Text>
        </View>
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [payout.proof_of_payment, isEarning, type]);

    return (
        <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
            <View style={{ flex: 1, backgroundColor: pageBg }}>
                {/* Header */}
                <View style={{
                    paddingHorizontal: 12,
                    paddingTop: isTablet ? 16 : 60,
                    paddingBottom: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottomWidth: 1,
                    borderBottomColor: borderColor,
                    backgroundColor: headerBg,
                }}>
                    <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                        <Text numberOfLines={1} style={{ fontWeight: '500', color: valueColor }}>
                            {getDisplayText()}
                        </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {/* Only while the record is still Pending, and only when
                            the caller supplied the handlers. */}
                        {!isEarning && (onApprove || onReject)
                            && ((payout as any).status ?? 'Pending') === 'Pending' && (
                            <>
                                {onApprove && (
                                    <TouchableOpacity
                                        onPress={() => onApprove(payout)}
                                        disabled={approvalPending}
                                        style={{
                                            paddingHorizontal: 12,
                                            paddingVertical: 6,
                                            borderRadius: 8,
                                            backgroundColor: '#16a34a',
                                            opacity: approvalPending ? 0.5 : 1,
                                        }}
                                    >
                                        <Text style={{ fontSize: 12, fontWeight: '600', color: '#ffffff' }}>
                                            {approvalPending ? 'Working…' : 'Approve'}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                                {onReject && (
                                    <TouchableOpacity
                                        onPress={() => onReject(payout)}
                                        disabled={approvalPending}
                                        style={{
                                            paddingHorizontal: 12,
                                            paddingVertical: 6,
                                            borderRadius: 8,
                                            backgroundColor: '#dc2626',
                                            opacity: approvalPending ? 0.5 : 1,
                                        }}
                                    >
                                        <Text style={{ fontSize: 12, fontWeight: '600', color: '#ffffff' }}>
                                            Reject
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </>
                        )}
                        <TouchableOpacity
                            onPress={onPrevious}
                            disabled={!onPrevious}
                            style={{ padding: 8, borderRadius: 6, opacity: !onPrevious ? 0.4 : 1 }}
                        >
                            <ChevronLeft size={18} color={labelColor} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={onNext}
                            disabled={!onNext}
                            style={{ padding: 8, borderRadius: 6, opacity: !onNext ? 0.4 : 1 }}
                        >
                            <ChevronRight size={18} color={labelColor} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
                            <X size={18} color={labelColor} />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Content */}
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4, paddingBottom: 40 }}>
                    {isEarning ? (
                        <View>
                            {renderField('Transaction ID', earning.id)}
                            {renderField('Customer', earning.customer, true)}
                            {renderField('Service Type', earning.service)}
                            {renderField('Date Earned', earning.date)}
                            <View style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: rowBorder }}>
                                <Text style={{ width: 140, fontSize: 13, color: labelColor }}>Status</Text>
                                <Text style={{
                                    flex: 1,
                                    textTransform: 'capitalize',
                                    color: earning.status === 'Paid' ? '#16a34a' : '#ca8a04',
                                }}>
                                    {earning.status}
                                </Text>
                            </View>
                            {renderField('Commission Amount', earning.amount, true)}
                        </View>
                    ) : (
                        <View>
                            {renderField('ID', payout.id)}
                            {renderField('Reference No.', payout.ref_number)}
                            {payout.type && (payout.type === 'incentives' || payout.type === 'incentives_payout')
                                ? renderField('Transaction Type', payout.type === 'incentives_payout' ? 'Payout' : 'Add Incentives')
                                : null}
                            {type !== 'incentives'
                                ? renderField('Job Orders', payout.commission_id_list
                                    ? payout.commission_id_list.split(',').map((id: string) => `#${id.trim()}`).join(', ')
                                    : '---')
                                : null}
                            {renderField('Date Processed', payout.created_at ? new Date(payout.created_at).toLocaleString() : '-')}
                            {renderField('Processed By', payout.created_by)}
                            {renderField('Agent Name', payout.agent_name)}
                            {renderField('Remarks', payout.remarks || 'No remarks provided')}

                            <View style={{ marginTop: 16 }}>
                                <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, color: mutedColor }}>
                                    Proof of Payment
                                </Text>
                                {payout.proof_of_payment ? (
                                    <View style={{ marginTop: 8 }}>
                                        {proofImageLoading ? (
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                <ActivityIndicator size="small" color={primaryColor} />
                                                <Text style={{ fontSize: 13, fontStyle: 'italic', color: mutedColor }}>Loading image...</Text>
                                            </View>
                                        ) : null}
                                        {proofImageError ? (
                                            <TouchableOpacity onPress={() => payout.proof_of_payment && Linking.openURL(payout.proof_of_payment)}>
                                                <Text style={{ fontSize: 13, fontStyle: 'italic', color: '#ef4444' }}>
                                                    Failed to load image. Tap to open link.
                                                </Text>
                                            </TouchableOpacity>
                                        ) : null}
                                        {proofImageSrc && !proofImageLoading ? (
                                            <TouchableOpacity
                                                activeOpacity={0.9}
                                                onPress={() => payout.proof_of_payment && Linking.openURL(payout.proof_of_payment)}
                                                style={{ position: 'relative' }}
                                            >
                                                <Image
                                                    source={{ uri: proofImageSrc }}
                                                    onError={() => setProofImageError(true)}
                                                    style={{ width: '100%', height: 260, resizeMode: 'contain', borderRadius: 6, borderWidth: 1, borderColor }}
                                                />
                                                <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, padding: 6 }}>
                                                    <ExternalLink size={16} color="#ffffff" />
                                                </View>
                                            </TouchableOpacity>
                                        ) : null}
                                    </View>
                                ) : (
                                    <Text style={{ fontSize: 13, fontStyle: 'italic', color: mutedColor }}>No proof attached</Text>
                                )}
                            </View>
                        </View>
                    )}
                </ScrollView>
            </View>
        </Modal>
    );
};

export default CommissionDetails;
