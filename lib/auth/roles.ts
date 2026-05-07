export type UserRole = 'admin' | 'business' | 'personal' | 'accountant' | 'pending'

export interface UserProfile {
  user_id: string
  email: string
  role: UserRole
  created_at: string
  approved_at: string | null
  approved_by: string | null
  notes: string | null
}

const BUSINESS_ROLES: ReadonlySet<UserRole> = new Set(['admin', 'business', 'accountant'])
const PERSONAL_ROLES: ReadonlySet<UserRole> = new Set(['admin', 'personal', 'accountant'])

export function isApproved(role: UserRole | null | undefined): boolean {
  return !!role && role !== 'pending'
}

export function isAdmin(role: UserRole | null | undefined): boolean {
  return role === 'admin'
}

export function hasBusinessAccess(role: UserRole | null | undefined): boolean {
  return !!role && BUSINESS_ROLES.has(role)
}

export function hasPersonalAccess(role: UserRole | null | undefined): boolean {
  return !!role && PERSONAL_ROLES.has(role)
}
