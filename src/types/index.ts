export type UserRole = 'student' | 'staff' | 'academic_admin' | 'system_admin' | 'sysadmin';

export interface User {
  id: string;
  email: string;
  user_metadata: {
    role: UserRole;
    full_name?: string;
    student_id?: string;
    department?: string;
    approver_position?: string;
    level?: number;
  };
}

export interface Profile {
  id: string;
  email: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  nickname?: string;
  student_employee_id?: string;
  role: UserRole;
  avatar_url?: string;
  verified: boolean;
  conforme_accepted_year?: string;
  last_login?: string;
  created_at: string;
  updated_at: string;
}

export interface Enrollment {
  id: string;
  profile_id: string;
  academic_year_id: string;
  department_id: string;
  program_id: string;
  year_level_id: number;
  section_id?: string;
  status: 'active' | 'dropped' | 'loa' | 'graduated' | 'expelled';
  is_archived: boolean;
  enrolled_at: string;
}

export interface MigrationState {
  current_phase: 'BASELINE' | 'SYNCING' | 'SYNC_COMPLETE' | 'CANARY_5_PCT' | 'CANARY_25_PCT' | 'SST_ENFORCED';
  auth_version: number;
  updated_at: string;
}

export interface FileMetadata {
  id: string;
  user_id: string;
  name: string;
  size: number;
  type: string;
  path: string;
  is_archived: boolean;
  deleted_at: string | null;
  uploaded_at: string;
  created_at: string;
}

export interface Grade {
  id: string;
  user_id: string;
  subject: string;
  grade: number;
  units: number;
  is_archived: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Todo {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  due_date: string;
  priority: 'low' | 'standard' | 'high';
  status: number;
  progress: number;
  is_archived: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HandbookSection {
  id: string;
  title: string;
  content: string;
  category: string;
  order: number;
  updated_at: string;
  updated_by: string;
}

export interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string;
  helpful_count: number;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  resource: string;
  details: Record<string, any>;
  created_at: string;
}