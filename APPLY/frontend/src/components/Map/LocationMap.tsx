import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

interface LocationMapProps {
  center: { lat: number; lng: number };
  onLocationSelect: (lat: number, lng: number) => void;
  buttonColor: string;
  coverageArea?: { lat: number; lng: number; radius: number };
}

const LocationMap: React.FC<LocationMapProps> = ({ center, onLocationSelect, buttonColor, coverageArea }) => {
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const circleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      maxBounds: [[4, 116], [21, 127]],
      maxBoundsViscosity: 1.0
    }).setView([center.lat, center.lng], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    if (coverageArea) {
      const circle = L.circle([coverageArea.lat, coverageArea.lng], {
        color: buttonColor,
        fillColor: buttonColor,
        fillOpacity: 0.1,
        radius: coverageArea.radius,
      }).addTo(map);
      circleRef.current = circle;
      // Zoom out so the entire coverage circle is visible
      map.fitBounds(circle.getBounds(), { padding: [20, 20] });
    }

    const customIcon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="background-color: ${buttonColor}; width: 30px; height: 30px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });

    const marker = L.marker([center.lat, center.lng], {
      icon: customIcon,
      draggable: true,
    }).addTo(map);

    marker.on('dragend', () => {
      const position = marker.getLatLng();
      onLocationSelect(position.lat, position.lng);
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      marker.setLatLng([lat, lng]);
      onLocationSelect(lat, lng);
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (mapRef.current && markerRef.current) {
      mapRef.current.setView([center.lat, center.lng]);
      markerRef.current.setLatLng([center.lat, center.lng]);
    }
  }, [center]);

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%', borderRadius: '8px' }} />;
};

export default LocationMap;
