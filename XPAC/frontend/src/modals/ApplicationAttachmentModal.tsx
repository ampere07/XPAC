import React, { useState, useEffect } from 'react';
import { Camera, Trash2, CheckCircle, Upload, ExternalLink } from 'lucide-react';
import ModalUITemplate from './ui-modal/ModalUITemplate';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';
import apiClient from '../config/api';
import { updateApplication } from '../services/applicationService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

interface ApplicationAttachmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (formData: any) => void;
    applicationData?: any;
    loading?: boolean;
}

const ImageUploadField = ({ 
    label, 
    field, 
    preview, 
    isDarkMode, 
    handleFileChange, 
    clearFile 
}: { 
    label: string, 
    field: string, 
    preview: string | null,
    isDarkMode: boolean,
    handleFileChange: (e: React.ChangeEvent<HTMLInputElement>, field: string) => void,
    clearFile: (field: string) => void
}) => (
    <div className="space-y-2">
        <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{label}</label>
        <div 
            className={`relative group border-2 border-dashed rounded-xl overflow-hidden aspect-video flex flex-col items-center justify-center transition-all ${
                preview 
                ? 'border-transparent' 
                : (isDarkMode ? 'border-gray-700 hover:border-gray-500 bg-gray-800/50' : 'border-gray-300 hover:border-gray-400 bg-gray-50')
            }`}
        >
            {preview ? (
                <>
                    <img 
                        src={preview} 
                        alt={label} 
                        className="w-full h-full object-cover" 
                        onError={(e) => {
                            const currentSrc = e.currentTarget.src;
                            if (currentSrc.includes('lh3.googleusercontent.com')) {
                                const fileId = currentSrc.split('/d/')[1]?.split('=')[0];
                                if (fileId) {
                                    e.currentTarget.src = `https://drive.google.com/uc?export=view&id=${fileId}`;
                                }
                            }
                        }}
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                        <div className="flex items-center gap-4">
                            <button 
                                onClick={() => window.open(preview)}
                                className="p-2.5 bg-white/20 hover:bg-white/40 text-white rounded-full transition-all backdrop-blur-sm"
                                title="View Image"
                            >
                                <ExternalLink size={18} />
                            </button>
                            <label className="p-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-full transition-all cursor-pointer shadow-lg" title="Replace Image">
                                <Upload size={18} />
                                <input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileChange(e, field)} />
                            </label>
                            <button 
                                onClick={() => clearFile(field)}
                                className="p-2.5 bg-red-500 hover:bg-red-600 text-white rounded-full transition-all"
                                title="Remove Image"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                        <span className="text-[10px] text-white/90 font-bold uppercase tracking-wider bg-black/20 px-2 py-0.5 rounded">Replace {label}</span>
                    </div>
                    <div className="absolute top-2 right-2 px-2 py-1 bg-green-500/90 text-white text-[10px] font-bold rounded shadow-lg uppercase tracking-wider backdrop-blur-sm">
                        Uploaded
                    </div>
                </>
            ) : (
                <>
                    <Camera size={32} className={isDarkMode ? 'text-gray-500' : 'text-gray-400'} />
                    <span className={`mt-2 text-xs font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Click to upload {label}</span>
                    <input 
                        type="file" 
                        className="absolute inset-0 opacity-0 cursor-pointer" 
                        accept="image/*" 
                        onChange={(e) => handleFileChange(e, field)} 
                    />
                </>
            )}
        </div>
    </div>
);

const ApplicationAttachmentModal: React.FC<ApplicationAttachmentModalProps> = ({
    isOpen,
    onClose,
    onSave,
    applicationData,
    loading = false
}) => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);
    
    const [files, setFiles] = useState<{ [key: string]: File | null }>({
        proofOfBilling: null,
        governmentValidId: null,
        secondaryGovernmentValidId: null,
        houseFrontImage: null,
        promoImage: null,
        nearestLandmark1: null,
        nearestLandmark2: null,
        documentAttachment: null,
        otherIspBill: null,
    });

    const [previews, setPreviews] = useState<{ [key: string]: string | null }>({
        proofOfBilling: null,
        governmentValidId: null,
        secondaryGovernmentValidId: null,
        houseFrontImage: null,
        promoImage: null,
        nearestLandmark1: null,
        nearestLandmark2: null,
        documentAttachment: null,
        otherIspBill: null,
    });

    useEffect(() => {
        const checkDarkMode = () => {
            const theme = localStorage.getItem('theme');
            setIsDarkMode(theme === 'dark' || theme === null);
        };
        checkDarkMode();
        const observer = new MutationObserver(checkDarkMode);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const fetchPalette = async () => {
            try {
                const active = await settingsColorPaletteService.getActive();
                setColorPalette(active);
            } catch (err) {
                console.error('Failed to fetch palette:', err);
            }
        };
        fetchPalette();
    }, []);

    useEffect(() => {
        const fetchImageSettings = async () => {
            const settings = await getActiveImageSize();
            setActiveImageSize(settings);
        };
        fetchImageSettings();
    }, []);

    const convertGoogleDriveUrl = (url: string | null | undefined): string | null => {
        if (!url) return null;
        if (url.startsWith('data:')) return url;
        
        const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (fileIdMatch && fileIdMatch[1]) {
            return `https://lh3.googleusercontent.com/d/${fileIdMatch[1]}=s1000`;
        }
        const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (idMatch && idMatch[1]) {
            return `https://lh3.googleusercontent.com/d/${idMatch[1]}=s1000`;
        }
        return url;
    };

    useEffect(() => {
        if (isOpen && applicationData) {
            setPreviews({
                proofOfBilling: convertGoogleDriveUrl(applicationData.proof_of_billing_url),
                governmentValidId: convertGoogleDriveUrl(applicationData.government_valid_id_url),
                secondaryGovernmentValidId: convertGoogleDriveUrl(applicationData.secondary_government_valid_id_url),
                houseFrontImage: convertGoogleDriveUrl(applicationData.house_front_picture_url),
                promoImage: convertGoogleDriveUrl(applicationData.promo_url),
                nearestLandmark1: convertGoogleDriveUrl(applicationData.nearest_landmark1_url),
                nearestLandmark2: convertGoogleDriveUrl(applicationData.nearest_landmark2_url),
                documentAttachment: convertGoogleDriveUrl(applicationData.document_attachment_url),
                otherIspBill: convertGoogleDriveUrl(applicationData.other_isp_bill_url),
            });
        } else if (!isOpen) {
            setFiles({
                proofOfBilling: null,
                governmentValidId: null,
                secondaryGovernmentValidId: null,
                houseFrontImage: null,
                promoImage: null,
                nearestLandmark1: null,
                nearestLandmark2: null,
                documentAttachment: null,
                otherIspBill: null,
            });
            setPreviews({
                proofOfBilling: null,
                governmentValidId: null,
                secondaryGovernmentValidId: null,
                houseFrontImage: null,
                promoImage: null,
                nearestLandmark1: null,
                nearestLandmark2: null,
                documentAttachment: null,
                otherIspBill: null,
            });
        }
    }, [isOpen, applicationData]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, field: string) => {
        if (e.target.files && e.target.files[0]) {
            let file = e.target.files[0];
            
            if (activeImageSize && activeImageSize.status === 'active') {
                try {
                    file = await resizeImage(file, activeImageSize.image_size_value);
                } catch (error) {
                    console.error('Image resizing failed:', error);
                }
            }

            setFiles(prev => ({ ...prev, [field]: file }));
            
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreviews(prev => ({ ...prev, [field]: reader.result as string }));
            };
            reader.readAsDataURL(file);
        }
    };

    const clearFile = (field: string) => {
        setFiles(prev => ({ ...prev, [field]: null }));
        setPreviews(prev => ({ ...prev, [field]: null }));
    };

    const [loadingInfo, setLoadingInfo] = useState({
        isOpen: false,
        type: 'loading' as 'loading' | 'success' | 'error',
        title: '',
        message: '',
        percentage: 0
    });

    const handleSave = async () => {
        if (!applicationData?.id) {
            console.error('Application ID is missing');
            return;
        }

        const applicationName = `${applicationData.first_name || ''} ${applicationData.last_name || ''}`.trim();
        const folderName = `(application) ${applicationName}`.trim();

        const imageFormData = new FormData();
        imageFormData.append('folder_name', folderName);

        let hasFiles = false;
        const backendKeyMap: Record<string, string> = {
            proofOfBilling: 'proof_of_billing',
            governmentValidId: 'government_valid_id',
            secondaryGovernmentValidId: 'secondary_government_valid_id',
            houseFrontImage: 'house_front_image',
            promoImage: 'promo_image',
            nearestLandmark1: 'nearest_landmark1',
            nearestLandmark2: 'nearest_landmark2',
            documentAttachment: 'document_attachment',
            otherIspBill: 'other_isp_bill'
        };

        Object.entries(files).forEach(([key, file]) => {
            if (file) {
                imageFormData.append(backendKeyMap[key] || key, file, file.name);
                hasFiles = true;
            }
        });

        if (!hasFiles) {
            onSave({});
            return;
        }

        setLoadingInfo({
            isOpen: true,
            type: 'loading',
            title: 'Saving Attachments',
            message: 'Uploading images to Google Drive...',
            percentage: 10
        });

        const progressInterval = setInterval(() => {
            setLoadingInfo(prev => ({
                ...prev,
                percentage: prev.percentage >= 90 ? 90 : prev.percentage + 5
            }));
        }, 500);

        try {
            const uploadResponse = await apiClient.post<any>(`/applications/${applicationData.id}/upload-images`, imageFormData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (uploadResponse.data.success) {
                setLoadingInfo(prev => ({ ...prev, message: 'Updating Application record...', percentage: 95 }));
                
                // The backend already updates the record in uploadImages, 
                // but we can call updateApplication if needed for consistency or just return success
                // Since the backend method updates the model, we just need to refresh UI
                
                clearInterval(progressInterval);
                setLoadingInfo({
                    isOpen: true,
                    type: 'success',
                    title: 'Success',
                    message: 'Attachments saved successfully!',
                    percentage: 100
                });
            } else {
                clearInterval(progressInterval);
                setLoadingInfo({
                    isOpen: true,
                    type: 'error',
                    title: 'Upload Failed',
                    message: uploadResponse.data.message || 'Failed to upload images.',
                    percentage: 0
                });
            }
        } catch (error: any) {
            clearInterval(progressInterval);
            setLoadingInfo({
                isOpen: true,
                type: 'error',
                title: 'Error',
                message: error.response?.data?.message || error.message || 'An unexpected error occurred.',
                percentage: 0
            });
        }
    };

    return (
        <>
            <ModalUITemplate
                isOpen={isOpen}
                onClose={onClose}
                title="Application Attachments"
                maxWidth="max-w-xl"
                primaryAction={{
                    label: 'Save Attachments',
                    onClick: handleSave,
                    disabled: loading
                }}
                loading={loading}
            >
                <div className="space-y-6">
                    <ImageUploadField label="Proof of Billing" field="proofOfBilling" preview={previews.proofOfBilling} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                    <ImageUploadField label="Government Valid ID" field="governmentValidId" preview={previews.governmentValidId} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                    <ImageUploadField label="Secondary Government Valid ID" field="secondaryGovernmentValidId" preview={previews.secondaryGovernmentValidId} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                    <ImageUploadField label="House Front Image" field="houseFrontImage" preview={previews.houseFrontImage} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                    <ImageUploadField label="Promo Image" field="promoImage" preview={previews.promoImage} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                    <ImageUploadField label="Nearest Landmark 1" field="nearestLandmark1" preview={previews.nearestLandmark1} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                    <ImageUploadField label="Nearest Landmark 2" field="nearestLandmark2" preview={previews.nearestLandmark2} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                    <ImageUploadField label="Document Attachment" field="documentAttachment" preview={previews.documentAttachment} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                    <ImageUploadField label="Other ISP Bill" field="otherIspBill" preview={previews.otherIspBill} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                </div>

                <div className={`p-4 rounded-lg mt-6 flex items-start gap-3 ${isDarkMode ? 'bg-blue-900/20 text-blue-300' : 'bg-blue-50 text-blue-700'}`}>
                    <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
                    <p className="text-xs leading-relaxed">
                        Ensure all documents are clear and readable. High-quality images help speed up the application process.
                    </p>
                </div>
            </ModalUITemplate>

            <LoadingModalGlobal 
                isOpen={loadingInfo.isOpen}
                type={loadingInfo.type}
                title={loadingInfo.title}
                message={loadingInfo.message}
                loadingPercentage={loadingInfo.percentage}
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
                onConfirm={() => {
                    if (loadingInfo.type === 'success') {
                        onSave({});
                    }
                    setLoadingInfo(prev => ({ ...prev, isOpen: false }));
                }}
            />
        </>
    );
};

export default ApplicationAttachmentModal;
