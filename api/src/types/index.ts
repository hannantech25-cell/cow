import { Request } from 'express';

export interface AuthRequest extends Request {
  user?: { id: number; role: 'Admin' | 'User' };
}

export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  password_hash: string;
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
}

export interface Tracker {
  id: number;
  board_id: string;
  mac_address: string;
  assigned_cow_id: number | null;
  ping_interval_sec: number;
  battery_threshold: number;
  status: 'Active' | 'Inactive' | 'Maintenance';
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
  geofence_id: number | null;
  alert_type: 'Exit' | 'Enter' | 'Low_Battery';
  is_read: boolean;
  timestamp: string;
}
