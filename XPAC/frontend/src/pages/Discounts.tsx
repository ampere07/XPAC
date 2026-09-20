import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Receipt, ChevronRight, Tag, ChevronDown, Menu, X, ChevronsLeft, ChevronsRight, Globe, Calendar, RefreshCw, Plus, Download, Columns3, ArrowUp, ArrowDown, ChevronLeft } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import DiscountDetails from '../components/DiscountDetails';
import DiscountFormModal from '../modals/DiscountFormModal';
import * as discountService from '../services/discountService';
import barangayService from '../services/barangayService';
import { getRegions, Region } from '../services/regionService';
import { getCities, City } from '../services/cityService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import pusher from '../services/pusherService';
import { exportToCSV } from '../utils/exportUtils';
import { usePermissions } from '../hooks/usePermissions';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

interface DiscountRecord {
  id: string;
  fullName: string;
  accountNo: string;
  contactNumber: string;
  emailAddress: string;
  address: string;
  plan: string;
  provider: string;
  discountId: string;
  discountAmount: number;
  discountStatus: string;
  dateCreated: string;
  processedBy: string;
  processedDate: string;
  approvedBy: string;
  approvedByEmail?: string;
  modifiedBy: string;
  modifiedDate: string;
  userEmail: string;
  remarks: string;
  cityId?: number;
  barangay?: string;
  city?: string;
  region?: string;
  created_at?: string;
  completeAddress?: string;
  onlineStatus?: string;
  organization_id?: number | null;
}

interface LocationItem {
  id: string;
  name: string;
  count: number;
}

