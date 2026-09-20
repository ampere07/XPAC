import React, { useState } from 'react';
import { View, Text, Pressable, Image, Alert, Modal, Platform } from 'react-native';
import { Camera, X, Upload, Image as ImageIcon } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';

interface ImagePreviewProps {
    label: string;
    imageUrl?: string | null;
    onUpload: (file: any) => void;
    error?: string;
    isDarkMode?: boolean;
    colorPrimary?: string;
    required?: boolean;
    /**
     * Whether taking a photo also files it in the phone's gallery there and then.
     *
     * On by default, which is what most forms want. Set it false on a form that
     * saves its own photos when it is submitted (see utils/saveImagesToGallery)
     * — otherwise every picture lands in the gallery twice, once under the
     * picker's own name and once under the form's.
     */
    saveToGalleryOnCapture?: boolean;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({
    label,
    imageUrl,
    onUpload,
    error,
    isDarkMode = false,
    colorPrimary = '#7c3aed',
    required = false,
    saveToGalleryOnCapture = true
}) => {
    const [modalVisible, setModalVisible] = useState(false);

    const pickImage = async () => {
        // Request permission
        if (Platform.OS === 'ios') {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission needed', 'Sorry, we need camera roll permissions to make this work!');
                return;
            }
        }

        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: false,
            quality: 0.7,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const asset = result.assets[0];
            const file = {
                uri: asset.uri,
                name: asset.fileName || 'upload.jpg',
                type: (asset as any).mimeType || (asset.type === 'image' ? 'image/jpeg' : asset.type)
            };
            onUpload(file);
            setModalVisible(false);
        }
    };

    const takePhoto = async () => {
        // Request permission
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission needed', 'Sorry, we need camera permissions to make this work!');
            return;
        }

        let result = await ImagePicker.launchCameraAsync({
            allowsEditing: false,
            quality: 0.7,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const asset = result.assets[0];

            // Save the photo to the gallery as it is taken, unless the form
            // saves its own on submission — in which case doing it here as well
            // would file the same picture twice under two different names.
            if (saveToGalleryOnCapture) {
                try {
                    const { status: mediaStatus } = await MediaLibrary.requestPermissionsAsync(true);
                    if (mediaStatus === 'granted') {
                        await MediaLibrary.createAssetAsync(asset.uri);
                    } else {
                        console.warn('Media library permission not granted, skipping save to gallery');
                    }
                } catch (mediaError) {
                    console.error('Failed to save photo to gallery:', mediaError);
                }
            }

            const file = {
                uri: asset.uri,
                name: asset.fileName || 'photo.jpg',
                type: (asset as any).mimeType || (asset.type === 'image' ? 'image/jpeg' : asset.type)
            };
            onUpload(file);
            setModalVisible(false);
        }
    };

    return (
        <View className="mb-4">
            <Text className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {label}
                {required && <Text style={{ color: '#ef4444' }}> *</Text>}
            </Text>

            <View className="flex-row items-center space-x-4 gap-4">
                {/* Preview Area */}
                {imageUrl ? (
                    <View className="relative w-24 h-24 rounded-lg overflow-hidden border border-gray-300">
                        <Image
                            source={{ uri: imageUrl }}
                            className="w-full h-full"
                            resizeMode="cover"
                        />
                        <Pressable
                            onPress={() => onUpload(null)}
                            className="absolute top-1 right-1 bg-black/60 rounded-full p-1"
                            hitSlop={8}
                        >
                            <X size={14} color="#ffffff" />
                        </Pressable>
                    </View>
                ) : (
                    <View className={`w-24 h-24 rounded-lg border-2 border-dashed flex items-center justify-center ${isDarkMode ? 'border-gray-600 bg-gray-800' : 'border-gray-300 bg-gray-50'
                        }`}>
                        <ImageIcon size={40} color={isDarkMode ? '#4b5563' : '#9ca3af'} />
                    </View>
                )}

                {/* Upload Button */}
                <Pressable
                    onPress={() => setModalVisible(true)}
                    className={`flex-1 flex-row items-center justify-center space-x-2 py-3 px-4 rounded-lg border border-dashed ${isDarkMode
                        ? 'border-gray-600 bg-gray-800'
                        : 'border-gray-300 bg-gray-50'
                        }`}
                >
                    <Camera size={20} color={isDarkMode ? '#9ca3af' : '#6b7280'} />
                    <Text className={`ml-2 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        Click to upload
                    </Text>
                </Pressable>
            </View>

            {error && (
                <View className="flex-row items-center mt-1">
                    <View
                        className="flex items-center justify-center w-4 h-4 rounded-full mr-2"
                        style={{ backgroundColor: colorPrimary }}
                    >
                        <Text className="text-white text-[10px] font-bold">!</Text>
                    </View>
                    <Text className="text-xs" style={{ color: colorPrimary }}>{error}</Text>
                </View>
            )}

            {/* Selection Modal */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={modalVisible}
                onRequestClose={() => setModalVisible(false)}
            >
                <View className="flex-1 justify-end bg-black/50">
                    <View className={`rounded-t-xl p-6 ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
                        <View className="flex-row justify-between items-center mb-6">
                            <Text className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                Upload Photo
                            </Text>
                            <Pressable onPress={() => setModalVisible(false)}>
                                <X size={24} color={isDarkMode ? '#fff' : '#000'} />
                            </Pressable>
                        </View>

                        <View className="space-y-4 gap-4 pb-8">
                            <Pressable
                                onPress={takePhoto}
                                className={`flex-row items-center p-4 rounded-xl border ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
                                    }`}
                            >
                                <View className={`p-3 rounded-full mr-4 ${isDarkMode ? 'bg-gray-700' : 'bg-white'}`}>
                                    <Camera size={24} color={colorPrimary} />
                                </View>
                                <View>
                                    <Text className={`font-semibold text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                        Take Photo
                                    </Text>
                                    <Text className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                        Use your camera to take a new photo
                                    </Text>
                                </View>
                            </Pressable>

                            <Pressable
                                onPress={pickImage}
                                className={`flex-row items-center p-4 rounded-xl border ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
                                    }`}
                            >
                                <View className={`p-3 rounded-full mr-4 ${isDarkMode ? 'bg-gray-700' : 'bg-white'}`}>
                                    <Upload size={24} color={colorPrimary} />
                                </View>
                                <View>
                                    <Text className={`font-semibold text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                        Choose from Library
                                    </Text>
                                    <Text className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                        Select an existing photo from your gallery
                                    </Text>
                                </View>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
};

export default ImagePreview;
