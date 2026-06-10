import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { getAuthProvider } from '../../utils/profileUtils'
import { FaEye, FaEyeSlash, FaFingerprint, FaUserCircle, FaEdit, FaCamera, FaSave, FaTimes, FaMapMarkerAlt, FaSchool, FaIdCard, FaBriefcase, FaLaptopCode, FaTrash } from 'react-icons/fa'
import { DashboardSkeleton } from '../../components/ui/Skeleton'
import PasswordStrengthIndicator from '../../components/auth/PasswordStrengthIndicator'

const StudentProfile: React.FC = () => {
  const { user, authoritativeRole, updatePassword } = useAuth()
  const [profile, setProfile] = useState<any | null>(null)
  const [devices, setDevices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    nickname: '',
    streetAddress: '',
    region: '',
    barangay: '',
    city: '',
    province: '',
    studentId: '',
    program: '',
    department: '',
    yearLevel: '',
    section: '',
  })
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [regions, setRegions] = useState<any[]>([])
  const [provinces, setProvinces] = useState<any[]>([])
  const [cities, setCities] = useState<any[]>([])
  const [barangays, setBarangays] = useState<any[]>([])
  const [departments, setDepartments] = useState<any[]>([])
  const [programs, setPrograms] = useState<any[]>([])
  const [yearLevels, setYearLevels] = useState<any[]>([])
  const [sections, setSections] = useState<any[]>([])
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordValid, setPasswordValid] = useState(false)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })

  const authProvider = getAuthProvider(user)
  const isGoogleUser = authProvider === 'google'

  useEffect(() => {
    const loadProfile = async () => {
      if (!isSupabaseConfigured || !user?.id) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      const { data, error } = await supabase
        .from('profiles')
        .select(`
          *,
          student:student_profiles (
            department_id, program_id, year_level_id, section_id,
            enrolled_academic_year_id,
            street_address,
            barangay:barangay_id (
              code, name,
              city:city_id (
                code, name,
                province:province_id (
                  code, name,
                  region:region_id (code, name)
                )
              )
            ),
            department:department_id (name),
            program:program_id (name),
            year_level:year_level_id (label),
            section:section_id (label)
          )
        `)
        .eq('id', user.id)
        .maybeSingle()

      if (error) {
        console.error('Error loading student profile', error)
        setError('Failed to load your profile. Please try again later.')
      } else {
        setProfile(data)
        // Sync auth_provider for Google users (fix rows that were saved as 'email')
        const provider = getAuthProvider(user)
        if (provider === 'google' && data?.auth_provider !== 'google') {
          await supabase
            .from('profiles')
            .update({ auth_provider: 'google' })
            .eq('id', user.id)
        }
      }

      setLoading(false)
    }

    const fetchDevices = async () => {
      try {
        const { data, error } = await supabase
          .from('trusted_devices')
          .select('*')
          .eq('user_id', user?.id)
          .order('is_active', { ascending: false })
          .order('last_used_at', { ascending: false });
        if (error) throw error;
        setDevices(data || []);
      } catch (err) {
        console.error('Failed to fetch trusted devices', err);
      }
    };

    loadProfile()
    if (user?.id) fetchDevices()
  }, [user?.id])

  const handleRevokeDevice = async (deviceId: string) => {
    try {
      const { error } = await supabase
        .from('trusted_devices')
        .update({ is_active: false })
        .eq('id', deviceId);
      
      if (error) throw error;
      toast.success('Device revoked successfully');
      
      const { data } = await supabase
        .from('trusted_devices')
        .select('*')
        .eq('user_id', user?.id)
        .order('is_active', { ascending: false })
        .order('last_used_at', { ascending: false });
      setDevices(data || []);
    } catch (err) {
      toast.error('Failed to revoke device');
    }
  };

  const handleRestoreDevice = async (deviceId: string) => {
    try {
      const { error } = await supabase
        .from('trusted_devices')
        .update({ is_active: true })
        .eq('id', deviceId);
      
      if (error) throw error;
      toast.success('Device restored successfully');
      
      const { data } = await supabase
        .from('trusted_devices')
        .select('*')
        .eq('user_id', user?.id)
        .order('is_active', { ascending: false })
        .order('last_used_at', { ascending: false });
      setDevices(data || []);
    } catch (err) {
      toast.error('Failed to restore device');
    }
  };

  // Load PSGC regions once
  useEffect(() => {
    const loadRegions = async () => {
      try {
        const res = await fetch('https://psgc.cloud/api/regions')
        if (!res.ok) {
          throw new Error(`Failed to load regions: ${res.status}`)
        }
        const data = await res.json()
        setRegions(data)
      } catch (err) {
        console.error('Error loading PSGC regions for profile edit', err)
      }
    }

    loadRegions()
  }, [])

  // Load academic lookups (departments, programs, year levels, sections) similar to signup
  useEffect(() => {
    const loadAcademicLookups = async () => {
      if (!isSupabaseConfigured) return
      try {
        const [deptRes, progRes, yearRes, sectionsRes] = await Promise.all([
          supabase.from('departments').select('id, name').order('name'),
          supabase
            .from('programs')
            .select('id, name, department_id')
            .order('name'),
          supabase
            .from('year_levels')
            .select('id, label, sort_order')
            .order('sort_order'),
          supabase
            .from('sections')
            .select('id, label, sort_order')
            .order('sort_order'),
        ])

        if (!deptRes.error && deptRes.data) {
          setDepartments(deptRes.data)
        } else if (deptRes.error) {
          console.error('Error loading departments for profile edit', deptRes.error)
        }

        if (!progRes.error && progRes.data) {
          setPrograms(progRes.data)
        } else if (progRes.error) {
          console.error('Error loading programs for profile edit', progRes.error)
        }

        if (!yearRes.error && yearRes.data) {
          setYearLevels(yearRes.data)
        } else if (yearRes.error) {
          console.error('Error loading year levels for profile edit', yearRes.error)
        }

        if (!sectionsRes.error && sectionsRes.data) {
          setSections(sectionsRes.data)
        } else if (sectionsRes.error) {
          console.error('Error loading sections for profile edit', sectionsRes.error)
        }
      } catch (err) {
        console.error('Error loading academic lookups for profile edit', err)
      }
    }

    loadAcademicLookups()
  }, [])

  // When opening the edit modal, prefetch PSGC data for existing selection
  useEffect(() => {
    if (!editOpen || !profile) return

    const prefill = async () => {
      try {
        if (profile.region) {
          const provRes = await fetch(
            `https://psgc.cloud/api/regions/${profile.region}/provinces`
          )
          if (provRes.ok) {
            const provData = await provRes.json()
            setProvinces(provData)
          }
        }

        if (profile.province) {
          const cityRes = await fetch(
            `https://psgc.cloud/api/provinces/${profile.province}/cities-municipalities`
          )
          if (cityRes.ok) {
            const cityData = await cityRes.json()
            setCities(cityData)
          }
        }

        if (profile.city) {
          const brgyRes = await fetch(
            `https://psgc.cloud/api/cities-municipalities/${profile.city}/barangays`
          )
          if (brgyRes.ok) {
            const brgyData = await brgyRes.json()
            setBarangays(brgyData)
          }
        }
      } catch (err) {
        console.error('Error preloading PSGC data for profile edit', err)
      }
    }

    prefill()
  }, [editOpen, profile])

  const fullName =
    profile?.first_name || profile?.last_name
      ? [profile?.first_name, profile?.middle_name, profile?.last_name].filter(Boolean).join(' ')
      : (user?.user_metadata?.full_name as string | undefined) || 'User'

  // Use authoritativeRole as source of truth, fallback to metadata or 'student'
  const roleLabel = authoritativeRole || (user?.user_metadata?.role as string | undefined) || 'student'
  const isStudent = roleLabel === 'student'
  const isStaff = roleLabel === 'staff'
  const isAdmin = roleLabel === 'academic_admin' || roleLabel === 'system_admin'

  const roleDisplay =
    isStaff ? 'Staff' : isAdmin ? 'Admin' : 'Student'

  const verified = profile?.verified === true

  const openEditProfile = () => {
    if (!user?.id) {
      return
    }

    setEditForm({
      firstName: profile?.first_name || '',
      middleName: profile?.middle_name || '',
      lastName: profile?.last_name || '',
      nickname: profile?.nickname || '',
      streetAddress: profile?.student?.street_address || profile?.student?.[0]?.street_address || '',
      region: profile?.student?.barangay?.city?.province?.region?.code || profile?.student?.[0]?.barangay?.city?.province?.region?.code || '',
      province: profile?.student?.barangay?.city?.province?.code || profile?.student?.[0]?.barangay?.city?.province?.code || '',
      city: profile?.student?.barangay?.city?.code || profile?.student?.[0]?.barangay?.city?.code || '',
      barangay: profile?.student?.barangay?.code || profile?.student?.[0]?.barangay?.code || '',
      studentId: profile?.student_employee_id || '',
      program: profile?.student?.[0]?.program_id || profile?.student?.program_id || '',
      department: profile?.student?.[0]?.department_id || profile?.student?.department_id || '',
      yearLevel: profile?.student?.[0]?.year_level_id || profile?.student?.year_level_id || '',
      section: profile?.student?.[0]?.section_id || profile?.student?.section_id || '',
    })
    setEditOpen(true)
  }

  const handleEditChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setEditForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleRegionSelectChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value

    setEditForm((prev) => ({
      ...prev,
      region: value,
      province: '',
      city: '',
      barangay: '',
    }))
    setProvinces([])
    setCities([])
    setBarangays([])

    if (!value) {
      return
    }

    try {
      const res = await fetch(`https://psgc.cloud/api/regions/${value}/provinces`)
      if (!res.ok) {
        throw new Error(`Failed to load provinces: ${res.status}`)
      }
      const data = await res.json()
      setProvinces(data)
    } catch (err) {
      console.error('Error loading PSGC provinces for profile edit', err)
    }
  }

  const handleProvinceSelectChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value

    setEditForm((prev) => ({
      ...prev,
      province: value,
      city: '',
      barangay: '',
    }))
    setCities([])
    setBarangays([])

    if (!value) {
      return
    }

    try {
      const res = await fetch(
        `https://psgc.cloud/api/provinces/${value}/cities-municipalities`
      )
      if (!res.ok) {
        throw new Error(`Failed to load cities: ${res.status}`)
      }
      const data = await res.json()
      setCities(data)
    } catch (err) {
      console.error('Error loading PSGC cities/municipalities for profile edit', err)
    }
  }

  const handleCitySelectChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value

    setEditForm((prev) => ({
      ...prev,
      city: value,
      barangay: '',
    }))
    setBarangays([])

    if (!value) {
      return
    }

    try {
      const res = await fetch(
        `https://psgc.cloud/api/cities-municipalities/${value}/barangays`
      )
      if (!res.ok) {
        throw new Error(`Failed to load barangays: ${res.status}`)
      }
      const data = await res.json()
      setBarangays(data)
    } catch (err) {
      console.error('Error loading PSGC barangays for profile edit', err)
    }
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!isSupabaseConfigured || !user?.id) {
      toast.error('Editing your profile is only available when connected to the server.')
      return
    }

    setEditSaving(true)

    const updateData: any = {
      first_name: editForm.firstName.trim(),
      middle_name: editForm.middleName.trim() || null,
      last_name: editForm.lastName.trim(),
      nickname: editForm.nickname.trim(),
      student_employee_id: editForm.studentId.trim(),
    }

    console.log('[Debug] Updating "profiles" table with:', updateData);

    try {
      const regionName = regions.find((r) => r.code === editForm.region)?.name || ''
      const provinceName = provinces.find((p) => p.code === editForm.province)?.name || ''
      const cityName = cities.find((c) => c.code === editForm.city)?.name || ''
      const barangayName = barangays.find((b) => b.code === editForm.barangay)?.name || ''

      // 1. Sync geographic hierarchy if address changed
      let barangayId = null;
      if (editForm.barangay) {
        const { data: bid, error: syncError } = await supabase.rpc('sync_geographic_hierarchy', {
          r_code: editForm.region,
          r_name: regionName,
          p_code: editForm.province,
          p_name: provinceName,
          c_code: editForm.city,
          c_name: cityName,
          b_code: editForm.barangay,
          b_name: barangayName,
        })
        if (!syncError && bid) {
          barangayId = bid
        }
      }

      // 2. Update core profile
      const { error: updateError } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)

      if (updateError) throw updateError

      // 3. Update student profile if student
      if (isStudent) {
        const { error: studentError } = await supabase
          .from('student_profiles')
          .upsert({
            profile_id: user.id,
            department_id: editForm.department || null,
            program_id: editForm.program || null,
            year_level_id: editForm.yearLevel || null,
            section_id: editForm.section || null,
            street_address: editForm.streetAddress.trim(),
            barangay_id: barangayId,
            enrolled_academic_year_id: (profile?.student?.[0]?.enrolled_academic_year_id || profile?.student?.enrolled_academic_year_id) || null
          })
        if (studentError) throw studentError
      }

      toast.success('Your profile has been updated.')
      setEditOpen(false)
      // Re-load the profile to get the fresh joined data
      window.location.reload()
    } catch (err) {
      console.error('Unexpected error updating profile', err)
      toast.error('Something went wrong while saving. Please try again.')
    } finally {
      setEditSaving(false)
    }
  }

  const openAvatarModal = () => {
    if (!user?.id) return
    setAvatarFile(null)
    setAvatarPreview(profile?.avatar_url || null)
    setAvatarOpen(true)
  }

  const openPasswordModal = () => {
    if (isGoogleUser) {
      toast.error(
        'Your account uses Google sign-in. Change your password from your Google Account settings.'
      )
      return
    }
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setPasswordOpen(true)
  }

  const handlePasswordFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setPasswordForm((prev) => ({ ...prev, [name]: value }))
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { currentPassword, newPassword, confirmPassword } = passwordForm
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Please fill in all fields.')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match.')
      return
    }
    if (!passwordValid) {
      toast.error('Password does not meet institutional security standards.')
      return
    }
    setPasswordSaving(true)
    try {
      const { error } = await updatePassword(currentPassword, newPassword)
      if (error) {
        toast.error('Failed to update password. Please verify your current credentials.')
        return
      }
      toast.success('Password updated. Use your new password next time you sign in.')
      setPasswordOpen(false)
    } finally {
      setPasswordSaving(false)
    }
  }

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)

    const reader = new FileReader()
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleAvatarSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!avatarFile) {
      toast.error('Please choose a picture first.')
      return
    }

    if (!isSupabaseConfigured || !user?.id) {
      toast.error('Updating your profile picture is only available when connected to the server.')
      return
    }

    setAvatarSaving(true)

    try {
      const userId = user.id as string
      const ext = avatarFile.name.split('.').pop() || 'jpg'
      const filePath = `avatars/${userId}/${Date.now()}.${ext}`

      const { error: uploadError } = await (supabase as any).storage
        .from('user-docs')
        .upload(filePath, avatarFile, {
          upsert: true,
          contentType: avatarFile.type || undefined,
        })

      if (uploadError) {
        console.error('Error uploading profile image', uploadError)
        toast.error('Failed to upload your profile picture. Please try again.')
        setAvatarSaving(false)
        return
      }

      const { data: publicData } = (supabase as any).storage
        .from('user-docs')
        .getPublicUrl(filePath)
      const avatarUrl = publicData.publicUrl as string

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', userId)

      if (updateError) {
        console.error('Error saving avatar URL to profile', updateError)
        toast.error('Your picture was uploaded, but saving it to your profile failed.')
        setAvatarSaving(false)
        return
      }

      setProfile((prev: any) => (prev ? { ...prev, avatar_url: avatarUrl } : prev))
      toast.success('Your profile picture has been updated.')
      setAvatarOpen(false)
    } catch (err) {
      console.error('Unexpected error updating avatar', err)
      toast.error('Something went wrong while updating your picture. Please try again.')
    } finally {
      setAvatarSaving(false)
    }
  }

  if (loading) return <DashboardSkeleton />

  return (
    <>
      <header className="unified-header">
        <div className="unified-header-content">
          <h1 className="unified-header-title">My Profile</h1>
          <p className="unified-header-subtitle">
            Manage your account settings and institutional profile.
          </p>
        </div>
      </header>

      <main className="unified-main">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div />
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-semibold ${roleDisplay === 'Student'
                ? 'bg-blue-50 text-blue-700'
                : roleDisplay === 'Staff'
                  ? 'bg-purple-50 text-purple-700'
                  : 'bg-rose-50 text-rose-700'
                }`}
            >
              {roleDisplay}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-semibold ${verified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}
            >
              {verified ? 'Verified' : 'Pending verification'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          {/* Identity card */}
          <section className="h-full">
            <div className="legacy-card p-10 flex flex-col justify-between h-full">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-800 overflow-hidden">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={fullName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    fullName
                      .split(' ')
                      .map((p: string) => p[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{fullName}</p>
                  <p className="text-[11px] text-slate-500">
                    {user?.email || profile?.email || 'student@dyci.edu.ph'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-600 mt-2">
                <div>
                  <p className="font-medium text-slate-500">{isStudent ? 'ID number' : 'Employee ID'}</p>
                  <p className="mt-0.5 text-slate-800">
                    {profile?.student_employee_id || '—'}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-slate-500">Nickname</p>
                  <p className="mt-0.5 text-slate-800">{profile?.nickname || '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="font-medium text-slate-500">Joined</p>
                  <p className="mt-0.5 text-slate-800">
                    {profile?.created_at
                      ? new Date(profile.created_at).toLocaleDateString()
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Account actions */}
          <section className="h-full">
            <div className="legacy-card p-8 h-full">
              <h3 className="text-sm font-bold text-slate-800 mb-6 font-sans">Account actions</h3>
              <div className="space-y-3">
                <button
                  type="button"
                  className="legacy-button-pill"
                  onClick={openEditProfile}
                  disabled={!profile}
                >
                  Edit profile
                </button>
                <button
                  type="button"
                  className="legacy-button-pill"
                  onClick={openAvatarModal}
                  disabled={!profile}
                >
                  Change profile picture
                </button>
                <button
                  type="button"
                  className="legacy-button-pill"
                  onClick={openPasswordModal}
                  disabled={!isSupabaseConfigured || isGoogleUser}
                >
                  Change password
                </button>
              </div>
              {isGoogleUser && (
                <p className="mt-1 text-[10px] text-slate-500">
                  You sign in with Google. To change your password, go to your Google Account settings.
                </p>
              )}
            </div>
          </section>
        </div>

        {isStudent && (
          <section className="rounded-2xl border border-slate-100 bg-white px-6 py-5 space-y-4 shadow-sm">
            <h2 className="text-xs font-semibold text-slate-800">Academic & Contact Information</h2>
            <div className="grid gap-4 md:grid-cols-2 text-[11px] text-slate-600">
              <div>
                <p className="font-medium text-slate-500">Program</p>
                <p className="mt-0.5 text-slate-800">
                  {profile?.student?.[0]?.program?.name || profile?.student?.program?.name || '—'}
                </p>
              </div>
              <div>
                <p className="font-medium text-slate-500">Department</p>
                <p className="mt-0.5 text-slate-800">
                  {profile?.student?.[0]?.department?.name || profile?.student?.department?.name || '—'}
                </p>
              </div>
              <div>
                <p className="font-medium text-slate-500">Year level</p>
                <p className="mt-0.5 text-slate-800">
                  {profile?.student?.[0]?.year_level?.label || profile?.student?.year_level?.label || '—'}
                </p>
              </div>
              <div>
                <p className="font-medium text-slate-500">Section</p>
                <p className="mt-0.5 text-slate-800">
                  {profile?.student?.[0]?.section?.label || profile?.student?.section?.label || '—'}
                </p>
              </div>
              <div className="md:col-span-2">
                <p className="font-medium text-slate-500">Full Address</p>
                <p className="mt-1 text-slate-800 leading-tight">
                  {profile?.student?.[0]?.street_address || profile?.student?.street_address || '—'}
                  {(profile?.student?.[0]?.barangay || profile?.student?.barangay) && (
                    <>
                      , {[
                        (profile.student?.[0]?.barangay || profile.student?.barangay).name,
                        (profile.student?.[0]?.barangay || profile.student?.barangay).city?.name,
                        (profile.student?.[0]?.barangay || profile.student?.barangay).city?.province?.name,
                        (profile.student?.[0]?.barangay || profile.student?.barangay).city?.province?.region?.name
                      ].filter(Boolean).join(', ')}
                    </>
                  )}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Security & Trusted Devices Section */}
        <section className="rounded-2xl border border-slate-100 bg-white px-6 py-5 space-y-4 shadow-sm mt-6">
          <h2 className="text-xs font-semibold text-slate-800 flex items-center">
            <FaFingerprint className="mr-2 text-[#1434A4]" /> Security & Trusted Devices
          </h2>
          <p className="text-[11px] text-slate-500 mb-4">
            Manage the devices that have access to your account without needing an email verification code.
          </p>
          
          {devices.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-400">
              No trusted devices found.
            </div>
          ) : (
            <div className="space-y-3">
              {devices.map((device) => (
                <div key={device.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl gap-3">
                  <div className="flex items-center space-x-4">
                    <div className={`p-2.5 rounded-full shrink-0 ${device.is_active ? 'bg-blue-100 text-[#1434A4]' : 'bg-gray-100 text-gray-400'}`}>
                      <FaLaptopCode className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold truncate ${device.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                        {device.device_name || 'Unknown Device'}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                        Last used: {new Date(device.last_used_at).toLocaleDateString()} {new Date(device.last_used_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    {device.is_active ? (
                      <button
                        onClick={() => handleRevokeDevice(device.id)}
                        className="text-[10px] text-rose-600 hover:text-rose-700 font-semibold px-3 py-1.5 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors flex items-center whitespace-nowrap"
                      >
                        <FaTrash className="mr-1.5 h-2.5 w-2.5" /> Revoke
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRestoreDevice(device.id)}
                        className="text-[10px] text-emerald-600 hover:text-emerald-700 font-semibold px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors flex items-center whitespace-nowrap"
                      >
                        Undo / Restore
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {loading && (
          <p className="text-[11px] text-slate-500">Loading your profile…</p>
        )}
        {error && (
          <p className="text-[11px] text-rose-600">
            {error}
          </p>
        )}

        {/* Edit profile modal */}
        {editOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl p-6 space-y-4 text-[11px]">
              <h2 className="text-sm font-semibold text-slate-900">Edit profile</h2>
              <p className="text-slate-500">
                Update your basic information. These details are visible to administrators and may be
                used for verification.
              </p>

              <form className="space-y-3" onSubmit={handleEditSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1 md:col-span-1">
                    <label className="block font-medium text-slate-700">First name</label>
                    <input
                      type="text"
                      name="firstName"
                      value={editForm.firstName}
                      onChange={handleEditChange}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Juan"
                      required
                    />
                  </div>
                  <div className="space-y-1 md:col-span-1">
                    <label className="block font-medium text-slate-700">Middle name</label>
                    <input
                      type="text"
                      name="middleName"
                      value={editForm.middleName}
                      onChange={handleEditChange}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Santos"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-1">
                    <label className="block font-medium text-slate-700">Last name</label>
                    <input
                      type="text"
                      name="lastName"
                      value={editForm.lastName}
                      onChange={handleEditChange}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Dela Cruz"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700">
                      {isStudent ? 'Student ID' : 'Employee ID'}
                    </label>
                    <input
                      type="text"
                      name="studentId"
                      value={editForm.studentId}
                      onChange={handleEditChange}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder={isStudent ? "2024-0000" : "EMP-0000"}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700">Nickname</label>
                    <input
                      type="text"
                      name="nickname"
                      value={editForm.nickname}
                      onChange={handleEditChange}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="e.g. Jun"
                    />
                  </div>
                </div>

                {isStudent && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="block font-medium text-slate-700">Department</label>
                        <select
                          name="department"
                          value={editForm.department}
                          onChange={handleEditChange}
                          className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">Select department</option>
                          {departments.map((d: any) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="block font-medium text-slate-700">Program</label>
                        <select
                          name="program"
                          value={editForm.program}
                          onChange={handleEditChange}
                          className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">Select program</option>
                          {programs
                            .filter((p: any) => !editForm.department || p.department_id === editForm.department)
                            .map((p: any) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="block font-medium text-slate-700">Year level</label>
                        <select
                          name="yearLevel"
                          value={editForm.yearLevel}
                          onChange={handleEditChange}
                          className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">Select year level</option>
                          {yearLevels.map((y: any) => (
                            <option key={y.id} value={y.id}>
                              {y.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="block font-medium text-slate-700">Section</label>
                        <select
                          name="section"
                          value={editForm.section}
                          onChange={handleEditChange}
                          className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">Select section</option>
                          {sections.map((s: any) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block font-medium text-slate-700">Address</label>
                      <textarea
                        name="streetAddress"
                        value={editForm.streetAddress}
                        onChange={handleEditChange}
                        className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="Street name, Bldg, etc."
                        rows={2}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="block font-medium text-slate-700">Region</label>
                        <select
                          name="region"
                          value={editForm.region}
                          onChange={handleRegionSelectChange}
                          className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">Select region</option>
                          {regions.map((r) => (
                            <option key={r.code} value={r.code}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="block font-medium text-slate-700">Province</label>
                        <select
                          name="province"
                          value={editForm.province}
                          onChange={handleProvinceSelectChange}
                          disabled={!editForm.region}
                          className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                        >
                          <option value="">Select province</option>
                          {provinces.map((p) => (
                            <option key={p.code} value={p.code}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="block font-medium text-slate-700">City / Municipality</label>
                        <select
                          name="city"
                          value={editForm.city}
                          onChange={handleCitySelectChange}
                          disabled={!editForm.province}
                          className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                        >
                          <option value="">Select city</option>
                          {cities.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="block font-medium text-slate-700">Barangay</label>
                        <select
                          name="barangay"
                          value={editForm.barangay}
                          onChange={handleEditChange}
                          disabled={!editForm.city}
                          className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                        >
                          <option value="">Select barangay</option>
                          {barangays.map((b) => (
                            <option key={b.code} value={b.code}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}

                <div className="flex flex-col sm:flex-row sm:justify-end sm:space-x-3 space-y-2 sm:space-y-0 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditOpen(false)}
                    className="w-full sm:w-auto inline-flex justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="w-full sm:w-auto inline-flex justify-center rounded-2xl bg-blue-700 hover:bg-blue-800 px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {editSaving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Change profile picture modal */}
        {avatarOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6 space-y-4 text-[11px]">
              <h2 className="text-sm font-semibold text-slate-900">Change profile picture</h2>
              <p className="text-slate-500">
                Upload a clear photo where your face is visible. This may be used by administrators
                to help verify your account.
              </p>

              <form className="space-y-4" onSubmit={handleAvatarSubmit}>
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 rounded-full bg-blue-50 flex items-center justify-center overflow-hidden border border-slate-200">
                    {avatarPreview || profile?.avatar_url ? (
                      <img
                        src={avatarPreview || profile?.avatar_url}
                        alt="Profile picture preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs font-semibold text-blue-800">
                        {fullName
                          .split(' ')
                          .map((p: string) => p[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <label className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer">
                      <span>Choose photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleAvatarFileChange}
                      />
                    </label>
                    <p className="text-[10px] text-slate-500">
                      JPG or PNG, up to ~5MB. Square photos work best.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:justify-end sm:space-x-3 space-y-2 sm:space-y-0 pt-1">
                  <button
                    type="button"
                    onClick={() => setAvatarOpen(false)}
                    className="w-full sm:w-auto inline-flex justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={avatarSaving}
                    className="w-full sm:w-auto inline-flex justify-center rounded-2xl bg-blue-700 hover:bg-blue-800 px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {avatarSaving ? 'Saving…' : 'Save picture'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Change password modal */}
        {passwordOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6 space-y-4 text-[11px]">
              <h2 className="text-sm font-semibold text-slate-900">Change password</h2>
              <p className="text-slate-500">
                Enter your current password, then choose a new password (at least 6 characters).
              </p>
              <form className="space-y-3" onSubmit={handlePasswordSubmit}>
                <div className="space-y-1">
                  <label className="block font-medium text-slate-700">Current password</label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? "text" : "password"}
                      name="currentPassword"
                      value={passwordForm.currentPassword}
                      onChange={handlePasswordFormChange}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 pr-10"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showCurrentPassword ? <FaEyeSlash className="w-3.5 h-3.5" /> : <FaEye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="block font-medium text-slate-700">New password</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      name="newPassword"
                      value={passwordForm.newPassword}
                      onChange={handlePasswordFormChange}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 pr-10"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showNewPassword ? <FaEyeSlash className="w-3.5 h-3.5" /> : <FaEye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <PasswordStrengthIndicator
                  password={passwordForm.newPassword}
                  onValidationChange={setPasswordValid}
                />

                <div className="space-y-1">
                  <label className="block font-medium text-slate-700">Confirm new password</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      name="confirmPassword"
                      value={passwordForm.confirmPassword}
                      onChange={handlePasswordFormChange}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 pr-10"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showConfirmPassword ? <FaEyeSlash className="w-3.5 h-3.5" /> : <FaEye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-end sm:space-x-3 space-y-2 sm:space-y-0 pt-1">
                  <button
                    type="button"
                    onClick={() => setPasswordOpen(false)}
                    className="w-full sm:w-auto inline-flex justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={passwordSaving}
                    className="w-full sm:w-auto inline-flex justify-center rounded-2xl bg-blue-700 hover:bg-blue-800 px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {passwordSaving ? 'Updating…' : 'Update password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </>
  )
}

export default StudentProfile

