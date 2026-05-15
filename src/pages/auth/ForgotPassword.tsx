import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import toast from 'react-hot-toast'
import { FaEnvelope, FaArrowLeft } from 'react-icons/fa'

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const { resetPassword } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      toast.error('Please enter your email address.')
      return
    }
    setLoading(true)
    try {
      // Standard password reset execution

      const { error } = await resetPassword(email.trim())
      if (error) {
        toast.error('Failed to send reset email. Please verify your email and try again.')
        return
      }
      setSent(true)
      toast.success('Check your email for a link to reset your password.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl px-6 sm:px-8 py-8 text-center space-y-4">
          <h1 className="text-lg font-semibold text-slate-900">Check your email</h1>
          <p className="text-sm text-slate-600">
            We sent a password reset link to <span className="font-medium text-slate-800">{email}</span>.
            Click the link to set a new password. If you don’t see it, check your spam folder.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-2xl bg-[#4F46E5] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#4338CA]"
            >
              Back to login
            </Link>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Use a different email
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl px-6 sm:px-8 py-6 sm:py-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center text-xs text-gray-500 hover:text-blue-600"
        >
          <FaArrowLeft className="mr-1 h-3 w-3" />
          Back
        </button>
        <h1 className="text-lg font-semibold text-slate-900">Forgot password?</h1>
        <p className="mt-1 text-sm text-slate-600">
          This is only for accounts that sign in with email and password. If you usually sign in
          with Google, please change your password from your Google Account settings instead.
        </p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1">
            <label htmlFor="email" className="block text-xs font-medium text-gray-700">
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
                placeholder="student@dyci.edu.ph"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex justify-center rounded-2xl bg-[#4F46E5] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#4338CA] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">
          Remember your password?{' '}
          <Link to="/login" className="font-medium text-blue-600 hover:text-blue-500">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default ForgotPassword
