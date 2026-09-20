import React, { useState, useEffect, useRef, useMemo } from 'react';
import { CreditCard, Search, Circle } from 'lucide-react';
import BillingDetails from '../components/CustomerDetails';
import { useBillingStore } from '../store/billingStore';
import { BillingRecord } from '../services/billingService';
import { getCustomerDetail, CustomerDetailData, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import { getCities, City } from '../services/cityService';
import { getRegions, Region } from '../services/regionService';

interface LocationItem {
  id: string;
  name: string;
  count: number;
}

type DisplayMode = 'card' | 'table';

const BillingListView: React.FC = () => {
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const { billingRecords, totalCount, isLoading, error, fetchBillingRecords, refreshLatestData } = useBillingStore();
  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('table');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Essential table columns - only show the most important ones initially
  const [visibleColumns, setVisibleColumns] = useState([
    'status', 'billingStatus', 'accountNo', 'dateInstalled', 'customerName',
    'address', 'contactNumber', 'emailAddress', 'plan', 'balance'
  ]);

  // All available columns for the table
  const allColumns = [
    { key: 'status', label: 'Status', width: 'min-w-28' },
    { key: 'billingStatus', label: 'Billing Status', width: 'min-w-28' },
    { key: 'accountNo', label: 'Account No.', width: 'min-w-32' },
    { key: 'dateInstalled', label: 'Date Installed', width: 'min-w-28' },
    { key: 'customerName', label: 'Full Name', width: 'min-w-40' },
    { key: 'address', label: 'Address', width: 'min-w-56' },
    { key: 'contactNumber', label: 'Contact Number', width: 'min-w-36' },
    { key: 'emailAddress', label: 'Email Address', width: 'min-w-48' },
    { key: 'plan', label: 'Plan', width: 'min-w-40' },
    { key: 'balance', label: 'Account Balance', width: 'min-w-32' },
    { key: 'username', label: 'Username', width: 'min-w-32' },
    { key: 'connectionType', label: 'Connection Type', width: 'min-w-36' },
    { key: 'routerModel', label: 'Router Model', width: 'min-w-32' },
    { key: 'routerModemSN', label: 'Router/Modem SN', width: 'min-w-36' },
    { key: 'lcpnap', label: 'LCPNAP', width: 'min-w-32' },
    { key: 'port', label: 'PORT', width: 'min-w-28' },
    { key: 'vlan', label: 'VLAN', width: 'min-w-24' },
    { key: 'billingDay', label: 'Billing Day', width: 'min-w-28' },
    { key: 'totalPaid', label: 'Total Paid', width: 'min-w-28' },
    { key: 'provider', label: 'Provider', width: 'min-w-24' }
  ];

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownRef]);

  // Fetch location data
  useEffect(() => {
    const fetchLocationData = async () => {
      try {
        const [citiesData, regionsData] = await Promise.all([
          getCities(),
          getRegions()
        ]);
        setCities(citiesData || []);
        setRegions(regionsData || []);
      } catch (err) {
        console.error('Failed to fetch location data:', err);
        setCities([]);
        setRegions([]);
      }
    };

    fetchLocationData();
  }, []);

  // Fetch billing data
  useEffect(() => {
    fetchBillingRecords();
  }, [fetchBillingRecords]);

  // Memoize city name lookup for performance
  const getCityName = useMemo(() => {
    const cityMap = new Map(cities.map(c => [c.id, c.name]));
    return (cityId: number | null | undefined): string => {
      if (!cityId) return 'Unknown City';
      return cityMap.get(cityId) || `City ${cityId}`;
    };
  }, [cities]);

  // Memoize location items for performance
  const locationItems: LocationItem[] = useMemo(() => {
    const items: LocationItem[] = [
      {
        id: 'all',
        name: 'All',
        count: billingRecords.length
      }
    ];

    // Add cities with counts
    cities.forEach((city) => {
      const cityCount = billingRecords.filter(record => record.cityId === city.id).length;
      items.push({
        id: String(city.id),
        name: city.name,
        count: cityCount
      });
    });

    return items;
  }, [cities, billingRecords]);

  // Memoize filtered records for performance
  const filteredBillingRecords = useMemo(() => {
    return billingRecords.filter(record => {
      const matchesLocation = selectedLocation === 'all' ||
        record.cityId === Number(selectedLocation);

      const matchesSearch = searchQuery === '' ||
        record.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.applicationId.includes(searchQuery);

      return matchesLocation && matchesSearch;
    });
  }, [billingRecords, selectedLocation, searchQuery]);

  const handleRowClick = async (record: BillingRecord) => {
    try {
      setIsLoadingDetails(true);
      const customerData = await getCustomerDetail(record.applicationId);
      setSelectedCustomer(customerData);
    } catch (error) {
      console.error('Failed to fetch customer details:', error);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleCloseDetails = () => {
    setSelectedCustomer(null);
  };

  const handleRefresh = async () => {
    await refreshLatestData();
  };

  const toggleColumn = (columnKey: string) => {
    setVisibleColumns(prev =>
      prev.includes(columnKey)
        ? prev.filter(col => col !== columnKey)
        : [...prev, columnKey]
    );
  };

  const renderCellValue = (record: BillingRecord, columnKey: string) => {
    switch (columnKey) {
      case 'status':
        return (
          <div className="flex items-center space-x-2">
            <Circle
              className={`h-3 w-3 ${record.onlineStatus === 'Online'
                ? 'text-green-400 fill-green-400'
                : 'text-gray-400 fill-gray-400'
                }`}
            />
            <span className={`text-xs ${record.onlineStatus === 'Online'
              ? 'text-green-400'
              : 'text-gray-400'
              }`}>
              {record.onlineStatus}
            </span>
          </div>
        );
      case 'billingStatus':
        return record.billingStatus || 'Active';
      case 'accountNo':
        return <span className="text-red-400">{record.applicationId}</span>;
      case 'dateInstalled':
        return record.dateInstalled || '-';
      case 'customerName':
        return record.customerName;
      case 'address':
        return <span title={record.address}>{record.address}</span>;
      case 'contactNumber':
        return record.contactNumber || '-';
      case 'emailAddress':
        return record.emailAddress || '-';
      case 'plan':
        return record.plan || '-';
      case 'balance':
        return `₱ ${record.balance.toFixed(2)}`;
      case 'username':
        return record.username || '-';
      case 'connectionType':
        return record.connectionType || '-';
      case 'routerModel':
        return record.routerModel || '-';
      case 'routerModemSN':
        return record.routerModemSN || '-';
      case 'lcpnap':
        return record.lcpnap || '-';
      case 'port':
        return record.port || '-';
      case 'vlan':
        return record.vlan || '-';
      case 'billingDay':
        return record.billingDay === 0 ? 'Every end of month' : (record.billingDay || '-');
      case 'totalPaid':
        return `₱ ${record.totalPaid?.toFixed(2) || '0.00'}`;
      case 'provider':
        return record.provider || '-';
      default:
        return '-';
    }
  };

  const displayedColumns = allColumns.filter(col => visibleColumns.includes(col.key));

  return (
    <div className="bg-gray-950 h-full flex overflow-hidden">
      <div className="w-64 bg-gray-900 border-r border-gray-700 flex-shrink-0 flex flex-col">
        <div className="p-4 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-white">Billing List View</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {locationItems.map((location) => (
            <button
              key={location.id}
              onClick={() => setSelectedLocation(location.id)}
              className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-gray-800 ${selectedLocation === location.id
                ? 'bg-orange-500 bg-opacity-20 text-orange-400'
                : 'text-gray-300'
                }`}
            >
              <div className="flex items-center">
                <CreditCard className="h-4 w-4 mr-2" />
                <span className="capitalize">{location.name}</span>
              </div>
              {location.count > 0 && (
                <span className={`px-2 py-1 rounded-full text-xs ${selectedLocation === location.id
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 text-gray-300'
                  }`}>
                  {location.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 bg-gray-900 overflow-hidden">
        <div className="flex flex-col h-full">
          <div className="bg-gray-900 p-4 border-b border-gray-700 flex-shrink-0">
            <div className="flex items-center space-x-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Search billing records..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded pl-10 pr-4 py-2 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                />
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              </div>
              <div className="flex space-x-2">
                <div className="relative" ref={dropdownRef}>
                  <button
                    className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm transition-colors flex items-center"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                  >
                    <span>{displayMode === 'card' ? 'Card Type' : 'Table Type'}</span>
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div className="absolute right-0 mt-1 w-36 bg-gray-800 border border-gray-700 rounded shadow-lg z-10"
                    style={{ display: dropdownOpen ? 'block' : 'none' }}>
                    <button
                      onClick={() => {
                        setDisplayMode('card');
                        setDropdownOpen(false);
                      }}
                      className={`block w-full text-left px-4 py-2 text-sm transition-colors hover:bg-gray-700 ${displayMode === 'card' ? 'text-orange-500' : 'text-white'}`}
                    >
                      Card Type
                    </button>
                    <button
                      onClick={() => {
                        setDisplayMode('table');
                        setDropdownOpen(false);
                      }}
                      className={`block w-full text-left px-4 py-2 text-sm transition-colors hover:bg-gray-700 ${displayMode === 'table' ? 'text-orange-500' : 'text-white'}`}
                    >
                      Table Type
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleRefresh}
                  disabled={isLoading}
                  className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 text-white px-4 py-2 rounded text-sm transition-colors"
                >
                  {isLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            <div className="h-full overflow-y-auto">
              {isLoading ? (
                <div className="px-4 py-12 text-center text-gray-400">
                  <div className="animate-pulse flex flex-col items-center">
                    <div className="h-4 w-1/3 bg-gray-700 rounded mb-4"></div>
                    <div className="h-4 w-1/2 bg-gray-700 rounded"></div>
                  </div>
                  <p className="mt-4">Loading billing records...</p>
                </div>
              ) : error ? (
                <div className="px-4 py-12 text-center text-red-400">
                  <p>{error}</p>
                  <button
                    onClick={handleRefresh}
                    className="mt-4 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded">
                    Retry
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto overflow-y-hidden">
                  <table className="w-max min-w-full text-sm border-separate border-spacing-0">
                    <thead>
                      <tr className="border-b border-gray-700 bg-gray-800 sticky top-0 z-10">
                        {displayedColumns.map((column, index) => (
                          <th
                            key={column.key}
                            className={`text-left py-3 px-3 text-gray-400 font-normal bg-gray-800 ${column.width} whitespace-nowrap ${index < displayedColumns.length - 1 ? 'border-r border-gray-700' : ''
                              }`}
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBillingRecords.length > 0 ? (
                        filteredBillingRecords.map((record) => (
                          <tr
                            key={record.id}
                            className={`border-b border-gray-800 hover:bg-gray-900 cursor-pointer transition-colors ${selectedCustomer?.billingAccount?.accountNo === record.applicationId ? 'bg-gray-800' : ''
                              }`}
                            onClick={() => handleRowClick(record)}
                          >
                            {displayedColumns.map((column, index) => (
                              <td
                                key={column.key}
                                className={`py-4 px-3 text-white whitespace-nowrap ${index < displayedColumns.length - 1 ? 'border-r border-gray-800' : ''
                                  }`}
                              >
                                {renderCellValue(record, column.key)}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={displayedColumns.length} className="px-4 py-12 text-center text-gray-400">
                            No billing records found matching your filters
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {(selectedCustomer || isLoadingDetails) && (
        <div className="flex-shrink-0 overflow-hidden">
          {isLoadingDetails ? (
            <div className="w-[600px] bg-gray-900 text-white h-full flex items-center justify-center border-l border-white border-opacity-30">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
                <p className="text-gray-400">Loading details...</p>
              </div>
            </div>
          ) : selectedCustomer ? (
            <BillingDetails
              billingRecord={convertCustomerDataToBillingDetail(selectedCustomer)}
              onlineStatusRecords={[]}
              onClose={handleCloseDetails}
            />
          ) : null}
        </div>
      )}
    </div>
  );
};

export default BillingListView;