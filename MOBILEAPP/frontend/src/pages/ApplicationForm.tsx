import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert, useWindowDimensions, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { SearchablePicker, SearchablePickerTrigger } from '../components/SearchablePicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createApplication, uploadApplicationImages } from '../services/api';
import { getRegions, getCitiesByRegionId, getBarangaysByCityId, Region, City, Borough } from '../services/cityService';
import { planService, Plan } from '../services/planService';
import { referredByEcho } from '../utils/referredByField';
import ImagePreview from '../components/ImagePreview';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

const ApplicationForm = ({ onClose }: { onClose?: () => void }) => {
    const { width } = useWindowDimensions();
    const isMobile = width < 768;
    const insets = useSafeAreaInsets();
    const isMountedRef = useRef(true);

    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());
    const [isLoading, setIsLoading] = useState(false);
    const [isDataReady, setIsDataReady] = useState(false);

    const [formData, setFormData] = useState({
        email_address: '',
        first_name: '',
        middle_initial: '',
        last_name: '',
        mobile_number: '',
        secondary_mobile_number: '',
        region: '',
        city: '',
        barangay: '',
        installation_address: '',
        landmark: '',
        referred_by: 'None / Walk-in',
        desired_plan: '',
        created_by_user_id: null as number | null
    });

    // The signed-in agent, as the box was seeded with them: the name it shows and
    // the id that is actually stored. Kept so the submit below can tell an
    // untouched field from one somebody has typed over.
    const [referralSeed, setReferralSeed] = useState<{ referred_by: string; referred_by_agent_id: number | null }>({
        referred_by: '',
        referred_by_agent_id: null,
    });

    const [documents, setDocuments] = useState({
        proof_of_billing: null as any,
        government_valid_id: null as any,
        secondary_government_valid_id: null as any,
        house_front_image: null as any
    });

    const [imagePreviews, setImagePreviews] = useState({
        proof_of_billing: null as string | null,
        government_valid_id: null as string | null,
        secondary_government_valid_id: null as string | null,
        house_front_image: null as string | null
    });

    const [regions, setRegions] = useState<Region[]>([]);
    const [cities, setCities] = useState<City[]>([]);
    const [barangays, setBarangays] = useState<Borough[]>([]);
    const [plans, setPlans] = useState<Plan[]>([]);

    const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);
    const [selectedCityId, setSelectedCityId] = useState<number | null>(null);
    const [isCitiesLoading, setIsCitiesLoading] = useState(false);
    const [isBarangaysLoading, setIsBarangaysLoading] = useState(false);

    // Searchable dropdown state — only one picker is open at a time, so a single search value is shared
    const [activePicker, setActivePicker] = useState<null | 'region' | 'city' | 'barangay' | 'plan'>(null);
    const [pickerSearch, setPickerSearch] = useState('');
    const openPicker = useCallback((picker: 'region' | 'city' | 'barangay' | 'plan') => {
        setPickerSearch('');
        setActivePicker(picker);
    }, []);
    const closePicker = useCallback(() => setActivePicker(null), []);

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    useEffect(() => {
        settingsColorPaletteService.getActive().then(p => {
            if (isMountedRef.current) setColorPalette(p);
        });

        const fetchData = async () => {
            try {
                const authData = await AsyncStorage.getItem('authData');
                if (authData && isMountedRef.current) {
                    const user = JSON.parse(authData);
                    if (user) {
                        // The box shows the agent their own NAME. What gets stored
                        // is their id — see the submit below.
                        setReferralSeed({
                            referred_by: user.full_name || '',
                            referred_by_agent_id: user.id ?? null,
                        });
                        setFormData(prev => ({
                            ...prev,
                            ...(user.full_name ? { referred_by: user.full_name } : {}),
                            ...(user.id ? { created_by_user_id: user.id } : {})
                        }));
                    }
                }

                const [r, p] = await Promise.all([
                    getRegions(),
                    planService.getAllPlans()
                ]);
                if (!isMountedRef.current) return;
                setRegions(r);
                setPlans(p);
                setIsDataReady(true);
            } catch (err) {
                console.error("Failed to load data", err);
                if (isMountedRef.current) setIsDataReady(true);
            }
        };
        fetchData();
    }, []);

    const handleTextChange = useCallback((field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    }, []);

    // Stable refs so change handlers stay referentially stable across renders
    const regionsRef = useRef(regions);
    regionsRef.current = regions;

    const citiesRef = useRef(cities);
    citiesRef.current = cities;

    // Guards so a slow response for a stale selection can't overwrite a newer one
    const cityRequestIdRef = useRef(0);
    const barangayRequestIdRef = useRef(0);

    const onRegionChange = useCallback((regionName: string) => {
        const selected = regionsRef.current.find(r => r.name === regionName);
        const regionId = selected ? selected.id : null;
        setSelectedRegionId(regionId);
        setSelectedCityId(null);
        setFormData(prev => ({ ...prev, region: regionName, city: '', barangay: '' }));
        setCities([]);
        setBarangays([]);

        const reqId = ++cityRequestIdRef.current;
        if (!regionId) return;
        setIsCitiesLoading(true);
        getCitiesByRegionId(regionId)
            .then(list => {
                if (isMountedRef.current && cityRequestIdRef.current === reqId) setCities(list);
            })
            .finally(() => {
                if (isMountedRef.current && cityRequestIdRef.current === reqId) setIsCitiesLoading(false);
            });
    }, []);

    const onCityChange = useCallback((cityName: string) => {
        const selected = citiesRef.current.find(c => c.name === cityName);
        const cityId = selected ? selected.id : null;
        setSelectedCityId(cityId);
        setFormData(prev => ({ ...prev, city: cityName, barangay: '' }));
        setBarangays([]);

        const reqId = ++barangayRequestIdRef.current;
        if (!cityId) return;
        setIsBarangaysLoading(true);
        getBarangaysByCityId(cityId)
            .then(list => {
                if (isMountedRef.current && barangayRequestIdRef.current === reqId) setBarangays(list);
            })
            .finally(() => {
                if (isMountedRef.current && barangayRequestIdRef.current === reqId) setIsBarangaysLoading(false);
            });
    }, []);

    const handleImageUpload = useCallback((field: keyof typeof documents, file: any) => {
        setDocuments(prev => ({ ...prev, [field]: file }));
        setImagePreviews(prev => ({ ...prev, [field]: file ? file.uri : null }));
    }, []);

    const handleSubmit = useCallback(async () => {
        // The referral is stored as the agent's id while the box still reads as
        // the name it was seeded with; type over it and the text is what is kept.
        const fd = { ...formData, referred_by: referredByEcho(referralSeed, formData.referred_by) ?? '' };
        // Basic validation
        if (!fd.email_address || !fd.first_name || !fd.last_name || !fd.mobile_number ||
            !fd.region || !fd.city || !fd.barangay || !fd.installation_address || !fd.desired_plan) {
            Alert.alert('Missing Fields', 'Please fill in all required fields marked with *');
            return;
        }

        if (!documents.government_valid_id) {
            Alert.alert('Missing Document', 'Government Valid ID (Primary) is required.');
            return;
        }

        setIsLoading(true);
        try {
            // 1. Create Application
            const appResult = await createApplication(fd);

            if (appResult.success && appResult.application?.id) {
                // 2. Upload Documents if any
                const formDataPayload = new FormData();
                let hasFiles = false;

                Object.entries(documents).forEach(([key, file]) => {
                    if (file) {
                        hasFiles = true;
                        formDataPayload.append(key, {
                            uri: file.uri,
                            name: file.name || `${key}.jpg`,
                            type: file.mimeType || 'image/jpeg'
                        } as any);
                    }
                });

                if (hasFiles) {
                    await uploadApplicationImages(appResult.application.id, formDataPayload);
                }

                Alert.alert('Success', 'Application submitted successfully!');

                // Reset form
                setFormData(prev => ({
                    email_address: '', first_name: '', middle_initial: '', last_name: '',
                    mobile_number: '', secondary_mobile_number: '', region: '', city: '',
                    barangay: '', installation_address: '', landmark: '', referred_by: prev.referred_by,
                    desired_plan: '', created_by_user_id: prev.created_by_user_id
                }));
                setDocuments({
                    proof_of_billing: null, government_valid_id: null,
                    secondary_government_valid_id: null, house_front_image: null
                });
                setImagePreviews({
                    proof_of_billing: null, government_valid_id: null,
                    secondary_government_valid_id: null, house_front_image: null
                });
                setSelectedRegionId(null);
                setSelectedCityId(null);
                setCities([]);
                setBarangays([]);
            } else {
                throw new Error(appResult.message || 'Failed to create application');
            }
        } catch (error: any) {
            Alert.alert('Error', error?.response?.data?.message || error.message || 'An error occurred during submission.');
        } finally {
            if (isMountedRef.current) setIsLoading(false);
        }
    }, [formData, documents]);

    // Build { id, label, value } option lists for the searchable pickers
    const regionOptions = useMemo(() =>
        regions.map(r => ({ id: String(r.id), label: r.name, value: r.name })),
        [regions]
    );

    const cityOptions = useMemo(() =>
        cities.map(c => ({ id: String(c.id), label: c.name, value: c.name })),
        [cities]
    );

    const barangayOptions = useMemo(() =>
        barangays.map(b => ({ id: String(b.id), label: b.name, value: b.name })),
        [barangays]
    );

    const planOptions = useMemo(() =>
        plans.map(p => ({
            id: String(p.id),
            label: p.description || p.name,
            value: `${p.name} - P${Number(p.price || 0).toFixed(2)}`
        })),
        [plans]
    );

    // Filter the currently open picker's options by the shared search term
    const filterOptions = useCallback((opts: { label: string }[]) => {
        const q = pickerSearch.trim().toLowerCase();
        return q ? opts.filter(o => o.label.toLowerCase().includes(q)) : opts;
    }, [pickerSearch]);

    const activeColor = colorPalette?.primary || '#7c3aed';

    if (!isDataReady) {
        return (
            <View style={[styles.mainContainer, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={activeColor} />
                <Text style={{ marginTop: 12, color: '#6b7280', fontSize: 14 }}>Loading form...</Text>
            </View>
        );
    }

    return (
        <View style={styles.mainContainer}>
            <View style={{ height: insets?.top || 0, backgroundColor: '#ffffff' }} />
            <View style={styles.header}>
                <Pressable
                    onPress={onClose}
                    disabled={isLoading}
                    style={styles.cancelButton}
                >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>

                <View style={styles.headerTitleContainer}>
                    <Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerTitle}>
                        Application Form
                    </Text>
                </View>

                <View style={styles.submitHeaderContainer}>
                    <TouchableOpacity
                        onPress={handleSubmit}
                        disabled={isLoading}
                        style={[styles.submitHeaderButton, {
                            backgroundColor: activeColor,
                            opacity: isLoading ? 0.6 : 1,
                        }]}
                    >
                        <Text style={styles.submitHeaderButtonText}>
                            {isLoading ? 'Saving...' : 'Save'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
                <ScrollView style={styles.container} contentContainerStyle={[styles.content, isMobile && { padding: 16 }, { paddingBottom: 100 }]}>
                    <View style={styles.card}>

                <View style={styles.row}>
                    <View style={styles.col}>
                        <InputField label="Email" field="email_address" placeholder="Enter your email address" required formData={formData} onChange={handleTextChange} />
                    </View>
                    <View style={styles.col}>
                        <InputField label="First Name" field="first_name" placeholder="Enter your first name" required formData={formData} onChange={handleTextChange} />
                    </View>
                </View>

                <View style={styles.row}>
                    <View style={styles.col}>
                        <InputField label="Middle Initial" field="middle_initial" placeholder="M" formData={formData} onChange={handleTextChange} />
                    </View>
                    <View style={styles.col}>
                        <InputField label="Last Name" field="last_name" placeholder="Enter your last name" required formData={formData} onChange={handleTextChange} />
                    </View>
                </View>

                <View style={styles.row}>
                    <View style={styles.col}>
                        <InputField label="Mobile" field="mobile_number" placeholder="09********" required formData={formData} onChange={handleTextChange} />
                        <Text style={styles.formatHint}>Format: 09********</Text>
                    </View>
                    <View style={styles.col}>
                        <InputField label="Secondary Mobile" field="secondary_mobile_number" placeholder="09********" formData={formData} onChange={handleTextChange} />
                    </View>
                </View>

                <Text style={styles.sectionTitle}>Installation Address</Text>

                <View style={styles.row}>
                    <View style={styles.col}>
                        <SearchablePickerTrigger
                            label="Region"
                            required
                            value={formData.region}
                            placeholder="Select region"
                            onPress={() => openPicker('region')}
                        />
                    </View>
                    <View style={styles.col}>
                        <SearchablePickerTrigger
                            label="City/Municipality"
                            required
                            value={formData.city}
                            placeholder={isCitiesLoading ? 'Loading cities...' : (selectedRegionId ? 'Select city/municipality' : 'Select a region first')}
                            onPress={() => { if (selectedRegionId && !isCitiesLoading) openPicker('city'); }}
                        />
                    </View>
                </View>

                <View style={[styles.row, { width: isMobile ? '100%' : '50%', paddingRight: isMobile ? 0 : 8 }]}>
                    <View style={styles.col}>
                        <SearchablePickerTrigger
                            label="Barangay"
                            required
                            value={formData.barangay}
                            placeholder={isBarangaysLoading ? 'Loading barangays...' : (selectedCityId ? 'Select barangay' : 'Select a city first')}
                            onPress={() => { if (selectedCityId && !isBarangaysLoading) openPicker('barangay'); }}
                        />
                    </View>
                </View>

                <InputField label="Installation Address" field="installation_address" placeholder="House/Unit Number & Street Name" required isMultiline formData={formData} onChange={handleTextChange} />

                <View style={styles.row}>
                    <View style={styles.col}>
                        <InputField label="Landmark" field="landmark" placeholder="Enter a landmark" required formData={formData} onChange={handleTextChange} />
                    </View>
                    <View style={styles.col}>
                        <InputField label="Referred By" field="referred_by" placeholder="None / Walk-in" formData={formData} onChange={handleTextChange} />
                    </View>
                </View>

                <Text style={styles.sectionTitle}>Plan Selection</Text>

                <View style={[styles.row, { width: isMobile ? '100%' : '50%', paddingRight: isMobile ? 0 : 8 }]}>
                    <View style={styles.col}>
                        <SearchablePickerTrigger
                            label="Plan"
                            required
                            value={formData.desired_plan}
                            placeholder="Select plan"
                            onPress={() => openPicker('plan')}
                        />
                    </View>
                </View>

                <Text style={styles.sectionTitle}>Upload Documents</Text>
                <Text style={styles.uploadHint}>Allowed: JPG/PNG/PDF, up to 10 MB each.</Text>

                <View style={styles.row}>
                    <View style={styles.col}>
                        <ImagePreview
                            imageUrl={imagePreviews.proof_of_billing}
                            label="Proof of Billing"
                            onUpload={(file) => handleImageUpload('proof_of_billing', file)}
                            colorPrimary={activeColor}
                        />
                    </View>
                    <View style={styles.col}>
                        <ImagePreview
                            imageUrl={imagePreviews.government_valid_id}
                            label="Government Valid ID (Primary)"
                            required={true}
                            onUpload={(file) => handleImageUpload('government_valid_id', file)}
                            colorPrimary={activeColor}
                        />
                    </View>
                </View>

                <View style={styles.row}>
                    <View style={styles.col}>
                        <ImagePreview
                            imageUrl={imagePreviews.secondary_government_valid_id}
                            label="Government Valid ID (Secondary)"
                            onUpload={(file) => handleImageUpload('secondary_government_valid_id', file)}
                            colorPrimary={activeColor}
                        />
                    </View>
                    <View style={styles.col}>
                        <ImagePreview
                            imageUrl={imagePreviews.house_front_image}
                            label="House Front Picture"
                            onUpload={(file) => handleImageUpload('house_front_image', file)}
                            colorPrimary={activeColor}
                        />
                    </View>
                </View>

            </View>
        </ScrollView>
        </KeyboardAvoidingView>

            <SearchablePicker
                isOpen={activePicker === 'region'}
                onClose={closePicker}
                title="Select Region"
                data={filterOptions(regionOptions)}
                onSelect={(item) => { onRegionChange(item.value); closePicker(); }}
                keyExtractor={(item) => item.id}
                searchValue={pickerSearch}
                onSearchChange={setPickerSearch}
                placeholder="Search regions..."
                selectedItemValue={formData.region}
                activeColor={activeColor}
            />
            <SearchablePicker
                isOpen={activePicker === 'city'}
                onClose={closePicker}
                title="Select City/Municipality"
                data={filterOptions(cityOptions)}
                onSelect={(item) => { onCityChange(item.value); closePicker(); }}
                keyExtractor={(item) => item.id}
                searchValue={pickerSearch}
                onSearchChange={setPickerSearch}
                placeholder="Search cities..."
                selectedItemValue={formData.city}
                activeColor={activeColor}
            />
            <SearchablePicker
                isOpen={activePicker === 'barangay'}
                onClose={closePicker}
                title="Select Barangay"
                data={filterOptions(barangayOptions)}
                onSelect={(item) => { handleTextChange('barangay', item.value); closePicker(); }}
                keyExtractor={(item) => item.id}
                searchValue={pickerSearch}
                onSearchChange={setPickerSearch}
                placeholder="Search barangays..."
                selectedItemValue={formData.barangay}
                activeColor={activeColor}
            />
            <SearchablePicker
                isOpen={activePicker === 'plan'}
                onClose={closePicker}
                title="Select Plan"
                data={filterOptions(planOptions)}
                onSelect={(item) => { handleTextChange('desired_plan', item.value); closePicker(); }}
                keyExtractor={(item) => item.id}
                searchValue={pickerSearch}
                onSearchChange={setPickerSearch}
                placeholder="Search plans..."
                selectedItemValue={formData.desired_plan}
                activeColor={activeColor}
            />
    </View>
    );
};

// Extracted as a separate component so each input only re-renders when its own value changes
const InputField = React.memo(({ label, field, placeholder, required = false, isMultiline = false, formData, onChange }: {
    label: string;
    field: string;
    placeholder: string;
    required?: boolean;
    isMultiline?: boolean;
    formData: Record<string, any>;
    onChange: (field: string, value: string) => void;
}) => (
    <View style={styles.inputContainer}>
        <Text style={styles.label}>
            {label} {required && <Text style={styles.required}>*</Text>}
        </Text>
        <TextInput
            style={[styles.input, isMultiline && styles.textArea]}
            placeholder={placeholder}
            placeholderTextColor="#94a3b8"
            value={String(formData[field] || '')}
            onChangeText={(val) => onChange(field, val)}
            multiline={isMultiline}
            numberOfLines={isMultiline ? 4 : 1}
            textAlignVertical={isMultiline ? 'top' : 'center'}
        />
    </View>
));

const styles = StyleSheet.create({
    mainContainer: {
        flex: 1,
        backgroundColor: '#f1f5f9',
    },
    container: {
        flex: 1,
    },
    content: {
        padding: 32,
        alignItems: 'center',
    },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 32,
        width: '100%',
        maxWidth: 1000,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 2,
    },
    header: {
        backgroundColor: '#ffffff',
        borderBottomColor: '#e5e7eb',
        borderBottomWidth: 1,
        position: 'relative',
        justifyContent: 'center',
        height: 60,
        paddingHorizontal: 0,
    },
    cancelButton: {
        position: 'absolute',
        left: 16,
        zIndex: 10,
        padding: 8,
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#6b7280',
    },
    headerTitleContainer: {
        position: 'absolute',
        left: 100,
        right: 100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        textAlign: 'center',
    },
    submitHeaderContainer: {
        position: 'absolute',
        right: 16,
        zIndex: 20,
    },
    submitHeaderButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        minWidth: 80,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitHeaderButtonText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#0f172a',
        marginTop: 32,
        marginBottom: 16,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -8,
        marginBottom: 16,
    },
    col: {
        flex: 1,
        minWidth: 250,
        paddingHorizontal: 8,
        marginBottom: 8,
    },
    inputContainer: {
        marginBottom: 8,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: '#334155',
        marginBottom: 8,
    },
    required: {
        color: '#ef4444',
    },
    input: {
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 14,
        color: '#1e293b',
        backgroundColor: '#ffffff',
    },
    textArea: {
        height: 120,
    },
    formatHint: {
        fontSize: 12,
        color: '#64748b',
        marginTop: 4,
    },
    uploadHint: {
        fontSize: 13,
        color: '#64748b',
        marginBottom: 16,
    },
    uploadContainer: {
        marginBottom: 8,
    },
    uploadBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 8,
        padding: 12,
        height: 50,
        backgroundColor: '#ffffff',
    },
    uploadBtnText: {
        fontSize: 14,
        color: '#475569',
        fontWeight: '500',
    },
    uploadBtnTextSuccess: {
        fontSize: 14,
        color: '#10b981',
        fontWeight: '500',
        flex: 1,
    }
});

export default ApplicationForm;
