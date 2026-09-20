import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, Modal } from 'react-native';
import { Lock } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { TransactionRevert } from '../services/transactionRevertService';
import TransactionsRevertDetails from '../components/TransactionsRevertDetails';
import { useTransactionRevertStore } from '../store/transactionRevertStore';
import { StandardPage, RecordCard } from '../components/common';

const TransactionsRevert: React.FC = () => {
    // Forced light mode
    const isDarkMode = false;

    const {
        revertRequests,
        isLoading,
        error,
        fetchRevertRequests,
        fetchUpdates,
    } = useTransactionRevertStore();

    const [searchQuery, setSearchQuery] = useState('');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [selectedRevert, setSelectedRevert] = useState<TransactionRevert | null>(null);
    const [showDetails, setShowDetails] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(25);
    const [userRoleName, setUserRoleName] = useState<string>('');
    const [userOrgId, setUserOrgId] = useState<number | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const primaryColor = colorPalette?.primary || '#7c3aed';

    useEffect(() => {
        const loadAuth = async () => {
            try {
                const authData = await AsyncStorage.getItem('authData');
                if (authData) {
                    const parsed = JSON.parse(authData);
                    setUserRoleName((parsed.role_name || '').toLowerCase());
                    const orgId =
                        parsed.organization_id ||
                        parsed.user?.organization_id ||
                        parsed.organization?.id ||
                        parsed.user?.organization?.id ||
                        null;
                    setUserOrgId(orgId);
                }
            } catch (e) {
                console.error('Failed to load auth data:', e);
            }
        };
        loadAuth();
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
        fetchRevertRequests();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Silent refresh every 15 minutes
    useEffect(() => {
        const intervalId = setInterval(() => {
            fetchUpdates().catch((err) =>
                console.error('[TransactionsRevert] Idle refresh failed:', err)
            );
        }, 15 * 60 * 1000);
        return () => clearInterval(intervalId);
    }, [fetchUpdates]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchRevertRequests(true);
        setRefreshing(false);
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const yyyy = date.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
    };

    const filteredReverts = useMemo(() => {
        let filtered = revertRequests;

        if (userOrgId) {
            filtered = filtered.filter((r: TransactionRevert) => r.organization_id === userOrgId);
        } else {
            filtered = filtered.filter((r: TransactionRevert) => !r.organization_id);
        }

        if (!searchQuery) return filtered;

        const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
        return filtered.filter((r: TransactionRevert) => {
            const checkValue = (val: any): boolean => {
                if (val === null || val === undefined) return false;
                return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
            };
            return (
                checkValue(r.transaction?.account_no) ||
                checkValue(r.transaction?.account?.customer?.full_name) ||
                checkValue(r.reason) ||
                checkValue(r.remarks) ||
                checkValue(r.status) ||
                checkValue(r.requester?.email_address)
            );
        });
    }, [revertRequests, searchQuery, userOrgId]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, itemsPerPage]);

    const handleRowPress = (revert: TransactionRevert) => {
        setSelectedRevert(revert);
        setShowDetails(true);
    };

    const getStatusColor = (status?: string): string => {
        if (!status) return '#9ca3af';
        switch (status.toLowerCase()) {
            case 'done': return '#22c55e';
            case 'pending': return '#eab308';
            case 'rejected': return '#ef4444';
            default: return '#9ca3af';
        }
    };

    // Role guard
    if (userRoleName && userRoleName !== 'superadmin' && userRoleName !== 'administrator') {
        return (
            <View style={{ flex: 1, backgroundColor: '#f9fafb', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <Lock size={48} color="#d1d5db" />
                <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827', marginTop: 16 }}>Access Restricted</Text>
                <Text style={{ fontSize: 14, color: '#6b7280', marginTop: 8, textAlign: 'center' }}>
                    Only Administrators and Super Admins can view Transaction Revert Requests.
                </Text>
            </View>
        );
    }

    return (
        <StandardPage<TransactionRevert>
            data={filteredReverts}
            keyExtractor={(item) => String(item.id)}
            renderItem={(item) => (
                <RecordCard
                    title={
                        item.transaction?.account?.customer?.full_name ||
                        item.transaction?.account_no ||
                        `Request #${item.id}`
                    }
                    normalizeTitle={false}
                    titleStyle={{ fontWeight: '600', textTransform: 'uppercase' }}
                    subtitle={[
                        item.transaction?.account_no || null,
                        formatDate(item.created_at),
                        item.requester?.email_address || null,
                    ].filter(Boolean).join('  |  ')}
                    status={item.status || 'PENDING'}
                    statusColor={getStatusColor(item.status)}
                    selected={selectedRevert?.id === item.id}
                    onPress={() => handleRowPress(item)}
                >
                    {!!item.reason && (
                        <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }} numberOfLines={1}>
                            {item.reason}
                        </Text>
                    )}
                </RecordCard>
            )}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search revert requests..."
            onRefresh={handleRefresh}
            isRefreshing={isLoading}
            onPullRefresh={handleRefresh}
            pullRefreshing={refreshing}
            isLoading={isLoading && revertRequests.length === 0}
            loadingText="Loading revert requests..."
            error={error}
            onRetry={() => fetchRevertRequests(true)}
            emptyText="No revert requests found"
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            itemsPerPage={itemsPerPage}
            onItemsPerPageChange={setItemsPerPage}
            colorPalette={colorPalette}
            isDarkMode={isDarkMode}
        >
            <Modal
                visible={showDetails && selectedRevert !== null}
                animationType="slide"
                onRequestClose={() => setShowDetails(false)}
                statusBarTranslucent
            >
                {selectedRevert && (
                    <TransactionsRevertDetails
                        revert={selectedRevert}
                        onClose={() => {
                            setShowDetails(false);
                            setSelectedRevert(null);
                        }}
                        onRefresh={fetchRevertRequests}
                        isDarkMode={isDarkMode}
                        colorPalette={colorPalette}
                        onUpdate={(updated: TransactionRevert) => setSelectedRevert(updated)}
                    />
                )}
            </Modal>
        </StandardPage>
    );
};

export default TransactionsRevert;
