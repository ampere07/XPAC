import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Info, Mail } from 'lucide-react-native';

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch (e) {
    return dateString;
  }
};

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
}

interface ExpensesLogDetailsProps {
  expenseRecord: ExpenseRecord;
}

const Row: React.FC<{ label: string; value?: React.ReactNode; valueColor?: string; icon?: 'info' | 'mail' }> = ({
  label,
  value,
  valueColor,
  icon,
}) => (
  <View
    style={{
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#f1f5f9',
    }}
  >
    <Text style={{ fontSize: 13, color: '#6b7280' }}>{label}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, justifyContent: 'flex-end' }}>
      <Text style={{ fontSize: 14, fontWeight: '500', color: valueColor || '#111827', textAlign: 'right' }} numberOfLines={2}>
        {value ?? '-'}
      </Text>
      {icon === 'info' && <Info size={15} color="#6b7280" />}
      {icon === 'mail' && <Mail size={15} color="#6b7280" />}
    </View>
  </View>
);

const ExpensesLogDetails: React.FC<ExpensesLogDetailsProps> = ({ expenseRecord }) => {
  return (
    <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
      <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
        <Row label="Date" value={formatDate(expenseRecord.date)} />
        <Row label="Expenses ID" value={expenseRecord.expensesId} />
        <Row label="Provider" value={expenseRecord.provider} icon="info" />
        <Row label="Description" value={expenseRecord.description} />
        <Row
          label="Amount"
          value={`₱${Number(expenseRecord.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
        />
        <Row label="Processed By" value={expenseRecord.processedBy} icon="info" />
        <Row label="Modified By" value={expenseRecord.modifiedBy} icon="info" />
        <Row label="Modified Date" value={formatDate(expenseRecord.modifiedDate)} />
        <Row label="User Email" value={expenseRecord.userEmail} icon="mail" />
        <Row label="Payee" value={expenseRecord.payee} />
        <Row label="Category" value={expenseRecord.category} icon="info" />
        <Row label="Invoice No." value={expenseRecord.invoiceNo} valueColor="#dc2626" />
        <Row label="Received Date" value={formatDate(expenseRecord.receivedDate)} />
        <Row label="Supplier" value={expenseRecord.supplier} icon="info" />
        <Row label="City" value={expenseRecord.city} />
      </ScrollView>
    </View>
  );
};

export default ExpensesLogDetails;
