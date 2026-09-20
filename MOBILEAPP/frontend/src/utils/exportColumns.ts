/**
 * Export column sets for the order pages, ported from the web build.
 *
 * The web tables let the reader tick columns on and off and export whatever is
 * ticked, in the order shown. A card list has no column picker, so the mobile
 * export sends every column — which is what the web produces when nothing is
 * unticked, and the safer default for a spreadsheet nobody can re-run from a
 * phone.
 *
 * Values are read through the same dual-spelling fallbacks the web uses: the
 * API has been seen sending `Timestamp` and `timestamp`, `PORT` and `port`, and
 * a column that reads one spelling only exports blanks for half the rows.
 *
 * Everything here returns a plain string. The web renderer returns React nodes
 * for the status columns, which is right for a table cell and useless in a CSV.
 */

export interface ExportColumn {
  key: string;
  label: string;
}

/** A missing value is a dash, matching the web export. */
const val = (v: any): string => {
  if (v === null || v === undefined) return '-';
  const s = String(v).trim();
  return s === '' ? '-' : s;
};

/** First non-empty of several spellings. */
const pick = (...candidates: any[]): string => {
  for (const c of candidates) {
    if (c !== null && c !== undefined && String(c).trim() !== '') return String(c);
  }
  return '-';
};

const dateTime = (v: any): string => {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const dateOnly = (v: any): string => {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
};

const peso = (v: any): string => {
  const n = Number(v);
  if (v === null || v === undefined || isNaN(n)) return '-';
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** Elapsed time between two stamps, as the order pages show it. */
const duration = (start: any, end: any): string => {
  if (!start) return '-';
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  if (isNaN(from) || isNaN(to) || to < from) return '-';
  const mins = Math.floor((to - from) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// ── Job Orders ────────────────────────────────────────────────────────────

export const JOB_ORDER_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'dateInstalled', label: 'Date Installed' },
  { key: 'referredBy', label: 'Referred By' },
  { key: 'fullName', label: 'Full Name of Client' },
  { key: 'address', label: 'Full Address of Client' },
  { key: 'onsiteStatus', label: 'Onsite Status' },
  { key: 'billingStatus', label: 'Billing Status' },
  { key: 'assignedEmail', label: 'Assigned Tech' },
  { key: 'billingDay', label: 'Billing Day' },
  { key: 'installationFee', label: 'Installation Fee' },
  { key: 'modifiedBy', label: 'Modified By' },
  { key: 'modifiedDate', label: 'Modified Date' },
  { key: 'modemRouterSN', label: 'Modem/Router SN' },
  { key: 'routerModel', label: 'Router Model' },
  { key: 'groupName', label: 'Group Name' },
  { key: 'lcpnap', label: 'LCPNAP' },
  { key: 'port', label: 'PORT' },
  { key: 'vlan', label: 'VLAN' },
  { key: 'username', label: 'Username' },
  { key: 'ipAddress', label: 'IP Address' },
  { key: 'connectionType', label: 'Connection Type' },
  { key: 'usageType', label: 'Usage Type' },
  { key: 'usernameStatus', label: 'Username Status' },
  { key: 'visitBy', label: 'Visit By' },
  { key: 'visitWith', label: 'Visit With' },
  { key: 'visitWithOther', label: 'Visit With Other' },
  { key: 'onsiteRemarks', label: 'Onsite Remarks' },
  { key: 'statusRemarks', label: 'Status Remarks' },
  { key: 'addressCoordinates', label: 'Address Coordinates' },
  { key: 'contractLink', label: 'Contract Link' },
  { key: 'startTimestamp', label: 'Start Time' },
  { key: 'endTimestamp', label: 'End Time' },
  { key: 'createdAt', label: 'Created At' },
  { key: 'createdByUserEmail', label: 'Created By' },
  { key: 'updatedAt', label: 'Updated At' },
  { key: 'updatedByUserEmail', label: 'Updated By' },
];

export const jobOrderExportValue = (jo: any, key: string): string => {
  switch (key) {
    case 'timestamp': return dateTime(jo.Timestamp || jo.timestamp);
    case 'dateInstalled': return dateOnly(jo.Date_Installed || jo.date_installed);
    case 'referredBy': return pick(jo.Referred_By, jo.referred_by);
    case 'fullName': return pick(
      jo.fullName,
      [jo.First_Name || jo.first_name, jo.Middle_Initial || jo.middle_initial, jo.Last_Name || jo.last_name]
        .filter(Boolean).join(' ').trim(),
    );
    case 'address': return pick(
      jo.address,
      [jo.Installation_Address || jo.installation_address, jo.Barangay || jo.barangay,
       jo.City || jo.city, jo.Region || jo.region].filter(Boolean).join(', '),
    );
    case 'onsiteStatus': return pick(jo.Onsite_Status, jo.onsite_status);
    case 'billingStatus': return pick(jo.billing_status, jo.Billing_Status);
    case 'assignedEmail': return pick(jo.Assigned_Email, jo.assigned_email);
    case 'billingDay': {
      const d = jo.Billing_Day ?? jo.billing_day;
      if (d === null || d === undefined) return '-';
      const n = Number(d);
      if (isNaN(n)) return '-';
      // 0 means "last day of the month", as the web renders it.
      return n === 0 ? String(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) : String(n);
    }
    case 'installationFee': return peso(jo.Installation_Fee ?? jo.installation_fee);
    case 'modifiedBy': return pick(jo.Modified_By, jo.modified_by);
    case 'modifiedDate': return dateTime(jo.Modified_Date || jo.modified_date);
    case 'modemRouterSN': return pick(jo.Modem_Router_SN, jo.modem_router_sn);
    case 'routerModel': return pick(jo.Router_Model, jo.router_model);
    case 'groupName': return pick(jo.group_name, jo.Group_Name);
    case 'lcpnap': return pick(jo.LCPNAP, jo.lcpnap);
    case 'port': return pick(jo.PORT, jo.Port, jo.port);
    case 'vlan': return pick(jo.VLAN, jo.vlan);
    case 'username': return pick(jo.Username, jo.username);
    case 'ipAddress': return pick(jo.IP_Address, jo.ip_address, jo.IP, jo.ip);
    case 'connectionType': return pick(jo.Connection_Type, jo.connection_type);
    case 'usageType': return pick(jo.Usage_Type, jo.usage_type);
    case 'usernameStatus': return pick(jo.username_status, jo.Username_Status);
    case 'visitBy': return pick(jo.Visit_By, jo.visit_by);
    case 'visitWith': return pick(jo.Visit_With, jo.visit_with);
    case 'visitWithOther': return pick(jo.Visit_With_Other, jo.visit_with_other);
    case 'onsiteRemarks': return pick(jo.Onsite_Remarks, jo.onsite_remarks);
    case 'statusRemarks': return pick(jo.Status_Remarks, jo.status_remarks);
    case 'addressCoordinates': return pick(jo.Address_Coordinates, jo.address_coordinates);
    case 'contractLink': return pick(jo.Contract_Link, jo.contract_link);
    case 'startTimestamp': return dateTime(jo.StartTimeStamp || jo.start_timestamp || jo.start_time);
    case 'endTimestamp': return dateTime(jo.EndTimeStamp || jo.end_timestamp || jo.end_time);
    case 'createdAt': return dateTime(jo.created_at || jo.Created_At);
    case 'createdByUserEmail': return pick(jo.created_by_user_email, jo.Created_By_User_Email);
    case 'updatedAt': return dateTime(jo.updated_at || jo.Updated_At);
    case 'updatedByUserEmail': return pick(jo.updated_by_user_email, jo.Updated_By_User_Email);
    default: return '-';
  }
};

// ── Service Orders ────────────────────────────────────────────────────────

/**
 * Account No leads, as it does in the web export — the table does not show the
 * column but a spreadsheet without it cannot be matched to an account.
 */
export const SERVICE_ORDER_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'accountNumber', label: 'Account No' },
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'contactNumber', label: 'Contact Number' },
  { key: 'fullAddress', label: 'Full Address' },
  { key: 'concern', label: 'Concern' },
  { key: 'concernRemarks', label: 'Concern Remarks' },
  { key: 'requestedBy', label: 'Requested By' },
  { key: 'supportStatus', label: 'Support Status' },
  { key: 'assignedEmail', label: 'Assigned Tech' },
  { key: 'repairCategory', label: 'Repair Category' },
  { key: 'modifiedBy', label: 'Modified By' },
  { key: 'modifiedDate', label: 'Modified Date' },
  { key: 'startTime', label: 'Start Time' },
  { key: 'endTime', label: 'End Time' },
  { key: 'duration', label: 'Duration' },
  { key: 'visitStatus', label: 'Visit Status' },
  { key: 'visitStatusDate', label: 'Visit Status Date' },
];

