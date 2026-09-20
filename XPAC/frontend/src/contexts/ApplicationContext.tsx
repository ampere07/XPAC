import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { getApplications } from '../services/applicationService';
import { Application as ApiApplication } from '../types/application';

interface Application {
    id: string;
    customerName: string;
    timestamp: string;
    address: string;

    city?: string;
    region?: string;
    barangay?: string;
    status?: string;
    email_address?: string;
    first_name?: string;
    middle_initial?: string;
    last_name?: string;
    mobile_number?: string;
    secondary_mobile_number?: string;
    installation_address?: string;
    landmark?: string;
    desired_plan?: string;
    promo?: string;
    referred_by?: string;
    create_date?: string;
    create_time?: string;
}

interface ApplicationContextType {
    applications: Application[];
    isLoading: boolean;
    error: string | null;
    refreshApplications: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const ApplicationContext = createContext<ApplicationContextType | undefined>(undefined);

export const useApplicationContext = () => {
    const context = useContext(ApplicationContext);
    if (!context) {
        throw new Error('useApplicationContext must be used within an ApplicationProvider');
    }
    return context;
};

interface ApplicationProviderProps {
    children: ReactNode;
}

const transformApplication = (app: ApiApplication): Application => {
    const regionName = app.region || '';
    const cityName = app.city || '';
    const barangayName = app.barangay || '';
    const addressLine = app.installation_address || app.address_line || app.address || '';
    const fullAddress = [regionName, cityName, barangayName, addressLine].filter(Boolean).join(', ');

    return {
        id: app.id || '',
        customerName: app.customer_name || `${app.first_name || ''} ${app.middle_initial || ''} ${app.last_name || ''}`.trim(),
        timestamp: app.timestamp || (app.create_date && app.create_time ? `${app.create_date} ${app.create_time}` : ''),
        address: addressLine,

        status: app.status || 'pending',
        city: cityName,
        region: regionName,
        barangay: barangayName,
        email_address: app.email_address,
        first_name: app.first_name,
        middle_initial: app.middle_initial,
        last_name: app.last_name,
        mobile_number: app.mobile_number,
        secondary_mobile_number: app.secondary_mobile_number,
        installation_address: app.installation_address,
        landmark: app.landmark,
        desired_plan: app.desired_plan,
        promo: app.promo,
        referred_by: app.referred_by,
        create_date: app.create_date,
        create_time: app.create_time
    };
};

export const ApplicationProvider: React.FC<ApplicationProviderProps> = ({ children }) => {
    const [applications, setApplications] = useState<Application[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchApplications = useCallback(async (force = false, silent = false) => {
        // If we have data and not forced, skip fetching
        if (!force && applications.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            // Phase 1: Fast mode for quick initial load - Fetch ALL (limit 10000)
            const fastResponse = await getApplications(true, 1, 10000, '');

            if (fastResponse.applications && fastResponse.applications.length > 0) {
                const transformedApplications = fastResponse.applications.map(transformApplication);
                setApplications(transformedApplications);
                setLastUpdated(new Date());
                setError(null);
                setIsLoading(false);

                // Phase 2: Load full data in background - Fetch ALL (limit 10000)
                setTimeout(async () => {
                    try {
                        const fullResponse = await getApplications(false, 1, 10000, '');

                        if (fullResponse.applications && fullResponse.applications.length > 0) {
                            const fullTransformedApplications = fullResponse.applications.map(transformApplication);
                            setApplications(fullTransformedApplications);
                            setLastUpdated(new Date());
                        }
                    } catch (bgError) {
                        console.warn('Background full data load failed:', bgError);
                    }
                }, 100);
            } else {
                setApplications([]);
                setError(null);
            }
        } catch (err: any) {
            console.error('Failed to fetch applications:', err);
            if (!silent) {
                setError('Failed to load applications. Please try again.');
                // Don't clear data on error if we have it
                if (applications.length === 0) {
                    setApplications([]);
                }
            }
        } finally {
            setIsLoading(false);
        }
    }, [applications.length]);

    const refreshApplications = useCallback(async () => {
        await fetchApplications(true, false);
    }, [fetchApplications]);

    const silentRefresh = useCallback(async () => {
        await fetchApplications(true, true);
    }, [fetchApplications]);

    // Initial fetch effect
    useEffect(() => {
        // Only fetch if empty, otherwise let the logic decide
        if (applications.length === 0) {
            fetchApplications(false, false);
        }
    }, [fetchApplications, applications.length]);

    return (
        <ApplicationContext.Provider
            value={{
                applications,
                isLoading,
                error,
                refreshApplications,
                silentRefresh,
                lastUpdated
            }}
        >
            {children}
        </ApplicationContext.Provider>
    );
};

export type { Application };
