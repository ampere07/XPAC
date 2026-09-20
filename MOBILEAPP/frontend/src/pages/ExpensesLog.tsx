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
} from 'react-native';
import { Eye, Download, RefreshCw, X } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlobalSearch from './globalfunctions/GlobalSearch';
import ExpensesLogDetails from '../components/ExpensesLogDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { exportToCSV } from '../utils/exportUtils';
import apiClient from '../config/api';

interface ExpenseRecord {
  id: string;
  expensesId: string;
  date: string;
  amount: number;
  payee: string;
  category: string;
  description: string;
  invoiceNo: string;
  provider: string;
  photo?: string;
  processedBy: string;
  modifiedBy: string;
  modifiedDate: string;
  userEmail: string;
  receivedDate: string;
  supplier: string;
  city: string;
  organization_id?: number;
}

const exportColumns = [
  { key: 'date', label: 'Date' },
  { key: 'amount', label: 'Amount' },
  { key: 'payee', label: 'Payee' },
  { key: 'category', label: 'Category' },
  { key: 'description', label: 'Description' },
  { key: 'invoiceNo', label: 'Invoice No.' },
  { key: 'provider', label: 'Provider' },
  { key: 'processedBy', label: 'Processed By' },
  { key: 'modifiedBy', label: 'Modified By' },
  { key: 'modifiedDate', label: 'Modified Date' },
];

const formatAmount = (value: number) =>
  `₱${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const ExpensesLog: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expenseRecords, setExpenseRecords] = useState<ExpenseRecord[]>([]);
  const [selectedExpense, setSelectedExpense] = useState<ExpenseRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [userOrgId, setUserOrgId] = useState<number | null>(null);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

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
    const loadOrg = async () => {
      try {
        const raw = await AsyncStorage.getItem('authData');
        const authData = raw ? JSON.parse(raw) : {};
        setUserOrgId(authData.organization_id ?? null);
      } catch (err) {
        console.error('Failed to load auth data:', err);
      }
    };
    loadOrg();
  }, []);

  const fetchExpenseData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.get('/expenses-logs');
      const result = response.data;

      if (result.status === 'success') {
        setExpenseRecords(result.data);
      } else {
        throw new Error(result.message || 'Failed to fetch expense records');
      }
    } catch (err: any) {
      console.error('Failed to fetch expense data:', err);
      setError(err.message || 'Failed to load expense records. Please try again.');
      setExpenseRecords([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenseData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto silent-refresh every 15 minutes.
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchExpenseData().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchExpenseData();
    setRefreshing(false);
  };

  const filteredExpenseRecords = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return expenseRecords.filter((record) => {
      // Organization filter
      if (userOrgId && record.organization_id && record.organization_id !== userOrgId) {
        return false;
      }
      if (q === '') return true;
      return (
        String(record.payee || '').toLowerCase().includes(q) ||
        String(record.description || '').toLowerCase().includes(q) ||
        String(record.category || '').toLowerCase().includes(q) ||
        String(record.invoiceNo || '').toLowerCase().includes(q)
      );
    });
  }, [expenseRecords, searchQuery, userOrgId]);

  const renderCell = (item: ExpenseRecord, key: string) => {
    if (key === 'amount') return formatAmount(item.amount);
    return (item as any)[key] ?? '';
  };

  const handleExport = () => {
    if (filteredExpenseRecords.length === 0) return;
    exportToCSV('expense_records', exportColumns, filteredExpenseRecords, renderCell);
  };

  const renderItem = ({ item }: { item: ExpenseRecord }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => setSelectedExpense(item)}
      style={{
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 }} numberOfLines={1}>
          {item.payee || 'Unknown'}
        </Text>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>{formatAmount(item.amount)}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
        {!!item.date && <Field label="Date" value={String(item.date)} />}
        {!!item.category && <Field label="Category" value={String(item.category)} />}
        {!!item.provider && <Field label="Provider" value={String(item.provider)} />}
      </View>
      {!!item.description && (
        <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }} numberOfLines={2}>
          {item.description}
        </Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
        {!!item.invoiceNo && (
          <Text style={{ fontSize: 11, color: '#dc2626', fontWeight: '600' }}>{item.invoiceNo}</Text>
        )}
        {!!item.photo && <Eye size={14} color={primaryColor} />}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: isTablet ? 16 : 60,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#ffffff',
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search expense records..."
          />
          <TouchableOpacity
            onPress={handleExport}
            style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}
          >
            <Download size={16} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={fetchExpenseData}
            style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}
          >
            {isLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 12, color: '#6b7280' }}>{filteredExpenseRecords.length} records</Text>
      </View>

      {/* Body */}
      {isLoading && expenseRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading expense records...</Text>
        </View>
      ) : error && expenseRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 }}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={fetchExpenseData}
            style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredExpenseRecords}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No expense records found matching your search</Text>
            </View>
          }
        />
      )}

      {/* Expense Details Modal */}
      <Modal
        visible={!!selectedExpense}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setSelectedExpense(null)}
      >
        <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingTop: isTablet ? 16 : 60,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: '#e5e7eb',
              backgroundColor: '#f9fafb',
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>
              {selectedExpense?.payee || 'Expense Details'}
            </Text>
            <TouchableOpacity
              onPress={() => setSelectedExpense(null)}
              style={{ padding: 6, borderRadius: 6, backgroundColor: '#f1f5f9' }}
            >
              <X size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>
          {selectedExpense && <ExpensesLogDetails expenseRecord={selectedExpense} />}
        </View>
      </Modal>
    </View>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Text style={{ fontSize: 11, color: '#6b7280' }}>
    <Text style={{ fontWeight: '600' }}>{label}: </Text>
    {value}
  </Text>
);

export default ExpensesLog;
