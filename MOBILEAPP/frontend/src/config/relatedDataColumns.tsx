export interface TableColumn {
  key: string;
  label: string;
  render?: (value: any, row: any) => React.ReactNode;
}

export const relatedDataColumns = {
  invoices: [
    { key: 'id', label: 'Invoice ID', render: (val: any, row: any) => row.id || row.invoice_id },
    { key: 'amount', label: 'Amount', render: (val: any, row: any) => `₱${row.amount || row.total_amount || '0.00'}` },
    { key: 'status', label: 'Status' },
    { key: 'created_at', label: 'Date', render: (val: any, row: any) => row.created_at || row.date || 'N/A' }
  ] as TableColumn[],

  paymentPortalLogs: [
    { key: 'transaction_id', label: 'Transaction ID', render: (val: any, row: any) => row.transaction_id || row.id },
    { key: 'amount', label: 'Amount', render: (val: any) => `₱${val || '0.00'}` },
    { key: 'status', label: 'Status' },
    { key: 'created_at', label: 'Date', render: (val: any, row: any) => row.created_at || row.date || 'N/A' }
  ] as TableColumn[],

  transactions: [
    { key: 'id', label: 'Transaction ID', render: (val: any, row: any) => row.id || row.transaction_id },
    { key: 'amount', label: 'Amount', render: (val: any) => `₱${val || '0.00'}` },
    { key: 'type', label: 'Type' },
    { key: 'payment_method', label: 'Payment Method', render: (val: any) => val || 'N/A' },
    { key: 'created_at', label: 'Date', render: (val: any, row: any) => row.created_at || row.date || 'N/A' }
  ] as TableColumn[],

  staggered: [
    { key: 'id', label: 'ID' },
    { key: 'monthly_amount', label: 'Monthly Amount', render: (val: any) => `₱${val || '0.00'}` },
    { key: 'total_months', label: 'Months' },
    { key: 'remaining_balance', label: 'Remaining', render: (val: any) => `₱${val || '0.00'}` },
    { key: 'status', label: 'Status' }
  ] as TableColumn[],

  discounts: [
    { key: 'id', label: 'ID' },
    { key: 'discount_type', label: 'Type' },
    { key: 'amount', label: 'Amount', render: (val: any, row: any) => `₱${val || row.discount_amount || '0.00'}` },
    { key: 'start_date', label: 'Start Date', render: (val: any) => val || 'N/A' },
    { key: 'end_date', label: 'End Date', render: (val: any) => val || 'N/A' }
  ] as TableColumn[],

  serviceOrders: [
    { key: 'id', label: 'SO ID', render: (val: any, row: any) => row.id || row.so_id },
    { key: 'type', label: 'Type', render: (val: any, row: any) => row.type || row.service_type || 'N/A' },
    { key: 'status', label: 'Status' },
    { key: 'assigned_to', label: 'Assigned To', render: (val: any) => val || 'Unassigned' },
    { key: 'created_at', label: 'Date', render: (val: any, row: any) => row.created_at || row.date || 'N/A' }
  ] as TableColumn[],

  reconnectionLogs: [
    { key: 'id', label: 'Log ID' },
    { key: 'reconnected_by', label: 'Reconnected By', render: (val: any) => val || 'System' },
    { key: 'reason', label: 'Reason', render: (val: any) => val || 'N/A' },
    { key: 'created_at', label: 'Date' }
  ] as TableColumn[],

  disconnectedLogs: [
    { key: 'id', label: 'Log ID' },
    { key: 'disconnected_by', label: 'Disconnected By', render: (val: any) => val || 'System' },
    { key: 'reason', label: 'Reason', render: (val: any) => val || 'N/A' },
    { key: 'created_at', label: 'Date' }
  ] as TableColumn[],

  detailsUpdateLogs: [
    { key: 'id', label: 'Log ID' },
    { key: 'field_updated', label: 'Field Updated', render: (val: any) => val || 'N/A' },
    { key: 'old_value', label: 'Old Value', render: (val: any) => val || '-' },
    { key: 'new_value', label: 'New Value', render: (val: any) => val || '-' },
    { key: 'updated_by', label: 'Updated By', render: (val: any) => val || 'System' },
    { key: 'created_at', label: 'Date' }
  ] as TableColumn[],

  planChangeLogs: [
    { key: 'id', label: 'Log ID' },
    { key: 'old_plan', label: 'Old Plan', render: (val: any) => val || '-' },
    { key: 'new_plan', label: 'New Plan' },
    { key: 'changed_by', label: 'Changed By', render: (val: any) => val || 'System' },
    { key: 'created_at', label: 'Date' }
  ] as TableColumn[],

  serviceChargeLogs: [
    { key: 'id', label: 'Log ID' },
    { key: 'charge_type', label: 'Charge Type', render: (val: any) => val || 'N/A' },
    { key: 'amount', label: 'Amount', render: (val: any) => `₱${val || '0.00'}` },
    { key: 'applied_by', label: 'Applied By', render: (val: any) => val || 'System' },
    { key: 'created_at', label: 'Date' }
  ] as TableColumn[],

  changeDueLogs: [
    { key: 'id', label: 'Log ID' },
    { key: 'old_due_date', label: 'Old Due Date', render: (val: any) => val || '-' },
    { key: 'new_due_date', label: 'New Due Date' },
    { key: 'changed_by', label: 'Changed By', render: (val: any) => val || 'System' },
    { key: 'created_at', label: 'Date' }
  ] as TableColumn[],

  securityDeposits: [
    { key: 'id', label: 'ID' },
    { key: 'amount', label: 'Amount', render: (val: any) => `₱${val || '0.00'}` },
    { key: 'status', label: 'Status' },
    { key: 'collected_by', label: 'Collected By', render: (val: any) => val || 'N/A' },
    { key: 'created_at', label: 'Date', render: (val: any, row: any) => row.created_at || row.date || 'N/A' }
  ] as TableColumn[]
};
