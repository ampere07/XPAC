import React, { useState, useEffect, useRef } from 'react';
import { Edit, X } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
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
    return dateString;
  }
};

interface SMSBlastRecord {
  id?: string;
  title?: string;
  message: string;
  billing_day?: number | null;
  message_count?: number | null;
  credit_used?: string | null;
  modifiedDate: string;
  modifiedEmail: string;
  userEmail?: string;
  recipients?: number;
  status?: string;
  sentDate?: string;
  sentTime?: string;
  createdBy?: string;
  createdDate?: string;
  messageType?: string;
  isBulk?: boolean;
  isCritical?: boolean;
  targetGroup?: string;
  deliveryStatus?: string;
  deliveryRate?: number;
  failedCount?: number;
  remarks?: string;
  barangay?: string;
  city?: string;
  target_name?: string;
  target_type?: string;
}

interface SMSBlastDetailsProps {
  smsBlastRecord: SMSBlastRecord;
  onClose: () => void;
  isMobile?: boolean;
  isDarkMode?: boolean;
  colorPalette?: ColorPalette | null;
}

const SMSBlastDetails: React.FC<SMSBlastDetailsProps> = ({
  smsBlastRecord,
  onClose,
  isMobile = false,
  isDarkMode: propIsDarkMode,
  colorPalette: propColorPalette
}) => {
  const [localIsMobile, setLocalIsMobile] = useState<boolean>(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => {
      setLocalIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const activeIsMobile = isMobile || localIsMobile;

  const [localIsDarkMode, setLocalIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const isDarkMode = propIsDarkMode !== undefined ? propIsDarkMode : localIsDarkMode;
  const [localColorPalette, setLocalColorPalette] = useState<ColorPalette | null>(null);
  const colorPalette = propColorPalette !== undefined ? propColorPalette : localColorPalette;

  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setLocalIsDarkMode(localStorage.getItem('theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (propColorPalette !== undefined) return;
    const fetchColorPalette = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setLocalColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();
  }, [propColorPalette]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const diff = startXRef.current - e.clientX;
      const newWidth = Math.max(400, Math.min(1000, startWidthRef.current + diff));
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

  const renderField = (label: string, value: any) => {
    if (value === null || value === undefined || value === '') return null;

    return (
      <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
        <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{label}:</div>
        <div className={`flex-1 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'} break-words whitespace-pre-wrap`}>
          {value}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`${
        activeIsMobile
          ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]'
          : 'h-full flex flex-col overflow-hidden md:border-l relative w-full md:w-auto transition-all duration-300'
      } flex flex-col overflow-hidden ${
        isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
      }`}
      style={!activeIsMobile && window.innerWidth >= 768 ? { width: `${detailsWidth}px` } : undefined}
    >
      {!activeIsMobile && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-50 transition-colors"
          onMouseDown={handleMouseDownResize}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '';
          }}
        />
      )}
        {/* Header */}
        <div className={`px-4 py-3 flex items-center justify-between border-b ${isDarkMode
          ? 'bg-gray-800 border-gray-700'
          : 'bg-gray-100 border-gray-200'
          }`}>
          <h1 className={`text-lg font-semibold truncate pr-4 min-w-0 flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>
            {smsBlastRecord.target_name && smsBlastRecord.target_name !== 'N/A'
              ? `${smsBlastRecord.target_name} (${smsBlastRecord.target_type})`
              : (smsBlastRecord.title || "SMS BLAST LOG")}
          </h1>
          <div className="flex items-center space-x-3 flex-shrink-0">
            <button
              className="px-3 py-1 text-white rounded text-sm transition-colors flex items-center space-x-1"
              style={{
                backgroundColor: colorPalette?.primary || '#7c3aed'
              }}
              onMouseEnter={(e) => {
                if (colorPalette?.accent) {
                  e.currentTarget.style.backgroundColor = colorPalette.accent;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
              }}
            >
              <Edit size={16} />
              <span>Edit</span>
            </button>



            <button
              onClick={onClose}
              className={`p-1 rounded transition-colors ${isDarkMode
                ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                }`}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={`flex-1 overflow-y-auto w-full ${activeIsMobile ? 'pb-24' : ''}`}>
          <div className={`max-w-2xl mx-auto py-6 px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
            <div className="space-y-4">
              {renderField('Message', smsBlastRecord.message)}
              {renderField('Target Name', smsBlastRecord.target_name)}
              {renderField('Target Type', smsBlastRecord.target_type)}
              {renderField('Barangay', smsBlastRecord.barangay)}
              {renderField('City', smsBlastRecord.city)}
              {renderField('Billing Day', smsBlastRecord.billing_day)}
              {renderField('Recipient Count', smsBlastRecord.message_count)}
              {renderField('Credit Used', smsBlastRecord.credit_used)}
              {renderField('Modified Date', formatDate(smsBlastRecord.modifiedDate))}
              {renderField('Modified Email', smsBlastRecord.modifiedEmail)}
              {renderField('Created By', smsBlastRecord.userEmail)}
            </div>
          </div>
        </div>
    </div>
  );
};

export default SMSBlastDetails;