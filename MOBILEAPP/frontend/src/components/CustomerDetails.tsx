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
  Coins,
} from 'lucide-react-native';
import { BillingDetailRecord } from '../types/billing';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { customerDetailUpdateService } from '../services/customerDetailUpdateService';
import { userService } from '../services/userService';
import { relatedDataService } from '../services/relatedDataService';
import { transformServiceOrder } from '../store/serviceOrderStore';
import ServiceOrderDetails from './ServiceOrderDetails';
import InvoiceDetails from './InvoiceDetails';
import SOADetails from './SOADetails';
import PaymentPortalDetails from './PaymentPortalDetails';
import TransactionListDetails from './TransactionListDetails';
import LcpNapLocationDetails from './LcpNapLocationDetails';
import { relatedDataColumns, TableColumn } from '../config/relatedDataColumns';
import { FieldCard } from './common';
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
  /** Rendered as Prev/Next quick actions when the host supplies them. */
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

interface StatusInfo {
  label: string;
  color: string;
  dotColor: string;
}

const getStatusInfo = (record: any): StatusInfo => {
  const accessStatus = record.status || 'disconnected';
  const lowerStatus = accessStatus.toLowerCase();
  const lowerOnlineStatus = (record.onlineStatus || '').toLowerCase();

  let bucket = 'offline';
  if (lowerStatus === 'restricted' || lowerOnlineStatus === 'restricted') bucket = 'restricted';
  else if (lowerStatus === 'not found' || lowerOnlineStatus === 'not found') bucket = 'not found';
  else if (lowerStatus === 'disconnected' || lowerOnlineStatus === 'disconnected') bucket = 'disconnected';
  else if (['online', 'active', 'connected'].includes(lowerOnlineStatus)) bucket = 'online';
  else if (lowerOnlineStatus && lowerOnlineStatus !== 'offline') bucket = lowerOnlineStatus;

  const lower = bucket.toLowerCase();
  if (lower === 'online') return { label: 'ONLINE', color: '#22c55e', dotColor: '#22c55e' };
  if (lower === 'offline') return { label: 'OFFLINE', color: '#facc15', dotColor: '#facc15' };
  if (lower === 'not found') return { label: 'NOT FOUND', color: '#dc2626', dotColor: '#dc2626' };
  if (lower === 'disconnected') return { label: 'DISCONNECTED', color: '#9ca3af', dotColor: '#9ca3af' };
  if (lower === 'restricted') return { label: 'RESTRICTED', color: '#be6b33', dotColor: '#f97316' };
  return { label: bucket.toUpperCase(), color: '#3b82f6', dotColor: '#3b82f6' };
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
  /** Column set from `relatedDataColumns` — the web table's columns, drawn as cards. */
  columns?: TableColumn[];
  renderRow?: (item: any, index: number) => React.ReactElement;
  /** Opens the record's detail view, same as the web table's onRowClick. */
  onRowPress?: (row: any) => void;
  primaryColor: string;
  onExpand?: () => void;
}

/**
 * A related record, drawn as a card instead of a table row.
 *
 * The column set still comes from `relatedDataColumns` — the same one the web
 * table uses — so nothing is lost: the first column becomes the card's heading
 * and the rest become labelled fields. What is gone is the sideways scroll,
 * which on a phone put most of the columns past the right edge of the screen.
 */
const RelatedCards: React.FC<{
  columns: TableColumn[];
  rows: any[];
  onRowPress?: (row: any) => void;
}> = ({ columns, rows, onRowPress }) => {
  const cellText = (column: TableColumn, row: any) => {
    const raw = row?.[column.key];
    const rendered = column.render ? column.render(raw, row) : raw;
    return rendered === null || rendered === undefined || rendered === '' ? '-' : String(rendered);
  };

  const [head, ...rest] = columns;

  return (
    <View>
      {rows.map((row, rowIndex) => (
        <FieldCard
          key={rowIndex}
          title={head ? cellText(head, row) : undefined}
          fields={rest.map((column) => ({ label: column.label, value: cellText(column, row) }))}
          onPress={onRowPress ? () => onRowPress(row) : undefined}
        />
      ))}
    </View>
  );
};

