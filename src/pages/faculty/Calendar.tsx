import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'

type EventType = 'holiday' | 'exam' | 'class' | 'enrollment' | 'event'

interface CalendarEvent {
  id?: string
  date: string
  title: string
  type: EventType
  description?: string
  academic_year_id: string
}

const FacultyCalendar: React.FC = () => {
  const { user } = useAuth()
  const today = new Date()
  const [selectedDate, setSelectedDate] = useState<string>(today.toISOString().slice(0, 10))
  const [currentMonth, setCurrentMonth] = useState<number>(today.getMonth())
  const [currentYear, setCurrentYear] = useState<number>(today.getFullYear())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [yearBounds, setYearBounds] = useState<{ startYear: number; endYear: number } | null>(null)

  const [isLocked, setIsLocked] = useState(true)
  const [lockReason, setLockReason] = useState<'conforme' | 'publication' | 'loading'>('loading')

  const [academicYears, setAcademicYears] = useState<any[]>([])
  const [selectedYearId, setSelectedYearId] = useState<string>('')
  const [systemActiveYearId, setSystemActiveYearId] = useState<string>('')

  // 1. Initial check (Fetch Academic Years and current year config)
  useEffect(() => {
    const initializeCalendar = async () => {
      try {
        const [{ data: settings }, { data: years }] = await Promise.all([
          supabase.from('school_settings').select('current_academic_year_id').single(),
          supabase.from('academic_years').select('*').order('year_name', { ascending: false })
        ])

        const systemYearId = settings?.current_academic_year_id || ''
        setSystemActiveYearId(systemYearId)

        if (years) {
          setAcademicYears(years)
          const current = years.find(y => y.id === systemYearId) || years.find(y => y.is_current)
          if (current) {
            setSelectedYearId(current.id)
          } else if (years.length > 0) {
            setSelectedYearId(years[0].id)
          }
        }
      } catch (err) {
        console.error('Error initializing faculty calendar:', err)
      }
    }
    initializeCalendar()
  }, [user])

  // 2. Load events and bounds whenever selectedYearId changes
  useEffect(() => {
    const loadEventsForYear = async () => {
      if (!selectedYearId) return

      try {
        // A. Handbook Gating for the selected year
        const { data: handbooks } = await supabase
          .from('handbooks')
          .select('id')
          .eq('academic_year_id', selectedYearId)
          .eq('status', 'published')
          .limit(1)

        if (!handbooks || handbooks.length === 0) {
          setLockReason('publication')
          setIsLocked(true)
          return
        }

        setIsLocked(false)

        // B. Fetch active year name to set bounds
        const { data: activeYear } = await supabase
          .from('academic_years')
          .select('year_name')
          .eq('id', selectedYearId)
          .single()

        if (activeYear) {
          const parts = activeYear.year_name.split('-')
          if (parts.length === 2) {
            const sy = parseInt(parts[0])
            const ey = parseInt(parts[1])
            if (!isNaN(sy) && !isNaN(ey)) {
              setYearBounds({ startYear: sy, endYear: ey })
              
              // Set view to June of selected startYear
              setCurrentMonth(5) // June
              setCurrentYear(sy)
              setSelectedDate(`${sy}-06-01`)
            }
          }
        }

        // C. Fetch events for the selected year
        const { data: eventsData, error } = await supabase
          .from('calendar_events')
          .select('*')
          .eq('academic_year_id', selectedYearId)
          .is('deleted_at', null)

        if (error) {
          console.error('Error fetching calendar events:', error)
        } else if (eventsData) {
          setEvents(eventsData)
        }
      } catch (err) {
        console.error('Error loading events:', err)
      }
    }

    loadEventsForYear()
  }, [selectedYearId])

  const getEventsForDate = (iso: string) =>
    events.filter((e: CalendarEvent) => e.date === iso)



  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay()

  const weeks: Array<Array<number | null>> = []
  let currentDay = 1 - firstDayOfWeek
  while (currentDay <= daysInMonth) {
    const week: Array<number | null> = []
    for (let i = 0; i < 7; i++) {
      week.push(currentDay < 1 || currentDay > daysInMonth ? null : currentDay)
      currentDay++
    }
    weeks.push(week)
  }

  const prevMonth = () => {
    if (yearBounds && currentYear === yearBounds.startYear && currentMonth === 5) {
      return
    }
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear((y: number) => y - 1)
    } else {
      setCurrentMonth((m: number) => m - 1)
    }
  }

  const nextMonth = () => {
    if (yearBounds && currentYear === yearBounds.endYear && currentMonth === 4) {
      return
    }
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear((y: number) => y + 1)
    } else {
      setCurrentMonth((m: number) => m + 1)
    }
  }

  const selectedEvents = getEventsForDate(selectedDate)
  const monthEvents = useMemo(() => {
    return events
      .filter((e) => {
        const d = new Date(e.date)
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [events, currentMonth, currentYear])

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="unified-header">
        <div className="unified-header-content flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="unified-header-title">Academic Calendar</h1>
            <p className="unified-header-subtitle">
              View academic milestones and manage your teaching schedule.
            </p>
          </div>
          {academicYears.length > 0 && (
            <div className="flex items-center gap-2 bg-blue-900/40 rounded-full px-3 py-1 border border-white/10">
              <span className="text-[9px] font-bold text-blue-200 uppercase tracking-wider">Year:</span>
              <select
                value={selectedYearId}
                onChange={async (e) => {
                  setSelectedYearId(e.target.value)
                }}
                className="bg-transparent text-white text-[10px] font-bold focus:outline-none cursor-pointer"
              >
                {academicYears.map(year => (
                  <option key={year.id} value={year.id} className="text-slate-900">
                    {year.year_name} {year.id === systemActiveYearId ? '(Current)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </header>

      <main className="unified-main">
         {isLocked ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-12 text-center max-w-2xl mx-auto my-12 animate-in fade-in slide-in-from-bottom-4">
             <div className="h-20 w-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-4xl">🔒</span>
             </div>
             <h2 className="text-2xl font-bold text-slate-900 mb-4">Calendar Temporarily Locked</h2>
             <p className="text-slate-600 mb-8 leading-relaxed">
               {lockReason === 'conforme' 
                ? "To view the academic calendar and manage your schedule, you must first review and accept the latest Conforme (Faculty/Staff Regulations) for this academic year."
                : lockReason === 'publication'
                ? "The official academic calendar for this year hasn't been officially published by the administration yet. Please check back soon!"
                : "Checking your access permissions..."
               }
             </p>
             {lockReason === 'conforme' && (
               <a 
                 href="/faculty/conforme"
                 className="inline-flex items-center px-8 py-4 bg-blue-600 text-white rounded-2xl text-sm font-bold uppercase tracking-wider shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"
               >
                 Go to Conforme
               </a>
             )}
          </div>
        ) : (
          <div className="space-y-4">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* CALENDAR */}
          <div className="xl:col-span-3 space-y-4">
            <div className="bg-white rounded-2xl shadow-md border border-slate-100 overflow-hidden">
              {/* MONTH BAR */}
              <div className="bg-slate-50 border-b border-slate-100 flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-lg font-bold text-slate-800 w-48 transition-all">
                    {monthNames[currentMonth]} {currentYear}
                  </h2>
                  <div className="flex items-center bg-white rounded-lg border border-slate-200 p-1 shadow-sm">
                    <button
                      onClick={prevMonth}
                      disabled={yearBounds ? currentYear === yearBounds.startYear && currentMonth === 5 : false}
                      className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-slate-600"
                    >
                      <span className="text-lg">←</span>
                    </button>
                    <button
                      onClick={() => {
                        const d = new Date()
                        if (yearBounds) {
                          const startBound = new Date(yearBounds.startYear, 5, 1)
                          const endBound = new Date(yearBounds.endYear, 4, 31)
                          if (d >= startBound && d <= endBound) {
                            setCurrentMonth(d.getMonth())
                            setCurrentYear(d.getFullYear())
                          } else {
                            setCurrentMonth(5) // June
                            setCurrentYear(yearBounds.startYear)
                          }
                        } else {
                          setCurrentMonth(d.getMonth())
                          setCurrentYear(d.getFullYear())
                        }
                      }}
                      className="px-3 text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors"
                    >
                      Today
                    </button>
                    <button
                      onClick={nextMonth}
                      disabled={yearBounds ? currentYear === yearBounds.endYear && currentMonth === 4 : false}
                      className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-slate-600"
                    >
                      <span className="text-lg">→</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <select
                    className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-600/20 outline-none transition-all"
                    value={currentMonth}
                    onChange={(e) => {
                      const newMonth = Number(e.target.value)
                      setCurrentMonth(newMonth)
                    }}
                  >
                    {monthNames.map((month, index) => {
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
                      className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-600/20 outline-none transition-all"
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
                      className="w-24 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-600/20 outline-none transition-all"
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
                  <div key={d} className="py-3 text-center text-[10px] uppercase font-bold tracking-wider text-slate-400">
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
                      const isToday = new Date().toISOString().slice(0, 10) === iso

                      return (
                        <button
                          key={di}
                          onClick={() => setSelectedDate(iso)}
                          className={`h-32 border-r border-slate-50 last:border-r-0 text-left px-3 py-3 group relative transition-all ${
                            isSelected ? 'bg-indigo-50/30' : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <span
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-2xl text-sm font-bold transition-all ${
                                isSelected
                                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 scale-110'
                                  : isToday 
                                    ? 'bg-rose-600 text-white shadow-md shadow-rose-500/30'
                                    : 'text-slate-700 group-hover:text-blue-600'
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
                              <div className="text-[9px] font-bold text-slate-400 pl-1 uppercase tracking-tighter">
                                +{dayEvents.length - 3} more
                              </div>
                            )}
                          </div>
                          
                          {isSelected && (
                             <div className="absolute inset-0 border-2 border-blue-600 rounded-none pointer-events-none" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* LEGEND */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                <h3 className="text-xs uppercase font-bold text-slate-400 tracking-wider mb-4">
                  Event Color Key
                </h3>
                <div className="flex flex-wrap gap-8">
                  {(Object.keys(eventBadgeClasses) as EventType[]).map((type) => (
                    <div key={type} className="flex items-center space-x-3 group cursor-default">
                      <span
                        className={`h-4 w-4 rounded-full shadow-inner ring-4 ring-slate-50 transition-transform group-hover:scale-125 ${eventBadgeClasses[type]}`}
                      />
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-tight">{legendLabel[type]}</span>
                    </div>
                  ))}
                </div>
            </div>
          </div>

          {/* RIGHT PANEL - SELECTED DATE */}
          <aside className="space-y-6 sticky top-6 self-start">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-6">
              <div className="mb-6 border-b border-slate-100 pb-6">
                <h3 className="text-sm uppercase font-bold text-slate-400 tracking-wider mb-1">Schedule Details</h3>
                <p className="text-2xl font-bold text-slate-900 leading-tight">
                  {new Date(selectedDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </p>
                <p className="text-xs font-medium text-slate-500 mt-1">{new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'long' })}</p>
              </div>

              <div className="space-y-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Events</p>

                <div className="space-y-3 max-h-[400px] overflow-auto pr-2 custom-scrollbar">
                  {selectedEvents.length === 0 ? (
                    <div className="py-12 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 px-4">
                      <div className="h-10 w-10 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                         <span className="text-slate-400">📅</span>
                      </div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-tight">No Events Scheduled</p>
                      <p className="text-[10px] text-slate-400 mt-1">Check another date for activities</p>
                    </div>
                  ) : (
                    selectedEvents.map((event, idx) => (
                        <div key={event.id || idx} className="group relative flex flex-col gap-1 p-4 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded-2xl transition-all shadow-sm">
                          <div className="flex items-center gap-2">
                             <span className={`h-2 w-2 rounded-full ${eventBadgeClasses[event.type]}`} />
                             <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{event.type}</span>
                          </div>
                          <p className="text-sm font-bold text-slate-900 leading-snug">{event.title}</p>
                          {event.description && (
                             <p className="text-xs text-slate-500 mt-1">{event.description}</p>
                          )}
                        </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* MONTHLY SUMMARY CARD (Sync with Portal) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-6">
              <div className="mb-4 border-b border-slate-100 pb-4">
                <h3 className="text-sm uppercase font-bold text-slate-400 tracking-wider mb-1">
                  {monthNames[currentMonth]} Preview
                </h3>
                <p className="text-[10px] text-slate-500">Upcoming activities for this month</p>
              </div>
              
              <div className="space-y-3 max-h-[350px] overflow-auto pr-2 custom-scrollbar">
                {monthEvents.length === 0 ? (
                  <p className="text-[10px] text-slate-400 italic text-center py-6">No events scheduled for {monthNames[currentMonth]}</p>
                ) : (
                  monthEvents.map((event, idx) => (
                    <button 
                      key={event.id || idx}
                      onClick={() => {
                        setSelectedDate(event.date);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="w-full text-left group flex items-start gap-3 p-3 hover:bg-slate-50 rounded-2xl transition-all border border-transparent hover:border-slate-100"
                    >
                      <div className="flex flex-col items-center justify-center shrink-0 w-10 h-10 bg-slate-50 rounded-lg group-hover:bg-white transition-colors border border-slate-100">
                        <span className="text-[8px] font-bold text-slate-400 uppercase">{new Date(event.date).toLocaleDateString(undefined, { month: 'short' })}</span>
                        <span className="text-sm font-black text-slate-700">{new Date(event.date).getDate()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate leading-snug">{event.title}</p>
                        <div className="flex items-center gap-1.5 mt-1">
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
          </div>
        )}
      </main>
    </div>
  )
}

export default FacultyCalendar