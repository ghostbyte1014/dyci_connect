import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FaUser, FaCamera } from 'react-icons/fa'
import { useAuth } from '../../contexts/AuthContext'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { getAuthProvider } from '../../utils/profileUtils'

const CompleteStudentProfile: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    idNumber: '',
    streetAddress: '',
    region: '',
    province: '',
    city: '',
    barangay: '',
    nickname: '',
    department: '', // department_id (UUID)
    program: '',    // program_id (UUID)
    yearLevel: '',  // year_level_id (smallint)
    section: '',    // section_id (UUID)
  })

  const [regions, setRegions] = useState<any[]>([])
  const [provinces, setProvinces] = useState<any[]>([])
  const [cities, setCities] = useState<any[]>([])
  const [barangays, setBarangays] = useState<any[]>([])
  const [departments, setDepartments] = useState<any[]>([])
  const [programs, setPrograms] = useState<any[]>([])
  const [yearLevels, setYearLevels] = useState<any[]>([])
  const [sections, setSections] = useState<any[]>([])

  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null)
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null)

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!user) {
      navigate('/login')
      return
    }
  }, [user, navigate])

  useEffect(() => {
    const loadRegions = async () => {
      try {
        const res = await fetch('https://psgc.cloud/api/regions')
        if (!res.ok) throw new Error(`Failed to load regions: ${res.status}`)
        const data = await res.json()
        setRegions(data)
      } catch (error) {
        console.error('Error loading PSGC regions', error)
      }
    }

    const loadAcademicLookups = async () => {
      if (!isSupabaseConfigured) return
      try {
        const [deptRes, progRes, yearRes] = await Promise.all([
          supabase.from('departments').select('id, name').order('name'),
          supabase.from('programs').select('id, name, department_id').order('name'),
          supabase.from('year_levels').select('id, label, sort_order').order('sort_order'),
        ])

        if (!deptRes.error && deptRes.data) setDepartments(deptRes.data)
        if (!progRes.error && progRes.data) setPrograms(progRes.data)
        if (!yearRes.error && yearRes.data) setYearLevels(yearRes.data)

        const { data: sectionData, error: sectionError } = await supabase
          .from('sections')
          .select('id, label')
          .order('sort_order')

        if (!sectionError && sectionData) setSections(sectionData)
      } catch (error) {
        console.error('Error loading academic lookups', error)
      }
    }

    loadRegions()
    loadAcademicLookups()
  }, [])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleRegionChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    setForm((prev) => ({ ...prev, region: value, province: '', city: '', barangay: '' }))
    setProvinces([])
    setCities([])
    setBarangays([])
    if (!value) return

    try {
      const res = await fetch(`https://psgc.cloud/api/regions/${value}/provinces`)
      const data = await res.json()
      setProvinces(data)
      if (Array.isArray(data) && data.length === 0) {
        const cityRes = await fetch(`https://psgc.cloud/api/regions/${value}/cities-municipalities`)
        setCities(await cityRes.json())
      }
    } catch (error) {
      console.error('Error loading PSGC provinces', error)
    }
  }

  const handleProvinceChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    setForm((prev) => ({ ...prev, province: value, city: '', barangay: '' }))
    setCities([])
    setBarangays([])
    if (!value) return
    try {
      const res = await fetch(`https://psgc.cloud/api/provinces/${value}/cities-municipalities`)
      setCities(await res.json())
    } catch (error) {
      console.error('Error loading PSGC cities', error)
    }
  }

  const handleCityChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    setForm((prev) => ({ ...prev, city: value, barangay: '' }))
    setBarangays([])
    if (!value) return
    try {
      const res = await fetch(`https://psgc.cloud/api/cities-municipalities/${value}/barangays`)
      setBarangays(await res.json())
    } catch (error) {
      console.error('Error loading PSGC barangays', error)
    }
  }

  const handleProfileImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setProfileImageFile(file)
    const reader = new FileReader()
    reader.onloadend = () => setProfileImagePreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !isSupabaseConfigured) return

    // Validation
    if (!form.firstName.trim() || !form.lastName.trim()) return toast.error('Name is required.')
    if (!form.idNumber.trim()) return toast.error('Student ID is required.')
    if (!form.region || !form.city || !form.barangay) return toast.error('Address is required.')
    if (!form.department || !form.program || !form.yearLevel) return toast.error('Academic info is required.')

    setSubmitting(true)
    try {
      let avatarUrl: string | undefined

      if (profileImageFile) {
        const userId = user.id
        const ext = profileImageFile.name.split('.').pop() || 'jpg'
        const filePath = `avatars/${userId}/${Date.now()}.${ext}`

        const { error: avatarUploadError } = await (supabase as any).storage
          .from('user-docs')
          .upload(filePath, profileImageFile, {
            upsert: true,
            contentType: profileImageFile.type || undefined,
          })

        if (!avatarUploadError) {
          const { data: avatarPublicData } = (supabase as any).storage
            .from('user-docs')
            .getPublicUrl(filePath)
          avatarUrl = avatarPublicData.publicUrl
        }
      }

      const fullName = [form.firstName.trim(), form.middleName.trim(), form.lastName.trim()]
        .filter(Boolean)
        .join(' ')

      const { data: ayId } = await supabase.rpc('get_current_academic_year_id')
      if (!ayId) throw new Error('Could not resolve current academic year')

      const regionName = regions.find((r) => r.code === form.region)?.name || ''
      const provinceName = provinces.find((p) => p.code === form.province)?.name || ''
      const cityName = cities.find((c) => c.code === form.city)?.name || ''
      const barangayName = barangays.find((b) => b.code === form.barangay)?.name || ''

      const { data: bid, error: syncError } = await supabase.rpc('sync_geographic_hierarchy', {
        r_code: form.region, r_name: regionName,
        p_code: form.province, p_name: provinceName,
        c_code: form.city, c_name: cityName,
        b_code: form.barangay, b_name: barangayName,
      })
      if (syncError) throw syncError

      // 2. Identity & Profile Layer
      // Aligned with Profile.tsx update logic: uses .update() instead of .upsert()
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          first_name: form.firstName.trim(),
          middle_name: form.middleName.trim() || null,
          last_name: form.lastName.trim(),
          nickname: form.nickname.trim(),
          student_employee_id: form.idNumber.trim(),
          avatar_url: avatarUrl,
          profile_complete: true,
          // Note: role, email, verified are typically preserved from provisioning
        })
        .eq('id', user.id)
      
      if (profileError) throw profileError

      // 3. New Student Profile Layer
      const { error: studentError } = await supabase.from('student_profiles').upsert({
        profile_id: user.id,
        department_id: form.department,
        program_id: form.program,
        year_level_id: parseInt(form.yearLevel),
        section_id: form.section || null,
        street_address: form.streetAddress.trim(),
        barangay_id: bid,
        enrolled_academic_year_id: ayId,
      })
      if (studentError) throw studentError

      try {
        await supabase.auth.updateUser({
          data: { role: 'student', full_name: fullName },
        })
      } catch (authError) {
        console.warn('Auth metadata update failed (403), but database was saved.', authError)
      }

      toast.success('Profile saved successfully!')
      navigate('/student/dashboard')
    } catch (error) {
      console.error('Error completing student profile', error)
      toast.error('Failed to save profile. Please check your connection.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div className="text-center sm:text-left">
            <h1 className="text-xl font-bold text-slate-900">Complete Your Profile</h1>
          </div>

          <div className="flex flex-col lg:flex-row gap-8 items-start">
            {/* Left: Avatar & Names */}
            <div className="w-full lg:w-1/3 space-y-6">
              <div className="flex justify-center">
                <div className="relative">
                  <div className="h-24 w-24 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border-2 border-white shadow-sm">
                    {profileImagePreview ? (
                      <img src={profileImagePreview} alt="Avatar" className="h-full w-full object-cover" />
                    ) : (
                      <FaUser className="h-10 w-10 text-slate-300" />
                    )}
                  </div>
                  <label className="absolute bottom-0 right-0 h-8 w-8 bg-[#1434A4] rounded-full flex items-center justify-center cursor-pointer border-2 border-white shadow-sm hover:bg-[#102a82] transition-colors">
                    <FaCamera className="h-3.5 w-3.5 text-white" />
                    <input type="file" accept="image/*" className="hidden" onChange={handleProfileImageChange} />
                  </label>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">First name</label>
                  <input
                    name="firstName" value={form.firstName} onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm"
                    placeholder="John Christian" required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Middle name</label>
                  <input
                    name="middleName" value={form.middleName} onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm"
                    placeholder="Carpio"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Last name</label>
                  <input
                    name="lastName" value={form.lastName} onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm"
                    placeholder="Gabriel" required
                  />
                </div>
              </div>
            </div>

            {/* Right: ID, Address & Academic */}
            <div className="flex-1 w-full space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Student ID</label>
                  <input
                    name="idNumber" value={form.idNumber} onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm"
                    placeholder="2022-00674" required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Nickname</label>
                  <input
                    name="nickname" value={form.nickname} onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm"
                    placeholder="Christian"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Region</label>
                  <select
                    name="region" value={form.region} onChange={handleRegionChange}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm"
                  >
                    <option value="">Select region</option>
                    {regions.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Province</label>
                  <select
                    name="province" value={form.province} onChange={handleProvinceChange}
                    disabled={!form.region || provinces.length === 0}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm disabled:opacity-50"
                  >
                    <option value="">{form.region ? 'Select province' : '-'}</option>
                    {provinces.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">City</label>
                  <select
                    name="city" value={form.city} onChange={handleCityChange}
                    disabled={!form.region || (provinces.length > 0 && !form.province)}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm disabled:opacity-50"
                  >
                    <option value="">{form.city ? 'Select city' : '-'}</option>
                    {cities.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Barangay</label>
                  <select
                    name="barangay" value={form.barangay} onChange={handleChange}
                    disabled={!form.city}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm disabled:opacity-50"
                  >
                    <option value="">{form.city ? 'Select barangay' : '-'}</option>
                    {barangays.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Address</label>
                <textarea
                  name="streetAddress" value={form.streetAddress} onChange={handleChange}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm resize-none"
                  placeholder="Street name, Bldg, etc." rows={2} required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Department</label>
                  <select
                    name="department" value={form.department}
                    onChange={(e) => setForm(prev => ({ ...prev, department: e.target.value, program: '', yearLevel: '', section: '' }))}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm"
                  >
                    <option value="">Select dept</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Program</label>
                  <select
                    name="program" value={form.program} onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm"
                  >
                    <option value="">Select prog</option>
                    {programs.filter(p => p.department_id === form.department).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Year level</label>
                  <select
                    name="yearLevel" value={form.yearLevel} onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm"
                  >
                    <option value="">Select year</option>
                    {yearLevels.map(y => <option key={y.id} value={y.id}>{y.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Section</label>
                  <select
                    name="section" value={form.section} onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#1434A4] focus:ring-1 focus:ring-[#1434A4] outline-none transition-all text-sm"
                  >
                    <option value="">Select section</option>
                    {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-100">
            <button
              type="submit" disabled={submitting}
              className="w-full sm:w-auto px-8 py-2.5 rounded-xl bg-[#1434A4] text-white text-sm font-bold shadow-lg shadow-blue-900/20 hover:bg-[#102a82] disabled:opacity-50 transition-all"
            >
              {submitting ? 'Saving...' : 'Finalize Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CompleteStudentProfile
