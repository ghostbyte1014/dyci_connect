import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { checkProfileCompleteness, createIncompleteProfileNotification } from '../../utils/profileUtils'
import toast from 'react-hot-toast'
import { FaEnvelope, FaLock, FaArrowLeft, FaEye, FaEyeSlash } from 'react-icons/fa'
import OtpInput from '../../components/auth/OtpInput'
const logo = '/icons/icon-512x512.png'

const Login: React.FC = () => {
  const [email, setEmail] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [showPassword, setShowPassword] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [requiresOtp, setRequiresOtp] = useState<boolean>(false)
  const [hwid, setHwid] = useState<string>('')
  const { signIn, verifyDeviceOtp } = useAuth()
  const navigate = useNavigate()

  const handleSuccessfulLogin = async (user: any) => {
    toast.success('Login successful!')

    let role = (user?.user_metadata?.role as string | undefined)?.toLowerCase()

    // Fallback: if metadata role is missing, read from profiles table
    if (!role && isSupabaseConfigured && user?.id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, first_name, last_name')
        .eq('id', user.id)
        .maybeSingle()
      role = (profile?.role as string | undefined)?.toLowerCase()
      const completeness = checkProfileCompleteness(profile)
      if (!profile || !completeness.isComplete) {
        await createIncompleteProfileNotification(user.id)
      }
    } else if (isSupabaseConfigured && user?.id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, first_name, last_name')
        .eq('id', user.id)
        .maybeSingle()
      const completeness = checkProfileCompleteness(profile)
      if (!profile || !completeness.isComplete) {
        await createIncompleteProfileNotification(user.id)
      }
    }

    if (role === 'system_admin' || role === 'sysadmin') {
      navigate('/sysadmin/dashboard')
    } else if (role === 'academic_admin') {
      navigate('/admin/dashboard')
    } else if (role === 'staff' || role === 'faculty') {
      navigate('/staff/dashboard')
    } else if (role === 'student') {
      navigate('/student/dashboard')
    } else {
      toast.error('Your account has no role assigned. Please contact the administrator.')
      navigate('/')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const { data, error, requires_otp, hwid: returnedHwid } = await signIn(email, password)
      if (error) throw error

      if (requires_otp) {
        setRequiresOtp(true)
        if (returnedHwid) setHwid(returnedHwid)
        toast.success('Verification code sent to your email.')
        setLoading(false)
        return
      }

      await handleSuccessfulLogin((data as any)?.user)
    } catch (error: any) {
      toast.error(error.message || 'Authentication failed. Please check your credentials.');
      setLoading(false)
    }
  }

  const handleOtpSubmit = async (code: string, rememberDevice: boolean) => {
    setLoading(true)
    try {
      const { data, error } = await verifyDeviceOtp(email, code, hwid, rememberDevice)
      if (error) throw error
      
      await handleSuccessfulLogin((data as any)?.user)
    } catch (error: any) {
      toast.error(error.message || 'Invalid or expired verification code.')
      setLoading(false)
    }
  }


  return (
    <div className="min-h-screen flex bg-gray-50">
      <div className="flex w-full flex-col lg:flex-row">
        {/* Left column: card with form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center px-4 sm:px-8 lg:px-12 py-8 lg:py-12">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl px-6 sm:px-8 py-6 sm:py-8">
            {/* Back button */}
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mb-4 inline-flex items-center text-xs text-gray-500 hover:text-blue-600"
            >
              <FaArrowLeft className="mr-1 h-3 w-3" />
              Back to home
            </button>


            {/* Email/password form or OTP */}
            {requiresOtp ? (
              <OtpInput 
                email={email}
                isLoading={loading}
                onSubmit={handleOtpSubmit}
                onCancel={() => {
                  setRequiresOtp(false)
                  setPassword('')
                }}
              />
            ) : (
              <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-1">
                <label
                  htmlFor="email"
                  className="block text-xs font-medium text-gray-700"
                >
                  Email address
                </label>
                <div className="mt-1 flex items-center rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
                  <FaEnvelope className="h-4 w-4 text-gray-400 mr-3" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border-0 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="password"
                  className="block text-xs font-medium text-gray-700"
                >
                  Password
                </label>
                <div className="mt-1 flex items-center rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 relative">
                  <FaLock className="h-4 w-4 text-gray-400 mr-3" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border-0 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 pr-10"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? <FaEyeSlash className="h-4 w-4" /> : <FaEye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-gray-600">
                <label className="inline-flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Remember me</span>
                </label>
                <Link
                  to="/forgot-password"
                  className="text-blue-600 hover:text-blue-500 font-medium"
                >
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full inline-flex justify-center rounded-2xl bg-[#1434A4] hover:bg-[#102a82] text-white text-sm font-semibold py-3 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
            )}

          </div>
        </div>

        {/* Right column: brand panel */}
        <div className="hidden lg:flex w-full lg:w-1/2 bg-[#1434A4] items-center justify-center relative overflow-hidden">
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-400/10 rounded-full -ml-48 -mb-48 blur-3xl"></div>

          <div className="text-center px-8 relative z-10 animate-in fade-in zoom-in duration-700">
            <div className="inline-flex items-center justify-center mb-8 relative">
              <div className="absolute inset-0 bg-white/20 rounded-full blur-2xl animate-pulse"></div>
              <img
                src={logo}
                alt="DYCI Connect logo"
                className="h-40 w-40 object-contain rounded-full border-[6px] border-white/20 shadow-2xl relative z-10 p-2 bg-white/10 backdrop-blur-sm"
              />
            </div>
            <h1 className="text-lg font-bold tracking-[0.4em] text-white uppercase mb-2">
              DYCI CONNECT
            </h1>
            <div className="h-1 w-12 bg-blue-400/50 mx-auto rounded-full mb-6"></div>
            <p className="text-sm font-medium text-blue-100 tracking-wide max-w-xs mx-auto leading-relaxed">
              The institutional gateway to your digital student handbook and academic resources.
            </p>
          </div>
        </div>
      </div>

    </div>
  )
}

export default Login