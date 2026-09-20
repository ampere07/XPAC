import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPin, Layers, Trash2, Upload, ExternalLink, Camera } from 'lucide-react';
import SearchableField from '../components/common/SearchableField';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';
import { createApplication, uploadApplicationImages } from '../services/applicationService';
import {
    getRegions,
    getCitiesByRegionId,
    getBarangaysByCityId,
    Region,
    City,
    Borough
} from '../services/cityService';
import { planService, Plan } from '../services/planService';
import { encodeAgentReferral, getStoredAgentIdentity } from '../utils/agentReferral';

interface ApplicationFormProps {
    onClose?: () => void;
    /** Called after a successful submission, before the form resets. */
    onSubmitted?: () => void;
}

type DocumentField =
    | 'proof_of_billing'
    | 'government_valid_id'
    | 'secondary_government_valid_id'
    | 'house_front_image';

const DOCUMENT_FIELDS: { field: DocumentField; label: string; required?: boolean }[] = [
    { field: 'proof_of_billing', label: 'Proof of Billing' },
    { field: 'government_valid_id', label: 'Government Valid ID (Primary)', required: true },
    { field: 'secondary_government_valid_id', label: 'Government Valid ID (Secondary)' },
    { field: 'house_front_image', label: 'House Front Picture' }
];

const EMPTY_DOCUMENTS: Record<DocumentField, File | null> = {
    proof_of_billing: null,
    government_valid_id: null,
    secondary_government_valid_id: null,
    house_front_image: null
};

const EMPTY_PREVIEWS: Record<DocumentField, string | null> = {
    proof_of_billing: null,
    government_valid_id: null,
    secondary_government_valid_id: null,
    house_front_image: null
};

interface FormState {
    email_address: string;
    first_name: string;
    middle_initial: string;
    last_name: string;
    mobile_number: string;
    secondary_mobile_number: string;
    region: string;
    city: string;
    barangay: string;
    installation_address: string;
    landmark: string;
    referred_by: string;
    desired_plan: string;
}

const buildEmptyForm = (referredBy: string): FormState => ({
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
    // Pre-filled with the signed-in agent's name so the referral is credited to them.
    referred_by: referredBy || 'None / Walk-in',
    desired_plan: ''
});

// Declared at module scope so it keeps its identity across renders — a component defined
// inside ApplicationForm would remount on every keystroke and lose input focus.
const TextField: React.FC<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    isDarkMode: boolean;
    error?: string;
    placeholder?: string;
    required?: boolean;
    type?: string;
    maxLength?: number;
    digitsOnly?: boolean;
    multiline?: boolean;
    hint?: string;
}> = ({
    label, value, onChange, isDarkMode, error, placeholder, required,
    type = 'text', maxLength, digitsOnly, multiline, hint
}) => {
    const base = `w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${error ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
        } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`;

    return (
        <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {label}{required && <span className="text-red-500">*</span>}
            </label>
            {multiline ? (
                <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    rows={3}
                    className={`${base} resize-none`}
                    placeholder={placeholder}
                />
            ) : (
                <input
                    type={type}
                    value={value}
                    onChange={(e) => onChange(digitsOnly ? e.target.value.replace(/\D/g, '') : e.target.value)}
                    maxLength={maxLength}
                    className={base}
                    placeholder={placeholder}
                />
            )}
            {error
                ? <p className="text-red-500 text-xs mt-1">{error}</p>
                : hint ? <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{hint}</p> : null}
        </div>
    );
};

