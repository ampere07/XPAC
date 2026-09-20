import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Palette, Plus, Image as ImageIcon, Trash2, Check, Zap } from 'lucide-react-native';
import AddColorPaletteModal from '../modals/AddColorPaletteModal';
import GenerateBillingModal from '../modals/GenerateBillingModal';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { settingsImageSizeService, ImageSize } from '../services/settingsImageSizeService';
import {
  settingsColorPaletteService,
  ColorPalette as DbColorPalette,
} from '../services/settingsColorPaletteService';
import { systemConfigService } from '../services/systemConfigService';

interface ColorPalette {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const Settings: React.FC = () => {
  const isDarkMode = false; // Forced light mode
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const [refreshing, setRefreshing] = useState(false);
  const [showAddPaletteModal, setShowAddPaletteModal] = useState<boolean>(false);
  const [dbPalettes, setDbPalettes] = useState<DbColorPalette[]>([]);
  const [imageSizes, setImageSizes] = useState<ImageSize[]>([]);
  const [activeImageSizeId, setActiveImageSizeId] = useState<number | null>(null);
  const [selectedImageSizeId, setSelectedImageSizeId] = useState<number | null>(null);
  const [isEditingImageSize, setIsEditingImageSize] = useState<boolean>(false);
  const [isSavingImageSize] = useState<boolean>(false);
  const [colorPalette, setColorPalette] = useState<DbColorPalette | null>(null);
  const [userRoleId, setUserRoleId] = useState<number | null>(null);
  const [userRoleName, setUserRoleName] = useState<string>('');
  const [showGenerateBillingModal, setShowGenerateBillingModal] = useState<boolean>(false);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoAsset, setLogoAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: '',
  });

  const primary = colorPalette?.primary || '#7c3aed';

  const colors = {
    pageBg: '#f9fafb',
    card: '#ffffff',
    surface: '#f3f4f6',
    border: '#e5e7eb',
    text: '#111827',
    subtext: '#6b7280',
  };

  const isAdmin = userRoleId === 7 || userRoleName.toLowerCase() === 'superadmin';

  const convertGoogleDriveUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('blob:') || url.startsWith('file:')) return url;
    const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || '';
    return `${apiUrl}/proxy/image?url=${encodeURIComponent(url)}`;
  };

  const fetchColorPalette = async () => {
    try {
      const activePalette = await settingsColorPaletteService.getActive();
      setColorPalette(activePalette);
    } catch (err) {
      console.error('Failed to fetch color palette:', err);
    }
  };

  const loadLogo = async () => {
    try {
      const url = await systemConfigService.getLogo();
      setLogoUrl(url);
    } catch (error) {
      console.error('Failed to load logo:', error);
    }
  };

  const loadUserRole = async () => {
    try {
      const authData = await AsyncStorage.getItem('authData');
      if (authData) {
        const userData = JSON.parse(authData);
        setUserRoleId(userData.role_id || null);
        setUserRoleName(userData.role || '');
      }
    } catch (error) {
      console.error('[Settings] Failed to load user role:', error);
    }
  };

  const loadColorPalettes = async () => {
    try {
      const palettes = await settingsColorPaletteService.getAll();
      setDbPalettes(palettes);
    } catch (error) {
      console.error('Failed to load color palettes:', error);
    }
  };

  const loadImageSizes = async () => {
    try {
      const sizes = await settingsImageSizeService.getAll();
      setImageSizes(sizes);
      const active = sizes.find((size) => size.status === 'active');
      if (active) {
        setActiveImageSizeId(active.id);
        setSelectedImageSizeId(active.id);
      }
    } catch (error) {
      console.error('Failed to load image sizes:', error);
    }
  };

  useEffect(() => {
    fetchColorPalette();
    loadLogo();
    loadUserRole();
    loadImageSizes();
    loadColorPalettes();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchColorPalette(), loadLogo(), loadImageSizes(), loadColorPalettes()]);
    setRefreshing(false);
  };

  const runProgress = () => {
    setLoading(true);
    setLoadingPercentage(0);
    const progressInterval = setInterval(() => {
      setLoadingPercentage((prev) => {
        if (prev >= 90) return Math.min(99, prev + 1);
        return Math.min(99, prev + 10);
      });
    }, 100);
    return progressInterval;
  };

  const handlePaletteStatusChange = async (id: number, status: 'active' | 'inactive') => {
    const progressInterval = runProgress();
    try {
      await settingsColorPaletteService.updateStatus(id, status);
      await loadColorPalettes();
      await fetchColorPalette();

      clearInterval(progressInterval);
      setLoadingPercentage(100);

      setTimeout(() => {
        setLoading(false);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'Color palette activated successfully!',
        });
      }, 500);
    } catch (error) {
      clearInterval(progressInterval);
      setLoading(false);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to activate color palette',
      });
    }
  };

  const handleEditImageSize = () => setIsEditingImageSize(true);

  const handleCancelImageSize = () => {
    setSelectedImageSizeId(activeImageSizeId);
    setIsEditingImageSize(false);
  };

  const handleSaveImageSize = async () => {
    if (selectedImageSizeId === null) return;

    const progressInterval = runProgress();
    try {
      await settingsImageSizeService.updateStatus(selectedImageSizeId, 'active');
      await loadImageSizes();
      setIsEditingImageSize(false);

      clearInterval(progressInterval);
      setLoadingPercentage(100);

      setTimeout(() => {
        setLoading(false);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'Image upload size updated successfully!',
        });
      }, 500);
    } catch (error) {
      clearInterval(progressInterval);
      setLoading(false);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to update image upload size',
      });
    }
  };

  const handleAddPalette = async (newPalette: ColorPalette) => {
    await settingsColorPaletteService.create({
      palette_name: newPalette.name,
      primary: newPalette.primary,
      secondary: newPalette.secondary,
      accent: newPalette.accent,
      updated_by: 'system',
    });
    await loadColorPalettes();
  };

  const handleDeletePalette = async (id: number) => {
    try {
      await settingsColorPaletteService.delete(id);
      await loadColorPalettes();
    } catch (error) {
      console.error('Failed to delete color palette:', error);
    }
  };

  const confirmDeletePalette = (id: number, name: string) => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Delete Palette',
      message: `Delete ${name}?`,
      onConfirm: () => {
        setModal((m) => ({ ...m, isOpen: false }));
        handleDeletePalette(id);
      },
      onCancel: () => setModal((m) => ({ ...m, isOpen: false })),
    });
  };

  const handleSelectLogo = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setModal({
          isOpen: true,
          type: 'warning',
          title: 'Permission Required',
          message: 'Photo library access is needed to select a logo.',
        });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
      });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];

      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
        setModal({
          isOpen: true,
          type: 'warning',
          title: 'File Too Large',
          message: 'File size must be less than 5MB',
        });
        return;
      }

      setLogoAsset(asset);
    } catch (error) {
      console.error('Failed to pick logo:', error);
    }
  };

  const handleUploadLogo = async () => {
    if (!logoAsset) return;

    setIsUploadingLogo(true);
    const progressInterval = runProgress();

    try {
      const authData = await AsyncStorage.getItem('authData');
      const userData = authData ? JSON.parse(authData) : null;
      const updatedBy = userData?.username || 'system';

      const fileName = logoAsset.fileName || `logo_${Date.now()}.jpg`;
      const fileType = logoAsset.mimeType || 'image/jpeg';
      const filePart = {
        uri: logoAsset.uri,
        name: fileName,
        type: fileType,
      } as unknown as File;

      const result = await systemConfigService.uploadLogo(filePart, updatedBy);

      if (result.success && result.data) {
        setLogoUrl(result.data.logo_url);
        setLogoAsset(null);

        clearInterval(progressInterval);
        setLoadingPercentage(100);

        setTimeout(() => {
          setLoading(false);
          setModal({
            isOpen: true,
            type: 'success',
            title: 'Success',
            message: 'Logo uploaded successfully!',
          });
        }, 500);
      } else {
        clearInterval(progressInterval);
        setLoading(false);
      }
    } catch (error) {
      clearInterval(progressInterval);
      setLoading(false);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to upload logo',
      });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const doDeleteLogo = async () => {
    const progressInterval = runProgress();
    try {
      const authData = await AsyncStorage.getItem('authData');
      const userData = authData ? JSON.parse(authData) : null;
      const updatedBy = userData?.username || 'system';

      await systemConfigService.deleteLogo(updatedBy);
      setLogoUrl(null);

      clearInterval(progressInterval);
      setLoadingPercentage(100);

      setTimeout(() => {
        setLoading(false);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'Logo deleted successfully!',
        });
      }, 500);
    } catch (error) {
      clearInterval(progressInterval);
      setLoading(false);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to delete logo',
      });
    }
  };

  const handleDeleteLogo = () => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Delete Logo',
      message: 'Are you sure you want to delete the logo?',
      onConfirm: () => {
        setModal((m) => ({ ...m, isOpen: false }));
        doDeleteLogo();
      },
      onCancel: () => setModal((m) => ({ ...m, isOpen: false })),
    });
  };

  const CheckBadge = () => (
    <View
      style={{
        height: 20,
        width: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary,
      }}
    >
      <Check size={12} color="#ffffff" strokeWidth={3} />
    </View>
  );

  const sectionTitle = (title: string) => (
    <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 16 }}>{title}</Text>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingTop: isTablet ? 16 : 60, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[primary]} tintColor={primary} />}
      >
        {/* Page header */}
        <View style={{ marginBottom: 24, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 24, fontWeight: '600', color: colors.text }}>Settings</Text>
        </View>

        {!isAdmin && (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Text style={{ color: colors.subtext, textAlign: 'center' }}>
              No settings available for your role.
            </Text>
          </View>
        )}

        {/* System Logo */}
        {isAdmin && (
          <View style={{ paddingBottom: 24, marginBottom: 24, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            {sectionTitle('System Logo')}
            <View style={{ padding: 20, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
              {logoAsset ? (
                <View style={{ gap: 16 }}>
                  <View style={{ alignItems: 'center', gap: 12 }}>
                    <View
                      style={{
                        padding: 16,
                        backgroundColor: '#ffffff',
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: colors.border,
                        width: '100%',
                        alignItems: 'center',
                      }}
                    >
                      <Image
                        source={{ uri: logoAsset.uri }}
                        style={{ height: 128, width: '100%', maxWidth: 320 }}
                        resizeMode="contain"
                      />
                    </View>
                    <Text style={{ fontSize: 13, color: colors.subtext }}>
                      Selected: {logoAsset.fileName || 'image'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={handleUploadLogo}
                      disabled={isUploadingLogo}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        borderRadius: 8,
                        backgroundColor: isUploadingLogo ? '#9ca3af' : primary,
                      }}
                    >
                      <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>
                        {isUploadingLogo ? 'Uploading...' : 'Upload Logo'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setLogoAsset(null)}
                      disabled={isUploadingLogo}
                      style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#6b7280' }}
                    >
                      <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : logoUrl ? (
                <View style={{ gap: 16 }}>
                  <View
                    style={{
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 16,
                      backgroundColor: '#ffffff',
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Image
                      source={{ uri: convertGoogleDriveUrl(logoUrl) }}
                      style={{ height: 128, width: '100%', maxWidth: 320 }}
                      resizeMode="contain"
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={handleSelectLogo}
                      style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: primary }}
                    >
                      <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Change Logo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleDeleteLogo}
                      style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#dc2626' }}
                    >
                      <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Delete Logo</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={{ gap: 16 }}>
                  <View
                    style={{
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 32,
                      borderWidth: 2,
                      borderStyle: 'dashed',
                      borderColor: '#9ca3af',
                      borderRadius: 8,
                    }}
                  >
                    <ImageIcon size={48} color="#9ca3af" />
                    <Text style={{ fontSize: 13, marginTop: 16, marginBottom: 8, color: colors.subtext }}>
                      No logo uploaded
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.subtext }}>
                      Supported formats: JPEG, PNG, GIF, SVG (Max 5MB)
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleSelectLogo}
                    style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: primary, alignSelf: 'flex-start' }}
                  >
                    <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Select Logo</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Color Palette */}
        {isAdmin && (
          <View style={{ paddingBottom: 24, marginBottom: 24, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <Palette size={20} color={primary} />
              <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>Color Palette</Text>
            </View>

            <View style={{ gap: 12 }}>
              {dbPalettes.map((palette) => {
                const isDefault = (palette.palette_name || '').toLowerCase() === 'default';
                const active = palette.status === 'active';
                return (
                  <View
                    key={palette.id}
                    style={{
                      padding: 16,
                      borderRadius: 8,
                      borderWidth: active ? 2 : 1,
                      borderColor: active ? primary : colors.border,
                      backgroundColor: colors.card,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <Text style={{ fontWeight: '500', fontSize: 14, color: colors.text }}>{palette.palette_name}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {active && <CheckBadge />}
                        {palette.status === 'inactive' && (
                          <TouchableOpacity
                            onPress={() => handlePaletteStatusChange(palette.id, 'active')}
                            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.surface }}
                          >
                            <Text style={{ fontSize: 12, color: colors.text }}>Activate</Text>
                          </TouchableOpacity>
                        )}
                        {!isDefault && (
                          <TouchableOpacity
                            onPress={() => confirmDeletePalette(palette.id, palette.palette_name)}
                            style={{ padding: 6 }}
                          >
                            <Trash2 size={16} color="#dc2626" />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ height: 40, borderRadius: 6, backgroundColor: palette.primary }} />
                        <Text style={{ fontSize: 12, marginTop: 4, textAlign: 'center', color: colors.subtext }}>Primary</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ height: 40, borderRadius: 6, backgroundColor: palette.accent }} />
                        <Text style={{ fontSize: 12, marginTop: 4, textAlign: 'center', color: colors.subtext }}>Accent</Text>
                      </View>
                    </View>
                  </View>
                );
              })}

              <TouchableOpacity
                onPress={() => setShowAddPaletteModal(true)}
                style={{
                  padding: 16,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  minHeight: 120,
                }}
              >
                <View
                  style={{
                    height: 40,
                    width: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.surface,
                  }}
                >
                  <Plus size={20} color={primary} />
                </View>
                <Text style={{ fontWeight: '500', fontSize: 14, color: colors.text }}>Add Custom Palette</Text>
                <Text style={{ fontSize: 12, textAlign: 'center', color: colors.subtext }}>
                  Create your own color scheme
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Image Upload Size */}
        {isAdmin && (
          <View style={{ paddingBottom: 24, marginBottom: 24, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <ImageIcon size={20} color={primary} />
              <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>Image Upload Size</Text>
            </View>

            <View style={{ padding: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
              <View style={{ gap: 8, marginBottom: 16 }}>
                {imageSizes.map((size) => {
                  const isSelected = selectedImageSizeId === size.id;
                  return (
                    <TouchableOpacity
                      key={size.id}
                      activeOpacity={isEditingImageSize ? 0.7 : 1}
                      onPress={() => isEditingImageSize && setSelectedImageSizeId(size.id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 12,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: isSelected ? primary : colors.border,
                        backgroundColor: isSelected ? `${primary}1A` : 'transparent',
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                        <Text style={{ fontWeight: '500', color: colors.text }}>{size.image_size}</Text>
                        <Text style={{ fontSize: 13, color: colors.subtext }}>
                          -{size.image_size_value}% maximum size
                        </Text>
                      </View>
                      {size.status === 'active' && !isEditingImageSize && <CheckBadge />}
                      {isSelected && isEditingImageSize && <CheckBadge />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                {!isEditingImageSize ? (
                  <TouchableOpacity
                    onPress={handleEditImageSize}
                    style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: primary }}
                  >
                    <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Edit</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity
                      onPress={handleSaveImageSize}
                      disabled={isSavingImageSize || selectedImageSizeId === activeImageSizeId}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        borderRadius: 8,
                        backgroundColor:
                          isSavingImageSize || selectedImageSizeId === activeImageSizeId ? '#9ca3af' : primary,
                      }}
                    >
                      <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>
                        {isSavingImageSize ? 'Saving...' : 'Save'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleCancelImageSize}
                      disabled={isSavingImageSize}
                      style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#6b7280' }}
                    >
                      <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Cancel</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Manual Billing Generation */}
        {isAdmin && (
          <View style={{ paddingBottom: 8 }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>Manual Billing Generation</Text>
            <Text style={{ fontSize: 13, marginTop: 4, marginBottom: 16, color: colors.subtext }}>
              Manually generate an SOA and Invoice for a specific customer with an optional service charge.
            </Text>

            <View style={{ padding: 20, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: `${primary}18`,
                  }}
                >
                  <Zap size={18} color={primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text }}>Generate Billing</Text>
                  <Text style={{ fontSize: 12, marginTop: 2, color: colors.subtext }}>
                    Select a customer, set an optional service charge, and generate instantly.
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => setShowGenerateBillingModal(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  borderRadius: 10,
                  backgroundColor: primary,
                }}
              >
                <Zap size={15} color="#ffffff" />
                <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}>Generate</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      <AddColorPaletteModal
        isOpen={showAddPaletteModal}
        onClose={() => setShowAddPaletteModal(false)}
        onSave={handleAddPalette}
        colorPalette={colorPalette}
      />

      <GenerateBillingModal
        isOpen={showGenerateBillingModal}
        onClose={() => setShowGenerateBillingModal(false)}
        colorPalette={colorPalette}
        isDarkMode={isDarkMode}
      />

      {loading && (
        <LoadingModalGlobal
          isOpen={loading}
          type="loading"
          title="Please wait"
          message=""
          loadingPercentage={loadingPercentage}
          colorPalette={colorPalette}
          isDarkMode={isDarkMode}
        />
      )}

      {modal.isOpen && (
        <LoadingModalGlobal
          isOpen={modal.isOpen}
          type={modal.type}
          title={modal.title}
          message={modal.message}
          onConfirm={
            modal.onConfirm ? modal.onConfirm : () => setModal((m) => ({ ...m, isOpen: false }))
          }
          onCancel={modal.onCancel ? modal.onCancel : () => setModal((m) => ({ ...m, isOpen: false }))}
          colorPalette={colorPalette}
          isDarkMode={isDarkMode}
        />
      )}
    </View>
  );
};

export default Settings;
