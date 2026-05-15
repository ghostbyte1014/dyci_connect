import React, { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { checkProfileCompleteness, createIncompleteProfileNotification } from '../../utils/profileUtils'
import { DashboardSkeleton } from '../ui/Skeleton'

interface ProfileGuardProps {
  children: ReactNode
  allowedRoles: string[]
}

interface ProfileRow {
  id: string
  role: string | null
  verified: boolean | null
  student?: any
}

const ProfileGuard: React.FC<ProfileGuardProps> = ({ children, allowedRoles }) => {
  const { user, authoritativeRole } = useAuth()
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [currentAcademicYearId, setCurrentAcademicYearId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) {
      setLoading(false)
      setProfile(null)
      return
    }
    let cancelled = false

    const load = async () => {
      const [profileRes, settingsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select(`
            id, role, verified, first_name, last_name,
            student:student_profiles(enrolled_academic_year_id),
            staff:staff_profiles(enrolled_academic_year_id)
          `)
          .eq('id', user.id)
          .maybeSingle(),
        supabase.rpc('get_current_academic_year_id'),
      ])

      if (cancelled) return

      if (profileRes.error) {
        setProfile(null)
      } else {
        setProfile(profileRes.data as ProfileRow | null)
        const completeness = checkProfileCompleteness(profileRes.data)
        if (!profileRes.data || !completeness.isComplete) {
          await createIncompleteProfileNotification(user.id)
        }
      }

      setCurrentAcademicYearId(settingsRes.data ?? null)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  if (loading) {
    return <DashboardSkeleton />;
  }

  const role = authoritativeRole ?? ''

  if (!profile || !role) {
    return <Navigate to="/complete-profile" replace />
  }

  // Simplified strict role checking
  let isRoleAllowed = allowedRoles.includes(role);
  if (role === 'system_admin' || role === 'sysadmin') {
    if (allowedRoles.includes('system_admin') || allowedRoles.includes('sysadmin')) {
      isRoleAllowed = true;
    }
  }

  const isStudent = role === 'student';
  const isStaff = ['staff', 'faculty', 'academic_admin'].includes(role);

  const enrolledYear = isStudent
    ? (profile.student?.[0]?.enrolled_academic_year_id || profile.student?.enrolled_academic_year_id)
    : (profile as any).staff?.[0]?.enrolled_academic_year_id || (profile as any).staff?.enrolled_academic_year_id;

  if (
    (isStudent || isStaff) &&
    currentAcademicYearId &&
    enrolledYear !== currentAcademicYearId
  ) {
    return <Navigate to="/conforme" replace />
  }

  if (!isRoleAllowed) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

export default ProfileGuard

