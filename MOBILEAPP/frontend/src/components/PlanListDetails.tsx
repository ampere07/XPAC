import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { X, ChevronLeft, ChevronRight } from 'lucide-react-native';
import apiClient from '../config/api';

/**
 * React Native rebuild of the web PlanListDetails.
 * The web version had a mouse resize handle, HTML5 drag-to-reorder field settings,
 * a web-only RelatedDataTable (renders <div>), and click-through child-detail overlays
 * (Application/JobOrder/Customer). Those are desktop-oriented and don't fit a phone, so
 * this RN version keeps the core value: the plan's detail fields + compact related-data
 * sections (Applications / Job Orders / Subscribed Customers) fetched from /plans/{id}/related.
 */

interface Plan {
  id: number;
  name: string;
  description?: string;
  price?: number;
  is_active?: boolean;
  modified_date?: string;
  modified_by?: string | number;
  created_at?: string;
  updated_at?: string;
}

interface PlanListDetailsProps {
  plan: Plan;
  onClose: () => void;
  isMobile?: boolean;
  onNavigate?: (section: string, extra?: string) => void;
}

interface RelatedRow {
  label: string;
  sub?: string;
}

const PAGE_SIZE = 5;

const PlanListDetails: React.FC<PlanListDetailsProps> = ({ plan, onClose }) => {
  const [relatedApplications, setRelatedApplications] = useState<any[]>([]);
  const [relatedJobOrders, setRelatedJobOrders] = useState<any[]>([]);
  const [relatedCustomers, setRelatedCustomers] = useState<any[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [pages, setPages] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchRelatedData = async () => {
      if (!plan.id) return;
      try {
        setLoadingRelated(true);
        const response = await apiClient.get<{ success: boolean; data: any }>(`/plans/${plan.id}/related`);
        if (response.data?.success) {
          setRelatedApplications(response.data.data?.applications || []);
          setRelatedJobOrders(response.data.data?.job_orders || []);
          setRelatedCustomers(response.data.data?.customers || []);
        }
      } catch (err) {
        console.error('Error fetching plan related data:', err);
      } finally {
        setLoadingRelated(false);
      }
    };
    fetchRelatedData();
  }, [plan.id]);

  const handlePageChange = (sectionKey: string, newPage: number) => {
    setPages((prev) => ({ ...prev, [sectionKey]: newPage }));
  };

  const formatDate = (dateStr?: string): string => {
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

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(price);

  const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingBottom: 12, marginBottom: 12 }}>
      <Text style={{ width: 130, fontSize: 13, color: '#6b7280' }}>{label}</Text>
      <View style={{ flex: 1 }}>{children}</View>
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
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#e5e7eb' }}>
            <Text style={{ fontSize: 11, color: '#111827' }}>{loadingRelated ? '...' : rows.length}</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          {loadingRelated ? (
            <Text style={{ textAlign: 'center', paddingVertical: 16, fontSize: 13, color: '#ea580c' }}>Loading...</Text>
          ) : rows.length > 0 ? (
            <>
              {paginated.map((row, idx) => (
                <View
                  key={idx}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: '#f1f5f9',
                    borderRadius: 8,
                    marginBottom: 8,
                    backgroundColor: '#ffffff',
                  }}
                >
                  <Text style={{ fontSize: 14, color: '#111827', fontWeight: '500' }}>{row.label || '-'}</Text>
                  {!!row.sub && <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{row.sub}</Text>}
                </View>
              ))}
              {totalPages > 1 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingVertical: 4 }}>
                  <TouchableOpacity
                    onPress={() => handlePageChange(sectionKey, currentPage - 1)}
                    disabled={currentPage === 1}
                    style={{ padding: 6, borderRadius: 6, backgroundColor: '#f3f4f6', opacity: currentPage === 1 ? 0.5 : 1 }}
                  >
                    <ChevronLeft size={16} color="#374151" />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 13, color: '#6b7280' }}>Page {currentPage} of {totalPages}</Text>
                  <TouchableOpacity
                    onPress={() => handlePageChange(sectionKey, currentPage + 1)}
                    disabled={currentPage === totalPages}
                    style={{ padding: 6, borderRadius: 6, backgroundColor: '#f3f4f6', opacity: currentPage === totalPages ? 0.5 : 1 }}
                  >
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
    label: a.full_name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email_address || `Application #${a.id}`,
    sub: [a.status, a.city, a.email_address].filter(Boolean).join(' • '),
  }));

  const jobOrderRows: RelatedRow[] = relatedJobOrders.map((j) => ({
    label: j.customer_name || `${j.first_name || ''} ${j.last_name || ''}`.trim() || `Job Order #${j.id}`,
    sub: [j.status, j.onsite_status, j.account_no].filter(Boolean).join(' • '),
  }));

  const customerRows: RelatedRow[] = relatedCustomers.map((c) => ({
    label: c.full_name || c.email_address || 'Customer',
    sub: [c.contact_number_primary, c.email_address].filter(Boolean).join(' • '),
  }));

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: '#ffffff', paddingTop: 50 }}>
        <Text style={{ color: '#111827', fontWeight: '500', fontSize: 16, flex: 1 }} numberOfLines={1}>{plan.name}</Text>
        <TouchableOpacity onPress={onClose} accessibilityLabel="Close" style={{ padding: 4 }}>
          <X size={20} color="#4b5563" />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {/* Plan detail fields */}
        <View style={{ padding: 16 }}>
          <DetailRow label="Plan Name:">
            <Text style={{ color: '#111827' }}>{plan.name}</Text>
          </DetailRow>
          {!!plan.description && (
            <DetailRow label="Description:">
              <Text style={{ color: '#111827' }}>{plan.description}</Text>
            </DetailRow>
          )}
          <DetailRow label="Price:">
            <Text style={{ color: '#16a34a', fontWeight: '600' }}>{formatPrice(plan.price || 0)}</Text>
          </DetailRow>
          <DetailRow label="Status:">
            <View style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: plan.is_active !== false ? '#dcfce7' : '#fee2e2' }}>
              <Text style={{ fontSize: 12, color: plan.is_active !== false ? '#15803d' : '#b91c1c' }}>
                {plan.is_active !== false ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </DetailRow>
          {!!plan.created_at && (
            <DetailRow label="Created At:">
              <Text style={{ color: '#111827' }}>{formatDate(plan.created_at)}</Text>
            </DetailRow>
          )}
          {!!plan.modified_by && (
            <DetailRow label="Modified By:">
              <Text style={{ color: '#111827' }}>{String(plan.modified_by) || 'System'}</Text>
            </DetailRow>
          )}
          {(!!plan.modified_date || !!plan.updated_at) && (
            <DetailRow label="Modified Date:">
              <Text style={{ color: '#111827' }}>{formatDate(plan.modified_date || plan.updated_at)}</Text>
            </DetailRow>
          )}
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

export default PlanListDetails;
