import { useAgentStore } from '../store/agentStore';
import { useApplicationStore } from '../store/applicationStore';
import { useBillingStore } from '../store/billingStore';
import { useCommissionStore } from '../store/commissionStore';
import { useCustomerDashboardStore } from '../store/customerDashboardStore';
import { useDataLogsStore } from '../store/dataLogsStore';
import { useDisconnectionStore } from '../store/disconnectionStore';
import { useDiscountStore } from '../store/discountStore';
import { useInvoiceStore } from '../store/invoiceStore';
import { useJobOrderStore } from '../store/jobOrderStore';
import { useLcpStore } from '../store/lcpStore';
import { useNapStore } from '../store/napStore';
import { useOrganizationStore } from '../store/organizationStore';
import { useOverdueStore } from '../store/overdueStore';
import { usePaymentPortalStore } from '../store/paymentPortalStore';
import { useReconnectionStore } from '../store/reconnectionStore';
import { useRoleStore } from '../store/roleStore';
import { useServiceOrderStore } from '../store/serviceOrderStore';
import { useSOChargeStore } from '../store/soChargeStore';
import { useSOAStore } from '../store/soaStore';
import { useTechnicianStore } from '../store/technicianStore';
import { useTransactionRevertStore } from '../store/transactionRevertStore';
import { useTransactionStore } from '../store/transactionStore';
import { useUserStore } from '../store/userStore';
import { useWorkOrderStore } from '../store/workOrderStore';

export const resetAllStores = () => {
  useAgentStore.setState({
    agents: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
    isInitialFetch: true,
  });

  useApplicationStore.setState({
    applications: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    hasMore: true,
    currentPage: 1,
    lastSyncTime: null,
    currentFetchId: null,
    isFullyLoaded: false,
  });

  useBillingStore.setState({
    billingRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    lastFetchTimestamp: null,
    lastFetchAt: null,
  });

  useCommissionStore.setState({
    earnings: [],
    // Cleared too, otherwise the previous session's rows stay visible to the next user.
    payoutHistory: [],
    stats: null,
    totalEarnings: 0,
    totalPayouts: 0,
    isLoading: false,
    lastUpdated: null,
    currentFetchId: null,
  });

  useCustomerDashboardStore.setState({
    customerDetail: null,
    paySummary: null,
    soaRecords: [],
    invoiceRecords: [],
    paymentRecords: [],
    serviceChargeRecords: [],
    isLoading: false,
    // Every per-slice flag has to be cleared too. setState merges, so a reset during a
    // load would otherwise leave one stuck on and the next screen waiting on a request
    // that is never coming.
    isDetailLoading: false,
    isPaySummaryLoading: false,
    isPaymentsLoading: false,
    isInvoicesLoading: false,
    isSoaLoading: false,
    isServiceChargesLoading: false,
    isFromCache: false,
    error: null,
    fetchedAccountNo: null,
    // Cleared alongside fetchedAccountNo, or refreshCustomerData still has a target and
    // can refetch the account that just signed out.
    requestedAccountNo: null,
  });

  useDataLogsStore.setState({
    logRecords: [],
    isLoading: false,
    error: null,
  });

  useDisconnectionStore.setState({
    logRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
  });

  useDiscountStore.setState({
    discountRecords: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
  });

  useInvoiceStore.setState({
    invoiceRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    lastUpdated: null,
  });

  useJobOrderStore.setState({
    jobOrders: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    hasMore: true,
    currentPage: 1,
    lastUpdated: null,
    isFullyLoaded: false,
  });

  useLcpStore.setState({
    lcpItems: [],
    isLoading: false,
    error: null,
    hasMore: true,
    currentPage: 1,
    totalCount: 0,
    searchQuery: '',
  });

  useNapStore.setState({
    napItems: [],
    isLoading: false,
    error: null,
    hasMore: true,
    currentPage: 1,
    totalCount: 0,
    searchQuery: '',
  });

  useOrganizationStore.setState({
    organizations: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
    isInitialFetch: true,
  });

  useOverdueStore.setState({
    overdueRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
  });

  usePaymentPortalStore.setState({
    paymentPortalRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    lastUpdated: null,
  });

  useReconnectionStore.setState({
    logRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
  });

  useRoleStore.setState({
    roles: [],
    isLoading: false,
    error: null,
  });

  useServiceOrderStore.setState({
    serviceOrders: [],
    isLoading: false,
    error: null,
    hasMore: true,
    currentPage: 1,
    totalCount: 0,
    searchQuery: '',
    lastUpdated: null,
    currentFetchId: null,
    isFullyLoaded: false,
  });

  useSOAStore.setState({
    soaRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    lastUpdated: null,
  });

  useSOChargeStore.setState({
    chargeRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    lastUpdated: null,
  });

  useTechnicianStore.setState({
    technicians: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
    isInitialFetch: true,
  });

  useTransactionRevertStore.setState({
    revertRequests: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
  });

  useTransactionStore.setState({
    transactions: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    lastUpdated: null,
    currentFetchId: null,
  });

  useUserStore.setState({
    users: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
    isInitialFetch: true,
  });

  useWorkOrderStore.setState({
    workOrders: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    hasMore: true,
    currentPage: 1,
    lastUpdated: null,
  });
};
