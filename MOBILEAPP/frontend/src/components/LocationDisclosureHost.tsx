import React, { useCallback, useEffect, useRef, useState } from 'react';
import LocationDisclosureModal from '../modals/LocationDisclosureModal';
import { registerDisclosureHost, DisclosureStage } from '../services/locationConsent';

/**
 * Renders the location prominent disclosure and makes it available app-wide.
 *
 * Mounted once at the root of the app, so the disclosure can be shown from any screen and for any
 * role before a location permission is requested. Screens never render the modal themselves — they
 * call through services/locationGateway, which shows this host's modal before touching the OS.
 *
 * Mounted OUTSIDE the logged-in branch on purpose: the gateway must be able to disclose from the
 * login screen too, and a host that unmounts mid-flow would strand a pending promise.
 */
const LocationDisclosureHost: React.FC = () => {
    const [visible, setVisible] = useState(false);
    const [stage, setStage] = useState<DisclosureStage>('disclosure');
    const resolverRef = useRef<((accepted: boolean) => void) | null>(null);

    useEffect(() => {
        registerDisclosureHost((nextStage: DisclosureStage) => {
            // A second request while one is already on screen would orphan the first promise and
            // hang its caller forever. Refusing it is the safe answer: the caller treats it as a
            // decline and simply does not get location this time.
            if (resolverRef.current) return Promise.resolve(false);

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
        // Resolved after hiding so the OS prompt does not race our own modal off the screen.
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
