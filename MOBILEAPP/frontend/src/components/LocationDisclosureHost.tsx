import React, { useCallback, useEffect, useRef, useState } from 'react';
import LocationDisclosureModal from '../modals/LocationDisclosureModal';
import { registerDisclosureHost, DisclosureStage } from '../services/locationConsent';

/**
 * Renders the location prominent disclosure and makes it available app-wide.
 *
 * Mounted once at the root of the app, so the disclosure can be shown from any screen
 * and for any role before a location permission is requested. Screens never render the
 * modal themselves — they call ensureLocationPermission() and this host displays it.
 */
const LocationDisclosureHost: React.FC = () => {
    const [visible, setVisible] = useState(false);
    const [stage, setStage] = useState<DisclosureStage>('disclosure');
    const resolverRef = useRef<((accepted: boolean) => void) | null>(null);

    useEffect(() => {
        registerDisclosureHost((nextStage: DisclosureStage) => {
            setStage(nextStage);
            setVisible(true);

            return new Promise<boolean>((resolve) => {
                resolverRef.current = resolve;
            });
        });

        return () => registerDisclosureHost(null);
    }, []);

    const settle = useCallback((accepted: boolean) => {
        setVisible(false);
        const resolve = resolverRef.current;
        resolverRef.current = null;
        // Resolve after hiding so the OS prompt does not race our own modal off-screen.
        if (resolve) resolve(accepted);
    }, []);

    return (
        <LocationDisclosureModal
            visible={visible}
            stage={stage}
            onAccept={() => settle(true)}
            onDecline={() => settle(false)}
        />
    );
};

export default LocationDisclosureHost;
