import { Layout } from 'react-grid-layout';

export type ViewType = 'bar' | 'line' | 'pie' | 'doughnut' | 'list' | 'grid' | 'table';
export type ScopeType = 'overall' | 'today' | 'weekly' | '3weeks' | 'monthly' | '3months' | 'yearly' | 'custom';

export interface WidgetData {
  label: string;
  value?: number | string;
  series?: Record<string, number | string>;
}

export interface WidgetResponse {
  status: 'success' | 'error' | 'empty';
  data?: any;
  message?: string;
  barangays?: Array<{ Name: string }>;
}

export interface WidgetState {
  viewType: ViewType;
  scope: ScopeType;
  year?: string;
  bgy?: string; // "All" or barangay name
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  visible: boolean;
  layout?: Layout;
  fontSize?: number; // per-widget font size
  paymentMode?: 'type' | 'months'; // For Payment Methods widget
  customStartTime?: string; // HH:mm format
  // Detailed-queue "Type" filter. Holds the full type string a row carries
  // ("Installation (Joborder)", "No Internet (Service Order)") or undefined /
  // 'all' for no filter. Applied client-side to rows already fetched, so it
  // never has to agree with anything the server does.
  typeFilter?: string;
  isEditingGrid?: boolean; // For specialized grid editing
  gridCols?: number; // Internal grid columns
  gridRows?: number; // Internal grid rows
}

export type FilterType =
  | 'none'
  | 'year'
  | 'bgy_only'
  | 'toggle_today'
  | 'date'
  | 'date_bgy';

export interface WidgetConfig {
  title: string;

  // backend: action + param (your controller uses action and param)
  api: string;   // e.g. "billing_status"
  param?: string;

  // UI sizing
  w: number;
  h?: number;

  // filters
  hasFilters?: boolean;
  filterType?: FilterType;
}

export interface DashboardTemplate {
  id: number;
  template_name: string;
  layout_data: string;
  style_data: string;
  created_at: string;
  updated_at?: string;
}

export const CHART_COLORS = [
  '#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6',
  '#7c3aed', '#ec4899', '#64748b', '#22c55e', '#3b82f6', '#eab308',
];

// Widgets that should display currency formatting in tooltips/list
export const CURRENCY_WIDGETS: string[] = [
  'pay_method_mon',
  'invoice_mon_amount',
  'transactions_mon_amount',
  'portal_mon_amount',
];

export const DEFAULT_VISIBLE_WIDGETS: string[] = [
  'billing_status',
  'online_status',
  'app_status',
  'jo_status',
  'so_status',
  'queue_jo',
  'queue_so',
  'tech_live_location',
];

// IMPORTANT: keys here are widget IDs used by your UI
export const WIDGETS: Record<string, WidgetConfig> = {
  billing_status: {
    title: 'Billing Status',
    api: 'billing_status',
    param: '',
    w: 4,
    h: 6,
    hasFilters: true,
    filterType: 'bgy_only',
  },
  online_status: {
    title: 'Online Status',
    api: 'online_status',
    param: '',
    w: 4,
    h: 6,
    hasFilters: false,
    filterType: 'none',
  },
  app_status: {
    title: 'Application Status',
    api: 'app_status',
    param: '',
    w: 4,
    h: 6,
    hasFilters: true,
    filterType: 'date_bgy',
  },
  jo_status: {
    title: 'Job Orders Status',
    api: 'jo_status',
    param: 'onsite',
    w: 4,
    h: 6,
    hasFilters: true,
    filterType: 'date',
  },
  so_status: {
    title: 'Service Orders Status',
    api: 'so_status',
    param: 'visit',
    w: 4,
    h: 6,
    hasFilters: true,
    filterType: 'date_bgy',
  },
  queue_jo: {
    title: 'Queue Monitor (JO)',
    api: 'queue_mon',
    param: 'jo',
    w: 4,
    h: 6,
    hasFilters: true,
    filterType: 'date_bgy',
  },
  queue_so: {
    title: 'Queue Monitor (SO)',
    api: 'queue_mon',
    param: 'so',
    w: 4,
    h: 6,
    hasFilters: true,
    filterType: 'date_bgy',
  },
  tech_jo: {
    title: 'Tech Performance (JO)',
    api: 'tech_mon_jo',
    param: '',
    w: 6,
    h: 7,
    hasFilters: true,
    filterType: 'date',
  },
  tech_so: {
    title: 'Tech Performance (SO)',
    api: 'tech_mon_so',
    param: '',
    w: 6,
    h: 7,
    hasFilters: true,
    filterType: 'date',
  },

  // Yearly stacked charts (count)
  invoice_mon_count: {
    title: 'Invoices (Yearly Count)',
    api: 'invoice_mon',
    param: 'count',
    w: 6,
    h: 7,
    hasFilters: true,
    filterType: 'year',
  },
  transactions_mon_count: {
    title: 'Transactions (Yearly Count)',
    api: 'transactions_mon',
    param: 'count',
    w: 6,
    h: 7,
    hasFilters: true,
    filterType: 'year',
  },
  portal_mon_count: {
    title: 'Portal Logs (Yearly Count)',
    api: 'portal_mon',
    param: 'count',
    w: 6,
    h: 7,
    hasFilters: true,
    filterType: 'year',
  },

  // Yearly stacked charts (amount)
  invoice_mon_amount: {
    title: 'Invoices (Yearly Amount)',
    api: 'invoice_mon',
    param: 'amount',
    w: 6,
    h: 7,
    hasFilters: true,
    filterType: 'year',
  },
  transactions_mon_amount: {
    title: 'Transactions (Yearly Amount)',
    api: 'transactions_mon',
    param: 'amount',
    w: 6,
    h: 7,
    hasFilters: true,
    filterType: 'year',
  },
  portal_mon_amount: {
    title: 'Portal Logs (Yearly Amount)',
    api: 'portal_mon',
    param: 'amount',
    w: 6,
    h: 7,
    hasFilters: true,
    filterType: 'year',
  },

  pay_method_mon: {
    title: 'Payment Methods(Manual Transactions)',
    api: 'pay_method_mon',
    param: '',
    w: 4,
    h: 6,
    hasFilters: true,
    filterType: 'date',
  },
  jo_refer_rank: {
    title: 'Top Referrers (JO Done)',
    api: 'jo_refer_rank',
    param: '',
    w: 4,
    h: 6,
    hasFilters: true,
    filterType: 'date',
  },
  invoice_overall: {
    title: 'Invoices Overall Status',
    api: 'invoice_overall',
    param: '',
    w: 4,
    h: 6,
    hasFilters: false,
    filterType: 'none',
  },
  tech_availability: {
    title: 'Technician Availability',
    api: 'technician_availability',
    param: '',
    w: 12, // Full width
    h: 12,
    hasFilters: true,
    filterType: 'none',
  },
  team_detailed_queue: {
    title: 'Team Detailed Queue',
    api: 'team_detailed_queue',
    param: '',
    w: 12, // Full width table
    h: 8,
    hasFilters: true,
    filterType: 'toggle_today',
  },
  agent_detailed_queue: {
    title: 'Agent Detailed Queue',
    api: 'agent_detailed_queue',
    param: '',
    w: 12, // Full width table
    h: 8,
    hasFilters: true,
    filterType: 'toggle_today',
  },
  tech_live_location: {
    title: 'Technician Live Location',
    api: 'tech_live_location',
    param: '',
    w: 12, // Full width map
    h: 12,
    hasFilters: false,
    filterType: 'none',
  },
};
