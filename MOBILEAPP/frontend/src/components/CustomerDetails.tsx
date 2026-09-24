import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Linking,
  Modal,
  Alert,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  Edit,
  ChevronLeft,
  ChevronRight as ChevronRightNav,
  X,
  ExternalLink,
  Download,
  Paperclip,
  Loader2,
  MapPin,
} from 'lucide-react-native';
import { BillingDetailRecord } from '../types/billing';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { customerDetailUpdateService } from '../services/customerDetailUpdateService';
import { userService } from '../services/userService';
import { relatedDataService } from '../services/relatedDataService';
import { transformServiceOrder } from '../store/serviceOrderStore';
import ServiceOrderDetails from './ServiceOrderDetails';
import LcpNapLocationDetails from './LcpNapLocationDetails';
import { getOnlineStatusInfo, OnlineStatusInfo } from '../utils/onlineStatus';
import { usePermissions } from '../hooks/usePermissions';

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch {
    return dateString;
  }
};

const formatDateTime = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${mm}/${dd}/${yyyy} ${hours}:${minutes} ${ampm}`;
  } catch {
    return dateString;
  }
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface OnlineStatusRecord {
  id: string;
  status: string;
  accountNo: string;
  username: string;
  group: string;
  splynxId: string;
}

interface BillingDetailsProps {
  billingRecord: BillingDetailRecord;
  onlineStatusRecords?: OnlineStatusRecord[];
  onClose?: () => void;
  onRefresh?: () => Promise<void> | void;
  refreshKey?: number;
  onPrevious?: () => void;
  onNext?: () => void;
  onExpandSection?: (
    sectionKey: string,
    title: string,
    data: any[],
    columns: any[],
    count: number
  ) => void;
}

// ─── Status helpers ──────────────────────────────────────────────────────────

/**
 * Delegated to the shared resolver so this panel cannot drift from the customer list
 * again. The copy that lived here was missing three of its rules:
 *
 *  - no 'inactive' rule, so an account switched off in billing could read ONLINE off
 *    a stale RADIUS session;
 *  - no 'empty' guard, so "no session record" surfaced as a status called EMPTY
 *    instead of OFFLINE;
 *  - `record.status || 'disconnected'`, so an account whose billing status had not
 *    loaded yet rendered DISCONNECTED rather than falling through to the session.
 *
 * The returned shape is unchanged — { label, color, dotColor } — so every caller here
 * keeps working.
 */
type StatusInfo = OnlineStatusInfo;

const getStatusInfo = (record: any): StatusInfo => getOnlineStatusInfo(record);

// ─── Inline simple card for non-RN detail views ──────────────────────────────

interface SimpleDetailCardProps {
  title: string;
  data: any;
  fields: { label: string; key: string; format?: (v: any, row: any) => string }[];
  onClose: () => void;
  primaryColor: string;
}

const SimpleDetailCard: React.FC<SimpleDetailCardProps> = ({
  title,
  data,
  fields,
  onClose,
  primaryColor,
}) => {
  const isDarkMode = false;
  return (
    <View style={styles.detailCardOuter}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: '#f3f4f6', borderBottomColor: '#e5e7eb' }]}>
        <Text style={[styles.headerTitle, { color: '#111827' }]} numberOfLines={1}>
          {title}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
          <X size={20} color="#6b7280" />
        </TouchableOpacity>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {fields.map((f) => {
          const raw = data?.[f.key];
          const val = f.format ? f.format(raw, data) : (raw != null ? String(raw) : '-');
          if (!val || val === '-' || val === 'null' || val === 'undefined') return null;
          return (
            <View key={f.key} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{f.label}</Text>
              <Text style={styles.fieldValue} numberOfLines={3}>{val}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

// ─── Inline SO Confirm Modal ─────────────────────────────────────────────────

interface SOConfirmModalProps {
  visible: boolean;
  accountId: string;
  primaryColor: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const SOConfirmModal: React.FC<SOConfirmModalProps> = ({
  visible,
  accountId,
  primaryColor,
  onConfirm,
  onCancel,
}) => (
  <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
    <View style={styles.modalOverlay}>
      <View style={styles.modalBox}>
        <Text style={styles.modalTitle}>Create Service Order Request</Text>
        <Text style={styles.modalBody}>
          Do you want to create a service order request for account{' '}
          <Text style={{ fontWeight: '700', color: '#111827' }}>{accountId}</Text>?
        </Text>
        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.modalBtnCancel} onPress={onCancel}>
            <Text style={{ color: '#374151', fontWeight: '600' }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modalBtnConfirm, { backgroundColor: primaryColor }]}
            onPress={onConfirm}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Yes, Continue</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

// ─── Inline Transact Confirm Modal ───────────────────────────────────────────

interface TransactConfirmInlineProps {
  visible: boolean;
  customerName: string;
  accountId: string;
  balance: string;
  primaryColor: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const TransactConfirmInline: React.FC<TransactConfirmInlineProps> = ({
  visible,
  customerName,
  accountId,
  balance,
  primaryColor,
  onConfirm,
  onCancel,
}) => (
  <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
    <View style={styles.modalOverlay}>
      <View style={styles.modalBox}>
        <Text style={styles.modalTitle}>Confirm Transaction</Text>
        <Text style={styles.modalBody}>
          Process a transaction for{' '}
          <Text style={{ fontWeight: '700', color: '#111827' }}>{customerName}</Text>
          {'\n'}Account: <Text style={{ fontWeight: '600' }}>{accountId}</Text>
          {'\n'}Balance: <Text style={{ fontWeight: '600' }}>{balance}</Text>
        </Text>
        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.modalBtnCancel} onPress={onCancel}>
            <Text style={{ color: '#374151', fontWeight: '600' }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modalBtnConfirm, { backgroundColor: primaryColor }]}
            onPress={onConfirm}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Proceed</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

// ─── Related section card row ─────────────────────────────────────────────────

interface RelatedSectionProps {
  title: string;
  count: number;
  items: any[];
  renderRow: (item: any, index: number) => React.ReactElement;
  primaryColor: string;
  onExpand?: () => void;
}

const RelatedSection: React.FC<RelatedSectionProps> = ({
  title,
  count,
  items,
  renderRow,
  primaryColor,
  onExpand,
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.sectionContainer}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.sectionHeaderLeft}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{count}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {count > 0 && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                setExpanded(true);
              }}
            >
              <Text style={[styles.expandLink, { color: primaryColor }]}>Expand</Text>
            </TouchableOpacity>
          )}
          {expanded ? (
            <ChevronDown size={18} color="#6b7280" />
          ) : (
            <ChevronRightNav size={18} color="#6b7280" />
          )}
        </View>
      </TouchableOpacity>

      {expanded && count > 0 && (
        <View style={styles.sectionContent}>
          {items.slice(0, 5).map((item, idx) => renderRow(item, idx))}
          {count > 5 && (
            <Text style={[styles.moreText, { color: primaryColor }]}>
              +{count - 5} more items
            </Text>
          )}
        </View>
      )}
      {expanded && count === 0 && (
        <View style={styles.sectionContent}>
          <Text style={styles.emptyText}>No items</Text>
        </View>
      )}
    </View>
  );
};

// ─── Generic card row renderer ────────────────────────────────────────────────

const genericCardRow = (
  item: any,
  index: number,
  labelKey: string,
  subKeys: { label: string; key: string; format?: (v: any, r: any) => string }[]
) => (
  <View key={index} style={styles.cardRow}>
    {subKeys.map((sk) => {
      const raw = item[sk.key];
      const val = sk.format ? sk.format(raw, item) : (raw != null ? String(raw) : '-');
      return (
        <View key={sk.key} style={styles.cardRowField}>
          <Text style={styles.cardRowLabel}>{sk.label}</Text>
          <Text style={styles.cardRowValue} numberOfLines={2}>{val || '-'}</Text>
        </View>
      );
    })}
  </View>
);

// ─── Field row component ──────────────────────────────────────────────────────

interface FieldRowProps {
  label: string;
  value: string | React.ReactNode;
  onPress?: () => void;
  isLink?: boolean;
  primaryColor?: string;
}

const FieldRow: React.FC<FieldRowProps> = ({ label, value, onPress, isLink, primaryColor }) => (
  <View style={styles.fieldRow}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {isLink && onPress ? (
      <TouchableOpacity onPress={onPress} style={styles.linkRow}>
        <Text
          style={[styles.fieldValue, styles.linkText, { color: primaryColor || '#3b82f6' }]}
          numberOfLines={1}
        >
          View Document
        </Text>
        <ExternalLink size={14} color={primaryColor || '#3b82f6'} />
      </TouchableOpacity>
    ) : (
      <Text style={styles.fieldValue} numberOfLines={3}>
        {value as string}
      </Text>
    )}
  </View>
);

// ─── Section header ───────────────────────────────────────────────────────────

interface InfoSectionProps {
  title: string;
  children: React.ReactNode;
}

const InfoSection: React.FC<InfoSectionProps> = ({ title, children }) => (
  <View style={styles.infoSection}>
    <Text style={styles.infoSectionTitle}>{title}</Text>
    {children}
  </View>
);

// ─── Main component ───────────────────────────────────────────────────────────

const BillingDetails: React.FC<BillingDetailsProps> = ({
  billingRecord,
  onlineStatusRecords = [],
  onClose,
  onRefresh,
  refreshKey,
  onPrevious,
  onNext,
  onExpandSection,
}) => {
  const isDarkMode = false; // Forced light mode

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const primaryColor = colorPalette?.primary || '#7c3aed';

  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [userEmailCache, setUserEmailCache] = useState<Record<string, string>>({});

  // Modal states
  const [showTransactConfirm, setShowTransactConfirm] = useState(false);
  const [showSOConfirm, setShowSOConfirm] = useState(false);

  // LCP NAP and sub-detail views
  const [selectedLcpNapLocation, setSelectedLcpNapLocation] = useState<any>(null);
  const [loadingLcpNap, setLoadingLcpNap] = useState(false);
  const [selectedServiceOrder, setSelectedServiceOrder] = useState<any>(null);
  const [loadingServiceOrder, setLoadingServiceOrder] = useState(false);

  // Inline detail cards (for still-web detail components)
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [selectedSOARecord, setSelectedSOARecord] = useState<any>(null);
  const [loadingSOA, setLoadingSOA] = useState(false);
  const [selectedPaymentPortal, setSelectedPaymentPortal] = useState<any>(null);
  const [loadingPaymentPortal, setLoadingPaymentPortal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [loadingTransaction, setLoadingTransaction] = useState(false);

  // Related data
  const [relatedData, setRelatedData] = useState<Record<string, any[]>>({});
  const [fullRelatedData, setFullRelatedData] = useState<Record<string, any[]>>({});
  const [relatedDataCounts, setRelatedDataCounts] = useState<Record<string, number>>({});

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const authDataStr = await AsyncStorage.getItem('authData');
        if (authDataStr) {
          const userData = JSON.parse(authDataStr);
          setUserRole(userData.role || '');
          setRoleId(userData.role_id || null);
        }
      } catch (err) {
        console.error('Error loading authData:', err);
      }
    };
    loadAuth();
  }, []);

  // Resolved centrally (hooks/usePermissions): a seeded role answers from the
  // permission table, a custom role from the keys the server resolved for it.
  const { can: hasPermission } = usePermissions();

  // ── Color palette ─────────────────────────────────────────────────────────

  useEffect(() => {
    settingsColorPaletteService.getActive().then((p) => {
      if (p) setColorPalette(p);
    }).catch(() => {});
  }, []);

  // ── Related data ──────────────────────────────────────────────────────────

  const fetchRelatedData = useCallback(async () => {
    const accountNo =
      billingRecord.accountNo ||
      (billingRecord as any).account_no ||
      billingRecord.applicationId;
    if (!accountNo) return;

    const fetchPromises = [
      { key: 'invoices', fn: relatedDataService.getRelatedInvoices },
      { key: 'statementOfAccounts', fn: relatedDataService.getRelatedStatementOfAccounts },
      { key: 'paymentPortalLogs', fn: relatedDataService.getRelatedPaymentPortalLogs },
      { key: 'transactions', fn: relatedDataService.getRelatedTransactions },
      { key: 'staggered', fn: relatedDataService.getRelatedStaggered },
      { key: 'discounts', fn: relatedDataService.getRelatedDiscounts },
      { key: 'serviceOrders', fn: relatedDataService.getRelatedServiceOrders },
      { key: 'reconnectionLogs', fn: relatedDataService.getRelatedReconnectionLogs },
      { key: 'disconnectedLogs', fn: relatedDataService.getRelatedDisconnectedLogs },
      { key: 'detailsUpdateLogs', fn: relatedDataService.getRelatedDetailsUpdateLogs },
      { key: 'planChangeLogs', fn: relatedDataService.getRelatedPlanChangeLogs },
      { key: 'serviceChargeLogs', fn: relatedDataService.getRelatedServiceChargeLogs },
      { key: 'changeDueLogs', fn: relatedDataService.getRelatedChangeDueLogs },
      { key: 'securityDeposits', fn: relatedDataService.getRelatedSecurityDeposits },
    ];

    const results = await Promise.all(
      fetchPromises.map(async ({ key, fn }) => {
        try {
          const result = await fn(accountNo);
          return { key, data: result.data || [], count: result.count || 0 };
        } catch {
          return { key, data: [], count: 0 };
        }
      })
    );

    const newRelated: Record<string, any[]> = {};
    const newFull: Record<string, any[]> = {};
    const newCounts: Record<string, number> = {};
    results.forEach(({ key, data, count }) => {
      newFull[key] = data;
      newRelated[key] = data.slice(0, 5);
      newCounts[key] = count;
    });
    setRelatedData(newRelated);
    setFullRelatedData(newFull);
    setRelatedDataCounts(newCounts);
  }, [billingRecord.applicationId, billingRecord.accountNo]);

  useEffect(() => {
    fetchRelatedData();
  }, [billingRecord.applicationId, billingRecord.accountNo, refreshKey]);

  // ── Resolve user IDs ──────────────────────────────────────────────────────

  useEffect(() => {
    const rec = billingRecord as any;
    const ids = [
      rec.billingAccountCreatedBy,
      rec.billingAccountUpdatedBy,
      rec.customerUpdatedBy,
      rec.techUpdatedBy,
    ].filter((v: any): v is string => !!v && !isNaN(Number(v)));

    Array.from(new Set(ids)).forEach(async (id) => {
      if (userEmailCache[id]) return;
      try {
        const res = await userService.getUserById(Number(id));
        if (res.success && (res as any).data?.email_address) {
          setUserEmailCache((prev) => ({ ...prev, [id]: (res as any).data.email_address }));
        }
      } catch {}
    });
  }, [billingRecord.applicationId]);

  // ── Detail row click handlers ─────────────────────────────────────────────

  const handleInvoiceRowClick = async (row: any) => {
    const id = row?.id || row?.invoice_id;
    if (!id) return;
    try {
      setLoadingInvoice(true);
      const res = await relatedDataService.getInvoiceById(id);
      if (res.success && res.data) setSelectedInvoice(res.data);
    } catch {}
    finally { setLoadingInvoice(false); }
  };

  const handleSOARowClick = async (row: any) => {
    if (!row?.id) return;
    try {
      setLoadingSOA(true);
      const res = await relatedDataService.getStatementOfAccountById(row.id);
      if (res.success && res.data) setSelectedSOARecord(res.data);
    } catch {}
    finally { setLoadingSOA(false); }
  };

  const handlePaymentPortalRowClick = async (row: any) => {
    const id = row?.id || row?.log_id;
    if (!id) return;
    try {
      setLoadingPaymentPortal(true);
      const res = await relatedDataService.getPaymentPortalLogById(id);
      if (res.success && res.data) setSelectedPaymentPortal(res.data);
    } catch {}
    finally { setLoadingPaymentPortal(false); }
  };

  const handleTransactionRowClick = async (row: any) => {
    const id = row?.id || row?.transaction_id;
    if (!id) return;
    try {
      setLoadingTransaction(true);
      const res = await relatedDataService.getTransactionById(id);
      if (res.success && res.data) setSelectedTransaction(res.data);
    } catch {}
    finally { setLoadingTransaction(false); }
  };

  const handleServiceOrderRowClick = async (row: any) => {
    const id = row?.id || row?.ticket_id;
    if (!id) return;
    try {
      setLoadingServiceOrder(true);
      const res = await relatedDataService.getServiceOrderById(id);
      if (res.success && res.data) {
        setSelectedServiceOrder(transformServiceOrder(res.data));
      }
    } catch {}
    finally { setLoadingServiceOrder(false); }
  };

  const handleLcpNapPress = async () => {
    const rec = billingRecord as any;
    if (!rec.lcpnap) return;

    // Open in Google Maps via coords if available, else just show the name
    if (rec.addressCoordinates) {
      const coords = rec.addressCoordinates.split(',').map((c: string) => parseFloat(c.trim()));
      if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
        Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${coords[0]},${coords[1]}`
        );
        return;
      }
    }
    Alert.alert('LCP NAP', `LCP NAP: ${rec.lcpnap}\n\nNo coordinates available to open map.`);
  };

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleTransactConfirm = async () => {
    setShowTransactConfirm(false);
    // Transact flow: modals are still web — show a placeholder alert
    Alert.alert(
      'Transaction',
      'The transaction form is not yet available on mobile. Please use the web app.',
    );
  };

  const handleSOConfirm = async () => {
    setShowSOConfirm(false);
    Alert.alert(
      'Service Order',
      'The SO request form is not yet available on mobile. Please use the web app.',
    );
  };

  const handleEditPress = () => {
    Alert.alert(
      'Edit Details',
      'The edit form is not yet available on mobile. Please use the web app.',
    );
  };

  // ── Derived values ────────────────────────────────────────────────────────

  const rec = billingRecord as any;
  const isLoading =
    loadingInvoice || loadingSOA || loadingPaymentPortal || loadingTransaction || loadingServiceOrder || loadingLcpNap;

  const statusInfo = getStatusInfo(billingRecord);
  const resolveUser = (raw: string | undefined) =>
    raw && !isNaN(Number(raw)) ? (userEmailCache[raw] || raw) : (raw || '-');

  // ── Sub-views ─────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={styles.loadingText}>Fetching details...</Text>
      </View>
    );
  }

  if (selectedServiceOrder) {
    return (
      <ServiceOrderDetails
        serviceOrder={selectedServiceOrder}
        onClose={() => setSelectedServiceOrder(null)}
      />
    );
  }

  if (selectedLcpNapLocation) {
    return (
      <LcpNapLocationDetails
        location={selectedLcpNapLocation}
        onClose={() => setSelectedLcpNapLocation(null)}
      />
    );
  }

  // Inline detail cards for still-web detail components
  if (selectedInvoice) {
    return (
      <SimpleDetailCard
        title="Invoice Details"
        data={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        primaryColor={primaryColor}
        fields={[
          { label: 'Invoice ID', key: 'id' },
          { label: 'Amount', key: 'amount', format: (v) => `₱${Number(v || 0).toFixed(2)}` },
          { label: 'Total Amount', key: 'total_amount', format: (v) => v ? `₱${Number(v).toFixed(2)}` : '-' },
          { label: 'Status', key: 'status' },
          { label: 'Account No', key: 'account_no' },
          { label: 'Due Date', key: 'due_date', format: (v) => formatDate(v) },
          { label: 'Date', key: 'created_at', format: (v) => formatDateTime(v) },
          { label: 'Remarks', key: 'remarks' },
        ]}
      />
    );
  }

  if (selectedSOARecord) {
    return (
      <SimpleDetailCard
        title="Statement of Account"
        data={selectedSOARecord}
        onClose={() => setSelectedSOARecord(null)}
        primaryColor={primaryColor}
        fields={[
          { label: 'SOA ID', key: 'id' },
          { label: 'Account No', key: 'account_no' },
          { label: 'Balance', key: 'balance', format: (v) => `₱${Number(v || 0).toFixed(2)}` },
          { label: 'Total Paid', key: 'total_paid', format: (v) => v ? `₱${Number(v).toFixed(2)}` : '-' },
          { label: 'Status', key: 'status' },
          { label: 'Period', key: 'period' },
          { label: 'Date', key: 'created_at', format: (v) => formatDateTime(v) },
        ]}
      />
    );
  }

  if (selectedPaymentPortal) {
    return (
      <SimpleDetailCard
        title="Payment Portal Log"
        data={selectedPaymentPortal}
        onClose={() => setSelectedPaymentPortal(null)}
        primaryColor={primaryColor}
        fields={[
          { label: 'Log ID', key: 'id' },
          { label: 'Transaction ID', key: 'transaction_id' },
          { label: 'Amount', key: 'amount', format: (v) => `₱${Number(v || 0).toFixed(2)}` },
          { label: 'Status', key: 'status' },
          { label: 'Payment Method', key: 'payment_method' },
          { label: 'Date', key: 'created_at', format: (v) => formatDateTime(v) },
        ]}
      />
    );
  }

  if (selectedTransaction) {
    return (
      <SimpleDetailCard
        title="Transaction Details"
        data={selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        primaryColor={primaryColor}
        fields={[
          { label: 'Transaction ID', key: 'id' },
          { label: 'Amount', key: 'amount', format: (v) => `₱${Number(v || 0).toFixed(2)}` },
          { label: 'Type', key: 'type' },
          { label: 'Payment Method', key: 'payment_method' },
          { label: 'Status', key: 'status' },
          { label: 'Remarks', key: 'remarks' },
          { label: 'Date', key: 'created_at', format: (v) => formatDateTime(v) },
        ]}
      />
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {billingRecord.applicationId} | {billingRecord.customerName}
        </Text>
        <View style={styles.headerActions}>
          {(onPrevious || onNext) && (
            <>
              <TouchableOpacity
                onPress={onPrevious}
                disabled={!onPrevious}
                style={[styles.iconBtn, !onPrevious && { opacity: 0.4 }]}
              >
                <ChevronLeft size={20} color="#6b7280" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onNext}
                disabled={!onNext}
                style={[styles.iconBtn, !onNext && { opacity: 0.4 }]}
              >
                <ChevronRightNav size={20} color="#6b7280" />
              </TouchableOpacity>
            </>
          )}
          {hasPermission('customer.so-request') && (
            <TouchableOpacity style={styles.iconBtn} onPress={() => setShowSOConfirm(true)}>
              <Wrench size={18} color="#6b7280" />
            </TouchableOpacity>
          )}
          {hasPermission('customer.details-edit') && (
            <TouchableOpacity style={styles.iconBtn} onPress={handleEditPress}>
              <Edit size={18} color="#6b7280" />
            </TouchableOpacity>
          )}
          {hasPermission('customer.transact') && (
            <TouchableOpacity
              style={[styles.transactBtn, { backgroundColor: primaryColor }]}
              onPress={() => setShowTransactConfirm(true)}
            >
              <Text style={styles.transactBtnText}>Transact</Text>
            </TouchableOpacity>
          )}
          {onClose && (
            <TouchableOpacity style={styles.iconBtn} onPress={onClose}>
              <X size={18} color="#6b7280" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Scrollable content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>

        {/* ── Customer Details ── */}
        <InfoSection title="Customer Details">
          {billingRecord.customerName ? (
            <FieldRow label="Full Name" value={billingRecord.customerName} />
          ) : null}
          {(billingRecord.emailAddress || billingRecord.email) ? (
            <FieldRow label="Email Address" value={billingRecord.emailAddress || billingRecord.email || ''} />
          ) : null}
          {billingRecord.contactNumber ? (
            <FieldRow label="Contact Number" value={billingRecord.contactNumber} />
          ) : null}
          {billingRecord.secondContactNumber ? (
            <FieldRow label="Second Contact Number" value={billingRecord.secondContactNumber} />
          ) : null}
          {billingRecord.address ? (
            <FieldRow label="Address" value={billingRecord.address.split(',')[0]} />
          ) : null}
          {billingRecord.barangay ? (
            <FieldRow label="Barangay" value={billingRecord.barangay} />
          ) : null}
          {billingRecord.city ? (
            <FieldRow label="City" value={billingRecord.city} />
          ) : null}
          {billingRecord.region ? (
            <FieldRow label="Region" value={billingRecord.region} />
          ) : null}
          {billingRecord.referredBy ? (
            <FieldRow label="Referred By" value={billingRecord.referredBy} />
          ) : null}
          {rec.desiredPlan ? (
            <FieldRow label="Desired Plan" value={rec.desiredPlan} />
          ) : null}
          {/* Address coordinates → open in Google Maps */}
          {billingRecord.addressCoordinates ? (
            <FieldRow
              label="Address Coordinates"
              value={billingRecord.addressCoordinates}
              isLink
              primaryColor={primaryColor}
              onPress={() => {
                const coords = billingRecord.addressCoordinates!.split(',').map((c: string) => parseFloat(c.trim()));
                if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
                  Linking.openURL(
                    `https://www.google.com/maps/search/?api=1&query=${coords[0]},${coords[1]}`
                  );
                } else {
                  Alert.alert('Coordinates', billingRecord.addressCoordinates!);
                }
              }}
            />
          ) : null}
          {rec.houseFrontPicture ? (
            <FieldRow
              label="House Front Picture"
              value={rec.houseFrontPicture}
              isLink
              primaryColor={primaryColor}
              onPress={() => Linking.openURL(rec.houseFrontPicture)}
            />
          ) : null}
          {rec.accountNoCustomer ? (
            <FieldRow label="Customer Account No" value={rec.accountNoCustomer} />
          ) : null}
          {rec.proofOfBillingUrl ? (
            <FieldRow
              label="Proof of Billing"
              value={rec.proofOfBillingUrl}
              isLink
              primaryColor={primaryColor}
              onPress={() => Linking.openURL(rec.proofOfBillingUrl)}
            />
          ) : null}
          {rec.governmentValidIdUrl ? (
            <FieldRow
              label="Government ID"
              value={rec.governmentValidIdUrl}
              isLink
              primaryColor={primaryColor}
              onPress={() => Linking.openURL(rec.governmentValidIdUrl)}
            />
          ) : null}
          {rec.secondGovernmentValidIdUrl ? (
            <FieldRow
              label="Second Government ID"
              value={rec.secondGovernmentValidIdUrl}
              isLink
              primaryColor={primaryColor}
              onPress={() => Linking.openURL(rec.secondGovernmentValidIdUrl)}
            />
          ) : null}
          {rec.documentAttachmentUrl ? (
            <FieldRow
              label="Document Attachment"
              value={rec.documentAttachmentUrl}
              isLink
              primaryColor={primaryColor}
              onPress={() => Linking.openURL(rec.documentAttachmentUrl)}
            />
          ) : null}
          {rec.otherIspBillUrl ? (
            <FieldRow
              label="Other ISP Bill"
              value={rec.otherIspBillUrl}
              isLink
              primaryColor={primaryColor}
              onPress={() => Linking.openURL(rec.otherIspBillUrl)}
            />
          ) : null}
          {rec.customerUpdatedBy ? (
            <FieldRow label="Updated By" value={resolveUser(rec.customerUpdatedBy)} />
          ) : null}
          {rec.customerUpdatedAt ? (
            <FieldRow label="Updated At" value={formatDateTime(rec.customerUpdatedAt)} />
          ) : null}
        </InfoSection>

        {/* ── Technical Details ── */}
        <InfoSection title="Technical Details">
          {billingRecord.usageType ? (
            <FieldRow label="Usage Type" value={billingRecord.usageType} />
          ) : null}
          {billingRecord.dateInstalled ? (
            <FieldRow label="Date Installed" value={formatDate(billingRecord.dateInstalled)} />
          ) : null}
          {billingRecord.username ? (
            <FieldRow label="PPPOE Username" value={billingRecord.username} />
          ) : null}
          {billingRecord.connectionType ? (
            <FieldRow label="Connection Type" value={billingRecord.connectionType} />
          ) : null}
          {billingRecord.routerModel ? (
            <FieldRow label="Router Model" value={billingRecord.routerModel} />
          ) : null}
          {billingRecord.routerModemSN ? (
            <FieldRow label="Router Serial Number" value={billingRecord.routerModemSN} />
          ) : null}
          {rec.sessionGroup ? (
            <FieldRow label="Group" value={rec.sessionGroup} />
          ) : null}
          {(billingRecord.status || billingRecord.onlineStatus) ? (
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Online Status</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[styles.statusDot, { backgroundColor: statusInfo.dotColor }]} />
                <Text style={[styles.fieldValue, { color: statusInfo.color, fontWeight: '700' }]}>
                  {statusInfo.label}
                </Text>
              </View>
            </View>
          ) : null}
          {billingRecord.mikrotikId ? (
            <FieldRow label="Mikrotik ID" value={billingRecord.mikrotikId} />
          ) : null}
          {billingRecord.lcp ? (
            <FieldRow label="LCP" value={billingRecord.lcp} />
          ) : null}
          {billingRecord.nap ? (
            <FieldRow label="NAP" value={billingRecord.nap} />
          ) : null}
          {billingRecord.lcpnap ? (
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>LCP NAP</Text>
              <TouchableOpacity
                style={styles.linkRow}
                onPress={handleLcpNapPress}
              >
                <Text
                  style={[styles.fieldValue, styles.linkText, { color: primaryColor }]}
                  numberOfLines={1}
                >
                  {billingRecord.lcpnap}
                </Text>
                <MapPin size={14} color={primaryColor} />
              </TouchableOpacity>
            </View>
          ) : null}
          {billingRecord.vlan ? (
            <FieldRow label="VLAN" value={billingRecord.vlan} />
          ) : null}
          {billingRecord.port ? (
            <FieldRow label="PORT" value={billingRecord.port} />
          ) : null}
          {(billingRecord.sessionIp || (billingRecord as any).sessionIP) ? (
            <FieldRow label="Session IP" value={billingRecord.sessionIp || (billingRecord as any).sessionIP} />
          ) : null}
          {rec.techUpdatedBy ? (
            <FieldRow label="Updated By" value={resolveUser(rec.techUpdatedBy)} />
          ) : null}
          {rec.techUpdatedAt ? (
            <FieldRow label="Updated At" value={formatDateTime(rec.techUpdatedAt)} />
          ) : null}
        </InfoSection>

        {/* ── Billing Details ── */}
        <InfoSection title="Billing Details">
          {billingRecord.applicationId ? (
            <FieldRow label="Account Number" value={billingRecord.applicationId} />
          ) : null}
          {(billingRecord.billingStatus || billingRecord.status) ? (
            <FieldRow label="Billing Status" value={billingRecord.billingStatus || billingRecord.status} />
          ) : null}
          {(billingRecord.billingDay !== undefined && billingRecord.billingDay !== null) ? (
            <FieldRow
              label="Billing Day"
              value={billingRecord.billingDay === 0 ? 'Every end of month' : String(billingRecord.billingDay)}
            />
          ) : null}
          {rec.vip_expiration ? (
            <FieldRow label="VIP Expiration" value={formatDate(rec.vip_expiration)} />
          ) : null}
          {rec.vip_remarks ? (
            <FieldRow label="VIP Remarks" value={rec.vip_remarks} />
          ) : null}
          {billingRecord.plan ? (
            <FieldRow label="Plan" value={billingRecord.plan} />
          ) : null}
          {(billingRecord.accountBalance !== undefined || billingRecord.balance !== undefined) ? (
            <FieldRow
              label="Account Balance"
              value={`₱${Number(billingRecord.accountBalance ?? billingRecord.balance ?? 0).toFixed(2)}`}
            />
          ) : null}
          {rec.balanceUpdateDate ? (
            <FieldRow label="Balance Update Date" value={formatDate(rec.balanceUpdateDate)} />
          ) : null}
          {(billingRecord.totalPaid !== undefined) ? (
            <FieldRow label="Total Paid" value={`₱${Number(billingRecord.totalPaid || 0).toFixed(2)}`} />
          ) : null}
          {rec.billingAccountCreatedBy ? (
            <FieldRow label="Created By" value={resolveUser(rec.billingAccountCreatedBy)} />
          ) : null}
          {rec.billingAccountCreatedAt ? (
            <FieldRow label="Created At" value={formatDateTime(rec.billingAccountCreatedAt)} />
          ) : null}
          {rec.billingAccountUpdatedBy ? (
            <FieldRow label="Updated By" value={resolveUser(rec.billingAccountUpdatedBy)} />
          ) : null}
          {rec.billingAccountUpdatedAt ? (
            <FieldRow label="Updated At" value={formatDateTime(rec.billingAccountUpdatedAt)} />
          ) : null}
        </InfoSection>

        {/* Divider */}
        <View style={styles.divider} />

        {/* ── Related Data Sections ── */}

        <RelatedSection
          title="Related Invoices"
          count={relatedDataCounts.invoices || 0}
          items={relatedData.invoices || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'Invoice ID', key: 'id', format: (v, r) => String(r.id || r.invoice_id || '-') },
              { label: 'Amount', key: 'amount', format: (v, r) => `₱${Number(r.amount || r.total_amount || 0).toFixed(2)}` },
              { label: 'Status', key: 'status' },
              { label: 'Date', key: 'created_at', format: (v, r) => formatDate(r.created_at || r.date) },
            ])
          }
        />

        <RelatedSection
          title="Statement of Accounts"
          count={relatedDataCounts.statementOfAccounts || 0}
          items={relatedData.statementOfAccounts || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'SOA ID', key: 'id' },
              { label: 'Balance', key: 'balance', format: (v) => `₱${Number(v || 0).toFixed(2)}` },
              { label: 'Status', key: 'status' },
              { label: 'Date', key: 'created_at', format: (v) => formatDate(v) },
            ])
          }
        />

        <RelatedSection
          title="Payment Portal Logs"
          count={relatedDataCounts.paymentPortalLogs || 0}
          items={relatedData.paymentPortalLogs || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'Transaction ID', key: 'transaction_id', format: (v, r) => String(r.transaction_id || r.id || '-') },
              { label: 'Amount', key: 'amount', format: (v) => `₱${Number(v || 0).toFixed(2)}` },
              { label: 'Status', key: 'status' },
              { label: 'Date', key: 'created_at', format: (v) => formatDate(v) },
            ])
          }
        />

        <RelatedSection
          title="Related Transactions"
          count={relatedDataCounts.transactions || 0}
          items={relatedData.transactions || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'ID', key: 'id' },
              { label: 'Amount', key: 'amount', format: (v) => `₱${Number(v || 0).toFixed(2)}` },
              { label: 'Type', key: 'type' },
              { label: 'Method', key: 'payment_method' },
              { label: 'Date', key: 'created_at', format: (v) => formatDate(v) },
            ])
          }
        />

        <RelatedSection
          title="Related Staggered"
          count={relatedDataCounts.staggered || 0}
          items={relatedData.staggered || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'ID', key: 'id' },
              { label: 'Monthly', key: 'monthly_amount', format: (v) => `₱${Number(v || 0).toFixed(2)}` },
              { label: 'Months', key: 'total_months' },
              { label: 'Remaining', key: 'remaining_balance', format: (v) => `₱${Number(v || 0).toFixed(2)}` },
              { label: 'Status', key: 'status' },
            ])
          }
        />

        <RelatedSection
          title="Related Discounts"
          count={relatedDataCounts.discounts || 0}
          items={relatedData.discounts || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'ID', key: 'id' },
              { label: 'Type', key: 'discount_type' },
              { label: 'Amount', key: 'amount', format: (v, r) => `₱${Number(v || r.discount_amount || 0).toFixed(2)}` },
              { label: 'Start', key: 'start_date', format: (v) => formatDate(v) },
              { label: 'End', key: 'end_date', format: (v) => formatDate(v) },
            ])
          }
        />

        <RelatedSection
          title="Related Service Orders"
          count={relatedDataCounts.serviceOrders || 0}
          items={relatedData.serviceOrders || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'SO ID', key: 'id' },
              { label: 'Type', key: 'type', format: (v, r) => String(r.type || r.service_type || '-') },
              { label: 'Status', key: 'status' },
              { label: 'Assigned To', key: 'assigned_to', format: (v) => v || 'Unassigned' },
            ])
          }
        />

        <RelatedSection
          title="Reconnection Logs"
          count={relatedDataCounts.reconnectionLogs || 0}
          items={relatedData.reconnectionLogs || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'ID', key: 'id' },
              { label: 'Date', key: 'created_at', format: (v) => formatDate(v) },
              { label: 'Remarks', key: 'remarks' },
            ])
          }
        />

        <RelatedSection
          title="Disconnected Logs"
          count={relatedDataCounts.disconnectedLogs || 0}
          items={relatedData.disconnectedLogs || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'ID', key: 'id' },
              { label: 'Date', key: 'created_at', format: (v) => formatDate(v) },
              { label: 'Reason', key: 'reason' },
            ])
          }
        />

        <RelatedSection
          title="Details Update Logs"
          count={relatedDataCounts.detailsUpdateLogs || 0}
          items={relatedData.detailsUpdateLogs || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'ID', key: 'id' },
              { label: 'Field', key: 'field_name' },
              { label: 'Old Value', key: 'old_value' },
              { label: 'New Value', key: 'new_value' },
              { label: 'Date', key: 'created_at', format: (v) => formatDate(v) },
            ])
          }
        />

        <RelatedSection
          title="Plan Change Logs"
          count={relatedDataCounts.planChangeLogs || 0}
          items={relatedData.planChangeLogs || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'ID', key: 'id' },
              { label: 'Old Plan', key: 'old_plan' },
              { label: 'New Plan', key: 'new_plan' },
              { label: 'Date', key: 'created_at', format: (v) => formatDate(v) },
            ])
          }
        />

        <RelatedSection
          title="Service Charge Logs"
          count={relatedDataCounts.serviceChargeLogs || 0}
          items={relatedData.serviceChargeLogs || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'ID', key: 'id' },
              { label: 'Amount', key: 'amount', format: (v) => v ? `₱${Number(v).toFixed(2)}` : '-' },
              { label: 'Type', key: 'type' },
              { label: 'Date', key: 'created_at', format: (v) => formatDate(v) },
            ])
          }
        />

        <RelatedSection
          title="Change Due Logs"
          count={relatedDataCounts.changeDueLogs || 0}
          items={relatedData.changeDueLogs || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'ID', key: 'id' },
              { label: 'Old Due', key: 'old_due' },
              { label: 'New Due', key: 'new_due' },
              { label: 'Date', key: 'created_at', format: (v) => formatDate(v) },
            ])
          }
        />

        <RelatedSection
          title="Security Deposits"
          count={relatedDataCounts.securityDeposits || 0}
          items={relatedData.securityDeposits || []}
          primaryColor={primaryColor}
          renderRow={(item, idx) =>
            genericCardRow(item, idx, 'id', [
              { label: 'ID', key: 'id' },
              { label: 'Amount', key: 'amount', format: (v) => v ? `₱${Number(v).toFixed(2)}` : '-' },
              { label: 'Status', key: 'status' },
              { label: 'Date', key: 'created_at', format: (v) => formatDate(v) },
            ])
          }
        />

        {/* Bottom padding */}
        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Inline modals */}
      <TransactConfirmInline
        visible={showTransactConfirm}
        customerName={billingRecord.customerName}
        accountId={billingRecord.applicationId}
        balance={`₱${Number(billingRecord.accountBalance ?? billingRecord.balance ?? 0).toFixed(2)}`}
        primaryColor={primaryColor}
        onConfirm={handleTransactConfirm}
        onCancel={() => setShowTransactConfirm(false)}
      />

      <SOConfirmModal
        visible={showSOConfirm}
        accountId={billingRecord.applicationId}
        primaryColor={primaryColor}
        onConfirm={handleSOConfirm}
        onCancel={() => setShowSOConfirm(false)}
      />
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  detailCardOuter: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f3f4f6',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 8,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  iconBtn: {
    padding: 8,
    borderRadius: 6,
  },
  transactBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  transactBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  infoSection: {
    backgroundColor: '#ffffff',
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 10,
  },
  infoSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 12,
  },
  fieldLabel: {
    fontSize: 13,
    color: '#6b7280',
    flexShrink: 0,
    maxWidth: '40%',
  },
  fieldValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    justifyContent: 'flex-end',
  },
  linkText: {
    textDecorationLine: 'underline',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginHorizontal: 12,
    marginTop: 16,
    marginBottom: 4,
  },
  sectionContainer: {
    backgroundColor: '#ffffff',
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  countBadge: {
    backgroundColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  countText: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '600',
  },
  expandLink: {
    fontSize: 13,
  },
  sectionContent: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    paddingVertical: 12,
  },
  moreText: {
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 8,
  },
  cardRow: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardRowField: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardRowLabel: {
    fontSize: 12,
    color: '#6b7280',
    flexShrink: 0,
  },
  cardRowValue: {
    fontSize: 12,
    color: '#111827',
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  modalBody: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 22,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalBtnCancel: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
  },
  modalBtnConfirm: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
});

export default BillingDetails;
