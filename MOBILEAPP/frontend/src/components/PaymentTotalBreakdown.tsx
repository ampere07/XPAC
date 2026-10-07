import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export interface PaymentBreakdownLine {
    label: string;
    amount: number;
    isDiscount?: boolean;
}

const roundToCentavos = (value: number) => Math.round(value * 100) / 100;

export const postpaidBalanceLines = (balance: number, latestBillTotal: number | null, latestBillDiscount: number): PaymentBreakdownLine[] => {
    if (latestBillTotal === null || balance <= 0) return [{ label: 'Account balance', amount: balance }];
    const carriedOver = roundToCentavos(balance - latestBillTotal);
    return [
        { label: 'Latest bill', amount: roundToCentavos(latestBillTotal + latestBillDiscount) },
        ...(latestBillDiscount > 0 ? [{ label: 'Discount / rebate', amount: -latestBillDiscount, isDiscount: true }] : []),
        ...(carriedOver !== 0 ? [{ label: carriedOver > 0 ? 'Unpaid from before' : 'Already paid', amount: carriedOver }] : []),
    ];
};

interface PaymentTotalBreakdownProps {
    lines: PaymentBreakdownLine[];
    totalLabel: string;
    total: number;
    notes?: string[];
}

const formatPeso = (value: number) =>
    `₱${Math.abs(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatSigned = (value: number, isFirst: boolean) =>
    value < 0 ? `−${formatPeso(value)}` : isFirst ? formatPeso(value) : `+${formatPeso(value)}`;

const PaymentTotalBreakdown: React.FC<PaymentTotalBreakdownProps> = ({ lines, totalLabel, total, notes = [] }) => (
    <View style={styles.card} accessibilityLabel="Payment total">
        {lines.map((line, index) => (
            <View key={line.label} style={styles.row}>
                <Text style={styles.rowLabel}>{line.label}</Text>
                <Text style={[styles.rowValue, line.isDiscount && styles.discountValue]}>{formatSigned(line.amount, index === 0)}</Text>
            </View>
        ))}
        <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>{totalLabel}</Text>
            <Text style={styles.totalValue}>{total < 0 ? `−${formatPeso(total)}` : formatPeso(total)}</Text>
        </View>
        {notes.map(note => (
            <Text key={note} style={styles.note}>{note}</Text>
        ))}
    </View>
);

const styles = StyleSheet.create({
    card: { backgroundColor: '#f3f4f6', borderRadius: 8, padding: 16, marginBottom: 24, gap: 8 },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
    rowLabel: { flexShrink: 1, fontSize: 14, color: '#374151' },
    rowValue: { fontSize: 14, fontWeight: '500', color: '#111827' },
    discountValue: { color: '#15803d' },
    totalRow: { paddingTop: 8, borderTopWidth: 1, borderTopColor: '#d1d5db' },
    totalLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
    totalValue: { fontSize: 18, fontWeight: '700', color: '#111827' },
    note: { fontSize: 12, color: '#15803d', lineHeight: 16 },
});

export default PaymentTotalBreakdown;
