import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import apiClient from '../config/api';
import { usePermissions } from '../hooks/usePermissions';

export interface InventoryItem {
    item_name: string;
    item_description?: string;
    supplier?: string;
    quantity_alert?: number;
    image?: string;
    category?: string;
    item_id?: number;
    modified_by?: string;
    modified_date?: string;
    user_email?: string;
    total_quantity?: number;
}

export interface InventoryCategory {
    id: number;
    name: string;
    created_at?: string;
    updated_at?: string;
    modified_by?: string;
    modified_date?: string;
    count?: number;
}

interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
}

interface InventoryContextType {
    inventoryItems: InventoryItem[];
    dbCategories: InventoryCategory[];
    isLoading: boolean;
    error: string | null;
    refreshInventory: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

export const useInventoryContext = () => {
    const context = useContext(InventoryContext);
    if (!context) {
        throw new Error('useInventoryContext must be used within an InventoryProvider');
    }
    return context;
};

interface InventoryProviderProps {
    children: ReactNode;
}

export const InventoryProvider: React.FC<InventoryProviderProps> = ({ children }) => {
    // Mirrors the server rules: /inventory is readable by the inventory page and by
    // the order pages that consume items, /inventory-categories only by the inventory
    // pages. A technician holds the former and not the latter, and a customer holds
    // neither — both used to 403 on mount.
    const { can, ready: permissionsReady } = usePermissions();
    const canReadItems = can(['inventory', 'inventory-category-list', 'job-order', 'service-order', 'work-order']);
    const canReadCategories = can(['inventory', 'inventory-category-list']);
    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
    const [dbCategories, setDbCategories] = useState<InventoryCategory[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchInventoryData = useCallback(async (force = false, silent = false) => {
        // Only skip if not forced AND both items and categories already exist. A role that
        // may not read categories never fills them, so it must not be waited on.
        if (!force && inventoryItems.length > 0 && (!canReadCategories || dbCategories.length > 0)) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            // The categories request is skipped rather than allowed to fail for a role that
            // may not read them: awaiting both together used to reject and drop the items too.
            const [inventoryResponse, categoriesResponse] = await Promise.all([
                apiClient.get<ApiResponse<InventoryItem[]> | InventoryItem[]>('/inventory'),
                canReadCategories
                    ? apiClient.get<ApiResponse<InventoryCategory[]> | InventoryCategory[]>('/inventory-categories')
                    : Promise.resolve({ data: [] as InventoryCategory[] })
            ]);

            const invResData = inventoryResponse.data;
            const catResData = categoriesResponse.data;

            // Robust check for Inventory Items
            if (Array.isArray(invResData)) {
                setInventoryItems(invResData);
            } else if (invResData?.success) {
                setInventoryItems(invResData.data || []);
            } else {
                setError(invResData?.message || 'Failed to fetch inventory data');
            }

            // Robust check for Categories
            if (Array.isArray(catResData)) {
                setDbCategories(catResData);
            } else if (catResData?.success) {
                setDbCategories(catResData.data || []);
            }

            setLastUpdated(new Date());
            setError(null);
        } catch (err: any) {
            console.error('Failed to fetch inventory:', err);
            if (!silent) {
                setError('Failed to connect to server');
            }
        } finally {
            setIsLoading(false);
        }
    }, [inventoryItems.length, dbCategories.length, canReadCategories]);

    const refreshInventory = useCallback(async () => {
        await fetchInventoryData(true, false);
    }, [fetchInventoryData]);

    const silentRefresh = useCallback(async () => {
        await fetchInventoryData(true, true);
    }, [fetchInventoryData]);

    useEffect(() => {
        // Wait for the keys to load, then only fetch for a user who may read inventory.
        if (!permissionsReady || !canReadItems) return;

        // Initial fetch if empty
        if (inventoryItems.length === 0 || (canReadCategories && dbCategories.length === 0)) {
            fetchInventoryData(false, false);
        }
    }, [fetchInventoryData, inventoryItems.length, dbCategories.length, permissionsReady, canReadItems, canReadCategories]);

    return (
        <InventoryContext.Provider
            value={{
                inventoryItems,
                dbCategories,
                isLoading,
                error,
                refreshInventory,
                silentRefresh,
                lastUpdated
            }}
        >
            {children}
        </InventoryContext.Provider>
    );
};
