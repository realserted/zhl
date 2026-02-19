export interface ProjectAccount {
  id: string;
  project_id: string;
  account_name: string | null;
  descriptor: string | null;
  company_name: string | null;
  person_name: string | null;
  phone: string | null;
  email: string | null;
  link: string | null;
  username: string | null;
  password: string | null;
  account_number: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
