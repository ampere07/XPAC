import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Modal,
    Alert,
    SafeAreaView,
} from 'react-native';
import { X, RefreshCw } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
    isDarkMode = false,
    colorPalette,
    onUpdate,
}) => {
    const [loading, setLoading] = useState(false);
    const [loadingPercentage, setLoadingPercentage] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [showConfirmRevert, setShowConfirmRevert] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [currentRevert, setCurrentRevert] = useState<TransactionRevert>(revert);
    const [currentUserEmail, setCurrentUserEmail] = useState('');
    const [currentUserRole, setCurrentUserRole] = useState('');
    const [currentUserRoleId, setCurrentUserRoleId] = useState('');

    const { refreshLatestData } = useBillingStore();
    const primaryColor = colorPalette?.primary || '#7c3aed';

    useEffect(() => {
        setCurrentRevert(revert);
    }, [revert]);

    useEffect(() => {
        const loadAuth = async () => {
            try {
                const authData = await AsyncStorage.getItem('authData');
                if (authData) {
                    const parsed = JSON.parse(authData);
                    setCurrentUserEmail(parsed.email_address || '');
                    setCurrentUserRole((parsed.role_name || '').toLowerCase());
                    setCurrentUserRoleId(String(parsed.role_id || ''));
                }
            } catch (e) {
                console.error('Failed to load auth data:', e);
            }
        };
        loadAuth();
    }, []);

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

    const getStatusColor = (status?: string): string => {
        const s = (status || '').toLowerCase();
        if (s === 'pending') return '#eab308';
        if (s === 'done') return '#22c55e';
        if (s === 'rejected') return '#ef4444';
        return '#9ca3af';
    };

    const handleRevertConfirm = async () => {
        setShowConfirmRevert(false);
        setLoading(true);
        setLoadingPercentage(10);
        setError(null);

        try {
            setLoadingPercentage(30);
            const result = await transactionRevertService.updateRevertStatus(currentRevert.id, 'done', currentUserEmail);
            setLoadingPercentage(80);

            if (result.success) {
                setLoadingPercentage(100);
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
    const canRevert = isPending && (currentUserRole === 'superadmin' || currentUserRoleId === '7');

    const renderField = (label: string, value: any) => (
        <View style={{ flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
            <Text style={{ width: 140, fontSize: 13, color: '#6b7280', flexShrink: 0 }}>{label}</Text>
            <Text style={{ flex: 1, fontSize: 13, color: '#111827' }}>{value || '-'}</Text>
        </View>
    );

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f9fafb' }}>
            <LoadingModal
                isOpen={loading}
                type="loading"
                title="Processing Revert"
                message="Processing revert..."
                loadingPercentage={loadingPercentage}
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
            />

            {/* Header */}
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                paddingVertical: 12,
                backgroundColor: '#f3f4f6',
                borderBottomWidth: 1,
                borderBottomColor: '#e5e7eb',
            }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', flex: 1, marginRight: 8 }} numberOfLines={1}>
                    {`Revert Request #${currentRevert.id}`}
                    {transaction?.account_no ? ` — ${transaction.account_no}` : ''}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    {canRevert && (
                        <TouchableOpacity
                            onPress={() => setShowConfirmRevert(true)}
                            disabled={loading}
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6,
                                backgroundColor: loading ? '#4b5563' : '#ef4444',
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderRadius: 6,
                            }}
                        >
                            <RefreshCw size={15} color="#ffffff" />
                            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>
                                {loading ? 'Reverting...' : 'Revert'}
                            </Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                        <X size={20} color="#6b7280" />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Error */}
            {!!error && (
                <View style={{ margin: 12, padding: 12, borderRadius: 8, backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fca5a5' }}>
                    <Text style={{ fontSize: 13, color: '#b91c1c' }}>{error}</Text>
                </View>
            )}

            {/* Content */}
            <ScrollView style={{ flex: 1, backgroundColor: '#ffffff' }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                {/* Revert Request Fields */}
                {renderField('Request ID', `#${currentRevert.id}`)}
                <View style={{ flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                    <Text style={{ width: 140, fontSize: 13, color: '#6b7280', flexShrink: 0 }}>Status</Text>
                    <View style={{
                        backgroundColor: getStatusColor(currentRevert.status) + '20',
                        borderRadius: 4,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderWidth: 1,
                        borderColor: getStatusColor(currentRevert.status) + '50',
                        alignSelf: 'flex-start',
                    }}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: getStatusColor(currentRevert.status), textTransform: 'capitalize' }}>
                            {currentRevert.status || 'Unknown'}
                        </Text>
                    </View>
                </View>
                {renderField('Requested By', currentRevert.requester?.email_address || (currentRevert.requested_by ? `User ID: ${currentRevert.requested_by}` : '-'))}
                {renderField('Updated By', currentRevert.updater?.email_address || (currentRevert.updated_by ? `User ID: ${currentRevert.updated_by}` : '-'))}
                {renderField('Remarks', currentRevert.remarks || 'No remarks')}
                <View style={{ flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                    <Text style={{ width: 140, fontSize: 13, color: '#6b7280', flexShrink: 0 }}>Reason</Text>
                    <Text style={{ flex: 1, fontSize: 13, color: '#111827' }}>{currentRevert.reason || '-'}</Text>
                </View>
                {renderField('Submitted At', formatDate(currentRevert.created_at))}
                {renderField('Updated At', formatDate(currentRevert.updated_at))}

                {/* Transaction Details Section */}
                {transaction && (
                    <>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 24, marginBottom: 4 }}>
                            Transaction Details
                        </Text>
                        {renderField('Transaction ID', `#${transaction.id}`)}
                        {renderField('Account No.', transaction.account_no)}
                        {renderField('Full Name', transaction.account?.customer?.full_name)}
                        {renderField('Transaction Type', transaction.transaction_type)}
                        <View style={{ flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                            <Text style={{ width: 140, fontSize: 13, color: '#6b7280', flexShrink: 0 }}>Amount</Text>
                            <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: '#111827' }}>
                                {formatCurrency(transaction.received_payment)}
                            </Text>
                        </View>
                        {renderField('Payment Method', transaction.payment_method_info?.payment_method || transaction.payment_method)}
                        {renderField('Reference No.', transaction.reference_no)}
                        {renderField('OR No.', transaction.or_no)}
                        {renderField('Processed By', transaction.processor?.email_address || transaction.processed_by_user)}
                        {renderField('Approved By', transaction.approved_by)}
                        <View style={{ flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                            <Text style={{ width: 140, fontSize: 13, color: '#6b7280', flexShrink: 0 }}>Tx Status</Text>
                            <Text style={{
                                flex: 1, fontSize: 13, fontWeight: '600', textTransform: 'capitalize',
                                color: getStatusColor(transaction.status),
                            }}>
                                {transaction.status || '-'}
                            </Text>
                        </View>
                        {renderField('Payment Date', formatDate(transaction.payment_date))}
                        {renderField('Barangay', transaction.account?.customer?.barangay)}
                        {renderField('City', transaction.account?.customer?.city)}
                    </>
                )}

                <View style={{ height: 32 }} />
            </ScrollView>

            {/* Confirm Revert Modal */}
            <Modal
                visible={showConfirmRevert}
                transparent
                animationType="fade"
                statusBarTranslucent
                onRequestClose={() => setShowConfirmRevert(false)}
            >
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                    <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 448, borderWidth: 1, borderColor: '#d1d5db' }}>
                        <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 12 }}>Confirm Revert</Text>
                        <Text style={{ fontSize: 14, color: '#374151', marginBottom: 24, lineHeight: 22 }}>
                            Are you sure you want to revert this transaction? This will add the payment amount back to the account balance and mark paid invoices as unpaid. The revert request will be marked as{' '}
                            <Text style={{ fontWeight: '700', color: '#22c55e' }}>Done</Text>.
                        </Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
                            <TouchableOpacity
                                onPress={() => setShowConfirmRevert(false)}
                                style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#e5e7eb' }}
                            >
                                <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827' }}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleRevertConfirm}
                                style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#ef4444' }}
                            >
                                <Text style={{ fontSize: 14, fontWeight: '600', color: '#ffffff' }}>Confirm Revert</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Success Modal */}
            <Modal
                visible={showSuccessModal}
                transparent
                animationType="fade"
                statusBarTranslucent
                onRequestClose={() => setShowSuccessModal(false)}
            >
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                    <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 448, borderWidth: 1, borderColor: '#d1d5db' }}>
                        <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 12 }}>Success</Text>
                        <Text style={{ fontSize: 14, color: '#374151', marginBottom: 24, lineHeight: 22 }}>{successMessage}</Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                            <TouchableOpacity
                                onPress={() => setShowSuccessModal(false)}
                                style={{ paddingHorizontal: 28, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}
                            >
                                <Text style={{ fontSize: 14, fontWeight: '600', color: '#ffffff' }}>Done</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
};

export default TransactionsRevertDetails;
