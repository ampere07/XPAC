export interface Application {
  id: string;
  timestamp?: string;
  email_address?: string;
  first_name?: string;
  middle_initial?: string;
  last_name?: string;
  mobile_number?: string;
  secondary_mobile_number?: string;
  installation_address?: string;
  landmark?: string;
  region?: string;
  city?: string;
  barangay?: string;
  village?: string;
  desired_plan?: string;
  promo?: string;
  referrer_account_id?: number;
  referred_by?: string;
  proof_of_billing_url?: string;
  government_valid_id_url?: string;
  secondary_government_valid_id_url?: string;
  house_front_picture_url?: string;
  promo_url?: string;
  nearest_landmark1_url?: string;
  nearest_landmark2_url?: string;
  document_attachment_url?: string;
  other_isp_bill_url?: string;
  terms_agreed?: boolean;
  status?: string;
  created_at?: string;
  updated_at?: string;
  created_by_user_id?: number;
  updated_by_user_id?: number;

  customer_name?: string;
  address?: string;
  address_line?: string;

  create_date?: string;
  create_time?: string;

  plan_id?: string | number;
  promo_id?: string | number;
  cityId?: number | null;
  regionId?: number | null;
  boroughId?: number | null;
  villageId?: number | null;
  address_coordinates?: string;
  long_lat?: string;
}