export const serviceOrderExportValue = (so: any, key: string): string => {
  switch (key) {
    case 'accountNumber': return pick(so.accountNumber, so.account_no);
    case 'timestamp': return val(so.timestamp);
    case 'fullName': return val(so.fullName);
    case 'contactNumber': return val(so.contactNumber);
    case 'fullAddress': return val(so.fullAddress);
    case 'concern': return val(so.concern);
    case 'concernRemarks': return val(so.concernRemarks);
    case 'requestedBy': return val(so.requestedBy);
    case 'supportStatus': return val(so.supportStatus);
    case 'assignedEmail': return val(so.assignedEmail);
    case 'repairCategory': return val(so.repairCategory);
    case 'modifiedBy': return val(so.modifiedBy);
    case 'modifiedDate': return val(so.modifiedDate);
    case 'startTime': return dateTime(so.start_time);
    case 'endTime': return dateTime(so.end_time);
    case 'duration': return duration(so.start_time, so.end_time);
    case 'visitStatus': return val(so.visitStatus);
    case 'visitStatusDate': return val(so.visitStatusDate);
    default: return '-';
  }
};

// ── Work Orders ───────────────────────────────────────────────────────────

export const WORK_ORDER_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'id', label: 'ID' },
  { key: 'instructions', label: 'Instructions' },
  { key: 'work_category', label: 'Work Category' },
  { key: 'work_status', label: 'Status' },
  { key: 'assign_to', label: 'Assigned To' },
  { key: 'report_to', label: 'Report To' },
  { key: 'requested_by', label: 'Requested By' },
  { key: 'requested_date', label: 'Requested Date' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'updated_by', label: 'Updated By' },
  { key: 'updated_date', label: 'Updated Date' },
];

export const workOrderExportValue = (wo: any, key: string): string => {
  switch (key) {
    case 'id': return val(wo.id);
    case 'requested_date': return dateOnly(wo.requested_date);
    case 'updated_date': return dateOnly(wo.updated_date);
    default: return val(wo[key]);
  }
};
