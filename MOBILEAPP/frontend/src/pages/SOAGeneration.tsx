import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  StyleSheet,
  Alert,
} from 'react-native';
import {
  Plus,
  FileText,
  Calendar,
  DollarSign,
  User,
  Mail,
  Phone,
  MapPin,
  Eye,
  Trash2,
} from 'lucide-react-native';
import { SOAProvider, SOARecordUI, useSOAContext } from '../contexts/SOAContext';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

// ─── Status helpers ───────────────────────────────────────────────────────────

const getStatusColors = (status: string | undefined) => {
  switch (status) {
    case 'Generated':
      return { bg: '#dbeafe', text: '#1d4ed8' };
    case 'Sent':
      return { bg: '#dcfce7', text: '#16a34a' };
    case 'Pending':
      return { bg: '#fef9c3', text: '#ca8a04' };
    default:
      return { bg: '#f3f4f6', text: '#6b7280' };
  }
};

// ─── Inner component (needs SOAProvider above) ────────────────────────────────

const SOAGenerationInner: React.FC = () => {
  const isDarkMode = false;
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { soaRecords, isLoading, error, refreshSOARecords, silentRefresh } = useSOAContext();

  const primaryColor = colorPalette?.primary || '#7c3aed';

  // ─── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const loadPalette = async () => {
      try {
        setColorPalette(await settingsColorPaletteService.getActive());
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    loadPalette();
  }, []);

  // Silent refresh every 15 minutes
  useEffect(() => {
    const id = setInterval(() => {
      silentRefresh().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [silentRefresh]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSOARecords();
    } finally {
      setRefreshing(false);
    }
  };

  const handleGenerateSOA = () => {
    Alert.alert('Coming Soon', 'SOA generation will be available in a future update.');
  };

  const handleViewSOA = (record: SOARecordUI) => {
    Alert.alert(
      `SOA #${record.statementNo || record.id}`,
      [
        `Account: ${record.accountNo}`,
        `Customer: ${record.fullName}`,
        `Statement Date: ${record.statementDate}`,
        `Due Date: ${record.dueDate}`,
        `Amount Due: ₱${record.amountDue.toFixed(2)}`,
        `Total Amount Due: ₱${record.totalAmountDue.toFixed(2)}`,
      ].join('\n'),
    );
  };

  const handleDeleteSOA = (record: SOARecordUI) => {
    Alert.alert(
      'Delete SOA',
      `Are you sure you want to delete SOA #${record.statementNo || record.id} for ${record.fullName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Not implemented', 'Delete functionality requires API support.');
          },
        },
      ],
    );
  };

  // ─── Render card ──────────────────────────────────────────────────────────

  const renderCard = ({ item }: { item: SOARecordUI }) => {
    const deliveryStatus = item.deliveryStatus;
    const statusColors = getStatusColors(deliveryStatus || 'Generated');

    return (
      <View style={styles.card}>
        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.cardHeaderLabel}>Account No.</Text>
            <Text style={styles.cardAccountNo}>{item.accountNo}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColors.bg }]}>
            <Text style={[styles.statusBadgeText, { color: statusColors.text }]}>
              {deliveryStatus || 'Generated'}
            </Text>
          </View>
        </View>

        {/* Card Body */}
        <View style={styles.cardBody}>
          {/* Customer */}
          <View style={styles.cardRow}>
            <User size={14} color="#9ca3af" style={styles.cardRowIcon} />
            <View style={styles.cardRowContent}>
              <Text style={styles.cardRowLabel}>Customer</Text>
              <Text style={styles.cardRowValue} numberOfLines={1}>{item.fullName}</Text>
            </View>
          </View>

          {/* Email */}
          <View style={styles.cardRow}>
            <Mail size={14} color="#9ca3af" style={styles.cardRowIcon} />
            <View style={styles.cardRowContent}>
              <Text style={styles.cardRowLabel}>Email</Text>
              <Text style={styles.cardRowValue} numberOfLines={1}>{item.emailAddress}</Text>
            </View>
          </View>

          {/* Phone */}
          <View style={styles.cardRow}>
            <Phone size={14} color="#9ca3af" style={styles.cardRowIcon} />
            <View style={styles.cardRowContent}>
              <Text style={styles.cardRowLabel}>Phone</Text>
              <Text style={styles.cardRowValue} numberOfLines={1}>{item.contactNumber}</Text>
            </View>
          </View>

          {/* Address */}
          <View style={styles.cardRow}>
            <MapPin size={14} color="#9ca3af" style={styles.cardRowIcon} />
            <View style={styles.cardRowContent}>
              <Text style={styles.cardRowLabel}>Address</Text>
              <Text style={styles.cardRowValue} numberOfLines={1}>{item.address}</Text>
            </View>
          </View>

          {/* Billing Period */}
          <View style={styles.cardRow}>
            <Calendar size={14} color="#9ca3af" style={styles.cardRowIcon} />
            <View style={styles.cardRowContent}>
              <Text style={styles.cardRowLabel}>Statement Date</Text>
              <Text style={styles.cardRowValue}>{item.statementDate}</Text>
            </View>
          </View>

          {/* Amount Due */}
          <View style={styles.cardRow}>
            <DollarSign size={14} color="#9ca3af" style={styles.cardRowIcon} />
            <View style={styles.cardRowContent}>
              <Text style={styles.cardRowLabel}>Total Amount Due</Text>
              <Text style={[styles.cardRowValue, styles.amountText]}>
                ₱{item.totalAmountDue.toFixed(2)}
              </Text>
            </View>
          </View>

          {/* Generated date */}
          {item.createdAt ? (
            <Text style={styles.cardMeta}>Generated: {item.createdAt}</Text>
          ) : null}
        </View>

        {/* Card Footer */}
        <View style={styles.cardFooter}>
          <TouchableOpacity
            onPress={() => handleViewSOA(item)}
            style={styles.actionBtn}
            activeOpacity={0.7}
          >
            <Eye size={18} color="#2563eb" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDeleteSOA(item)}
            style={styles.actionBtn}
            activeOpacity={0.7}
          >
            <Trash2 size={18} color="#dc2626" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ─── Empty state ──────────────────────────────────────────────────────────

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.emptySubtitle}>Loading SOA records...</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptySubtitle, { color: '#dc2626' }]}>{error}</Text>
          <TouchableOpacity
            onPress={handleRefresh}
            style={[styles.generateBtn, { backgroundColor: primaryColor }]}
          >
            <Text style={styles.generateBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <FileText size={72} color="#d1d5db" />
        <Text style={styles.emptyTitle}>No SOA Records</Text>
        <Text style={styles.emptySubtitle}>
          Get started by generating your first Statement of Account
        </Text>
        <TouchableOpacity
          onPress={handleGenerateSOA}
          style={[styles.generateBtn, { backgroundColor: primaryColor }]}
          activeOpacity={0.8}
        >
          <Plus size={18} color="#ffffff" />
          <Text style={styles.generateBtnText}>Generate SOA</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: isTablet ? 16 : 60 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>SOA Generation</Text>
            {soaRecords.length > 0 && (
              <Text style={styles.headerSubtitle}>
                {soaRecords.length} record{soaRecords.length !== 1 ? 's' : ''}
              </Text>
            )}
          </View>
          {soaRecords.length > 0 && (
            <TouchableOpacity
              onPress={handleGenerateSOA}
              style={[styles.headerBtn, { backgroundColor: primaryColor }]}
              activeOpacity={0.8}
            >
              <Plus size={16} color="#ffffff" />
              <Text style={styles.headerBtnText}>Generate SOA</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* List */}
      <FlatList
        data={soaRecords}
        keyExtractor={(item) => item.id}
        renderItem={renderCard}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[primaryColor]}
            tintColor={primaryColor}
          />
        }
        contentContainerStyle={
          soaRecords.length === 0
            ? styles.flatListEmpty
            : styles.flatListContent
        }
      />
    </View>
  );
};

// ─── Wrapper with provider ────────────────────────────────────────────────────

const SOAGeneration: React.FC = () => (
  <SOAProvider>
    <SOAGenerationInner />
  </SOAProvider>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  headerBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  flatListContent: {
    padding: 12,
    gap: 10,
  },
  flatListEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  // Card
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  cardHeaderLeft: {
    flex: 1,
  },
  cardHeaderLabel: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
  },
  cardAccountNo: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
    alignSelf: 'flex-start',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardBody: {
    padding: 14,
    gap: 10,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardRowIcon: {
    marginTop: 2,
  },
  cardRowContent: {
    flex: 1,
  },
  cardRowLabel: {
    fontSize: 11,
    color: '#6b7280',
  },
  cardRowValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#111827',
    marginTop: 1,
  },
  amountText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#7c3aed',
  },
  cardMeta: {
    fontSize: 11,
    color: '#9ca3af',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    marginTop: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    gap: 8,
  },
  actionBtn: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#f3f4f6',
  },
  // Empty state
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#374151',
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  generateBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
});

export default SOAGeneration;
