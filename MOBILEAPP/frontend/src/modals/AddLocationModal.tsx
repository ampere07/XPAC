import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, Switch, ActivityIndicator, useWindowDimensions } from 'react-native';
import { X } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createRegion,
  createCity,
  createBarangay,
  getRegions,
  getCities,
  getBoroughs,
  Region,
  City,
  Borough,
} from '../services/cityService';
import { Picker } from '@react-native-picker/picker';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

interface LocationFormData {
  regionId: number | null;
  cityId: number | null;
  barangayId: number | null;
}

interface AddLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (locationData: any) => void;
  initialLocationType?: 'region' | 'city' | 'barangay';
}

const AddLocationModal: React.FC<AddLocationModalProps> = ({ isOpen, onClose, onSave }) => {
  const [formData, setFormData] = useState<LocationFormData & { is_active: boolean }>({
    regionId: null,
    cityId: null,
    barangayId: null,
    is_active: true,
  });

  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  const [newRegionName, setNewRegionName] = useState('');
  const [newCityName, setNewCityName] = useState('');
  const [newBarangayName, setNewBarangayName] = useState('');

  const [showNewRegionInput, setShowNewRegionInput] = useState(false);
  const [showNewCityInput, setShowNewCityInput] = useState(false);
  const [showNewBarangayInput, setShowNewBarangayInput] = useState(false);

  const [allRegions, setAllRegions] = useState<Region[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Borough[]>([]);

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [globalModal, setGlobalModal] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({ isOpen: false, type: 'loading', title: '', message: '' });

  const { width } = useWindowDimensions();
  const panelWidth = width >= 768 ? Math.min(width, 640) : width;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  const showGlobalModal = (type: typeof globalModal.type, title: string, message: string, onConfirm?: () => void) => {
    setGlobalModal({ isOpen: true, type, title, message, onConfirm });
  };
  const closeGlobalModal = () => setGlobalModal((prev) => ({ ...prev, isOpen: false }));

  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        setColorPalette(await settingsColorPaletteService.getActive());
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();
  }, []);

  useEffect(() => {
    if (isOpen) fetchAllLocationData();
  }, [isOpen]);

  const fetchAllLocationData = async () => {
    setDataLoading(true);
    try {
      const [regions, cities, barangays] = await Promise.all([getRegions(), getCities(), getBoroughs()]);
      setAllRegions(regions);
      setAllCities(cities);
      setAllBarangays(barangays);
    } catch (error) {
      console.error('Error fetching location data:', error);
    } finally {
      setDataLoading(false);
    }
  };

  const filteredCities = useMemo(
    () => (formData.regionId ? allCities.filter((c) => c.region_id === formData.regionId) : []),
    [formData.regionId, allCities]
  );
  const filteredBarangays = useMemo(
    () => (formData.cityId ? allBarangays.filter((b) => b.city_id === formData.cityId) : []),
    [formData.cityId, allBarangays]
  );

  const handleRegionChange = (value: string) => {
    if (value === 'add_new') {
      setShowNewRegionInput(true);
      setFormData((p) => ({ ...p, regionId: null, cityId: null, barangayId: null }));
    } else {
      setShowNewRegionInput(false);
      setFormData((p) => ({ ...p, regionId: value ? parseInt(value) : null, cityId: null, barangayId: null }));
    }
  };

  const handleCityChange = (value: string) => {
    if (value === 'add_new') {
      setShowNewCityInput(true);
      setFormData((p) => ({ ...p, cityId: null, barangayId: null }));
    } else {
      setShowNewCityInput(false);
      setFormData((p) => ({ ...p, cityId: value ? parseInt(value) : null, barangayId: null }));
    }
  };

  const handleBarangayChange = (value: string) => {
    if (value === 'add_new') {
      setShowNewBarangayInput(true);
      setFormData((p) => ({ ...p, barangayId: null }));
    } else {
      setShowNewBarangayInput(false);
      setFormData((p) => ({ ...p, barangayId: value ? parseInt(value) : null }));
    }
  };

  const handleSave = async () => {
    if (!formData.regionId && !showNewRegionInput) {
      showGlobalModal('warning', 'Required Information', 'Region is required');
      return;
    }

    setLoading(true);
    showGlobalModal('loading', 'Saving Location', 'Creating your new location...');

    try {
      const authData = await AsyncStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;
      const organizationId = currentUser?.organization_id ?? null;
      const userEmail = currentUser?.email || currentUser?.email_address || '';
      const orgPart = organizationId ? { organization_id: organizationId } : {};

      const createdLocations: string[] = [];

      let regionId = formData.regionId;
      if (showNewRegionInput) {
        if (!newRegionName.trim()) {
          showGlobalModal('warning', 'Required Information', 'Please enter a region name');
          setLoading(false);
          return;
        }
        const newRegion = await createRegion({ name: newRegionName });
        regionId = newRegion.id;
        createdLocations.push(`Region: ${newRegionName}`);
      }

      let cityId = formData.cityId;
      if (showNewCityInput && regionId) {
        if (!newCityName.trim()) {
          showGlobalModal('warning', 'Required Information', 'Please enter a city name');
          setLoading(false);
          return;
        }
        const newCity = await createCity({ name: newCityName, region_id: regionId });
        cityId = newCity.id;
        createdLocations.push(`City: ${newCityName}`);
      }

      if (showNewBarangayInput && cityId) {
        if (!newBarangayName.trim()) {
          showGlobalModal('warning', 'Required Information', 'Please enter a barangay name');
          setLoading(false);
          return;
        }
        await createBarangay({ name: newBarangayName, city_id: cityId });
        createdLocations.push(`Barangay: ${newBarangayName}`);
      }

      showGlobalModal(
        'success',
        'Success',
        `Successfully created:\n${createdLocations.length > 0 ? createdLocations.join('\n') : 'Location updated successfully'}`,
        () => {
          closeGlobalModal();
          onSave(formData);
          handleClose();
        }
      );
    } catch (error: any) {
      console.error('Error creating location:', error);
      showGlobalModal('error', 'Error', error.response?.data?.message || error.message || 'Failed to create location. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({ regionId: null, cityId: null, barangayId: null, is_active: true });
    setShowNewRegionInput(false);
    setShowNewCityInput(false);
    setShowNewBarangayInput(false);
    setNewRegionName('');
    setNewCityName('');
    setNewBarangayName('');
    onClose();
  };

  const pickerWrap = { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden' as const, backgroundColor: '#ffffff' };
  const newInputStyle = { width: '100%' as const, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 6, borderColor: primaryColor, color: '#111827', backgroundColor: '#ffffff' };
  const labelStyle = { fontSize: 14, fontWeight: '500' as const, color: '#374151', marginBottom: 8 };

  const NewNameRow: React.FC<{ value: string; onChangeText: (t: string) => void; placeholder: string; onCancel: () => void }> = ({ value, onChangeText, placeholder, onCancel }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#9ca3af" autoFocus style={[newInputStyle, { flex: 1 }]} />
      <TouchableOpacity onPress={onCancel} style={{ padding: 8 }}>
        <X size={18} color="#6b7280" />
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal visible={isOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', flexDirection: 'row', justifyContent: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} style={{ flex: 1 }} onPress={handleClose} />
        <View style={{ width: panelWidth, height: '100%', backgroundColor: '#ffffff' }}>
          {/* Header */}
          <View style={{ paddingHorizontal: 24, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: '#f3f4f6' }}>
            <Text style={{ fontSize: 20, fontWeight: '600', color: '#111827' }}>Add Location</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity onPress={handleClose} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: '#e5e7eb' }}>
                <Text style={{ fontSize: 14, color: '#111827' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSave} disabled={loading} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: primaryColor, opacity: loading ? 0.5 : 1 }}>
                <Text style={{ fontSize: 14, color: '#ffffff' }}>{loading ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
            {dataLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 48 }}>
                <ActivityIndicator size="large" color={primaryColor} />
              </View>
            ) : (
              <>
                {/* Region */}
                <View>
                  <Text style={labelStyle}>Region<Text style={{ color: '#ef4444' }}> *</Text></Text>
                  {showNewRegionInput ? (
                    <NewNameRow value={newRegionName} onChangeText={setNewRegionName} placeholder="Enter new region name" onCancel={() => { setShowNewRegionInput(false); setNewRegionName(''); }} />
                  ) : (
                    <View style={pickerWrap}>
                      <Picker selectedValue={formData.regionId?.toString() || ''} onValueChange={handleRegionChange} style={{ color: '#111827' }} dropdownIconColor="#6b7280">
                        <Picker.Item label="Select Region" value="" />
                        {allRegions.map((r) => (
                          <Picker.Item key={r.id} label={r.name} value={r.id.toString()} />
                        ))}
                        <Picker.Item label="+ Add New Region" value="add_new" />
                      </Picker>
                    </View>
                  )}
                </View>

                {/* City */}
                <View>
                  <Text style={labelStyle}>City<Text style={{ color: '#ef4444' }}> *</Text></Text>
                  {showNewCityInput ? (
                    <NewNameRow value={newCityName} onChangeText={setNewCityName} placeholder="Enter new city name" onCancel={() => { setShowNewCityInput(false); setNewCityName(''); }} />
                  ) : (
                    <View style={[pickerWrap, { opacity: !formData.regionId && !showNewRegionInput ? 0.5 : 1 }]}>
                      <Picker enabled={!!formData.regionId || showNewRegionInput} selectedValue={formData.cityId?.toString() || ''} onValueChange={handleCityChange} style={{ color: '#111827' }} dropdownIconColor="#6b7280">
                        <Picker.Item label="Select City" value="" />
                        {filteredCities.map((c) => (
                          <Picker.Item key={c.id} label={c.name} value={c.id.toString()} />
                        ))}
                        <Picker.Item label="+ Add New City" value="add_new" />
                      </Picker>
                    </View>
                  )}
                </View>

                {/* Barangay */}
                <View>
                  <Text style={labelStyle}>Barangay<Text style={{ color: '#ef4444' }}> *</Text></Text>
                  {showNewBarangayInput ? (
                    <NewNameRow value={newBarangayName} onChangeText={setNewBarangayName} placeholder="Enter new barangay name" onCancel={() => { setShowNewBarangayInput(false); setNewBarangayName(''); }} />
                  ) : (
                    <View style={[pickerWrap, { opacity: !formData.cityId && !showNewCityInput ? 0.5 : 1 }]}>
                      <Picker enabled={!!formData.cityId || showNewCityInput} selectedValue={formData.barangayId?.toString() || ''} onValueChange={handleBarangayChange} style={{ color: '#111827' }} dropdownIconColor="#6b7280">
                        <Picker.Item label="Select Barangay" value="" />
                        {filteredBarangays.map((b) => (
                          <Picker.Item key={b.id} label={b.name} value={b.id.toString()} />
                        ))}
                        <Picker.Item label="+ Add New Barangay" value="add_new" />
                      </Picker>
                    </View>
                  )}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>

      <LoadingModalGlobal
        isOpen={globalModal.isOpen}
        type={globalModal.type}
        title={globalModal.title}
        message={globalModal.message}
        onConfirm={globalModal.onConfirm || closeGlobalModal}
        onCancel={closeGlobalModal}
        colorPalette={colorPalette}
        isDarkMode={false}
      />
    </Modal>
  );
};

export default AddLocationModal;
