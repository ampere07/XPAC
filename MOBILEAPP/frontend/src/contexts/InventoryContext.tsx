import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import apiClient from '../config/api';

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
    /**
     * Whether to load the item list on mount. False for a user the API would
     * not serve it to (see SHELL_PREFETCH_KEYS); the categories, open to any
     * signed-in user, are still loaded. An explicit refresh from a screen
     * fetches both, as before.
     */
    prefetchItems?: boolean;
}

export const InventoryProvider: React.FC<InventoryProviderProps> = ({ children, prefetchItems = true }) => {
    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
    const [dbCategories, setDbCategories] = useState<InventoryCategory[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchInventoryData = useCallback(async (force = false, silent = false, includeItems = true) => {
        // Only skip if not forced AND everything wanted already exists
        if (!force && (!includeItems || inventoryItems.length > 0) && dbCategories.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            const [inventoryResponse, categoriesResponse] = await Promise.all([
                includeItems
                    ? apiClient.get<ApiResponse<InventoryItem[]> | InventoryItem[]>('/inventory')
                    : Promise.resolve(null),
                apiClient.get<ApiResponse<InventoryCategory[]> | InventoryCategory[]>('/inventory-categories')
            ]);

            const catResData = categoriesResponse.data;

            // Robust check for Inventory Items
            if (inventoryResponse) {
                const invResData = inventoryResponse.data;
                if (Array.isArray(invResData)) {
                    setInventoryItems(invResData);
                } else if (invResData?.success) {
                    setInventoryItems(invResData.data || []);
                } else {
                    setError(invResData?.message || 'Failed to fetch inventory data');
                }
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
    }, [inventoryItems.length, dbCategories.length]);

    const refreshInventory = useCallback(async () => {
        await fetchInventoryData(true, false);
    }, [fetchInventoryData]);

    const silentRefresh = useCallback(async () => {
        await fetchInventoryData(true, true);
    }, [fetchInventoryData]);

    useEffect(() => {
        // Initial fetch if empty (the item list only when prefetchItems)
        if ((prefetchItems && inventoryItems.length === 0) || dbCategories.length === 0) {
            fetchInventoryData(false, false, prefetchItems);
        }
    }, [fetchInventoryData, inventoryItems.length, dbCategories.length, prefetchItems]);

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
