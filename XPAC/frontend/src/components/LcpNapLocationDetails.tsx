import React, { useState, useEffect, useRef, Suspense } from 'react';
import { X, MapPin, Search, ChevronLeft, ChevronRight, Info, Users, Activity, ExternalLink, Loader2, User, Pencil } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getRelatedCustomers } from '../services/lcpnapService';
import { getBillingRecordDetails } from '../services/billingService';
import { BillingDetailRecord } from '../types/billing';
import AddLcpNapLocationModal from '../modals/AddLcpNapLocationModal';

// Break circular dependency with lazy loading
const BillingDetails = React.lazy(() => import('./CustomerDetails'));

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Component to update map center when coordinates change
const MapUpdater: React.FC<{ center: [number, number] }> = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
};

interface LocationMarker {
  id: number;
  lcpnap_name: string;
  lcp_name: string;
  nap_name: string;
  coordinates: string;
  latitude: number;
  longitude: number;
  street?: string;
  city?: string;
  region?: string;
  barangay?: string;
  port_total?: number;
  reading_image_url?: string;
  image1_url?: string;
  image2_url?: string;
  modified_by?: string;
  modified_date?: string;
  active_sessions?: number;
  restricted_sessions?: number;
  offline_sessions?: number;
  disconnected_sessions?: number;
  not_found_sessions?: number;
  total_technical_details?: number;
}

interface LcpNapLocationDetailsProps {
  location: LocationMarker;
  onClose: () => void;
  onSave?: () => void;
  isMobile?: boolean;
  externalWidth?: number;
}