const ImageUploadField: React.FC<{
    label: string;
    required?: boolean;
    preview: string | null;
    isDarkMode: boolean;
    onPick: (file: File) => void;
    onClear: () => void;
}> = ({ label, required, preview, isDarkMode, onPick, onClear }) => (
    <div className="space-y-2">
        <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {label}{required && <span className="text-red-500">*</span>}
        </label>
        <div
            className={`relative group border-2 border-dashed rounded-xl overflow-hidden aspect-video flex flex-col items-center justify-center transition-all ${preview
                ? 'border-transparent'
                : (isDarkMode ? 'border-gray-700 hover:border-gray-500 bg-gray-800/50' : 'border-gray-300 hover:border-gray-400 bg-gray-50')
                }`}
        >
            {preview ? (
                <>
                    <img src={preview} alt={label} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                        <button
                            type="button"
                            onClick={() => window.open(preview)}
                            className="p-2.5 bg-white/20 hover:bg-white/40 text-white rounded-full transition-all backdrop-blur-sm"
                            title="View"
                        >
                            <ExternalLink size={18} />
                        </button>
                        <label
                            className="p-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-full transition-all cursor-pointer shadow-lg"
                            title="Replace"
                        >
                            <Upload size={18} />
                            <input
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={(e) => { if (e.target.files?.[0]) onPick(e.target.files[0]); e.target.value = ''; }}
                            />
                        </label>
                        <button
                            type="button"
                            onClick={onClear}
                            className="p-2.5 bg-red-500 hover:bg-red-600 text-white rounded-full transition-all"
                            title="Remove"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
                </>
            ) : (
                <label className="w-full h-full flex flex-col items-center justify-center gap-2 cursor-pointer">
                    <Camera size={26} className={isDarkMode ? 'text-gray-500' : 'text-gray-400'} />
                    <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        Click to upload
                    </span>
                    <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => { if (e.target.files?.[0]) onPick(e.target.files[0]); e.target.value = ''; }}
                    />
                </label>
            )}
        </div>
    </div>
);

/**
 * Agent-facing application form — the web counterpart of the mobile app's
 * ApplicationForm screen. Region / City / Barangay and Plan are searchable and loaded on
 * demand, "Referred By" is locked to the signed-in agent, and the supporting documents
 * are uploaded to the created application in a second request.
 */
