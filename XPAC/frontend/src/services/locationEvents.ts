// Location event emitter for cross-component communication
class LocationEventEmitter {
  private listeners: Map<string, Function[]> = new Map();

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event)!;
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event: string, data?: any) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach(callback => callback(data));
    }
  }
}

export const locationEvents = new LocationEventEmitter();

// Event types
export const LOCATION_EVENTS = {
  LOCATIONS_UPDATED: 'locations_updated',
  REGION_ADDED: 'region_added',
  CITY_ADDED: 'city_added',
  BARANGAY_ADDED: 'barangay_added'
} as const;

// Utility function to refresh location data in other components
export const refreshLocationData = () => {
  locationEvents.emit(LOCATION_EVENTS.LOCATIONS_UPDATED);
};

export const notifyLocationAdded = (type: 'region' | 'city' | 'barangay', location: any) => {
  const eventMap = {
    region: LOCATION_EVENTS.REGION_ADDED,
    city: LOCATION_EVENTS.CITY_ADDED,
    barangay: LOCATION_EVENTS.BARANGAY_ADDED
  };
  
  locationEvents.emit(eventMap[type], location);
  locationEvents.emit(LOCATION_EVENTS.LOCATIONS_UPDATED);
};
