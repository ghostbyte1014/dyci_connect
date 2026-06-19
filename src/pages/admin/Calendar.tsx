import React, { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'
import { generateKeywords } from '../../utils/chatLogic'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  setAcademicYearAsCurrent,
  fetchAcademicYears,
  createAcademicYear
} from '../../lib/api/settings'
import type { AcademicYear } from '../../lib/api/settings'

type EventType = 'holiday' | 'exam' | 'class' | 'enrollment' | 'event'

interface CalendarEvent {
  id?: string
  date: string
  title: string
  type: EventType
  description?: string
  academic_year_id: string
  deleted_at?: string | null
  calendar_event_keywords?: { keyword: string }[]
}

const eventBadgeClasses: Record<EventType, string> = {
  holiday: 'bg-rose-500',
  exam: 'bg-orange-500',
  class: 'bg-emerald-500',
  enrollment: 'bg-blue-500',
  event: 'bg-violet-500',
}

const legendLabel: Record<EventType, string> = {
  holiday: 'Holidays',
  exam: 'Examinations',
  class: 'Classes',
  enrollment: 'Enrollment',
  event: 'Events',
}

const monthOptions = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const logForensicActivity = async (
  action: 'INSERT' | 'UPDATE' | 'DELETE',
  tableName: string,
  recordId: string,
  oldData?: any,
  newData?: any
) => {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single()

    const role = profile?.role || 'system'

    await supabase.from('audit_logs').insert({
      actor_id: session.user.id,
      actor_role: role,
      action,
      table_name: tableName,
      record_id: recordId,
      old_data: oldData || null,
      new_data: newData || null,
      ip_address: 'client-side',
      user_agent: navigator.userAgent || 'web-client',
    })
  } catch (err) {
    console.error('Error logging forensics activity:', err)
  }
}

