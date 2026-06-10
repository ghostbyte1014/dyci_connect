import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  FaSpinner,
  FaBook,
  FaArrowLeft,
  FaCalendarAlt,
  FaBold,
  FaItalic,
  FaUnderline,
  FaListUl,
  FaListOl,
  FaHistory,
  FaCheckDouble,
} from 'react-icons/fa'
import { DashboardSkeleton } from '../../components/ui/Skeleton'
import toast from 'react-hot-toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import {
  fetchApproverQueue,
  fetchHandbooks,
  fetchSectionAuditTrail,
  fetchHandbookApprovalMonitor,
  fetchHandbookApprovals,
  approveHandbookAtLevel,
  saveSectionEdit,
  approveSectionAtLevel,
  rejectSectionAtLevel,
  derivePositionFromProfile,
  positionToLevel,
  levelLabel,
  fetchCollegeOffices,
  type CollegeOffice,
  type ApproverPosition,
  type Handbook,
  type AuditTrailEntry,
  type HandbookApprovalMonitorRow,
} from '../../lib/api/handbookWorkflow'
import { type AcademicYear, fetchAcademicYears } from '../../lib/api/settings'

function stripHtml(html: string): string {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.textContent || d.innerText || ''
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border border-slate-200',
  dept_review: 'bg-blue-50 text-blue-700 border border-blue-200',
  pending_approval: 'bg-amber-50 text-amber-700 border border-amber-200',
  published: 'bg-emerald-50 text-emerald-700 border border-emerald-300 font-bold',
  rejected: 'bg-rose-50 text-rose-700 border border-rose-200',
}

