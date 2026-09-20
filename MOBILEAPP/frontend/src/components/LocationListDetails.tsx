import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { X, Edit, Trash2, ChevronLeft, ChevronRight } from 'lucide-react-native';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

/**
 * RN rebuild of the web LocationListDetails. The web version had a mouse-resize handle
 * and the web-only RelatedDataTable (<div>); both are dropped. Keeps the location's
 * fields + compact Related Applications / Job Orders / Subscribed Customers sections
 * fetched from /locations/{type}/{id}/related.
 */

interface LocationItem {
  id: number;
  name: string;
  type: 'city' | 'region' | 'borough' | 'location';
  parentId?: number;
  parentName?: string;
  cityId?: number;
  regionId?: number;
  boroughId?: number;
  modifiedBy?: string;
  modifiedAt?: string;
}

interface LocationListDetailsProps {
  location: LocationItem;
  onClose: () => void;
  onEdit: (location: LocationItem) => void;
  onDelete: (location: LocationItem) => void;
  isMobile?: boolean;
}

interface RelatedRow {
  label: string;
  sub?: string;
}

const PAGE_SIZE = 5;

const typeLabel = (type: string): string =>
  ({ city: 'City', region: 'Region', borough: 'Barangay', location: 'Location' } as Record<string, string>)[type] || type;

const parentTypeLabel = (type: string): string =>
  ({ city: 'Region', borough: 'City', location: 'Barangay' } as Record<string, string>)[type] || 'Parent';

