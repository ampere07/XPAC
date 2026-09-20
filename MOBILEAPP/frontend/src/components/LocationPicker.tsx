import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator } from 'react-native';
import MapView, { Marker, MapPressEvent } from 'react-native-maps';
import { MapPin, Navigation } from 'lucide-react-native';
import * as Location from 'expo-location';
import { ensureLocationPermission } from '../services/locationConsent';

interface LocationPickerProps {
  value: string;
  onChange: (coordinates: string) => void;
  isDarkMode: boolean;
  label?: string;
  required?: boolean;
  error?: string;
}

interface Coordinates {
  latitude: number;
  longitude: number;
}

const DEFAULT_REGION = {
  latitude: 14.5995,
  longitude: 120.9842,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const LocationPicker: React.FC<LocationPickerProps> = ({
  value,
  onChange,
  isDarkMode,
  label = 'Location',
  required = false,
  error
}) => {
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [region, setRegion] = useState(DEFAULT_REGION);

  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');

  const mapRef = React.useRef<MapView>(null);

  useEffect(() => {
    if (value !== undefined) {
      const parts = value.split(',');
      if (parts.length >= 1) setLatInput(parts[0].trim());
      if (parts.length >= 2) setLngInput(parts[1].trim());
    }
    if (value && value.trim()) {
      const parts = value.split(',').map(p => p.trim());
      if (parts.length === 2) {
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lng)) {
          const newCoords = { latitude: lat, longitude: lng };
          setCoordinates(newCoords);
          const newRegion = {
            ...newCoords,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          };
          setRegion(newRegion);
          mapRef.current?.animateToRegion(newRegion, 1000);
        }
      }
    }
  }, [value]);

  const updateCoordinates = (lat: number, lng: number) => {
    const newCoords = { latitude: lat, longitude: lng };
    setCoordinates(newCoords);
    const newRegion = {
      ...newCoords,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
    setRegion(newRegion);
    mapRef.current?.animateToRegion(newRegion, 1000);
    onChange(`${lat}, ${lng}`);
    setLatInput(lat.toString());
    setLngInput(lng.toString());
  };

  const handleLatChange = (text: string) => {
    setLatInput(text);
    const lat = parseFloat(text);
    const lng = parseFloat(lngInput);
    if (!isNaN(lat) && !isNaN(lng) && isFinite(lat) && isFinite(lng) && text.trim() !== '' && lngInput.trim() !== '') {
      // Update map only if both are valid
      const newCoords = { latitude: lat, longitude: lng };
      setCoordinates(newCoords);
      const newRegion = {
        ...newCoords,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 1000);
      onChange(`${lat}, ${lng}`);
    } else {
      // Just update parent text
      onChange(`${text}, ${lngInput}`);
    }
  };

  const handleLngChange = (text: string) => {
    setLngInput(text);
    const lat = parseFloat(latInput);
    const lng = parseFloat(text);
    if (!isNaN(lat) && !isNaN(lng) && isFinite(lat) && isFinite(lng) && latInput.trim() !== '' && text.trim() !== '') {
      // Update map only if both are valid
      const newCoords = { latitude: lat, longitude: lng };
      setCoordinates(newCoords);
      const newRegion = {
        ...newCoords,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 1000);
      onChange(`${lat}, ${lng}`);
    } else {
      // Just update parent text
      onChange(`${latInput}, ${text}`);
    }
  };

  const handleGetCurrentLocation = async () => {
    setIsGettingLocation(true);
    try {
      // 1) permission — shows the in-app disclosure before the OS prompt, then requests.
      const granted = await ensureLocationPermission();
      if (!granted) {
        Alert.alert('Permission Denied', 'Permission to access location was denied. Please enable it in settings.');
        setIsGettingLocation(false);
        return;
      }

      // 2) services enabled?
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        Alert.alert('Location Services Off', 'Location services are OFF (GPS disabled). Please turn them on in settings.');
        setIsGettingLocation(false);
        return;
      }

      // 3) try last known first (fast, more reliable)
      let location = await Location.getLastKnownPositionAsync({});

      // 4) if no last known, then current position with balanced accuracy
      if (!location) {
        location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }

      if (location) {
        const { latitude, longitude } = location.coords;
        const roundedLat = parseFloat(latitude.toFixed(6));
        const roundedLng = parseFloat(longitude.toFixed(6));
        updateCoordinates(roundedLat, roundedLng);
      } else {
        Alert.alert('Location Error', 'Current location is unavailable. Check signal or map settings.');
      }

    } catch (error: any) {
      console.log("Error getting location:", error);
      Alert.alert('Error', error.message || 'Unable to get your current location.');
    } finally {
      setIsGettingLocation(false);
    }
  };

  const handleMapPress = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const roundedLat = parseFloat(latitude.toFixed(6));
    const roundedLng = parseFloat(longitude.toFixed(6));
    updateCoordinates(roundedLat, roundedLng);
  };

  const handleMarkerDragEnd = (e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const roundedLat = parseFloat(latitude.toFixed(6));
    const roundedLng = parseFloat(longitude.toFixed(6));
    updateCoordinates(roundedLat, roundedLng);
  };

  return (
    <View className="mb-4">
      <Text className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
        {label}{required && <Text className="text-red-500">*</Text>}
      </Text>

      <View className={`border rounded-lg overflow-hidden ${isDarkMode ? 'border-gray-700' : 'border-gray-300'
        } ${error ? 'border-red-500' : ''}`}>
        <View className="relative h-64 w-full bg-gray-200">
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            region={region}
            onRegionChangeComplete={setRegion}
            onPress={handleMapPress}
            showsPointsOfInterest={false}
            showsBuildings={false}
            showsTraffic={false}
            showsIndoors={false}
            userInterfaceStyle={isDarkMode ? 'dark' : 'light'}
          >
            {coordinates && (
              <Marker
                draggable
                coordinate={coordinates}
                onDragEnd={handleMarkerDragEnd}
              />
            )}
          </MapView>
          <Pressable
            onPress={handleGetCurrentLocation}
            disabled={isGettingLocation}
            className={`absolute top-2 right-2 px-3 py-2 rounded shadow-lg flex-row items-center z-10 ${isDarkMode
              ? 'bg-gray-800'
              : 'bg-white'
              }`}
          >
            {isGettingLocation ? (
              <ActivityIndicator size="small" color={isDarkMode ? '#fff' : '#000'} />
            ) : (
              <Navigation size={16} color={isDarkMode ? 'white' : 'black'} />
            )}
            <Text className={`text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'} ml-2`}>
              {isGettingLocation ? 'Getting...' : 'Get My Location'}
            </Text>
          </Pressable>
        </View>

        <View className={`p-3 border-t flex-row items-center space-x-2 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
          }`}>
          <View className="mr-2">
            <MapPin size={16} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
          </View>
          <View className="flex-1 flex-row space-x-2">
            <TextInput
              value={latInput}
              editable={true}
              onChangeText={handleLatChange}
              placeholder="Latitude"
              placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
              keyboardType="numeric"
              className={`flex-1 px-3 py-2 rounded text-sm ${isDarkMode
                ? 'bg-gray-900 text-white border-gray-700'
                : 'bg-white text-gray-900 border-gray-300'
                } border`}
            />
            <TextInput
              value={lngInput}
              editable={true}
              onChangeText={handleLngChange}
              placeholder="Longitude"
              placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
              keyboardType="numeric"
              className={`flex-1 px-3 py-2 rounded text-sm ${isDarkMode
                ? 'bg-gray-900 text-white border-gray-700'
                : 'bg-white text-gray-900 border-gray-300'
                } border`}
            />
          </View>
        </View>
      </View>

      {error && (
        <View className="flex-row items-center mt-1">
          <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
            <Text className="text-white text-[10px] font-bold">!</Text>
          </View>
          <Text className="text-orange-500 text-xs">{error}</Text>
        </View>
      )}

      <Text className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        Click on the map to set location or drag the marker
      </Text>
    </View>
  );
};

export default LocationPicker;
