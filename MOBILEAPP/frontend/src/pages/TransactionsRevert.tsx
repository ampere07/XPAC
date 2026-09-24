import React, { useState, useEffect, useMemo } from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
    Dimensions,
    Modal,
    ScrollView,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { RefreshCw, ChevronsLeft, ChevronsRight } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { TransactionRevert } from '../services/transactionRevertService';
import { getUserDisplayName } from '../utils/userDisplay';
import TransactionsRevertDetails from '../components/TransactionsRevertDetails';
import { useTransactionRevertStore } from '../store/transactionRevertStore';
import GlobalSearch from './globalfunctions/GlobalSearch';

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

    const { width } = Dimensions.get('window');
    const isTablet = width >= 768;
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

    const totalPages = Math.ceil(filteredReverts.length / itemsPerPage);

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
        }
    };

    const paginatedReverts = useMemo(() => {
        return filteredReverts.slice(
            (currentPage - 1) * itemsPerPage,
            currentPage * itemsPerPage
        );
    }, [filteredReverts, currentPage, itemsPerPage]);

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
                <RefreshCw size={48} color="#d1d5db" />
                <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827', marginTop: 16 }}>Access Restricted</Text>
                <Text style={{ fontSize: 14, color: '#6b7280', marginTop: 8, textAlign: 'center' }}>
                    Only Administrators and Super Admins can view Transaction Revert Requests.
                </Text>
            </View>
        );
    }

    const renderItem = ({ item }: { item: TransactionRevert }) => {
        const isSelected = selectedRevert?.id === item.id;
        return (
            <TouchableOpacity
                onPress={() => handleRowPress(item)}
                style={{
                    backgroundColor: isSelected ? '#f3f4f6' : '#ffffff',
                    borderBottomWidth: 1,
                    borderBottomColor: '#e5e7eb',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                }}
            >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827', textTransform: 'uppercase' }} numberOfLines={1}>
                            {item.transaction?.account?.customer?.full_name || item.transaction?.account_no || `Request #${item.id}`}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                            {!!item.transaction?.account_no && (
                                <>
                                    <Text style={{ fontSize: 12, color: '#3b82f6', fontWeight: '500' }}>{item.transaction.account_no}</Text>
                                    <Text style={{ fontSize: 12, color: '#9ca3af', marginHorizontal: 4 }}>|</Text>
                                </>
                            )}
                            <Text style={{ fontSize: 12, color: '#6b7280' }}>{formatDate(item.created_at)}</Text>
                            {!!item.requester?.email_address && (
                                <>
                                    <Text style={{ fontSize: 12, color: '#9ca3af', marginHorizontal: 4 }}>|</Text>
                                    <Text style={{ fontSize: 12, color: '#6b7280' }} numberOfLines={1}>{getUserDisplayName(item.requester, item.requester.email_address)}</Text>
                                </>
                            )}
                        </View>
                        {!!item.reason && (
                            <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }} numberOfLines={1}>{item.reason}</Text>
                        )}
                    </View>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: getStatusColor(item.status), flexShrink: 0 }}>
                        {(item.status || 'PENDING').toUpperCase()}
                    </Text>
                </View>
            </TouchableOpacity>
        );
    };

    const PaginationControls = () => {
        if (totalPages <= 1) return null;
        const start = (currentPage - 1) * itemsPerPage + 1;
        const end = Math.min(currentPage * itemsPerPage, filteredReverts.length);
        return (
            <View style={{ borderTopWidth: 1, borderTopColor: '#e5e7eb', backgroundColor: '#ffffff', padding: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                    <Text style={{ fontSize: 12, color: '#6b7280' }}>Show</Text>
                    <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', minWidth: 80, height: 36, justifyContent: 'center' }}>
                        <Picker
                            selectedValue={itemsPerPage}
                            onValueChange={(v) => setItemsPerPage(Number(v))}
                            style={{ color: '#111827', height: 36 }}
                            dropdownIconColor="#6b7280"
                        >
                            <Picker.Item label="10" value={10} />
                            <Picker.Item label="25" value={25} />
                            <Picker.Item label="50" value={50} />
                            <Picker.Item label="100" value={100} />
                        </Picker>
                    </View>
                    <Text style={{ fontSize: 12, color: '#6b7280' }}>entries</Text>
                    <Text style={{ fontSize: 12, color: '#6b7280' }}>
                        | Showing {start}–{end} of {filteredReverts.length}
                    </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    <TouchableOpacity
                        onPress={() => handlePageChange(1)}
                        disabled={currentPage === 1}
                        style={{ padding: 6, borderRadius: 6, backgroundColor: currentPage === 1 ? '#f3f4f6' : '#ffffff', borderWidth: 1, borderColor: '#d1d5db' }}
                    >
                        <ChevronsLeft size={16} color={currentPage === 1 ? '#9ca3af' : '#374151'} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: currentPage === 1 ? '#f3f4f6' : '#ffffff', borderWidth: 1, borderColor: '#d1d5db' }}
                    >
                        <Text style={{ fontSize: 13, color: currentPage === 1 ? '#9ca3af' : '#374151' }}>Prev</Text>
                    </TouchableOpacity>
                    <Text style={{ fontSize: 13, color: '#111827', paddingHorizontal: 4 }}>
                        {currentPage} / {totalPages}
                    </Text>
                    <TouchableOpacity
                        onPress={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: currentPage === totalPages ? '#f3f4f6' : '#ffffff', borderWidth: 1, borderColor: '#d1d5db' }}
                    >
                        <Text style={{ fontSize: 13, color: currentPage === totalPages ? '#9ca3af' : '#374151' }}>Next</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => handlePageChange(totalPages)}
                        disabled={currentPage === totalPages}
                        style={{ padding: 6, borderRadius: 6, backgroundColor: currentPage === totalPages ? '#f3f4f6' : '#ffffff', borderWidth: 1, borderColor: '#d1d5db' }}
                    >
                        <ChevronsRight size={16} color={currentPage === totalPages ? '#9ca3af' : '#374151'} />
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    return (
        <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
            {/* Header */}
            <View style={{
                paddingHorizontal: 16,
                paddingTop: isTablet ? 16 : 60,
                paddingBottom: 12,
                borderBottomWidth: 1,
                borderBottomColor: '#e5e7eb',
                backgroundColor: '#ffffff',
                gap: 10,
            }}>
                <Text style={{ fontSize: 20, fontWeight: '600', color: '#111827' }}>
                    Transaction Revert Requests
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                        <GlobalSearch
                            searchQuery={searchQuery}
                            setSearchQuery={setSearchQuery}
                            isDarkMode={isDarkMode}
                            colorPalette={colorPalette}
                            placeholder="Search revert requests..."
                        />
                    </View>
                    <TouchableOpacity
                        onPress={handleRefresh}
                        disabled={isLoading}
                        style={{
                            padding: 10,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: primaryColor,
                            backgroundColor: '#ffffff',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: isLoading ? 0.5 : 1,
                        }}
                    >
                        {isLoading
                            ? <ActivityIndicator size="small" color={primaryColor} />
                            : <RefreshCw size={18} color={primaryColor} />
                        }
                    </TouchableOpacity>
                </View>
            </View>

            {/* Body */}
            {isLoading && revertRequests.length === 0 ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="large" color={primaryColor} />
                    <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading revert requests...</Text>
                </View>
            ) : error && revertRequests.length === 0 ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 }}>
                    <Text style={{ fontSize: 16, color: '#ef4444', textAlign: 'center' }}>{error}</Text>
                    <TouchableOpacity
                        onPress={() => fetchRevertRequests(true)}
                        style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}
                    >
                        <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={paginatedReverts}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={renderItem}
                    initialNumToRender={20}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                            tintColor={primaryColor}
                            colors={[primaryColor]}
                        />
                    }
                    ListEmptyComponent={
                        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
                            <Text style={{ color: '#9ca3af' }}>No revert requests found</Text>
                        </View>
                    }
                    ListFooterComponent={<PaginationControls />}
                />
            )}

            {/* Details Modal */}
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
        </View>
    );
};

export default TransactionsRevert;
