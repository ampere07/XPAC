import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  Pressable,
  Image,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChevronDown,
  ChevronRight,
  Trash2,
  X,
  AlertTriangle,
  Eye,
  Pencil,
} from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { relatedDataService } from '../services/relatedDataService';
import RelatedDataTable from './RelatedDataTable';
import { relatedDataColumns } from '../config/relatedDataColumns';
import InventoryLogsFormModal from '../modals/InventoryLogsFormModal';
import { useInventoryContext } from '../contexts/InventoryContext';

interface InventoryItem {
  item_name: string;
  item_description?: string;
  supplier?: string;
  quantity_alert?: number;
  image?: string;
  category?: string;
  item_id?: number;
  modified_by?: string;
  modified_date?: string;
  user_email?: string;
}

interface InventoryLog {
  id: string;
  date: string;
  itemQuantity: number;
  requestedBy: string;
  requestedWith: string;
  log_type?: string;
  item_quantity?: number;
  requested_by?: string;
  requested_with?: string;
}

interface BorrowedLog {
  id: string;
  date: string;
  borrowedBy: string;
  quantity: number;
  returnDate?: string;
  status: string;
}

interface JobOrder {
  id: string;
  jobOrderNumber: string;
  date: string;
  assignedTo: string;
  quantity: number;
  status: string;
}

interface ServiceOrder {
  id: string;
  serviceOrderNumber: string;
  date: string;
  technician: string;
  quantity: number;
  status: string;
}

interface DefectiveLog {
  id: string;
  date: string;
  reportedBy: string;
  quantity: number;
  defectType: string;
  description: string;
}

interface InventoryDetailsProps {
  item: InventoryItem;
  inventoryLogs?: InventoryLog[];
  borrowedLogs?: BorrowedLog[];
  jobOrders?: JobOrder[];
  serviceOrders?: ServiceOrder[];
  defectiveLogs?: DefectiveLog[];
  totalStockIn?: number;
  totalStockAvailable?: number;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (item: InventoryItem) => void;
  onClose?: () => void;
}

