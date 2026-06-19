import React, { useState, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { FaCalendarAlt } from 'react-icons/fa'
import { Link } from 'react-router-dom'

interface CalendarEvent {
  id: string
  title: string
  date: string
  type: string
  description?: string
}

const UpcomingEventsWidget: React.FC = () => {
  const { user } = useAuth()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [isLocked, setIsLocked] = useState(false)

  useEffect(() => {
    fetchUpcomingEvents()
  }, [user])

  const fetchUpcomingEvents = async () => {
    try {
      if (!user?.id) return

      // 1. Get system settings
      const { data: settings } = await supabase
        .from('school_settings')
        .select('current_academic_year_id')
        .single()

      const currentYearId = settings?.current_academic_year_id || ''

      // 2. CHECK VISIBILITY GATING (For faculty/staff, we only care about handbook publication)
      const { data: handbooks } = await supabase
        .from('handbooks')
        .select('id')
        .eq('academic_year_id', currentYearId)
        .eq('status', 'published')
        .limit(1)

      if (!handbooks || handbooks.length === 0) {
        setIsLocked(true)
        setEvents([])
        return
      }

      setIsLocked(false)

      // 3. Fetch events (Active only) for the current month
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]

      const { data, error } = await supabase
        .from('calendar_events')
        .select('id, title, date, type, description')
        .eq('academic_year_id', currentYearId)
        .is('deleted_at', null)
        .gte('date', startOfMonth)
        .lte('date', endOfMonth)
        .order('date', { ascending: true })

      if (error) throw error
      setEvents(data || [])
    } catch (error) {
      console.error('Error fetching events:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    if (date.toDateString() === today.toDateString()) return 'Today'
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
    
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    })
  }

  const getEventTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      academic: 'bg-blue-100 text-blue-700',
      event: 'bg-purple-100 text-purple-700',
      holiday: 'bg-amber-100 text-amber-700',
      exam: 'bg-rose-100 text-rose-700',
      deadline: 'bg-emerald-100 text-emerald-700'
    }
    return colors[type] || 'bg-slate-100 text-slate-700'
  }

  const currentMonthName = new Date().toLocaleDateString('en-US', { month: 'long' })

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-slate-200 rounded w-1/3"></div>
          <div className="h-12 bg-slate-200 rounded"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <FaCalendarAlt className="text-blue-500" />
          {currentMonthName} Events
        </h3>
        <Link 
          to="/staff/calendar" 
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          View calendar
        </Link>
      </div>

      {isLocked ? (
        <div className="text-center py-6">
          <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="text-slate-400">🔒</span>
          </div>
          <p className="text-sm font-semibold text-slate-800">Calendar Locked</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed px-4">
            The academic calendar for this year has not been published yet.
          </p>
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-6">
          <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <FaCalendarAlt className="text-slate-400 text-xl" />
          </div>
          <p className="text-sm text-slate-600">No upcoming events</p>
          <p className="text-xs text-slate-400 mt-1">Check back later</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all"
            >
              <div className="flex-shrink-0 w-14 text-center">
                <span className="text-xs font-medium text-slate-500">
                  {formatDate(event.date)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">
                  {event.title}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded capitalize ${getEventTypeColor(event.type)}`}>
                    {event.type}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default UpcomingEventsWidget
