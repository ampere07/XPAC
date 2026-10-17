import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, StyleSheet, Modal, TextInput,
  ScrollView, Alert, KeyboardAvoidingView, Platform, DeviceEventEmitter,
} from 'react-native';
import { Plus, X, CheckCircle, FileText } from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import {
  createServiceOrder, getServiceOrders, getAgentSupportAccounts, AgentSupportAccount,
} from '../services/serviceOrderService';
import { SearchablePicker, SearchablePickerTrigger } from '../components/SearchablePicker';
import SupportDetails from '../components/SupportDetails';
import { SUPPORT_CONCERN_OPTIONS } from '../config/supportConcerns';

/**
 * Support for an agent: raise a ticket for a customer they referred, and follow every ticket of
 * those customers, whoever raised it.
 *
 * The customer's Support page is their own portal — balance, Pay Now, their one account — so an
 * agent gets this page instead (Dashboard routes 'customer-support' here for role 4). Everything
 * it shows is decided by the server (ServiceOrderApiController / AgentScope): the accounts on
 * offer, the tickets listed, and on submit the account is checked again and the ticket recorded
 * as Pending, raised by the agent.
 */

interface AgentTicket {
  id: string;
  requestId: string;
  date: string;
  timestamp: number;
  accountNo: string;
  customerName: string;
  issue: string;
  issueDetails: string;
  status: string;
  statusNote: string;
  assignedEmail: string;
  visitNote: string;
  visitInfo: { status: string };
}

type PickerKind = 'account' | 'concern' | null;

const PAGE_SIZE = 200;

const formatDate = (raw?: string | null) => {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
};

const toTicket = (o: any): AgentTicket => ({
  id: String(o.id),
  requestId: String(o.ticket_id || o.id || ''),
  date: formatDate(o.timestamp || o.created_at),
  timestamp: new Date(o.timestamp || o.created_at || 0).getTime() || 0,
  accountNo: o.account_no || '',
  customerName: o.full_name || '',
  issue: o.concern || '',
  issueDetails: o.concern_remarks || '',
  status: o.support_status || 'Pending',
  statusNote: o.support_remarks || '',
  assignedEmail: o.assigned_email || '',
  visitNote: o.visit_remarks || '',
  visitInfo: { status: o.visit_status || 'Pending' },
});

/**
 * Why a submit was refused, in the agent's terms. The server names a still-open ticket in
 * `open_service_order`, and words its other refusals (an account the agent did not refer) itself.
 */
const submitErrorMessage = (error: any, accountNo: string): string => {
  const open = error?.response?.data?.open_service_order;
  if (open) {
    return `Account ${accountNo} already has an open request${open.ticket_id ? ` (Ticket ${open.ticket_id})` : ''}. A new one can be submitted once it is resolved.`;
  }
  return error?.response?.data?.message || 'Failed to submit the ticket. Please try again.';
};

const TicketCard = React.memo<{ ticket: AgentTicket; primaryColor: string; onPress: (t: AgentTicket) => void }>(
  ({ ticket, primaryColor, onPress }) => (
    <View style={s.card}>
      <View style={s.cardHeaderRow}>
        <View style={s.cardHeaderLeft}>
          <Text style={s.ticketId}>#{ticket.requestId}</Text>
          {!!ticket.date && (
            <View style={[s.dateBadge, { backgroundColor: primaryColor + '10' }]}>
              <Text style={[s.dateText, { color: primaryColor }]}>{ticket.date}</Text>
            </View>
          )}
        </View>
        <View style={s.statusBadge}>
          <Text style={s.statusText}>{ticket.status}</Text>
        </View>
      </View>

      <Text style={s.accountText} numberOfLines={1}>
        {ticket.accountNo}{ticket.customerName ? ` | ${ticket.customerName}` : ''}
      </Text>

      <View style={s.issueSection}>
        <Text style={s.issueTitle}>{ticket.issue}</Text>
        {!!ticket.issueDetails && <Text style={s.issueDetails} numberOfLines={2}>{ticket.issueDetails}</Text>}
      </View>

      <View style={s.cardFooterRow}>
        <View style={s.visitRow}>
          <CheckCircle size={14} color={ticket.visitInfo.status === 'Done' ? '#10b981' : '#9ca3af'} />
          <Text style={s.visitText}>Visit: {ticket.visitInfo.status}</Text>
        </View>
        <Pressable onPress={() => onPress(ticket)} style={[s.detailsBtn, { borderColor: primaryColor + '40' }]}>
          <Text style={[s.detailsBtnText, { color: primaryColor }]}>Details</Text>
        </Pressable>
      </View>
    </View>
  )
);

