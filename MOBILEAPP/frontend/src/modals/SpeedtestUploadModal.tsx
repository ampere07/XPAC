import React, { useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { X, Upload } from 'lucide-react-native';
import ImagePreview from '../components/ImagePreview';
import { uploadJobOrderImages } from '../services/jobOrderService';
import { JobOrderData } from '../types/jobOrder';

interface SpeedtestUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    jobOrder: JobOrderData | any;
    onSuccess: () => void;
    colorPalette?: any;
    isDarkMode?: boolean;
}

const SpeedtestUploadModal: React.FC<SpeedtestUploadModalProps> = ({
    isOpen,
    onClose,
    jobOrder,
    onSuccess,
    colorPalette,
    isDarkMode = false
}) => {
    const [speedTestImage, setSpeedTestImage] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const primaryColor = colorPalette?.primary || '#7c3aed';

    const handleUpload = async () => {
        if (!speedTestImage) {
            Alert.alert('Error', 'Please select a speedtest image first.');
            return;
        }

        if (!jobOrder) {
            Alert.alert('Error', 'Job Order data is missing.');
            return;
        }

        try {
            setLoading(true);
            const formData = new FormData();
            
            const firstName = (jobOrder?.First_Name || jobOrder?.first_name || '').trim();
            const middleInitial = (jobOrder?.Middle_Initial || jobOrder?.middle_initial || '').trim();
            const lastName = (jobOrder?.Last_Name || jobOrder?.last_name || '').trim();
            const folderName = `(joborder)${firstName} ${middleInitial} ${lastName}`.trim() || 'SpeedtestImages';
            
            formData.append('folder_name', folderName);
            
            // Following the exact pattern in JobOrderDoneFormTechModal
            const fileToUpload = {
                uri: speedTestImage.uri,
                name: speedTestImage.name || 'speed_test_image.jpg',
                type: speedTestImage.type || 'image/jpeg',
            };
            
            formData.append('speed_test_image', fileToUpload as any);

            const jobOrderId = jobOrder.id || jobOrder.JobOrder_ID;
            
            if (!jobOrderId) {
                throw new Error('Job Order ID is missing');
            }

            const result = await uploadJobOrderImages(jobOrderId, formData);
            if (result.success) {
                Alert.alert('Success', 'Speedtest image uploaded successfully.');
                setSpeedTestImage(null);
                onSuccess();
                onClose();
            } else {
                throw new Error(result.message || 'Failed to upload image');
            }
        } catch (error: any) {
            console.error('Upload error:', error);
            Alert.alert('Upload Failed', error.message || 'An error occurred during upload.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            visible={isOpen}
            transparent={true}
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={st.modalOverlay}>
                <View style={[st.modalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
                    <View style={st.modalHeader}>
                        <Text style={[st.modalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>
                            Upload Speedtest Image
                        </Text>
                        <Pressable onPress={onClose} style={st.closeBtn}>
                            <X size={24} color={isDarkMode ? '#9ca3af' : '#6b7280'} />
                        </Pressable>
                    </View>

                    <View style={st.modalBody}>
                        <ImagePreview
                            label="Speedtest Image"
                            imageUrl={speedTestImage?.uri || null}
                            onUpload={(file) => setSpeedTestImage(file)}
                            isDarkMode={isDarkMode}
                            colorPrimary={primaryColor}
                            required={true}
                        />
                    </View>

                    <View style={st.modalFooter}>
                        <Pressable
                            style={[st.cancelBtn, { borderColor: isDarkMode ? '#374151' : '#e5e7eb' }]}
                            onPress={onClose}
                            disabled={loading}
                        >
                            <Text style={[st.cancelBtnText, { color: isDarkMode ? '#9ca3af' : '#4b5563' }]}>Cancel</Text>
                        </Pressable>
                        <Pressable
                            style={[st.uploadBtn, { backgroundColor: primaryColor, opacity: loading ? 0.7 : 1 }]}
                            onPress={handleUpload}
                            disabled={loading}
                        >
                            {loading ? (
                                <ActivityIndicator size="small" color="#ffffff" />
                            ) : (
                                <>
                                    <Upload size={18} color="#ffffff" style={st.btnIcon} />
                                    <Text style={st.uploadBtnText}>Upload</Text>
                                </>
                            )}
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const st = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
        width: '100%',
        maxWidth: 400,
        borderRadius: 12,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    closeBtn: {
        padding: 4,
    },
    modalBody: {
        marginBottom: 24,
    },
    modalFooter: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 12,
    },
    cancelBtn: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
    },
    cancelBtnText: {
        fontWeight: '500',
    },
    uploadBtn: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 100,
    },
    uploadBtnText: {
        color: '#ffffff',
        fontWeight: '600',
    },
    btnIcon: {
        marginRight: 8,
    },
});

export default SpeedtestUploadModal;
