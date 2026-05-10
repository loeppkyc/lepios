export interface UserProfile {
  user_id: string
  email: string
  role: 'pending' | 'user' | 'admin'
  display_name: string | null
  module_prefs: string[]
  created_at: string
  approved_at: string | null
}

export interface ProfileResponse {
  profile: UserProfile
  auth_email: string
  auth_created_at: string
}
