import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronDown } from 'lucide-react';
import apiClient from '../config/api';
import { getRegions, getCities, City } from '../services/cityService';
import { barangayService, Barangay } from '../services/barangayService';
import { planService, Plan } from '../services/planService';
import { getAllLCPNAPs, LCPNAP } from '../services/lcpnapService';
import { getAllVLANs, VLAN } from '../services/vlanService';
import { getAllUsageTypes, UsageType } from '../services/usageTypeService';
import { getAllInventoryItems, InventoryItem } from '../services/inventoryItemService';
import { getUsedPorts } from '../services/portService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { userService } from '../services/userService';
import { agentService } from '../services/agentService';
import SearchableField from '../components/common/SearchableField';
import {
  buildAgentGroups,
  EMPTY_REFERRED_BY,
  ReferredBySelection,
  referredByForSave,
  selectionFromOption,
} from '../utils/referredByField';

interface AddCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after the customer was created and the success message dismissed. */
  onCreated: (result: CreatedCustomer) => void;
}

/** What POST /customers/direct answers with on success. */
export interface CreatedCustomer {
  customer_id: number;
  billing_account_id: number;
  account_no: string;
  full_name: string;
  billing_status: string;
  pppoe_username: string;
  pppoe_password: string;
  radius_group: string;
  radius_server: string;
  initial_billing_created: boolean;
}

// Keys match the API's field names, so a 422 lands on the right input as is.
interface FormState {
  first_name: string;
  middle_initial: string;
  last_name: string;
  email_address: string;
  contact_number_primary: string;
  contact_number_secondary: string;
  address: string;
  region: string;
  city: string;
  barangay: string;
  location: string;
  address_coordinates: string;
  housing_status: string;
  plan_id: string;
  generation_type: string;
  billing_day: string;
  date_installed: string;
  installation_fee: string;
  vat_enabled: boolean;
  withholding_enabled: boolean;
  withholding_percentage: string;
  connection_type: string;
  router_model: string;
  router_modem_sn: string;
  ip_address: string;
  lcpnap: string;
  port: string;
  vlan: string;
  usage_type: string;
  pppoe_username: string;
  pppoe_password: string;
}

const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyForm = (): FormState => ({
  first_name: '',
  middle_initial: '',
  last_name: '',
  email_address: '',
  contact_number_primary: '',
  contact_number_secondary: '',
  address: '',
  region: '',
  city: '',
  barangay: '',
  location: '',
  address_coordinates: '',
  housing_status: '',
  plan_id: '',
  generation_type: '',
  billing_day: '',
  date_installed: todayLocal(),
  installation_fee: '',
  vat_enabled: false,
  withholding_enabled: false,
  withholding_percentage: '',
  connection_type: '',
  router_model: '',
  router_modem_sn: '',
  ip_address: '',
  lcpnap: '',
  port: '',
  vlan: '',
  usage_type: '',
  pppoe_username: '',
  pppoe_password: '',
});

/**
 * SuperAdmin "+ Add Customer": creates a complete customer — customer, billing account, technical
 * details, online status, portal login — and its RADIUS account in one step, with no application
 * or job order (POST /customers/direct, DirectCustomerService on the server).
 *
 * Nothing is half-created: if the RADIUS account or any record fails, the server undoes the rest.
 */