const ProgressBar: React.FC<{ currentLevel: number }> = ({ currentLevel }) => {
  const levels = [
    { n: 1, label: 'Academic Admin Draft' },
    { n: 2, label: 'Departmental Review' },
  ]
  return (
    <div className="flex items-center gap-0.5">
      {levels.map((l, i) => {
        const done = currentLevel > l.n
        const active = currentLevel === l.n
        return (
          <React.Fragment key={l.n}>
            {i > 0 && <div className={`h-0.5 w-3 ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
            <div className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{l.label}</div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

type SectionItem = {
  id: string
  title: string
  content: string
  legacy_content: string | null
  status: string
  handbook_id: string
  sort_order: number
  current_level: number
  change_reason: string | null
  keywords: string[]
}

type PageView = 'list' | 'detail' | 'monitor'
type ApprovalTab = 'pending' | 'approved'

const HandbookApprovals: React.FC = () => {
  const [view, setView] = useState<PageView>('list')
  const [activeTab, setActiveTab] = useState<ApprovalTab>('pending')
  const [monitorData, setMonitorData] = useState<HandbookApprovalMonitorRow[]>([])
  const [handbookApprovals, setHandbookApprovals] = useState<Record<string, { approved: boolean; approver_position: string; approved_at: string | null }>>({})
  const [viewingSectionContent, setViewingSectionContent] = useState<{ title: string; content: string } | null>(null)
  const [handbookApproving, setHandbookApproving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [position, setPosition] = useState<ApproverPosition | null>(null)
  const [userLevel, setUserLevel] = useState(0)
  const [handbooks, setHandbooks] = useState<Handbook[]>([])
  const [sections, setSections] = useState<SectionItem[]>([])
  const [approvedSectionIds, setApprovedSectionIds] = useState<Set<string>>(new Set())
  const [activeHandbook, setActiveHandbook] = useState<Handbook | null>(null)
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [changeReason, setChangeReason] = useState('')
  const [commentBySection, setCommentBySection] = useState<Record<string, string>>({})
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
  const [collegeOffices, setCollegeOffices] = useState<CollegeOffice[]>([])
  const [selectedYearId, setSelectedYearId] = useState<string>('')
  const [currentPage, setCurrentPage] = useState(1)
  const ITEMS_PER_PAGE = 5
  const editorRef = useRef<HTMLDivElement>(null)

  const loadContext = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) { setLoading(false); setPosition(null); return }

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    const derived = derivePositionFromProfile(profile ?? {})

    if (!derived) { setPosition(null); setSections([]); setLoading(false); return }

    setPosition(derived)
    const lvl = positionToLevel(derived)
    setUserLevel(lvl)

    // Fetch user's existing approvals to separate approved from pending
    const { data: myApprovals } = await supabase
      .from('handbook_approvals')
      .select('handbook_section_id')
      .eq('approver_user_id', userId)
      .eq('decision', 'approved')

    const approvedIds = new Set((myApprovals || []).map(a => a.handbook_section_id))
    setApprovedSectionIds(approvedIds)

    // For L3 (Executive) users, fetch monitor data to show L2 approval progress
    if (lvl === 3) {
      const activeYearId = selectedYearId || (academicYears.length > 0 ? academicYears[0].id : null)

      const { data: allHandbooks } = await fetchHandbooks()
      const filteredHandbooks = (allHandbooks ?? []).filter(h =>
        !activeYearId || h.academic_year_id === activeYearId
      )

      setHandbooks(filteredHandbooks)

      if (filteredHandbooks.length > 0) {
        const hb = filteredHandbooks[0]
        const [{ data: monitor }, { data: hbApprovals }] = await Promise.all([
          fetchHandbookApprovalMonitor(hb.id),
          fetchHandbookApprovals(hb.id)
        ])

        setMonitorData(monitor ?? [])
        const approvalsMap: Record<string, { approved: boolean; approver_position: string; approved_at: string | null }> = {}
          ; (hbApprovals || []).forEach((a: any) => {
            approvalsMap[a.approver_position] = {
              approved: a.decision === 'approved',
              approver_position: a.approver_position,
              approved_at: a.approved_at
            }
          })
        setHandbookApprovals(approvalsMap)
      } else {
        setMonitorData([])
        setHandbookApprovals({})
      }

      setLoading(false)
      return
    }

    const [queueRes, handbooksRes] = await Promise.all([fetchApproverQueue(derived), fetchHandbooks()])
    if (queueRes.error) toast.error(`Approvals: ${queueRes.error}`)

    // For Academic Admin, also fetch handbook L3 approvals to show executive approval banner
    if (lvl === 1 && handbooksRes.data && handbooksRes.data.length > 0) {
      const { data: hbApprovals } = await fetchHandbookApprovals(handbooksRes.data[0].id)
      console.log('[DEBUG] Handbook approvals fetched:', hbApprovals)
      const approvalsMap: Record<string, { approved: boolean; approver_position: string; approved_at: string | null }> = {}
        ; (hbApprovals || []).forEach((a: any) => {
          approvalsMap[a.approver_position] = {
            approved: a.decision === 'approved',
            approver_position: a.approver_position,
            approved_at: a.approved_at
          }
        })
      console.log('[DEBUG] Approvals map:', approvalsMap)
      setHandbookApprovals(approvalsMap)
    }

    setHandbooks(handbooksRes.data ?? [])

    // Normalize queue data into SectionItem[]
    const raw = queueRes.data ?? []
    const items: SectionItem[] = []

    if (lvl === 2) {
      for (const row of raw as any[]) {
        const rawSec = (row as any).handbook_sections
        const sec = Array.isArray(rawSec) ? rawSec[0] : rawSec
        if (!sec) continue
        const hasApproved = approvedIds.has(sec.id)
        if (!hasApproved && sec.current_level !== 2) continue
        const kws = (sec.handbook_keywords || []).map((k: any) => k.keyword)
        items.push({ ...sec, keywords: kws } as SectionItem)
      }
    } else {
      for (const row of raw as any[]) {
        const sec = (row as any).handbook_sections
        if (!sec) continue
        const hasApproved = approvedIds.has(sec.id)
        if (!hasApproved && sec.current_level !== lvl) continue
        const kws = (sec.handbook_keywords || []).map((k: any) => k.keyword)
        items.push({ ...sec, keywords: kws } as SectionItem)
      }
    }
    setSections(items)
    setLoading(false)
  }, [academicYears, selectedYearId, fetchHandbookApprovals, fetchHandbookApprovalMonitor])

  useEffect(() => {
    async function initData() {
      const [yearsRes, officesRes] = await Promise.all([
        fetchAcademicYears(),
        fetchCollegeOffices()
      ])
      if (yearsRes.data && yearsRes.data.length > 0) {
        setAcademicYears(yearsRes.data)
        setSelectedYearId(yearsRes.data[0].id)
      }
      if (officesRes.data) {
        setCollegeOffices(officesRes.data)
      }
    }
    initData()
  }, [])

  useEffect(() => { loadContext() }, [loadContext])

  // Sync editor ref when editing section changes
  useEffect(() => {
    if (editorRef.current && editingSectionId) {
      editorRef.current.innerHTML = editContent
    }
  }, [editingSectionId])

  const sectionsByHandbook = useCallback(() => {
    const map: Record<string, SectionItem[]> = {}
    for (const s of sections) {
      if (!map[s.handbook_id]) map[s.handbook_id] = []
      if (!map[s.handbook_id].some((x) => x.id === s.id)) map[s.handbook_id].push(s)
    }
    for (const hid of Object.keys(map)) map[hid].sort((a, b) => a.sort_order - b.sort_order)
    return map
  }, [sections])

  // Filter sections by approval status
  const pendingSections = useCallback(() => {
    return sections.filter(s => !approvedSectionIds.has(s.id))
  }, [sections, approvedSectionIds])

  const approvedSections = useCallback(() => {
    return sections.filter(s => approvedSectionIds.has(s.id))
  }, [sections, approvedSectionIds])

  const handbooksWithSections = useCallback(() => {
    const currentSections = activeTab === 'pending' ? pendingSections() : approvedSections()
    const map: Record<string, SectionItem[]> = {}
    for (const s of currentSections) {
      if (!map[s.handbook_id]) map[s.handbook_id] = []
      if (!map[s.handbook_id].some((x) => x.id === s.id)) map[s.handbook_id].push(s)
    }
    for (const hid of Object.keys(map)) map[hid].sort((a, b) => a.sort_order - b.sort_order)

    const result = handbooks.filter((h) => map[h.id] && map[h.id].length > 0)
    for (const hid of Object.keys(map)) {
      if (!result.some((h) => h.id === hid)) {
        result.push({
          id: hid,
          title: 'Institutional Handbook',
          academic_year_id: '',
          status: 'draft',
          created_at: '',
          updated_at: '',
          publish_at: null,
        } as any)
      }
    }
    return result
  }, [handbooks, activeTab, pendingSections, approvedSections])

  const openHandbook = (handbook: Handbook) => {
    setActiveHandbook(handbook)
    setEditingSectionId(null)
    setCurrentPage(1)
    setView('detail')
  }

  const startEditing = (sec: SectionItem) => {
    setEditingSectionId(sec.id)
    setEditContent(sec.content)
    setChangeReason('')
  }

  const handleEditorInput = () => {
    if (editorRef.current) setEditContent(editorRef.current.innerHTML)
  }

  const execCmd = (command: string, value?: string) => {
    document.execCommand(command, false, value)
    editorRef.current?.focus()
    handleEditorInput()
  }

  const handleL2SaveAndApprove = async (sectionId: string) => {
    if (!position) return
    if (!changeReason.trim()) { toast.error('Change reason is required.'); return }
    setSavingId(sectionId)
    const saveRes = await saveSectionEdit(sectionId, editContent, changeReason)
    if (saveRes.error) { setSavingId(null); toast.error(saveRes.error); return }
    const { error } = await approveSectionAtLevel(sectionId, position, 2)
    setSavingId(null)
    if (error) { toast.error(error); return }
    toast.success('Section approved.')
    setEditingSectionId(null)
    await loadContext()
  }

  const handleApprove = async (sectionId: string) => {
    if (!position) return
    setSavingId(sectionId)
    const { error } = await approveSectionAtLevel(sectionId, position, userLevel, commentBySection[sectionId])
    setSavingId(null)
    if (error) { toast.error(error); return }
    toast.success(`Section approved at ${levelLabel(userLevel)}.`)
    setCommentBySection((p) => ({ ...p, [sectionId]: '' }))
    await loadContext()
  }

  const handleReject = async (sectionId: string) => {
    if (!position) return
    const comment = commentBySection[sectionId]
    if (!comment?.trim()) { toast.error('A comment is required when rejecting.'); return }
    setSavingId(sectionId)
    const { error } = await rejectSectionAtLevel(sectionId, position, userLevel, comment)
    setSavingId(null)
    if (error) { toast.error(error); return }
    toast.success('Section rejected and returned to admin.')
    setCommentBySection((p) => ({ ...p, [sectionId]: '' }))
    await loadContext()
  }

  const handleApproveHandbook = async () => {
    if (!position || handbooks.length === 0) return

    // Check if all sections are fully approved by L2
    const allSectionsApproved = monitorData.every(row => {
      const approvedPositions = new Set(row.approvals.filter(a => a.decision === 'approved').map(a => a.position))
      return row.required_positions.every(p => approvedPositions.has(p))
    })

    if (!allSectionsApproved) {
      toast.error('Cannot approve handbook. All sections must be approved by all required departments first.')
      return
    }

    const handbookId = handbooks[0].id
    setHandbookApproving(true)
    const { error, autoPublished } = (await approveHandbookAtLevel(handbookId, position)) as any
    setHandbookApproving(false)

    if (error) {
      toast.error(`Failed to approve handbook: ${error}`)
      return
    }

    if (autoPublished) {
      toast.success('Handbook approved and published automatically!')
    } else {
      toast.success('Handbook approved! Academic Admin can now publish.')
    }
    await loadContext()
  }

  const handleViewSectionContent = async (sectionId: string, title: string) => {
    const { data, error } = await supabase
      .from('handbook_sections')
      .select('content')
      .eq('id', sectionId)
      .maybeSingle()

    if (error || !data) {
      toast.error('Failed to load section content')
      return
    }

    setViewingSectionContent({ title, content: data.content || '' })
  }

  const handleBulkApprove = async () => {
    if (!position || !activeHandbook) return
    const sectionsToApprove = sectionsByHandbook()[activeHandbook.id] ?? []
    if (sectionsToApprove.length === 0) return
    setBulkSaving(true)
    let errors = 0
    for (const sec of sectionsToApprove) {
      const { error } = await approveSectionAtLevel(sec.id, position, userLevel)
      if (error) errors++
    }
    setBulkSaving(false)
    if (errors > 0) toast.error(`${errors} sections failed to approve.`)
    else toast.success(`Approved all ${sectionsToApprove.length} pending sections.`)
    await loadContext()
  }

  if (!isSupabaseConfigured) return <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-sm text-slate-600">Supabase not configured.</div>

  // ── L3 MONITOR VIEW (for President/VP - always show this instead of list) ─────────────────
  if (userLevel === 3) {
    const approvedCount = monitorData.filter(row => {
      const approvedPositions = new Set(row.approvals.filter(a => a.decision === 'approved').map(a => a.position))
      return row.required_positions.every(p => approvedPositions.has(p))
    }).length
    const pendingCount = monitorData.length - approvedCount
    const allSectionsFullyApproved = monitorData.length > 0 && approvedCount === monitorData.length

    // Check if current executive has already approved the handbook
    const hasApprovedHandbook = position ? handbookApprovals[position]?.approved : false
    const handbookFullyApproved = Object.values(handbookApprovals).some(a => a.approved)

    return (
      <>
      <header className="unified-header">
        <div className="unified-header-content">
          <h1 className="unified-header-title">Approval Monitor</h1>
          <p className="unified-header-subtitle">Oversee department approval progress across all handbooks</p>
        </div>
      </header>

      <main className="unified-main">
          {/* Handbook Status Banner */}
          {handbookFullyApproved && (
            <div className="mb-6 bg-emerald-100 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-emerald-200 flex items-center justify-center">
                  <FaCheckDouble className="h-5 w-5 text-emerald-700" />
                </div>
                <div>
                  <p className="font-semibold text-emerald-800">Handbook Approved by Executive</p>
                  <p className="text-sm text-emerald-600">Academic Admin can now publish this handbook</p>
                </div>
              </div>
            </div>
          )}

          {/* Progress Overview */}
          <div className="mb-6 grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{monitorData.length}</p>
              <p className="text-xs text-slate-500">Total Sections</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{approvedCount}</p>
              <p className="text-xs text-slate-500">Approved by Department</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
              <p className="text-xs text-slate-500">Pending Department Review</p>
            </div>
          </div>

          {/* Approve Handbook Button */}
          {handbooks.length > 0 && (
            <div className="mb-6 bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">{handbooks[0].title}</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    {handbooks[0].status === 'published'
                      ? 'This handbook is already published.'
                      : allSectionsFullyApproved
                      ? 'All sections are approved. Ready for executive approval.'
                      : `${pendingCount} sections still pending department review.`}
                  </p>
                </div>
                {handbooks[0].status === 'published' ? (
                  <span className="px-4 py-2 rounded-lg font-bold text-sm bg-emerald-100 text-emerald-700 select-none">
                    Published
                  </span>
                ) : (
                  <button
                    onClick={handleApproveHandbook}
                    disabled={!allSectionsFullyApproved || handbookApproving}
                    className={`px-6 py-3 rounded-lg font-semibold text-sm transition-all ${allSectionsFullyApproved
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      }`}
                  >
                    {handbookApproving ? (
                      <span className="flex items-center gap-2"><FaSpinner className="animate-spin" /> Approving...</span>
                    ) : hasApprovedHandbook ? (
                      'Already Approved'
                    ) : (
                      'Approve Handbook'
                    )}
                  </button>
                )}
              </div>
              {!allSectionsFullyApproved && handbooks[0].status !== 'published' && (
                <p className="mt-3 text-xs text-amber-600 bg-amber-50 p-2 rounded-lg">
                  ⚠️ All sections must be fully approved by all required departments before you can approve this handbook.
                </p>
              )}
            </div>
          )}

          {loading && <DashboardSkeleton />}

          {!loading && monitorData.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl bg-white">
              <FaBook className="h-12 w-12 mb-4 text-slate-200" />
              <p className="text-sm font-medium text-slate-600 mb-1">No sections to monitor.</p>
              <p className="text-xs text-slate-400">Sections will appear here when they are submitted for departmental review.</p>
            </div>
          )}
          {!loading && userLevel === 3 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-slate-900">Academic Year View</h2>
                <p className="text-xs text-slate-500">Select a school year to monitor its approval progress.</p>
              </div>

              <div className="relative group min-w-[200px]">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <FaCalendarAlt className="text-emerald-500 text-xs" />
                </div>
                <select
                  value={selectedYearId}
                  onChange={(e) => setSelectedYearId(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-2xl text-sm font-semibold text-slate-700 shadow-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all appearance-none cursor-pointer hover:border-emerald-300"
                >
                  {academicYears.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.year_name} {y.is_current ? '(Current)' : ''}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                  <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          )}

          {!loading && userLevel === 3 && monitorData.length === 0 && (
            <div className="mt-8 flex flex-col items-center justify-center py-20 text-slate-400 border-2 border-dashed border-emerald-100 rounded-2xl bg-emerald-50/20">
              <div className="h-16 w-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                <FaCheckDouble className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-1">Process Complete!</h3>
              <p className="text-sm text-slate-600 mb-4 max-w-xs text-center">
                No handbooks for {academicYears.find(y => y.id === selectedYearId)?.year_name || 'selected year'} currently require your review.
              </p>
              <div className="px-4 py-2 bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider rounded-lg">
                Workspace Clean
              </div>
            </div>
          )}

          {!loading && monitorData.length > 0 && (
            <div className="space-y-3">
              {monitorData.map((row) => {
                const approvedPositions = new Set(row.approvals.filter(a => a.decision === 'approved').map(a => a.position))
                const requiredCount = row.required_positions.length
                const approvedCount = row.required_positions.filter(p => approvedPositions.has(p)).length
                const isFullyApproved = approvedCount === requiredCount

                return (
                  <div key={row.section_id} className={`rounded-2xl border shadow-sm overflow-hidden ${isFullyApproved ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-white'}`}>
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{row.section_title}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Stage: {levelLabel(row.current_level)} • {approvedCount}/{requiredCount} departments approved</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleViewSectionContent(row.section_id, row.section_title)}
                          className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                        >
                          View Content
                        </button>
                        {isFullyApproved && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                            <FaCheckDouble className="text-xs" /> Ready for Executive Review
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Department Approval Status */}
                    <div className="px-4 py-3">
                      <p className="text-xs text-slate-500 font-medium mb-2">Required Departments:</p>
                      <div className="flex flex-wrap gap-2">
                        {collegeOffices.filter(o => o.level === 2).map(office => {
                          const pos = office.slug as ApproverPosition
                          const isRequired = row.required_positions.includes(pos)
                          const isApproved = approvedPositions.has(pos)

                          if (!isRequired) return null

                          return (
                            <span key={pos} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${isApproved
                                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                              }`}>
                              {isApproved ? <FaCheckDouble className="text-xs" /> : '⏳'}
                              {office.name}
                            </span>
                          )
                        })}
                      </div>
                    </div>

                    {/* Recent Approvals */}
                    {row.approvals.length > 0 && (
                      <div className="px-4 py-2 bg-slate-50/50 border-t border-slate-100">
                        <p className="text-xs text-slate-500 font-medium mb-1.5">Recent Decisions:</p>
                        <div className="flex flex-wrap gap-2">
                          {row.approvals.slice(-3).map((a, idx) => (
                            <span key={idx} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${a.decision === 'approved'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-rose-100 text-rose-700'
                              }`}>
                              {a.decision === 'approved' ? '✓' : '✗'} {collegeOffices.find(o => o.slug === a.position)?.name || a.position} — {a.decision}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Section Content Modal */}
          {viewingSectionContent && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900">{viewingSectionContent.title}</h3>
                  <button
                    onClick={() => setViewingSectionContent(null)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-6 overflow-y-auto flex-1">
                  <div
                    className="prose prose-sm prose-slate max-w-none"
                    dangerouslySetInnerHTML={{ __html: viewingSectionContent.content }}
                  />
                </div>
                <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                  <button
                    onClick={() => setViewingSectionContent(null)}
                    className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-sm font-medium"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </>
    )
  }

  // ── LIST VIEW ───────────────────────────────────────────────────────────
  if (view === 'list') {
    const pending = handbooksWithSections()
    const sMap = sectionsByHandbook()

    return (
      <>
        {/* Header */}
      <header className="unified-header">
        <div className="unified-header-content">
          <h1 className="unified-header-title">Handbook Approvals</h1>
          <p className="unified-header-subtitle">
            {userLevel === 2 ? 'Edit and approve sections assigned to your department.' :
              'Review handbook sections.'}
          </p>
        </div>
      </header>

      <main className="unified-main">

          {/* Executive Approval Banner for Academic Admin */}
          {userLevel === 1 && Object.values(handbookApprovals).some(a => a.approved) && (
            <div className="mb-6 bg-emerald-100 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-emerald-200 flex items-center justify-center">
                  <FaCheckDouble className="h-5 w-5 text-emerald-700" />
                </div>
                <div>
                  <p className="font-semibold text-emerald-800">Handbook Approved by Executive</p>
                  <p className="text-sm text-emerald-600">You can now publish this handbook</p>
                </div>
              </div>
            </div>
          )}

          {!loading && !position && (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Your account is not configured as an active approver.</div>
          )}

          {position && (
            <div className="flex items-center justify-between">
              <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
                {levelLabel(userLevel)} — {collegeOffices.find(o => o.slug === position)?.name || position}
              </div>
              {/* Tabs */}
              <div className="flex rounded-lg bg-slate-200 p-1">
                <button
                  onClick={() => setActiveTab('pending')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'pending' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Pending ({pendingSections().length})
                </button>
                <button
                  onClick={() => setActiveTab('approved')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'approved' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Approved ({approvedSections().length})
                </button>
              </div>
            </div>
          )}

          {loading && <DashboardSkeleton />}

          {!loading && position && pending.length === 0 && (
            <div className="mt-8 flex flex-col items-center justify-center py-20 text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl bg-white">
              <FaBook className="h-12 w-12 mb-4 text-slate-200" />
              <p className="text-sm font-medium text-slate-600 mb-1">
                {activeTab === 'pending' ? "You're all caught up!" : "No approved sections yet."}
              </p>
              <p className="text-xs text-slate-400">
                {activeTab === 'pending'
                  ? "No handbooks are pending your action at this time."
                  : "Sections you approve will appear here."}
              </p>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pending.map((h) => {
              const count = sMap[h.id]?.length ?? 0
              return (
                <button key={h.id} type="button" onClick={() => openHandbook(h)} className={`text-left rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col ${activeTab === 'approved' ? 'bg-slate-50 opacity-75' : 'bg-white'}`}>
                  <h3 className="text-sm font-semibold text-slate-900 truncate">{h.title}</h3>
                  <p className="text-xs text-slate-500 mt-1">{h.academic_years?.year_name || 'Unknown Year'}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColors[h.status] ?? 'bg-slate-100 text-slate-600'}`}>{h.status}</span>
                    {h.publish_at && <span className="inline-flex items-center gap-1 text-[10px] text-slate-500"><FaCalendarAlt className="h-2.5 w-2.5" /> {new Date(h.publish_at).toLocaleDateString()}</span>}
                  </div>
                  <p className={`mt-3 text-xs font-medium ${activeTab === 'approved' ? 'text-emerald-600' : 'text-amber-700'}`}>
                    {count} section{count !== 1 ? 's' : ''} {activeTab === 'approved' ? 'approved' : 'pending'}
                  </p>
                </button>
              )
            })}
          </div>
        </main>
      </>
    )
  }

  // ── DETAIL VIEW ─────────────────────────────────────────────────────────
  const allHandbookSections = activeHandbook ? (sectionsByHandbook()[activeHandbook.id] ?? []) : []
  // Filter based on active tab
  const handbookSections = activeTab === 'pending'
    ? allHandbookSections.filter(s => !approvedSectionIds.has(s.id))
    : allHandbookSections.filter(s => approvedSectionIds.has(s.id))
  const totalPages = Math.ceil(handbookSections.length / ITEMS_PER_PAGE)
  const currentSections = handbookSections.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)

  return (
    <>
      <header className="unified-header">
        <div className="unified-header-content flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => { setView('list'); setEditingSectionId(null) }} className="p-2 rounded-full hover:bg-white/10 transition-colors text-white">
              <FaArrowLeft className="h-3 w-3" />
            </button>
            <div>
              <h1 className="unified-header-title">{activeHandbook?.title}</h1>
              <p className="unified-header-subtitle">{activeHandbook?.academic_years?.year_name}</p>
            </div>
          </div>
          {userLevel === 2 && handbookSections.length > 0 && (
            <button type="button" onClick={handleBulkApprove} disabled={bulkSaving} className="shrink-0 flex items-center gap-2 bg-white text-dyci-blue hover:bg-slate-100 px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all shadow-sm active:scale-95 disabled:opacity-60">
              {bulkSaving ? <FaSpinner className="animate-spin text-xs" /> : <FaCheckDouble className="text-xs" />} {bulkSaving ? 'Approving All…' : `Bulk Approve All (${handbookSections.length})`}
            </button>
          )}
        </div>
      </header>

      <main className="unified-main">
        {position && (
          <div className="flex items-center justify-between mb-4">
            <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800 border border-blue-100">
              {levelLabel(userLevel)} — {collegeOffices.find(o => o.slug === position)?.name || position}
            </div>
            {/* Tabs */}
            <div className="flex rounded-lg bg-slate-200 p-1">
              <button
                onClick={() => setActiveTab('pending')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'pending' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Pending
              </button>
              <button
                onClick={() => setActiveTab('approved')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'approved' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Approved
              </button>
            </div>
          </div>
        )}


        {handbookSections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl bg-white">
            <FaBook className="h-12 w-12 mb-4 text-slate-200" />
            <p className="text-sm font-medium text-slate-600 mb-1">
              {activeTab === 'pending' ? 'No pending sections.' : 'No approved sections yet.'}
            </p>
            <p className="text-xs text-slate-400">
              {activeTab === 'pending'
                ? 'All sections for this handbook have been processed.'
                : 'Sections you approve will appear here.'}
            </p>
          </div>
        )}

        <div className="space-y-4">
          {currentSections.map((sec) => (
            <SectionCard
              key={sec.id}
              section={sec}
              userLevel={userLevel}
              position={position}
              savingId={savingId}
              isEditing={editingSectionId === sec.id}
              isApproved={approvedSectionIds.has(sec.id)}
              editContent={editContent}
              changeReason={changeReason}
              comment={commentBySection[sec.id] ?? ''}
              collegeOffices={collegeOffices}
              editorRef={editingSectionId === sec.id ? editorRef : null}
              onStartEdit={() => startEditing(sec)}
              onEditorInput={handleEditorInput}
              onExecCmd={execCmd}
              onChangeReason={setChangeReason}
              onComment={(v) => setCommentBySection((p) => ({ ...p, [sec.id]: v }))}
              onL2SaveAndApprove={() => handleL2SaveAndApprove(sec.id)}
              onApprove={() => handleApprove(sec.id)}
              onReject={() => handleReject(sec.id)}
            />
          ))}
        </div>

        {totalPages > 0 && (
          <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-6">
            <button
              type="button"
              onClick={() => {
                setCurrentPage(p => Math.max(1, p - 1))
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              disabled={currentPage === 1}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-slate-500 font-medium">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => {
                setCurrentPage(p => Math.min(totalPages, p + 1))
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              disabled={currentPage === totalPages}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </>
  )
}

// ── Section Card (Level-Adaptive) ─────────────────────────────────────────

interface SectionCardProps {
  section: SectionItem
  userLevel: number
  position: ApproverPosition | null
  savingId: string | null
  isEditing: boolean
  isApproved: boolean
  editContent: string
  changeReason: string
  comment: string
  collegeOffices: CollegeOffice[]
  editorRef: React.RefObject<HTMLDivElement | null> | null
  onStartEdit: () => void
  onEditorInput: () => void
  onExecCmd: (cmd: string, val?: string) => void
  onChangeReason: (v: string) => void
  onComment: (v: string) => void
  onL2SaveAndApprove: () => void
  onApprove: () => void
  onReject: () => void
}

const SectionCard: React.FC<SectionCardProps> = ({
  section, userLevel, savingId, isEditing, isApproved,
  changeReason, comment, collegeOffices, editorRef,
  onStartEdit, onEditorInput, onExecCmd, onChangeReason, onComment,
  onL2SaveAndApprove, onApprove, onReject,
}) => {
  const [auditTrail, setAuditTrail] = useState<AuditTrailEntry[]>([])
  const isSaving = savingId === section.id

  useEffect(() => {
    fetchSectionAuditTrail(section.id).then((res) => { if (res.data) setAuditTrail(res.data) })
  }, [section.id])

  return (
    <div className={`rounded-2xl border shadow-sm overflow-hidden ${isApproved ? 'border-slate-200 bg-slate-50 opacity-75' : 'border-slate-200 bg-white'}`}>
      <div className={`px-5 py-3 border-b flex items-center justify-between ${isApproved ? 'border-slate-200 bg-slate-100' : 'border-slate-100 bg-slate-50'}`}>
        <div>
          <h3 className={`text-sm font-semibold ${isApproved ? 'text-slate-600' : 'text-slate-900'}`}>{section.sort_order}. {section.title}</h3>
          <div className="mt-1 flex items-center gap-2">
            <ProgressBar currentLevel={section.current_level} />
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColors[section.status] ?? 'bg-slate-100 text-slate-600'}`}>{section.status}</span>
            {isApproved && (
              <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                ✓ Approved by you
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Keywords section */}
      {section.keywords && section.keywords.length > 0 && (
        <div className="px-5 py-2 border-b border-slate-50 bg-blue-50/20">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[9px] font-bold text-blue-600 uppercase tracking-tight mr-1">Chat Keywords:</span>
            {section.keywords.map((kw, idx) => (
              <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-blue-100 text-[10px] text-blue-700 font-medium shadow-sm">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Level 2: Editor mode ──────────────────────────────── */}
      {userLevel === 2 && (
        <div className="p-5 space-y-3">
          {!isEditing ? (
            <>
              <div className={`rounded-lg border p-3 max-h-48 overflow-y-auto ${isApproved ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'}`}>
                <p className={`text-sm whitespace-pre-wrap ${isApproved ? 'text-slate-600' : 'text-slate-700'}`}>{section.content ? stripHtml(section.content) : '(No content)'}</p>
              </div>

              {isApproved ? (
                <div className="flex items-center gap-2 text-emerald-600">
                  <FaCheckDouble className="text-sm" />
                  <span className="text-xs font-medium">You have approved this section. No further actions available.</span>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button type="button" onClick={onStartEdit} className="px-4 py-2 rounded-lg bg-blue-700 text-xs font-semibold text-white hover:bg-blue-800">
                    Edit content
                  </button>
                  <button type="button" disabled={isSaving} onClick={onApprove} className="px-4 py-2 rounded-lg bg-emerald-700 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                    {isSaving ? 'Approving…' : 'Approve Section'}
                  </button>
                  <div className="ml-auto w-1/3">
                    <div className="flex gap-2">
                      <textarea value={comment} onChange={(e) => onComment(e.target.value)} placeholder="Reason for rejection..." className="flex-1 min-h-[30px] rounded-lg border border-slate-200 px-3 py-1.5 text-xs" />
                      <button type="button" disabled={isSaving} onClick={onReject} className="px-4 py-2 rounded-lg bg-rose-700 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-60">
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-1">
                  {[{ cmd: 'bold', icon: <FaBold /> }, { cmd: 'italic', icon: <FaItalic /> }, { cmd: 'underline', icon: <FaUnderline /> }].map(({ cmd, icon }) => (
                    <button key={cmd} onMouseDown={(e) => { e.preventDefault(); onExecCmd(cmd) }} className="p-1.5 rounded hover:bg-slate-200 text-slate-600 text-xs">{icon}</button>
                  ))}
                  <div className="w-px h-4 bg-slate-200 mx-1" />
                  <button onMouseDown={(e) => { e.preventDefault(); editorRef?.current?.focus(); document.execCommand('insertHTML', false, '<ul><li></li></ul>'); onEditorInput() }} className="p-1.5 rounded hover:bg-slate-200 text-slate-600 text-xs"><FaListUl /></button>
                  <button onMouseDown={(e) => { e.preventDefault(); editorRef?.current?.focus(); document.execCommand('insertHTML', false, '<ol><li></li></ol>'); onEditorInput() }} className="p-1.5 rounded hover:bg-slate-200 text-slate-600 text-xs"><FaListOl /></button>
                </div>
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={onEditorInput}
                  onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertHTML', false, '\u00a0\u00a0\u00a0\u00a0'); onEditorInput() } }}
                  className="px-4 py-3 text-sm text-slate-700 leading-relaxed focus:outline-none prose prose-sm prose-slate max-w-none min-h-[120px]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Change Reason (required)</label>
                <textarea value={changeReason} onChange={(e) => onChangeReason(e.target.value)} placeholder="e.g., Updated Article II to include hybrid learning rules" className="w-full min-h-[60px] rounded-lg border border-slate-200 px-3 py-2 text-xs" />
              </div>
              <button type="button" disabled={isSaving} onClick={onL2SaveAndApprove} className="px-4 py-2 rounded-lg bg-emerald-700 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                {isSaving ? 'Saving…' : 'Save & Approve Section'}
              </button>
            </>
          )}

          {auditTrail.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 p-4 bg-slate-50/50 space-y-4">
              <h5 className="text-[10px] font-semibold text-slate-500 uppercase flex items-center gap-1.5"><FaHistory /> Discussion & Audit Timeline</h5>
              <div className="space-y-4 pl-2 border-l-2 border-slate-100">
                {auditTrail.map((e) => (
                  <div key={e.id} className="relative pl-4">
                    <div className={`absolute -left-[11px] top-1.5 h-2 w-2 rounded-full border border-white ${e.decision === 'approved' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <div className="flex flex-col gap-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-slate-900">{e.approver_name}</span>
                        <span className="text-[10px] text-slate-500">{collegeOffices.find(o => o.slug === e.position)?.name || e.position}</span>
                      </div>
                      {e.decided_at && <span className="text-[10px] text-slate-400">{new Date(e.decided_at).toLocaleString()}</span>}
                      {e.comment && (
                        <div className="mt-1.5 rounded-r-xl rounded-bl-xl bg-white border border-slate-200 p-3 shadow-sm relative">
                          <p className="text-xs text-slate-700">"{e.comment}"</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default HandbookApprovals
