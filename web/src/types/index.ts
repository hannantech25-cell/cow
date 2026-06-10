export interface User {
  id: number;
  name: string;
  email: string;
  role: 'Admin' | 'User';
  status: 'Active' | 'Inactive';
}

export interface Farm {
  id: number;
  name: string;
  address: string | null;
  center_lat: number | null;
  center_lng: number | null;
}

export interface Cow {
  id: number;
  farm_id: number | null;
  farm_name: string | null;
  tag_number: string;
  name: string | null;
  breed: string | null;
  dob: string | null;
  sex: 'Male' | 'Female';
  status: 'Pair' | 'Unpair';
  created_at: string;
}

export interface Tracker {
  id: number;
  board_id: string;
  mac_address: string;
  assigned_cow_id: number | null;
  cow_tag: string | null;
  cow_name: string | null;
  sleep_time_sec: number;
  battery_threshold: number;
  status: 'Active' | 'Inactive' | 'Maintenance';
  created_at: string;
}

export interface Geofence {
  id: number;
  name: string;
  type: 'Polygon' | 'Circle';
  boundary_data: object;
}

export interface Alert {
  id: number;
  cow_id: number;
  cow_tag: string;
  cow_name: string | null;
  geofence_id: number | null;
  geofence_name: string | null;
  alert_type: 'Exit' | 'Enter' | 'Low_Battery';
  is_read: boolean;
  timestamp: string;
}
