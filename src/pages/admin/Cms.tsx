import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  FaPlus,
  FaSave,
  FaTrash,
  FaBook,
  FaFileAlt,
  FaSpinner,
  FaChevronRight,
  FaChevronDown,
  FaExclamationTriangle,
  FaBold,
  FaItalic,
  FaUnderline,
  FaListUl,
  FaListOl,
  FaEllipsisV,
  FaArrowLeft,
  FaCalendarAlt,
  FaHistory,
  FaExchangeAlt,
  FaPaperPlane,
  FaCheckDouble,
} from 'react-icons/fa'
import toast from 'react-hot-toast'
import { generateKeywords as genKeywordsLogic } from '../../utils/chatLogic'
import { supabase } from '../../lib/supabaseClient'
import { notifyPosition } from '../../lib/api/notifications'
import { fetchAcademicYears, type AcademicYear } from '../../lib/api/settings'
import {
  fetchHandbookTree,
  buildTree,
  type HandbookNode,
} from '../../lib/api/handbook'
import { handbookData } from '../../data/handbookData'
import { isSupabaseConfigured } from '../../lib/supabaseClient'
import {
  createHandbook,
  cloneHandbook,
  fetchHandbookApprovalMonitor,
  fetchHandbookApprovals,
  fetchHandbooks,
  fetchSections,
  fetchSectionAssignments,
  assignSectionToDepartments,
  submitSectionToL2,
  publishHandbookNow,
  replaceHandbookSections,
  scheduleHandbookPublish,
  fetchSectionAuditTrail,
  fetchSectionDiff,
  deleteHandbook,
  fetchCollegeOffices,
  type CollegeOffice,
  type HandbookApprovalMonitorRow,
  type HandbookSection,
  type ApproverPosition,
  type AuditTrailEntry,
  type Handbook,
} from '../../lib/api/handbookWorkflow'

// ── Helpers ───────────────────────────────────────────────────────────────

const buildFallback = (): HandbookNode[] => {
  const rows = handbookData.flatMap((ch) => [
    { id: String(ch.id), parent_id: null, title: `${ch.title}: ${ch.subtitle}`, content: null, sort_order: ch.id, depth: 0, updated_at: '' },
    ...ch.sections.map((s, si) => ({
      id: s.id, parent_id: String(ch.id), title: s.title,
      content: s.content, sort_order: si + 1, depth: 1, updated_at: '',
    })),
  ])
  return buildTree(rows as any)
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border border-slate-200',
  dept_review: 'bg-blue-50 text-blue-700 border border-blue-200',
  final_review: 'bg-violet-50 text-violet-700 border border-violet-200',
  pending_approval: 'bg-amber-50 text-amber-700 border border-amber-200',
  published: 'bg-emerald-50 text-emerald-700 border border-emerald-300 font-bold',
  rejected: 'bg-rose-50 text-rose-700 border border-rose-200',
}

function stripHtml(html: string): string {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.textContent || d.innerText || ''
}

function wordDiff(oldText: string, newText: string): { type: 'same' | 'add' | 'del'; text: string }[] {
  const oldWords = stripHtml(oldText).split(/\s+/).filter(Boolean)
  const newWords = stripHtml(newText).split(/\s+/).filter(Boolean)
  const result: { type: 'same' | 'add' | 'del'; text: string }[] = []
  let oi = 0, ni = 0
  while (oi < oldWords.length && ni < newWords.length) {
    if (oldWords[oi] === newWords[ni]) {
      result.push({ type: 'same', text: oldWords[oi] })
      oi++; ni++
    } else {
      const newIdx = newWords.indexOf(oldWords[oi], ni)
      if (newIdx !== -1 && newIdx - ni < 6) {
        while (ni < newIdx) { result.push({ type: 'add', text: newWords[ni] }); ni++ }
      } else {
        result.push({ type: 'del', text: oldWords[oi] }); oi++
        continue
      }
    }
  }
  while (oi < oldWords.length) { result.push({ type: 'del', text: oldWords[oi] }); oi++ }
  while (ni < newWords.length) { result.push({ type: 'add', text: newWords[ni] }); ni++ }
  return result
}

// ── Progress Bar ──────────────────────────────────────────────────────────