const RELATED_PAGE_SIZE = 5;

const RelatedSection: React.FC<RelatedSectionProps> = ({
  title,
  count,
  items,
  columns,
  renderRow,
  onRowPress,
  primaryColor,
  onExpand,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / RELATED_PAGE_SIZE));
  const pageStart = (page - 1) * RELATED_PAGE_SIZE;
  const pageItems = items.slice(pageStart, pageStart + RELATED_PAGE_SIZE);

  // A refresh can shrink the list under the current page.
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

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
        <View style={columns ? styles.sectionTableContent : styles.sectionContent}>
          {columns
            ? <RelatedCards columns={columns} rows={pageItems} onRowPress={onRowPress} />
            : pageItems.map((item, idx) => renderRow?.(item, idx))}

          {/* Pager sits where a 6th row would be */}
          <View style={styles.pagerRow}>
            <TouchableOpacity
              onPress={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={[styles.pagerBtn, page === 1 && styles.pagerBtnDisabled]}
            >
              <ChevronLeft size={16} color={page === 1 ? '#9ca3af' : primaryColor} />
              <Text style={[styles.pagerBtnText, { color: page === 1 ? '#9ca3af' : primaryColor }]}>Prev</Text>
            </TouchableOpacity>

            <Text style={styles.pagerCount}>
              {items.length === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + RELATED_PAGE_SIZE, items.length)} of{' '}
              {items.length || count}
            </Text>

            <TouchableOpacity
              onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={[styles.pagerBtn, page >= totalPages && styles.pagerBtnDisabled]}
            >
              <Text style={[styles.pagerBtnText, { color: page >= totalPages ? '#9ca3af' : primaryColor }]}>Next</Text>
              <ChevronRightNav size={16} color={page >= totalPages ? '#9ca3af' : primaryColor} />
            </TouchableOpacity>
          </View>
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
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
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
          let perms: string[] = [];
          if (userData.permissions) {
            if (Array.isArray(userData.permissions)) {
              perms = userData.permissions;
            } else if (typeof userData.permissions === 'string') {
              try {
                const parsed = JSON.parse(userData.permissions);
                perms = Array.isArray(parsed) ? parsed : [];
              } catch {
                perms = userData.permissions.split(',').map((p: string) => p.trim()).filter(Boolean);
              }
            }
          }
          setUserPermissions(perms);
        }
      } catch (err) {
        console.error('Error loading authData:', err);
      }
    };
    loadAuth();
  }, []);

  // Resolved centrally (hooks/usePermissions) so a seeded role such as
  // Technician is answered from the role table rather than from a stored
  // permissions array it does not have.
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
      { key: 'jobOrders', fn: relatedDataService.getRelatedJobOrdersByAccount },
      { key: 'applications', fn: relatedDataService.getRelatedApplicationsByAccount },
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

  // Same detail components the web opens from a related-table row click.
  if (selectedInvoice) {
    return (
      <InvoiceDetails
        invoiceRecord={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        onViewCustomer={() => setSelectedInvoice(null)}
      />
    );
  }

  if (selectedSOARecord) {
    return (
      <SOADetails
        soaRecord={selectedSOARecord}
        onClose={() => setSelectedSOARecord(null)}
        onViewCustomer={() => setSelectedSOARecord(null)}
      />
    );
  }

  if (selectedPaymentPortal) {
    return (
      <PaymentPortalDetails
        record={selectedPaymentPortal}
        onClose={() => setSelectedPaymentPortal(null)}
        onViewCustomer={() => setSelectedPaymentPortal(null)}
      />
    );
  }

  if (selectedTransaction) {
    return (
      <TransactionListDetails
        transaction={selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        onViewCustomer={() => setSelectedTransaction(null)}
      />
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  // Header icons live here instead, as circle-and-label actions like ApplicationDetails.
  const quickActions = [
    ...(onPrevious ? [{ key: 'prev', label: 'Previous', Icon: ChevronLeft, onPress: onPrevious }] : []),
    ...(onNext ? [{ key: 'next', label: 'Next', Icon: ChevronRightNav, onPress: onNext }] : []),
    ...(hasPermission('customer.transact')
      ? [{ key: 'transact', label: 'Transact', Icon: Coins, onPress: () => setShowTransactConfirm(true) }]
      : []),
    ...(hasPermission('customer.so-request')
      ? [{ key: 'so-request', label: 'SO Request', Icon: Wrench, onPress: () => setShowSOConfirm(true) }]
      : []),
    ...(hasPermission('customer.details-edit')
      ? [{ key: 'edit', label: 'Edit', Icon: Edit, onPress: handleEditPress }]
      : []),
  ];

  return (
    <View style={styles.container}>
      {/* Header — back arrow, centred name, same shape as ApplicationDetails */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {onClose && (
            <TouchableOpacity onPress={onClose} style={styles.backBtn}>
              <ChevronLeft size={28} color="#4b5563" />
            </TouchableOpacity>
          )}
          <View style={styles.headerNameContainer}>
            <Text style={styles.headerName} numberOfLines={1}>
              {billingRecord.customerName || billingRecord.applicationId}
            </Text>
          </View>
        </View>
      </View>

      {/* Quick actions */}
      {quickActions.length > 0 && (
        <View style={styles.actionBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionBarInner}>
            {quickActions.map(({ key, label, Icon, onPress }) => (
              <TouchableOpacity key={key} style={styles.actionBtnWrap} onPress={onPress}>
                <View style={[styles.actionIconCircle, { backgroundColor: primaryColor }]}>
                  <Icon size={18} color="#ffffff" />
                </View>
                <Text style={styles.actionLabel}>{label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

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
          title="Invoices"
          count={relatedDataCounts.invoices || 0}
          items={fullRelatedData.invoices || []}
          onRowPress={handleInvoiceRowClick}
          primaryColor={primaryColor}
          columns={relatedDataColumns.invoices}
        />

        <RelatedSection
          title="Statement of Accounts"
          count={relatedDataCounts.statementOfAccounts || 0}
          items={fullRelatedData.statementOfAccounts || []}
          onRowPress={handleSOARowClick}
          primaryColor={primaryColor}
          columns={relatedDataColumns.statementOfAccounts}
        />

        <RelatedSection
          title="Payment Portal Logs"
          count={relatedDataCounts.paymentPortalLogs || 0}
          items={fullRelatedData.paymentPortalLogs || []}
          onRowPress={handlePaymentPortalRowClick}
          primaryColor={primaryColor}
          columns={relatedDataColumns.paymentPortalLogs}
        />

        <RelatedSection
          title="Transactions"
          count={relatedDataCounts.transactions || 0}
          items={fullRelatedData.transactions || []}
          onRowPress={handleTransactionRowClick}
          primaryColor={primaryColor}
          columns={relatedDataColumns.transactions}
        />

        <RelatedSection
          title="Staggered Payments"
          count={relatedDataCounts.staggered || 0}
          items={fullRelatedData.staggered || []}
          primaryColor={primaryColor}
          columns={relatedDataColumns.staggered}
        />

        <RelatedSection
          title="Discounts"
          count={relatedDataCounts.discounts || 0}
          items={fullRelatedData.discounts || []}
          primaryColor={primaryColor}
          columns={relatedDataColumns.discounts}
        />

        <RelatedSection
          title="Service Orders"
          count={relatedDataCounts.serviceOrders || 0}
          items={fullRelatedData.serviceOrders || []}
          onRowPress={handleServiceOrderRowClick}
          primaryColor={primaryColor}
          columns={relatedDataColumns.serviceOrders}
        />

        <RelatedSection
          title="Reconnection Logs"
          count={relatedDataCounts.reconnectionLogs || 0}
          items={fullRelatedData.reconnectionLogs || []}
          primaryColor={primaryColor}
          columns={relatedDataColumns.reconnectionLogs}
        />

        <RelatedSection
          title="Disconnected Logs"
          count={relatedDataCounts.disconnectedLogs || 0}
          items={fullRelatedData.disconnectedLogs || []}
          primaryColor={primaryColor}
          columns={relatedDataColumns.disconnectedLogs}
        />

        <RelatedSection
          title="Details Update Logs"
          count={relatedDataCounts.detailsUpdateLogs || 0}
          items={fullRelatedData.detailsUpdateLogs || []}
          primaryColor={primaryColor}
          columns={relatedDataColumns.detailsUpdateLogs}
        />

        <RelatedSection
          title="Plan Change Logs"
          count={relatedDataCounts.planChangeLogs || 0}
          items={fullRelatedData.planChangeLogs || []}
          primaryColor={primaryColor}
          columns={relatedDataColumns.planChangeLogs}
        />

        <RelatedSection
          title="Service Charge Logs"
          count={relatedDataCounts.serviceChargeLogs || 0}
          items={fullRelatedData.serviceChargeLogs || []}
          primaryColor={primaryColor}
          columns={relatedDataColumns.serviceChargeLogs}
        />

        <RelatedSection
          title="Change Due Logs"
          count={relatedDataCounts.changeDueLogs || 0}
          items={fullRelatedData.changeDueLogs || []}
          primaryColor={primaryColor}
          columns={relatedDataColumns.changeDueLogs}
        />

        <RelatedSection
          title="Security Deposits"
          count={relatedDataCounts.securityDeposits || 0}
          items={fullRelatedData.securityDeposits || []}
          primaryColor={primaryColor}
          columns={relatedDataColumns.securityDeposits}
        />

        <RelatedSection
          title="Job Orders"
          count={relatedDataCounts.jobOrders || 0}
          items={fullRelatedData.jobOrders || []}
          primaryColor={primaryColor}
          columns={relatedDataColumns.customerJobOrders}
        />

        <RelatedSection
          title="Applications"
          count={relatedDataCounts.applications || 0}
          items={fullRelatedData.applications || []}
          primaryColor={primaryColor}
          columns={relatedDataColumns.applications}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  // Used by the nested detail-card overlays, which keep a plain title + close row.
  headerTitle: { fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, position: 'relative' },
  backBtn: { position: 'absolute', left: 0, zIndex: 10 },
  // Padding keeps a long, centered name from running under the absolutely-placed back arrow.
  headerNameContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  headerName: { fontWeight: '500', textAlign: 'center', fontSize: 20, color: '#111827' },
  actionBar: { paddingVertical: 12, borderBottomWidth: 1, backgroundColor: '#f3f4f6', borderBottomColor: '#e5e7eb' },
  actionBarInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, flexGrow: 1 },
  actionBtnWrap: { flexDirection: 'column', alignItems: 'center', padding: 8, borderRadius: 6, minWidth: 76 },
  actionIconCircle: { padding: 8, borderRadius: 9999 },
  actionLabel: { fontSize: 12, marginTop: 4, color: '#374151' },
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
    paddingBottom: 120,
  },
  // Flat field list, same as ApplicationDetails — no card container per group.
  infoSection: {
    backgroundColor: '#f9fafb',
    paddingTop: 8,
  },
  infoSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9ca3af',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 4,
    paddingHorizontal: 16,
    gap: 2,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
  },
  fieldValue: {
    fontSize: 16,
    color: '#111827',
    width: '100%',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: '100%',
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
  // Card variant: the cards carry their own padding and dividers.
  sectionTableContent: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingBottom: 8,
  },
  pagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f9fafb',
  },
  pagerBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4, paddingHorizontal: 6 },
  pagerBtnDisabled: { opacity: 0.5 },
  pagerBtnText: { fontSize: 13, fontWeight: '600' },
  pagerCount: { fontSize: 12, color: '#6b7280' },
  emptyText: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    paddingVertical: 12,
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
