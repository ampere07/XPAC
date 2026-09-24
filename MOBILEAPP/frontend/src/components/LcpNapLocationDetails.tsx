import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Linking, useWindowDimensions, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { X, ExternalLink, MapPin, Navigation2, ChevronLeft, ChevronRight, Edit } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getRelatedCustomers, RelatedCustomer } from '../services/lcpnapService';

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
  inactive_sessions?: number;
  offline_sessions?: number;
  blocked_sessions?: number;
  not_found_sessions?: number;
  total_technical_details?: number;
}

interface LcpNapLocationDetailsProps {
  location: LocationMarker;
  onClose: () => void;
  onEdit?: () => void;
  isMobile?: boolean;
}

const LcpNapLocationDetails: React.FC<LcpNapLocationDetailsProps> = ({
  location,
  onClose,
  onEdit,
  isMobile: propIsMobile = false
}) => {
  const { width } = useWindowDimensions();
  const isMobile = propIsMobile || width < 768;
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const primaryColor = colorPalette?.primary || '#ef4444';
  const [relatedCustomers, setRelatedCustomers] = useState<RelatedCustomer[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 5;

  useEffect(() => {
    const loadSettings = async () => {
      const theme = await AsyncStorage.getItem('theme');
      setIsDarkMode(theme === 'dark');
    };
    loadSettings();
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
    const fetchCustomers = async () => {
      if (!location.id) return;
      setIsLoadingCustomers(true);
      try {
        const response = await getRelatedCustomers(location.id);
        if (response.success) {
          setRelatedCustomers(response.data);
        }
      } catch (err) {
        console.error('Failed to fetch related customers:', err);
      } finally {
        setIsLoadingCustomers(false);
      }
    };
    fetchCustomers();
    setCurrentPage(0); // Reset page when location changes
  }, [location.id]);

  const paginatedCustomers = relatedCustomers.slice(
    currentPage * itemsPerPage,
    (currentPage + 1) * itemsPerPage
  );

  const totalPages = Math.ceil(relatedCustomers.length / itemsPerPage);
  
  const availablePortsList = useMemo(() => {
    if (!location.port_total) return [];
    
    const total = location.port_total;
    const used = new Set<string>();
    
    relatedCustomers.forEach(customer => {
      if (customer.port) {
        // Normalize port name to "PXX" format
        let norm = customer.port.toString().replace(/\s+/g, '').toUpperCase();
        if (/^\d+$/.test(norm)) {
          norm = `P${norm.padStart(2, '0')}`;
        } else if (/^P\d+$/.test(norm)) {
          const numStr = norm.substring(1).padStart(2, '0');
          norm = `P${numStr}`;
        }
        used.add(norm);
      }
    });
    
    const available = [];
    for (let i = 1; i <= total; i++) {
      const portName = `P${i.toString().padStart(2, '0')}`;
      if (!used.has(portName)) {
        available.push(portName);
      }
    }
    return available;
  }, [location.port_total, relatedCustomers]);

  const formatDate = (dateStr: string | undefined): string => {
    if (!dateStr) return 'Not available';
    try {
      return new Date(dateStr).toLocaleString();
    } catch (e) {
      return dateStr;
    }
  };

  const valueStyle = {
    color: isDarkMode ? '#ffffff' : '#111827',
    fontSize: 16,
  };

  const renderField = (label: string, content: React.ReactNode) => {
    if (content === null || content === undefined || content === '') return null;
    if (typeof content === 'string' && (content.trim() === '' || content === 'Not available' || content === 'None' || content === 'Not set')) return null;

    return (
      <View style={[styles.fieldContainer, { borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' }]}>
        <Text style={[styles.fieldLabel, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>{label}</Text>
        <View style={styles.fieldValueContainer}>
          {typeof content === 'string' ? <Text style={valueStyle} selectable={true}>{content}</Text> : content}
        </View>
      </View>
    );
  };

  const getImageUrl = (url: string): string => {
    if (!url) return '';
    if (url.includes('drive.google.com')) {
      // Extract ID from various Google Drive URL formats
      const match = url.match(/\/d\/(.+?)(?:\/|$)/) || url.match(/id=(.+?)(?:&|$)/);
      if (match && match[1]) {
        // Use Google's direct image CDN for better compatibility with React Native
        return `https://lh3.googleusercontent.com/d/${match[1]}`;
      }
    }
    return url;
  };

  const [loadingImages, setLoadingImages] = useState<{ [key: string]: boolean }>({});

  const renderImageField = (label: string, url: string | undefined | null) => {
    if (!url) return null;
    const imageUrl = getImageUrl(url);
    const imageKey = `${label}-${url}`;

    return renderField(label, (
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: imageUrl }}
          style={styles.image}
          resizeMode="cover"
          onLoadStart={() => setLoadingImages(prev => ({ ...prev, [imageKey]: true }))}
          onLoadEnd={() => setLoadingImages(prev => ({ ...prev, [imageKey]: false }))}
        />
        {loadingImages[imageKey] && (
          <View style={[StyleSheet.absoluteFill, styles.imageLoader]}>
            <ActivityIndicator color="#ffffff" />
          </View>
        )}
        <Pressable
          onPress={() => Linking.openURL(url)}
          style={[styles.externalLinkOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
        >
          <View style={styles.externalLinkContent}>
            <ExternalLink width={14} height={14} color="white" />
            <Text style={styles.externalLinkLabel}>View Original</Text>
          </View>
        </Pressable>
      </View>
    ));
  };

  return (
    <View style={[
      styles.container,
      {
        borderLeftWidth: !isMobile ? 1 : 0,
        backgroundColor: isDarkMode ? '#030712' : '#f9fafb',
        borderLeftColor: isDarkMode ? 'rgba(255,255,255,0.3)' : '#d1d5db'
      }
    ]}>
      {/* Header */}
      <View style={[
        styles.header,
        {
          backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
          borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb',
          paddingTop: isMobile ? 16 : 12
        }
      ]}>
        <View style={styles.headerTitleContainer}>
          <Text
            style={[
              styles.headerTitle,
              { fontSize: isMobile ? 18 : 24, color: isDarkMode ? '#ffffff' : '#111827' }
            ]}
            numberOfLines={1}
            selectable={true}
          >
            {location.lcpnap_name}
          </Text>
        </View>

        <View style={styles.headerActions}>
          {onEdit && (
            <Pressable onPress={onEdit} style={styles.headerButton}>
              <Edit width={24} height={24} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
            </Pressable>
          )}
          <Pressable onPress={onClose} style={styles.headerButton}>
            <X width={28} height={28} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.flex1} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {renderField('LCP Name', location.lcp_name)}
          {renderField('NAP Name', location.nap_name)}
          {location.street && renderField('Street', location.street)}
          {location.barangay && renderField('Barangay', location.barangay)}
          {location.city && renderField('City', location.city)}
          {location.region && renderField('Region', location.region)}
          {location.port_total !== undefined && renderField('Port Usage', `${location.total_technical_details || 0} / ${location.port_total}`)}
          
          {availablePortsList.length > 0 && renderField('Port Available', (
            <View style={styles.availablePortsContainer}>
              {availablePortsList.map((port, idx) => (
                <View key={idx} style={[styles.portChip, { backgroundColor: isDarkMode ? '#064e3b' : '#d1fae5' }]}>
                  <Text style={[styles.portChipText, { color: isDarkMode ? '#6ee7b7' : '#065f46' }]}>{port}</Text>
                </View>
              ))}
            </View>
          ))}

          {renderField('Related Customers', (
            <View style={styles.relatedCustomersContainer}>
              {isLoadingCustomers ? (
                <ActivityIndicator color={primaryColor} />
              ) : relatedCustomers.length > 0 ? (
                <View style={[styles.table, { borderColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                  {/* Table Header */}
                  <View style={[styles.tableHeader, { backgroundColor: isDarkMode ? '#1f2937' : '#f3f4f6' }]}>
                    <Text style={[styles.columnHeader, styles.colAccNo, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>Acc No</Text>
                    <Text style={[styles.columnHeader, styles.colName, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>Full Name</Text>
                    <Text style={[styles.columnHeader, styles.colPort, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>Port</Text>
                    <Text style={[styles.columnHeader, styles.colStatus, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>Status</Text>
                  </View>
                  {/* Table Rows */}
                  {paginatedCustomers.map((customer, index) => (
                    <View 
                      key={index} 
                      style={[
                        styles.tableRow, 
                        { borderTopColor: isDarkMode ? '#374151' : '#e5e7eb' },
                        index % 2 === 1 && { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }
                      ]}
                    >
                      <Text style={[styles.cellText, styles.colAccNo, { color: isDarkMode ? '#ffffff' : '#111827' }]} numberOfLines={1}>{customer.account_no}</Text>
                      <Text style={[styles.cellText, styles.colName, { color: isDarkMode ? '#ffffff' : '#111827' }]} numberOfLines={1}>{customer.full_name}</Text>
                      <Text style={[styles.cellText, styles.colPort, { color: isDarkMode ? '#ffffff' : '#111827' }]} numberOfLines={1}>{customer.port}</Text>
                      <View style={[styles.colStatus, styles.statusCell]}>
                        <View style={[
                          styles.statusBadgeSmall, 
                          { 
                            backgroundColor: customer.status === 'Online' ? '#dcfce7' : 
                                            customer.status === 'Offline' ? '#fee2e2' : '#f3f4f6' 
                          }
                        ]}>
                          <Text style={[
                            styles.statusBadgeTextSmall, 
                            { 
                              color: customer.status === 'Online' ? '#166534' : 
                                     customer.status === 'Offline' ? '#991b1b' : '#374151' 
                            }
                          ]}>
                            {customer.status || 'N/A'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                  
                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <View style={[styles.paginationContainer, { borderTopColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                      <Text style={[styles.paginationText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                        Page {currentPage + 1} of {totalPages}
                      </Text>
                      <View style={styles.paginationButtons}>
                        <Pressable 
                          onPress={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                          disabled={currentPage === 0}
                          style={[
                            styles.paginationButton,
                            { borderColor: isDarkMode ? '#374151' : '#e5e7eb' },
                            currentPage === 0 && { opacity: 0.3 }
                          ]}
                        >
                          <ChevronLeft size={20} color={isDarkMode ? '#ffffff' : '#111827'} />
                        </Pressable>
                        <Pressable 
                          onPress={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                          disabled={currentPage === totalPages - 1}
                          style={[
                            styles.paginationButton,
                            { borderColor: isDarkMode ? '#374151' : '#e5e7eb' },
                            currentPage === totalPages - 1 && { opacity: 0.3 }
                          ]}
                        >
                          <ChevronRight size={20} color={isDarkMode ? '#ffffff' : '#111827'} />
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
              ) : (
                <Text style={[styles.noDataText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>No related customers found</Text>
              )}
            </View>
          ))}

          {((location.active_sessions || 0) + (location.offline_sessions || 0) + (location.inactive_sessions || 0) + (location.blocked_sessions || 0) + (location.not_found_sessions || 0)) > 0 && renderField('Session Status', (
            <View style={styles.sessionGrid}>
              <View style={styles.sessionItem}>
                <Text style={[styles.sessionLabel, { color: '#22c55e' }]}>Online</Text>
                <View style={[styles.sessionBadge, { backgroundColor: isDarkMode ? '#14532d' : '#dcfce7' }]}>
                  <Text style={[styles.sessionBadgeText, { color: isDarkMode ? '#86efac' : '#166534' }]}>
                    {location.active_sessions || 0}
                  </Text>
                </View>
              </View>

              <View style={styles.sessionItem}>
                <Text style={[styles.sessionLabel, { color: '#fb923c' }]}>Offline</Text>
                <View style={[styles.sessionBadge, { backgroundColor: isDarkMode ? '#7c2d12' : '#ffedd5' }]}>
                  <Text style={[styles.sessionBadgeText, { color: isDarkMode ? '#fdba74' : '#9a3412' }]}>
                    {location.offline_sessions || 0}
                  </Text>
                </View>
              </View>

              <View style={styles.sessionItem}>
                <Text style={[styles.sessionLabel, { color: isDarkMode ? '#9ca3af' : '#4b5563' }]}>Inactive</Text>
                <View style={[styles.sessionBadge, { backgroundColor: isDarkMode ? '#374151' : '#f3f4f6' }]}>
                  <Text style={[styles.sessionBadgeText, { color: isDarkMode ? '#d1d5db' : '#1f2937' }]}>
                    {location.inactive_sessions || 0}
                  </Text>
                </View>
              </View>

              <View style={styles.sessionItem}>
                <Text style={[styles.sessionLabel, { color: '#ef4444' }]}>Blocked</Text>
                <View style={[styles.sessionBadge, { backgroundColor: isDarkMode ? '#7f1d1d' : '#fee2e2' }]}>
                  <Text style={[styles.sessionBadgeText, { color: isDarkMode ? '#fca5a5' : '#991b1b' }]}>
                    {location.blocked_sessions || 0}
                  </Text>
                </View>
              </View>

              <View style={styles.sessionItem}>
                <Text style={[styles.sessionLabel, { color: '#a855f7' }]}>Not Found</Text>
                <View style={[styles.sessionBadge, { backgroundColor: isDarkMode ? '#581c87' : '#f3e8ff' }]}>
                  <Text style={[styles.sessionBadgeText, { color: isDarkMode ? '#e9d5ff' : '#6b21a8' }]}>
                    {location.not_found_sessions || 0}
                  </Text>
                </View>
              </View>
            </View>
          ))}

          {renderField('Coordinates', (
            <View style={styles.coordinatesContainer}>
              <View style={styles.miniMapWrapper}>
                <WebView
                  scrollEnabled={false}
                  source={{
                    html: `
                      <!DOCTYPE html>
                      <html>
                      <head>
                          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
                          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                          <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                          <style>
                              body { margin: 0; padding: 0; background: ${isDarkMode ? '#1f2937' : '#f3f4f6'}; }
                              #map { height: 100vh; width: 100vw; }
                              .leaflet-marker-icon { border: 2px solid white; border-radius: 50%; background: ${(location.total_technical_details || 0) >= (location.port_total || 0) && (location.port_total || 0) > 0 ? '#ef4444' : '#22c55e'} !important; width: 12px !important; height: 12px !important; margin-left: -8px !important; margin-top: -8px !important; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
                              .leaflet-marker-shadow { display: none; }
                          </style>
                      </head>
                      <body>
                          <div id="map"></div>
                          <script>
                              var map = L.map('map', {
                                  zoomControl: false,
                                  attributionControl: false,
                                  dragging: false,
                                  touchZoom: false,
                                  doubleClickZoom: false,
                                  scrollWheelZoom: false,
                                  boxZoom: false
                              }).setView([${location.latitude}, ${location.longitude}], 16);
                              
                              L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                                  maxZoom: 19
                              }).addTo(map);

                              var greenIcon = L.divIcon({
                                  className: 'leaflet-marker-icon'
                              });

                              L.marker([${location.latitude}, ${location.longitude}], {icon: greenIcon}).addTo(map);
                          </script>
                      </body>
                      </html>
                    `
                  }}
                  style={styles.miniMap}
                />
              </View>
              <View style={styles.latLongRow}>
                <Text style={[styles.latLongLabel, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                  Lat & Long:
                </Text>
                <Text style={[styles.latLongValue, { color: isDarkMode ? '#ffffff' : '#111827' }]} selectable={true}>
                  {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                </Text>
              </View>
            </View>
          ))}

          {renderImageField('Reading Image', location.reading_image_url)}
          {renderImageField('Image 1', location.image1_url)}
          {renderImageField('Image 2', location.image2_url)}

          {location.modified_by && renderField('Modified By', location.modified_by)}
          {location.modified_date && renderField('Modified Date', formatDate(location.modified_date))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  header: {
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerButton: {
    padding: 4,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontWeight: '500',
  },
  flex1: {
    flex: 1,
  },
  content: {
    width: '100%',
    paddingVertical: 8,
  },
  fieldContainer: {
    flexDirection: 'column',
    borderBottomWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 2,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  fieldValueContainer: {
    width: '100%',
  },
  imageLinkContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  imageLinkText: {
    flex: 1,
    marginRight: 8,
  },
  sessionGrid: {
    flex: 1,
    gap: 8,
    marginTop: 4,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sessionLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  sessionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  sessionBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  imageContainer: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 8,
    position: 'relative',
    backgroundColor: '#1f2937',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  externalLinkOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  externalLinkContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  externalLinkLabel: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  imageLoader: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  coordinatesContainer: {
    marginTop: 8,
    gap: 12,
  },
  miniMapWrapper: {
    height: 150,
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  miniMap: {
    ...StyleSheet.absoluteFillObject,
  },
  miniMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  miniMarkerInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  latLongRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  latLongLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  latLongValue: {
    fontSize: 15,
  },
  relatedCustomersContainer: {
    marginTop: 4,
    width: '100%',
  },
  table: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    alignItems: 'center',
  },
  columnHeader: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  cellText: {
    fontSize: 13,
  },
  colAccNo: {
    flex: 2,
  },
  colName: {
    flex: 3,
  },
  colPort: {
    flex: 1,
    textAlign: 'center',
  },
  colStatus: {
    flex: 2,
    alignItems: 'flex-end',
  },
  statusCell: {
    justifyContent: 'center',
  },
  statusBadgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeTextSmall: {
    fontSize: 10,
    fontWeight: '700',
  },
  noDataText: {
    fontSize: 14,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  paginationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
  },
  paginationText: {
    fontSize: 12,
    fontWeight: '500',
  },
  paginationButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  paginationButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  availablePortsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  portChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  portChipText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
});

export default LcpNapLocationDetails;