const InventoryDetails: React.FC<InventoryDetailsProps> = ({
  item,
  inventoryLogs = [
    {
      id: '1',
      date: '2023-11-27T14:07:58',
      itemQuantity: 4,
      requestedBy: 'None',
      requestedWith: 'None',
    },
  ],
  borrowedLogs = [],
  jobOrders = [],
  serviceOrders = [],
  defectiveLogs = [],
  totalStockIn = 4,
  totalStockAvailable = 4,
  onEdit,
  onDelete,
  onClose,
}) => {
  const isDarkMode = false;
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    inventoryLogs: true,
    borrowedLogs: false,
    jobOrders: false,
    serviceOrders: false,
    defectiveLogs: false,
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const [showLogsModal, setShowLogsModal] = useState(false);

  // Related data counts
  const [inventoryLogsCount, setInventoryLogsCount] = useState(inventoryLogs.length);
  const [borrowedLogsCount, setBorrowedLogsCount] = useState(borrowedLogs.length);
  const [jobOrdersCount, setJobOrdersCount] = useState(jobOrders.length);
  const [serviceOrdersCount, setServiceOrdersCount] = useState(serviceOrders.length);
  const [defectiveLogsCount, setDefectiveLogsCount] = useState(defectiveLogs.length);

  // Related data
  const [inventoryLogsData, setInventoryLogsData] = useState<any[]>(inventoryLogs);
  const [borrowedLogsData, setBorrowedLogsData] = useState<any[]>(borrowedLogs);
  const [jobOrdersData, setJobOrdersData] = useState<any[]>(jobOrders);
  const [serviceOrdersData, setServiceOrdersData] = useState<any[]>(serviceOrders);
  const [defectiveLogsData, setDefectiveLogsData] = useState<any[]>(defectiveLogs);

  const { refreshInventory } = useInventoryContext();
  const [refreshCount, setRefreshCount] = useState(0);

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



  // Fetch related data when item_id changes
  useEffect(() => {
    const fetchRelatedData = async () => {
      if (!item.item_id) {
        console.log('❌ No item_id found in item');
        return;
      }

      const itemId = item.item_id;
      console.log('🔍 Fetching related data for item:', itemId);

      const fetchPromises = [
        { key: 'inventoryLogs', fn: relatedDataService.getRelatedInventoryLogs, setState: setInventoryLogsData, setCount: setInventoryLogsCount },
        { key: 'borrowedLogs', fn: relatedDataService.getRelatedBorrowedLogs, setState: setBorrowedLogsData, setCount: setBorrowedLogsCount },
        { key: 'defectiveLogs', fn: relatedDataService.getRelatedDefectiveLogs, setState: setDefectiveLogsData, setCount: setDefectiveLogsCount },
        { key: 'jobOrders', fn: relatedDataService.getRelatedJobOrdersByItem, setState: setJobOrdersData, setCount: setJobOrdersCount },
        { key: 'serviceOrders', fn: relatedDataService.getRelatedServiceOrdersByItem, setState: setServiceOrdersData, setCount: setServiceOrdersCount },
      ];

      for (const { key, fn, setState, setCount } of fetchPromises) {
        try {
          console.log(`⏳ Fetching ${key}...`);
          const result = await fn(itemId);
          console.log(`✅ ${key} fetched:`, { count: result.count || 0, hasData: (result.data || []).length > 0 });
          setState(result.data || []);
          setCount(result.count || 0);
        } catch (error) {
          console.error(`❌ Error fetching ${key}:`, error);
          setState([]);
          setCount(0);
        }
      }
    };

    fetchRelatedData();
  }, [item.item_id, refreshCount]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit(item);
    }
  };

  const handleDelete = () => {
    if (onDelete) {
      Alert.alert(
        'Confirm Delete',
        `Are you sure you want to delete "${item.item_name}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => onDelete(item) },
        ]
      );
    }
  };

  const handleExpand = () => {
    setIsExpanded(true);
  };

  const handleCollapse = () => {
    setIsExpanded(false);
  };

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const iconColor = '#4b5563';
  const borderColor = '#e5e7eb';
  const cardBg = '#ffffff';
  const labelColor = '#4b5563';
  const valueColor = '#111827';
  const sectionBg = '#f9fafb';
  const badgeBg = '#d1d5db';
  const badgeText = '#374151';

  const getDirectImageUrl = (url?: string) => {
    if (!url) return null;
    if (!url.includes('drive.google.com')) return url;

    const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const idParamMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const imageId = (fileIdMatch && fileIdMatch[1]) || (idParamMatch && idParamMatch[1]);

    if (imageId) {
      return `https://drive.google.com/uc?export=view&id=${imageId}`;
    }
    return url;
  };

  const directImageUrl = getDirectImageUrl(item.image);

  // ── Shared sub-components ────────────────────────────────────────────────

  const ToolbarButtons = ({ showCollapse }: { showCollapse?: boolean }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <TouchableOpacity onPress={handleDelete} style={{ padding: 4, borderRadius: 6 }}>
        <Trash2 size={18} color={iconColor} />
      </TouchableOpacity>
      <TouchableOpacity
        style={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: primaryColor,
          backgroundColor: 'transparent',
          marginRight: 4,
        }}
        onPress={() => setShowLogsModal(true)}
      >
        <Text style={{ fontSize: 14, color: primaryColor, fontWeight: '500' }}>Stock In/Out</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={handleEdit}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 6,
          backgroundColor: primaryColor,
        }}
      >
        <Text style={{ fontSize: 14, color: '#ffffff' }}>Edit</Text>
      </TouchableOpacity>
    </View>
  );

  const DetailRow = ({ label, value, valueStyle }: { label: string; value: string | number; valueStyle?: object }) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
      }}
    >
      <Text style={{ fontSize: 14, color: labelColor }}>{label}</Text>
      <Text style={[{ fontWeight: '500', color: valueColor }, valueStyle]}>{String(value)}</Text>
    </View>
  );

  const RelatedSectionHeader = ({
    title,
    count,
    sectionKey,
  }: {
    title: string;
    count: number;
    sectionKey: string;
  }) => (
    <TouchableOpacity
      onPress={() => toggleSection(sectionKey)}
      style={{
        paddingHorizontal: 24,
        paddingVertical: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'transparent',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ fontWeight: '500', color: valueColor }}>{title}</Text>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 4,
            backgroundColor: badgeBg,
            minWidth: 20,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 12, color: badgeText }}>{count}</Text>
        </View>
      </View>
      {expandedSections[sectionKey] ? (
        <ChevronDown size={20} color={iconColor} />
      ) : (
        <ChevronRight size={20} color={iconColor} />
      )}
    </TouchableOpacity>
  );

  const EmptySection = () => (
    <View style={{ paddingHorizontal: 24, paddingVertical: 32, alignItems: 'center' }}>
      <Text style={{ color: '#9ca3af' }}>No items</Text>
    </View>
  );

  const RelatedCard = ({
    title,
    count,
    sectionKey,
  }: {
    title: string;
    count: number;
    sectionKey: string;
  }) => (
    <View
      style={{
        borderWidth: 1,
        borderRadius: 6,
        borderColor,
        backgroundColor: cardBg,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: borderColor,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Text style={{ fontWeight: '500', fontSize: 18, color: valueColor }}>{title}</Text>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 4,
            backgroundColor: badgeBg,
          }}
        >
          <Text style={{ fontSize: 12, color: badgeText }}>{count}</Text>
        </View>
      </View>
      <EmptySection />
    </View>
  );

  // ── Expanded Modal View ──────────────────────────────────────────────────

  const ExpandedView = () => (
    <Modal visible={isExpanded} animationType="slide" onRequestClose={handleCollapse}>
      <View
        style={{
          flex: 1,
          backgroundColor: '#ffffff',
        }}
      >
        {/* Toolbar */}
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: isTablet ? 16 : 60,
            paddingBottom: 16,
            borderBottomWidth: 1,
            borderBottomColor: borderColor,
            backgroundColor: '#f3f4f6',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Breadcrumb */}
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 14, color: labelColor }}>Inventory Category List</Text>
              <ChevronRight size={16} color={iconColor} style={{ marginHorizontal: 8 }} />
              <Text style={{ fontSize: 14, color: labelColor }}>{item.category || 'EVENT'}</Text>
              <ChevronRight size={16} color={iconColor} style={{ marginHorizontal: 8 }} />
              <Text style={{ fontSize: 14, color: valueColor }}>{item.item_name}</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
            <ToolbarButtons showCollapse />
          </View>
        </View>

        {/* Main Content */}
        <ScrollView style={{ flex: 1 }}>
          {/* Image Placeholder */}
          <View
            style={{
              margin: 24,
              height: 280,
              borderWidth: 1,
              borderRadius: 6,
              borderColor,
              backgroundColor: '#f3f4f6',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {directImageUrl ? (
              <Image
                source={{ uri: directImageUrl }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : (
              <AlertTriangle size={64} color={'#9ca3af'} />
            )}
          </View>

          {/* Item Details Card */}
          <View style={{ marginHorizontal: 24, marginBottom: 24, gap: 16 }}>
            <View
              style={{
                borderWidth: 1,
                borderRadius: 6,
                borderColor,
                backgroundColor: cardBg,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  paddingHorizontal: 24,
                  paddingVertical: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: borderColor,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 14, color: labelColor }}>Category</Text>
                <Text style={{ fontWeight: '500', color: valueColor }}>{item.category || 'EVENT'}</Text>
              </View>

              <View style={{ paddingHorizontal: 24, paddingVertical: 16, gap: 8 }}>
                <DetailRow label="Item Name" value={item.item_name} />
                <DetailRow label="Quantity Alert" value={item.quantity_alert || 10} />
                <DetailRow label="Item Description" value={item.item_description || item.item_name} />
                <DetailRow label="Total Stock IN" value={totalStockIn} />
                <DetailRow
                  label="Total Stock Available"
                  value={totalStockAvailable}
                  valueStyle={{ color: '#4ade80', fontWeight: '700', fontSize: 18 }}
                />
              </View>
            </View>

            {/* Inventory Logs Card (expanded) */}
            <View
              style={{
                borderWidth: 1,
                borderRadius: 6,
                borderColor,
                backgroundColor: cardBg,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  paddingHorizontal: 24,
                  paddingVertical: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: borderColor,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <Text style={{ fontWeight: '500', fontSize: 18, color: valueColor }}>
                  Related Inventory Logs
                </Text>
                <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, backgroundColor: badgeBg }}>
                  <Text style={{ fontSize: 12, color: badgeText }}>{inventoryLogsCount}</Text>
                </View>
              </View>

              {inventoryLogsData.length > 0 ? (
                <>
                  {inventoryLogsData.map((log) => (
                    <Pressable
                      key={log.id}
                      style={({ pressed }) => ({
                        paddingHorizontal: 24,
                        paddingVertical: 16,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottomWidth: 1,
                        borderBottomColor: borderColor,
                        backgroundColor: pressed ? sectionBg : 'transparent',
                      })}
                    >
                      <View>
                        <Text style={{ fontWeight: '500', color: valueColor }}>
                          Log Entry #{log.id} {log.log_type ? `(${log.log_type})` : ''}
                        </Text>
                        <Text style={{ fontSize: 14, color: labelColor, marginTop: 2 }}>
                          {formatDate(log.date)}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                        <TouchableOpacity style={{ padding: 8 }}>
                          <Eye size={16} color={iconColor} />
                        </TouchableOpacity>
                        <TouchableOpacity style={{ padding: 8 }}>
                          <Trash2 size={16} color={iconColor} />
                        </TouchableOpacity>
                        <TouchableOpacity style={{ padding: 8 }}>
                          <Pencil size={16} color={iconColor} />
                        </TouchableOpacity>
                      </View>
                    </Pressable>
                  ))}

                  <View
                    style={{
                      paddingHorizontal: 24,
                      paddingVertical: 12,
                      borderTopWidth: 1,
                      borderTopColor: borderColor,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: sectionBg,
                    }}
                  >
                    <Text style={{ color: '#ef4444', fontSize: 14 }}>Expand</Text>
                    <TouchableOpacity
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 6,
                        backgroundColor: primaryColor,
                      }}
                    >
                      <Text style={{ color: '#ffffff', fontSize: 14 }}>Add Item</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <EmptySection />
              )}
            </View>

            <RelatedCard title="Related Borrowed Logs" count={borrowedLogsCount} sectionKey="borrowedLogs" />
            <RelatedCard title="Related Job Orders" count={jobOrdersCount} sectionKey="jobOrders" />
            <RelatedCard title="Related Service Orders" count={serviceOrdersCount} sectionKey="serviceOrders" />
            <RelatedCard title="Related Defective Logs" count={defectiveLogsCount} sectionKey="defectiveLogs" />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

  // ── Default Side Panel View ──────────────────────────────────────────────

  return (
    <>
      <ExpandedView />

      <View
        style={{
          flex: 1,
          backgroundColor: '#ffffff',
        }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingTop: isTablet ? 16 : 60,
            paddingBottom: 16,
            backgroundColor: '#f3f4f6',
            borderBottomWidth: 1,
            borderBottomColor: borderColor,
          }}
        >
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 4,
              backgroundColor: '#d1d5db',
              marginRight: 12,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '500',
                textTransform: 'uppercase',
                color: '#374151',
              }}
            >
              {item.category || 'EVENT'}
            </Text>
          </View>

          <Text
            style={{
              flex: 1,
              fontSize: 18,
              fontWeight: '600',
              textAlign: 'center',
              color: valueColor,
            }}
          >
            {item.item_name}
          </Text>

          <TouchableOpacity onPress={onClose} style={{ marginLeft: 12 }}>
            <X size={20} color={iconColor} />
          </TouchableOpacity>
        </View>

        {/* Toolbar */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 4,
            borderBottomWidth: 1,
            borderBottomColor: borderColor,
            backgroundColor: '#f3f4f6',
            alignItems: 'center',
          }}
        >
          <ToolbarButtons />
        </View>

        {/* Image Placeholder */}
        <View
          style={{
            height: 256,
            alignItems: 'center',
            justifyContent: 'center',
            borderBottomWidth: 1,
            borderBottomColor: borderColor,
            backgroundColor: '#f3f4f6',
            overflow: 'hidden',
          }}
        >
          {directImageUrl ? (
            <Image
              source={{ uri: directImageUrl }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            <AlertTriangle size={48} color={'#9ca3af'} />
          )}
        </View>

        {/* Scrollable Details */}
        <ScrollView style={{ flex: 1 }}>
          {/* Item Details */}
          <View style={{ padding: 24, gap: 4 }}>
            {/* Category */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 8,
              }}
            >
              <Text style={{ fontSize: 14, color: labelColor }}>Category</Text>
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 4,
                  backgroundColor: '#d1d5db',
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '500',
                    textTransform: 'uppercase',
                    color: '#374151',
                  }}
                >
                  {item.category || 'EVENT'}
                </Text>
              </View>
            </View>

            <DetailRow label="Item Name" value={item.item_name} />
            <DetailRow label="Quantity Alert" value={item.quantity_alert || 10} />
            <DetailRow label="Item Description" value={item.item_description || item.item_name} />
            <DetailRow label="Total Stock IN" value={totalStockIn} />
            <DetailRow
              label="Total Stock Available"
              value={totalStockAvailable}
              valueStyle={{ color: '#4ade80', fontWeight: '700', fontSize: 18 }}
            />
          </View>

          {/* Related Sections */}
          <View style={{ borderTopWidth: 1, borderTopColor: borderColor }}>

            {/* Related Inventory Logs */}
            <View style={{ borderBottomWidth: 1, borderBottomColor: borderColor }}>
              <RelatedSectionHeader
                title="Related Inventory Logs"
                count={inventoryLogsCount}
                sectionKey="inventoryLogs"
              />

              {expandedSections.inventoryLogs && (
                <View style={{ backgroundColor: sectionBg }}>
                  {inventoryLogsData.length > 0 ? (
                    <>
                      {/* Table Header */}
                      <View
                        style={{
                          flexDirection: 'row',
                          paddingHorizontal: 24,
                          paddingVertical: 12,
                          backgroundColor: '#e5e7eb',
                        }}
                      >
                        {['Date', 'Type', 'Qty', 'Req. By', 'Req. With'].map((col) => (
                          <View key={col} style={{ flex: 1, alignItems: 'center' }}>
                            <Text style={{ fontSize: 12, fontWeight: '500', color: labelColor }}>
                              {col}
                            </Text>
                          </View>
                        ))}
                      </View>

                      {inventoryLogsData.map((log) => (
                        <View
                          key={log.id}
                          style={{
                            flexDirection: 'row',
                            paddingHorizontal: 24,
                            paddingVertical: 12,
                            borderBottomWidth: 1,
                            borderBottomColor: borderColor,
                          }}
                        >
                          <View style={{ flex: 1, alignItems: 'center' }}>
                            <Text style={{ fontSize: 12, color: valueColor }}>{formatDate(log.date)}</Text>
                          </View>
                          <View style={{ flex: 1, alignItems: 'center' }}>
                            <Text style={{ fontSize: 12, color: valueColor }}>{log.log_type || ''}</Text>
                          </View>
                          <View style={{ flex: 1, alignItems: 'center' }}>
                            <Text style={{ fontSize: 12, color: valueColor }}>{log.itemQuantity || log.item_quantity}</Text>
                          </View>
                          <View style={{ flex: 1, alignItems: 'center' }}>
                            <Text style={{ fontSize: 12, color: valueColor }}>{log.requestedBy || log.requested_by}</Text>
                          </View>
                          <View style={{ flex: 1, alignItems: 'center' }}>
                            <Text style={{ fontSize: 12, color: valueColor }}>{log.requestedWith || log.requested_with}</Text>
                          </View>
                        </View>
                      ))}

                      <View style={{ paddingHorizontal: 24, paddingVertical: 8, alignItems: 'flex-end' }}>
                        <TouchableOpacity onPress={handleExpand}>
                          <Text style={{ color: '#ef4444', fontSize: 14 }}>Expand</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <EmptySection />
                  )}
                </View>
              )}
            </View>

            {/* Related Borrowed Logs */}
            <View style={{ borderBottomWidth: 1, borderBottomColor: borderColor }}>
              <RelatedSectionHeader
                title="Related Borrowed Logs"
                count={borrowedLogsCount}
                sectionKey="borrowedLogs"
              />
              {expandedSections.borrowedLogs && <EmptySection />}
            </View>

            {/* Related Job Orders */}
            <View style={{ borderBottomWidth: 1, borderBottomColor: borderColor }}>
              <RelatedSectionHeader
                title="Related Job Orders"
                count={jobOrdersCount}
                sectionKey="jobOrders"
              />
              {expandedSections.jobOrders && <EmptySection />}
            </View>

            {/* Related Service Orders */}
            <View style={{ borderBottomWidth: 1, borderBottomColor: borderColor }}>
              <RelatedSectionHeader
                title="Related Service Orders"
                count={serviceOrdersCount}
                sectionKey="serviceOrders"
              />
              {expandedSections.serviceOrders && <EmptySection />}
            </View>

            {/* Related Defective Logs */}
            <View>
              <RelatedSectionHeader
                title="Related Defective Logs"
                count={defectiveLogsCount}
                sectionKey="defectiveLogs"
              />
              {expandedSections.defectiveLogs && <EmptySection />}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* Inventory Logs Modal */}
      <InventoryLogsFormModal
        isOpen={showLogsModal}
        onClose={() => setShowLogsModal(false)}
        selectedItem={(item as any)}
        onSuccess={() => {
          // Force re-fetch of related data (logs, etc)
          setRefreshCount(prev => prev + 1);
          // Trigger global refresh to update item totals/counts
          refreshInventory();
        }}
      />
    </>
  );
};

export default InventoryDetails;
