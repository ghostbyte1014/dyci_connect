import React, { useState, Suspense } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  FaUsers,
  FaBookOpen,
  FaCalendarAlt,
  FaComments,
  FaCogs,
  FaChartBar,
  FaSignOutAlt,
  FaBars,
  FaChevronLeft,
  FaChevronRight,
  FaUserCircle,
  FaBell,
  FaHdd,
  FaHistory,
  FaVideo,
  FaSitemap,
} from 'react-icons/fa'
import { MdSpaceDashboard, MdSettings } from "react-icons/md";
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { checkAndSendWelcomeNotification } from '../../utils/profileUtils'
import { useAuth } from '../../contexts/AuthContext'
import { formatRole } from '../../utils/roleUtils'
import { DashboardSkeleton } from '../ui/Skeleton'
const logo = '/icons/icon-512x512.png'

interface AdminLayoutProps {
  children: ReactNode
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, authoritativeRole, signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  // Determine console titles
  const userRoleTitle = formatRole(authoritativeRole || '', {
    position: user?.user_metadata?.approver_position || user?.user_metadata?.department
  })
  const isSysAdmin = authoritativeRole === 'system_admin' || authoritativeRole === 'sysadmin'
  const consoleTitle = isSysAdmin ? 'System Admin Portal' : 'Academic Admin Portal'

  React.useEffect(() => {
    const loadVerification = async () => {
      if (!isSupabaseConfigured || !user?.id) return

      const { data } = await supabase
        .from('profiles')
        .select('verified')
        .eq('id', user.id)
        .maybeSingle()

      const verified = data?.verified === true
      if (verified) {
        checkAndSendWelcomeNotification(user.id)
      }
    }
    loadVerification()
  }, [user?.id])

