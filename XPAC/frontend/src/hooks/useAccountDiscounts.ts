import { useEffect, useState } from 'react';
import { paymentService } from '../services/paymentService';
import { invoiceService, InvoiceRecord } from '../services/invoiceService';

export interface AccountDiscounts {
  checkout: number;
  discountsOnFile: number;
  latestBillDiscount: number;
  latestBillTotal: number | null;
}

const NO_DISCOUNTS: AccountDiscounts = { checkout: 0, discountsOnFile: 0, latestBillDiscount: 0, latestBillTotal: null };

const newestInvoiceFirst = (a: InvoiceRecord, b: InvoiceRecord): number =>
  (new Date(b.invoice_date).getTime() - new Date(a.invoice_date).getTime()) || (b.id - a.id);

const discountOnBill = (invoice?: InvoiceRecord): number =>
  Math.round((Number(invoice?.discounts ?? 0) + Number(invoice?.rebate ?? 0)) * 100) / 100;

export const useAccountDiscounts = (accountNo: string | null | undefined, enabled: boolean): AccountDiscounts => {
  const [discounts, setDiscounts] = useState<AccountDiscounts>(NO_DISCOUNTS);

  useEffect(() => {
    setDiscounts(NO_DISCOUNTS);
    if (!enabled || !accountNo) return;
    let cancelled = false;
    Promise.all([
      paymentService.getAvailableDiscount(accountNo),
      invoiceService.getInvoicesByAccountNo(accountNo).catch((): InvoiceRecord[] => []),
    ]).then(([available, invoices]) => {
      if (cancelled) return;
      const latestBill = [...invoices].sort(newestInvoiceFirst)[0];
      setDiscounts({
        ...available,
        latestBillDiscount: discountOnBill(latestBill),
        latestBillTotal: latestBill ? Number(latestBill.total_amount ?? 0) : null,
      });
    });
    return () => { cancelled = true; };
  }, [accountNo, enabled]);

  return discounts;
};