const ApplicationForm: React.FC<ApplicationFormProps> = ({ onClose, onSubmitted }) => {
    const identity = useMemo(() => getStoredAgentIdentity(), []);
    const isMountedRef = useRef(true);

    const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);

    const [formData, setFormData] = useState<FormState>(() => buildEmptyForm(identity.fullName));
    const [documents, setDocuments] = useState<Record<DocumentField, File | null>>(EMPTY_DOCUMENTS);
    const [previews, setPreviews] = useState<Record<DocumentField, string | null>>(EMPTY_PREVIEWS);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const [regions, setRegions] = useState<Region[]>([]);
    const [cities, setCities] = useState<City[]>([]);
    const [barangays, setBarangays] = useState<Borough[]>([]);
    const [plans, setPlans] = useState<Plan[]>([]);

    const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);
    const [selectedCityId, setSelectedCityId] = useState<number | null>(null);
    const [isCitiesLoading, setIsCitiesLoading] = useState(false);
    const [isBarangaysLoading, setIsBarangaysLoading] = useState(false);

    const [isDataReady, setIsDataReady] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const primaryColor = colorPalette?.primary || '#7c3aed';

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            // Release any object URLs created for the previews.
            Object.values(previews).forEach(url => { if (url) URL.revokeObjectURL(url); });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const observer = new MutationObserver(() => {
            setIsDarkMode(localStorage.getItem('theme') === 'dark');
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const load = async () => {
            try {
                const [palette, imageSize, regionList, planList] = await Promise.all([
                    settingsColorPaletteService.getActive(),
                    getActiveImageSize(),
                    getRegions(),
                    planService.getAllPlans()
                ]);
                if (!isMountedRef.current) return;
                setColorPalette(palette);
                setActiveImageSize(imageSize);
                setRegions(regionList);
                setPlans(planList);
            } catch (err) {
                console.error('[ApplicationForm] Failed to load form data:', err);
            } finally {
                if (isMountedRef.current) setIsDataReady(true);
            }
        };
        load();
    }, []);

    // Guards so a slow response for a stale selection can't overwrite a newer one.
    const cityRequestIdRef = useRef(0);
    const barangayRequestIdRef = useRef(0);

    const handleChange = useCallback((field: keyof FormState, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setErrors(prev => (prev[field] ? { ...prev, [field]: '' } : prev));
    }, []);

    const onRegionChange = useCallback((regionName: string, option?: any) => {
        const regionId = option?.id ?? null;
        setSelectedRegionId(regionId);
        setSelectedCityId(null);
        setFormData(prev => ({ ...prev, region: regionName, city: '', barangay: '' }));
        setErrors(prev => ({ ...prev, region: '' }));
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

    const onCityChange = useCallback((cityName: string, option?: any) => {
        const cityId = option?.id ?? null;
        setSelectedCityId(cityId);
        setFormData(prev => ({ ...prev, city: cityName, barangay: '' }));
        setErrors(prev => ({ ...prev, city: '' }));
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

    const handlePickDocument = useCallback(async (field: DocumentField, picked: File) => {
        let file = picked;
        if (activeImageSize && activeImageSize.status === 'active') {
            try {
                file = await resizeImage(picked, activeImageSize.image_size_value);
            } catch (err) {
                console.error('[ApplicationForm] Image resizing failed:', err);
            }
        }

        setDocuments(prev => ({ ...prev, [field]: file }));
        setPreviews(prev => {
            if (prev[field]) URL.revokeObjectURL(prev[field] as string);
            return { ...prev, [field]: URL.createObjectURL(file) };
        });
        setErrors(prev => (prev[field] ? { ...prev, [field]: '' } : prev));
    }, [activeImageSize]);

    const handleClearDocument = useCallback((field: DocumentField) => {
        setDocuments(prev => ({ ...prev, [field]: null }));
        setPreviews(prev => {
            if (prev[field]) URL.revokeObjectURL(prev[field] as string);
            return { ...prev, [field]: null };
        });
    }, []);

    // Same required set the mobile form enforces, plus the primary valid ID.
    const validate = (): boolean => {
        const next: Record<string, string> = {};

        if (!formData.email_address.trim()) next.email_address = 'Email address is required';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email_address.trim())) {
            next.email_address = 'Invalid email address format';
        }

        if (!formData.first_name.trim()) next.first_name = 'First name is required';
        if (!formData.last_name.trim()) next.last_name = 'Last name is required';

        if (!formData.mobile_number.trim()) next.mobile_number = 'Mobile number is required';
        else if (!/^[0-9]{10,11}$/.test(formData.mobile_number.trim())) {
            next.mobile_number = 'Mobile number must be 10-11 digits';
        }

        if (formData.secondary_mobile_number && !/^[0-9]{10,11}$/.test(formData.secondary_mobile_number.trim())) {
            next.secondary_mobile_number = 'Secondary mobile number must be 10-11 digits';
        }

        if (!formData.region.trim()) next.region = 'Region is required';
        if (!formData.city.trim()) next.city = 'City/Municipality is required';
        if (!formData.barangay.trim()) next.barangay = 'Barangay is required';
        if (!formData.installation_address.trim()) next.installation_address = 'Installation address is required';
        if (!formData.desired_plan.trim()) next.desired_plan = 'Plan is required';

        if (!documents.government_valid_id) {
            next.government_valid_id = 'Government Valid ID (Primary) is required';
        }

        setErrors(next);
        return Object.keys(next).length === 0;
    };

    const resetForm = () => {
        setFormData(buildEmptyForm(identity.fullName));
        setDocuments(EMPTY_DOCUMENTS);
        setPreviews(prev => {
            Object.values(prev).forEach(url => { if (url) URL.revokeObjectURL(url); });
            return EMPTY_PREVIEWS;
        });
        setSelectedRegionId(null);
        setSelectedCityId(null);
        setCities([]);
        setBarangays([]);
        setErrors({});
    };

    const handleSubmit = async () => {
        if (isSaving) return;
        if (!validate()) {
            window.alert('Please complete all required fields marked with *');
            return;
        }

        setIsSaving(true);
        try {
            // 1. Create the application. status/created_by_user_id are set server side.
            const application = await createApplication({
                ...formData,
                email_address: formData.email_address.trim(),
                first_name: formData.first_name.trim(),
                last_name: formData.last_name.trim(),
                mobile_number: formData.mobile_number.trim(),
                installation_address: formData.installation_address.trim(),
                // The field above shows the agent their own name; what is stored
                // is their user id, so the referral names one account rather than
                // a string that has to be matched back to one. Falls back to the
                // name when there is no id on the session, which is what this
                // wrote before ids existed.
                referred_by: encodeAgentReferral(identity.id) || identity.fullName || formData.referred_by
            } as any);

            // 2. Upload whatever documents were attached.
            const payload = new FormData();
            let hasFiles = false;
            (Object.entries(documents) as [DocumentField, File | null][]).forEach(([field, file]) => {
                if (file) {
                    hasFiles = true;
                    payload.append(field, file);
                }
            });

            if (hasFiles && application?.id) {
                try {
                    await uploadApplicationImages(application.id, payload);
                } catch (uploadErr) {
                    console.error('[ApplicationForm] Document upload failed:', uploadErr);
                    window.alert(
                        'The application was submitted, but the documents failed to upload. ' +
                        'Please attach them again from the application record.'
                    );
                    onSubmitted?.();
                    resetForm();
                    return;
                }
            }

            window.alert('Application submitted successfully!');
            onSubmitted?.();
            resetForm();
        } catch (error: any) {
            const data = error?.response?.data;
            if (data?.errors) {
                window.alert('Validation errors:\n' + Object.values(data.errors).flat().join('\n'));
            } else {
                window.alert(data?.message || error?.message || 'An error occurred during submission.');
            }
        } finally {
            if (isMountedRef.current) setIsSaving(false);
        }
    };

    // Plan values are stored as "NAME - P0.00", matching the mobile picker.
    const planOptions = useMemo(
        () => plans.map(p => ({
            id: p.id,
            name: `${p.name} - P${Number(p.price || 0).toFixed(2)}`
        })),
        [plans]
    );

    const labelClass = `block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`;
    const sectionClass = `text-sm font-bold uppercase tracking-wider pt-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`;

    // Shared props for every plain text input on the form.
    const fieldProps = (field: keyof FormState) => ({
        value: formData[field],
        onChange: (value: string) => handleChange(field, value),
        isDarkMode,
        error: errors[field]
    });

    if (!isDataReady) {
        return (
            <div className={`h-full flex flex-col items-center justify-center gap-3 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: primaryColor }} />
                <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Loading form...</span>
            </div>
        );
    }

    return (
        <div className={`h-full flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
            {/* Header */}
            <div className={`flex-shrink-0 px-4 md:px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
                }`}>
                <h1 className={`text-lg md:text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    Application Form
                </h1>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving}
                        className={`px-4 py-2 rounded text-sm disabled:opacity-50 ${isDarkMode
                            ? 'bg-gray-700 hover:bg-gray-600 text-white'
                            : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                            }`}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSaving}
                        className="px-4 py-2 rounded text-sm font-medium text-white flex items-center gap-2 disabled:opacity-50"
                        style={{ backgroundColor: primaryColor }}
                    >
                        {isSaving && <Loader2 size={14} className="animate-spin" />}
                        {isSaving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
                <div className={`mx-auto max-w-3xl m-4 md:m-6 rounded-lg border p-4 md:p-6 space-y-5 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
                    }`}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <TextField label="Email" {...fieldProps('email_address')} type="email" placeholder="Enter email address" required />
                        <TextField label="First Name" {...fieldProps('first_name')} placeholder="Enter first name" required />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <TextField label="Middle Initial" {...fieldProps('middle_initial')} placeholder="M" maxLength={1} />
                        <div className="md:col-span-2">
                            <TextField label="Last Name" {...fieldProps('last_name')} placeholder="Enter last name" required />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <TextField
                            label="Mobile"
                            {...fieldProps('mobile_number')}
                            type="tel"
                            placeholder="09123456789"
                            maxLength={11}
                            digitsOnly
                            required
                            hint="Format: 09********"
                        />
                        <TextField label="Secondary Mobile" {...fieldProps('secondary_mobile_number')} type="tel" placeholder="09123456789" maxLength={11} digitsOnly />
                    </div>

                    <h2 className={sectionClass}>Installation Address</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SearchableField
                            label="Region"
                            required
                            value={formData.region}
                            onSelect={onRegionChange}
                            options={regions}
                            optionLabelKey="name"
                            isDarkMode={isDarkMode}
                            colorPalette={colorPalette}
                            error={errors.region}
                            placeholder="Select region"
                            icon={<MapPin size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />}
                        />
                        <SearchableField
                            label="City/Municipality"
                            required
                            value={formData.city}
                            onSelect={onCityChange}
                            options={cities}
                            optionLabelKey="name"
                            isDarkMode={isDarkMode}
                            colorPalette={colorPalette}
                            error={errors.city}
                            placeholder={
                                isCitiesLoading ? 'Loading cities...'
                                    : selectedRegionId ? 'Select city/municipality'
                                        : 'Select a region first'
                            }
                            emptyMessage={selectedRegionId ? 'No cities found for this region' : 'Select a region first'}
                            icon={<MapPin size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SearchableField
                            label="Barangay"
                            required
                            value={formData.barangay}
                            onSelect={(value) => handleChange('barangay', value)}
                            options={barangays}
                            optionLabelKey="name"
                            isDarkMode={isDarkMode}
                            colorPalette={colorPalette}
                            error={errors.barangay}
                            placeholder={
                                isBarangaysLoading ? 'Loading barangays...'
                                    : selectedCityId ? 'Select barangay'
                                        : 'Select a city first'
                            }
                            emptyMessage={selectedCityId ? 'No barangays found for this city' : 'Select a city first'}
                            icon={<MapPin size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />}
                        />
                    </div>

                    <TextField
                        label="Installation Address"
                        {...fieldProps('installation_address')}
                        placeholder="House/Unit Number & Street Name"
                        required
                        multiline
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <TextField label="Landmark" {...fieldProps('landmark')} placeholder="Enter a landmark" />
                        <div>
                            <label className={labelClass}>Referred By</label>
                            <input
                                type="text"
                                value={formData.referred_by}
                                readOnly
                                disabled
                                className={`w-full px-3 py-2 border rounded cursor-not-allowed opacity-70 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                                    }`}
                            />
                            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                Referrals you submit are automatically credited to your account.
                            </p>
                        </div>
                    </div>

                    <h2 className={sectionClass}>Plan Selection</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SearchableField
                            label="Plan"
                            required
                            value={formData.desired_plan}
                            onSelect={(value) => handleChange('desired_plan', value)}
                            options={planOptions}
                            optionLabelKey="name"
                            isDarkMode={isDarkMode}
                            colorPalette={colorPalette}
                            error={errors.desired_plan}
                            placeholder="Select plan"
                            icon={<Layers size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />}
                        />
                    </div>

                    <h2 className={sectionClass}>Upload Documents</h2>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        Allowed: JPG/PNG, up to 10 MB each.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {DOCUMENT_FIELDS.map(doc => (
                            <div key={doc.field}>
                                <ImageUploadField
                                    label={doc.label}
                                    required={doc.required}
                                    preview={previews[doc.field]}
                                    isDarkMode={isDarkMode}
                                    onPick={(file) => handlePickDocument(doc.field, file)}
                                    onClear={() => handleClearDocument(doc.field)}
                                />
                                {errors[doc.field] && <p className="text-red-500 text-xs mt-1">{errors[doc.field]}</p>}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ApplicationForm;
