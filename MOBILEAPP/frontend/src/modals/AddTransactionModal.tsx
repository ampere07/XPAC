import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, ScrollView, Pressable, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { X, Calendar } from 'lucide-react-native';
import apiClient from '../config/api';
import { useBillingStore } from '../store/billingStore';
import { transactionService } from '../services/transactionService';
import { technicianService, Technician } from '../services/technicianService';
import { paymentMethodService, PaymentMethod } from '../services/paymentMethodService';
import { planService, Plan } from '../services/planService';
import { settingsColorPaletteService } from '../services/settingsColorPaletteService';
import { SearchablePicker, SearchablePickerTrigger } from '../components/SearchablePicker';
import ImagePreview from '../components/ImagePreview';

/**
 * A technician recording a payment from the Transaction List — the mobile counterpart of the
 * web TransactionFormModal opened from the technician's "+" there.
 *
 * Same rules as the web form and the backend (TransactionController@store):
 *   - the account is searched and picked (10 shown until something is typed);
 *   - transaction types depend on prepaid/postpaid ('Top Up' vs 'Recurring Fee');
 *   - a prepaid Top Up buys a plan, preselected to the queued or current plan, and the
 *     amount is that plan's price;
 *   - Processed By is picked from the technicians table;
 *   - the payment is created Pending — approval stays with staff.
 */

const SHARED_TYPES = ['Service Charge', 'Installation Fee'];
const PREPAID_TYPES = ['Top Up', ...SHARED_TYPES];
const POSTPAID_TYPES = ['Recurring Fee', ...SHARED_TYPES];
const ACCOUNTS_SHOWN_BY_DEFAULT = 10;
const ACCOUNTS_SHOWN_WHEN_SEARCHING = 50;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface PickedAccount {
  accountNo: string;
  fullName: string;
  contactNo: string;
  plan: string;
  accountBalance: number;
  isPrepaid: boolean;
  pendingPlanId: number | null;
}

type PickerKind = 'account' | 'type' | 'plan' | 'method' | 'technician' | null;

const today = () => new Date().toISOString().split('T')[0];

const AddTransactionModal: React.FC<Props> = ({ isOpen, onClose, onSaved }) => {
  const [primary, setPrimary] = useState('#7c3aed');
  const accountRecords = useBillingStore(s => s.billingRecords);
  const fetchAccountRecords = useBillingStore(s => s.fetchBillingRecords);

  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);

  const [account, setAccount] = useState<PickedAccount | null>(null);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);
  const [transactionType, setTransactionType] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [receivedPayment, setReceivedPayment] = useState('');
  const [paymentDate, setPaymentDate] = useState(today());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [orNo, setOrNo] = useState('');
  const [processedBy, setProcessedBy] = useState('');
  const [remarks, setRemarks] = useState('');
  const [image, setImage] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [picker, setPicker] = useState<PickerKind>(null);
  const [search, setSearch] = useState('');

  const reset = () => {
    setAccount(null); setTransactionType(''); setSelectedPlanId(null); setReceivedPayment('');
    setPaymentDate(today()); setPaymentMethod(''); setReferenceNo(''); setOrNo(''); setProcessedBy('');
    setRemarks(''); setImage(null); setErrors({}); setPicker(null); setSearch('');
  };

  useEffect(() => {
    if (!isOpen) { reset(); return; }
    settingsColorPaletteService.getActive().then(p => p?.primary && setPrimary(p.primary)).catch(() => {});
    fetchAccountRecords();
    technicianService.getAllTechnicians().then(r => setTechnicians(Array.isArray(r?.data) ? r.data : [])).catch(() => {});
    paymentMethodService.getAll().then(r => setMethods((Array.isArray(r?.data) ? r.data : []).filter(m => m.is_active !== false))).catch(() => {});
    planService.getAllPlans().then(p => setPlans((p || []).filter(x => Number(x.price) > 0))).catch(() => {});
  }, [isOpen]);

  const technicianName = (t: Technician) =>
    [t.first_name, t.middle_initial ? `${t.middle_initial}.` : '', t.last_name].filter(Boolean).join(' ').trim();

  const isPrepaid = !!account?.isPrepaid;
  const typeOptions = isPrepaid ? PREPAID_TYPES : POSTPAID_TYPES;
  const showPlanPicker = isPrepaid && transactionType === 'Top Up';
  const selectedPlan = plans.find(p => p.id === selectedPlanId) || null;

  const accountOptions = useMemo(() => accountRecords
    .filter(r => !!r.accountNo)
    .map(r => ({ value: String(r.accountNo), label: [r.accountNo, r.customerName, r.address].filter(Boolean).join(' | ') })),
    [accountRecords]);

  // What the open picker lists. Accounts: 10 until something is typed, then every match.
  const pickerData = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (label: string) => !q || label.toLowerCase().includes(q);
    switch (picker) {
      case 'account':
        return q
          ? accountOptions.filter(o => match(o.label)).slice(0, ACCOUNTS_SHOWN_WHEN_SEARCHING)
          : accountOptions.slice(0, ACCOUNTS_SHOWN_BY_DEFAULT);
      case 'type':
        return typeOptions.filter(match).map(t => ({ value: t, label: t }));
      case 'plan':
        return plans.map(p => ({ value: p.id, label: `${p.name} - P${Number(p.price).toFixed(2)}` })).filter(o => match(o.label));
      case 'method':
        return methods.map(m => ({ value: m.payment_method, label: m.payment_method })).filter(o => match(o.label));
      case 'technician':
        return technicians.map(t => ({ value: technicianName(t), label: technicianName(t) })).filter(o => match(o.label));
      default:
        return [];
    }
  }, [picker, search, accountOptions, typeOptions, plans, methods, technicians]);

  const openPicker = (kind: PickerKind) => { setSearch(''); setPicker(kind); };

  /** Prepaid Top Up: the amount due is the plan's price. */
  const applyPlan = (plan: Plan | null) => {
    setSelectedPlanId(plan?.id ?? null);
    if (plan) setReceivedPayment(Number(plan.price ?? 0).toFixed(2));
  };

  const pickAccount = async (accountNo: string) => {
    setPicker(null);
    setIsLoadingAccount(true);
    try {
      const res = await apiClient.get<any>(`/billing/${accountNo}`);
      const item = res.data?.data || {};
      const prepaid = String(item.Generation_Type ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'prepaid';
      const picked: PickedAccount = {
        accountNo: item.Account_No || accountNo,
        fullName: item.Full_Name || '',
        contactNo: item.Contact_Number || '',
        plan: item.Plan || item.Desired_Plan || '',
        accountBalance: parseFloat(item.Account_Balance) || 0,
        isPrepaid: prepaid,
        pendingPlanId: item.Pending_Plan_Id != null ? Number(item.Pending_Plan_Id) : null,
      };
      setAccount(picked);
      const firstType = prepaid ? PREPAID_TYPES[0] : POSTPAID_TYPES[0];
      setTransactionType(firstType);
      // Preselect the queued plan, else the current one (matched by name before " - ").
      if (prepaid) {
        const currentName = picked.plan.split(' - ')[0].trim().toLowerCase();
        const preselect = plans.find(p => p.id === picked.pendingPlanId)
          || plans.find(p => p.name.trim().toLowerCase() === currentName) || null;
        applyPlan(preselect);
      } else {
        setSelectedPlanId(null);
      }
      setErrors(e => ({ ...e, accountNo: '' }));
    } catch {
      Alert.alert('Error', 'Could not load that account. Please try again.');
    } finally {
      setIsLoadingAccount(false);
    }
  };

  const onSelect = (item: any) => {
    const value = item?.value;
    switch (picker) {
      case 'account': pickAccount(String(value)); return;
      case 'type':
        setTransactionType(value);
        if (value !== 'Top Up') setSelectedPlanId(null);
        else if (isPrepaid && !selectedPlanId) {
          const currentName = (account?.plan || '').split(' - ')[0].trim().toLowerCase();
          applyPlan(plans.find(p => p.name.trim().toLowerCase() === currentName) || null);
        }
        break;
      case 'plan': applyPlan(plans.find(p => p.id === value) || null); break;
      case 'method': setPaymentMethod(value); break;
      case 'technician': setProcessedBy(value); break;
    }
    if (picker) setErrors(e => ({ ...e, [picker === 'type' ? 'transactionType' : picker === 'method' ? 'paymentMethod' : picker === 'technician' ? 'processedBy' : picker]: '' }));
    setPicker(null);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!account) e.accountNo = 'Account No. is required';
    if (!transactionType) e.transactionType = 'Transaction Type is required';
    if (showPlanPicker && !selectedPlanId) e.plan = 'Select the plan this payment is for';
    if (!receivedPayment.trim() || isNaN(Number(receivedPayment))) e.receivedPayment = 'Received Payment is required';
    if (!paymentDate.trim()) e.paymentDate = 'Payment Date is required';
    if (!paymentMethod.trim()) e.paymentMethod = 'Payment Method is required';
    if (!referenceNo.trim()) e.referenceNo = 'Reference No. is required';
    if (!orNo.trim()) e.orNo = 'OR No. is required';
    if (!processedBy.trim()) e.processedBy = 'Processed By is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate() || !account) {
      Alert.alert('Missing Information', 'Please fill in all required fields before saving.');
      return;
    }
    setSaving(true);
    try {
      let imageUrl: string | undefined;
      if (image) {
        const fd = new FormData();
        fd.append('folder_name', `transactionform - ${account.fullName}`);
        fd.append('payment_proof_image', image, image.name || `payment_proof_${Date.now()}.jpg`);
        const up = await transactionService.uploadTransactionImage(fd);
        if (!up?.success) {
          Alert.alert('Upload Failed', up?.message || 'Failed to upload the payment proof.');
          return;
        }
        imageUrl = up.data?.payment_proof_image_url;
      }

      const result = await transactionService.createTransaction({
        account_no: account.accountNo,
        transaction_type: transactionType,
        received_payment: parseFloat(receivedPayment) || 0,
        payment_date: paymentDate,
        date_processed: new Date().toISOString(),
        processed_by_user: processedBy,
        created_by_user: processedBy,
        payment_method: paymentMethod,
        reference_no: referenceNo.trim(),
        or_no: orNo.trim(),
        remarks: remarks || '',
        status: 'Pending',
        ...(imageUrl ? { image_url: imageUrl } : {}),
        ...(showPlanPicker && selectedPlanId ? { selected_plan_id: selectedPlanId } : {}),
      });

      if (result.success) {
        Alert.alert('Pending Approval', `${transactionType} transaction has been submitted.\n\nIt needs approval before the account balance is updated.`,
          [{ text: 'OK', onPress: () => { onSaved(); onClose(); } }]);
      } else if (result.errors?.reference_no?.length) {
        setErrors(e => ({ ...e, referenceNo: result.errors!.reference_no[0] }));
        Alert.alert('Duplicate Reference No.', result.errors.reference_no[0]);
      } else {
        const fieldMessages = result.errors ? Object.values(result.errors).flat().join('\n') : '';
        Alert.alert('Error', `Failed to create transaction: ${fieldMessages || result.message}`);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save the transaction.');
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, value }: { label: string; value: string }) => (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>{label}</Text>
      <Text style={{ fontSize: 15, color: '#6b7280', backgroundColor: '#f3f4f6', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12 }}>
        {value || '-'}
      </Text>
    </View>
  );

  const input = (label: string, value: string, onChange: (t: string) => void, key: string, opts: any = {}) => (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
        {label}{opts.optional ? '' : <Text style={{ color: '#ef4444' }}> *</Text>}
      </Text>
      <TextInput
        value={value}
        onChangeText={(t) => { onChange(t); if (errors[key]) setErrors(e => ({ ...e, [key]: '' })); }}
        placeholder={opts.placeholder}
        keyboardType={opts.keyboardType}
        multiline={opts.multiline}
        style={{
          borderWidth: 1, borderColor: errors[key] ? '#ef4444' : '#d1d5db', borderRadius: 8, paddingHorizontal: 12,
          paddingVertical: 10, fontSize: 15, color: '#111827', backgroundColor: '#ffffff', minHeight: opts.multiline ? 80 : undefined,
          textAlignVertical: opts.multiline ? 'top' : 'center',
        }}
      />
      {!!errors[key] && <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{errors[key]}</Text>}
    </View>
  );

  const pickerTitle: Record<string, string> = {
    account: 'Select Account', type: 'Transaction Type', plan: 'Select Plan', method: 'Payment Method', technician: 'Processed By',
  };

  return (
    <Modal visible={isOpen} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 54 : 18, paddingBottom: 14, borderBottomWidth: 1, borderColor: '#e5e7eb' }}>
          <TouchableOpacity onPress={onClose} disabled={saving}><X size={22} color="#374151" /></TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '600', color: '#111827' }}>Add Transaction</Text>
          <TouchableOpacity onPress={save} disabled={saving} style={{ backgroundColor: primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, opacity: saving ? 0.6 : 1 }}>
            {saving ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={{ color: '#ffffff', fontWeight: '600' }}>Save</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <SearchablePickerTrigger
            label="Account No."
            required
            value={account ? `${account.accountNo} | ${account.fullName}` : ''}
            placeholder={isLoadingAccount ? 'Loading account…' : 'Search account no. or name…'}
            onPress={() => openPicker('account')}
            error={errors.accountNo}
          />
          {isLoadingAccount && <ActivityIndicator color={primary} style={{ marginBottom: 12 }} />}

          {account && (
            <>
              <Field label="Full Name" value={account.fullName} />
              <Field label="Contact No." value={account.contactNo} />
              <Field label="Current Plan" value={account.plan} />
              <Field label="Account Balance" value={`P${account.accountBalance.toFixed(2)}`} />
            </>
          )}

          <SearchablePickerTrigger label="Transaction Type" required value={transactionType} placeholder="Select type"
            onPress={() => account ? openPicker('type') : setErrors(e => ({ ...e, accountNo: 'Pick an account first' }))}
            error={errors.transactionType} />

          {showPlanPicker && (
            <SearchablePickerTrigger label="Plan" required
              value={selectedPlan ? `${selectedPlan.name} - P${Number(selectedPlan.price).toFixed(2)}` : ''}
              placeholder="Select the plan this payment buys" onPress={() => openPicker('plan')} error={errors.plan} />
          )}

          {input('Received Payment', receivedPayment, setReceivedPayment, 'receivedPayment', { keyboardType: 'decimal-pad', placeholder: '0.00' })}

          <View style={{ marginBottom: 14 }}>
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Payment Date<Text style={{ color: '#ef4444' }}> *</Text></Text>
            <Pressable onPress={() => setShowDatePicker(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: errors.paymentDate ? '#ef4444' : '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12 }}>
              <Text style={{ fontSize: 15, color: '#111827' }}>{paymentDate}</Text>
              <Calendar size={18} color="#6b7280" />
            </Pressable>
            {showDatePicker && (
              <DateTimePicker
                value={new Date(paymentDate + 'T00:00:00')}
                mode="date"
                maximumDate={new Date()}
                onChange={(_e, d) => { setShowDatePicker(false); if (d) setPaymentDate(d.toISOString().split('T')[0]); }}
              />
            )}
          </View>

          <SearchablePickerTrigger label="Payment Method" required value={paymentMethod} placeholder="Select payment method"
            onPress={() => openPicker('method')} error={errors.paymentMethod} />

          {input('Reference No.', referenceNo, setReferenceNo, 'referenceNo', { placeholder: 'e.g. GCash ref no.' })}
          {input('OR No.', orNo, setOrNo, 'orNo')}

          <SearchablePickerTrigger label="Processed By" required value={processedBy} placeholder="Select technician"
            onPress={() => openPicker('technician')} error={errors.processedBy} />

          {input('Remarks', remarks, setRemarks, 'remarks', { multiline: true, optional: true })}

          <ImagePreview label="Payment Proof" imageUrl={image?.uri || null} onUpload={setImage} colorPrimary={primary} />
        </ScrollView>

        <SearchablePicker
          isOpen={picker !== null}
          onClose={() => setPicker(null)}
          title={picker ? pickerTitle[picker] : ''}
          data={pickerData}
          onSelect={onSelect}
          keyExtractor={(item, i) => `${picker}-${item.value}-${i}`}
          searchValue={search}
          onSearchChange={setSearch}
          placeholder={picker === 'account' ? 'Search account no. or name…' : 'Search…'}
          activeColor={primary}
          itemTextKey="label"
          itemValueKey="value"
        />
      </View>
    </Modal>
  );
};

export default AddTransactionModal;
