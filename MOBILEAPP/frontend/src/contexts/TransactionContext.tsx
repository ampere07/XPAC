import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { transactionService } from '../services/transactionService';
import { Transaction } from '../types/transaction';

interface TransactionContextType {
    transactions: Transaction[];
    isLoading: boolean;
    error: string | null;
    refreshTransactions: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const TransactionContext = createContext<TransactionContextType | undefined>(undefined);

export const TransactionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Initialize state from session storage to prevent empty flash
    const [transactions, setTransactions] = useState<Transaction[]>(() => {
        try {
            const cached = sessionStorage.getItem('transactions');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        } catch (e) {
            console.error('Failed to load transactions from session storage:', e);
        }
        return [];
    });

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchTransactions = useCallback(async (force = false, silent = false) => {
        // Prevent re-fetching if we already have data and not forced
        if (!force && transactions.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            console.log('Fetching all transactions in one query...');
            // Fetch all data in one go (assuming backend handles "no limit" as "all")
            const result = await transactionService.getAllTransactions();

            if (result.success && result.data && Array.isArray(result.data)) {
                const allData = result.data;
                console.log(`Received ${allData.length} transactions.`);

                setTransactions(allData);

                try {
                    sessionStorage.setItem('transactions', JSON.stringify(allData));
                } catch (e) {
                    console.error('Failed to save to session storage', e);
                }

                setLastUpdated(new Date());
                setError(null);
            } else {
                if (!silent) {
                    setError(result.message || 'Failed to fetch transactions');
                }
            }
        } catch (err: any) {
            console.error('Failed to fetch transactions:', err);
            // Only set error if we have no data to show
            if (!silent && transactions.length === 0) {
                setError('Failed to load transactions. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
    }, [transactions.length]);

    const refreshTransactions = useCallback(async () => {
        await fetchTransactions(true, false);
    }, [fetchTransactions]);

    const silentRefresh = useCallback(async () => {
        await fetchTransactions(true, true);
    }, [fetchTransactions]);

    // Initial fetch effect
    useEffect(() => {
        if (transactions.length === 0) {
            fetchTransactions(false, false);
        }
    }, [fetchTransactions, transactions.length]);

    return (
        <TransactionContext.Provider value={{
            transactions,
            isLoading,
            error,
            refreshTransactions,
            silentRefresh,
            lastUpdated
        }}>
            {children}
        </TransactionContext.Provider>
    );
};

export const useTransactionContext = () => {
    const context = useContext(TransactionContext);
    if (context === undefined) {
        throw new Error('useTransactionContext must be used within a TransactionProvider');
    }
    return context;
};
