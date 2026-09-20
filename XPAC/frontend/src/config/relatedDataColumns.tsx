import React from 'react';

export interface TableColumn {
  key: string;
  label: string;
  render?: (value: any, row: any) => React.ReactNode;
  className?: string;
}

const formatDate = (val: any) => {
  if (!val) return '-';
  try {
    const date = new Date(val);
    if (isNaN(date.getTime())) return val;
    
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch (e) {
    return val;
  }
};

const formatDateTime = (val: any) => {
  if (!val) return '-';
  try {
    const date = new Date(val);
    if (isNaN(date.getTime())) return val;
    
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
    
    return `${getPart('month')}/${getPart('day')}/${getPart('year')} ${getPart('hour')}:${getPart('minute')} ${getPart('dayPeriod')}`;
  } catch (e) {
    return val;
  }
};

const renderDetailsJson = (val: any, row?: any, columnKey?: string) => {
  if (!val && !row) return '-';
  
  try {
    const parseData = (v: any) => {
      if (!v) return {};
      const parsed = typeof v === 'string' ? JSON.parse(v) : v;
      return parsed.data || parsed;
    };

    let data = parseData(val);
    let otherData = {};
    let allKeys: string[] = [];

    // If we have row data and a column key, we can compare with the other column to align keys and heights
    if (row && (columnKey === 'old_details' || columnKey === 'new_details')) {
      const otherKey = columnKey === 'old_details' ? 'new_details' : 'old_details';
      const oldData = parseData(row.old_details);
      const newData = parseData(row.new_details);
      otherData = parseData(row[otherKey]);
      allKeys = Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)]))
        .filter(k => k !== 'type')
        .sort();
    } else {
      allKeys = Object.keys(data).filter(k => k !== 'type');
    }

    if (allKeys.length === 0) return '-';
    
    const formatValue = (v: any) => {
      if (v === null || v === undefined || v === '') return '(empty)';
      if (typeof v === 'object') {
        try {
          return JSON.stringify(v).replace(/[{}"]/g, '').replace(/:/g, ': ').replace(/,/g, ', ');
        } catch (e) {
          return '[Complex Object]';
        }
      }
      return String(v);
    };
    
    return (
      <ul className="text-xs w-full break-words max-h-[160px] overflow-y-auto overflow-x-hidden p-1 custom-scroll related-details-list">
        {allKeys.map((k) => {
          const v = data[k];
          const v_other = (otherData as any)[k];
          const displayKey = k.replace(/_/g, ' ')
                              .split(' ')
                              .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                              .join(' ');
          
          return (
            <li key={k} className="mb-1 grid grid-cols-1 grid-rows-1">
              {/* Ghost elements to force equal height across columns */}
              <div className="invisible row-start-1 col-start-1 pointer-events-none" aria-hidden="true">
                <span className="font-bold">{displayKey}:</span>{' '}
                <span className="break-all">{formatValue(v)}</span>
              </div>
              <div className="invisible row-start-1 col-start-1 pointer-events-none" aria-hidden="true">
                <span className="font-bold">{displayKey}:</span>{' '}
                <span className="break-all">{formatValue(v_other)}</span>
              </div>
              
              {/* Actual visible content */}
              <div className="row-start-1 col-start-1">
                <span className="font-bold">{displayKey}:</span>{' '}
                <span className="opacity-90 break-all">{formatValue(v)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    );
  } catch (e) {
    return String(val);
  }
};

export const relatedDataColumns = {
  invoices: [
    { key: 'status', label: 'Invoice Status', render: (val: any) => val || '-' },
    {
      key: 'invoice_date',
      label: 'Invoice Date',
      render: (val: any) => formatDate(val)
    },
    {
      key: 'due_date',
      label: 'Due Date',
      render: (val: any) => formatDate(val)
    },
    { key: 'total_amount', label: 'Total Amount', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'received_payment', label: 'Received Payment', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'account_no', label: 'Account No' },
    { key: 'invoice_no', label: 'Invoice No', render: (val: any) => val || '-' },
    { key: 'full_name', label: 'Full Name', render: (val: any) => val || '-' },
    { key: 'contact_number', label: 'Contact Number', render: (val: any) => val || '-' },
    { key: 'email_address', label: 'Email Address', render: (val: any) => val || '-' },
    { key: 'address', label: 'Address', render: (val: any) => val || '-' },
    { key: 'plan', label: 'Plan', render: (val: any) => val || '-' },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'invoice_balance', label: 'Invoice Balance', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'staggered', label: 'Staggered', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'service_charge', label: 'Service Charge', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'discounts', label: 'Discounts', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'rebate', label: 'Rebates', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    {
      key: 'date_processed',
      label: 'Date Processed',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'processed_by', label: 'Processed By', render: (val: any) => val || '-' },
    { key: 'payment_method', label: 'Payment Method', render: (val: any) => val || '-' },
    { key: 'reference_no', label: 'Reference No', render: (val: any) => val || '-' },
    { key: 'or_no', label: 'OR No', render: (val: any) => val || '-' },
    { key: 'updated_by', label: 'Modified By', render: (val: any) => val || '-' },
    {
      key: 'updated_at',
      label: 'Modified Date',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'transaction_id', label: 'Transaction ID', render: (val: any) => val || '-' },
    { key: 'barangay', label: 'Barangay', render: (val: any) => val || '-' },
    { key: 'city', label: 'City', render: (val: any) => val || '-' }
  ] as TableColumn[],

  paymentPortalLogs: [
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    {
      key: 'date_time',
      label: 'Date Time',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'reference_no', label: 'Reference No', render: (val: any) => val || '-' },
    { key: 'total_amount', label: 'Total Amount', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'transaction_status', label: 'Transaction Status', render: (val: any) => val || '-' },
    { key: 'account_no', label: 'Account No', render: (val: any) => val || '-' },
    { key: 'contact_no', label: 'Contact No', render: (val: any) => val || '-' },
    { key: 'account_balance', label: 'Account Balance', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'checkout_id', label: 'Checkout ID', render: (val: any) => val || '-' },
    { key: 'plan', label: 'Plan', render: (val: any) => val || '-' },
    { key: 'ewallet_type', label: 'Ewallet Type', render: (val: any) => val || '-' },
    { key: 'payment_method', label: 'Payment Method', render: (val: any) => val || '-' },
    { key: 'payment_channel', label: 'Payment Channel', render: (val: any) => val || '-' },
    { key: 'name', label: 'Name', render: (val: any) => val || '-' },
    { key: 'barangay', label: 'Barangay', render: (val: any) => val || '-' },
    { key: 'city', label: 'City', render: (val: any) => val || '-' }
  ] as TableColumn[],

  transactions: [
    {
      key: 'date_processed',
      label: 'Date Processed',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    { key: 'received_payment', label: 'Received Payment', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'or_no', label: 'OR No', render: (val: any) => val || '-' },
    { key: 'processed_by_user', label: 'Processed By', render: (val: any) => val || '-' },
    { key: 'reference_no', label: 'Reference No', render: (val: any) => val || '-' },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'id', label: 'Transaction ID' },
    { key: 'account_no', label: 'Account No', render: (val: any) => val || '-' },
    { key: 'full_name', label: 'Full Name', render: (val: any) => val || '-' },
    { key: 'contact_no', label: 'Contact No', render: (val: any) => val || '-' },
    { key: 'payment_method', label: 'Payment Method', render: (val: any) => val || '-' },
    { key: 'updated_by_user', label: 'Modified By', render: (val: any) => val || '-' },
    {
      key: 'updated_at',
      label: 'Modified Date',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'transaction_type', label: 'Transaction Type', render: (val: any) => val || '-' },
    {
      key: 'payment_date',
      label: 'Payment Date',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'barangay', label: 'Barangay', render: (val: any) => val || '-' },
    { key: 'city', label: 'City', render: (val: any) => val || '-' },
    { key: 'account_balance_before', label: 'Account Balance', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` }
  ] as TableColumn[],

  staggered: [
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    { key: 'id', label: 'ID' },
    { key: 'account_no', label: 'Account No', render: (val: any) => val || '-' },
    { key: 'staggered_install_no', label: 'Install No', render: (val: any) => val || '-' },
    {
      key: 'staggered_date',
      label: 'Date',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'staggered_balance', label: 'Balance', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'months_to_pay', label: 'Months', render: (val: any) => val || 0 },
    { key: 'monthly_payment', label: 'Monthly', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'modified_by', label: 'Modified By', render: (val: any) => val || '-' },
    {
      key: 'modified_date',
      label: 'Modified Date',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'user_email', label: 'User Email', render: (val: any) => val || '-' },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' }
  ] as TableColumn[],

  discounts: [
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    { key: 'id', label: 'ID' },
    { key: 'account_no', label: 'Account No', render: (val: any) => val || '-' },
    { key: 'invoice_used_id', label: 'Invoice ID', render: (val: any) => val || '-' },
    { key: 'discount_amount', label: 'Discount', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'remaining', label: 'Remaining', render: (val: any) => val || 0 },
    {
      key: 'used_date',
      label: 'Used Date',
      render: (val: any) => formatDateTime(val)
    },
    {
      key: 'processed_date',
      label: 'Processed',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'processed_by_user_id', label: 'Processed By', render: (val: any) => val || '-' },
    { key: 'approved_by_user_id', label: 'Approved By', render: (val: any) => val || '-' },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'created_at', label: 'Created At', render: (val: any) => formatDateTime(val) },
    { key: 'created_by_user_id', label: 'Created By', render: (val: any) => val || '-' },
    { key: 'updated_at', label: 'Updated At', render: (val: any) => formatDateTime(val) },
    { key: 'updated_by_user_id', label: 'Updated By', render: (val: any) => val || '-' }
  ] as TableColumn[],

  serviceOrders: [
    {
      key: 'updated_at',
      label: 'Modified Date',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'concern', label: 'Concern', render: (val: any) => val || '-' },
    { key: 'concern_remarks', label: 'Concern Remarks', render: (val: any) => val || '-' },
    { key: 'support_status', label: 'Support Status', render: (val: any) => val || '-' },
    { key: 'visit_status', label: 'Visit Status', render: (val: any) => val || '-' },
    { key: 'requested_by', label: 'Requested By', render: (val: any) => val || '-' },
    { key: 'assigned_email', label: 'Assigned Email', render: (val: any) => val || '-' },
    {
      key: 'timestamp',
      label: 'Timestamp',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'account_no', label: 'Account No', render: (val: any) => val || '-' },
    {
      key: 'date_installed',
      label: 'Date Installed',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'full_name', label: 'Full Name', render: (val: any) => val || '-' },
    { key: 'contact_number', label: 'Contact Number', render: (val: any) => val || '-' },
    { key: 'email_address', label: 'Email Address', render: (val: any) => val || '-' },
    { key: 'address', label: 'Address', render: (val: any) => val || '-' },
    { key: 'plan', label: 'Plan', render: (val: any) => val || '-' },
    { key: 'provider', label: 'Provider', render: (val: any) => val || '-' },
    { key: 'username', label: 'Username', render: (val: any) => val || '-' },
    { key: 'connection_type', label: 'Connection Type', render: (val: any) => val || '-' },
    { key: 'old_router_modem_sn', label: 'Router/Modem SN', render: (val: any) => val || '-' },
    { key: 'old_lcp', label: 'LCP', render: (val: any) => val || '-' },
    { key: 'old_nap', label: 'NAP', render: (val: any) => val || '-' },
    { key: 'old_port', label: 'Port', render: (val: any) => val || '-' },
    { key: 'old_vlan', label: 'VLAN', render: (val: any) => val || '-' },
    { key: 'visit_by_user', label: 'Visit By', render: (val: any) => val || '-' },
    { key: 'visit_with', label: 'Visit With', render: (val: any) => val || '-' },
    { key: 'visit_with_other', label: 'Visit With Other', render: (val: any) => val || '-' },
    { key: 'visit_remarks', label: 'Visit Remarks', render: (val: any) => val || '-' },
    { key: 'updated_by_user', label: 'Modified By', render: (val: any) => val || '-' },
    { key: 'start_time', label: 'Start Time', render: (val: any) => val || '-' },
    { key: 'end_time', label: 'End Time', render: (val: any) => val || '-' },
    {
      key: 'duration',
      label: 'Duration',
      render: (_val: any, row: any) => {
        if (!row.start_time || !row.end_time) return '-';
        try {
          // Assuming format is time string like "HH:mm:ss" or full date string
          const start = new Date(row.start_time.includes(':') && !row.start_time.includes('-') ? `1970-01-01T${row.start_time}` : row.start_time);
          const end = new Date(row.end_time.includes(':') && !row.end_time.includes('-') ? `1970-01-01T${row.end_time}` : row.end_time);
          if (isNaN(start.getTime()) || isNaN(end.getTime())) return '-';
          const diffMs = end.getTime() - start.getTime();
          const diffHrs = Math.floor(diffMs / 3600000);
          const diffMins = Math.floor((diffMs % 3600000) / 60000);
          return `${diffHrs}h ${diffMins}m`;
        } catch (e) {
          return '-';
        }
      }
    },
    { key: 'repair_category', label: 'Repair Category', render: (val: any) => val || '-' },
    { key: 'new_router_modem_sn', label: 'New Router/Modem SN', render: (val: any) => val || '-' },
    { key: 'new_lcp', label: 'New LCP', render: (val: any) => val || '-' },
    { key: 'new_nap', label: 'New NAP', render: (val: any) => val || '-' },
    { key: 'new_port', label: 'New Port', render: (val: any) => val || '-' },
    { key: 'new_vlan', label: 'New VLAN', render: (val: any) => val || '-' },
    { key: 'router_model', label: 'Router Model', render: (val: any) => val || '-' },
    { key: 'client_signature_url', label: 'Client Signature', render: (val: any) => val ? 'View' : '-' },
    { key: 'new_plan', label: 'New Plan', render: (val: any) => val || '-' },
    { key: 'support_remarks', label: 'Support Remarks', render: (val: any) => val || '-' },
    { key: 'service_charge', label: 'Service Charge', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'barangay', label: 'Barangay', render: (val: any) => val || '-' },
    { key: 'city', label: 'City', render: (val: any) => val || '-' },
  ] as TableColumn[],

  reconnectionLogs: [
    { key: 'created_at', label: 'Created At', render: (val: any) => formatDateTime(val) },
    { key: 'id', label: 'ID' },
    { key: 'account_id', label: 'Account ID', render: (val: any) => val || '-' },
    { key: 'session_id', label: 'Session ID', render: (val: any) => val || '-' },
    { key: 'username', label: 'Username', render: (val: any) => val || '-' },
    { key: 'plan_id', label: 'Plan ID', render: (val: any) => val || '-' },
    { key: 'reconnection_fee', label: 'Fee', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'created_by_user', label: 'Created By', render: (val: any) => val || '-' },
    { key: 'updated_at', label: 'Updated At', render: (val: any) => formatDateTime(val) },
    { key: 'updated_by_user', label: 'Updated By', render: (val: any) => val || '-' }
  ] as TableColumn[],

  disconnectedLogs: [
    { key: 'created_at', label: 'Created At', render: (val: any) => formatDateTime(val) },
    { key: 'id', label: 'ID' },
    { key: 'account_id', label: 'Account ID', render: (val: any) => val || '-' },
    { key: 'session_id', label: 'Session ID', render: (val: any) => val || '-' },
    { key: 'username', label: 'Username', render: (val: any) => val || '-' },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'created_by_user', label: 'Created By', render: (val: any) => val || '-' },
    { key: 'updated_at', label: 'Updated At', render: (val: any) => formatDateTime(val) },
    { key: 'updated_by_user', label: 'Updated By', render: (val: any) => val || '-' }
  ] as TableColumn[],

  detailsUpdateLogs: [
    { key: 'id', label: 'ID' },
    { key: 'old_details', label: 'Old Details', render: (val: any, row: any) => renderDetailsJson(val, row, 'old_details'), className: 'min-w-[300px]' },
    { key: 'new_details', label: 'New Details', render: (val: any, row: any) => renderDetailsJson(val, row, 'new_details'), className: 'min-w-[300px]' },
    { key: 'created_at', label: 'Created At', render: (val: any) => formatDateTime(val) },
    { key: 'created_by_user', label: 'Created By', render: (val: any) => val || '-' },
    { key: 'updated_at', label: 'Updated At', render: (val: any) => formatDateTime(val) },
    { key: 'updated_by_user', label: 'Updated By', render: (val: any) => val || '-' }
  ] as TableColumn[],

  planChangeLogs: [
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    { key: 'id', label: 'ID' },
    { key: 'account_id', label: 'Account ID', render: (val: any) => val || '-' },
    { key: 'old_plan_id', label: 'Old Plan ID', render: (val: any) => val || '-' },
    { key: 'new_plan_id', label: 'New Plan ID', render: (val: any) => val || '-' },
    {
      key: 'date_changed',
      label: 'Date Changed',
      render: (val: any) => formatDateTime(val)
    },
    {
      key: 'date_used',
      label: 'Date Used',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'created_at', label: 'Created At', render: (val: any) => formatDateTime(val) },
    { key: 'created_by_user', label: 'Created By', render: (val: any) => val || '-' },
    { key: 'updated_at', label: 'Updated At', render: (val: any) => formatDateTime(val) },
    { key: 'updated_by_user', label: 'Updated By', render: (val: any) => val || '-' }
  ] as TableColumn[],

  serviceChargeLogs: [
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    { key: 'id', label: 'ID' },
    { key: 'account_no', label: 'Account No', render: (val: any) => val || '-' },
    { key: 'service_order_id', label: 'SO ID', render: (val: any) => val || '-' },
    { key: 'service_charge', label: 'Svc Charge', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    {
      key: 'date_used',
      label: 'Date Used',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'created_at', label: 'Created At', render: (val: any) => formatDateTime(val) },
    { key: 'created_by', label: 'Created By', render: (val: any) => val || '-' },
    { key: 'updated_at', label: 'Updated At', render: (val: any) => formatDateTime(val) },
    { key: 'updated_by', label: 'Updated By', render: (val: any) => val || '-' },
    { key: 'invoice_id', label: 'Invoice ID', render: (val: any) => val || '-' },
    { key: 'service_charge_type', label: 'Charge Type', render: (val: any) => val || '-' }
  ] as TableColumn[],

  changeDueLogs: [
    { key: 'id', label: 'ID' },
    { key: 'account_id', label: 'Account ID', render: (val: any) => val || '-' },
    { key: 'previous_date', label: 'Prev Date', render: (val: any) => formatDateTime(val) },
    { key: 'changed_date', label: 'Changed Date', render: (val: any) => formatDateTime(val) },
    { key: 'added_balance', label: 'Added Bal', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'created_at', label: 'Created At', render: (val: any) => formatDateTime(val) },
    { key: 'created_by_user_id', label: 'Created By', render: (val: any) => val || '-' },
    { key: 'updated_at', label: 'Updated At', render: (val: any) => formatDateTime(val) },
    { key: 'updated_by_user_id', label: 'Updated By', render: (val: any) => val || '-' }
  ] as TableColumn[],

  securityDeposits: [
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    { key: 'id', label: 'ID' },
    { key: 'account_id', label: 'Account ID', render: (val: any) => val || '-' },
    { key: 'amount', label: 'Amount', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    {
      key: 'payment_date',
      label: 'Payment Date',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'reference_no', label: 'Ref No', render: (val: any) => val || '-' },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'created_by', label: 'Created By', render: (val: any) => val || '-' },
    { key: 'created_at', label: 'Created At', render: (val: any) => formatDateTime(val) },
    { key: 'updated_at', label: 'Updated At', render: (val: any) => formatDateTime(val) }
  ] as TableColumn[],

  statementOfAccounts: [
    {
      key: 'statement_date',
      label: 'Statement Date',
      render: (val: any) => formatDate(val)
    },
    {
      key: 'due_date',
      label: 'Due Date',
      render: (val: any) => formatDate(val)
    },
    { key: 'balance_from_previous_bill', label: 'Balance From Previous Bill', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'amount_due', label: 'Amount Due', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'total_amount_due', label: 'Total Amount Due', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'statement_no', label: 'Statement No', render: (val: any) => val || '-' },
    { key: 'full_name', label: 'Full Name', render: (val: any) => val || '-' },
    { key: 'account_no', label: 'Account No', render: (val: any) => val || '-' },
    {
      key: 'date_installed',
      label: 'Date Installed',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'email_address', label: 'Email Address', render: (val: any) => val || '-' },
    { key: 'plan', label: 'Plan', render: (val: any) => val || '-' },
    { key: 'payment_received_previous', label: 'Payment Received From Previous Bill', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'remaining_balance_previous', label: 'Remaining Balance From Previous Bill', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'monthly_service_fee', label: 'Monthly Service Fee', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'vat', label: 'VAT', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'address', label: 'Address', render: (val: any) => val || '-' },
    { key: 'staggered', label: 'Staggered', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'service_charge', label: 'Service Charge', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'discounts', label: 'Discounts', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'rebate', label: 'Rebates', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    {
      key: 'disconnection_date',
      label: 'Disconnection Date',
      render: (val: any) => formatDateTime(val)
    },
    {
      key: 'updated_at',
      label: 'Modified Date',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'print_link', label: 'Print Link', render: (val: any) => val ? 'View' : '-' },
    { key: 'barangay', label: 'Barangay', render: (val: any) => val || '-' },
    { key: 'city', label: 'City', render: (val: any) => val || '-' },
    { key: 'region', label: 'Region', render: (val: any) => val || '-' }
  ] as TableColumn[],

  inventoryLogs: [
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    {
      key: 'date',
      label: 'Date',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'item_name', label: 'Item', render: (val: any) => val || '-' },
    { key: 'item_description', label: 'Description', render: (val: any) => val || '-' },
    { key: 'log_type', label: 'Type', render: (val: any) => val || '-' },
    { key: 'item_quantity', label: 'Qty', render: (val: any) => val || 0 },
    { key: 'sn', label: 'Serial No', render: (val: any) => val || '-' },
    { key: 'requested_by', label: 'Requested By', render: (val: any) => val || '-' },
    { key: 'requested_with', label: 'Requested With', render: (val: any) => val || '-' },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'user_email', label: 'User Email', render: (val: any) => val || '-' }
  ] as TableColumn[],

  borrowedLogs: [
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    {
      key: 'date',
      label: 'Date',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'borrowed_by', label: 'Borrowed By', render: (val: any) => val || '-' },
    { key: 'item_quantity', label: 'Quantity', render: (val: any) => val || 0 },
  ] as TableColumn[],

  jobOrders: [
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    { key: 'job_order_no', label: 'JO No.', render: (val: any) => val || '-' },
    { key: 'customer_name', label: 'Customer', render: (val: any) => val || '-' },
    { key: 'item_quantity', label: 'Quantity', render: (val: any) => val || 0 },
    {
      key: 'created_at',
      label: 'Date',
      render: (val: any) => formatDateTime(val)
    }
  ] as TableColumn[],

  defectiveLogs: [
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    {
      key: 'date',
      label: 'Date',
      render: (val: any) => formatDateTime(val)
    },
    { key: 'reported_by', label: 'Reported By', render: (val: any) => val || '-' },
    { key: 'item_quantity', label: 'Qty', render: (val: any) => val || 0 },
    { key: 'defect_type', label: 'Type', render: (val: any) => val || '-' },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'sn', label: 'Serial No', render: (val: any) => val || '-' }
  ] as TableColumn[],

  applications: [
    { key: 'id', label: 'ID' },
    { key: 'timestamp', label: 'Timestamp', render: (val: any) => formatDateTime(val) },
    { key: 'first_name', label: 'First Name', render: (val: any) => val || '-' },
    { key: 'middle_initial', label: 'Middle Initial', render: (val: any) => val || '-' },
    { key: 'last_name', label: 'Last Name', render: (val: any) => val || '-' },
    { key: 'email_address', label: 'Email Address', render: (val: any) => val || '-' },
    { key: 'mobile_number', label: 'Mobile Number', render: (val: any) => val || '-' },
    { key: 'secondary_mobile_number', label: 'Secondary Mobile', render: (val: any) => val || '-' },
    { key: 'installation_address', label: 'Installation Address', render: (val: any) => val || '-' },
    { key: 'landmark', label: 'Landmark', render: (val: any) => val || '-' },
    { key: 'barangay', label: 'Barangay', render: (val: any) => val || '-' },
    { key: 'city', label: 'City', render: (val: any) => val || '-' },
    { key: 'region', label: 'Region', render: (val: any) => val || '-' },
    { key: 'location', label: 'Location Coordinates', render: (val: any) => val || '-' },
    { key: 'desired_plan', label: 'Desired Plan', render: (val: any) => val || '-' },
    { key: 'promo', label: 'Promo', render: (val: any) => val || '-' },
    { key: 'referred_by', label: 'Referred By', render: (val: any) => val || '-' },
    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
    { key: 'pppoe_username', label: 'PPPoE Username', render: (val: any) => val || '-' },
    { key: 'created_at', label: 'Created At', render: (val: any) => formatDateTime(val) },
    { key: 'updated_at', label: 'Updated At', render: (val: any) => formatDateTime(val) }
  ] as TableColumn[],

  customerJobOrders: [
    { key: 'id', label: 'ID' },
    { key: 'application_id', label: 'Application ID' },
    { key: 'status', label: 'Status' },
    { key: 'timestamp', label: 'Timestamp', render: (val: any) => formatDateTime(val) },
    { key: 'date_installed', label: 'Date Installed', render: (val: any) => formatDate(val) },
    { key: 'installation_fee', label: 'Installation Fee', render: (val: any) => `₱${parseFloat(val || '0').toFixed(2)}` },
    { key: 'billing_day', label: 'Billing Day' },
    { key: 'billing_status', label: 'Billing Status' },
    { key: 'modem_router_sn', label: 'Modem Router SN' },
    { key: 'router_model', label: 'Router Model' },
    { key: 'group_name', label: 'Group Name' },
    { key: 'lcpnap', label: 'LCP/NAP' },
    { key: 'port', label: 'Port' },
    { key: 'vlan', label: 'VLAN' },
    { key: 'username', label: 'Username' },
    { key: 'ip_address', label: 'IP Address' },
    { key: 'connection_type', label: 'Connection Type' },
    { key: 'usage_type', label: 'Usage Type' },
    { key: 'onsite_status', label: 'Onsite Status' },
    { key: 'assigned_email', label: 'Assigned Email' },
    { key: 'status_remarks', label: 'Status Remarks' },
    { key: 'onsite_remarks', label: 'Onsite Remarks' },
    { key: 'address_coordinates', label: 'Address Coordinates' },
    { key: 'pppoe_username', label: 'PPPoE Username' },
    { key: 'created_by_user_email', label: 'Created By' },
    { key: 'updated_by_user_email', label: 'Updated By' },
    { key: 'technicians', label: 'Technicians', render: (val: any) => Array.isArray(val) ? val.join(', ') : val },
    { key: 'commission_status', label: 'Commission Status' }
  ] as TableColumn[],
};
