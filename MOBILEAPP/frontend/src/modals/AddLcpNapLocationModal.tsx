import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView, Modal, Alert,
  Image, Platform, KeyboardAvoidingView, StyleSheet, Keyboard, InteractionManager, ActivityIndicator, SafeAreaView, useWindowDimensions, DeviceEventEmitter
} from 'react-native';
import { Camera, CheckCircle, AlertCircle, Loader2, Search, Check, X, ChevronDown } from 'lucide-react-native';
import ImagePreview from '../components/ImagePreview';
import { FlashList } from '@shopify/flash-list';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { ensureLocationPermission } from '../services/locationConsent';
import { getRegions, getCities, City } from '../services/cityService';
import { barangayService, Barangay } from '../services/barangayService';
import { getActiveImageSize } from '../services/imageSettingsService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';
import { getAllLCPs, LCP } from '../services/lcpService';
import { getAllNAPs, NAP } from '../services/napService';
import { getAllLCPNAPs } from '../services/lcpnapService';
import { SearchablePicker, SearchablePickerTrigger } from '../components/SearchablePicker';

// ─── Interfaces ────────────────────────────────────────────────────────────────

interface AddLcpNapLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  editData?: any;
  /**
   * Coordinates to open with, as the stored "lat, lng" string. Supplied by the map's
   * pin-drop flow, which has already had the technician place and confirm the point.
   */
  initialCoordinates?: string;
  /**
   * Present the coordinates as settled: read-only field, and the preview map cannot
   * re-set them. The pin confirmed on the map is the answer.
   */
  lockCoordinates?: boolean;
}

interface Region { id: number; name: string; }
interface ApiResponse<T = any> { success: boolean; data?: T; message?: string; error?: string; }

interface FormDataState {
  reading_image: { uri: string; type: string; name: string } | null;
  street: string;
  barangay: string;
  city: string;
  region: string;
  lcp_name: string;
  nap_name: string;
  port_total: string;
  lcpnap_name: string;
  location: string;
  coordinates: string;
  image: { uri: string; type: string; name: string } | null;
  image_2: { uri: string; type: string; name: string } | null;
  modified_by: string;
}

// ─── Constants & Helpers ─────────────────────────────────────────────────────

const INITIAL_FORM: FormDataState = {
  reading_image: null,
  street: '',
  barangay: '',
  city: '',
  region: '',
  lcp_name: '',
  nap_name: '',
  port_total: '',
  lcpnap_name: '',
  location: '',
  coordinates: '',
  image: null,
  image_2: null,
  modified_by: '',
};

const INITIAL_PREVIEWS = { reading_image: null as string | null, image: null as string | null, image_2: null as string | null };

const getImageUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  if (url.includes('drive.google.com')) {
    const match = url.match(/\/d\/(.+?)(?:\/|$)/) || url.match(/id=(.+?)(?:&|$)/);
    if (match && match[1]) {
      return `https://lh3.googleusercontent.com/d/${match[1]}`;
    }
  }
  return url;
};