const AddCustomerModal: React.FC<AddCustomerModalProps> = ({ isOpen, onClose, onCreated }) => {
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [referredBy, setReferredBy] = useState<ReferredBySelection>(EMPTY_REFERRED_BY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedCustomer | null>(null);
  // A second click while the first request is in flight is ignored, even before React re-renders
  // the button disabled.
  const submittingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [regions, setRegions] = useState<any[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [lcpnaps, setLcpnaps] = useState<LCPNAP[]>([]);
  const [vlans, setVlans] = useState<VLAN[]>([]);
  const [usageTypes, setUsageTypes] = useState<UsageType[]>([]);
  const [routerModels, setRouterModels] = useState<InventoryItem[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [usedPorts, setUsedPorts] = useState<Set<string>>(new Set());
  const [portAccounts, setPortAccounts] = useState<Record<string, string>>({});
  const [totalPorts, setTotalPorts] = useState<number>(32);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => setColorPalette(null));
  }, []);

  // A fresh form every time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setForm(emptyForm());
    setReferredBy(EMPTY_REFERRED_BY);
    setErrors({});
    setBanner(null);
    setCreated(null);
  }, [isOpen]);

  // Lookup lists. Loaded independently, so one failing list leaves the rest of the form usable.
  useEffect(() => {
    if (!isOpen) return;

    getRegions().then(r => setRegions(Array.isArray(r) ? r : [])).catch(() => setRegions([]));
    getCities().then(c => setCities(Array.isArray(c) ? c : [])).catch(() => setCities([]));
    barangayService.getAll()
      .then(res => setBarangays(res.success && Array.isArray(res.data) ? res.data : []))
      .catch(() => setBarangays([]));
    planService.getAllPlans().then(p => setPlans(Array.isArray(p) ? p : [])).catch(() => setPlans([]));
    getAllLCPNAPs('', 1, 1000)
      .then(res => setLcpnaps(res.success && Array.isArray(res.data) ? res.data : []))
      .catch(() => setLcpnaps([]));
    getAllVLANs()
      .then(res => setVlans(res.success && Array.isArray(res.data) ? res.data : []))
      .catch(() => setVlans([]));
    getAllUsageTypes()
      .then(res => setUsageTypes(res.success && Array.isArray(res.data) ? res.data : []))
      .catch(() => setUsageTypes([]));
    // Router models are inventory items in category 11, as on the Edit Technical Details form.
    getAllInventoryItems('', 1, 500)
      .then(res => setRouterModels(res.success && Array.isArray(res.data)
        ? res.data.filter((item: InventoryItem) => item.category_id === 11)
        : []))
      .catch(() => setRouterModels([]));
    // By role name, then by the Agent role id — the same fallback as the Customer Details form.
    userService.getUsersByRole('agent')
      .then(async res => {
        if (res.success && res.data) {
          setAgents(res.data);
          return;
        }
        const byId = await userService.getUsersByRoleId(4);
        setAgents(byId.success && byId.data ? byId.data : []);
      })
      .catch(() => setAgents([]));
    agentService.getAllAgents()
      .then(res => setTeams(res.success && res.data ? res.data : []))
      .catch(() => setTeams([]));
  }, [isOpen]);

  // Ports already taken on the chosen LCP-NAP.
  useEffect(() => {
    if (!isOpen || !form.lcpnap) {
      setUsedPorts(new Set());
      setPortAccounts({});
      setTotalPorts(32);
      return;
    }

    getUsedPorts(form.lcpnap)
      .then(res => {
        if (res.success && res.data) {
          setUsedPorts(new Set(res.data.used));
          setPortAccounts(res.data.port_accounts || {});
          setTotalPorts(res.data.total || 32);
        }
      })
      .catch(() => setUsedPorts(new Set()));
  }, [isOpen, form.lcpnap]);

  const filteredCities = useMemo(() => {
    const region = regions.find((r: any) => r.name === form.region);
    return region ? cities.filter(c => c.region_id === region.id) : [];
  }, [regions, cities, form.region]);

  const filteredBarangays = useMemo(() => {
    const city = cities.find(c => c.name === form.city);
    return city ? barangays.filter(b => b.city_id === city.id) : [];
  }, [cities, barangays, form.city]);

  const groupedAgents = useMemo(() => buildAgentGroups(agents, teams), [agents, teams]);

  const isPostpaid = form.generation_type === 'Postpaid';
  const isFiber = form.connection_type === 'Fiber';
  const needsIp = form.connection_type === 'Antenna' || form.connection_type === 'Local';

  const set = (field: keyof FormState, value: string | boolean) => {
    setForm(prev => {
      const next = { ...prev, [field]: value } as FormState;

      if (field === 'region') {
        next.city = '';
        next.barangay = '';
      } else if (field === 'city') {
        next.barangay = '';
      } else if (field === 'lcpnap') {
        next.port = '';
      } else if (field === 'withholding_enabled' && value === false) {
        next.withholding_percentage = '';
      } else if (field === 'connection_type') {
        // The same clearing as Edit Technical Details: Fiber has no IP field, Antenna and Local
        // have no LCP-NAP, Port or VLAN.
        if (value === 'Fiber') {
          next.ip_address = '';
        } else {
          next.lcpnap = '';
          next.port = '';
          next.vlan = '';
        }
      }

      return next;
    });

    if (errors[field]) {
      setErrors(prev => {
        const { [field]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    const required: Array<[keyof FormState, string]> = [
      ['first_name', 'First Name'],
      ['last_name', 'Last Name'],
      ['email_address', 'Email'],
      ['contact_number_primary', 'Contact Number'],
      ['address', 'Address'],
      ['region', 'Region'],
      ['city', 'City'],
      ['barangay', 'Barangay'],
      ['plan_id', 'Plan'],
      ['generation_type', 'Billing Type'],
      ['date_installed', 'Date Installed'],
      ['router_model', 'Router Model'],
    ];

    required.forEach(([field, label]) => {
      if (!String(form[field] ?? '').trim()) e[field] = `${label} is required`;
    });

    if (form.email_address.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email_address.trim())) {
      e.email_address = 'Enter a valid email address';
    }

    if (isPostpaid) {
      const day = Number(form.billing_day);
      if (!form.billing_day.trim()) {
        e.billing_day = 'Billing Day is required for postpaid';
      } else if (!Number.isInteger(day) || day < 1 || day > 30) {
        e.billing_day = 'Billing Day must be from 1 to 30';
      }
    }

    if (form.installation_fee.trim() && (isNaN(Number(form.installation_fee)) || Number(form.installation_fee) < 0)) {
      e.installation_fee = 'Installation Fee must be a number, 0 or more';
    }

    if (form.withholding_enabled) {
      const pct = Number(form.withholding_percentage);
      if (!form.withholding_percentage.trim() || isNaN(pct)) {
        e.withholding_percentage = 'Withholding Percentage is required';
      } else if (pct <= 0 || pct > 100) {
        e.withholding_percentage = 'Withholding Percentage must be more than 0 and at most 100';
      }
    }

    if (needsIp && !form.ip_address.trim()) {
      e.ip_address = 'IP Address is required for Antenna and Local';
    }

    if (/\s/.test(form.pppoe_username.trim())) {
      e.pppoe_username = 'The PPPoE username cannot contain spaces';
    }

    return e;
  };

  const scrollToTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  const handleSubmit = async () => {
    if (submittingRef.current) return;

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setBanner('Some fields need attention — see the messages below each one.');
      scrollToTop();
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setBanner(null);

    const optional = (value: string) => (value.trim() === '' ? null : value.trim());

    const payload = {
      ...form,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email_address: form.email_address.trim(),
      contact_number_primary: form.contact_number_primary.trim(),
      address: form.address.trim(),
      middle_initial: optional(form.middle_initial),
      contact_number_secondary: optional(form.contact_number_secondary),
      location: optional(form.location),
      address_coordinates: optional(form.address_coordinates),
      housing_status: optional(form.housing_status),
      referred_by: referredByForSave(referredBy, agents),
      plan_id: Number(form.plan_id),
      billing_day: isPostpaid ? Number(form.billing_day) : null,
      installation_fee: form.installation_fee.trim() === '' ? null : Number(form.installation_fee),
      withholding_percentage: form.withholding_enabled ? Number(form.withholding_percentage) : null,
      connection_type: optional(form.connection_type),
      router_model: form.router_model.trim(),
      router_modem_sn: optional(form.router_modem_sn),
      ip_address: optional(form.ip_address),
      lcpnap: optional(form.lcpnap),
      port: optional(form.port),
      vlan: optional(form.vlan),
      usage_type: optional(form.usage_type),
      pppoe_username: optional(form.pppoe_username),
      pppoe_password: optional(form.pppoe_password),
    };

    try {
      // Up to two RADIUS servers, three tries each, can take a while when one is down.
      const response = await apiClient.post<{ success: boolean; data?: CreatedCustomer; message?: string }>(
        '/customers/direct',
        payload,
        { timeout: 120000 }
      );

      if (response.data.success && response.data.data) {
        setCreated(response.data.data);
      } else {
        setBanner(response.data.message || 'The customer could not be created.');
        scrollToTop();
      }
    } catch (error: any) {
      const data = error?.response?.data;

      if (error?.response?.status === 422 && data?.errors) {
        const fieldErrors: Record<string, string> = {};
        Object.entries(data.errors as Record<string, string[]>).forEach(([field, messages]) => {
          fieldErrors[field] = Array.isArray(messages) ? messages[0] : String(messages);
        });
        setErrors(fieldErrors);
        setBanner('Some fields need attention — see the messages below each one.');
      } else if (error?.response?.status === 403) {
        setBanner(data?.message || 'Only a SuperAdmin can add customers directly.');
      } else {
        setBanner(data?.message || error?.message || 'The customer could not be created.');
      }
      scrollToTop();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleDone = () => {
    const result = created;
    setCreated(null);
    if (result) onCreated(result);
    onClose();
  };

  if (!isOpen) return null;

  // ---------------------------------------------------------------------------------------------
  // Field rendering. Plain functions returning elements (not components), so typing never
  // remounts an input and loses focus.
  // ---------------------------------------------------------------------------------------------

  const borderFor = (field: string) =>
    errors[field] ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300';
  const surface = isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900';
  const mutedText = isDarkMode ? 'text-gray-400' : 'text-gray-500';

  const focusOn = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (colorPalette?.primary && !e.currentTarget.disabled) {
      e.currentTarget.style.borderColor = colorPalette.primary;
      e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
    }
  };
  const focusOff = (field: string) => (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = errors[field] ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
    e.currentTarget.style.boxShadow = 'none';
  };

  const label = (text: string, required = false) => (
    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
      {text}{required && <span className="text-red-500">*</span>}
    </label>
  );

  const errorFor = (field: string) =>
    errors[field] ? <p className="text-red-500 text-xs mt-1">{errors[field]}</p> : null;

  const textField = (
    field: keyof FormState,
    text: string,
    options: { required?: boolean; type?: string; placeholder?: string; hint?: string; list?: string } = {}
  ) => (
    <div>
      {label(text, options.required)}
      <input
        type={options.type || 'text'}
        list={options.list}
        value={String(form[field] ?? '')}
        onChange={e => set(field, e.target.value)}
        onFocus={focusOn}
        onBlur={focusOff(field)}
        placeholder={options.placeholder}
        disabled={submitting}
        className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors disabled:opacity-60 ${borderFor(field)} ${surface}`}
      />
      {options.hint && !errors[field] && <p className={`text-xs mt-1 ${mutedText}`}>{options.hint}</p>}
      {errorFor(field)}
    </div>
  );

  const selectField = (
    field: keyof FormState,
    text: string,
    choices: Array<{ value: string; label: string; disabled?: boolean }>,
    options: { required?: boolean; placeholder: string; disabled?: boolean; hint?: string }
  ) => (
    <div>
      {label(text, options.required)}
      <div className="relative">
        <select
          value={String(form[field] ?? '')}
          onChange={e => set(field, e.target.value)}
          onFocus={focusOn}
          onBlur={focusOff(field)}
          disabled={submitting || options.disabled}
          className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${borderFor(field)} ${surface}`}
        >
          <option value="">{options.placeholder}</option>
          {choices.map(choice => (
            <option key={choice.value} value={choice.value} disabled={choice.disabled}>{choice.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
      </div>
      {options.hint && !errors[field] && <p className={`text-xs mt-1 ${mutedText}`}>{options.hint}</p>}
      {errorFor(field)}
    </div>
  );

  const checkbox = (field: 'vat_enabled' | 'withholding_enabled', text: string, hint: string) => (
    <div>
      <label className={`flex items-center gap-2 text-sm font-medium cursor-pointer ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
        <input
          type="checkbox"
          checked={form[field]}
          onChange={e => set(field, e.target.checked)}
          disabled={submitting}
          className="w-4 h-4 rounded cursor-pointer"
          style={{ accentColor: colorPalette?.primary || '#7c3aed' }}
        />
        {text}
      </label>
      <p className={`text-xs mt-1 ${mutedText}`}>{hint}</p>
    </div>
  );

  const section = (title: string, description: string, children: React.ReactNode) => (
    <section className="space-y-4">
      <div className={`pb-2 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <h3 className={`text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{title}</h3>
        <p className={`text-xs mt-0.5 ${mutedText}`}>{description}</p>
      </div>
      {children}
    </section>
  );

  const primary = colorPalette?.primary || '#7c3aed';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
      <div className={`h-full w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
        <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-300'}`}>
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Add Customer</h2>
          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              disabled={submitting}
              className={`px-4 py-2 rounded text-sm disabled:opacity-50 ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'}`}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center"
              style={{ backgroundColor: primary }}
            >
              {submitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Creating...
                </>
              ) : (
                'Create Customer'
              )}
            </button>
            <button
              onClick={onClose}
              disabled={submitting}
              className={`disabled:opacity-50 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-8">
          <p className={`text-xs ${mutedText}`}>
            Creates the customer, billing account, technical details and RADIUS account directly — no
            application or job order. Fields marked <span className="text-red-500">*</span> are required.
          </p>

          {banner && (
            <div className={`px-3 py-2 rounded border text-sm ${isDarkMode ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {banner}
            </div>
          )}

          {section('Customer Information', 'Who the customer is and where service is installed.', (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1">{textField('first_name', 'First Name', { required: true })}</div>
                <div className="md:col-span-1">{textField('middle_initial', 'Middle Initial')}</div>
                <div className="md:col-span-1">{textField('last_name', 'Last Name', { required: true })}</div>
              </div>
              {textField('email_address', 'Email Address', { required: true, type: 'email' })}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {textField('contact_number_primary', 'Contact Number', {
                  required: true,
                  hint: 'Also the customer portal password.',
                })}
                {textField('contact_number_secondary', 'Second Contact Number')}
              </div>
              {textField('address', 'Address', { required: true })}
              {selectField('region', 'Region', regions.map((r: any) => ({ value: r.name, label: r.name })), {
                required: true,
                placeholder: 'Select Region',
              })}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectField('city', 'City', filteredCities.map(c => ({ value: c.name, label: c.name })), {
                  required: true,
                  placeholder: form.region ? 'Select City' : 'Select Region First',
                  disabled: !form.region,
                })}
                {selectField('barangay', 'Barangay', filteredBarangays.map(b => ({ value: b.barangay, label: b.barangay })), {
                  required: true,
                  placeholder: form.city ? 'Select Barangay' : 'Select City First',
                  disabled: !form.city,
                })}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {textField('location', 'Location')}
                {textField('address_coordinates', 'Address Coordinates', { placeholder: 'e.g. 15.7945, 120.4518' })}
              </div>
              {selectField('housing_status', 'Housing Status', [
                { value: 'Owner', label: 'Owner' },
                { value: 'Renter', label: 'Renter' },
              ], { placeholder: 'Select Housing Status' })}
              {selectField('plan_id', 'Plan', plans.map(p => ({
                value: String(p.id),
                label: p.price != null ? `${p.name} - ₱${Number(p.price).toFixed(2)}` : p.name,
              })), { required: true, placeholder: 'Select Plan' })}
              <SearchableField
                label="Referred By"
                value={referredBy.label}
                onSelect={(value, option) => setReferredBy(selectionFromOption(value, option))}
                groupedOptions={groupedAgents}
                optionLabelKey="name"
                isDarkMode={isDarkMode}
                placeholder="Search Agent..."
                isHeaderSelectable={false}
              />
            </>
          ))}

          {section('Billing Account', 'How the account is billed. The account number is assigned automatically.', (
            <>
              {selectField('generation_type', 'Billing Type', [
                { value: 'Prepaid', label: 'Prepaid' },
                { value: 'Postpaid', label: 'Postpaid' },
              ], {
                required: true,
                placeholder: 'Select Billing Type',
                hint: form.generation_type === 'Prepaid'
                  ? 'Starts Inactive with its first bill; the prepaid period starts when they pay.'
                  : form.generation_type === 'Postpaid'
                    ? 'Starts Active and is billed on the billing day.'
                    : undefined,
              })}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {isPostpaid && textField('billing_day', 'Billing Day (1-30)', { required: true, type: 'number' })}
                {textField('date_installed', 'Date Installed', { required: true, type: 'date' })}
              </div>
              {textField('installation_fee', 'Installation Fee', {
                type: 'number',
                placeholder: '0.00',
                hint: 'The opening account balance. Leave blank for none.',
              })}
              {checkbox('vat_enabled', 'VAT Included', form.vat_enabled
                ? 'VAT is added on top of the plan price.'
                : 'No VAT — the customer is billed the plan price.')}
              {checkbox('withholding_enabled', 'Withholding Tax', 'A percentage withheld from each bill.')}
              {form.withholding_enabled && textField('withholding_percentage', 'Withholding Percentage', {
                required: true,
                type: 'number',
                placeholder: 'e.g. 5',
              })}
            </>
          ))}

          {section('Technical Details', 'The connection at the customer\'s location.', (
            <>
              <div>
                {label('Connection Type')}
                <div className="grid grid-cols-3 gap-2">
                  {['Antenna', 'Fiber', 'Local'].map(type => (
                    <button
                      key={type}
                      type="button"
                      disabled={submitting}
                      // Clicking the selected type again clears it: the field is optional.
                      onClick={() => set('connection_type', form.connection_type === type ? '' : type)}
                      className={`py-2 px-4 rounded border transition-colors duration-200 disabled:opacity-60 ${form.connection_type === type
                        ? 'text-white border-transparent'
                        : (isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-700')
                        }`}
                      style={form.connection_type === type ? { backgroundColor: primary, borderColor: primary } : undefined}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              {textField('router_model', 'Router Model', {
                required: true,
                list: 'add-customer-router-model-options',
                placeholder: 'Enter Router Model',
              })}
              <datalist id="add-customer-router-model-options">
                {routerModels.map((item, index) => <option key={index} value={item.item_name} />)}
              </datalist>
              {textField('router_modem_sn', 'Router Modem SN', { hint: 'Labels the ONU in SmartOLT when given.' })}
              {needsIp && textField('ip_address', 'IP Address', { required: true })}
              {isFiber && (
                <>
                  <div>
                    <SearchableField
                      label="LCP-NAP"
                      placeholder="Search LCP-NAP..."
                      value={form.lcpnap}
                      onSelect={value => set('lcpnap', value)}
                      options={lcpnaps}
                      optionLabelKey="lcpnap_name"
                      isDarkMode={isDarkMode}
                      error={errors.lcpnap}
                    />
                    {form.lcpnap && (
                      <button type="button" onClick={() => set('lcpnap', '')} className="text-xs mt-1 hover:underline" style={{ color: primary }}>
                        Clear LCP-NAP
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectField('port', 'Port', Array.from({ length: totalPorts }, (_, i) => {
                      const port = `P${String(i + 1).padStart(2, '0')}`;
                      const taken = usedPorts.has(port);
                      return {
                        value: port,
                        label: taken && portAccounts[port] ? `${port} — ${portAccounts[port]}` : port,
                        disabled: taken,
                      };
                    }), {
                      placeholder: form.lcpnap ? 'Select Port' : 'Select LCP-NAP first',
                      disabled: !form.lcpnap,
                    })}
                    {selectField('vlan', 'VLAN', vlans.map(v => ({ value: String(v.value), label: String(v.value) })), {
                      placeholder: 'Select VLAN',
                    })}
                  </div>
                </>
              )}
              {selectField('usage_type', 'Usage Type', usageTypes.map(u => ({ value: u.usage_name, label: u.usage_name })), {
                placeholder: 'Select Usage Type',
              })}
            </>
          ))}

          {section('RADIUS / Internet Account', 'The PPPoE login the customer\'s router connects with.', (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {textField('pppoe_username', 'PPPoE Username', {
                  placeholder: 'Generated if left blank',
                  hint: 'Blank uses the PPPoE username pattern. Must not be in use already.',
                })}
                {textField('pppoe_password', 'PPPoE Password', {
                  placeholder: 'Generated if left blank',
                  hint: 'Blank uses the PPPoE password pattern.',
                })}
              </div>
              <p className={`text-xs px-3 py-2 rounded border ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-300' : 'bg-gray-50 border-gray-300 text-gray-600'}`}>
                The RADIUS account is created in the Restricted group, as for every new customer: the
                customer goes online once their first payment is posted. If RADIUS cannot be reached,
                nothing is created.
              </p>
            </>
          ))}
        </div>
      </div>

      {(submitting || created) && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]">
          <div className={`border rounded-lg p-8 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-300'}`}>
            {submitting ? (
              <div className="text-center">
                <div className="flex justify-center mb-6">
                  <div className="animate-spin rounded-full h-16 w-16 border-b-4" style={{ borderColor: primary }}></div>
                </div>
                <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Creating customer...</h3>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Creating the RADIUS account and the customer's records. Please wait.
                </p>
              </div>
            ) : created && (
              <>
                <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Customer created</h3>
                <dl className={`text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <dt className={mutedText}>Account No.</dt><dd className="font-semibold">{created.account_no}</dd>
                  <dt className={mutedText}>Name</dt><dd>{created.full_name}</dd>
                  <dt className={mutedText}>Billing Status</dt><dd>{created.billing_status}</dd>
                  <dt className={mutedText}>PPPoE Username</dt><dd className="font-mono break-all">{created.pppoe_username}</dd>
                  <dt className={mutedText}>PPPoE Password</dt><dd className="font-mono break-all">{created.pppoe_password}</dd>
                  <dt className={mutedText}>RADIUS</dt><dd>{created.radius_group} on server {created.radius_server}</dd>
                </dl>
                <p className={`text-xs mb-6 ${mutedText}`}>
                  The customer goes online once their first payment is posted.
                  {created.initial_billing_created && ' Their first prepaid bill has been created.'}
                  {' '}No SMS or email was sent.
                </p>
                <div className="flex justify-end">
                  <button onClick={handleDone} className="px-4 py-2 text-white rounded" style={{ backgroundColor: primary }}>
                    OK
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AddCustomerModal;