const Calendar: React.FC = () => {
  const { user } = useAuth()
  // STATES
  const [currentYear, setCurrentYear] = useState(2025)
  const [currentMonth, setCurrentMonth] = useState(6) // July = 6
  const [selectedDate, setSelectedDate] = useState<string>('2025-07-01')
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [isTargetRunnerOpen, setIsTargetRunnerOpen] = useState(false)
  const [isRunConfirmOpen, setIsRunConfirmOpen] = useState(false)
  const [eventTargetMode, setEventTargetMode] = useState<'multiple' | 'range'>(
    'multiple'
  )
  const [targetAction, setTargetAction] = useState<'add' | 'delete'>('add')
  const [manualTargetDate, setManualTargetDate] = useState('2025-07-01')
  const [rangeStartDate, setRangeStartDate] = useState<string>('')
  const [rangeEndDate, setRangeEndDate] = useState<string>('')
  const [events, setEvents] = useState<CalendarEvent[]>([])

  // ACADEMIC YEARS
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
  const [selectedYearId, setSelectedYearId] = useState<string>('')
  const [isYearModalOpen, setIsYearModalOpen] = useState(false)
  const [newStartYear, setNewStartYear] = useState<number | string>('')
  const [isCreatingYear, setIsCreatingYear] = useState(false)

  // GLOBAL SETTINGS
  const [globalAcademicYear, setGlobalAcademicYear] = useState('2025-2026')
  const [savingYear, setSavingYear] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [showAddConfirmModal, setShowAddConfirmModal] = useState(false)

  // EXPORT PDF OPTIONS
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [exportScope, setExportScope] = useState<'year' | 'month' | 'range'>('year')
  const [exportMonth, setExportMonth] = useState<number>(6) // Default to July
  const [exportStartDate, setExportStartDate] = useState<string>('')
  const [exportEndDate, setExportEndDate] = useState<string>('')

  const nextAcademicYearName = useMemo(() => {
    if (academicYears.length === 0) return '2025-2026'
    let maxStartYear = 0
    academicYears.forEach(y => {
      const parts = y.year_name.split('-')
      if (parts.length === 2) {
        const sy = parseInt(parts[0])
        if (!isNaN(sy) && sy > maxStartYear) {
          maxStartYear = sy
        }
      }
    })
    if (maxStartYear === 0) return '2025-2026'
    return `${maxStartYear + 1}-${maxStartYear + 2}`
  }, [academicYears])

  const yearBounds = useMemo(() => {
    const year = academicYears.find((y) => y.id === selectedYearId)
    if (year) {
      const parts = year.year_name.split('-')
      if (parts.length === 2) {
        const startY = parseInt(parts[0])
        const endY = parseInt(parts[1])
        if (!isNaN(startY) && !isNaN(endY)) {
          return { startYear: startY, endYear: endY }
        }
      }
    }
    return null
  }, [selectedYearId, academicYears])

  const dateLimits = useMemo(() => {
    if (!yearBounds) return { min: '', max: '' }
    const startY = yearBounds.startYear
    const endY = yearBounds.endYear
    return {
      min: `${startY}-06-01`,
      max: `${endY}-05-31`
    }
  }, [yearBounds])

  useEffect(() => {
    if (yearBounds) {
      const now = new Date()
      const curY = now.getFullYear()
      const curM = now.getMonth()

      const startBound = new Date(yearBounds.startYear, 5, 1)
      const endBound = new Date(yearBounds.endYear, 4, 31)

      if (now >= startBound && now <= endBound) {
        setCurrentYear(curY)
        setCurrentMonth(curM)
        setSelectedDate(`${curY}-${String(curM + 1).padStart(2, '0')}-01`)
        setManualTargetDate(`${curY}-${String(curM + 1).padStart(2, '0')}-01`)
      } else {
        setCurrentYear(yearBounds.startYear)
        setCurrentMonth(5) // June
        setSelectedDate(`${yearBounds.startYear}-06-01`)
        setManualTargetDate(`${yearBounds.startYear}-06-01`)
      }
    }
  }, [yearBounds])

  useEffect(() => {
    const loadData = async () => {
      // 1. Fetch Academic Years
      const { data: years } = await fetchAcademicYears()
      if (years) {
        setAcademicYears(years)
        const current = years.find(y => y.is_current)
        if (current) {
          setSelectedYearId(current.id)
          setGlobalAcademicYear(current.year_name)
        } else if (years.length > 0) {
          setSelectedYearId(years[0].id)
          setGlobalAcademicYear(years[0].year_name)
        }
      }

      // 2. Fetch Events (filtered by current year if possible, but let's start with all and we'll filter in state)
      const { data: eventsData, error } = await supabase.from('calendar_events').select('*, calendar_event_keywords(keyword)')
      if (error) {
        console.error('Error fetching events:', error)
      } else if (eventsData) {
        setEvents(eventsData)
      }
    }
    loadData()

    // Check for upcoming events every hour
    const checkUpcomingEvents = async () => {
      const today = new Date()
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const tomorrowStr = tomorrow.toISOString().split('T')[0]

      // Get current academic year
      const { data: currentYear } = await supabase
        .from('academic_years')
        .select('id')
        .eq('is_current', true)
        .single()

      if (!currentYear) return

      // Find events happening tomorrow
      const { data: upcomingEvents } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('academic_year_id', currentYear.id)
        .eq('date', tomorrowStr)
        .is('deleted_at', null)

      if (!upcomingEvents || upcomingEvents.length === 0) return

      // Get all verified users
      const { data: users } = await supabase
        .from('profiles')
        .select('id')
        .eq('verified', true)

      if (!users || users.length === 0) return

      // Send notifications for upcoming events
      for (const event of upcomingEvents) {
        const notifications = users.map(user => ({
          user_id: user.id,
          title: 'Upcoming Event Tomorrow',
          message: `${event.title} - ${new Date(event.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
          type: 'warning',
          read: false,
          action_url: '/student/calendar'
        }))

        await supabase.from('notifications').insert(notifications)
      }
    }

    // Run immediately and then every hour
    checkUpcomingEvents()
    const interval = setInterval(checkUpcomingEvents, 60 * 60 * 1000)

    return () => clearInterval(interval)
  }, [])

  const [selectedEventIndexes, setSelectedEventIndexes] = useState<number[]>([])
  const [newEventTitle, setNewEventTitle] = useState('')
  const [newEventType, setNewEventType] = useState<EventType>('holiday')
  const [newEventKeywords, setNewEventKeywords] = useState('')
  const [editEventKeywords, setEditEventKeywords] = useState('')
  const [isGeneratingKeywords, setIsGeneratingKeywords] = useState(false)

  // DYNAMIC DAYS
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay()

  const weeks: Array<Array<number | null>> = []
  let currentDay = 1 - firstDayOfWeek
  while (currentDay <= daysInMonth) {
    const week: Array<number | null> = []
    for (let i = 0; i < 7; i++) {
      if (currentDay < 1 || currentDay > daysInMonth) {
        week.push(null)
      } else {
        week.push(currentDay)
      }
      currentDay++
    }
    weeks.push(week)
  }

  const getEventsForDate = (iso: string) =>
    events.filter((e: CalendarEvent) =>
      e.date === iso &&
      e.academic_year_id === selectedYearId &&
      (showArchived ? !!e.deleted_at : !e.deleted_at)
    )

  const monthEvents = useMemo(() => {
    return events
      .filter((e) => {
        const d = new Date(e.date)
        return (
          d.getMonth() === currentMonth &&
          d.getFullYear() === currentYear &&
          e.academic_year_id === selectedYearId &&
          !e.deleted_at
        )
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [events, currentMonth, currentYear, selectedYearId])

  const rangeDates =
    rangeStartDate === '' || rangeEndDate === ''
      ? []
      : (() => {
        const start = new Date(rangeStartDate)
        const end = new Date(rangeEndDate)
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return []
        const dates: string[] = []
        const current = new Date(start)
        while (current <= end) {
          dates.push(current.toISOString().split('T')[0])
          current.setDate(current.getDate() + 1)
        }
        return dates
      })()

  const activeTargetDates = Array.from(
    new Set(
      eventTargetMode === 'range'
        ? rangeDates
        : selectedDates.length > 0
          ? selectedDates
          : [manualTargetDate || selectedDate]
    )
  )

  // Get current academic year for notification purposes
  const currentAcademicYear = academicYears.find(y => y.is_current)
  const isEventInCurrentYear = (dateStr: string): boolean => {
    if (!currentAcademicYear) return false
    const parts = currentAcademicYear.year_name.split('-')
    if (parts.length === 2) {
      const sy = parseInt(parts[0])
      const ey = parseInt(parts[1])
      if (!isNaN(sy) && !isNaN(ey)) {
        const min = `${sy}-06-01`
        const max = `${ey}-05-31`
        return dateStr >= min && dateStr <= max
      }
    }
    return false
  }

  // Send notification to all users about new event
  const notifyUsersAboutEvent = async (eventTitle: string, eventDate: string, eventType: string) => {
    try {
      // Get all verified users
      const { data: users } = await supabase
        .from('profiles')
        .select('id')
        .eq('verified', true)

      if (!users || users.length === 0) return

      const formattedDate = new Date(eventDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      })

      const notifications = users.map(user => ({
        user_id: user.id,
        title: 'New School Calendar Event',
        message: `${eventTitle} - ${formattedDate} (${eventType})`,
        type: 'info',
        read: false,
        action_url: '/student/calendar'
      }))

      await supabase.from('notifications').insert(notifications)
    } catch (err) {
      console.error('Error sending event notifications:', err)
    }
  }

  const logAudit = async (action: string, details: any) => {
    try {
      const act = action.includes('CREATE') ? 'INSERT' : action.includes('DELETE') ? 'DELETE' : 'UPDATE'
      await logForensicActivity(act, 'calendar_events', details.dates?.[0] || 'multi-date', null, details)
    } catch (err) {
      console.error('Error logging calendar action:', err)
    }
  }

  const runTargetAction = async () => {
    if (activeTargetDates.length === 0) return

    if (targetAction === 'add') {
      if (!newEventTitle.trim()) return

      const newEvents = activeTargetDates.map((date) => ({
        date,
        title: newEventTitle.trim(),
        type: newEventType,
        academic_year_id: selectedYearId,
      }))

      const { data, error } = await supabase
        .from('calendar_events')
        .insert(newEvents)
        .select()

      if (error) {
        console.error('Error adding events:', error)
        toast.error('Failed to add events')
        return
      }

      await logAudit('CREATE_CALENDAR_EVENT', {
        title: newEventTitle.trim(),
        dates: activeTargetDates,
        type: newEventType,
        academic_year_id: selectedYearId,
      })

      if (data && newEventKeywords.trim()) {
        const keywords = newEventKeywords.split(',').map(k => k.trim()).filter(Boolean)
        const keywordRows = data.flatMap(event =>
          keywords.map(kw => ({ event_id: event.id, keyword: kw.toLowerCase() }))
        )
        const { error: kwError } = await supabase.from('calendar_event_keywords').insert(keywordRows)
        if (kwError) console.error('Error adding keywords:', kwError)
      }

      if (data) {
        setEvents([...events, ...data])

        // Send notifications if events are in current academic year
        let notifiedCount = 0
        for (const event of data) {
          if (isEventInCurrentYear(event.date)) {
            await notifyUsersAboutEvent(event.title, event.date, event.type)
            notifiedCount++
          }
        }
        if (notifiedCount > 0) {
          toast.success(`${notifiedCount} event(s) added and users notified`)
        } else {
          toast.success(`${data.length} event(s) added for future/past academic year`)
        }
      }

      setNewEventTitle('')
      setNewEventKeywords('')
      setSelectedEventIndexes([])
      setIsTargetRunnerOpen(false)
      return
    }

    const eventsToDelete = events.filter((event: CalendarEvent) => activeTargetDates.includes(event.date) && event.id)
    const idsToDelete = eventsToDelete.map((e: CalendarEvent) => e.id as string)

    if (idsToDelete.length > 0) {
      const { error } = await supabase
        .from('calendar_events')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', idsToDelete)

      if (error) {
        console.error('Error soft-deleting events:', error)
        toast.error('Failed to move events to archive')
        return
      }

      await logAudit('DELETE_CALENDAR_EVENT', {
        event_ids: idsToDelete,
        dates: activeTargetDates,
      })
    }

    // Update local state without refetching
    setEvents(events.map(e =>
      activeTargetDates.includes(e.date) && e.academic_year_id === selectedYearId
        ? { ...e, deleted_at: new Date().toISOString() }
        : e
    ))
    toast.success(`${idsToDelete.length} events moved to archive`)
    setSelectedEventIndexes([])
    setIsTargetRunnerOpen(false)
  }

  const restoreEvents = async (ids: string[]) => {
    const { error } = await supabase
      .from('calendar_events')
      .update({ deleted_at: null })
      .in('id', ids)

    if (error) {
      toast.error('Failed to restore events')
      return
    }

    setEvents(events.map(e => ids.includes(e.id || '') ? { ...e, deleted_at: null } : e))
    toast.success('Events restored')
    setSelectedEventIndexes([])
  }

  const handleUpdateEvent = async () => {
    if (!editingEvent?.id) return
    const { error } = await supabase
      .from('calendar_events')
      .update({
        title: editingEvent.title,
        type: editingEvent.type,
      })
      .eq('id', editingEvent.id)

    if (error) {
      toast.error('Failed to update event')
      return
    }

    await logForensicActivity('UPDATE', 'calendar_events', editingEvent.id, null, {
      title: editingEvent.title,
      type: editingEvent.type
    })

    // Save updated keywords
    await supabase.from('calendar_event_keywords').delete().eq('event_id', editingEvent.id)

    const cleanKws = editEventKeywords.split(',').map(k => k.trim()).filter(Boolean)
    if (cleanKws.length > 0) {
      const kwRows = cleanKws.map(kw => ({ event_id: editingEvent.id, keyword: kw.toLowerCase() }))
      const { error: kwError } = await supabase.from('calendar_event_keywords').insert(kwRows)
      if (kwError) console.error('Error adding keywords:', kwError)
    }

    const updatedKeywordsObj = cleanKws.map(kw => ({ keyword: kw.toLowerCase() }))
    const updatedEvent = { ...editingEvent, calendar_event_keywords: updatedKeywordsObj }

    setEvents(events.map(e => e.id === editingEvent.id ? updatedEvent : e))
    setIsEditModalOpen(false)
    setEditingEvent(null)
    toast.success('Event updated')
  }

  const handleExportPDF = async () => {
    // 1. Fetch the exporter's name
    let exporterName = user?.email || 'Admin'
    if (user?.id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', user.id)
        .single()
      if (profile) {
        exporterName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || user.email || 'Admin'
      }
    }

    let filteredEvents = events.filter(e => e.academic_year_id === selectedYearId && !e.deleted_at)

    if (exportScope === 'month') {
      filteredEvents = filteredEvents.filter(e => {
        const d = new Date(e.date)
        return d.getMonth() === exportMonth
      })
    } else if (exportScope === 'range') {
      if (!exportStartDate || !exportEndDate) {
        toast.error('Please select start and end dates')
        return
      }
      filteredEvents = filteredEvents.filter(e => e.date >= exportStartDate && e.date <= exportEndDate)
    }

    if (filteredEvents.length === 0) {
      toast.error('No events found for the selected scope')
      return
    }

    const sortedEvents = [...filteredEvents].sort((a, b) => a.date.localeCompare(b.date))
    const doc = new jsPDF()

    // Title / Header
    doc.setFontSize(18)
    doc.text('DYCI Connect - Academic Calendar', 14, 20)
    doc.setFontSize(10)

    let scopeText = `Academic Year: ${globalAcademicYear}`
    if (exportScope === 'month') {
      scopeText += ` (Month: ${monthOptions[exportMonth]})`
    } else if (exportScope === 'range') {
      scopeText += ` (Range: ${new Date(exportStartDate).toLocaleDateString()} to ${new Date(exportEndDate).toLocaleDateString()})`
    }

    doc.text(scopeText, 14, 28)
    doc.text(`Created by: ${exporterName}`, 14, 34)
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 40)

    // Table Columns
    const tableColumn = ["Date", "Event Title", "Type", "Description"]
    
    // Group events by month
    const eventsByMonth: Record<string, CalendarEvent[]> = {}
    sortedEvents.forEach(ev => {
      const monthName = new Date(ev.date).toLocaleString('en-US', { month: 'long', year: 'numeric' })
      if (!eventsByMonth[monthName]) eventsByMonth[monthName] = []
      eventsByMonth[monthName].push(ev)
    })

    let currentY = 46

    Object.entries(eventsByMonth).forEach(([monthName, monthEvents]) => {
      // Check if we need a page break (e.g. if currentY is near the bottom of the page)
      if (currentY > 250) {
        doc.addPage()
        currentY = 20
      }

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.text(monthName, 14, currentY)
      currentY += 4

      const tableRows = monthEvents.map(ev => {
        const formattedDate = new Date(ev.date).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
        const typeLabel = ev.type.charAt(0).toUpperCase() + ev.type.slice(1)
        return [
          formattedDate,
          ev.title,
          typeLabel,
          ev.description || 'N/A'
        ]
      })

      autoTable(doc, {
         startY: currentY,
         head: [tableColumn],
         body: tableRows,
         theme: 'striped',
         headStyles: { fillColor: [43, 108, 176] }, // DYCI Blue / Nice Blue
         styles: { fontSize: 9, cellPadding: 3 },
         columnStyles: {
           0: { cellWidth: 40 },
           1: { cellWidth: 60 },
           2: { cellWidth: 30 },
           3: { cellWidth: 50 }
         }
      })

      currentY = (doc as any).lastAutoTable.finalY + 12
    })

    doc.save(`DYCI-Calendar-${globalAcademicYear}.pdf`)
    toast.success('Calendar PDF exported successfully')
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans tracking-tight">
      <header className="unified-header">
        <div className="unified-header-content flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="unified-header-title">Academic Calendar</h1>
            <p className="unified-header-subtitle">Institutional Schedule & Event Lifecycle Management</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-blue-900/40 rounded-full px-3 py-1 border border-white/10">
              <span className="text-[9px] font-bold text-blue-200 uppercase tracking-wider">Year:</span>
              <select
                value={selectedYearId}
                onChange={async (e) => {
                  const id = e.target.value
                  setSelectedYearId(id)
                  const year = academicYears.find(y => y.id === id)
                  if (year) {
                    setGlobalAcademicYear(year.year_name)
                    const parts = year.year_name.split('-')
                    if (parts.length === 2) {
                      const sy = parseInt(parts[0])
                      if (!isNaN(sy)) {
                        setCurrentYear(sy)
                        setCurrentMonth(5) // June
                        setSelectedDate(`${sy}-06-01`)
                        setManualTargetDate(`${sy}-06-01`)
                      }
                    }
                  }
                }}
                className="bg-transparent text-white text-[10px] font-bold focus:outline-none cursor-pointer"
              >
                {academicYears.map(year => (
                  <option key={year.id} value={year.id} className="text-slate-900">
                    {year.year_name} {year.is_current ? '(Current)' : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setIsYearModalOpen(true)}
                className="text-[10px] opacity-70 hover:opacity-100 transition-opacity"
                title="Manage Academic Years"
              >
                ⚙️
              </button>
            </div>

            <button
              onClick={() => {
                setExportMonth(currentMonth)
                setExportScope('year')
                setIsExportModalOpen(true)
              }}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border border-white/10 shadow-sm"
            >
              Export PDF
            </button>
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${showArchived ? 'bg-amber-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}
            >
              {showArchived ? 'Active' : 'Archive'}
            </button>
            <button
              onClick={() => {
                setSelectedDates([])
                setManualTargetDate(selectedDate)
                setTargetAction('add')
                setIsTargetRunnerOpen(true)
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-[10px] font-bold uppercase tracking-wider transition-all shadow-md active:scale-95"
            >
              Add Event
            </button>
          </div>
        </div>
      </header>

      <main className="unified-main animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
          {/* CALENDAR */}
          <div className="xl:col-span-3 space-y-4">
            <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
              {/* MONTH BAR */}
              <div className="bg-slate-50/50 border-b border-slate-100 flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-4">
                  <h2 className="text-sm font-semibold text-slate-900 w-40">
                    {monthOptions[currentMonth]} {currentYear}
                  </h2>
                  <div className="flex items-center bg-white rounded-lg border border-slate-200 p-1 shadow-sm">
                    <button
                      onClick={() => {
                        if (currentMonth === 0) {
                          setCurrentMonth(11)
                          setCurrentYear(currentYear - 1)
                        } else {
                          setCurrentMonth(currentMonth - 1)
                        }
                      }}
                      disabled={yearBounds ? currentYear === yearBounds.startYear && currentMonth === 5 : false}
                      className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-slate-600"
                    >
                      <span className="text-lg">←</span>
                    </button>
                    <button
                      onClick={() => {
                        const d = new Date()
                        setCurrentMonth(d.getMonth())
                        setCurrentYear(d.getFullYear())
                      }}
                      className="px-3 text-xs font-bold text-slate-500 hover:text-dyci-blue transition-colors"
                    >
                      Today
                    </button>
                    <button
                      onClick={() => {
                        if (currentMonth === 11) {
                          setCurrentMonth(0)
                          setCurrentYear(currentYear + 1)
                        } else {
                          setCurrentMonth(currentMonth + 1)
                        }
                      }}
                      disabled={yearBounds ? currentYear === yearBounds.endYear && currentMonth === 4 : false}
                      className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-slate-600"
                    >
                      <span className="text-lg">→</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <select
                    className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-dyci-blue/20 outline-none transition-all"
                    value={currentMonth}
                    onChange={(e) => setCurrentMonth(Number(e.target.value))}
                  >
                    {monthOptions.map((month, index) => {
                      if (yearBounds) {
                        if (currentYear === yearBounds.startYear && index < 5) return null
                        if (currentYear === yearBounds.endYear && index > 4) return null
                      }
                      return (
                        <option key={month} value={index}>
                          {month}
                        </option>
                      )
                    })}
                  </select>
                  {yearBounds ? (
                    <select
                      className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-dyci-blue/20 outline-none transition-all"
                      value={currentYear}
                      onChange={(e) => {
                        const newYear = Number(e.target.value)
                        setCurrentYear(newYear)
                        if (newYear === yearBounds.startYear && currentMonth < 5) {
                          setCurrentMonth(5)
                        } else if (newYear === yearBounds.endYear && currentMonth > 4) {
                          setCurrentMonth(4)
                        }
                      }}
                    >
                      <option value={yearBounds.startYear}>{yearBounds.startYear}</option>
                      <option value={yearBounds.endYear}>{yearBounds.endYear}</option>
                    </select>
                  ) : (
                    <input
                      type="number"
                      className="w-24 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-dyci-blue/20 outline-none transition-all"
                      value={currentYear}
                      onChange={(e) => {
                        const parsedYear = Number(e.target.value)
                        if (!Number.isNaN(parsedYear)) setCurrentYear(parsedYear)
                      }}
                    />
                  )}
                </div>
              </div>

              {/* WEEKDAYS */}
              <div className="px-6 grid grid-cols-7 border-b border-slate-50">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="py-3 text-center text-[10px] uppercase font-black tracking-widest text-slate-400">
                    {d}
                  </div>
                ))}
              </div>

              {/* DAYS GRID */}
              <div className="">
                {weeks.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 border-b border-slate-50 last:border-0">
                    {week.map((day, di) => {
                      if (!day) {
                        return (
                          <div
                            key={di}
                            className="h-32 bg-slate-50/50 border-r border-slate-50 last:border-r-0"
                          />
                        )
                      }

                      const iso = `${currentYear}-${(currentMonth + 1)
                        .toString()
                        .padStart(2, '0')}-${day
                          .toString()
                          .padStart(2, '0')}`

                      const dayEvents = getEventsForDate(iso)
                      const isSelected = selectedDate === iso
                      const isMultiPicked = selectedDates.includes(iso)
                      const isInRange = rangeDates.includes(iso)
                      const isToday = new Date().toISOString().slice(0, 10) === iso

                      return (
                        <button
                          key={di}
                          onClick={() => {
                            if (dateLimits.min && dateLimits.max && (iso < dateLimits.min || iso > dateLimits.max)) {
                              toast.error(`Please select the correct academic year from the header to manage dates for ${iso.split('-')[0]}.`)
                              return
                            }
                            setSelectedDate(iso)
                            setManualTargetDate(iso)
                            setSelectedEventIndexes([])
                          }}
                          className={`h-32 border-r border-slate-50 last:border-r-0 text-left px-3 py-3 group relative transition-all ${isSelected ? 'bg-indigo-50/30' : 'bg-white hover:bg-slate-50'
                            } ${!isSelected && (isMultiPicked || isInRange) ? 'bg-indigo-50/20' : ''}`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <span
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold transition-all ${isSelected
                                  ? 'bg-blue-600 text-white shadow-sm'
                                  : isToday
                                    ? 'bg-rose-600 text-white shadow-sm'
                                    : 'text-slate-700'
                                }`}
                            >
                              {day}
                            </span>
                          </div>
                          <div className="space-y-1.5 overflow-hidden">
                            {dayEvents.slice(0, 3).map((ev: CalendarEvent, idx: number) => (
                              <div
                                key={ev.id || idx}
                                className={`px-2 py-1 rounded-md text-[10px] font-bold text-white truncate shadow-sm ${eventBadgeClasses[ev.type]}`}
                              >
                                {ev.title}
                              </div>
                            ))}
                            {dayEvents.length > 3 && (
                              <div className="text-[9px] font-black text-slate-400 pl-1 uppercase tracking-tighter">
                                +{dayEvents.length - 3} more
                              </div>
                            )}
                          </div>

                          {isSelected && (
                            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 pointer-events-none" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* LEGEND - MATCHES DASHBOARD PATTERN */}
            <div className="bg-white rounded-lg border border-slate-100 shadow-sm px-5 py-3">
              <h3 className="text-[11px] text-slate-500 uppercase tracking-wider font-medium mb-3">
                Event Color Key
              </h3>
              <div className="flex flex-wrap gap-6 text-xs text-slate-700">
                {(Object.keys(eventBadgeClasses) as EventType[]).map((type) => (
                  <div key={type} className="flex items-center space-x-2">
                    <span
                      className={`h-3 w-3 rounded-full ${eventBadgeClasses[type]}`}
                    />
                    <span>{legendLabel[type]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT PANEL - MATCHES RECENT ACTIVITY PATTERN */}
          <aside className="space-y-4 sticky top-6 self-start">
            <div className="bg-white rounded-lg border border-slate-100 shadow-sm">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">
                  {new Date(selectedDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                </h2>
                <p className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider">
                  {new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'long' })}
                </p>
              </div>

              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Active Events</p>
                  {selectedEventIndexes.length > 0 && (
                    <button
                      className="text-[10px] font-black uppercase text-red-500 hover:text-red-600 transition-colors"
                      onClick={async () => {
                        const selectedEventsData = events.filter((_: CalendarEvent, index: number) => selectedEventIndexes.includes(index))
                        const idsToDelete = selectedEventsData.filter((e: CalendarEvent) => e.id !== undefined).map((e: CalendarEvent) => e.id as string)

                        if (idsToDelete.length > 0) {
                          const { error } = await supabase
                            .from('calendar_events')
                            .update({ deleted_at: new Date().toISOString() })
                            .in('id', idsToDelete)

                          if (error) {
                            toast.error('Failed to move selected events to archive')
                            return
                          }

                          await logAudit('DELETE_CALENDAR_EVENT', {
                            event_ids: idsToDelete,
                          })
                        }

                        setEvents(
                          events.map((e: CalendarEvent, index: number) =>
                            selectedEventIndexes.includes(index) ? { ...e, deleted_at: new Date().toISOString() } : e
                          )
                        )
                        setSelectedEventIndexes([])
                        toast.success(`${idsToDelete.length} events archived`)
                      }}
                    >
                      Delete ({selectedEventIndexes.length})
                    </button>
                  )}
                </div>

                <div className="space-y-1 divide-y divide-slate-100">
                  {events.filter((e: CalendarEvent) => e.date === selectedDate && e.academic_year_id === selectedYearId && (showArchived ? !!e.deleted_at : !e.deleted_at)).length === 0 ? (
                    <div className="py-8 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
                      <p className="text-xs font-medium text-slate-400">No {showArchived ? 'Archived' : 'Active'} Events</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {showArchived && selectedEventIndexes.length > 0 && (
                        <button
                          onClick={() => {
                            const ids = events.filter((_, i) => selectedEventIndexes.includes(i)).map(e => e.id!)
                            restoreEvents(ids)
                          }}
                          className="w-full py-2 mb-2 bg-emerald-600 text-white text-[10px] font-bold uppercase rounded-2xl hover:bg-emerald-700 transition-colors"
                        >
                          Restore Selected ({selectedEventIndexes.length})
                        </button>
                      )}
                      {events
                        .map((event: CalendarEvent, idx: number) => ({ event, idx }))
                        .filter(({ event }: { event: CalendarEvent }) =>
                          event.date === selectedDate &&
                          event.academic_year_id === selectedYearId &&
                          (showArchived ? !!event.deleted_at : !event.deleted_at)
                        )
                        .map(({ event, idx }: { event: CalendarEvent; idx: number }) => (
                          <div key={event.id || idx} className="group relative flex items-center gap-3 py-3 px-1 transition-all">
                            <input
                              type="checkbox"
                              checked={selectedEventIndexes.includes(idx)}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/10"
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                if (e.target.checked) {
                                  setSelectedEventIndexes((prev: number[]) => [...prev, idx])
                                } else {
                                  setSelectedEventIndexes((prev: number[]) =>
                                    prev.filter((value: number) => value !== idx)
                                  )
                                }
                              }}
                            />
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
                              if (!showArchived) {
                                setEditingEvent(event)
                                const kws = (event.calendar_event_keywords || []).map(k => k.keyword).join(', ')
                                setEditEventKeywords(kws)
                                setIsEditModalOpen(true)
                              }
                            }}>
                              <p className="text-xs font-semibold text-slate-900 truncate">{event.title}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`h-2 w-2 rounded-full ${eventBadgeClasses[event.type]}`} />
                                <span className="text-[10px] text-slate-500 uppercase tracking-tight">{event.type}</span>
                              </div>
                            </div>
                            {showArchived ? (
                              <button
                                className="opacity-0 group-hover:opacity-100 p-1.5 text-emerald-600 hover:text-emerald-700 transition-all rounded-lg hover:bg-emerald-50"
                                onClick={() => restoreEvents([event.id!])}
                                title="Restore"
                              >
                                ⟲
                              </button>
                            ) : (
                              <button
                                className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 transition-all rounded-lg hover:bg-red-50"
                                onClick={async () => {
                                  if (event.id) {
                                    const { error } = await supabase
                                      .from('calendar_events')
                                      .update({ deleted_at: new Date().toISOString() })
                                      .eq('id', event.id)

                                    if (error) {
                                      console.error('Error deleting event:', error)
                                      return
                                    }
                                  }
                                  setEvents(events.map((e, index) => index === idx ? { ...e, deleted_at: new Date().toISOString() } : e))
                                  setSelectedEventIndexes([])
                                  toast.success('Event archived')
                                }}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => {
                    setSelectedDates([])
                    setManualTargetDate(selectedDate)
                    setIsTargetRunnerOpen(true)
                  }}
                  className="w-full py-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg shadow-slate-900/10 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                >
                  Add New Event
                </button>
              </div>
            </div>
            
            {/* MONTHLY SUMMARY CARD (Sync with Student Portal) */}
            <div className="bg-white rounded-lg border border-slate-100 shadow-sm p-5">
              <div className="mb-4 border-b border-slate-100 pb-3">
                <h3 className="text-[11px] text-slate-500 uppercase tracking-wider font-medium mb-1">
                  {monthOptions[currentMonth]} Preview
                </h3>
                <p className="text-[10px] text-slate-400">Monthly breakdown for {globalAcademicYear}</p>
              </div>
              
              <div className="space-y-3 max-h-[400px] overflow-auto pr-2 custom-scrollbar">
                {monthEvents.length === 0 ? (
                  <p className="text-[10px] text-slate-400 italic text-center py-6">No events scheduled</p>
                ) : (
                  monthEvents.map((event, idx) => (
                    <button 
                      key={event.id || idx}
                      onClick={() => {
                        setSelectedDate(event.date);
                        setManualTargetDate(event.date);
                      }}
                      className="w-full text-left group flex items-start gap-3 p-2 hover:bg-slate-50 rounded-lg transition-all border border-transparent hover:border-slate-100"
                    >
                      <div className="flex flex-col items-center justify-center shrink-0 w-9 h-10 bg-slate-50 rounded text-slate-400 group-hover:bg-white group-hover:text-blue-600 transition-colors border border-slate-100">
                        <span className="text-[8px] font-bold uppercase">{new Date(event.date).toLocaleDateString(undefined, { month: 'short' })}</span>
                        <span className="text-xs font-black text-slate-700">{new Date(event.date).getDate()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{event.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${eventBadgeClasses[event.type]}`} />
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">{event.type}</span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>

      </main>

      {isTargetRunnerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in" onClick={() => setIsTargetRunnerOpen(false)} />
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl p-8 relative z-10 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Add Event Tool</h3>
                <p className="text-xs text-slate-500 mt-1">Configure schedule details and keywords</p>
              </div>
              <button
                className="h-10 w-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500 transition-all"
                onClick={() => setIsTargetRunnerOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-100 rounded-2xl">
                <button
                  className={`py-2 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${eventTargetMode === 'multiple' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  onClick={() => setEventTargetMode('multiple')}
                >
                  Individual
                </button>
                <button
                  className={`py-2 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${eventTargetMode === 'range' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  onClick={() => setEventTargetMode('range')}
                >
                  Range
                </button>
              </div>

              {eventTargetMode === 'multiple' ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Date</label>
                    <input
                      type="date"
                      className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-dyci-blue/10 outline-none transition-all"
                      value={manualTargetDate || selectedDate}
                      min={dateLimits.min}
                      max={dateLimits.max}
                      onChange={(e) => {
                        const val = e.target.value
                        if (dateLimits.min && dateLimits.max && (val < dateLimits.min || val > dateLimits.max)) {
                          toast.error(`Date must be within the selected academic year: ${dateLimits.min} to ${dateLimits.max}`)
                          return
                        }
                        setManualTargetDate(val)
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Start Date</label>
                      <input
                        type="date"
                        className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-dyci-blue/10 outline-none"
                        value={rangeStartDate}
                        min={dateLimits.min}
                        max={dateLimits.max}
                        onChange={(e) => {
                          const val = e.target.value
                          if (dateLimits.min && dateLimits.max && (val < dateLimits.min || val > dateLimits.max)) {
                            toast.error(`Start date must be within the selected academic year: ${dateLimits.min} to ${dateLimits.max}`)
                            return
                          }
                          setRangeStartDate(val)
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">End Date</label>
                      <input
                        type="date"
                        className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-dyci-blue/10 outline-none"
                        value={rangeEndDate}
                        min={dateLimits.min}
                        max={dateLimits.max}
                        onChange={(e) => {
                          const val = e.target.value
                          if (dateLimits.min && dateLimits.max && (val < dateLimits.min || val > dateLimits.max)) {
                            toast.error(`End date must be within the selected academic year: ${dateLimits.min} to ${dateLimits.max}`)
                            return
                          }
                          setRangeEndDate(val)
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Action</label>
                  <select
                    className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none"
                    value={targetAction}
                    onChange={(e) => setTargetAction(e.target.value as 'add' | 'delete')}
                  >
                    <option value="add">Add Events</option>
                    <option value="delete">Delete Events</option>
                  </select>
                </div>
                {targetAction === 'add' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Category</label>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none"
                      value={newEventType}
                      onChange={(e) => setNewEventType(e.target.value as EventType)}
                    >
                      <option value="holiday">Holiday</option>
                      <option value="exam">Exam</option>
                      <option value="class">Class</option>
                      <option value="enrollment">Enrollment</option>
                      <option value="event">Event</option>
                    </select>
                  </div>
                )}
              </div>

              {targetAction === 'add' && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Event Description</label>
                  <input
                    type="text"
                    placeholder="e.g. Midterm Examinations"
                    className="w-full bg-slate-50 border border-slate-200 px-4 py-2 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500/10 outline-none transition-all text-slate-900 shadow-sm"
                    value={newEventTitle}
                    onChange={(e) => setNewEventTitle(e.target.value)}
                  />
                </div>
              )}
              {targetAction === 'add' && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Keywords (for Chat Bot)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. holiday, break, no classes"
                      className="flex-1 bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500/20 outline-none transition-all text-slate-900 shadow-sm"
                      value={newEventKeywords}
                      onChange={(e) => setNewEventKeywords(e.target.value)}
                    />
                    <button
                      onClick={async () => {
                        if (!newEventTitle.trim()) {
                          toast.error('Enter an event description first to generate keywords')
                          return
                        }
                        setIsGeneratingKeywords(true)
                        try {
                          const suggestions = await generateKeywords(newEventTitle, `Event Category: ${newEventType}`)
                          if (suggestions && suggestions.length > 0) {
                            const current = newEventKeywords.split(',').map(k => k.trim()).filter(Boolean)
                            const merged = Array.from(new Set([...current, ...suggestions])).join(', ')
                            setNewEventKeywords(merged)
                            toast.success('Keywords generated and appended')
                          } else {
                            toast.error('No keywords generated')
                          }
                        } catch (err: any) {
                          toast.error(err.message || 'Failed to generate keywords')
                        } finally {
                          setIsGeneratingKeywords(false)
                        }
                      }}
                      disabled={isGeneratingKeywords}
                      className="px-4 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-2xl text-xs font-black uppercase tracking-widest border border-blue-100 transition-all disabled:opacity-50"
                    >
                      {isGeneratingKeywords ? '...' : 'AI'}
                    </button>
                  </div>
                  <p className="px-1 text-[9px] text-slate-400 leading-tight">Separate multiple keywords with commas. These help students find events via the support chat.</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-4">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Selected</span>
                  <span className="text-xl font-black text-dyci-blue">{activeTargetDates.length} Days</span>
                </div>
                <button
                  className="px-8 py-4 bg-dyci-blue text-white rounded-2xl text-xs font-bold uppercase tracking-widest transition-all shadow-sm shadow-blue-900/10 hover:bg-blue-800"
                  disabled={activeTargetDates.length === 0}
                  onClick={() => setIsRunConfirmOpen(true)}
                >
                  Run Transformation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Academic Year Management Modal */}
      {isYearModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsYearModalOpen(false)} />
          <div className="w-full max-w-sm bg-white rounded-lg border border-slate-200 shadow-md p-6 relative z-10">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Manage Academic Years</h3>

            <div className="space-y-3 mb-6">
              {academicYears.map(year => (
                <div key={year.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-sm font-semibold text-slate-700">{year.year_name}</span>
                  {year.is_current && (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full uppercase">Current</span>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Add New Year</label>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setShowAddConfirmModal(true)}
                  disabled={isCreatingYear}
                  className="w-full py-3 bg-slate-900 text-white rounded-2xl text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-all shadow-sm shadow-slate-900/10"
                >
                  {isCreatingYear ? '...' : `Add Year ${nextAcademicYearName}`}
                </button>
              </div>
            </div>

            {showAddConfirmModal && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowAddConfirmModal(false)} />
                <div className="w-full max-w-xs bg-white rounded-2xl border border-slate-200 shadow-xl p-5 relative z-10">
                  <h4 className="text-sm font-black text-slate-900 mb-2">Confirm Addition</h4>
                  <p className="text-xs text-slate-600 mb-4">
                    Are you sure you want to add the academic year <strong>{nextAcademicYearName}</strong>?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowAddConfirmModal(false)}
                      className="flex-1 py-2 bg-slate-100 text-slate-600 rounded-2xl text-[11px] font-bold"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        setShowAddConfirmModal(false)
                        setIsCreatingYear(true)
                        const { data, error } = await createAcademicYear(nextAcademicYearName)
                        setIsCreatingYear(false)
                        if (error) toast.error(error)
                        else if (data) {
                          setAcademicYears([...academicYears, data])
                          toast.success(`Academic year ${nextAcademicYearName} added`)
                        }
                      }}
                      className="flex-1 py-2 bg-slate-900 text-white rounded-2xl text-[11px] font-bold hover:bg-slate-800"
                    >
                      Yes, Add
                    </button>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={() => setIsYearModalOpen(false)}
              className="mt-6 w-full py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
      {/* EDIT EVENT MODAL */}
      {isEditModalOpen && editingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsEditModalOpen(false)} />
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl p-8 relative z-10">
            <h3 className="text-xl font-black text-slate-900 tracking-tight mb-6">Edit Event</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Title</label>
                <input
                  type="text"
                  className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none"
                  value={editingEvent.title}
                  onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Type</label>
                <select
                  className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none"
                  value={editingEvent.type}
                  onChange={(e) => setEditingEvent({ ...editingEvent, type: e.target.value as EventType })}
                >
                  <option value="holiday">Holiday</option>
                  <option value="exam">Exam</option>
                  <option value="class">Class</option>
                  <option value="enrollment">Enrollment</option>
                  <option value="event">Event</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Keywords (for Chat Bot)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. holiday, break, no classes"
                    className="flex-1 bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none"
                    value={editEventKeywords}
                    onChange={(e) => setEditEventKeywords(e.target.value)}
                  />
                  <button
                    onClick={async () => {
                      if (!editingEvent.title.trim()) {
                        toast.error('Enter an event description first to generate keywords')
                        return
                      }
                      setIsGeneratingKeywords(true)
                      try {
                        const suggestions = await generateKeywords(editingEvent.title, `Event Category: ${editingEvent.type}`)
                        if (suggestions && suggestions.length > 0) {
                          const current = editEventKeywords.split(',').map(k => k.trim()).filter(Boolean)
                          const merged = Array.from(new Set([...current, ...suggestions])).join(', ')
                          setEditEventKeywords(merged)
                          toast.success('Keywords generated and appended')
                        } else {
                          toast.error('No keywords generated')
                        }
                      } catch (err: any) {
                        toast.error(err.message || 'Failed to generate keywords')
                      } finally {
                        setIsGeneratingKeywords(false)
                      }
                    }}
                    disabled={isGeneratingKeywords}
                    className="px-4 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-2xl text-xs font-black uppercase tracking-widest border border-blue-100 transition-all disabled:opacity-50"
                  >
                    {isGeneratingKeywords ? '...' : 'AI'}
                  </button>
                </div>
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateEvent}
                  className="flex-1 py-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg shadow-slate-900/10"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isRunConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsRunConfirmOpen(false)} />
          <div className="w-full max-w-sm bg-white rounded-lg border border-slate-200 shadow-md p-6 relative z-10 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Confirm Action</h3>
            <p className="text-xs text-slate-500 mb-6">Are you sure you want to run this transformation and update the academic calendar?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setIsRunConfirmOpen(false)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest transition-all"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setIsRunConfirmOpen(false)
                  await runTargetAction()
                }}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-sm"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EXPORT OPTIONS MODAL */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in" onClick={() => setIsExportModalOpen(false)} />
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-6 relative z-10 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Export Calendar Options</h3>
                <p className="text-xs text-slate-500 mt-1">Select scope and settings for PDF export</p>
              </div>
              <button
                className="h-10 w-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500 transition-all"
                onClick={() => setIsExportModalOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Export Scope</label>
                <select
                  className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none"
                  value={exportScope}
                  onChange={(e) => setExportScope(e.target.value as 'year' | 'month' | 'range')}
                >
                  <option value="year">Whole School Year ({globalAcademicYear})</option>
                  <option value="month">Specific Month</option>
                  <option value="range">Custom Date Range</option>
                </select>
              </div>

              {exportScope === 'month' && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Select Month</label>
                  <select
                    className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none"
                    value={exportMonth}
                    onChange={(e) => setExportMonth(Number(e.target.value))}
                  >
                    {monthOptions.map((month, index) => (
                      <option key={month} value={index}>
                        {month}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {exportScope === 'range' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Start Date</label>
                    <input
                      type="date"
                      className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-dyci-blue/10 outline-none"
                      value={exportStartDate}
                      min={dateLimits.min}
                      max={dateLimits.max}
                      onChange={(e) => setExportStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">End Date</label>
                    <input
                      type="date"
                      className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-dyci-blue/10 outline-none"
                      value={exportEndDate}
                      min={dateLimits.min}
                      max={dateLimits.max}
                      onChange={(e) => setExportEndDate(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <button
                  onClick={() => setIsExportModalOpen(false)}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setIsExportModalOpen(false)
                    await handleExportPDF()
                  }}
                  className="flex-1 py-3 bg-blue-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-colors shadow-md"
                >
                  Export PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Calendar
