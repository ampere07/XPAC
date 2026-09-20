export interface WorkOrder {
  id: number;
  instructions: string;
  report_to: string;
  assign_to?: string;
  remarks?: string;
  work_status: string;
  work_category?: string;
  image_1?: string;
  image_2?: string;
  image_3?: string;
  signature?: string;
  requested_by: string;
  requested_date: string;
  updated_by?: string;
  updated_date?: string;
  organization_id?: number | null;

  // Flexible property for additional fields
  [key: string]: any;
}

export type WorkOrderData = WorkOrder;

export interface WorkOrderDetailsProps {
  workOrder: WorkOrder | null;
  onClose: () => void;
  onRefresh?: () => void;
  isMobile?: boolean;
}

export type WorkOrderStatus =
  | 'Pending'
  | 'In Progress'
  | 'Completed'
  | 'Failed'
  | 'Cancelled'
  | 'On Hold';
