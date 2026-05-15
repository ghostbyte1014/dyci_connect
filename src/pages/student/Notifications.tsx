import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import toast from 'react-hot-toast'
import { FaBell, FaCheck, FaTrash, FaExternalLinkAlt } from 'react-icons/fa'
import { Skeleton } from '../../components/ui/Skeleton'

interface Notification {
  id: string
  user_id: string
  title: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  read: boolean
  created_at: string
  action_url?: string
}

const Notifications: React.FC = () => {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) {
      setLoading(false)
      return
    }
    loadNotifications()
  }, [user?.id, filter])

  const loadNotifications = async () => {
    if (!isSupabaseConfigured || !user?.id) return
    setLoading(true)
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (filter === 'unread') {
        query = query.eq('read', false)
      }

      const { data, error } = await query

      if (error) {
        console.error('Error loading notifications', error)
        toast.error('Failed to load notifications')
        setNotifications([])
      } else {
        setNotifications((data as Notification[]) || [])
      }
    } catch (error) {
      console.error('Error loading notifications', error)
      setNotifications([])
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (id: string) => {
    if (!isSupabaseConfigured) return
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)

    if (error) {
      toast.error('Failed to mark as read')
    } else {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      )
    }
  }

  const markAllAsRead = async () => {
    if (!isSupabaseConfigured || !user?.id) return
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false)

    if (error) {
      toast.error('Failed to mark all as read')
    } else {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      toast.success('All notifications marked as read')
    }
  }

  const deleteNotification = async (id: string) => {
    if (!isSupabaseConfigured) return
    const { error } = await supabase.from('notifications').delete().eq('id', id)

    if (error) {
      toast.error('Failed to delete notification')
    } else {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    }
  }

  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <>
      <header className="unified-header">
        <div className="unified-header-content">
          <h1 className="unified-header-title">Notifications</h1>
          <p className="unified-header-subtitle">
            View and manage your notifications
          </p>
        </div>
      </header>

      <main className="unified-main">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as 'all' | 'unread')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All</option>
              <option value="unread">Unread</option>
            </select>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <FaCheck className="h-3 w-3" />
                Mark all read
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex gap-4">
                  <Skeleton variant="circle" width={32} height={32} className="shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton variant="text" width="40%" height={20} />
                    <Skeleton variant="text" width="90%" />
                    <Skeleton variant="text" width="20%" height={12} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <FaBell className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-700">No notifications</p>
            <p className="text-xs text-slate-500 mt-1">
              {filter === 'unread' ? 'No unread notifications' : 'You\'re all caught up'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`bg-white rounded-2xl border px-4 py-3 ${
                  notification.read
                    ? 'border-slate-200'
                    : 'border-blue-200 bg-blue-50/30'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      {!notification.read && (
                        <div className="mt-1.5 h-2 w-2 rounded-full bg-blue-600 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900">
                          {notification.title}
                        </h3>
                        <p className="text-xs text-slate-600 mt-1">{notification.message}</p>
                        <p className="text-[10px] text-slate-400 mt-2">
                          {new Date(notification.created_at).toLocaleString()}
                        </p>
                        {notification.action_url && (
                          <Link
                            to={notification.action_url}
                            className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-blue-600 hover:text-blue-700"
                          >
                            {notification.action_url === '/complete-profile'
                              ? 'Complete your profile'
                              : 'View'}
                            <FaExternalLinkAlt className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!notification.read && (
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          markAsRead(notification.id)
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                        title="Mark as read"
                      >
                        <FaCheck className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        deleteNotification(notification.id)
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      title="Delete"
                    >
                      <FaTrash className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}

export default Notifications