const LcpNapLocationDetails: React.FC<LcpNapLocationDetailsProps> = ({
  location,
  onClose,
  onSave,
  isMobile = false,
  externalWidth
}) => {
  const [localIsMobile, setLocalIsMobile] = useState<boolean>(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setLocalIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeIsMobile = isMobile || localIsMobile;

  const [detailsWidth, setDetailsWidth] = useState<number>(externalWidth || 600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [relatedCustomers, setRelatedCustomers] = useState<any[]>([]);
  const [customerPage, setCustomerPage] = useState<number>(1);

  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  const [selectedCustomerRecord, setSelectedCustomerRecord] = useState<BillingDetailRecord | null>(null);
  const [isLoadingCustomerDetails, setIsLoadingCustomerDetails] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark');
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
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
    const fetchRelated = async () => {
      setIsLoadingRelated(true);
      try {
        const response = await getRelatedCustomers(location.id);
        if (response.success) {
          setRelatedCustomers(response.data);
          setCustomerPage(1);
        }
      } catch (err) {
        console.error('Failed to fetch related customers:', err);
      } finally {
        setIsLoadingRelated(false);
      }
    };
    if (location.id) {
      fetchRelated();
    }
  }, [location.id]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const diff = startXRef.current - e.clientX;
      const newWidth = Math.max(600, Math.min(1200, startWidthRef.current + diff));

      setDetailsWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = detailsWidth;
  };

  const handleCustomerClick = async (accountNo: string) => {
    console.log('Customer row clicked, accountNo:', accountNo);
    if (!accountNo) {
      console.warn('Click ignored: accountNo is empty');
      return;
    }
    
    setIsLoadingCustomerDetails(true);
    try {
      console.log('Fetching details for account:', accountNo);
      const details = await getBillingRecordDetails(accountNo);
      console.log('API details response:', details);
      
      if (details) {
        setSelectedCustomerRecord(details);
      } else {
        console.warn('No details found for account:', accountNo);
      }
    } catch (err) {
      console.error('Failed to fetch customer details:', err);
    } finally {
      setIsLoadingCustomerDetails(false);
    }
  };

  const formatDate = (dateStr: string | undefined): string => {
    if (!dateStr) return 'Not available';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      let hours = date.getHours();
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const hh = String(hours).padStart(2, '0');
      return `${mm}/${dd}/${yyyy} ${hh}:${minutes} ${ampm}`;
    } catch (e) {
      return dateStr;
    }
  };

  const getDriveDirectUrl = (url: string | undefined) => {
    if (!url) return '';

    // Check for Google Drive URLs
    if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
      let fileId = '';

      // Try to match /d/ID pattern
      const matchD = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (matchD && matchD[1]) {
        fileId = matchD[1];
      }

      // If not found, try id=ID pattern
      if (!fileId) {
        const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (matchId && matchId[1]) {
          fileId = matchId[1];
        }
      }

      if (fileId) {
        // Use thumbnail endpoint which is more reliable for images
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
      }
    }

    return url;
  };

  return (
    <div
      className={`${activeIsMobile ? "fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]" : "h-full md:border-l relative w-full md:w-auto"} flex flex-col overflow-hidden ${isDarkMode ? "bg-gray-950 border-white border-opacity-30" : "bg-gray-50 border-gray-300"}`}
      style={!activeIsMobile && window.innerWidth >= 768 ? { width: `${detailsWidth}px` } : undefined}
    >
      {!activeIsMobile && (
        <div
          className="hidden md:block absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-50"
          style={{ backgroundColor: 'transparent' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onMouseDown={handleMouseDownResize}
        />
      )}

      {/* Header */}
      <div className={`p-3 flex items-center justify-between border-b ${isDarkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
        <div className="flex items-center flex-1 min-w-0">
          <h2 className={`font-medium truncate ${activeIsMobile ? "max-w-[200px] text-sm" : ""} ${isDarkMode ? "text-white" : "text-gray-900"}`}>
            {location.lcpnap_name}
          </h2>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowEditModal(true)}
            className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
            aria-label="Edit"
          >
            <Pencil size={18} />
          </button>
          <button
            onClick={onClose}
            className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className={`max-w-2xl mx-auto py-6 px-4 ${activeIsMobile ? "pb-24" : ""} ${isDarkMode ? "bg-gray-950" : "bg-gray-50"}`}>
          <div className="space-y-4">
            {/* LCP Name */}
            <div className={`flex border-b pb-4 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
              <div className={`w-40 text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>LCP:</div>
              <div className={`flex-1 ${isDarkMode ? "text-white" : "text-gray-900"}`}>{location.lcp_name}</div>
            </div>

            {/* NAP Name */}
            <div className={`flex border-b pb-4 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
              <div className={`w-40 text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>NAP:</div>
              <div className={`flex-1 ${isDarkMode ? "text-white" : "text-gray-900"}`}>{location.nap_name}</div>
            </div>

            {/* Street */}
            {location.street && (
              <div className={`flex border-b pb-4 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
                <div className={`w-40 text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Street:</div>
                <div className={`flex-1 ${isDarkMode ? "text-white" : "text-gray-900"}`}>{location.street}</div>
              </div>
            )}

            {/* Barangay */}
            {location.barangay && (
              <div className={`flex border-b pb-4 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
                <div className={`w-40 text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Barangay:</div>
                <div className={`flex-1 ${isDarkMode ? "text-white" : "text-gray-900"}`}>{location.barangay}</div>
              </div>
            )}

            {/* City */}
            {location.city && (
              <div className={`flex border-b pb-4 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
                <div className={`w-40 text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>City:</div>
                <div className={`flex-1 ${isDarkMode ? "text-white" : "text-gray-900"}`}>{location.city}</div>
              </div>
            )}

            {/* Region */}
            {location.region && (
              <div className={`flex border-b pb-4 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
                <div className={`w-40 text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Region:</div>
                <div className={`flex-1 ${isDarkMode ? "text-white" : "text-gray-900"}`}>{location.region}</div>
              </div>
            )}

            {/* Port Usage */}
            {location.port_total !== undefined && (
              <div className={`flex border-b pb-4 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
                <div className={`w-40 text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Port Usage:</div>
                <div className={`flex-1 font-medium ${location.total_technical_details !== undefined && location.total_technical_details >= location.port_total ? "text-red-500" : (isDarkMode ? "text-white" : "text-gray-900")}`}>
                  {location.total_technical_details || 0} / {location.port_total}
                  {location.total_technical_details !== undefined && location.total_technical_details >= location.port_total && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">FULL</span>
                  )}
                </div>
              </div>
            )}

            {/* Port Available */}
            {location.port_total !== undefined && (
              <div className={`flex flex-col border-b pb-4 gap-2 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-40 text-sm flex-shrink-0 ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Port Available:</div>
                  {(() => {
                    const usedPorts = new Set(
                      relatedCustomers
                        .map((c) => Number(String(c.port).replace(/^P/i, '')))
                        .filter((p) => !isNaN(p) && p > 0)
                    );
                    const availablePorts: number[] = [];
                    for (let p = 1; p <= location.port_total!; p++) {
                      if (!usedPorts.has(p)) availablePorts.push(p);
                    }
                    return (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                        availablePorts.length === 0
                          ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      }`}>
                        {availablePorts.length === 0 ? 'No ports left' : `${availablePorts.length} free`}
                      </span>
                    );
                  })()}
                </div>
                {(() => {
                  const usedPorts = new Set(
                    relatedCustomers
                      .map((c) => Number(String(c.port).replace(/^P/i, '')))
                      .filter((p) => !isNaN(p) && p > 0)
                  );
                  const availablePorts: number[] = [];
                  for (let p = 1; p <= location.port_total!; p++) {
                    if (!usedPorts.has(p)) availablePorts.push(p);
                  }
                  if (availablePorts.length === 0) {
                    return (
                      <div className={`text-xs text-center py-2 rounded ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        All ports are occupied
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-wrap gap-1.5">
                      {availablePorts.map((port) => (
                        <span
                          key={port}
                          className={`inline-flex items-center justify-center text-xs font-mono font-semibold px-2 py-0.5 rounded border ${
                            isDarkMode
                              ? 'bg-green-900/30 text-green-300 border-green-700'
                              : 'bg-green-50 text-green-700 border-green-200'
                          }`}
                        >
                          P{String(port).padStart(2, '0')}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Reading Image */}
            {location.reading_image_url && (
              <div className={`flex flex-col border-b pb-4 gap-2 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
                <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Reading Image:</div>
                <div className="relative group">
                  <img
                    src={getDriveDirectUrl(location.reading_image_url)}
                    alt="Reading Image"
                    className="w-full h-auto max-h-64 object-cover rounded-lg border border-gray-300 dark:border-gray-700 shadow-sm transition-transform hover:scale-[1.01] cursor-pointer"
                    onClick={() => window.open(location.reading_image_url)}
                  />
                  <button
                    className="absolute top-2 right-2 p-1.5 bg-black bg-opacity-50 text-white rounded-full hover:bg-opacity-70 transition-all opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(location.reading_image_url);
                    }}
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Image 1 */}
            {location.image1_url && (
              <div className={`flex flex-col border-b pb-4 gap-2 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
                <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Image 1:</div>
                <div className="relative group">
                  <img
                    src={getDriveDirectUrl(location.image1_url)}
                    alt="Location Image 1"
                    className="w-full h-auto max-h-64 object-cover rounded-lg border border-gray-300 dark:border-gray-700 shadow-sm transition-transform hover:scale-[1.01] cursor-pointer"
                    onClick={() => window.open(location.image1_url)}
                  />
                  <button
                    className="absolute top-2 right-2 p-1.5 bg-black bg-opacity-50 text-white rounded-full hover:bg-opacity-70 transition-all opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(location.image1_url);
                    }}
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Image 2 */}
            {location.image2_url && (
              <div className={`flex flex-col border-b pb-4 gap-2 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
                <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Image 2:</div>
                <div className="relative group">
                  <img
                    src={getDriveDirectUrl(location.image2_url)}
                    alt="Location Image 2"
                    className="w-full h-auto max-h-64 object-cover rounded-lg border border-gray-300 dark:border-gray-700 shadow-sm transition-transform hover:scale-[1.01] cursor-pointer"
                    onClick={() => window.open(location.image2_url)}
                  />
                  <button
                    className="absolute top-2 right-2 p-1.5 bg-black bg-opacity-50 text-white rounded-full hover:bg-opacity-70 transition-all opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(location.image2_url);
                    }}
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Session Status */}
            <div className={`border-b pb-4 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
              <div className={`w-40 text-sm mb-3 ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Session Status:</div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-green-500">Online</span>
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                    {location.active_sessions || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-orange-500">Offline</span>
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                    {location.offline_sessions || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Restricted</span>
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full ${isDarkMode ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-800"}`}>
                    {location.restricted_sessions || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-red-500">Disconnected</span>
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                    {location.disconnected_sessions || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-purple-500">Not Found</span>
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                    {location.not_found_sessions || 0}
                  </span>
                </div>
              </div>
            </div>

            {/* Coordinates */}
            <div className={`flex flex-col border-b pb-4 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
              <div className={`w-full text-sm mb-2 ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Coordinates:</div>
              {location.latitude !== undefined && location.longitude !== undefined ? (
                <div className={`w-full h-64 border rounded overflow-hidden relative ${isDarkMode ? "border-gray-700" : "border-gray-300"}`} style={{ zIndex: 1 }}>
                  <MapContainer
                    center={[location.latitude, location.longitude]}
                    zoom={16}
                    minZoom={6}
                    maxBounds={L.latLngBounds([4.3, 114.0], [21.5, 127.5])}
                    maxBoundsViscosity={1.0}
                    style={{ height: '100%', width: '100%', zIndex: 1 }}
                    scrollWheelZoom={false}
                  >
                    <MapUpdater center={[location.latitude, location.longitude]} />
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Marker position={[location.latitude, location.longitude]}>
                      <Popup>
                        <strong>{location.lcpnap_name}</strong><br />
                        {location.street && <span>{location.street}<br /></span>}
                        {location.latitude?.toFixed(6) || 'N/A'}, {location.longitude?.toFixed(6) || 'N/A'}
                      </Popup>
                    </Marker>
                  </MapContainer>
                </div>
              ) : (
                <div className={`w-full h-64 border rounded flex items-center justify-center ${isDarkMode ? "bg-gray-800 border-gray-700" : "bg-gray-100 border-gray-300"}`}>
                  <span className={`text-sm ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>No valid coordinates available for this location.</span>
                </div>
              )}
              <div className="text-xs mt-2 text-gray-500">
                long and lat : {location.latitude?.toFixed(6) || 'N/A'}, {location.longitude?.toFixed(6) || 'N/A'}
              </div>
            </div>

            {/* Related Customers */}
            <div className={`border-b ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
              <div className="w-full py-4 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-medium ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Related Customers</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isDarkMode ? "bg-gray-800 text-gray-400" : "bg-gray-200 text-gray-700"}`}>
                    {relatedCustomers.length}
                  </span>
                </div>
              </div>
              <div className="pb-4 space-y-3">
                {isLoadingRelated ? (
                  <div className="flex justify-center py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-500"></div>
                  </div>
                ) : relatedCustomers.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className={isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-gray-100 text-gray-600'}>
                        <tr>
                          <th className="px-3 py-2 font-medium">Account No</th>
                          <th className="px-3 py-2 font-medium">Full Name</th>
                          <th className="px-3 py-2 font-medium text-center">Port</th>
                          <th className="px-3 py-2 font-medium text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDarkMode ? 'divide-gray-800' : 'divide-gray-200'}`}>
                        {relatedCustomers.slice((customerPage - 1) * 5, customerPage * 5).map((customer, idx) => (
                          <tr
                            key={idx}
                            className={`cursor-pointer transition-all ${isDarkMode ? "hover:bg-gray-800" : "hover:bg-gray-100"} shadow-sm`}
                            onClick={() => handleCustomerClick(customer.id || customer.account_no)}
                          >
                            <td className={`px-3 py-2 font-mono ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>{customer.account_no}</td>
                            <td className={`px-3 py-2 ${isDarkMode ? "text-white" : "text-gray-900"}`}>{customer.full_name}</td>
                            <td className={`px-3 py-2 text-center ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>{customer.port}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                (customer.status?.toLowerCase() === 'online' || customer.status?.toLowerCase() === 'active')
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : customer.status?.toLowerCase() === 'offline'
                                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                              }`}>
                                {customer.status || 'Unknown'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {relatedCustomers.length > 5 && (
                          <tr className={isDarkMode ? 'bg-gray-900/30' : 'bg-gray-50/50'}>
                            <td colSpan={4} className="px-3 py-2">
                              <div className="flex items-center justify-between">
                                <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                  Page {customerPage} of {Math.ceil(relatedCustomers.length / 5)}
                                </span>
                                <div className="flex items-center space-x-2">
                                  <button
                                    onClick={() => setCustomerPage(p => Math.max(1, p - 1))}
                                    disabled={customerPage === 1}
                                    className={`px-3 py-1 rounded border transition-all text-[10px] font-semibold flex items-center gap-1 ${isDarkMode
                                      ? 'border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30'
                                      : 'border-gray-300 text-gray-600 hover:text-gray-900 hover:bg-white disabled:opacity-30 shadow-sm'
                                    }`}
                                  >
                                    Back
                                  </button>
                                  <button
                                    onClick={() => setCustomerPage(p => Math.min(Math.ceil(relatedCustomers.length / 5), p + 1))}
                                    disabled={customerPage >= Math.ceil(relatedCustomers.length / 5)}
                                    className={`px-3 py-1 rounded border transition-all text-[10px] font-semibold flex items-center gap-1 ${isDarkMode
                                      ? 'border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30'
                                      : 'border-gray-300 text-gray-600 hover:text-gray-900 hover:bg-white disabled:opacity-30 shadow-sm'
                                    }`}
                                  >
                                    Next
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className={`text-center py-6 border-2 border-dashed rounded-lg ${isDarkMode ? 'border-gray-800 text-gray-500' : 'border-gray-200 text-gray-400'}`}>
                    <User size={24} className="mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No customers related to this LCPNAP</p>
                  </div>
                )}
              </div>
            </div>

            {/* Modified By */}
            {location.modified_by && (
              <div className={`flex border-b pb-4 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
                <div className={`w-40 text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Modified By:</div>
                <div className={`flex-1 ${isDarkMode ? "text-white" : "text-gray-900"}`}>{location.modified_by}</div>
              </div>
            )}

            {/* Modified Date */}
            {location.modified_date && (
              <div className={`flex border-b pb-4 ${isDarkMode ? "border-gray-800" : "border-gray-200"}`}>
                <div className={`w-40 text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Modified Date:</div>
                <div className={`flex-1 ${isDarkMode ? "text-white" : "text-gray-900"}`}>{formatDate(location.modified_date)}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overlays */}
      {selectedCustomerRecord && (
        <div className="absolute inset-0 z-[100] animate-in slide-in-from-right duration-300 flex">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setSelectedCustomerRecord(null)} />
          <div className="relative h-full flex ml-auto shadow-2xl border-l border-white/20">
            <Suspense fallback={
              <div className={`w-[600px] h-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-white'}`}>
                <Loader2 
                  className="animate-spin h-8 w-8" 
                  style={{ color: colorPalette?.primary || '#f97316' }}
                />
              </div>
            }>
              <BillingDetails
                billingRecord={selectedCustomerRecord}
                onClose={() => setSelectedCustomerRecord(null)}
              />
            </Suspense>
          </div>
        </div>
      )}

      <AddLcpNapLocationModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={() => {
          setShowEditModal(false);
          onSave?.();
        }}
        editData={{
          id: location.id,
          lcpnap_name: location.lcpnap_name,
          lcp_name: location.lcp_name,
          nap_name: location.nap_name,
          street: location.street,
          barangay: location.barangay,
          city: location.city,
          region: location.region,
          port_total: location.port_total,
          coordinates: location.coordinates,
          modified_by: location.modified_by,
          reading_image_url: location.reading_image_url,
          image1_url: location.image1_url,
          image2_url: location.image2_url,
        }}
      />

      {isLoadingCustomerDetails && (
        <div className="absolute inset-0 z-[70] bg-black/40 backdrop-blur-[1px] flex items-center justify-center">
          <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} p-4 rounded-xl shadow-2xl flex items-center gap-3`}>
            <Loader2 
              className="animate-spin h-5 w-5" 
              style={{ color: colorPalette?.primary || '#f97316' }}
            />
            <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Fetching details...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default LcpNapLocationDetails;