const LocationListDetails: React.FC<LocationListDetailsProps> = ({ location, onClose, onEdit, onDelete }) => {
  const [relatedApplications, setRelatedApplications] = useState<any[]>([]);
  const [relatedJobOrders, setRelatedJobOrders] = useState<any[]>([]);
  const [relatedCustomers, setRelatedCustomers] = useState<any[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [pages, setPages] = useState<Record<string, number>>({});

  const primaryColor = colorPalette?.primary || '#7c3aed';

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
    const fetchRelatedData = async () => {
      if (!location.id) return;
      try {
        setLoadingRelated(true);
        const response = await apiClient.get<{ success: boolean; data: any }>(`/locations/${location.type}/${location.id}/related`);
        if (response.data?.success) {
          setRelatedApplications(response.data.data?.applications || []);
          setRelatedJobOrders(response.data.data?.job_orders || []);
          setRelatedCustomers(response.data.data?.customers || []);
        }
      } catch (err) {
        console.error('Error fetching location related data:', err);
        setRelatedApplications([]);
        setRelatedJobOrders([]);
        setRelatedCustomers([]);
      } finally {
        setLoadingRelated(false);
      }
    };
    fetchRelatedData();
  }, [location.id, location.type]);

  const handlePageChange = (sectionKey: string, newPage: number) => {
    setPages((prev) => ({ ...prev, [sectionKey]: newPage }));
  };

  const formatDate = (value?: string) => {
    if (!value) return '-';
    try {
      return new Date(value)
        .toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
        .replace(',', '');
    } catch {
      return value;
    }
  };

  const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingBottom: 12, marginBottom: 12 }}>
      <Text style={{ width: 130, fontSize: 13, color: '#6b7280' }}>{label}:</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#111827' }}>{value}</Text>
      </View>
    </View>
  );

  const renderRelatedSection = (title: string, sectionKey: string, rows: RelatedRow[]) => {
    const currentPage = pages[sectionKey] || 1;
    const totalPages = Math.ceil(rows.length / PAGE_SIZE) || 1;
    const paginated = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    return (
      <View style={{ borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontWeight: '500', color: '#111827' }}>{title}</Text>
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: primaryColor + '22' }}>
            <Text style={{ fontSize: 11, color: primaryColor }}>{loadingRelated ? '...' : rows.length}</Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          {loadingRelated ? (
            <Text style={{ textAlign: 'center', paddingVertical: 16, fontSize: 13, color: primaryColor }}>Loading...</Text>
          ) : rows.length > 0 ? (
            <>
              {paginated.map((row, idx) => (
                <View key={idx} style={{ paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 8, marginBottom: 8, backgroundColor: '#ffffff' }}>
                  <Text style={{ fontSize: 14, color: '#111827', fontWeight: '500' }}>{row.label || '-'}</Text>
                  {!!row.sub && <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{row.sub}</Text>}
                </View>
              ))}
              {totalPages > 1 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingVertical: 4 }}>
                  <TouchableOpacity onPress={() => handlePageChange(sectionKey, currentPage - 1)} disabled={currentPage === 1} style={{ padding: 6, borderRadius: 6, backgroundColor: '#f3f4f6', opacity: currentPage === 1 ? 0.5 : 1 }}>
                    <ChevronLeft size={16} color="#374151" />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 13, color: '#6b7280' }}>Page {currentPage} of {totalPages}</Text>
                  <TouchableOpacity onPress={() => handlePageChange(sectionKey, currentPage + 1)} disabled={currentPage === totalPages} style={{ padding: 6, borderRadius: 6, backgroundColor: '#f3f4f6', opacity: currentPage === totalPages ? 0.5 : 1 }}>
                    <ChevronRight size={16} color="#374151" />
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            <Text style={{ textAlign: 'center', paddingVertical: 16, fontSize: 13, color: '#9ca3af' }}>No items found</Text>
          )}
        </View>
      </View>
    );
  };

  const applicationRows: RelatedRow[] = relatedApplications.map((a) => ({
    label: [a.first_name, a.middle_initial, a.last_name].filter(Boolean).join(' ') || a.customer_name || `Application #${a.id}`,
    sub: [a.status, a.created_at ? String(a.created_at).split('T')[0] : null].filter(Boolean).join(' • '),
  }));

  const jobOrderRows: RelatedRow[] = relatedJobOrders.map((j) => {
    const app = j.application;
    const name = app ? [app.first_name, app.middle_initial, app.last_name].filter(Boolean).join(' ') : j.customer_name;
    return {
      label: name || `Job Order #${j.id}`,
      sub: [j.status, j.timestamp ? String(j.timestamp).split('T')[0] : null].filter(Boolean).join(' • '),
    };
  });

  const customerRows: RelatedRow[] = relatedCustomers.map((c) => ({
    label: c.full_name || [c.first_name, c.middle_initial, c.last_name].filter(Boolean).join(' ') || 'Customer',
    sub: c.email_address || undefined,
  }));

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View style={{ padding: 12, paddingTop: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: '#ffffff' }}>
        <Text style={{ color: '#111827', fontWeight: '500', fontSize: 16, flex: 1 }} numberOfLines={1}>{location.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => onDelete(location)} style={{ padding: 6 }}>
            <Trash2 size={18} color="#ef4444" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onEdit(location)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: primaryColor }}>
            <Edit size={14} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontSize: 13 }}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Close" style={{ padding: 4 }}>
            <X size={20} color="#4b5563" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {/* Fields */}
        <View style={{ padding: 16 }}>
          <DetailRow label="Location Name" value={location.name} />
          <DetailRow label="Location Type" value={typeLabel(location.type)} />
          {!!location.parentName && <DetailRow label={parentTypeLabel(location.type)} value={location.parentName} />}
          <DetailRow label="ID" value={String(location.id)} />
          <DetailRow label="Modified By" value={location.modifiedBy || '-'} />
          <DetailRow label="Modified At" value={formatDate(location.modifiedAt)} />
        </View>

        {/* Related References */}
        <View style={{ borderTopWidth: 1, borderTopColor: '#e5e7eb' }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#f3f4f6' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151' }}>Related References</Text>
          </View>
          {renderRelatedSection('Related Applications', 'applications', applicationRows)}
          {renderRelatedSection('Related Job Orders', 'jobOrders', jobOrderRows)}
          {renderRelatedSection('Subscribed Customers', 'customers', customerRows)}
        </View>
      </ScrollView>
    </View>
  );
};

export default LocationListDetails;
