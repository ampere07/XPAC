import React, { useState, useEffect, useRef } from 'react';
import { X, Info } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch (e) {
    return dateString;
  }
};

interface DisconnectionRecord {
  id?: string;
  accountNo: string;
  customerName: string;
  address?: string;
  contactNumber?: string;
  emailAddress?: string;
  plan?: string;
  balance?: number;
  status?: string;
  disconnectionDate?: string;
  disconnectedBy?: string;
  reason?: string;
  remarks?: string;
  appliedDate?: string;
  reconnectionFee?: number;
  daysDisconnected?: number;
  disconnectionCode?: string;
  reconnectionDate?: string;
  reconnectedBy?: string;
  paymentStatus?: string;
  totalDue?: number;
  username?: string;
  sessionId?: string;
  date?: string;
  barangay?: string;
  city?: string;
  dateFormat?: string;
}

interface DisconnectionLogsDetailsProps {
  disconnectionRecord: DisconnectionRecord;
  onClose: () => void;
  isMobile?: boolean;
}

const DisconnectionLogsDetails: React.FC<DisconnectionLogsDetailsProps> = ({ disconnectionRecord, onClose, isMobile = false }) => {
  const [localIsMobile, setLocalIsMobile] = useState<boolean>(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setLocalIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeIsMobile = isMobile || localIsMobile;

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

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

  const title = `${disconnectionRecord.accountNo} | ${disconnectionRecord.customerName} | ${disconnectionRecord.address}`;

  return (
    <div className={`${activeIsMobile ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]' : 'h-full md:border-l relative w-full md:w-auto'} flex flex-col overflow-hidden ${isDarkMode
      ? 'bg-gray-950 border-white border-opacity-30'
      : 'bg-white border-gray-300'
      }`} style={!activeIsMobile ? { width: `${detailsWidth}px` } : undefined}>
      {!activeIsMobile && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-50 ${isDarkMode ? 'hover:bg-orange-500' : 'hover:bg-orange-600'
            }`}
          onMouseDown={handleMouseDownResize}
        />
      )}
      <div className={`px-4 py-3 flex items-center justify-between border-b ${isDarkMode
        ? 'bg-gray-800 border-gray-700'
        : 'bg-gray-100 border-gray-200'
        }`}>
        <h1 className={`text-lg font-semibold truncate pr-4 min-w-0 flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>
          {title}
        </h1>
        <div className="flex items-center space-x-2 flex-shrink-0">

          <button
            onClick={onClose}
            className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
              }`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto p-4 ${activeIsMobile ? 'pb-24' : ''}`}>
        <div className="space-y-4">
          {/* Account No */}
          <div>
            <h3 className={`text-sm uppercase mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>Account No.</h3>
            <p className="text-red-500">
              {disconnectionRecord.accountNo} | {disconnectionRecord.customerName} | {disconnectionRecord.address}
            </p>
          </div>

          {/* Session ID */}
          <div>
            <h3 className={`text-sm uppercase mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>Session ID</h3>
            <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>
              {disconnectionRecord.sessionId || '-'}
            </p>
          </div>

          {/* Disconnected By */}
          <div>
            <h3 className={`text-sm uppercase mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>Disconnected By</h3>
            <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>
              {disconnectionRecord.disconnectedBy || '-'}
            </p>
          </div>

          {/* Username */}
          <div>
            <h3 className={`text-sm uppercase mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>Username</h3>
            <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>
              {disconnectionRecord.username || '-'}
            </p>
          </div>

          {/* Date */}
          <div>
            <h3 className={`text-sm uppercase mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>Date</h3>
            <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>
              {formatDate(disconnectionRecord.date)}
            </p>
          </div>

          {/* Remarks */}
          <div>
            <h3 className={`text-sm uppercase mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>Remarks</h3>
            <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>
              {disconnectionRecord.remarks || '-'}
            </p>
          </div>

          {/* Barangay */}
          <div>
            <h3 className={`text-sm uppercase mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>Barangay</h3>
            <div className="flex items-center">
              <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                {disconnectionRecord.barangay || '-'}
              </p>
              <Info size={16} className={`ml-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                }`} />
            </div>
          </div>

          {/* City */}
          <div>
            <h3 className={`text-sm uppercase mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>City</h3>
            <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>
              {disconnectionRecord.city || '-'}
            </p>
          </div>

          {/* Date Format */}
          <div>
            <h3 className={`text-sm uppercase mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>Date Format</h3>
            <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>
              {formatDate(disconnectionRecord.dateFormat || disconnectionRecord.date)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DisconnectionLogsDetails;