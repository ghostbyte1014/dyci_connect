import React, { createContext, useState, useContext, useEffect } from 'react'
import type { ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import type { User, UserRole } from '../types'
import {
  getAuthProvider,
  checkAndSendWelcomeNotification
} from '../utils/profileUtils'

interface AuthContextType {
  user: User | null
  authoritativeRole: UserRole | null
  loading: boolean
  signUp: (email: string, password: string, role: UserRole, userData: any) => Promise<{ data: any; error: any }>
  signIn: (email: string, password: string) => Promise<{ data: any; error: any; requires_otp?: boolean; hwid?: string }>
  verifyDeviceOtp: (email: string, code: string, hwid: string, rememberDevice: boolean) => Promise<{ data: any; error: any }>
  signOut: () => Promise<{ error: any }>
  signInWithGoogle: () => Promise<{ error: any }>
  resetPassword: (email: string) => Promise<{ data: any; error: any }>
  updatePassword: (currentPassword: string, newPassword: string) => Promise<{ error: any }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [authoritativeRole, setAuthoritativeRole] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const isRefreshing = React.useRef(false)
  const isVerifyingDevice = React.useRef(false)

  // Hardware Fingerprinting function
  const getHWID = () => {
    try {
      const nav = window.navigator
      const screen = window.screen
      const rawId = `${nav.userAgent}-${screen.width}x${screen.height}-${nav.hardwareConcurrency || 1}`
      return btoa(rawId)
    } catch (e) {
      return 'unknown-device-fallback'
    }
  }

  const fetchAuthData = async (userId: string) => {
    try {
      const [roleRes, versionRes] = await Promise.all([
        supabase.rpc('get_user_role', { uid: userId }),
        supabase.rpc('get_auth_version')
      ]);

      if (!roleRes.error) setAuthoritativeRole(roleRes.data as UserRole);

      // Check and send welcome notification for verified users
      checkAndSendWelcomeNotification(userId);

      /* 
      // Check for auth_version mismatch against JWT
      // DISABLED: Causing 429 Rate Limit loops due to missing app_metadata sync in SQL
      const session = (await supabase.auth.getSession()).data.session;
      const jwtVersion = session?.user?.app_metadata?.auth_version || 1;
      const currentVersion = versionRes.data || 1;

      if (session && jwtVersion < currentVersion && !isRefreshing.current) {
        console.warn('MISSION-CRITICAL: Auth version mismatch detected. Refreshing session...');
        isRefreshing.current = true;
        try {
          const { error } = await supabase.auth.refreshSession();
          if (error) throw error;
        } catch (err) {
          console.error('Failed to refresh session for auth version sync:', err);
        } finally {
          // Allow subsequent refreshes only after a cooldown or new login event
          setTimeout(() => { isRefreshing.current = false; }, 10000); // 10s cooldown
        }
      }
      */
    } catch (err) {
      console.error('Error fetching authoritative auth data:', err);
      // Fallback to prevent app hang if RPC fails
      setAuthoritativeRole('student');
    }
  };

  useEffect(() => {
    if (isSupabaseConfigured) {
      supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
        const currentUser = session?.user as User | null;
        setUser(currentUser);
        if (currentUser) await fetchAuthData(currentUser.id);
        setLoading(false);
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, session: any) => {
        const currentUser = session?.user as User | null;
        
        // Skip auth state updates if we are in the middle of checking the device HWID
        if (isVerifyingDevice.current) return;

        setUser(currentUser);
        if (currentUser && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
          fetchAuthData(currentUser.id);
        }
        if (!currentUser) setAuthoritativeRole(null);
      });

      return () => subscription.unsubscribe();
    } else {
      setLoading(false);
    }
  }, []);

  const signUp = async (email: string, password: string, role: UserRole, userData: any) => {
    const doSignUp = () =>
      supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            role,
            ...userData,
          },
        },
      })

    let result = await doSignUp()
    const err = result.error as { message?: string; name?: string } | null
    const isRetryable =
      err && (err.name === 'AuthRetryableFetchError' || err.message === 'AuthRetryableFetchError')

    if (isRetryable) {
      if (import.meta.env.DEV) {
        console.warn(
          'Signup request failed (network). Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Retrying once...'
        )
      }
      await new Promise((r) => setTimeout(r, 1500))
      result = await doSignUp()
    }

    if (result.error && import.meta.env.DEV && isRetryable) {
      console.warn(
        'Signup still failed after retry. Ensure Supabase env vars are set (and on Vercel, redeploy after adding them).'
      )
    }

    return { data: result.data, error: result.error }
  }

  const signIn = async (email: string, password: string) => {
    isVerifyingDevice.current = true;
    
    // Real Supabase sign in
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error || !(data as any)?.user) {
      isVerifyingDevice.current = false;
      return { data: null, error }
    }

    const signedInUser = (data as any).user as User

    // --- TEST ACCOUNTS BYPASS ---
    // These specific test emails will bypass the New Device OTP check
    const bypassEmails = [
      'Aadmin@gmail.com', 'aadmin@gmail.com',
      'Sadmin@gmail.com', 'sadmin@gmail.com',
      'scholarship@dyci.edu',
      'finance@dyci.edu',
      'registrar@dyci.edu',
      'guidance@dyci.edu',
      'property@dyci.edu',
      'academic.council@dyci.edu',
      'president@dyci.edu',
      'vice.president@dyci.edu',
      'student@dyci.edu'
    ];

    if (bypassEmails.includes(email.toLowerCase())) {
      setUser(signedInUser)
      await supabase
        .from('profiles')
        .update({ last_login: new Date().toISOString(), auth_provider: 'email' })
        .eq('id', signedInUser.id)
      
      isVerifyingDevice.current = false;
      fetchAuthData(signedInUser.id);
      return { data, error: null, requires_otp: false }
    }
    // ----------------------------

    // 2. Check HWID (Device Fingerprinting)
    const hwid = getHWID()
    const { data: trustedDevice, error: devError } = await supabase
      .from('trusted_devices')
      .select('id, is_active')
      .eq('hwid_hash', hwid)
      .maybeSingle()

    // If device is trusted and active, proceed as normal
    if (trustedDevice?.is_active) {
      setUser(signedInUser)

      // Update last_sign_in and auth_provider (email sign-in) in profiles
      await supabase
        .from('profiles')
        .update({
          last_login: new Date().toISOString(),
          auth_provider: 'email',
        })
        .eq('id', signedInUser.id)

      isVerifyingDevice.current = false;
      fetchAuthData(signedInUser.id);
      return { data, error: null, requires_otp: false }
    }

    // 3. Device NOT trusted or inactive. We need OTP.
    // We sign them out so they don't have unauthorized access while waiting for OTP
    await supabase.auth.signOut()
    isVerifyingDevice.current = false;

    // 4. Trigger Email OTP
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false
      }
    })

    if (otpError) {
      return { data: null, error: otpError }
    }

    return { data: null, error: null, requires_otp: true, hwid }
  }

  const verifyDeviceOtp = async (email: string, code: string, hwid: string, rememberDevice: boolean) => {
    isVerifyingDevice.current = true;
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email'
    })

    if (error || !data.user) {
      isVerifyingDevice.current = false;
      return { data: null, error }
    }

    const signedInUser = data.user as unknown as User
    setUser(signedInUser)

    if (rememberDevice) {
      // Upsert the trusted device
      // Note: In some browsers window.navigator.userAgentData is better, but platform is a safe fallback
      const deviceName = /Windows/.test(navigator.userAgent) ? 'Windows PC' :
                         /Mac OS/.test(navigator.userAgent) ? 'Mac' :
                         /Linux/.test(navigator.userAgent) ? 'Linux' :
                         /Android/.test(navigator.userAgent) ? 'Android Device' :
                         /iPhone|iPad/.test(navigator.userAgent) ? 'iOS Device' : 'Unknown Device';

      await supabase
        .from('trusted_devices')
        .upsert({
          user_id: signedInUser.id,
          hwid_hash: hwid,
          device_name: deviceName,
          is_active: true,
          last_used_at: new Date().toISOString()
        }, {
          onConflict: 'user_id, hwid_hash'
        })
    }

    // Update profile login
    await supabase
      .from('profiles')
      .update({
        last_login: new Date().toISOString(),
        auth_provider: 'email_otp',
      })
      .eq('id', signedInUser.id)

    isVerifyingDevice.current = false;
    fetchAuthData(signedInUser.id);
    return { data, error: null }
  }

  const signOut = async () => {

    const { error } = await supabase.auth.signOut()
    if (!error) {
      setUser(null)
    }
    return { error }
  }

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    return { error }
  }

  const resetPassword = async (email: string) => {
    const redirectTo = `${window.location.origin}/reset-password`
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    return { data, error }
  }

  const updatePassword = async (currentPassword: string, newPassword: string) => {
    if (!isSupabaseConfigured || !user?.email) {
      return { error: { message: 'Not available in this environment.' } }
    }

    // For Google (and other OAuth-only) accounts, passwords are managed by the provider.
    const provider = getAuthProvider(user)
    if (provider !== 'email') {
      return {
        error: {
          message:
            'Your account uses Google sign-in. Change your password from your Google Account settings.',
        },
      }
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })
    if (signInError) {
      return { error: { message: 'Current password is incorrect.' } }
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error }
  }

  const value: AuthContextType = {
    user,
    authoritativeRole,
    loading,
    signUp,
    signIn,
    verifyDeviceOtp,
    signOut,
    signInWithGoogle,
    resetPassword,
    updatePassword,
  }

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  )
}