const LEAFLET_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>html,body,#map{height:100%;margin:0;padding:0;}</style>
  </head>
  <body>
    <div id="map"></div>
    <script>
      var map = L.map('map',{zoomControl:false}).setView([14.46658,121.201807],16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
      var marker = L.marker([14.46658,121.201807],{draggable:false}).addTo(map);
      map.on('click',function(e){
        marker.setLatLng([e.latlng.lat,e.latlng.lng]);
        window.ReactNativeWebView.postMessage(JSON.stringify({lat:e.latlng.lat,lng:e.latlng.lng}));
      });
      function handleUpdate(data){
        if(data&&data.type==='updateLocation'){map.setView([data.lat,data.lng],16);marker.setLatLng([data.lat,data.lng]);}
      }
      document.addEventListener('message',function(e){try{handleUpdate(typeof e.data==='string'?JSON.parse(e.data):e.data);}catch(err){}});
      window.postMessageCustom=function(data){handleUpdate(data);};
    </script>
  </body>
</html>`;

// ─── Sub-components ──────────────────────────────────────────────────────────

interface MiniModalItemProps {
  label: string;
  isSelected: boolean;
  onPress: (label: string) => void;
  isDarkMode: boolean;
  primaryColor: string;
}

const MiniModalItem = React.memo<MiniModalItemProps>(
  ({ label, isSelected, onPress, isDarkMode, primaryColor }) => (
    <Pressable
      onPress={() => onPress(label)}
      style={({ pressed }) => [
        styles.miniModalItem,
        { backgroundColor: pressed ? (isDarkMode ? 'rgba(124, 58, 237, 0.1)' : '#f3f4f6') : 'transparent' }
      ]}
    >
      <Text style={[styles.miniModalItemText, {
        color: isSelected ? primaryColor : (isDarkMode ? '#e5e7eb' : '#374151'),
        fontWeight: isSelected ? '700' : 'bold',
        flex: 1
      }]}>
        {label}
      </Text>
      {isSelected && <Check size={20} color={primaryColor} />}
    </Pressable>
  ),
);

interface MapSectionProps {
  onMapPress: (coords: { latitude: number; longitude: number }) => void;
  onGetMyLocation: () => void;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
  webViewRef: React.RefObject<any>;
  loading: boolean;
  onInteractionChange: (enabled: boolean) => void;
}

const MapSection = React.memo<MapSectionProps>(
  ({ onMapPress, onGetMyLocation, isDarkMode, colorPalette, webViewRef, loading, onInteractionChange }) => (
    <View 
      style={[styles.mapSectionWrapper, { borderColor: isDarkMode ? '#374151' : '#d1d5db' }]}
      onTouchStart={() => onInteractionChange(false)}
      onTouchEnd={() => onInteractionChange(true)}
      onTouchCancel={() => onInteractionChange(true)}
    >
      <WebView
        ref={webViewRef}
        source={{ html: LEAFLET_HTML }}
        style={styles.webView}
        javaScriptEnabled={true}
        scrollEnabled={false}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.lat && data.lng) onMapPress({ latitude: data.lat, longitude: data.lng });
          } catch (e) { /* ignore */ }
        }}
      />
      <View style={[styles.mapFooter, {
        backgroundColor: isDarkMode ? '#1f2937' : '#f3f4f6',
        borderTopColor: isDarkMode ? '#374151' : '#e5e7eb',
      }]}>
        <Text style={[styles.mapTip, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>Tap map to drop pin</Text>
        <Pressable
          onPress={onGetMyLocation}
          disabled={loading}
          style={[styles.locationBtn, {
            backgroundColor: loading ? (isDarkMode ? '#374151' : '#d1d5db') : (colorPalette?.primary || '#7c3aed'),
          }]}
        >
          <Text style={styles.locationBtnText}>
            {loading ? 'Locating...' : 'Get My Location'}
          </Text>
        </Pressable>
      </View>
    </View>
  ),
);

// ─── Main Component ────────────────────────────────────────────────────────────

const AddLcpNapLocationModal: React.FC<AddLcpNapLocationModalProps> = ({ isOpen, onClose, onSave, editData, initialCoordinates, lockCoordinates = false }) => {

  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [formData, setFormData] = useState<FormDataState>(INITIAL_FORM);
  const [imagePreviews, setImagePreviews] = useState(INITIAL_PREVIEWS);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [showResultModal, setShowResultModal] = useState(false);
  const [resultType, setResultType] = useState<'success' | 'error'>('success');
  const [resultMessage, setResultMessage] = useState('');
  const [lcpList, setLcpList] = useState<LCP[]>([]);
  const [napList, setNapList] = useState<NAP[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Barangay[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [isLcpMiniModalVisible, setIsLcpMiniModalVisible] = useState(false);
  const [lcpSearch, setLcpSearch] = useState('');

  const [isNapMiniModalVisible, setIsNapMiniModalVisible] = useState(false);
  const [napSearch, setNapSearch] = useState('');

  const webViewRef = useRef<WebView>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const [isContentReady, setIsContentReady] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  // Region Picker State
  const [isRegionPickerOpen, setIsRegionPickerOpen] = useState(false);
  const [regionSearch, setRegionSearch] = useState('');

  // City Picker State
  const [isCityPickerOpen, setIsCityPickerOpen] = useState(false);
  const [citySearch, setCitySearch] = useState('');

  // Barangay Picker State
  const [isBarangayPickerOpen, setIsBarangayPickerOpen] = useState(false);
  const [barangaySearch, setBarangaySearch] = useState('');

  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setIsContentReady(true);
    });
    return () => {
      handle.cancel();
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Small delay to prevent React 19 "static flag" error when mounting
      const timer = setTimeout(() => {
        DeviceEventEmitter.emit('techModalStateChange', true);
      }, 0);
      return () => {
        clearTimeout(timer);
        DeviceEventEmitter.emit('techModalStateChange', false);
      };
    }
  }, [isOpen]);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [theme, authData] = await Promise.all([
          AsyncStorage.getItem('theme'),
          AsyncStorage.getItem('authData'),
        ]);
        setIsDarkMode(theme === 'dark');
        if (authData) {
          const user = JSON.parse(authData);
          const email = user.email || user.email_address || '';
          setCurrentUserEmail(email);
          setFormData(prev => ({ ...prev, modified_by: email }));
        }
      } catch (e) {
        console.error('Bootstrap error:', e);
      }
    };
    bootstrap();
  }, []);

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => { });
  }, []);

  const loadDropdownData = useCallback(async () => {
    try {
      const [lcpRes, napRes, regionsData, citiesData, barangaysData] = await Promise.all([
        getAllLCPs(),
        getAllNAPs(),
        getRegions(),
        getCities(),
        barangayService.getAll(),
      ]);

      if (lcpRes.success) setLcpList(lcpRes.data || []);
      if (napRes.success) setNapList(napRes.data || []);

      const toArray = (d: any): any[] => Array.isArray(d) ? d : (d?.success && Array.isArray(d.data) ? d.data : []);
      setRegions(toArray(regionsData));
      setAllCities(toArray(citiesData));
      setAllBarangays(toArray(barangaysData));
    } catch (e) {
      console.error('Error loading dropdown data:', e);
    }
  }, []);

  useEffect(() => {
    loadDropdownData();
    if (editData) {
      setFormData({
        reading_image: null,
        street: editData.street || '',
        barangay: editData.barangay || '',
        city: editData.city || '',
        region: editData.region || '',
        lcp_name: editData.lcp_name || editData.lcp || '',
        nap_name: editData.nap_name || editData.nap || '',
        port_total: String(editData.port_total || ''),
        lcpnap_name: editData.lcpnap_name || '',
        location: editData.location || '',
        coordinates: editData.coordinates || `${editData.latitude}, ${editData.longitude}`,
        image: null,
        image_2: null,
        modified_by: currentUserEmail,
      });
      setImagePreviews({
        reading_image: getImageUrl(editData.reading_image_url),
        image: getImageUrl(editData.image1_url),
        image_2: getImageUrl(editData.image2_url),
      });
    } else {
      // A pin-drop hands the coordinates in already confirmed; seeded here so the blank
      // form does not wipe them.
      setFormData({ ...INITIAL_FORM, modified_by: currentUserEmail, coordinates: initialCoordinates || '' });
      setImagePreviews(INITIAL_PREVIEWS);
    }
    setErrors({});
  }, [loadDropdownData, currentUserEmail, editData, initialCoordinates]);

  useEffect(() => {
    if (formData.lcp_name && formData.nap_name) {
      setFormData(prev => ({ ...prev, lcpnap_name: `${formData.lcp_name} ${formData.nap_name}` }));
    }
  }, [formData.lcp_name, formData.nap_name]);

  useEffect(() => {
    const { street, barangay, city, region, lcpnap_name } = formData;
    const addr = [street, barangay, city, region].filter(Boolean).join(', ');
    setFormData(prev => ({ ...prev, location: addr || lcpnap_name || '' }));
  }, [formData.street, formData.barangay, formData.city, formData.region, formData.lcpnap_name]);

  const filteredCities = useMemo(() => {
    if (!formData.region) return [];
    const reg = regions.find(r => r.name === formData.region);
    return reg ? allCities.filter(c => c.region_id === reg.id) : [];
  }, [formData.region, regions, allCities]);

  const filteredBarangays = useMemo(() => {
    if (!formData.city) return [];
    const city = allCities.find(c => c.name === formData.city);
    return city ? allBarangays.filter(b => b.city_id === city.id) : [];
  }, [formData.city, allCities, allBarangays]);

  const filteredLcpList = useMemo(() => {
    const q = lcpSearch.toLowerCase();
    return q ? lcpList.filter(l => l.lcp_name?.toLowerCase().includes(q)) : lcpList;
  }, [lcpList, lcpSearch]);

  const filteredNapList = useMemo(() => {
    const q = napSearch.toLowerCase();
    return q ? napList.filter(n => n.nap_name?.toLowerCase().includes(q)) : napList;
  }, [napList, napSearch]);

  const handleLcpItemPress = useCallback((name: string) => {
    setFormData(prev => ({ ...prev, lcp_name: name }));
    setIsLcpMiniModalVisible(false);
    setLcpSearch('');
    Keyboard.dismiss();
  }, []);

  const handleNapItemPress = useCallback((name: string) => {
    setFormData(prev => ({ ...prev, nap_name: name }));
    setIsNapMiniModalVisible(false);
    setNapSearch('');
    Keyboard.dismiss();
  }, []);

  const handleMapPress = useCallback(({ latitude, longitude }: { latitude: number; longitude: number }) => {
    // Locked coordinates came from a confirmed pin drop — the preview map stays a preview.
    if (lockCoordinates) return;
    setFormData(prev => ({ ...prev, coordinates: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` }));
  }, [lockCoordinates]);

  const handleGetMyLocation = useCallback(async () => {
    if (lockCoordinates) return;
    setLoading(true);
    try {
      // Shows the in-app location disclosure before the OS prompt, then requests.
      const granted = await ensureLocationPermission();
      if (!granted) return;
      const loc = await Location.getCurrentPositionAsync({});
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;
      setFormData(prev => ({ ...prev, coordinates: `${lat.toFixed(6)}, ${lng.toFixed(6)}` }));
      const msg = JSON.stringify({ type: 'updateLocation', lat, lng });
      webViewRef.current?.injectJavaScript(`if(window.postMessageCustom){window.postMessageCustom(${msg});}true;`);
    } catch (e) {
      console.error('Location error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleImageUpload = useCallback((field: 'reading_image' | 'image' | 'image_2', file: any) => {
    setFormData(prev => ({ ...prev, [field]: file }));
    setImagePreviews(prev => ({ ...prev, [field]: file ? file.uri : null }));
    setErrors(prev => prev[field] ? { ...prev, [field]: '' } : prev);
  }, []);

  const handleSubmit = async () => {
    const newErrors: Record<string, string> = {};
    if (!formData.lcpnap_name.trim()) newErrors.lcpnap_name = 'Required';
    if (!formData.street.trim()) newErrors.street = 'Required';
    if (!formData.region) newErrors.region = 'Required';
    if (!formData.city) newErrors.city = 'Required';
    if (!formData.barangay) newErrors.barangay = 'Required';
    if (!formData.lcp_name) newErrors.lcp_name = 'Required';
    if (!formData.nap_name) newErrors.nap_name = 'Required';
    if (!formData.port_total) newErrors.port_total = 'Required';
    if (!formData.coordinates.trim()) newErrors.coordinates = 'Required';
    if (!formData.reading_image) newErrors.reading_image = 'Required';
    if (!formData.image) newErrors.image = 'Required';
    if (!formData.image_2) newErrors.image_2 = 'Required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    setShowLoadingModal(true);
    setLoadingPercentage(0);

    progressIntervalRef.current = setInterval(() => {
      setLoadingPercentage(p => p >= 99 ? 99 : p + (p >= 70 ? 1 : 3));
    }, 200);

    try {
      // Check for duplicate lcpnap_name before submitting (skip if editing the same record)
      if (!editData || editData.lcpnap_name !== formData.lcpnap_name) {
        try {
          const existingRes = await getAllLCPNAPs(formData.lcpnap_name, 1, 10);
          if (existingRes.success && Array.isArray(existingRes.data)) {
            const duplicate = existingRes.data.find(
              (item: any) => (item.lcpnap_name || '').toLowerCase() === formData.lcpnap_name.toLowerCase()
            );
            if (duplicate) {
              if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
              setShowLoadingModal(false);
              setLoading(false);
              setResultType('error');
              setResultMessage(`LCPNAP Name "${formData.lcpnap_name}" already exists.`);
              setShowResultModal(true);
              return;
            }
          }
        } catch (checkErr) {
          // If the check fails, proceed with submission and let the server validate
          console.error('Duplicate check failed, proceeding:', checkErr);
        }
      }

      const submitData = new FormData();
      // Resolve IDs from names
      const selectedLcp = lcpList.find(l => l.lcp_name === formData.lcp_name);
      const selectedNap = napList.find(n => n.nap_name === formData.nap_name);

      if (formData.reading_image) submitData.append('reading_image', formData.reading_image as any);
      submitData.append('street', formData.street);
      submitData.append('barangay', formData.barangay);
      submitData.append('city', formData.city);
      submitData.append('region', formData.region);
      submitData.append('lcp_id', selectedLcp?.id.toString() || '');
      submitData.append('nap_id', selectedNap?.id.toString() || '');
      submitData.append('lcp_name', formData.lcp_name);
      submitData.append('nap_name', formData.nap_name);
      submitData.append('port_total', formData.port_total);
      submitData.append('lcpnap_name', formData.lcpnap_name);
      submitData.append('location', formData.location || formData.lcpnap_name);
      submitData.append('coordinates', formData.coordinates);
      if (formData.image) submitData.append('image', formData.image as any);
      if (formData.image_2) submitData.append('image_2', formData.image_2 as any);
      submitData.append('modified_by', formData.modified_by);

      const url = editData ? `/lcpnap/${editData.id}` : '/lcpnap';
      const method = editData ? 'post' : 'post'; // Using POST with _method PUT for multipart compatibility if needed
      if (editData) submitData.append('_method', 'PUT');

      const response = await apiClient.post<ApiResponse>(url, submitData, { headers: { 'Content-Type': 'multipart/form-data' } });

      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (!response.data.success) throw new Error(response.data.message || 'Failed to save');

      setLoadingPercentage(100);
      await new Promise(r => setTimeout(r, 400));
      setShowLoadingModal(false);
      setResultType('success');
      setResultMessage(editData ? 'LCP/NAP location updated successfully' : 'LCP/NAP location created successfully');
      setShowResultModal(true);

      setTimeout(() => {
        setShowResultModal(false);
        if (onSave) onSave();
        onClose();
      }, 2000);

    } catch (error: any) {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setShowLoadingModal(false);
      setResultType('error');

      const data = error?.response?.data;
      const message = data?.message || error?.message || 'Failed to save';

      if (message.toLowerCase().includes('already exist') || message.toLowerCase().includes('duplicate') || message.toLowerCase().includes('existing')) {
        setResultMessage(`LCPNAP Name ${formData.lcpnap_name} already existing`);
      } else {
        let details = '';
        if (data?.errors) {
          details = Object.entries(data.errors)
            .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(', ') : val}`)
            .join('\n');
        }
        setResultMessage(`Error: ${message}${details ? `\n\n${details}` : ''}`);
      }

      setShowResultModal(true);
    } finally {
      setLoading(false);
    }
  };

  const regionOptions = useMemo(() => regions.map(r => ({ label: r.name, value: r.name })), [regions]);
  const cityOptions = useMemo(() => filteredCities.map(c => ({ label: c.name, value: c.name })), [filteredCities]);
  const barangayOptions = useMemo(() => filteredBarangays.map(b => ({ label: b.barangay, value: b.barangay })), [filteredBarangays]);

  if (!isOpen) return null;

  return (
    <SafeAreaView style={[styles.pageContainer, { backgroundColor: isDarkMode ? '#111827' : '#f9fafb' }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex1}>
        <View style={[styles.modalContainer, { backgroundColor: isDarkMode ? '#111827' : '#f9fafb' }]}>
          <View style={[styles.header, { 
            backgroundColor: isDarkMode ? '#1f2937' : '#ffffff', 
            borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb',
            paddingTop: isTablet ? 16 : 60
          }]}>
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>LCPNAP Form</Text>
            <View style={styles.headerActions}>
              <Pressable onPress={onClose} disabled={loading} style={[styles.cancelButton, { borderColor: primaryColor, opacity: loading ? 0.6 : 1 }]}>
                <Text style={[styles.cancelButtonText, { color: primaryColor }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSubmit} disabled={loading} style={[styles.submitButton, { backgroundColor: primaryColor }]}>
                <Text style={styles.submitButtonText}>{loading ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView 
            style={styles.contentContainer} 
            contentContainerStyle={styles.scrollViewContent} 
            showsVerticalScrollIndicator={false} 
            nestedScrollEnabled 
            keyboardShouldPersistTaps="handled"
            scrollEnabled={scrollEnabled}
          >
            {!isContentReady ? (
              <View style={styles.loaderContainer}><ActivityIndicator size="large" color={primaryColor} /></View>
            ) : (
              <View style={{ gap: 16 }}>
                <View>
                  <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ffffff' : '#111827' }]}>Street<Text style={{ color: '#ef4444' }}>*</Text></Text>
                  <TextInput value={formData.street} onChangeText={t => setFormData(p => ({ ...p, street: t }))} style={[styles.input, { borderColor: errors.street ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'), backgroundColor: isDarkMode ? '#1f2937' : '#ffffff', color: isDarkMode ? '#ffffff' : '#111827' }]} placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'} placeholder="Enter street" />
                  {errors.street && <Text style={styles.errorText}>{errors.street}</Text>}
                </View>
                <SearchablePickerTrigger
                  label="Region"
                  value={formData.region}
                  onPress={() => setIsRegionPickerOpen(true)}
                  required
                  error={errors.region}
                  isDarkMode={isDarkMode}
                  placeholder="Select Region"
                />
                <SearchablePickerTrigger
                  label="City"
                  value={formData.city}
                  onPress={() => formData.region && setIsCityPickerOpen(true)}
                  required
                  error={errors.city}
                  isDarkMode={isDarkMode}
                  placeholder={formData.region ? "Select City" : "Select Region first"}
                />
                <SearchablePickerTrigger
                  label="Barangay"
                  value={formData.barangay}
                  onPress={() => formData.city && setIsBarangayPickerOpen(true)}
                  required
                  error={errors.barangay}
                  isDarkMode={isDarkMode}
                  placeholder={formData.city ? "Select Barangay" : "Select City first"}
                />
                <View>
                  <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ffffff' : '#111827' }]}>LCP<Text style={{ color: '#ef4444' }}>*</Text></Text>
                  <Pressable onPress={() => { setIsLcpMiniModalVisible(true); setLcpSearch(''); }} style={[styles.pickerTrigger, { borderColor: errors.lcp_name ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'), backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
                    <Text style={{
                      color: formData.lcp_name ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#6b7280' : '#9ca3af'),
                      fontSize: formData.lcp_name ? 24 : 16,
                      fontWeight: formData.lcp_name ? 'bold' : 'normal'
                    }}>{formData.lcp_name || 'Select LCP'}</Text>
                    <ChevronDown size={24} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
                  </Pressable>
                  {errors.lcp_name && <Text style={styles.errorText}>{errors.lcp_name}</Text>}
                </View>
                <View>
                  <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ffffff' : '#111827' }]}>NAP<Text style={{ color: '#ef4444' }}>*</Text></Text>
                  <Pressable onPress={() => { setIsNapMiniModalVisible(true); setNapSearch(''); }} style={[styles.pickerTrigger, { borderColor: errors.nap_name ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'), backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
                    <Text style={{
                      color: formData.nap_name ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#6b7280' : '#9ca3af'),
                      fontSize: formData.nap_name ? 24 : 16,
                      fontWeight: formData.nap_name ? 'bold' : 'normal'
                    }}>{formData.nap_name || 'Select NAP'}</Text>
                    <ChevronDown size={24} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
                  </Pressable>
                  {errors.nap_name && <Text style={styles.errorText}>{errors.nap_name}</Text>}
                </View>
                <View>
                  <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ffffff' : '#111827' }]}>PORT TOTAL<Text style={{ color: '#ef4444' }}>*</Text></Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {(['8', '16', '32'] as const).map(val => {
                      const isActive = formData.port_total === val;
                      return (
                        <Pressable key={val} onPress={() => setFormData(p => ({ ...p, port_total: val }))} style={[styles.portBtn, { borderColor: isActive ? primaryColor : (isDarkMode ? '#374151' : '#d1d5db'), backgroundColor: isActive ? primaryColor : (isDarkMode ? '#1f2937' : '#ffffff'), borderWidth: isActive ? 2 : 1 }]}>
                          <Text style={{ color: isActive ? '#ffffff' : (isDarkMode ? '#d1d5db' : '#374151'), fontWeight: isActive ? '700' : '400' }}>{val}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {errors.port_total && <Text style={styles.errorText}>{errors.port_total}</Text>}
                </View>
                <View>
                  <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ffffff' : '#111827' }]}>LCPNAP NAME</Text>
                  <TextInput value={formData.lcpnap_name} editable={false} style={[styles.input, { backgroundColor: isDarkMode ? '#111827' : '#f3f4f6', color: isDarkMode ? '#9ca3af' : '#6b7280' }]} placeholder="Auto-generated" />
                </View>
                <View>
                  <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ffffff' : '#111827' }]}>Coordinates<Text style={{ color: '#ef4444' }}>*</Text></Text>
                  <TextInput value={formData.coordinates} onChangeText={t => setFormData(p => ({ ...p, coordinates: t }))} editable={!lockCoordinates} style={[styles.input, { borderColor: errors.coordinates ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'), backgroundColor: lockCoordinates ? (isDarkMode ? '#111827' : '#f3f4f6') : (isDarkMode ? '#1f2937' : '#ffffff'), color: lockCoordinates ? (isDarkMode ? '#9ca3af' : '#6b7280') : (isDarkMode ? '#ffffff' : '#111827') }]} placeholder="14.466580, 121.201807" />
                  {lockCoordinates && (
                    <Text style={[styles.mapTip, { color: isDarkMode ? '#9ca3af' : '#6b7280', marginTop: 4 }]}>
                      Pinned on the map. Cancel and drop a new pin to move it.
                    </Text>
                  )}
                  <MapSection onMapPress={handleMapPress} onGetMyLocation={handleGetMyLocation} isDarkMode={isDarkMode} colorPalette={colorPalette} webViewRef={webViewRef} loading={loading} onInteractionChange={setScrollEnabled} />
                </View>
                <ImagePreview
                  label="Reading Image"
                  imageUrl={imagePreviews.reading_image}
                  required={true}
                  onUpload={(file) => handleImageUpload('reading_image', file)}
                  error={errors.reading_image}
                  isDarkMode={isDarkMode}
                  colorPrimary={primaryColor}
                />
                <ImagePreview
                  label="Image"
                  imageUrl={imagePreviews.image}
                  required={true}
                  onUpload={(file) => handleImageUpload('image', file)}
                  error={errors.image}
                  isDarkMode={isDarkMode}
                  colorPrimary={primaryColor}
                />
                <ImagePreview
                  label="Image 2"
                  imageUrl={imagePreviews.image_2}
                  required={true}
                  onUpload={(file) => handleImageUpload('image_2', file)}
                  error={errors.image_2}
                  isDarkMode={isDarkMode}
                  colorPrimary={primaryColor}
                />
                <View>
                  <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ffffff' : '#111827' }]}>Modified By</Text>
                  <TextInput value={formData.modified_by} editable={false} style={[styles.input, { backgroundColor: isDarkMode ? '#111827' : '#f3f4f6', color: '#9ca3af' }]} />
                </View>
              </View>
            )}
          </ScrollView>

          {showLoadingModal && (
            <View style={styles.inModalOverlay}>
              <View style={[styles.resultCard, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
                <Loader2 width={72} height={72} color={primaryColor} />
                <Text style={{ fontSize: 32, fontWeight: 'bold', marginTop: 16, color: isDarkMode ? '#ffffff' : '#111827' }}>{Math.floor(loadingPercentage)}%</Text>
              </View>
            </View>
          )}

          {showResultModal && (
            <View style={styles.inModalOverlay}>
              <View style={[styles.resultCard, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
                {resultType === 'success' ? (
                  <>
                    <CheckCircle width={64} height={64} color="#22c55e" />
                    <Text style={{ fontSize: 20, fontWeight: '600', marginTop: 12, color: isDarkMode ? '#ffffff' : '#111827' }}>Success!</Text>
                    <Text style={{ textAlign: 'center', marginTop: 8, color: isDarkMode ? '#d1d5db' : '#374151' }}>{resultMessage}</Text>
                  </>
                ) : (
                  <>
                    <AlertCircle width={64} height={64} color="#ef4444" />
                    <Text style={{ fontSize: 20, fontWeight: '600', marginTop: 12, color: isDarkMode ? '#ffffff' : '#111827' }}>Error</Text>
                    <Text style={{ textAlign: 'center', marginTop: 8, color: isDarkMode ? '#d1d5db' : '#374151' }}>{resultMessage}</Text>
                    <Pressable onPress={() => setShowResultModal(false)} style={{ marginTop: 16, paddingHorizontal: 24, paddingVertical: 8, backgroundColor: primaryColor, borderRadius: 6 }}>
                      <Text style={{ color: '#ffffff' }}>Close</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          )}

          <Modal visible={isLcpMiniModalVisible} transparent animationType="fade" onRequestClose={() => setIsLcpMiniModalVisible(false)}>
            <View style={styles.miniModalOverlay}>
              <View style={[styles.miniModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
                <View style={[styles.miniModalHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                  <Text style={[styles.miniModalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>Select LCP</Text>
                  <Pressable onPress={() => setIsLcpMiniModalVisible(false)}><X size={24} color={isDarkMode ? '#9CA3AF' : '#4B5563'} /></Pressable>
                </View>
                <View style={styles.miniModalSearchContainer}>
                  <View style={[styles.searchContainer, { backgroundColor: isDarkMode ? '#111827' : '#f9fafb', borderColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                    <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                    <TextInput placeholder="Search LCP..." value={lcpSearch} onChangeText={setLcpSearch} placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'} style={[styles.searchInput, { color: isDarkMode ? '#ffffff' : '#111827' }]} autoFocus />
                  </View>
                </View>
                <View style={{ height: 350, width: '100%' }}>
                  <FlashList data={filteredLcpList} extraData={{ selectedValue: formData.lcp_name, onPress: handleLcpItemPress, isDarkMode, primaryColor }} keyExtractor={i => String(i.id)} renderItem={({ item, extraData }) => <MiniModalItem label={item.lcp_name} isSelected={extraData.selectedValue === item.lcp_name} onPress={extraData.onPress} isDarkMode={extraData.isDarkMode} primaryColor={extraData.primaryColor} />} ListEmptyComponent={<View style={styles.miniModalEmpty}><Text style={{ color: isDarkMode ? '#9CA3AF' : '#4B5563' }}>No results</Text></View>} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }} />
                </View>
              </View>
            </View>
          </Modal>

          <Modal visible={isNapMiniModalVisible} transparent animationType="fade" onRequestClose={() => setIsNapMiniModalVisible(false)}>
            <View style={styles.miniModalOverlay}>
              <View style={[styles.miniModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
                <View style={[styles.miniModalHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                  <Text style={[styles.miniModalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>Select NAP</Text>
                  <Pressable onPress={() => setIsNapMiniModalVisible(false)}><X size={24} color={isDarkMode ? '#9CA3AF' : '#4B5563'} /></Pressable>
                </View>
                <View style={styles.miniModalSearchContainer}>
                  <View style={[styles.searchContainer, { backgroundColor: isDarkMode ? '#111827' : '#f9fafb', borderColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                    <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                    <TextInput placeholder="Search NAP..." value={napSearch} onChangeText={setNapSearch} placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'} style={[styles.searchInput, { color: isDarkMode ? '#ffffff' : '#111827' }]} autoFocus />
                  </View>
                </View>
                <View style={{ height: 350, width: '100%' }}>
                  <FlashList data={filteredNapList} extraData={{ selectedValue: formData.nap_name, onPress: handleNapItemPress, isDarkMode, primaryColor }} keyExtractor={i => String(i.id)} renderItem={({ item, extraData }) => <MiniModalItem label={item.nap_name} isSelected={extraData.selectedValue === item.nap_name} onPress={extraData.onPress} isDarkMode={extraData.isDarkMode} primaryColor={extraData.primaryColor} />} ListEmptyComponent={<View style={styles.miniModalEmpty}><Text style={{ color: isDarkMode ? '#9CA3AF' : '#4B5563' }}>No results</Text></View>} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }} />
                </View>
              </View>
            </View>
          </Modal>

          <SearchablePicker
            isOpen={isRegionPickerOpen}
            onClose={() => setIsRegionPickerOpen(false)}
            title="Select Region"
            data={regionOptions.filter(opt => opt.label.toLowerCase().includes(regionSearch.toLowerCase()))}
            onSelect={(item) => {
              setFormData(p => ({ ...p, region: item.value, city: '', barangay: '' }));
              setIsRegionPickerOpen(false);
              setRegionSearch('');
            }}
            keyExtractor={(item) => item.value}
            searchValue={regionSearch}
            onSearchChange={setRegionSearch}
            isDarkMode={isDarkMode}
            activeColor={primaryColor}
            selectedItemValue={formData.region}
          />

          <SearchablePicker
            isOpen={isCityPickerOpen}
            onClose={() => setIsCityPickerOpen(false)}
            title="Select City"
            data={cityOptions.filter(opt => opt.label.toLowerCase().includes(citySearch.toLowerCase()))}
            onSelect={(item) => {
              setFormData(p => ({ ...p, city: item.value, barangay: '' }));
              setIsCityPickerOpen(false);
              setCitySearch('');
            }}
            keyExtractor={(item) => item.value}
            searchValue={citySearch}
            onSearchChange={setCitySearch}
            isDarkMode={isDarkMode}
            activeColor={primaryColor}
            selectedItemValue={formData.city}
          />

          <SearchablePicker
            isOpen={isBarangayPickerOpen}
            onClose={() => setIsBarangayPickerOpen(false)}
            title="Select Barangay"
            data={barangayOptions.filter(opt => opt.label.toLowerCase().includes(barangaySearch.toLowerCase()))}
            onSelect={(item) => {
              setFormData(p => ({ ...p, barangay: item.value }));
              setIsBarangayPickerOpen(false);
              setBarangaySearch('');
            }}
            keyExtractor={(item) => item.value}
            searchValue={barangaySearch}
            onSearchChange={setBarangaySearch}
            isDarkMode={isDarkMode}
            activeColor={primaryColor}
            selectedItemValue={formData.barangay}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  pageContainer: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  flex1: { flex: 1 },
  modalContainer: { flex: 1, width: '100%', overflow: 'hidden' },
  header: { paddingHorizontal: 24, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cancelButton: { paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderRadius: 8 },
  cancelButtonText: { fontSize: 14, fontWeight: '500' },
  submitButton: { paddingHorizontal: 24, paddingVertical: 8, borderRadius: 8 },
  submitButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '500' },
  contentContainer: { flex: 1 },
  scrollViewContent: { padding: 24, paddingBottom: 48 },
  loaderContainer: { height: 400, alignItems: 'center', justifyContent: 'center' },
  fieldContainer: { marginBottom: 4 },
  fieldLabel: { fontSize: 14, fontWeight: '500', marginBottom: 8 },
  input: { width: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1, fontSize: 16 },
  imageUploadBox: { width: '100%', height: 160, borderWidth: 1, borderRadius: 4, overflow: 'hidden' },
  fullSize: { width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
  uploadedBadge: { position: 'absolute', bottom: 8, right: 8, backgroundColor: '#22c55e', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, flexDirection: 'row', alignItems: 'center' },
  uploadedText: { color: '#ffffff', fontSize: 12, marginLeft: 4 },
  uploadPlaceholder: { fontSize: 14, marginTop: 8 },
  errorText: { color: '#ef4444', fontSize: 12, marginTop: 4 },
  pickerContainer: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  errorBullet: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  errorBulletText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  errorDetailText: { fontSize: 12 },
  pickerTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, borderWidth: 1 },
  portBtn: { flex: 1, paddingVertical: 12, borderRadius: 6, alignItems: 'center' },
  mapSectionWrapper: { marginTop: 12, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  webView: { width: '100%', height: 250 },
  mapFooter: { paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mapTip: { fontSize: 12 },
  locationBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 },
  locationBtnText: { color: '#fff', fontSize: 12, fontWeight: '500' },
  inModalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
  resultCard: { borderRadius: 12, padding: 32, alignItems: 'center', minWidth: 280, maxWidth: 380 },
  miniModalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  miniModalContent: { width: '100%', maxWidth: 400, maxHeight: '80%', borderRadius: 12, overflow: 'hidden' },
  miniModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  miniModalTitle: { fontSize: 18, fontWeight: '600' },
  miniModalSearchContainer: { padding: 12 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 16, paddingVertical: 8 },
  miniModalItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40, borderBottomWidth: 0.5, borderBottomColor: '#f3f4f6' },
  miniModalItemText: { fontSize: 24, fontWeight: 'bold' },
  miniModalEmpty: { padding: 24, alignItems: 'center' },
});

export default AddLcpNapLocationModal;
