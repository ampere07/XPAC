import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { getAllApplicationVisits } from '../services/applicationVisitService';

interface ApplicationVisit {
    id: string;
    application_id: string;
    timestamp: string;
    assigned_email?: string;
    visit_by?: string;
    visit_with?: string;
    visit_with_other?: string;
    visit_status: string;
    visit_remarks?: string;
    status_remarks?: string;
    application_status?: string;
    full_name: string;
    full_address: string;
    referred_by?: string;
    updated_by_user_email: string;
    created_at: string;
    updated_at: string;
    first_name?: string;
    middle_initial?: string;
    last_name?: string;
    region?: string;
    city?: string;
    barangay?: string;
    location?: string;
    choose_plan?: string;
    promo?: string;
    house_front_picture_url?: string;
    image1_url?: string;
    image2_url?: string;
    image3_url?: string;
}

interface ApplicationVisitContextType {
    applicationVisits: ApplicationVisit[];
    isLoading: boolean;
    error: string | null;
    refreshApplicationVisits: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const ApplicationVisitContext = createContext<ApplicationVisitContextType | undefined>(undefined);

export const useApplicationVisitContext = () => {
    const context = useContext(ApplicationVisitContext);
    if (!context) {
        throw new Error('useApplicationVisitContext must be used within an ApplicationVisitProvider');
    }
    return context;
};

interface ApplicationVisitProviderProps {
    children: ReactNode;
}

const transformVisit = (visit: any): ApplicationVisit => {
    return {
        id: visit.id || '',
        application_id: visit.application_id || '',
        timestamp: visit.timestamp || visit.created_at || '',
        assigned_email: visit.assigned_email || '',
        visit_by: visit.visit_by || '',
        visit_with: visit.visit_with || '',
        visit_with_other: visit.visit_with_other || '',
        visit_status: visit.visit_status || '',
        visit_remarks: visit.visit_remarks || '',
        status_remarks: visit.status_remarks || '',
        application_status: visit.application_status || '',
        full_name: visit.full_name || '',
        full_address: visit.full_address || '',
        referred_by: visit.referred_by || '',
        updated_by_user_email: visit.updated_by_user_email || '',
        created_at: visit.created_at || '',
        updated_at: visit.updated_at || '',
        first_name: visit.first_name || '',
        middle_initial: visit.middle_initial || '',
        last_name: visit.last_name || '',
        region: visit.region || '',
        city: visit.city || '',
        barangay: visit.barangay || '',
        location: visit.location || '',
        choose_plan: visit.choose_plan || '',
        promo: visit.promo || '',
        house_front_picture_url: visit.house_front_picture_url || '',
        image1_url: visit.image1_url || '',
        image2_url: visit.image2_url || '',
        image3_url: visit.image3_url || ''
    };
};

export const ApplicationVisitProvider: React.FC<ApplicationVisitProviderProps> = ({ children }) => {
    const [applicationVisits, setApplicationVisits] = useState<ApplicationVisit[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchApplicationVisits = useCallback(async (force = false, silent = false) => {
        // If we have data and not forced, skip fetching
        if (!force && applicationVisits.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            // Get user role and email for filtering
            const authData = localStorage.getItem('authData');
            let assignedEmail: string | undefined;

            if (authData) {
                try {
                    const userData = JSON.parse(authData);
                    if (userData.role && userData.role.toLowerCase() === 'technician' && userData.email) {
                        assignedEmail = userData.email;
                    }
                } catch (err) {
                    console.error('Error parsing auth data:', err);
                }
            }

            const response = await getAllApplicationVisits(assignedEmail);

            if (!response.success) {
                throw new Error(response.message || 'Failed to fetch application visits');
            }

            if (response.success && Array.isArray(response.data)) {
                const visits = response.data.map(transformVisit);
                setApplicationVisits(visits);
                setLastUpdated(new Date());
                setError(null);
            } else {
                setApplicationVisits([]);
                setError(null);
            }
        } catch (err: any) {
            console.error('Failed to fetch application visits:', err);
            if (!silent) {
                setError(err.message || 'Failed to load application visits. Please try again.');
                // Don't clear data on error if we have it
                if (applicationVisits.length === 0) {
                    setApplicationVisits([]);
                }
            }
        } finally {
            setIsLoading(false);
        }
    }, [applicationVisits.length]);

    const refreshApplicationVisits = useCallback(async () => {
        await fetchApplicationVisits(true, false);
    }, [fetchApplicationVisits]);

    const silentRefresh = useCallback(async () => {
        await fetchApplicationVisits(true, true);
    }, [fetchApplicationVisits]);

    // Initial fetch effect
    useEffect(() => {
        // Only fetch if empty, otherwise let the logic decide
        if (applicationVisits.length === 0) {
            fetchApplicationVisits(false, false);
        }
    }, [fetchApplicationVisits, applicationVisits.length]);

    return (
        <ApplicationVisitContext.Provider
            value={{
                applicationVisits,
                isLoading,
                error,
                refreshApplicationVisits,
                silentRefresh,
                lastUpdated
            }}
        >
            {children}
        </ApplicationVisitContext.Provider>
    );
};

export type { ApplicationVisit };