const formatDate = (dateStr?: string, includeTime: boolean = false): string => {
  if (!dateStr) return 'No date';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();

    if (includeTime) {
      let hours = date.getHours();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${mm}/${dd}/${yyyy} ${hours}:${minutes}:${seconds} ${ampm}`;
    }

    return `${mm}/${dd}/${yyyy}`;
  } catch (e) {
    return dateStr;
  }
};

const getDiscountRecords = async (): Promise<DiscountRecord[]> => {
  try {
    const response = await discountService.getAll();
    if (response.success && response.data) {
      return response.data.map((discount: any) => {
        const customer = discount.billing_account?.customer;
        const plan = discount.billing_account?.plan;

        return {
          id: String(discount.id),
          fullName: customer?.full_name ||
            [customer?.first_name, customer?.middle_initial, customer?.last_name]
              .filter(Boolean).join(' ') || 'N/A',
          accountNo: discount.account_no || 'N/A',
          contactNumber: customer?.contact_number_primary || 'N/A',
          emailAddress: customer?.email_address || 'N/A',
          address: customer?.address || 'N/A',
          completeAddress: [
            customer?.address,
            customer?.location,
            customer?.barangay,
            customer?.city,
            customer?.region
          ].filter(Boolean).join(', ') || 'N/A',
          plan: plan?.plan_name || 'N/A',
          provider: 'N/A',
          discountId: String(discount.id),
          discountAmount: parseFloat(discount.discount_amount) || 0,
          discountStatus: discount.status || 'Unknown',
          dateCreated: discount.created_at ? formatDate(discount.created_at) : 'N/A',
          processedBy: discount.processed_by_user?.full_name || discount.processed_by_user?.username || 'N/A',
          processedDate: discount.processed_date ? formatDate(discount.processed_date) : 'N/A',
          approvedBy: discount.approved_by_user?.full_name || discount.approved_by_user?.username || 'N/A',
          approvedByEmail: discount.approved_by_user?.email_address || discount.approved_by_user?.email,
          modifiedBy: discount.updated_by_user?.full_name || discount.updated_by_user?.username || 'N/A',
          modifiedDate: discount.updated_at ? formatDate(discount.updated_at, true) : 'N/A',
          userEmail: discount.processed_by_user?.email_address || discount.processed_by_user?.email || 'N/A',
          remarks: discount.remarks || '',
          cityId: customer?.city_id || undefined,
          barangay: customer?.barangay,
          city: customer?.city,
          region: customer?.region,
          created_at: discount.created_at,
          onlineStatus: undefined,
          organization_id: discount.organization_id
        };
      });
    }
    return [];
  } catch (error) {
    console.error('Error fetching discount records:', error);
    throw error;
  }
};



const Discounts: React.FC = () => {
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDiscount, setSelectedDiscount] = useState<DiscountRecord | null>(null);
  const selectedDiscountRef = useRef<DiscountRecord | null>(null);
  const [discountRecords, setDiscountRecords] = useState<DiscountRecord[]>([]);
  const [createdDateFrom, setCreatedDateFrom] = useState<string>('');
  const [createdDateTo, setCreatedDateTo] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [mobileViewMode, setMobileViewMode] = useState<'sidebar' | 'list'>('sidebar');

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setMobileViewMode('list');
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-navigate to list view when selectedLocation or createdDateFrom/createdDateTo changes on mobile
  useEffect(() => {
    if (isMobile && (selectedLocation !== 'all' || createdDateFrom || createdDateTo)) {
      setMobileViewMode('list');
    }
  }, [selectedLocation, createdDateFrom, createdDateTo, isMobile]);

  useEffect(() => {
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        setUserRole(userData.role || '');
        setRoleId(userData.role_id || null);
        
        let perms: string[] = [];
        if (userData.permissions) {
          if (Array.isArray(userData.permissions)) {
            perms = userData.permissions;
          } else if (typeof userData.permissions === 'string') {
            try {
              const parsed = JSON.parse(userData.permissions);
              perms = Array.isArray(parsed) ? parsed : [];
            } catch (e) {
              perms = userData.permissions.split(',').map((p: string) => p.trim()).filter(Boolean);
            }
          }
        }
        setUserPermissions(perms);
      } catch (error) {
        console.error('Error parsing auth data in Discounts:', error);
      }
    }
  }, []);

  // Resolved centrally (hooks/usePermissions) so a seeded role such as
  // Technician is answered from the role table rather than from a stored
  // permissions array it does not have.
  const { can: hasPermission } = usePermissions();

  useEffect(() => {
    selectedDiscountRef.current = selectedDiscount;
  }, [selectedDiscount]);

  // Auto-update selectedDiscount when discountRecords list updates (from Pusher or Refresh)
  useEffect(() => {
    if (selectedDiscountRef.current && discountRecords.length > 0) {
      const updatedMatch = discountRecords.find(r => r.id === selectedDiscountRef.current?.id);
      if (updatedMatch && JSON.stringify(updatedMatch) !== JSON.stringify(selectedDiscountRef.current)) {
        setSelectedDiscount(updatedMatch);
      }
    }
  }, [discountRecords]);


  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);
  const isFullyLoaded = !isLoading;
  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const sidebarStartXRef = useRef<number>(0);
  const sidebarStartWidthRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isDiscountFormModalOpen, setIsDiscountFormModalOpen] = useState<boolean>(false);
  const [barangays, setBarangays] = useState<any[]>([]);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());
  const [displayMode, setDisplayMode] = useState<'card' | 'table'>(() => {
    const saved = localStorage.getItem('discountsDisplayMode');
    return (saved as 'card' | 'table') || 'card';
  });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('discountsVisibleColumns');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (err) {
        console.error('Failed to load discounts visible columns:', err);
      }
    }
    return ['id', 'fullName', 'accountNo', 'discountAmount', 'discountStatus', 'dateCreated', 'processedBy'];
  });
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('discountsColumnOrder');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (err) {
        console.error('Failed to load discounts column order:', err);
      }
    }
    return [
      'id', 'fullName', 'accountNo', 'contactNumber', 'emailAddress', 'address',
      'plan', 'discountAmount', 'discountStatus', 'dateCreated', 'processedBy',
      'processedDate', 'approvedBy', 'remarks', 'barangay', 'city', 'region'
    ];
  });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('discountsColumnWidths');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load discounts column widths:', err);
      }
    }
    return {};
  });
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [columnDropdownOpen, setColumnDropdownOpen] = useState(false);
  const columnDropdownRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };

    checkDarkMode();

    const observer = new MutationObserver(() => {
      checkDarkMode();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchLocationData = async () => {
      try {
        const [citiesData, regionsData, barangaysRes] = await Promise.all([
          getCities(),
          getRegions(),
          barangayService.getAll()
        ]);
        setCities(citiesData || []);
        setRegions(regionsData || []);
        setBarangays(barangaysRes.success ? barangaysRes.data : []);
      } catch (err) {
        console.error('Failed to fetch location data:', err);
      }
    };

    fetchLocationData();
  }, []);


  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };

    fetchColorPalette();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (columnDropdownRef.current && !columnDropdownRef.current.contains(event.target as Node)) {
        setColumnDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchDiscountData = async () => {
      try {
        setIsLoading(true);
        const data = await getDiscountRecords();
        setDiscountRecords(data);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch discount records:', err);
        setError('Failed to load discount records. Please try again.');
        setDiscountRecords([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDiscountData();
  }, []);

  // Pusher/Soketi connection for real-time discount updates
  useEffect(() => {
    const handleUpdate = async (updateData: any) => {
      setHasNewData(true);
      try {
        const data = await getDiscountRecords();
        setDiscountRecords(data);
      } catch (err) {
        console.error('[Discount Soketi] Failed to refresh data:', err);
      }
    };

    const discountChannel = pusher.subscribe('discounts');

    discountChannel.bind('discount-updated', handleUpdate);

    return () => {
      discountChannel.unbind('discount-updated', handleUpdate);
      pusher.unsubscribe('discounts');
    };
  }, []);

  const toggleLocationExpansion = (e: React.MouseEvent, locationId: string) => {
    e.stopPropagation();
    setExpandedLocations(prev => {
      const next = new Set(prev);
      if (next.has(locationId)) {
        next.delete(locationId);
      } else {
        next.add(locationId);
      }
      return next;
    });
  };

  const getCityName = useMemo(() => {
    const cityMap = new Map(cities.map(c => [c.id, c.name]));
    return (cityId: number | null | undefined): string => {
      if (!cityId) return 'Unknown City';
      return cityMap.get(cityId) || `City ${cityId}`;
    };
  }, [cities]);

  const searchFilteredRecords = useMemo(() => {
    const authData = JSON.parse(localStorage.getItem('authData') || '{}');
    const userOrgId = authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;

    return discountRecords.filter(record => {
      // Organization filter — mirrors applicationmanagement.tsx logic exactly
      if (userOrgId) {
        // User belongs to an org: only show records assigned to that same org
        if (record.organization_id !== userOrgId) return false;
      } else {
        // User has no org: only show records that have no org assigned
        if (record.organization_id) return false;
      }

      const matchesSearch = searchQuery === '' ||
        record.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.accountNo.includes(searchQuery);

      if (!matchesSearch) return false;

      if (createdDateFrom || createdDateTo) {
        const recordDate = record.created_at ? new Date(record.created_at) : null;
        if (!recordDate) return false;

        recordDate.setHours(0, 0, 0, 0);

        if (createdDateFrom) {
          const fromDate = new Date(createdDateFrom);
          if (recordDate < fromDate) return false;
        }

        if (createdDateTo) {
          const toDate = new Date(createdDateTo);
          if (recordDate > toDate) return false;
        }
      }

      return true;
    });
  }, [discountRecords, searchQuery, createdDateFrom, createdDateTo]);

  // Generate hierarchical location items (Derive counts from search results)
  const locationItems = useMemo(() => {
    // Counts for each level
    const regionCounts: Record<string, number> = {};
    const cityCounts: Record<string, number> = {};
    const barangayCounts: Record<string, number> = {};

    // Count appearances in searchFilteredRecords
    searchFilteredRecords.forEach(record => {
      const region = record.region;
      const city = record.city;
      const barangay = record.barangay;

      if (region) regionCounts[region] = (regionCounts[region] || 0) + 1;

      if (city) {
        const matchedCity = cities.find(c => c.name === city);
        if (matchedCity) {
          cityCounts[`${matchedCity.region_id}_${matchedCity.name}`] = (cityCounts[`${matchedCity.region_id}_${matchedCity.name}`] || 0) + 1;
        }
      }

      if (barangay) {
        const matchedBarangay = barangays.find(b =>
          b.barangay === barangay &&
          (!city || cities.find(c => c.id === b.city_id)?.name === city)
        );
        if (matchedBarangay) {
          barangayCounts[`${matchedBarangay.city_id}_${matchedBarangay.barangay}`] = (barangayCounts[`${matchedBarangay.city_id}_${matchedBarangay.barangay}`] || 0) + 1;
        }
      }
    });

    return {
      regions: regions.map(r => ({
        id: `reg:${r.name}`,
        name: r.name,
        count: regionCounts[r.name] || 0,
        cities: cities.filter(c => c.region_id === r.id).map(c => ({
          id: `city:${c.name}`,
          name: c.name,
          regionName: r.name,
          count: cityCounts[`${r.id}_${c.name}`] || 0,
          barangays: barangays.filter(b => b.city_id === c.id).map(b => ({
            id: `brgy:${b.barangay}`,
            name: b.barangay,
            cityName: c.name,
            regionName: r.name,
            count: barangayCounts[`${c.id}_${b.barangay}`] || 0
          }))
        }))
      })),
      total: searchFilteredRecords.length
    };
  }, [regions, cities, barangays, searchFilteredRecords]);

  const filteredDiscountRecords = useMemo(() => {
    return searchFilteredRecords.filter(record => {
      if (selectedLocation === 'all') return true;

      if (selectedLocation.startsWith('reg:')) {
        return record.region === selectedLocation.replace('reg:', '');
      }

      if (selectedLocation.startsWith('city:')) {
        return record.city === selectedLocation.replace('city:', '');
      }

      if (selectedLocation.startsWith('brgy:')) {
        return record.barangay === selectedLocation.replace('brgy:', '');
      }

      return record.cityId === Number(selectedLocation);
    });
  }, [searchFilteredRecords, selectedLocation]);

  const currentDiscountIndex = useMemo(() => {
    if (!selectedDiscount || !filteredDiscountRecords) return -1;
    return filteredDiscountRecords.findIndex(r => r.id === selectedDiscount.id);
  }, [filteredDiscountRecords, selectedDiscount]);

  const handlePreviousRecord = () => {
    if (currentDiscountIndex > 0) {
      const prevRecord = filteredDiscountRecords[currentDiscountIndex - 1];
      handleRecordClick(prevRecord);
    }
  };

  const handleNextRecord = () => {
    if (currentDiscountIndex >= 0 && currentDiscountIndex < filteredDiscountRecords.length - 1) {
      const nextRecord = filteredDiscountRecords[currentDiscountIndex + 1];
      handleRecordClick(nextRecord);
    }
  };


  const handleRecordClick = (record: DiscountRecord) => {
    setSelectedDiscount(record);
  };

  const handleToggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const next = prev.includes(columnKey)
        ? prev.filter(key => key !== columnKey)
        : [...prev, columnKey];
      localStorage.setItem('discountsVisibleColumns', JSON.stringify(next));
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = discountColumns.map(col => col.key);
    setVisibleColumns(allKeys);
    localStorage.setItem('discountsVisibleColumns', JSON.stringify(allKeys));
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    localStorage.setItem('discountsVisibleColumns', JSON.stringify([]));
  };

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      if (sortDirection === 'desc') {
        setSortColumn(null);
        setSortDirection('asc');
      } else {
        setSortDirection('desc');
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  const handleDragStart = (e: React.DragEvent, columnKey: string) => {
    setDraggedColumn(columnKey);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedColumn && draggedColumn !== columnKey) {
      setDragOverColumn(columnKey);
    }
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, targetColumnKey: string) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColumnKey) {
      setDraggedColumn(null);
      setDragOverColumn(null);
      return;
    }

    const newOrder = [...columnOrder];
    const draggedIndex = newOrder.indexOf(draggedColumn);
    const targetIndex = newOrder.indexOf(targetColumnKey);

    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedColumn);

    setColumnOrder(newOrder);
    localStorage.setItem('discountsColumnOrder', JSON.stringify(newOrder));
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  const handleMouseDownResize = (e: React.MouseEvent, columnKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(columnKey);
    startXRef.current = e.clientX;
    const th = (e.target as HTMLElement).closest('th');
    if (th) {
      startWidthRef.current = th.offsetWidth;
    }
  };

  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingColumn) return;
      const diff = e.clientX - startXRef.current;
      const newWidth = Math.max(80, startWidthRef.current + diff);
      setColumnWidths(prev => {
        const next = { ...prev, [resizingColumn]: newWidth };
        localStorage.setItem('discountsColumnWidths', JSON.stringify(next));
        return next;
      });
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn]);

  const handleCloseDetails = () => {
    setSelectedDiscount(null);
  };

  const handleRefresh = async () => {
    try {
      setHasNewData(false);
      setIsRefreshingManual(true);
      const data = await getDiscountRecords();
      setDiscountRecords(data);
      setError(null);
    } catch (err) {
      console.error('Failed to refresh discount records:', err);
      // Removed setting global error so silent refresh failure doesn't break UI
    } finally {
      setIsRefreshingManual(false);
    }
  };

  const discountColumns = [
    { key: 'id', label: 'ID', width: 'min-w-20' },
    { key: 'fullName', label: 'Customer Name', width: 'min-w-48' },
    { key: 'accountNo', label: 'Account No', width: 'min-w-32' },
    { key: 'contactNumber', label: 'Contact Number', width: 'min-w-36' },
    { key: 'emailAddress', label: 'Email Address', width: 'min-w-48' },
    { key: 'address', label: 'Address', width: 'min-w-64' },
    { key: 'plan', label: 'Plan', width: 'min-w-32' },
    { key: 'discountAmount', label: 'Discount Amount', width: 'min-w-32' },
    { key: 'discountStatus', label: 'Status', width: 'min-w-28' },
    { key: 'dateCreated', label: 'Date Created', width: 'min-w-32' },
    { key: 'processedBy', label: 'Processed By', width: 'min-w-40' },
    { key: 'processedDate', label: 'Processed Date', width: 'min-w-32' },
    { key: 'approvedBy', label: 'Approved By', width: 'min-w-40' },
    { key: 'remarks', label: 'Remarks', width: 'min-w-48' },
    { key: 'barangay', label: 'Barangay', width: 'min-w-32' },
    { key: 'city', label: 'City', width: 'min-w-32' },
    { key: 'region', label: 'Region', width: 'min-w-32' },
  ];

  const filteredColumns = useMemo(() => {
    return discountColumns
      .filter(col => visibleColumns.includes(col.key))
      .sort((a, b) => {
        const indexA = columnOrder.indexOf(a.key);
        const indexB = columnOrder.indexOf(b.key);
        return indexA - indexB;
      });
  }, [visibleColumns, columnOrder]);

  const sortedDiscountRecords = useMemo(() => {
    if (!sortColumn) return filteredDiscountRecords;

    return [...filteredDiscountRecords].sort((a, b) => {
      let aValue: any = (a as any)[sortColumn];
      let bValue: any = (b as any)[sortColumn];

      if (typeof aValue === 'string') aValue = aValue.toLowerCase();
      if (typeof bValue === 'string') bValue = bValue.toLowerCase();

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredDiscountRecords, sortColumn, sortDirection]);

  const handleExport = () => {
    if (!filteredDiscountRecords || filteredDiscountRecords.length === 0) return;

    const getExportValue = (record: DiscountRecord, columnKey: string) => {
      switch (columnKey) {
        case 'id': return record.id;
        case 'fullName': return record.fullName || '-';
        case 'accountNo': return record.accountNo || '-';
        case 'contactNumber': return record.contactNumber || '-';
        case 'emailAddress': return record.emailAddress || '-';
        case 'address': return record.address || '-';
        case 'plan': return record.plan || '-';
        case 'discountAmount': return `₱ ${(record.discountAmount ?? 0).toFixed(2)}`;
        case 'discountStatus': return record.discountStatus || '-';
        case 'dateCreated': return formatDate(record.dateCreated);
        case 'processedBy': return record.processedBy || '-';
        case 'processedDate': return formatDate(record.processedDate);
        case 'approvedBy': return record.approvedBy || '-';
        case 'remarks': return record.remarks || '-';
        case 'barangay': return record.barangay || '-';
        case 'city': return record.city || '-';
        case 'region': return record.region || '-';
        default: return '-';
      }
    };

    exportToCSV('discounts_export', discountColumns, filteredDiscountRecords, getExportValue);
  };

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingSidebar) return;

      const diff = e.clientX - sidebarStartXRef.current;
      const newWidth = Math.max(200, Math.min(500, sidebarStartWidthRef.current + diff));

      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  const handleMouseDownSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    sidebarStartXRef.current = e.clientX;
    sidebarStartWidthRef.current = sidebarWidth;
  };

  const handleOpenDiscountFormModal = () => {
    setIsDiscountFormModalOpen(true);
  };

  const handleCloseDiscountFormModal = () => {
    setIsDiscountFormModalOpen(false);
  };

  const handleSaveDiscount = async (formData: any) => {
    try {
      // The form modal handles the save internally, just refresh the list
      await handleRefresh();
      handleCloseDiscountFormModal();
    } catch (error) {
      console.error('Error saving discount:', error);
    }
  };

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
      <div
        onClick={() => {
          if (isMobile) {
            setMobileViewMode('list');
          }
        }}
        className={`${
          mobileViewMode === 'sidebar' ? 'flex w-full' : 'hidden'
        } md:flex border-r flex-shrink-0 flex-col relative ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`} style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}>
        <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
          <div className="flex items-center justify-between mb-1">
            <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Discounts</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Date Range Filter Section */}
          <div className={`px-4 py-3 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Created Date Range
              </span>
              {(createdDateFrom || createdDateTo) && (
                <button
                  onClick={() => {
                    setCreatedDateFrom('');
                    setCreatedDateTo('');
                  }}
                  className="text-[10px] font-bold uppercase tracking-wider hover:underline"
                  style={{ color: colorPalette?.primary || '#7c3aed' }}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="space-y-2">
              <div className="relative">
                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>From</label>
                <input
                  type="date"
                  value={createdDateFrom}
                  onChange={(e) => setCreatedDateFrom(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={createdDateFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
              <div className="relative">
                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                <input
                  type="date"
                  value={createdDateTo}
                  onChange={(e) => setCreatedDateTo(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={createdDateTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
            </div>
          </div>

          {/* All Level */}
          <button
            onClick={() => setSelectedLocation('all')}
            className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
              } ${selectedLocation === 'all'
                ? ''
                : isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}
            style={selectedLocation === 'all' ? {
              backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
              color: colorPalette?.primary || '#7c3aed'
            } : {}}
          >
            <div className="flex items-center">
              <span>All Discounts</span>
            </div>
            <span
              className={`px-2 py-1 rounded-full text-xs ${selectedLocation === 'all'
                ? 'text-white'
                : isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                }`}
              style={selectedLocation === 'all' ? {
                backgroundColor: colorPalette?.primary || '#7c3aed'
              } : {}}
            >
              {locationItems.total}
            </span>
          </button>

          {/* Region Level */}
          {locationItems.regions.map((region: any) => (
            <div key={region.id}>
              <button
                onClick={() => setSelectedLocation(region.id)}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                  } ${selectedLocation === region.id
                    ? ''
                    : isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}
                style={selectedLocation === region.id ? {
                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                  color: colorPalette?.primary || '#7c3aed'
                } : {}}
              >
                <div className="flex items-center flex-1">
                  <button
                    onClick={(e) => toggleLocationExpansion(e, region.id)}
                    className="p-1 mr-1"
                  >
                    {expandedLocations.has(region.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  <Tag className="h-4 w-4 mr-2" />
                  <span>{region.name}</span>
                </div>
                {region.count > 0 && (
                  <span
                    className={`px-2 py-1 rounded-full text-xs ${selectedLocation === region.id
                      ? 'text-white'
                      : isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                      }`}
                    style={selectedLocation === region.id ? {
                      backgroundColor: colorPalette?.primary || '#7c3aed'
                    } : {}}
                  >
                    {region.count}
                  </span>
                )}
              </button>

              {/* City Level */}
              {expandedLocations.has(region.id) && region.cities.map((city: any) => (
                <div key={city.id}>
                  <button
                    onClick={() => setSelectedLocation(city.id)}
                    className={`w-full flex items-center justify-between pl-10 pr-4 py-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                      } ${selectedLocation === city.id
                        ? ''
                        : isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}
                    style={selectedLocation === city.id ? {
                      backgroundColor: colorPalette?.primary ? `${colorPalette.primary}22` : 'rgba(249, 115, 22, 0.1)',
                      color: colorPalette?.primary || '#7c3aed'
                    } : {}}
                  >
                    <div className="flex items-center flex-1">
                      <button
                        onClick={(e) => toggleLocationExpansion(e, city.id)}
                        className="p-1 mr-1"
                      >
                        {expandedLocations.has(city.id) ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </button>
                      <span>{city.name}</span>
                    </div>
                    {city.count > 0 && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${selectedLocation === city.id
                        ? 'text-white bg-white/20'
                        : isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'
                        }`}>
                        {city.count}
                      </span>
                    )}
                  </button>

                  {/* Barangay Level */}
                  {expandedLocations.has(city.id) && city.barangays.map((barangay: any) => (
                    <button
                      key={barangay.id}
                      onClick={() => setSelectedLocation(barangay.id)}
                      className={`w-full flex items-center justify-between pl-16 pr-4 py-1.5 text-xs transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                        } ${selectedLocation === barangay.id
                          ? ''
                          : isDarkMode ? 'text-gray-500' : 'text-gray-500'
                        }`}
                      style={selectedLocation === barangay.id ? {
                        color: colorPalette?.primary || '#7c3aed',
                        fontWeight: 'bold'
                      } : {}}
                    >
                      <div className="flex items-center flex-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-current mr-2 opacity-40"></span>
                        <span>{barangay.name}</span>
                      </div>
                      {barangay.count > 0 && (
                        <span className={`px-1 py-0.5 rounded text-[9px] transition-colors ${selectedLocation === barangay.id
                          ? 'text-white bg-white/20'
                          : isDarkMode ? 'bg-gray-800 text-gray-600' : 'bg-gray-100 text-gray-400'
                          }`}>
                          {barangay.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>

        {isMobile && (
          <div className={`p-4 border-t flex-shrink-0 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <button
              onClick={() => setMobileViewMode('list')}
              className="w-full py-2 px-4 rounded text-white text-xs font-semibold"
              style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
            >
              View Records
            </button>
          </div>
        )}

        {!isMobile && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-10"
            onMouseDown={handleMouseDownSidebarResize}
            style={{
              backgroundColor: isResizingSidebar ? (colorPalette?.primary || '#7c3aed') : 'transparent'
            }}
            onMouseEnter={(e) => {
              if (!isResizingSidebar && colorPalette?.primary) {
                e.currentTarget.style.backgroundColor = colorPalette.primary;
              }
            }}
            onMouseLeave={(e) => {
              if (!isResizingSidebar) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          />
        )}
      </div>

      <div className={`${
        mobileViewMode === 'list' || !isMobile ? 'flex-1 flex flex-col' : 'hidden'
      } overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="flex flex-col h-full">
          {/* Header with Search (Replicated from Invoice.tsx pattern) */}
          <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            <div className="flex items-center justify-between space-x-3 overflow-x-auto scrollbar-none pb-1 -mb-1 w-full">
              <div className="flex items-center space-x-3 flex-1 min-w-[250px]">
                {mobileViewMode === 'list' && (
                  <button
                    onClick={() => setMobileViewMode('sidebar')}
                    className={`md:hidden p-2 rounded-lg border transition-colors flex items-center justify-center flex-shrink-0 ${
                      isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                    title="Back to Filters"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                )}
                <div className="flex-1 w-full">
                  <GlobalSearch
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    isDarkMode={isDarkMode}
                    colorPalette={colorPalette}
                    placeholder="Search Discount records..."
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2 flex-shrink-0">
                <button
                  onClick={() => {
                    const nextMode = displayMode === 'card' ? 'table' : 'card';
                    setDisplayMode(nextMode);
                    localStorage.setItem('discountsDisplayMode', nextMode);
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border flex-shrink-0 ${isDarkMode
                    ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                >
                  {displayMode === 'card' ? 'Table View' : 'Card View'}
                </button>

                {displayMode === 'table' && (
                  <div className="relative z-[100] flex-shrink-0" ref={columnDropdownRef}>
                    <button
                      onClick={() => setColumnDropdownOpen(!columnDropdownOpen)}
                      className={`p-2 rounded-lg transition-colors border flex-shrink-0 ${isDarkMode
                        ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      title="Column Settings"
                    >
                      <Columns3 className="h-5 w-5" />
                    </button>

                    {columnDropdownOpen && (
                      <div className={`fixed mt-10 w-64 rounded-xl shadow-2xl z-[100] border -translate-x-[calc(100%-2.5rem)] ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
                        }`}>
                        <div className="p-3 border-b flex items-center justify-between">
                          <span className="text-sm font-bold uppercase tracking-wider opacity-60">Columns</span>
                          <div className="flex gap-2">
                            <button onClick={handleSelectAllColumns} className="text-[10px] font-bold uppercase text-blue-500 hover:underline">All</button>
                            <button onClick={handleDeselectAllColumns} className="text-[10px] font-bold uppercase text-red-500 hover:underline">None</button>
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto p-2">
                          {discountColumns.map(col => (
                            <label key={col.key} className={`flex items-center px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'
                              }`}>
                              <input
                                type="checkbox"
                                checked={visibleColumns.includes(col.key)}
                                onChange={() => handleToggleColumn(col.key)}
                                className="rounded border-gray-400 text-purple-600 focus:ring-purple-500 mr-3"
                              />
                              <span className="text-sm">{col.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {hasPermission('discounts.add') && (
                  <button
                    onClick={handleOpenDiscountFormModal}
                    title="Add Discount"
                    className={`p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm flex-shrink-0`}
                    style={{
                      backgroundColor: colorPalette?.primary || '#7c3aed',
                      color: isDarkMode ? '#111827' : '#ffffff'
                    }}
                    onMouseEnter={(e) => {
                      if (colorPalette?.accent) {
                        e.currentTarget.style.backgroundColor = colorPalette.accent;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (colorPalette?.primary) {
                        e.currentTarget.style.backgroundColor = colorPalette.primary;
                      }
                    }}
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                )}
                <button
                  onClick={handleExport}
                  disabled={isLoading || filteredDiscountRecords.length === 0}
                  title="Export to CSV"
                  className={`relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border flex-shrink-0`}
                  style={{
                    backgroundColor: '#ffffff',
                    borderColor: colorPalette?.primary || '#7c3aed',
                    color: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading && filteredDiscountRecords.length > 0 && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLoading && filteredDiscountRecords.length > 0) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }
                  }}
                >
                  <Download className="h-5 w-5" />
                </button>
                 <button
                  onClick={handleRefresh}
                  disabled={isLoading || !isFullyLoaded || isRefreshingManual}
                  title={!isFullyLoaded ? "Loading records..." : isRefreshingManual ? "Checking for updates..." : "Refresh Records"}
                  className={`relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border flex-shrink-0`}
                  style={{
                    backgroundColor: '#ffffff',
                    borderColor: colorPalette?.primary || '#7c3aed',
                    color: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading && isFullyLoaded && !isRefreshingManual && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLoading && isFullyLoaded && !isRefreshingManual) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }
                  }}
                >
                  <RefreshCw className={`h-5 w-5 ${(isLoading || !isFullyLoaded || isRefreshingManual) ? 'animate-spin' : ''}`} />
                  {hasNewData && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            <div className="h-full overflow-y-auto">
              {isLoading ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  <div className="animate-pulse flex flex-col items-center">
                    <div className={`h-4 w-1/3 rounded mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'
                      }`}></div>
                    <div className={`h-4 w-1/2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'
                      }`}></div>
                  </div>
                  <p className="mt-4">Loading discount records...</p>
                </div>
              ) : error ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-red-400' : 'text-red-600'
                  }`}>
                  <p>{error}</p>
                  <button
                    onClick={handleRefresh}
                    className={`mt-4 px-4 py-2 rounded ${isDarkMode
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                      }`}>
                    Retry
                  </button>
                </div>
              ) : displayMode === 'card' ? (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {sortedDiscountRecords.length > 0 ? (
                    <div>
                      {sortedDiscountRecords.map((record) => (
                        <div
                          key={record.id}
                          onClick={() => handleRecordClick(record)}
                          className={`px-4 py-3 cursor-pointer transition-colors border-b ${isDarkMode
                            ? 'hover:bg-gray-800 border-gray-800'
                            : 'hover:bg-gray-100 border-gray-200'
                            } ${selectedDiscount?.id === record.id ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="text-red-400 font-medium text-sm mb-1 flex items-center flex-wrap gap-2">
                                <span>{record.accountNo} | {record.fullName} | {record.address}</span>
                              </div>
                              <div className={`text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                                }`}>
                                {record.discountStatus} | ₱ {record.discountAmount.toFixed(2)}
                              </div>
                            </div>
                            <div className="flex items-center space-x-2 ml-4 flex-shrink-0">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${record.discountStatus?.toLowerCase() === 'approved' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'
                                }`}>
                                {record.discountStatus}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`text-center py-12 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                      No discount records found matching your filters
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full relative flex flex-col">
                  <div className="flex-1 overflow-auto" ref={tableScrollRef}>
                    <table className="w-max min-w-full text-sm border-separate border-spacing-0">
                      <thead>
                        <tr className={`border-b sticky top-0 z-10 ${isDarkMode
                          ? 'border-gray-700 bg-gray-800'
                          : 'border-gray-200 bg-gray-100'
                          }`}>
                          {filteredColumns.map((column, index) => (
                            <th
                              key={column.key}
                              draggable
                              onDragStart={(e) => handleDragStart(e, column.key)}
                              onDragOver={(e) => handleDragOver(e, column.key)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, column.key)}
                              onDragEnd={handleDragEnd}
                              className={`text-left py-3 px-3 font-normal ${column.width} whitespace-nowrap relative group cursor-move ${isDarkMode ? 'text-gray-400 bg-gray-800' : 'text-gray-600 bg-gray-100'
                                } ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') : ''} ${draggedColumn === column.key ? 'opacity-50' : ''
                                }`}
                              style={dragOverColumn === column.key ? {
                                backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                              } : {
                                width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                              }}
                              onMouseEnter={() => setHoveredColumn(column.key)}
                              onMouseLeave={() => setHoveredColumn(null)}
                            >
                              <div className="flex items-center justify-between">
                                <span>{column.label}</span>
                                {(hoveredColumn === column.key || sortColumn === column.key) && (
                                  <button
                                    onClick={() => handleSort(column.key)}
                                    className="ml-2 transition-colors"
                                  >
                                    {sortColumn === column.key && sortDirection === 'desc' ? (
                                      <ArrowDown className="h-4 w-4" style={{ color: colorPalette?.accent || '#7c3aed' }} />
                                    ) : (
                                      <ArrowUp className="h-4 w-4 text-gray-400" style={{ color: hoveredColumn === column.key ? (colorPalette?.accent || '#7c3aed') : undefined }} />
                                    )}
                                  </button>
                                )}
                              </div>
                              {index < filteredColumns.length - 1 && (
                                <div
                                  className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize ${isDarkMode ? 'group-hover:bg-gray-600' : 'group-hover:bg-gray-300'
                                    }`}
                                  onMouseEnter={(e) => {
                                    if (colorPalette?.primary) {
                                      e.currentTarget.style.backgroundColor = colorPalette.primary;
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = '';
                                  }}
                                  onMouseDown={(e) => handleMouseDownResize(e, column.key)}
                                />
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDiscountRecords.length > 0 ? (
                          sortedDiscountRecords.map((record) => (
                            <tr
                              key={record.id}
                              className={`border-b cursor-pointer transition-colors ${isDarkMode
                                ? 'border-gray-800 hover:bg-gray-900'
                                : 'border-gray-200 hover:bg-gray-50'
                                } ${selectedDiscount?.id === record.id ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''}`}
                              onClick={() => handleRecordClick(record)}
                            >
                              {filteredColumns.map((column, index) => (
                                <td
                                  key={column.key}
                                  className={`py-4 px-3 ${isDarkMode ? 'text-white' : 'text-gray-900'
                                    } ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-800' : 'border-r border-gray-200') : ''}`}
                                  style={{
                                    width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                                    maxWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                                  }}
                                >
                                  <div className="truncate">
                                    {(() => {
                                      const val = (record as any)[column.key];
                                      if (column.key === 'discountAmount') return `₱${record.discountAmount.toFixed(2)}`;
                                      if (column.key === 'discountStatus') {
                                        return (
                                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${record.discountStatus?.toLowerCase() === 'approved' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'
                                            }`}>
                                            {record.discountStatus}
                                          </span>
                                        );
                                      }
                                      return val || '-';
                                    })()}
                                  </div>
                                </td>
                              ))}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={filteredColumns.length} className={`px-4 py-12 text-center border-b ${isDarkMode
                              ? 'text-gray-400 border-gray-800'
                              : 'text-gray-600 border-gray-200'
                              }`}>
                              No discount records found matching your filters
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>



      {selectedDiscount && (
        <div className="flex-shrink-0 overflow-hidden order-3">
          <DiscountDetails
            discountRecord={selectedDiscount}
            onClose={handleCloseDetails}
            onApproveSuccess={handleRefresh}
            onEditSuccess={handleRefresh}
            onPrevious={currentDiscountIndex > 0 ? handlePreviousRecord : undefined}
            onNext={currentDiscountIndex < filteredDiscountRecords.length - 1 ? handleNextRecord : undefined}
          />
        </div>
      )}

      {/* Discount Form Modal */}
      <DiscountFormModal
        isOpen={isDiscountFormModalOpen}
        onClose={handleCloseDiscountFormModal}
        onSave={handleSaveDiscount}
      />
    </div>
  );
};

export default Discounts;