const ProgressBar: React.FC<{ currentLevel: number }> = ({ currentLevel }) => {
  const levels = [
    { n: 1, label: 'Academic Admin Draft' },
    { n: 2, label: 'Departmental Review' },
  ]
  return (
    <div className="flex items-center gap-1">
      {levels.map((l, i) => {
        const done = currentLevel > l.n
        const active = currentLevel === l.n
        return (
          <React.Fragment key={l.n}>
            {i > 0 && <div className={`h-0.5 w-5 ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
            <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold
              ${done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {l.label}
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ── Modals ─────────────────────────────────────────────────────────────────

interface ConfirmModalProps { nodeId: string; onConfirm: () => void; onCancel: () => void }
const ConfirmModal: React.FC<ConfirmModalProps> = ({ nodeId, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
    <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-rose-50 flex items-center justify-center">
          <FaExclamationTriangle className="text-rose-500 text-sm" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900 text-sm">Delete node?</h3>
          <p className="mt-1 text-xs text-slate-500">This will permanently delete <span className="font-mono font-semibold text-slate-700">{nodeId}</span> and all its children.</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
        <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold">Delete</button>
      </div>
    </div>
  </div>
)

interface KeywordModalProps {
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}
const KeywordModal: React.FC<KeywordModalProps> = ({ value, onChange, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
    <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6 space-y-4 animate-in fade-in zoom-in duration-200">
      <div className="space-y-1">
        <h3 className="font-semibold text-slate-900 text-sm italic">Add Manual Keywords</h3>
        <p className="text-xs text-slate-500">Enter one or more keywords (separated by commas).</p>
      </div>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onConfirm()}
        placeholder="e.g. tuition fees"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all mr-1"
      />
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
        <button onClick={onConfirm} disabled={!value.trim()} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold disabled:opacity-50 transition-colors">Add Keyword</button>
      </div>
    </div>
  </div>
)

// ── Tree node ─────────────────────────────────────────────────────────────

interface TreeNodeProps { node: HandbookNode; selectedId: string | null; onSelect: (id: string) => void; onAddChild: (parentId: string, parentDepth: number) => void; onDelete: (id: string) => void; isPublished?: boolean; depth?: number }
const TreeNode: React.FC<TreeNodeProps> = ({ node, selectedId, onSelect, onAddChild, onDelete, isPublished, depth = 0 }) => {
  const [open, setOpen] = useState(depth === 0)
  const isSelected = selectedId === node.id
  const hasChildren = node.children.length > 0
  return (
    <div>
      <div className={`group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors ${isSelected ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-50 text-slate-700'}`} style={{ paddingLeft: `${8 + depth * 12}px` }} onClick={() => { onSelect(node.id); setOpen(true) }}>
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          {hasChildren ? (
            <button className="shrink-0 text-slate-400 hover:text-slate-600" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>{open ? <FaChevronDown className="text-[10px]" /> : <FaChevronRight className="text-[10px]" />}</button>
          ) : (<FaFileAlt className={`shrink-0 text-xs ${isSelected ? 'text-blue-400' : 'text-slate-300'}`} />)}
          <span className="truncate">{node.title}</span>
        </div>
        {!isPublished && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
            <button onClick={(e) => { e.stopPropagation(); onAddChild(node.id, node.depth) }} title="Add child" className="p-1 hover:bg-blue-200 rounded text-blue-600"><FaPlus className="text-[10px]" /></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(node.id) }} className="p-1 hover:bg-rose-200 rounded text-rose-500"><FaTrash className="text-[10px]" /></button>
          </div>
        )}
      </div>
      {open && hasChildren && <div>{node.children.map((child) => <TreeNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild} onDelete={onDelete} isPublished={isPublished} depth={depth + 1} />)}</div>}
    </div>
  )
}

function findNode(nodes: HandbookNode[], id: string): HandbookNode | null {
  for (const n of nodes) { if (n.id === id) return n; const f = findNode(n.children, id); if (f) return f }
  return null
}

type CmsView = 'list' | 'editor' | 'monitor' | 'assignment'

// ── Main CMS Component ────────────────────────────────────────────────────

const Cms: React.FC = () => {
  const [view, setView] = useState<CmsView>('list')
  const [tree, setTree] = useState<HandbookNode[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [workflowSaving, setWorkflowSaving] = useState(false)
  const [newHandbookTitle, setNewHandbookTitle] = useState('')
  const [newAcademicYearId, setNewAcademicYearId] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [publishAt, setPublishAt] = useState('')
  const [scheduleHandbookTarget, setScheduleHandbookTarget] = useState<Handbook | null>(null)
  const [workflowHandbooks, setWorkflowHandbooks] = useState<Handbook[]>([])
  const [activeHandbookId, setActiveHandbookId] = useState('')
  const [activeHandbook, setActiveHandbook] = useState<Handbook | null>(null)
  const [editingHandbookLabel, setEditingHandbookLabel] = useState('')
  const [cardMenuOpenId, setCardMenuOpenId] = useState<string | null>(null)
  const [approvalMonitor, setApprovalMonitor] = useState<HandbookApprovalMonitorRow[]>([])
  const [approvalMonitorLoading, setApprovalMonitorLoading] = useState(false)
  const [handbookApprovals, setHandbookApprovals] = useState<Record<string, { approved: boolean; approver_position: string; approved_at: string | null }>>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [pendingDeleteHandbook, setPendingDeleteHandbook] = useState<Handbook | null>(null)
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
  const [collegeOffices, setCollegeOffices] = useState<CollegeOffice[]>([])

  const [cloneHandbookTarget, setCloneHandbookTarget] = useState<Handbook | null>(null)
  const [cloneHandbookTitle, setCloneHandbookTitle] = useState('')
  const [cloneAcademicYearId, setCloneAcademicYearId] = useState('')

  useEffect(() => {
    if (cloneHandbookTarget) {
      setCloneHandbookTitle(`${cloneHandbookTarget.title} (Cloned)`)
      const currentIdx = academicYears.findIndex(y => y.id === cloneHandbookTarget.academic_year_id)
      if (currentIdx !== -1 && academicYears[currentIdx + 1]) {
        setCloneAcademicYearId(academicYears[currentIdx + 1].id)
      } else {
        setCloneAcademicYearId('')
      }
    }
  }, [cloneHandbookTarget, academicYears])

  useEffect(() => {
    fetchCollegeOffices().then(res => {
      if (res.data && res.data.length > 0) {
        setCollegeOffices(res.data)
      } else {
        setCollegeOffices([
          { id: 'f1', name: 'Scholarship Department', slug: 'scholarship', level: 2, is_active: true, sort_order: 10 },
          { id: 'f2', name: 'Department of Finance', slug: 'finance', level: 2, is_active: true, sort_order: 20 },
          { id: 'f3', name: 'Office of the Registrar', slug: 'registrar', level: 2, is_active: true, sort_order: 30 },
          { id: 'f4', name: 'Guidance & Counseling', slug: 'guidance', level: 2, is_active: true, sort_order: 40 },
          { id: 'f5', name: 'Property/Security Office', slug: 'property_security', level: 2, is_active: true, sort_order: 50 },
          { id: 'f6', name: 'Academic Council', slug: 'academic_council', level: 2, is_active: true, sort_order: 60 },
          { id: 'f7', name: 'Vice President', slug: 'vice_president', level: 3, is_active: true, sort_order: 70 },
          { id: 'f8', name: 'Office of the President', slug: 'president', level: 3, is_active: true, sort_order: 80 }
        ])
      }
    })
    fetchAcademicYears().then(res => {
      if (res.data) {
        setAcademicYears(res.data)
      }
    })
  }, [])

  // Pagination state
  const [hbPage, setHbPage] = useState(1)
  const HB_ITEMS_PER_PAGE = 12
  const [monitorPage, setMonitorPage] = useState(1)
  const MONITOR_ITEMS_PER_PAGE = 5
  const [assignmentPage, setAssignmentPage] = useState(1)
  const ASSIGNMENT_ITEMS_PER_PAGE = 5

  // Section-level workflow state
  const [sectionMeta, setSectionMeta] = useState<HandbookSection | null>(null)
  const [sectionAssignments, setSectionAssignments] = useState<ApproverPosition[]>([])
  const [auditTrail, setAuditTrail] = useState<AuditTrailEntry[]>([])
  const [showAudit, setShowAudit] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [diffData, setDiffData] = useState<{ legacy_content: string | null; content: string; change_reason: string | null } | null>(null)
  const [workflowSections, setWorkflowSections] = useState<HandbookSection[]>([])
  const [currentKeywords, setCurrentKeywords] = useState<string[]>([])
  const [generatingKeywords, setGeneratingKeywords] = useState(false)
  const [showKeywordModal, setShowKeywordModal] = useState(false)
  const [keywordInput, setKeywordInput] = useState('')
  const [localTitle, setLocalTitle] = useState('')
  const [pendingAssignmentToggle, setPendingAssignmentToggle] = useState<ApproverPosition | null>(null)
  const [generatedKeywordsReview, setGeneratedKeywordsReview] = useState<string[] | null>(null)

  useEffect(() => {
    if (selectedNode) setLocalTitle(selectedNode.title)
    else setLocalTitle('')
  }, [selectedId])

  useEffect(() => {
    if (showCreateForm) {
      const loadOptions = async () => {
        const { data: years } = await fetchAcademicYears()
        if (years) {
          setAcademicYears(years)
          const current = years.find(y => y.is_current)
          if (current) setNewAcademicYearId(current.id)
          else if (years.length > 0) setNewAcademicYearId(years[0].id)
        }
      }
      loadOptions()
    }
  }, [showCreateForm])

  const editorRef = useRef<HTMLDivElement>(null)
  const selectedNode = selectedId ? findNode(tree, selectedId) : null

  const filteredTree = useMemo(() => {
    if (!searchTerm.trim()) return tree;
    const term = searchTerm.toLowerCase();
    const filterNode = (node: HandbookNode): HandbookNode | null => {
      const titleMatch = node.title.toLowerCase().includes(term);
      const children = node.children.map(filterNode).filter(Boolean) as HandbookNode[];
      if (titleMatch || children.length > 0) return { ...node, children };
      return null;
    };
    return tree.map(filterNode).filter(Boolean) as HandbookNode[];
  }, [tree, searchTerm]);

  useEffect(() => {
    if (editorRef.current && selectedNode) editorRef.current.innerHTML = selectedNode.content ?? ''
  }, [selectedId])

  // ── Data loading ────────────────────────────────────────────────────────

  const loadTree = useCallback(async () => {
    if (!activeHandbookId) return
    setLoading(true)
    const { data, error } = await fetchHandbookTree(activeHandbookId)
    if (error || !data || data.length === 0) {
      setTree(buildFallback());
      if (error && error !== 'The resource was not found') toast.error('Could not load from database — showing cached data.')
    }
    else setTree(data)
    setLoading(false)
  }, [activeHandbookId])

  useEffect(() => { loadTree() }, [loadTree])

  const loadWorkflowHandbooks = useCallback(async () => {
    setLoading(true)
    const { data, error } = await fetchHandbooks()
    setLoading(false)
    if (error) { toast.error(`Failed to load handbooks: ${error}`); return }
    setWorkflowHandbooks(data ?? [])
  }, [])

  const loadApprovalMonitor = useCallback(async (handbookId?: string) => {
    const id = handbookId || activeHandbookId
    if (!id) { setApprovalMonitor([]); return }
    setApprovalMonitorLoading(true)
    const [{ data, error }, { data: hbApprovals }] = await Promise.all([
      fetchHandbookApprovalMonitor(id),
      fetchHandbookApprovals(id)
    ])
    setApprovalMonitorLoading(false)
    if (error) { toast.error(`Monitor: ${error}`); return }
    setApprovalMonitor(data ?? [])

    // Process handbook L3 approvals
    const approvalsMap: Record<string, { approved: boolean; approver_position: string; approved_at: string | null }> = {}
      ; (hbApprovals || []).forEach((a: any) => {
        approvalsMap[a.approver_position] = {
          approved: a.decision === 'approved',
          approver_position: a.approver_position,
          approved_at: a.approved_at
        }
      })
    setHandbookApprovals(approvalsMap)
  }, [activeHandbookId])

  const loadWorkflowSections = useCallback(async (handbookId?: string) => {
    const id = handbookId || activeHandbookId
    if (!id) return
    const { data } = await fetchSections(id)
    setWorkflowSections(data ?? [])
  }, [activeHandbookId])

  useEffect(() => { if (isSupabaseConfigured) loadWorkflowHandbooks() }, [loadWorkflowHandbooks])

  // Load section-level workflow data when a section node is selected in editor
  const loadSectionWorkflowData = useCallback(async (sec: HandbookSection) => {
    if (!activeHandbookId || !sec) { setSectionMeta(null); return }
    setSectionMeta(sec)
    const [assignRes, auditRes, diffRes] = await Promise.all([
      fetchSectionAssignments(sec.id),
      fetchSectionAuditTrail(sec.id),
      fetchSectionDiff(sec.id),
    ])
    setSectionAssignments(assignRes.data ?? [])
    setAuditTrail(auditRes.data ?? [])
    setDiffData(diffRes.data ?? null)

    // Load keywords for this section
    const { data: kwData } = await supabase
      .from('handbook_keywords')
      .select('keyword')
      .eq('section_id', sec.id)

    if (kwData) {
      setCurrentKeywords(kwData.map(k => k.keyword))
    } else {
      setCurrentKeywords([])
    }
  }, [activeHandbookId])

  // When selectedId changes in editor mode, derive the section
  useEffect(() => {
    if (view !== 'editor' || !selectedId) { setSectionMeta(null); return }

    // Handle dot-notation IDs (e.g., "1.11") - parse section index from ID
    const parts = selectedId.split('.')
    if (parts.length >= 2) {
      const idx = parseInt(parts[1], 10) - 1
      if (!isNaN(idx) && idx >= 0 && workflowSections[idx]) {
        loadSectionWorkflowData(workflowSections[idx])
        return
      }
    }

    // Handle UUID-based IDs - find section by matching db_id in workflowSections
    if (workflowSections.length > 0) {
      const sec = workflowSections.find(s => s.id === selectedId)
      if (sec) {
        loadSectionWorkflowData(sec)
        return
      }
    }

    // If no matching section found, clear metadata
    setSectionMeta(null)
  }, [selectedId, view, workflowSections, loadSectionWorkflowData])

  // ── Tree edit helpers ───────────────────────────────────────────────────

  const updateNodeInTree = (nodes: HandbookNode[], id: string, patch: Partial<HandbookNode>): HandbookNode[] =>
    nodes.map((n) => n.id === id ? { ...n, ...patch } : { ...n, children: updateNodeInTree(n.children, id, patch) })

  const removeNodeFromTree = (nodes: HandbookNode[], id: string): HandbookNode[] =>
    nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: removeNodeFromTree(n.children, id) }))


  // ── Actions ─────────────────────────────────────────────────────────────

  const syncTreeToSections = async (currentTree: HandbookNode[], handbookId: string) => {
    if (!handbookId) return
    // Collect ALL nodes (chapters at depth=0 are also stored as top-level sections)
    const allNodes: HandbookNode[] = []
    const walk = (nodes: HandbookNode[]) => {
      nodes.forEach((n) => {
        allNodes.push(n)
        if (n.children.length > 0) walk(n.children)
      })
    }
    walk(currentTree)
    if (allNodes.length === 0) return

    const isValidUuid = (id: string | null | undefined): boolean => {
      if (!id) return false
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    }

    await replaceHandbookSections(handbookId, allNodes.map((n, idx) => {
      let resolvedParentId: string | null = n.parent_id
      if (n.parent_id && !isValidUuid(n.parent_id)) {
        const parentNode = allNodes.find(p => p.id === n.parent_id)
        if (parentNode && isValidUuid(parentNode.id)) {
          resolvedParentId = parentNode.id
        } else if (parentNode && parentNode.db_id && isValidUuid(parentNode.db_id)) {
          resolvedParentId = parentNode.db_id
        } else {
          resolvedParentId = null
        }
      }
      return {
        title: n.title,
        content: n.content ?? '',
        sort_order: idx + 1,
        parent_id: resolvedParentId,
      }
    }))
  }

  const handleAddRoot = async () => {
    if (activeHandbook?.status === 'published') { toast.error('This handbook is published and locked.'); return }
    if (!activeHandbookId) { toast.error('Please select a handbook first.'); return }
    const newId = `${tree.length + 1}`
    const node: HandbookNode = { id: newId, parent_id: null, title: `CHAPTER ${newId}`, content: null, sort_order: tree.length + 1, depth: 0, updated_at: '', children: [] }
    const newTree = [...tree, node]
    setTree(newTree); setSelectedId(newId)
    if (isSupabaseConfigured) {
      setSaving(true)
      await syncTreeToSections(newTree, activeHandbookId)
      await loadTree() // Reload so node gets its real db_id UUID
      await loadWorkflowSections() // Reload workflow sections
      setSaving(false)
      toast.success('Chapter created')
    }
  }

  const handleAddChild = async (parentId: string, parentDepth: number) => {
    if (activeHandbook?.status === 'published') { toast.error('This handbook is published and locked.'); return }
    if (!activeHandbookId) { toast.error('Please select a handbook first.'); return }
    const parent = findNode(tree, parentId); if (!parent) return
    const childCount = parent.children.length + 1
    const newId = `${parentId}.${childCount}`
    const node: HandbookNode = { id: newId, parent_id: parentId, title: 'New Section', content: '', sort_order: childCount, depth: parentDepth + 1, updated_at: '', children: [] }
    const newTree = updateNodeInTree(tree, parentId, { children: [...(findNode(tree, parentId)?.children ?? []), node] })
    setTree(newTree); setSelectedId(newId)
    if (isSupabaseConfigured) {
      setSaving(true)
      await syncTreeToSections(newTree, activeHandbookId)
      // Reload tree to get the new UUID from database
      const { data: refreshedTree } = await fetchHandbookTree(activeHandbookId)
      if (refreshedTree && refreshedTree.length > 0) {
        setTree(refreshedTree)
        // Find the newly created section by its parent_id and sort_order
        const findNewSection = (nodes: HandbookNode[]): HandbookNode | null => {
          for (const n of nodes) {
            if (n.parent_id === parentId && n.sort_order === childCount) {
              return n
            }
            const found = findNewSection(n.children)
            if (found) return found
          }
          return null
        }
        const newSection = findNewSection(refreshedTree)
        if (newSection) {
          setSelectedId(newSection.id)
          // Reload workflow sections and load data for this section
          const { data: sections } = await fetchSections(activeHandbookId)
          setWorkflowSections(sections ?? [])
          // Find section and load workflow data directly to avoid waiting for state update
          const sec = (sections ?? []).find(s => s.id === newSection.db_id || s.id === newSection.id)
          if (sec) {
            await loadSectionWorkflowData(sec)
          }
        }
      }
      setSaving(false)
      toast.success('Section added')
    }
  }

  const confirmDelete = async () => {
    if (activeHandbook?.status === 'published') { toast.error('This handbook is published and locked.'); return }
    if (!pendingDelete) return
    const id = pendingDelete; setPendingDelete(null)
    const nodeToDelete = findNode(tree, id)
    const newTree = removeNodeFromTree(tree, id)
    setTree(newTree); if (selectedId === id) setSelectedId(null)
    if (isSupabaseConfigured) {
      // Collect all db_ids to delete (node + all descendants)
      const collectDbIds = (nodes: HandbookNode[]): string[] =>
        nodes.flatMap(n => [...(n.db_id ? [n.db_id] : []), ...collectDbIds(n.children)])
      // Use db_id if set; fall back to id (which is a UUID after loadTree)
      const selfId = nodeToDelete?.db_id ?? nodeToDelete?.id
      const idsToDelete: string[] = [
        ...(selfId ? [selfId] : []),
        ...(nodeToDelete ? collectDbIds(nodeToDelete.children) : []),
      ]
      if (idsToDelete.length > 0) {
        const { error } = await supabase.from('handbook_sections').delete().in('id', idsToDelete)
        if (error) { toast.error('Delete failed: ' + error.message); return }
      }
      toast.success('Deleted')
    }
  }

  const handleFieldChange = (key: 'title' | 'content', value: string) => { if (!selectedId) return; setTree((t) => updateNodeInTree(t, selectedId, { [key]: value })) }
  const handleEditorInput = () => { if (selectedId && editorRef.current) handleFieldChange('content', editorRef.current.innerHTML) }
  const execCmd = (command: string, value?: string) => { document.execCommand(command, false, value); editorRef.current?.focus(); handleEditorInput() }

  // ── Auto-save ───────────────────────────────────────────────────────────
  const autoSaveTimeout = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured || !activeHandbookId || !selectedNode || activeHandbook?.status === 'published') return
    if (autoSaveTimeout.current) clearTimeout(autoSaveTimeout.current)
    autoSaveTimeout.current = setTimeout(async () => {
      // Auto-save without triggering UI blocking 'saving' state
      await syncTreeToSections(tree, activeHandbookId)
    }, 2000)
    return () => { if (autoSaveTimeout.current) clearTimeout(autoSaveTimeout.current) }
  }, [tree, isSupabaseConfigured, activeHandbookId, selectedNode, activeHandbook])

  const handleSave = async () => {
    if (activeHandbook?.status === 'published') { toast.error('This handbook is published and locked.'); return }
    if (!selectedNode || !isSupabaseConfigured) { toast(isSupabaseConfigured ? 'No node selected' : 'Supabase not configured.', { icon: '⚠️' }); return }
    setSaving(true)

    // Sync current tree state to the DB (handles title + content updates)
    await syncTreeToSections(tree, activeHandbookId)

    // Save keywords if it's a content section (depth > 0) and has a DB record
    if (selectedNode.depth > 0 && sectionMeta) {
      await supabase.from('handbook_keywords').delete().eq('section_id', sectionMeta.id)
      if (currentKeywords.length > 0) {
        await supabase.from('handbook_keywords').insert(
          currentKeywords.map(k => ({ keyword: k, section_id: sectionMeta.id }))
        )
      }
    }

    setSaving(false)
    toast.success('Saved ✓')
  }

  const handleGenerateKeywords = async () => {
    if (!selectedNode?.content || !sectionMeta) return
    setGeneratingKeywords(true)
    try {
      const bodyText = stripHtml(selectedNode.content)
      const suggestions = await genKeywordsLogic(selectedNode.title, bodyText)

      if (suggestions.length === 0) {
        toast('AI returned no clear keywords. Try adding more detail to the section.', { icon: 'ℹ️' })
        return
      }

      setGeneratedKeywordsReview(suggestions)
      toast.success(`AI suggested ${suggestions.length} keywords`)
    } catch (err: any) {
      console.error('Keyword generation error:', err)
      const msg = err.message || 'Failed to generate keywords'
      toast.error(msg)
    } finally {
      setGeneratingKeywords(false)
    }
  }

  const acceptGeneratedKeywords = async () => {
    if (!generatedKeywordsReview) return
    const merged = Array.from(new Set([...currentKeywords, ...generatedKeywordsReview]))
    setCurrentKeywords(merged)
    setGeneratedKeywordsReview(null)

    if (selectedNode && selectedNode.depth > 0 && sectionMeta) {
      await supabase.from('handbook_keywords').delete().eq('section_id', sectionMeta.id)
      if (merged.length > 0) {
        await supabase.from('handbook_keywords').insert(
          merged.map(k => ({ keyword: k, section_id: sectionMeta.id }))
        )
      }
    }

    toast.success('Keywords accepted & saved ✓')
  }

  const handleAddManualKeyword = () => {
    setKeywordInput('')
    setShowKeywordModal(true)
  }

  const confirmAddManualKeyword = () => {
    if (keywordInput.trim()) {
      const parts = keywordInput.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0)
      const newKeywords = parts.filter(k => !currentKeywords.includes(k))

      if (newKeywords.length > 0) {
        setCurrentKeywords([...currentKeywords, ...newKeywords])
        toast.success(`Added ${newKeywords.length} keywords`)
      }
      setShowKeywordModal(false)
      setKeywordInput('')
    }
  }

  const handleRemoveKeyword = async (k: string) => {
    const nextKeywords = currentKeywords.filter((kw: string) => kw !== k)
    setCurrentKeywords(nextKeywords)
    if (sectionMeta) {
      await supabase
        .from('handbook_keywords')
        .delete()
        .eq('section_id', sectionMeta.id)
        .eq('keyword', k)
    }
    toast.success('Keyword removed ✓')
  }

  const handleCreateHandbook = async () => {
    if (!newHandbookTitle.trim() || !newAcademicYearId.trim()) { toast.error('Title and academic year required.'); return }
    setWorkflowSaving(true)
    const { error } = await createHandbook(newHandbookTitle.trim(), newAcademicYearId.trim())
    setWorkflowSaving(false)
    if (error) { toast.error(error); return }
    toast.success('Handbook created.'); setNewHandbookTitle(''); setNewAcademicYearId(''); setShowCreateForm(false)
    await loadWorkflowHandbooks()
  }

  const openEditorForHandbook = async (handbook: Handbook) => {
    // Use fetchHandbookTree to get proper hierarchical structure with parent-child relationships
    const { data: treeData, error: treeError } = await fetchHandbookTree(handbook.id)
    if (treeError) { toast.error(`Failed to load tree: ${treeError}`); return }

    // Also fetch workflow sections for metadata
    const { data: sections, error: secError } = await fetchSections(handbook.id)
    if (secError) { toast.error(`Failed to load sections: ${secError}`); return }

    setWorkflowSections(sections ?? [])

    if (treeData && treeData.length > 0) {
      setTree(treeData)
      // Select first child of first chapter, or first chapter if no children
      const firstChapter = treeData[0]
      const firstSection = firstChapter?.children?.[0]?.id || firstChapter?.id
      setSelectedId(firstSection || null)
    } else {
      // Fallback: create empty handbook structure
      const rootId = '1'
      const rootNode: HandbookNode = {
        id: rootId, parent_id: null, title: handbook.title, content: null,
        sort_order: 1, depth: 0, updated_at: handbook.updated_at ?? '', children: []
      }
      setTree([rootNode])
      setSelectedId(rootId)
    }

    setActiveHandbook(handbook)
    setActiveHandbookId(handbook.id)
    setEditingHandbookLabel(`${handbook.title} (${handbook.academic_years?.year_name || 'Unknown Year'})`)
    setCardMenuOpenId(null)
    setView('editor')
  }

  const handleAssignmentToggle = async (pos: ApproverPosition) => {
    if (!sectionMeta) return
    const isAdding = !sectionAssignments.includes(pos)
    const next = isAdding
      ? [...sectionAssignments, pos]
      : sectionAssignments.filter((p) => p !== pos)
    setSectionAssignments(next)
    const { error } = await assignSectionToDepartments(sectionMeta.id, next)
    if (error) { toast.error(error); return }
    await handleSave()

    // If adding a department, automatically submit section to department review (Level 2)
    if (isAdding) {
      const { data: stage } = await supabase
        .from('workflow_stages')
        .select('id')
        .eq('workflow_name', 'handbook_approval')
        .eq('stage_order', 2)
        .single()

      await supabase
        .from('handbook_sections')
        .update({ workflow_stage_id: stage?.id, status: 'dept_review', current_level: 2 })
        .eq('id', sectionMeta.id)

      await notifyPosition(
        pos,
        'New Section Assigned',
        `The section "${selectedNode?.title || 'Untitled Section'}" has been assigned to your department for review.`
      )
    } else {
      await notifyPosition(
        pos,
        'Section Assignment Removed',
        `The section "${selectedNode?.title || 'Untitled Section'}" has been unassigned from your department.`
      )
    }
  }

  const handleSubmitSingleToL2 = async () => {
    if (!sectionMeta) return
    setWorkflowSaving(true)
    const { error } = await submitSectionToL2(sectionMeta.id)
    setWorkflowSaving(false)
    if (error) { toast.error(error); return }
    toast.success('Section submitted for Departmental Review.')
    await loadWorkflowSections()
  }

  const handleAssignmentSubmitSingle = async (sectionId: string) => {
    if (!activeHandbookId) return
    setWorkflowSaving(true)
    const { error } = await submitSectionToL2(sectionId)
    setWorkflowSaving(false)
    if (error) { toast.error(error); return }
    toast.success('Section submitted for Departmental Review.')
    await loadApprovalMonitor(activeHandbookId)
  }

  const handleSchedulePublish = async () => {
    if (!scheduleHandbookTarget || !publishAt) { toast.error('Select date/time.'); return }
    const { error } = await scheduleHandbookPublish(scheduleHandbookTarget.id, new Date(publishAt).toISOString())
    if (error) { toast.error(error); return }
    toast.success('Schedule saved.'); setScheduleHandbookTarget(null); setPublishAt('')
    await loadWorkflowHandbooks()
  }

  const handlePublishNow = async (handbookId: string) => {
    setCardMenuOpenId(null)
    const { error, waitingForDate } = await publishHandbookNow(handbookId)
    if (error) { toast.error(error); return }
    toast.success(waitingForDate ? 'Waiting for release date.' : 'Handbook published.')
    await loadWorkflowHandbooks()
  }
  const openMonitor = async (handbook: Handbook) => {
    setActiveHandbookId(handbook.id); setEditingHandbookLabel(`${handbook.title} (${handbook.academic_years?.year_name || 'Unknown Year'})`)
    setCardMenuOpenId(null); setView('monitor'); setMonitorPage(1)
    await loadApprovalMonitor(handbook.id)
  }

  const openAssignmentForHandbook = async (handbook: Handbook) => {
    setActiveHandbookId(handbook.id); setEditingHandbookLabel(`${handbook.title} (${handbook.academic_years?.year_name || 'Unknown Year'})`)
    setCardMenuOpenId(null); setView('assignment'); setAssignmentPage(1)
    await loadApprovalMonitor(handbook.id)
  }

  const handleBulkAssignmentToggle = async (sectionId: string, pos: ApproverPosition, currentReqs: ApproverPosition[]) => {
    const next = currentReqs.includes(pos)
      ? currentReqs.filter(p => p !== pos)
      : [...currentReqs, pos]
    setApprovalMonitor(prev => prev.map(r => r.section_id === sectionId ? { ...r, required_positions: next } : r))
    const { error } = await assignSectionToDepartments(sectionId, next)
    if (error) {
      toast.error(error)
      setApprovalMonitor(prev => prev.map(r => r.section_id === sectionId ? { ...r, required_positions: currentReqs } : r))
    }
  }

  const handleDeleteHandbook = async () => {
    if (!pendingDeleteHandbook) return
    const { error } = await deleteHandbook(pendingDeleteHandbook.id)
    if (error) { toast.error(error); return }
    toast.success('Handbook deleted.')
    setPendingDeleteHandbook(null)
    await loadWorkflowHandbooks()
  }

  const handleCloneHandbook = async () => {
    if (!cloneHandbookTarget || !cloneHandbookTitle.trim() || !cloneAcademicYearId) return
    setWorkflowSaving(true)
    const { data: newHbId, error } = await cloneHandbook(cloneHandbookTarget.id, cloneHandbookTitle.trim(), cloneAcademicYearId)
    setWorkflowSaving(false)
    if (error) {
      toast.error(error)
      return
    }
    toast.success('Handbook successfully cloned!')
    setCloneHandbookTarget(null); setCloneHandbookTitle(''); setCloneAcademicYearId('')
    await loadWorkflowHandbooks()

    const { data: handbooks } = await fetchHandbooks()
    if (handbooks) {
      setWorkflowHandbooks(handbooks)
      const freshHb = handbooks.find(h => h.id === newHbId)
      if (freshHb) {
        await openEditorForHandbook(freshHb)
      }
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (!isSupabaseConfigured) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">Supabase not configured.</div>

  // ── LIST VIEW ───────────────────────────────────────────────────────────
  if (view === 'list') {
    const totalHbPages = Math.ceil(workflowHandbooks.length / HB_ITEMS_PER_PAGE)
    const currentHandbooks = workflowHandbooks.slice((hbPage - 1) * HB_ITEMS_PER_PAGE, hbPage * HB_ITEMS_PER_PAGE)

    return (
      <>
        {showKeywordModal && (
          <KeywordModal
            value={keywordInput}
            onChange={setKeywordInput}
            onConfirm={confirmAddManualKeyword}
            onCancel={() => setShowKeywordModal(false)}
          />
        )}
        {pendingDeleteHandbook && (
          <ConfirmModal
            nodeId={`Handbook: ${pendingDeleteHandbook.title} (${pendingDeleteHandbook.academic_years?.year_name || 'Unknown Year'})`}
            onConfirm={handleDeleteHandbook}
            onCancel={() => setPendingDeleteHandbook(null)}
          />
        )}
        <header className="unified-header">
          <div className="unified-header-content flex items-center justify-between">
            <div>
              <h1 className="unified-header-title">Policy Management</h1>
              <p className="unified-header-subtitle">Review and update institutional documents</p>
            </div>
            <button 
              type="button" 
              onClick={() => setShowCreateForm(true)} 
              className="px-4 py-2 bg-white text-dyci-blue rounded-full text-xs font-bold uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm flex items-center gap-2"
            >
              <FaPlus className="text-[10px]" /> 
              <span>New handbook</span>
            </button>
          </div>
        </header>

        <main className="unified-main">
          {loading && <div className="flex items-center justify-center py-16 text-slate-400"><FaSpinner className="animate-spin mr-2" /> Loading…</div>}
          {!loading && workflowHandbooks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl bg-white">
              <FaBook className="h-12 w-12 mb-4 text-slate-200" />
              <p className="text-sm font-medium text-slate-600 mb-1">No handbooks found.</p>
              <p className="text-xs text-slate-400 mb-4">Get started by creating your first handbook.</p>
              <button type="button" onClick={() => setShowCreateForm(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm"><FaPlus className="text-xs" /> Create Handbook</button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {currentHandbooks.map((h) => {
              const sideColor = h.status === 'published' ? 'border-l-emerald-500' :
                h.status === 'pending_approval' ? 'border-l-amber-500' :
                  h.status === 'pending_final_review' ? 'border-l-violet-600' :
                    h.status === 'rejected' ? 'border-l-rose-500' :
                      'border-l-slate-300';
              return (
                <div key={h.id} className={`relative rounded-2xl border-y border-r border-y-slate-200 border-r-slate-200 border-l-[6px] ${sideColor} bg-white shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col`}>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-slate-900 truncate">{h.title}</h3><p className="text-xs text-slate-500 mt-1">{h.academic_years?.year_name || 'Unknown Year'}</p></div>
                    <button type="button" onClick={() => setCardMenuOpenId(cardMenuOpenId === h.id ? null : h.id)} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"><FaEllipsisV className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColors[h.status] ?? 'bg-slate-100 text-slate-600'}`}>{h.status}</span>
                    {h.publish_at && <span className="inline-flex items-center gap-1 text-[10px] text-slate-500"><FaCalendarAlt className="h-2.5 w-2.5" /> {new Date(h.publish_at).toLocaleDateString()}</span>}
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">Updated {new Date(h.updated_at).toLocaleString()}</p>

                  {cardMenuOpenId === h.id && h.status === 'published' && (
                    <div className="absolute right-3 top-12 z-10 w-52 rounded-2xl border border-slate-200 bg-white shadow-lg py-1">
                      <button type="button" onClick={() => openEditorForHandbook(h)} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">View contents (Read Only)</button>
                      <button type="button" onClick={() => openMonitor(h)} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">View approval status</button>
                      <button type="button" onClick={() => { setCloneHandbookTarget(h); setCardMenuOpenId(null) }} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-1"><FaExchangeAlt className="text-blue-500 text-[10px]" /> Clone to new year</button>
                      <div className="border-t border-slate-100 my-1" />
                      <div className="px-3 py-1 text-[10px] text-amber-600 bg-amber-50">🔒 Published handbook is locked and archived.</div>
                    </div>
                  )}

                  {cardMenuOpenId === h.id && h.status !== 'published' && (
                    <div className="absolute right-3 top-12 z-10 w-52 rounded-2xl border border-slate-200 bg-white shadow-lg py-1">
                      <button type="button" onClick={() => openEditorForHandbook(h)} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">Edit contents</button>
                      <button type="button" onClick={() => openAssignmentForHandbook(h)} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">Assign Departments</button>
                      <button type="button" onClick={() => { setScheduleHandbookTarget(h); setCardMenuOpenId(null) }} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">Schedule publish date</button>
                      <button type="button" onClick={() => handlePublishNow(h.id)} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">Publish now</button>
                      <button type="button" onClick={() => openMonitor(h)} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">View approval status</button>
                      {h.status !== 'draft' && (
                        <button type="button" onClick={() => { setCloneHandbookTarget(h); setCardMenuOpenId(null) }} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-1"><FaExchangeAlt className="text-blue-500 text-[10px]" /> Clone to new year</button>
                      )}
                      <div className="border-t border-slate-100 my-1" />
                      <button type="button" onClick={() => { setPendingDeleteHandbook(h); setCardMenuOpenId(null) }} className="w-full text-left px-3 py-2 text-xs text-rose-600 hover:bg-rose-50">Delete handbook</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {totalHbPages > 0 && (
            <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-6 pb-2">
              <button type="button" onClick={() => { setHbPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }} disabled={hbPage === 1} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Previous</button>
              <span className="text-sm text-slate-500 font-medium">Page {hbPage} of {totalHbPages}</span>
              <button type="button" onClick={() => { setHbPage(p => Math.min(totalHbPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }} disabled={hbPage === totalHbPages} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Next</button>
            </div>
          )}
        </main>

        {showCreateForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Create handbook</h2>
              <input value={newHandbookTitle} onChange={(e) => setNewHandbookTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-500">Academic Year</span>
                <select
                  value={newAcademicYearId}
                  onChange={(e) => setNewAcademicYearId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="" disabled>Select Year</option>
                  {academicYears.map(y => (
                    <option key={y.id} value={y.id}>
                      {y.year_name} {y.is_current ? '(Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateForm(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="button" onClick={handleCreateHandbook} disabled={workflowSaving || !newHandbookTitle.trim() || !newAcademicYearId.trim()} className="px-4 py-2 rounded-lg bg-blue-700 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed">{workflowSaving ? 'Creating…' : 'Create'}</button>
              </div>
            </div>
          </div>
        )}

        {scheduleHandbookTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Schedule publish</h2>
              <p className="text-xs text-slate-500">{scheduleHandbookTarget.title} ({scheduleHandbookTarget.academic_years?.year_name || 'Unknown Year'})</p>
              <input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setScheduleHandbookTarget(null); setPublishAt('') }} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="button" onClick={handleSchedulePublish} disabled={!publishAt} className="px-4 py-2 rounded-lg bg-blue-700 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed">Save</button>
              </div>
            </div>
          </div>
        )}

        {cloneHandbookTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Clone handbook</h2>
              <p className="text-xs text-slate-500 mt-1">Create a new draft version from "{cloneHandbookTarget.title}"</p>
              <input value={cloneHandbookTitle} onChange={(e) => setCloneHandbookTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none" />
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-500">Target Academic Year</span>
                <select
                  value={cloneAcademicYearId}
                  onChange={(e) => setCloneAcademicYearId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="" disabled>Select Year</option>
                  {academicYears.map(y => (
                    <option key={y.id} value={y.id}>
                      {y.year_name} {y.is_current ? '(Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setCloneHandbookTarget(null); setCloneHandbookTitle(''); setCloneAcademicYearId('') }} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="button" onClick={handleCloneHandbook} disabled={workflowSaving || !cloneHandbookTitle.trim() || !cloneAcademicYearId} className="px-4 py-2 rounded-lg bg-blue-700 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                  {workflowSaving ? <FaSpinner className="animate-spin text-xs" /> : null}
                  <span>{workflowSaving ? 'Cloning…' : 'Clone'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // ── ASSIGNMENT VIEW ──────────────────────────────────────────────────────
  if (view === 'assignment') {
    const totalAssignmentPages = Math.ceil(approvalMonitor.length / ASSIGNMENT_ITEMS_PER_PAGE)
    const currentAssignmentRows = approvalMonitor.slice((assignmentPage - 1) * ASSIGNMENT_ITEMS_PER_PAGE, assignmentPage * ASSIGNMENT_ITEMS_PER_PAGE)

    return (
      <>
        <header className="unified-header">
          <div className="unified-header-content flex items-center gap-4">
            <button 
              type="button" 
              onClick={() => setView('list')} 
              className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
              <FaArrowLeft className="h-3 w-3" />
            </button>
            <div>
              <h1 className="unified-header-title">Departmental Review Setup</h1>
              <p className="unified-header-subtitle">{editingHandbookLabel}</p>
            </div>
          </div>
        </header>

        <main className="unified-main">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4 shadow-sm">
            <p className="text-sm text-slate-600 font-medium mb-1">Select departments responsible for approving each section.</p>
            <p className="text-[11px] text-slate-500">Changes are saved automatically when you toggle a department. Only sections in Draft or Departmental Review can have their assignments updated.</p>
          </div>
          {approvalMonitorLoading && <div className="flex items-center justify-center py-16 text-slate-400"><FaSpinner className="animate-spin mr-2" /> Loading sections...</div>}
          {!approvalMonitorLoading && approvalMonitor.length === 0 && <p className="text-sm text-slate-500 py-10 text-center">No sections found for this handbook.</p>}

          <div className="grid grid-cols-1 gap-4">
            {currentAssignmentRows.map((row) => (
              <div key={row.section_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="w-full sm:w-1/3 pr-4">
                  <h3 className="text-sm font-semibold text-slate-900 line-clamp-2">{row.sort_order}. {row.section_title || `Section ${row.sort_order}`}</h3>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`text-[10px] rounded-full px-2 py-0.5 font-semibold ${statusColors[row.section_status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {row.section_status || 'draft'}
                    </span>
                  </div>
                </div>
                <div className="w-full sm:w-2/3 border-t sm:border-t-0 sm:border-l border-slate-100 pt-3 sm:pt-0 sm:pl-5">
                  <div className="flex flex-wrap gap-2">
                    {collegeOffices.filter(o => o.level === 2).map(office => {
                      const pos = office.slug as ApproverPosition
                      const isAssigned = row.required_positions.includes(pos)
                      const disabled = row.current_level > 1
                      return (
                        <label key={pos} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors select-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${isAssigned ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={isAssigned}
                            disabled={disabled}
                            onChange={() => !disabled && handleBulkAssignmentToggle(row.section_id, pos, row.required_positions)}
                          />
                          {office.name}
                        </label>
                      )
                    })}
                  </div>
                  {row.section_status === 'draft' && (
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleAssignmentSubmitSingle(row.section_id)}
                        disabled={workflowSaving || row.required_positions.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                      >
                        {workflowSaving ? <FaSpinner className="animate-spin text-[10px]" /> : <FaPaperPlane className="text-[10px]" />} Submit for Review
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {totalAssignmentPages > 0 && (
            <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-6 pb-2">
              <button type="button" onClick={() => { setAssignmentPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }} disabled={assignmentPage === 1} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Previous</button>
              <span className="text-sm text-slate-500 font-medium">Page {assignmentPage} of {totalAssignmentPages}</span>
              <button type="button" onClick={() => { setAssignmentPage(p => Math.min(totalAssignmentPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }} disabled={assignmentPage === totalAssignmentPages} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Next</button>
            </div>
          )}
        </main>
      </>
    )
  }

  // ── MONITOR VIEW ────────────────────────────────────────────────────────
  if (view === 'monitor') {
    const totalMonitorPages = Math.ceil(approvalMonitor.length / MONITOR_ITEMS_PER_PAGE)
    const currentMonitorRows = approvalMonitor.slice((monitorPage - 1) * MONITOR_ITEMS_PER_PAGE, monitorPage * MONITOR_ITEMS_PER_PAGE)

    return (
      <>
        <header className="unified-header">
          <div className="unified-header-content flex items-center gap-4">
            <button 
              type="button" 
              onClick={() => setView('list')} 
              className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
              <FaArrowLeft className="h-3 w-3" />
            </button>
            <div>
              <h1 className="unified-header-title">Review Tracking</h1>
              <p className="unified-header-subtitle">{editingHandbookLabel}</p>
            </div>
          </div>
        </header>

        <main className="unified-main">
          {/* Executive Approval Banner for Academic Admin */}
          {Object.values(handbookApprovals).some(a => a.approved) && (
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

          {approvalMonitorLoading && <p className="text-sm text-slate-500">Loading...</p>}
          {!approvalMonitorLoading && approvalMonitor.length === 0 && <p className="text-sm text-slate-500">No sections yet.</p>}
          {currentMonitorRows.map((row) => (
            <div key={row.section_id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{row.sort_order}. {row.section_title}</p>
                <div className="flex items-center gap-2">
                  <ProgressBar currentLevel={row.current_level} />
                  <span className={`text-[10px] rounded-full px-2 py-0.5 font-semibold ${statusColors[row.section_status] ?? 'bg-slate-100 text-slate-600'}`}>{row.section_status}</span>
                  {row.required_positions.every(p => row.approvals.some(a => a.position === p && a.decision === 'approved')) && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold">
                      <FaCheckDouble className="text-[8px]" /> Ready for Executive Review
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-500 italic">Assigned: {row.required_positions.length > 0 ? row.required_positions.map(p => collegeOffices.find(o => o.slug === p)?.name || p).join(', ') : '—'}</p>
              {row.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase mr-1">Keywords:</span>
                  {row.keywords.map((kw, i) => (
                    <span key={i} className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">{kw}</span>
                  ))}
                </div>
              )}
              {row.approvals.length === 0 ? <p className="text-xs text-slate-400">No decisions yet.</p> : (
                <div className="space-y-1">{row.approvals.map((a, idx) => (
                  <div key={`${a.approver_user_id}-${a.position}-${idx}`} className="text-xs text-slate-600">
                    <span className={`inline-block rounded px-1.5 py-0.5 mr-1 text-[10px] font-semibold ${a.decision === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{a.decision}</span>
                    {collegeOffices.find(o => o.slug === a.position)?.name || a.position} — {a.approver_name}
                    {a.decided_at ? ` — ${new Date(a.decided_at).toLocaleString()}` : ''}
                    {a.comment ? ` — "${a.comment}"` : ''}
                  </div>
                ))}</div>
              )}
            </div>
          ))}

          {totalMonitorPages > 0 && (
            <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-6 pb-2">
              <button type="button" onClick={() => { setMonitorPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }} disabled={monitorPage === 1} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Previous</button>
              <span className="text-sm text-slate-500 font-medium">Page {monitorPage} of {totalMonitorPages}</span>
              <button type="button" onClick={() => { setMonitorPage(p => Math.min(totalMonitorPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }} disabled={monitorPage === totalMonitorPages} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Next</button>
            </div>
          )}
        </main>
      </>
    )
  }

  // ── EDITOR VIEW ─────────────────────────────────────────────────────────
  return (
    <>
      {showKeywordModal && (
        <KeywordModal
          value={keywordInput}
          onChange={setKeywordInput}
          onConfirm={confirmAddManualKeyword}
          onCancel={() => setShowKeywordModal(false)}
        />
      )}
      {pendingDelete && <ConfirmModal nodeId={pendingDelete} onConfirm={confirmDelete} onCancel={() => setPendingDelete(null)} />}
      <header className="unified-header">
        <div className="unified-header-content flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              type="button" 
              onClick={() => { setView('list'); loadWorkflowHandbooks() }} 
              className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
              <FaArrowLeft className="h-3 w-3" />
            </button>
            <div>
              <h1 className="unified-header-title">Policy Editor</h1>
              <p className="unified-header-subtitle">{editingHandbookLabel || 'Edit handbook content'}</p>
            </div>
          </div>
          {activeHandbook?.status !== 'published' && (
            <div className="flex items-center gap-2">
              <button 
                onClick={handleAddRoot} 
                className="px-4 py-2 bg-white/10 text-white border border-white/20 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-white/20 transition-all"
              >
                <FaPlus className="text-[10px] inline mr-2" /> 
                Add Chapter
              </button>
              <button 
                onClick={handleSave} 
                disabled={saving || !selectedNode} 
                className="px-4 py-2 bg-white text-dyci-blue rounded-full text-xs font-bold uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving ? <FaSpinner className="text-[10px] animate-spin" /> : <FaSave className="text-[10px]" />} 
                <span>{saving ? 'Saving…' : 'Save Node'}</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="unified-main grid grid-cols-12 gap-4 h-[calc(100vh-140px)]">
        {/* Sidebar */}
        <aside className="col-span-12 md:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex flex-col gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Structure</span>
            <input type="text" placeholder="Search sections..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400" />
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {loading && <div className="flex items-center justify-center py-10 text-slate-400"><FaSpinner className="animate-spin mr-2" /> Loading…</div>}
            {!loading && filteredTree.length === 0 && <p className="text-xs text-slate-400 italic text-center py-6">No chapters or matches found.</p>}
            {!loading && filteredTree.map((node) => <TreeNode key={node.id} node={node} selectedId={selectedId} onSelect={setSelectedId} onAddChild={handleAddChild} onDelete={(id) => setPendingDelete(id)} isPublished={activeHandbook?.status === 'published'} />)}
          </div>
        </aside>

        {/* Editor + Workflow panel */}
        <section className="col-span-12 md:col-span-9 flex flex-col gap-3 overflow-y-auto">
          {!selectedNode && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
              <FaBook className="h-10 w-10 mb-3 opacity-20" /><p>Select a node to edit</p>
            </div>
          )}

          {selectedNode && (
            <>
              {/* Progress bar for sections */}
              {sectionMeta && (
                <div className="bg-white rounded-2xl border border-slate-200 p-3 flex items-center justify-between gap-3">
                  <ProgressBar currentLevel={sectionMeta.current_level} />
                  <span className={`text-[10px] rounded-full px-2 py-0.5 font-semibold ${statusColors[sectionMeta.status] ?? 'bg-slate-100 text-slate-600'}`}>{sectionMeta.status}</span>
                </div>
              )}

              {/* Title Editor Card */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 shrink-0 flex flex-col gap-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Title</label>
                <input
                  type="text"
                  readOnly={activeHandbook?.status === 'published'}
                  value={localTitle}
                  onChange={(e) => { setLocalTitle(e.target.value); handleFieldChange('title', e.target.value) }}
                  className={`w-full text-lg font-bold border-none px-0 focus:ring-0 outline-none placeholder-slate-300 ${activeHandbook?.status === 'published' ? 'text-slate-500 cursor-not-allowed bg-transparent' : 'text-slate-800'}`}
                  placeholder="Section title…"
                />
              </div>

              {/* Rich text body editor Card */}
              <div className="flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden shrink-0">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-700">{selectedNode.depth === 0 ? 'Chapter Content' : 'Section Content'}</span>
                    <span className="text-slate-300">|</span>
                    <span className="text-xs text-slate-500 font-mono">{selectedNode.id}</span>
                  </div>
                  {/* Inline formatting toolbar right in the header */}
                  {activeHandbook?.status !== 'published' && (
                    <div className="flex items-center gap-1">
                      {[{ cmd: 'bold', icon: <FaBold />, title: 'Bold' }, { cmd: 'italic', icon: <FaItalic />, title: 'Italic' }, { cmd: 'underline', icon: <FaUnderline />, title: 'Underline' }].map(({ cmd, icon, title }) => (
                        <button key={cmd} title={title} onMouseDown={(e) => { e.preventDefault(); execCmd(cmd) }} className="p-1.5 rounded hover:bg-slate-200 text-slate-600 text-xs">{icon}</button>
                      ))}
                      <div className="w-px h-4 bg-slate-200 mx-1" />
                      <button title="Bullet list" onMouseDown={(e) => { e.preventDefault(); editorRef.current?.focus(); document.execCommand('insertHTML', false, '<ul><li></li></ul>'); handleEditorInput() }} className="p-1.5 rounded hover:bg-slate-200 text-slate-600 text-xs"><FaListUl /></button>
                      <button title="Numbered list" onMouseDown={(e) => { e.preventDefault(); editorRef.current?.focus(); document.execCommand('insertHTML', false, '<ol><li></li></ol>'); handleEditorInput() }} className="p-1.5 rounded hover:bg-slate-200 text-slate-600 text-xs"><FaListOl /></button>
                    </div>
                  )}
                </div>
                <div className="relative">
                  {(!selectedNode.content || selectedNode.content.trim() === '' || selectedNode.content.trim() === '<p><br></p>' || selectedNode.content.trim() === '<br>') && (
                    <div className="absolute top-0 left-0 px-6 py-5 text-base text-slate-400 pointer-events-none">
                      Type information here...
                    </div>
                  )}
                  <div
                    ref={editorRef}
                    contentEditable={activeHandbook?.status !== 'published'}
                    suppressContentEditableWarning
                    onInput={handleEditorInput}
                    onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertHTML', false, '\u00a0\u00a0\u00a0\u00a0'); handleEditorInput() } }}
                    className={`px-6 py-5 text-base text-slate-700 leading-relaxed focus:outline-none prose prose-sm prose-slate max-w-none relative overflow-y-auto h-auto ${activeHandbook?.status === 'published' ? 'cursor-not-allowed text-slate-600' : ''}`}
                    style={{ minHeight: '100px', maxHeight: '300px' }}
                  />
                </div>
              </div>

              {/* Workflow panel (only for depth>0 sections) */}
              {sectionMeta && selectedNode.depth > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-5">
                  {/* Keyword management container */}
                  <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-tight">Support Chat Keywords</h4>
                        <p className="text-[10px] text-slate-500 mt-0.5">Keywords that trigger this section in support chat</p>
                      </div>
                      {activeHandbook?.status !== 'published' && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleGenerateKeywords}
                            disabled={generatingKeywords}
                            className="px-2.5 py-1.5 rounded-lg bg-white border border-blue-200 text-[10px] font-bold text-blue-700 hover:bg-blue-50 flex items-center gap-1.5 shadow-sm transition-all"
                          >
                            {generatingKeywords ? <FaSpinner className="animate-spin" /> : <FaPlus className="text-[9px]" />}
                            AI Generate
                          </button>
                          <button
                            type="button"
                            onClick={handleAddManualKeyword}
                            className="px-2.5 py-1.5 rounded-lg bg-blue-700 text-[10px] font-bold text-white hover:bg-blue-800 flex items-center gap-1.5 shadow-sm transition-all"
                          >
                            <FaPlus className="text-[9px]" />
                            Add Manual
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5 min-h-[40px] p-2 rounded-lg bg-white/50 border border-slate-100">
                      {currentKeywords.length === 0 && (
                        <p className="text-[10px] text-slate-400 italic self-center px-1">No keywords defined yet. Click "AI Generate" or add manually.</p>
                      )}
                      {currentKeywords.map((k) => (
                        <div key={k} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white border border-slate-200 text-[11px] text-slate-700 group hover:border-blue-300 transition-colors shadow-sm">
                          <span>{k}</span>
                          {activeHandbook?.status !== 'published' && (
                            <button
                              type="button"
                              onClick={() => handleRemoveKeyword(k)}
                              className="text-slate-300 hover:text-rose-500 transition-colors"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Department assignment */}
                  <div>
                    <h4 className="text-xs font-semibold text-slate-700 mb-2">Assign to Departments</h4>
                    <div className="flex flex-wrap gap-2">
                      {collegeOffices.filter(o => o.level === 2).map((office) => {
                        const pos = office.slug as ApproverPosition
                        return (
                          <label key={pos} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors ${sectionAssignments.includes(pos) ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'} ${activeHandbook?.status === 'published' ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}>
                            <input type="checkbox" className="sr-only" checked={sectionAssignments.includes(pos)} disabled={activeHandbook?.status === 'published'} onChange={() => activeHandbook?.status !== 'published' && setPendingAssignmentToggle(pos)} />
                            {office.name}
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {/* Legacy text + assign actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {sectionMeta.legacy_content && (
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full ring-1 ring-emerald-200">Baseline sync confirmed</span>
                    )}
                  </div>

                  {/* Change reason (from L2) */}
                  {sectionMeta.change_reason && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <h5 className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Change Reason (from Department)</h5>
                      <p className="text-xs text-slate-700">{sectionMeta.change_reason}</p>
                    </div>
                  )}

                  {/* Audit trail toggle */}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowAudit(!showAudit)} className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900">
                      <FaHistory className="h-3 w-3" /> {showAudit ? 'Hide' : 'Show'} audit trail
                    </button>
                    {sectionMeta.legacy_content && (
                      <button type="button" onClick={() => setShowDiff(!showDiff)} className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900">
                        <FaExchangeAlt className="h-3 w-3" /> {showDiff ? 'Hide' : 'Show'} version compare
                      </button>
                    )}
                  </div>

                  {showAudit && (
                    <div className="rounded-lg border border-slate-200 p-4 bg-slate-50/50 space-y-4">
                      <h5 className="text-[10px] font-semibold text-slate-500 uppercase flex items-center gap-1.5"><FaHistory /> Audit Timeline</h5>
                      {auditTrail.length === 0 && <p className="text-xs text-slate-400 italic">No decisions yet.</p>}
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
                              <div className="mt-1">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold border ${e.decision === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>{e.decision}</span>
                              </div>
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

                  {showDiff && diffData && (
                    <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                      <h5 className="text-[10px] font-semibold text-slate-500 uppercase">Version Compare (Legacy vs New)</h5>
                      <div className="text-xs leading-relaxed text-slate-700">
                        {wordDiff(diffData.legacy_content ?? '', diffData.content).map((seg, i) => (
                          <span key={i} className={
                            seg.type === 'del' ? 'bg-rose-100 text-rose-800 line-through mx-0.5' :
                              seg.type === 'add' ? 'bg-emerald-100 text-emerald-800 mx-0.5' : ''
                          }>{seg.text} </span>
                        ))}
                      </div>
                      {diffData.change_reason && (
                        <p className="text-[10px] text-slate-500 mt-1">Change reason: {diffData.change_reason}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* Assignment confirmation modal */}
      {pendingAssignmentToggle && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xl max-w-sm w-full animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-sm font-bold text-slate-800 mb-2">Update Department Assignment?</h3>
            <p className="text-xs text-slate-600 mb-6">Are you sure you want to change the department assignment for this section? This will immediately sync and notify the relevant department approvers.</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingAssignmentToggle(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const pos = pendingAssignmentToggle
                  setPendingAssignmentToggle(null)
                  await handleAssignmentToggle(pos)
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm"
              >
                Confirm Update
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generated Keywords review/download modal */}
      {generatedKeywordsReview && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xl max-w-md w-full animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-sm font-bold text-slate-800 mb-2">Review Suggested Keywords</h3>
            <p className="text-xs text-slate-600 mb-4">Review the AI-generated keywords before saving. Accepting them will automatically download a keywords file.</p>
            
            <div className="flex flex-wrap gap-1.5 min-h-[60px] p-3 rounded-xl bg-slate-50 border border-slate-100 max-h-[140px] overflow-y-auto mb-6">
              {generatedKeywordsReview.map((kw, i) => (
                <span key={i} className="inline-flex items-center px-2 py-0.5 rounded bg-white border border-slate-200 text-xs text-slate-700">{kw}</span>
              ))}
            </div>

            <div className="flex justify-between items-center">
              <button
                type="button"
                onClick={async () => {
                  setGeneratedKeywordsReview(null)
                  await handleGenerateKeywords()
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
              >
                Regenerate
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setGeneratedKeywordsReview(null)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={acceptGeneratedKeywords}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Accept
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default Cms