const AgentSupport: React.FC = () => {
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());
  const primaryColor = colorPalette?.primary || '#ef4444';

  const [tickets, setTickets] = useState<AgentTicket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<AgentTicket | null>(null);

  const [accounts, setAccounts] = useState<AgentSupportAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError] = useState('');

  const [showNewTicket, setShowNewTicket] = useState(false);
  const [accountNo, setAccountNo] = useState('');
  const [concern, setConcern] = useState(SUPPORT_CONCERN_OPTIONS[0]);
  const [details, setDetails] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [picker, setPicker] = useState<PickerKind>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    settingsColorPaletteService.getActive().then(p => p && setColorPalette(p)).catch(() => {});
    const sub = DeviceEventEmitter.addListener('colorPaletteChanged', (p: ColorPalette) => setColorPalette(p));
    return () => sub.remove();
  }, []);

  /** Every ticket the server scopes to this agent, newest first. */
  const loadTickets = useCallback(async () => {
    try {
      const collected: AgentTicket[] = [];
      for (let page = 1; page <= 50; page++) {
        const result: any = await getServiceOrders(undefined, page, PAGE_SIZE);
        const rows = Array.isArray(result?.data) ? result.data : [];
        collected.push(...rows.map(toTicket));
        if (!result?.pagination?.has_more || rows.length === 0) break;
      }
      collected.sort((a, b) => b.timestamp - a.timestamp || Number(b.id) - Number(a.id));
      setTickets(collected);
      setLoadError('');
    } catch (error: any) {
      setLoadError(error?.response?.data?.message || 'Failed to load support tickets.');
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    setIsLoadingAccounts(true);
    try {
      setAccounts(await getAgentSupportAccounts());
      setAccountsError('');
    } catch (error: any) {
      setAccountsError(error?.response?.data?.message || 'Failed to load your customers\' accounts.');
    } finally {
      setIsLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await Promise.all([loadTickets(), loadAccounts()]);
      setIsLoading(false);
    })();
  }, [loadTickets, loadAccounts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadTickets(), loadAccounts()]);
    setRefreshing(false);
  }, [loadTickets, loadAccounts]);

  const accountLabel = (a: AgentSupportAccount) => `${a.account_no} | ${a.customer_name}`;
  const selectedAccount = accounts.find(a => a.account_no === accountNo) || null;

  const pickerData = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = picker === 'account'
      ? accounts.map(a => ({ value: a.account_no, label: accountLabel(a) }))
      : picker === 'concern'
        ? SUPPORT_CONCERN_OPTIONS.map(c => ({ value: c, label: c }))
        : [];
    return q ? items.filter(i => i.label.toLowerCase().includes(q)) : items;
  }, [picker, search, accounts]);

  const openPicker = (kind: PickerKind) => { setSearch(''); setPicker(kind); };

  const onPick = (item: { value: string }) => {
    if (picker === 'account') {
      setAccountNo(item.value);
      setFormErrors(e => ({ ...e, accountNo: '' }));
    } else if (picker === 'concern') {
      setConcern(item.value);
    }
    setPicker(null);
  };

  const resetForm = () => {
    setAccountNo('');
    setConcern(SUPPORT_CONCERN_OPTIONS[0]);
    setDetails('');
    setFormErrors({});
    setSubmitError('');
  };

  const submit = async () => {
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const ticket = {
        account_no: accountNo,
        concern,
        concern_remarks: details.trim(),
        support_status: 'Pending',
        visit_status: 'Pending',
        reject_if_open: true,
      };
      const response = await createServiceOrder(ticket);
      if (!response?.success) throw new Error((response as any)?.message || 'Failed to submit the ticket.');

      setShowNewTicket(false);
      resetForm();
      Alert.alert('Ticket Submitted', 'The support ticket has been created. You can follow it in this list.');
      await loadTickets();
    } catch (error: any) {
      setSubmitError(submitErrorMessage(error, accountNo));
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmitPress = () => {
    const errors: Record<string, string> = {};
    if (!accountNo) errors.accountNo = 'Select the account this ticket is for.';
    if (!details.trim()) errors.details = 'Please describe the issue.';
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    Alert.alert(
      'Submit Ticket',
      `Raise a "${concern}" ticket for ${selectedAccount ? accountLabel(selectedAccount) : accountNo}?`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Submit', onPress: submit }]
    );
  };

  return (
    <View style={s.container}>
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Support Tickets</Text>
          <Text style={s.subtitle}>Tickets for the customers you referred</Text>
        </View>
        <Pressable
          onPress={() => { resetForm(); setShowNewTicket(true); }}
          style={[s.newButton, { backgroundColor: primaryColor }]}
          accessibilityLabel="New Ticket"
        >
          <Plus size={18} color="#ffffff" />
          <Text style={s.newButtonText}>New</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={s.centered}><ActivityIndicator size="large" color={primaryColor} /></View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={t => t.id}
          renderItem={({ item }) => <TicketCard ticket={item} primaryColor={primaryColor} onPress={setSelectedTicket} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[primaryColor]} tintColor={primaryColor} />}
          ListHeaderComponent={loadError ? <Text style={s.errorBanner}>{loadError}</Text> : null}
          ListEmptyComponent={
            <View style={s.empty}>
              <FileText size={44} color="#9ca3af" strokeWidth={1} />
              <Text style={s.emptyTitle}>No support tickets</Text>
              <Text style={s.emptyText}>Tickets for the customers you referred appear here.</Text>
            </View>
          }
        />
      )}

      <Modal visible={showNewTicket} animationType="slide" onRequestClose={() => !isSubmitting && setShowNewTicket(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#ffffff' }}>
          <View style={s.modalHeader}>
            <Pressable onPress={() => setShowNewTicket(false)} disabled={isSubmitting} accessibilityLabel="Close">
              <X size={22} color="#374151" />
            </Pressable>
            <Text style={s.modalTitle}>New Ticket</Text>
            <View style={{ width: 22 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <SearchablePickerTrigger
              label="Account Number"
              required
              value={selectedAccount ? accountLabel(selectedAccount) : ''}
              placeholder={isLoadingAccounts ? 'Loading your customers…' : 'Select a customer you referred'}
              onPress={() => openPicker('account')}
              error={formErrors.accountNo || accountsError}
            />
            {!isLoadingAccounts && !accountsError && accounts.length === 0 && (
              <Text style={s.hint}>No referred customers found, so there is no account to raise a ticket for.</Text>
            )}

            <SearchablePickerTrigger label="Concern" required value={concern} placeholder="Select concern" onPress={() => openPicker('concern')} />

            <View style={{ marginBottom: 14 }}>
              <Text style={s.label}>Details <Text style={{ color: '#ef4444' }}>*</Text></Text>
              <TextInput
                value={details}
                onChangeText={t => { setDetails(t); if (formErrors.details) setFormErrors(e => ({ ...e, details: '' })); }}
                placeholder="Describe the issue..."
                placeholderTextColor="#9ca3af"
                multiline
                style={[s.textArea, { borderColor: formErrors.details ? '#ef4444' : '#d1d5db' }]}
                accessibilityLabel="Details"
              />
              {!!formErrors.details && <Text style={s.fieldError}>{formErrors.details}</Text>}
            </View>

            {!!submitError && <Text style={s.errorBanner}>{submitError}</Text>}

            <Pressable
              onPress={onSubmitPress}
              disabled={isSubmitting}
              style={[s.submitButton, { backgroundColor: isSubmitting ? '#9ca3af' : primaryColor }]}
            >
              {isSubmitting ? <ActivityIndicator color="#ffffff" /> : <Text style={s.submitText}>SUBMIT TICKET</Text>}
            </Pressable>
          </ScrollView>

          <SearchablePicker
            isOpen={picker !== null}
            onClose={() => setPicker(null)}
            title={picker === 'account' ? 'Select Account' : 'Concern'}
            data={pickerData}
            onSelect={onPick}
            keyExtractor={(item, i) => `${picker}-${item.value}-${i}`}
            searchValue={search}
            onSearchChange={setSearch}
            placeholder={picker === 'account' ? 'Search account no. or name…' : 'Search…'}
            activeColor={primaryColor}
            itemTextKey="label"
            itemValueKey="value"
            selectedItemValue={picker === 'account' ? accountNo : concern}
          />
        </KeyboardAvoidingView>
      </Modal>

      {selectedTicket && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
          <SupportDetails request={selectedTicket} onClose={() => setSelectedTicket(null)} />
        </View>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  newButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
  newButtonText: { color: '#ffffff', fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#ffffff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#f3f4f6' },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  ticketId: { fontSize: 14, fontWeight: '700', color: '#111827' },
  dateBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  dateText: { fontSize: 11, fontWeight: '600' },
  statusBadge: { backgroundColor: '#f3f4f6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '700', color: '#374151' },
  accountText: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 10 },
  issueSection: { marginTop: 6 },
  issueTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  issueDetails: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  cardFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  visitRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  visitText: { fontSize: 12, color: '#6b7280' },
  detailsBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  detailsBtnText: { fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#374151', marginTop: 12 },
  emptyText: { fontSize: 13, color: '#6b7280', marginTop: 4, textAlign: 'center' },
  errorBanner: { backgroundColor: '#fee2e2', color: '#b91c1c', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 12 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 18, paddingBottom: 14, borderBottomWidth: 1, borderColor: '#e5e7eb',
  },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#111827' },
  label: { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 },
  hint: { fontSize: 12, color: '#6b7280', marginTop: -6, marginBottom: 14 },
  textArea: { borderWidth: 1, borderRadius: 8, padding: 12, minHeight: 110, fontSize: 15, color: '#111827', textAlignVertical: 'top' },
  fieldError: { color: '#ef4444', fontSize: 12, marginTop: 4 },
  submitButton: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  submitText: { color: '#ffffff', fontWeight: '700', letterSpacing: 0.5 },
});

export default AgentSupport;
