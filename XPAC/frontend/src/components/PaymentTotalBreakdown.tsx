import React from 'react';

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
    isDarkMode?: boolean;
}

const formatPeso = (value: number) =>
    `₱${Math.abs(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatSigned = (value: number, isFirst: boolean) =>
    value < 0 ? `−${formatPeso(value)}` : isFirst ? formatPeso(value) : `+${formatPeso(value)}`;

const PaymentTotalBreakdown: React.FC<PaymentTotalBreakdownProps> = ({ lines, totalLabel, total, notes = [], isDarkMode = false }) => {
    const strongClassName = isDarkMode ? 'text-white' : 'text-gray-900';
    const discountClassName = isDarkMode ? 'text-green-400' : 'text-green-700';
    return (
        <div className={`p-4 rounded mb-4 space-y-2 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`} aria-label="Payment total">
            {lines.map((line, index) => (
                <div key={line.label} className={`flex justify-between gap-4 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    <span>{line.label}</span>
                    <span className={`font-medium whitespace-nowrap ${line.isDiscount ? discountClassName : strongClassName}`}>
                        {formatSigned(line.amount, index === 0)}
                    </span>
                </div>
            ))}
            <div className={`flex justify-between gap-4 pt-2 border-t ${isDarkMode ? 'border-gray-600' : 'border-gray-300'} ${strongClassName}`}>
                <span className="font-bold">{totalLabel}</span>
                <span className="font-bold text-lg whitespace-nowrap">{total < 0 ? `−${formatPeso(total)}` : formatPeso(total)}</span>
            </div>
            {notes.map(note => (
                <p key={note} className={`text-xs ${discountClassName}`}>{note}</p>
            ))}
        </div>
    );
};

export default PaymentTotalBreakdown;