  React.useEffect(() => {
    const loadUnreadCount = async () => {
      if (!isSupabaseConfigured || !user?.id) {
        setUnreadCount(0)
        return
      }
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false)
      setUnreadCount(count || 0)
    }
    loadUnreadCount()
    const interval = setInterval(loadUnreadCount, 30000)
    return () => clearInterval(interval)
  }, [user?.id])

  // Level 90: System & Settings Control
  const systemNavItems = [
    { label: 'Dashboard', icon: MdSpaceDashboard, path: '/sysadmin/dashboard' },
    { label: 'Video Library', icon: FaVideo, path: '/sysadmin/broadcast' },
    { label: 'User Management', icon: FaUsers, path: '/sysadmin/users' },
    { label: 'Organization', icon: FaSitemap, path: '/sysadmin/organization' },
    { label: 'Activity Logs', icon: FaHistory, path: '/sysadmin/forensics' },
    { label: 'System Settings', icon: MdSettings, path: '/sysadmin/settings' },
    { label: 'Storage', icon: FaHdd, path: '/sysadmin/storage' },
    { label: 'Security Alerts', icon: FaBell, path: '/sysadmin/alerts', badge: unreadCount },
    { label: 'My Profile', icon: FaUserCircle, path: '/sysadmin/profile' },
  ]

  // Level 80: Academic Operations & Handbook
  const academicNavItems = [
    { label: 'Overview', icon: MdSpaceDashboard, path: '/admin/dashboard' },
    { label: 'Handbook Manager', icon: FaCogs, path: '/admin/cms' },
    { label: 'Preview Handbook', icon: FaBookOpen, path: '/admin/handbook-preview' },
    { label: 'Support Messages', icon: FaComments, path: '/admin/support' },
    { label: 'Activity Reports', icon: FaChartBar, path: '/admin/reports' },
    { label: 'School Calendar', icon: FaCalendarAlt, path: '/admin/calendar' },
    { label: 'Notifications', icon: FaBell, path: '/admin/notifications', badge: unreadCount },
    { label: 'My Profile', icon: FaUserCircle, path: '/admin/profile' },
  ]

  const navItems = isSysAdmin ? systemNavItems : academicNavItems

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      {/* Desktop sidebar (collapsible) */}
      <aside
        className={`hidden md:flex md:flex-col md:h-screen md:sticky md:top-0 md:border-r md:border-slate-200 bg-white transition-all duration-200 ease-in-out ${collapsed ? 'md:w-20' : 'md:w-64'
          }`}
      >
        <div className="relative h-20 px-6 flex items-center border-b border-slate-100">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="h-10 w-10 rounded-2xl bg-blue-50 flex items-center justify-center overflow-hidden shrink-0 shadow-sm border border-blue-100">
              <img src={logo} alt="DYCI logo" className="h-7 w-7 object-contain" />
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-[11px] font-extrabold tracking-[0.2em] text-dyci-blue uppercase">
                  DYCI CONNECT
                </span>
                <span className="text-[10px] text-slate-400 font-medium">
                  {consoleTitle}
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="absolute -right-3 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 text-[10px] shadow-sm active:scale-95 transition-all"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <FaChevronRight /> : <FaChevronLeft />}
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            const Icon = item.icon

            const baseClasses =
              'w-full flex items-center rounded-2xl px-3 py-2 text-xs font-medium transition-colors'

            return (
              <button
                key={item.label}
                type="button"
                onClick={() => navigate(item.path)}
                className={`${baseClasses} ${isActive
                  ? 'bg-dyci-blue text-white shadow-lg shadow-dyci-blue/20'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-dyci-blue'
                  } ${collapsed ? 'justify-center' : 'space-x-3'} relative group rounded-full overflow-hidden`}
              >
                <Icon className={`h-4 w-4 transition-transform ${!isActive && 'group-hover:scale-110'}`} />
                {!collapsed && <span className="font-semibold tracking-tight">{item.label}</span>}
                {isActive && !collapsed && (
                  <div className="absolute right-3 h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                )}
                {Number(item.badge) > 0 && (
                  <span className={`absolute ${collapsed ? '-top-1 -right-1' : 'right-3'} h-4 min-w-4 flex items-center justify-center rounded-full bg-dyci-red text-[9px] font-bold text-white px-1 shadow-sm`}>
                    {Number(item.badge) > 99 ? '99+' : item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t border-slate-200">
          {!collapsed && user && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-slate-800">
                {user.user_metadata?.full_name || 'Administrator'}
              </p>
              <p className="text-[11px] text-dyci-blue font-bold uppercase tracking-tighter">
                {userRoleTitle}
              </p>
              <p className="text-[10px] text-slate-500">{user.email}</p>
            </div>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className={`w-full inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 ${collapsed ? 'justify-center' : 'space-x-2'
              }`}
          >
            <FaSignOutAlt className="h-3 w-3" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <button
            type="button"
            className="flex-1 bg-black/30"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="w-64 bg-white border-l border-slate-200 flex flex-col">
            <div className="h-14 px-4 flex items-center border-b border-slate-200">
              <Link to="/" className="flex items-center space-x-2">
                <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center overflow-hidden shrink-0">
                  <img src={logo} alt="DYCI logo" className="h-6 w-6 object-contain" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold tracking-[0.25em] text-blue-900 uppercase">
                    DYCI CONNECT
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {isSysAdmin ? 'Institutional Control' : 'Academic Console'}
                  </span>
                </div>
              </Link>
            </div>

            <nav className="flex-1 px-3 py-4 space-y-1">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path
                const Icon = item.icon

                const baseClasses =
                  'w-full flex items-center rounded-2xl px-3 py-2 text-xs font-medium transition-colors space-x-3'

                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      navigate(item.path)
                      setMobileOpen(false)
                    }}
                    className={`${baseClasses} relative ${isActive
                      ? 'bg-dyci-blue text-white shadow-md'
                      : 'text-slate-700 hover:bg-slate-100'
                      }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{item.label}</span>
                    {Number(item.badge) > 0 && (
                      <span className="ml-auto h-4 min-w-4 flex items-center justify-center rounded-full bg-dyci-red text-[9px] font-semibold text-white px-1">
                        {Number(item.badge) > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>

            <div className="px-3 py-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  handleSignOut()
                  setMobileOpen(false)
                }}
                className="w-full inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 space-x-2"
              >
                <FaSignOutAlt className="h-3 w-3" />
                <span>Sign out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 w-full">
        {/* Mobile header */}
        <div className="md:hidden sticky top-0 z-30 bg-slate-50/95 border-b border-slate-200 px-4 py-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="inline-flex items-center justify-center h-8 w-8 rounded-full border border-slate-300 text-slate-600 bg-white shadow-sm"
            aria-label="Open admin navigation"
          >
            <FaBars className="h-4 w-4" />
          </button>
          <span className="text-xs font-semibold text-slate-700">Main Menu</span>
        </div>

        <div className="min-h-screen">
          <Suspense fallback={<DashboardSkeleton />}>
            {children}
          </Suspense>
        </div>
      </main>
    </div>
  )
}

export default AdminLayout
