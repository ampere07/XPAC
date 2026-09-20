import React, { useState, useEffect, useRef } from 'react';
import { Camera, Trash2, CheckCircle, Upload, ExternalLink } from 'lucide-react';
import ModalUITemplate from './ui-modal/ModalUITemplate';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';
import apiClient from '../config/api';
import { updateJobOrder } from '../services/jobOrderService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

interface JOAttachmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (formData: any) => void;
    jobOrderData?: any;
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
                            // Fallback to direct drive link if thumbnail fails
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

const JOAttachmentModal: React.FC<JOAttachmentModalProps> = ({
    isOpen,
    onClose,
    onSave,
    jobOrderData,
    loading = false
}) => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);
    const [files, setFiles] = useState<{
        setupImage: File | null;
        speedTestImage: File | null;
        signedContract: File | null;
        boxReadingImage: File | null;
        routerReading: File | null;
        portLabel: File | null;
        houseFrontImage: File | null;
    }>({
        setupImage: null,
        speedTestImage: null,
        signedContract: null,
        boxReadingImage: null,
        routerReading: null,
        portLabel: null,
        houseFrontImage: null,
    });

    const [previews, setPreviews] = useState<{ [key: string]: string | null }>({
        setupImage: null,
        speedTestImage: null,
        signedContract: null,
        boxReadingImage: null,
        routerReading: null,
        portLabel: null,
        houseFrontImage: null,
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
        if (url.startsWith('data:')) return url; // Already a data URL
        
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
        if (isOpen && jobOrderData) {
            // Load existing images if available
            setPreviews({
                setupImage: convertGoogleDriveUrl(jobOrderData.setup_image_url || jobOrderData.Setup_Image_URL),
                speedTestImage: convertGoogleDriveUrl(jobOrderData.speedtest_image_url || jobOrderData.Speedtest_Image_URL),
                signedContract: convertGoogleDriveUrl(jobOrderData.signed_contract_image_url || jobOrderData.Signed_Contract_Image_URL),
                boxReadingImage: convertGoogleDriveUrl(jobOrderData.box_reading_image_url || jobOrderData.Box_Reading_Image_URL),
                routerReading: convertGoogleDriveUrl(jobOrderData.router_reading_image_url || jobOrderData.Router_Reading_Image_URL),
                portLabel: convertGoogleDriveUrl(jobOrderData.port_label_image_url || jobOrderData.Port_Label_Image_URL),
                houseFrontImage: convertGoogleDriveUrl(jobOrderData.house_front_image_url || jobOrderData.house_front_picture_url || jobOrderData.houseFrontPicture || jobOrderData.House_Front_Image_URL),
            });
        } else if (!isOpen) {
            // Reset
            setFiles({
                setupImage: null,
                speedTestImage: null,
                signedContract: null,
                boxReadingImage: null,
                routerReading: null,
                portLabel: null,
                houseFrontImage: null,
            });
            setPreviews({
                setupImage: null,
                speedTestImage: null,
                signedContract: null,
                boxReadingImage: null,
                routerReading: null,
                portLabel: null,
                houseFrontImage: null,
            });
        }
    }, [isOpen, jobOrderData]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, field: string) => {
        if (e.target.files && e.target.files[0]) {
            let file = e.target.files[0];
            
            // Apply resizing if setting is active
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
        if (!jobOrderData?.id) {
            console.error('Job Order ID is missing');
            return;
        }

        const jobOrderId = jobOrderData.id;
        const firstName = (jobOrderData?.First_Name || jobOrderData?.first_name || '').trim();
        const middleInitial = (jobOrderData?.Middle_Initial || jobOrderData?.middle_initial || '').trim();
        const fullLastName = (jobOrderData?.Last_Name || jobOrderData?.last_name || '').trim();
        const folderName = `(joborder)${firstName} ${middleInitial} ${fullLastName}`.trim();

        const imageFormData = new FormData();
        imageFormData.append('folder_name', folderName);

        let hasFiles = false;
        Object.entries(files).forEach(([key, file]) => {
            if (file) {
                // Map frontend field names to backend names expected by /upload-images
                const backendKeyMap: Record<string, string> = {
                    setupImage: 'setup_image',
                    speedTestImage: 'speed_test_image',
                    signedContract: 'signed_contract_image',
                    boxReadingImage: 'box_reading_image',
                    routerReading: 'router_reading_image',
                    portLabel: 'port_label_image',
                    houseFrontImage: 'house_front_image'
                };
                imageFormData.append(backendKeyMap[key] || key, file, file.name);
                hasFiles = true;
            }
        });


        if (!hasFiles) {
            onSave({}); // No new files to upload
            return;
        }

        // Start Loading
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
            // 1. Upload Images
            const uploadResponse = await apiClient.post<any>(`/job-orders/${jobOrderId}/upload-images`, imageFormData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (uploadResponse.data.success && uploadResponse.data.data) {
                setLoadingInfo(prev => ({ ...prev, message: 'Updating Job Order record...', percentage: 95 }));
                const imageUrls = uploadResponse.data.data;
                
                // 2. Prepare Job Order Update Data
                const updateData: any = {};
                if (imageUrls.signed_contract_image_url) updateData.signed_contract_image_url = imageUrls.signed_contract_image_url;
                if (imageUrls.setup_image_url) updateData.setup_image_url = imageUrls.setup_image_url;
                if (imageUrls.box_reading_image_url) updateData.box_reading_image_url = imageUrls.box_reading_image_url;
                if (imageUrls.router_reading_image_url) updateData.router_reading_image_url = imageUrls.router_reading_image_url;
                if (imageUrls.port_label_image_url) updateData.port_label_image_url = imageUrls.port_label_image_url;
                if (imageUrls.client_signature_image_url) updateData.client_signature_url = imageUrls.client_signature_image_url;
                if (imageUrls.speedtest_image_url) updateData.speedtest_image_url = imageUrls.speedtest_image_url;
                if (imageUrls.house_front_image_url) updateData.house_front_picture_url = imageUrls.house_front_image_url;

                // 3. Update Job Order
                await updateJobOrder(jobOrderId, updateData);
                
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
            title="Job Order Attachments"
            maxWidth="max-w-xl"
            primaryAction={{
                label: 'Save Attachments',
                onClick: handleSave,
                disabled: loading
            }}
            loading={loading}
        >
            <div className="space-y-6">
                {/* Image Uploads */}
                <ImageUploadField label="House Front Image" field="houseFrontImage" preview={previews.houseFrontImage} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                <ImageUploadField label="Setup Image" field="setupImage" preview={previews.setupImage} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                <ImageUploadField label="Speed Test Result" field="speedTestImage" preview={previews.speedTestImage} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                <ImageUploadField label="Signed Contract" field="signedContract" preview={previews.signedContract} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                <ImageUploadField label="Box Reading" field="boxReadingImage" preview={previews.boxReadingImage} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                <ImageUploadField label="Router Reading" field="routerReading" preview={previews.routerReading} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
                <ImageUploadField label="Port Label" field="portLabel" preview={previews.portLabel} isDarkMode={isDarkMode} handleFileChange={handleFileChange} clearFile={clearFile} />
            </div>

            {/* Hint for mobile users */}
            <div className={`p-4 rounded-lg flex items-start gap-3 ${isDarkMode ? 'bg-blue-900/20 text-blue-300' : 'bg-blue-50 text-blue-700'}`}>
                <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
                <p className="text-xs leading-relaxed">
                    Ensure all images are clear and readable before saving. You can click on any uploaded image to replace it.
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
                    onSave({}); // Close parent
                }
                setLoadingInfo(prev => ({ ...prev, isOpen: false }));
            }}
        />
    </>
);
};

export default JOAttachmentModal;
