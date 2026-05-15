import { supabase } from '../supabaseClient'
import {
  notifyRole,
  notifyPosition,
  notifyAllVerifiedUsers
} from './notifications'
import { formatLevel, formatRole, L2_POSITIONS, L3_POSITIONS } from '../../utils/roleUtils'

// ── Types ─────────────────────────────────────────────────────────────────

export type HandbookStatus = 'draft' | 'pending_approval' | 'pending_final_review' | 'published' | 'rejected'
export type SectionStatus = 'draft' | 'dept_review' | 'dept_approved' | 'published'

export type ApproverPosition =
  | 'scholarship'
  | 'finance'
  | 'registrar'
  | 'guidance'
  | 'property_security'
  | 'academic_council'
  | 'president'
  | 'vice_president'

export interface CollegeOffice {
  id: string
  name: string
  slug: string
  level: number
  is_active: boolean
  sort_order: number
}

export const ALL_POSITIONS: ApproverPosition[] = [...L2_POSITIONS, ...L3_POSITIONS]

/**
 * Fetch all dynamic college offices from the database.
 * This replaces the hardcoded L2_POSITIONS constants.
 */
export async function fetchCollegeOffices() {
  const { data, error } = await supabase
    .from('college_offices')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  return { data: data as CollegeOffice[] | null, error }
}

export function positionToLevel(position: ApproverPosition): number {
  if (L2_POSITIONS.includes(position)) return 2
  if (L3_POSITIONS.includes(position)) return 3
  return 0
}

export interface Handbook {
  id: string
  title: string
  academic_year_id: string
  academic_years?: {
    year_name: string
  }
  status: HandbookStatus
  publish_at: string | null
  published_at: string | null
  school_year_locked: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface HandbookSection {
  id: string
  handbook_id: string
  title: string
  content: string
  legacy_content: string | null
  current_level: number
  workflow_stage_id: string
  change_reason: string | null
  sort_order: number
  status: SectionStatus
  is_locked: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface HandbookSectionInput {
  title: string
  content: string
  sort_order: number
  parent_id?: string | null
}

export interface SectionApproval {
  id: string
  handbook_section_id: string
  approver_user_id: string
  position: ApproverPosition
  workflow_stage_id: string
  decision: 'approved' | 'rejected'
  comment: string | null
  decided_at: string
}

export interface AuditTrailEntry {
  id: string
  position: ApproverPosition
  workflow_stage_id: string
  decision: 'approved' | 'rejected'
  comment: string | null
  decided_at: string
  approver_name: string
  approver_email: string
}

export interface HandbookApprovalMonitorRow {
  section_id: string
  section_title: string
  section_status: string
  sort_order: number
  current_level: number
  required_positions: ApproverPosition[]
  keywords: string[]
  approvals: Array<{
    handbook_section_id: string
    position: ApproverPosition
    workflow_stage_id: string
    decision: 'approved' | 'rejected'
    comment: string | null
    decided_at: string
    approver_user_id: string
    approver_name: string
    approver_email: string
  }>
}

// ── Labels ────────────────────────────────────────────────────────────────

export function approverLabel(position: ApproverPosition): string {
  return formatRole('staff', { position })
}

export function levelLabel(level: number): string {
  return formatLevel(level)
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id ?? null
}

export async function logForensicActivity(
  action: 'INSERT' | 'UPDATE' | 'DELETE',
  tableName: string,
  recordId: string,
  oldData?: any,
  newData?: any
) {
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

const DEPT_TO_POSITION: Record<string, ApproverPosition> = {
  'Scholarship': 'scholarship',
  'Department of Finance': 'finance',
  'Office of the Registrar': 'registrar',
  'Guidance Office': 'guidance',
  'Property/Security Office': 'property_security',
  'Academic Council': 'academic_council',
  'Office of the President': 'president',
  'Office of the Vice President': 'vice_president',
}

let cachedOffices: { name: string; slug: string }[] = []

supabase
  .from('college_offices')
  .select('name, slug')
  .then(({ data }) => {
    if (data) cachedOffices = data
  })

export function derivePositionFromProfile(profile: {
  approver_position?: string | null
  department?: string | null
}): ApproverPosition | null {
  if (profile.approver_position && profile.approver_position.trim().length > 0) {
    return profile.approver_position as ApproverPosition
  }
  if (profile.department) {
    const matched = cachedOffices.find(o => o.name === profile.department)
    if (matched) return matched.slug as ApproverPosition

    return DEPT_TO_POSITION[profile.department] ?? null
  }
  return null
}

// ── Pending Approval Count ─────────────────────────────────────────────────

export async function fetchPendingApprovalCount(position: ApproverPosition): Promise<number> {
  try {
    // Get section IDs assigned to this position
    const { data: reqs, error: reqsError } = await supabase
      .from('handbook_approval_requirements')
      .select('handbook_section_id')
      .eq('required_position', position)

    if (reqsError || !reqs || reqs.length === 0) return 0

    const sectionIds = reqs.map(r => r.handbook_section_id)

    // Get sections at dept_review status that haven't been approved by this position yet
    const { data: approved } = await supabase
      .from('handbook_approvals')
      .select('handbook_section_id')
      .eq('position', position)
      .eq('decision', 'approved')
      .in('handbook_section_id', sectionIds)

    const approvedIds = new Set((approved || []).map(a => a.handbook_section_id))
    const pendingIds = sectionIds.filter(id => !approvedIds.has(id))

    // Filter to only sections currently at dept_review
    const { data: sections, error } = await supabase
      .from('handbook_sections')
      .select('id')
      .eq('status', 'dept_review')
      .in('id', pendingIds)

    if (error) {
      console.error('Error fetching pending count:', error)
      return 0
    }
    return sections?.length || 0
  } catch (err) {
    console.error('Error in fetchPendingApprovalCount:', err)
    return 0
  }
}

// ── Helper Notifications ──────────────────────────────────────────────────
// These bridge the gaps for specific workflow logic

async function notifyAdmins(message: string, actionUrl: string) {
  return notifyRole('academic_admin', 'Handbook Workflow', message, actionUrl)
}

async function notifyAssignedL2(sectionId: string, message: string, actionUrl: string) {
  const { data: reqs } = await supabase
    .from('handbook_approval_requirements')
    .select('required_position')
    .eq('handbook_section_id', sectionId)
  if (!reqs) return
  for (const r of reqs) {
    if (L2_POSITIONS.includes(r.required_position as ApproverPosition)) {
      await notifyPosition(r.required_position as ApproverPosition, 'Handbook Workflow', message, actionUrl)
    }
  }
}

// ── Handbook CRUD ─────────────────────────────────────────────────────────

export async function fetchHandbooks() {
  const { data, error } = await supabase
    .from('handbooks')
    .select('*, academic_years(year_name)')
    .order('updated_at', { ascending: false })
  return { data: (data as Handbook[] | null) ?? null, error: error?.message ?? null }
}

export async function fetchPublishedHandbook(): Promise<{ data: Handbook | null; error: string | null }> {
  const { data, error } = await supabase
    .from('handbooks')
    .select('*, academic_years(year_name)')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: 'No published handbook found.' }
  return { data: data as Handbook, error: null }
}

export async function createHandbook(title: string, academicYearId: string) {
  const userId = await getCurrentUserId()
  if (!userId) return { data: null, error: 'Not authenticated.' }

  // Check if a handbook for this academic year already exists
  const { data: existing, error: checkError } = await supabase
    .from('handbooks')
    .select('id')
    .eq('academic_year_id', academicYearId)
    .maybeSingle()

  if (checkError) return { data: null, error: checkError.message }
  if (existing) return { data: null, error: `A handbook for this academic year already exists.` }

  const { data, error } = await supabase
    .from('handbooks')
    .insert({ title, academic_year_id: academicYearId, created_by: userId, status: 'draft' })
    .select('*')
    .single()
  return { data: (data as Handbook | null) ?? null, error: error?.message ?? null }
}

export async function updateHandbookMeta(
  handbookId: string,
  patch: Partial<Pick<Handbook, 'title' | 'academic_year_id' | 'status'>>
) {
  const { data, error } = await supabase
    .from('handbooks')
    .update(patch)
    .eq('id', handbookId)
    .select('*')
    .single()
  return { data: (data as Handbook | null) ?? null, error: error?.message ?? null }
}

export async function deleteHandbook(handbookId: string) {
  const { error } = await supabase
    .from('handbooks')
    .delete()
    .eq('id', handbookId)
  return { error: error?.message ?? null }
}

// ── Section CRUD ──────────────────────────────────────────────────────────

export async function fetchSections(handbookId: string) {
  const { data, error } = await supabase
    .from('handbook_sections')
    .select('*')
    .eq('handbook_id', handbookId)
    .order('sort_order', { ascending: true })
  return { data: (data as HandbookSection[] | null) ?? null, error: error?.message ?? null }
}

export async function fetchSingleSection(sectionId: string) {
  const { data, error } = await supabase
    .from('handbook_sections')
    .select('*')
    .eq('id', sectionId)
    .single()
  return { data: (data as HandbookSection | null) ?? null, error: error?.message ?? null }
}

export async function replaceHandbookSections(handbookId: string, sections: HandbookSectionInput[]) {
  const userId = await getCurrentUserId()
  if (!userId) return { error: 'Not authenticated.' }
  if (sections.length === 0) return { error: 'No sections to sync.' }

  // Fetch the default stage ID once upfront
  const { data: defaultStage } = await supabase
    .from('workflow_stages')
    .select('id')
    .eq('workflow_name', 'handbook_approval')
    .eq('stage_order', 2)
    .single()
  const defaultStageId = defaultStage?.id

  const { data: existing } = await supabase
    .from('handbook_sections')
    .select('id, sort_order')
    .eq('handbook_id', handbookId)

  const existingMap = new Map((existing || []).map((s: any) => [s.sort_order, s.id]))
  const handledIds = new Set<string>()

  for (const s of sections) {
    const existingId = existingMap.get(s.sort_order)
    if (existingId) {
      // Safely update existing without wiping required columns like created_by
      const { error } = await supabase
        .from('handbook_sections')
        .update({
          title: s.title,
          content: s.content,
          legacy_content: s.content,
          parent_id: s.parent_id,
        })
        .eq('id', existingId)

      if (error) return { error: error.message }
      handledIds.add(existingId)
    } else {
      const { data, error } = await supabase
        .from('handbook_sections')
        .insert({
          handbook_id: handbookId,
          title: s.title,
          content: s.content,
          legacy_content: s.content,
          sort_order: s.sort_order,
          parent_id: s.parent_id,
          status: 'draft',
          current_level: 1,
          workflow_stage_id: defaultStageId,
          is_locked: false,
          created_by: userId,
        })
        .select('id')
        .single()

      if (error) return { error: error.message }
      if (data) handledIds.add(data.id)
    }
  }

  const toDelete = (existing || []).map((s: any) => s.id).filter((id: string) => !handledIds.has(id))

  if (toDelete.length > 0) {
    const { error: deleteErr } = await supabase.from('handbook_sections').delete().in('id', toDelete)
    if (deleteErr) return { error: deleteErr.message }
  }

  return { error: null }
}

// ── L1 Admin Actions ──────────────────────────────────────────────────────

export async function assignSectionToDepartments(sectionId: string, positions: ApproverPosition[]) {
  // Clear old assignments
  await supabase
    .from('handbook_approval_requirements')
    .delete()
    .eq('handbook_section_id', sectionId)

  if (positions.length === 0) return { error: null }

  const rows = positions.map((p) => ({
    handbook_section_id: sectionId,
    required_position: p,
  }))
  const { error } = await supabase
    .from('handbook_approval_requirements')
    .insert(rows)
  return { error: error?.message ?? null }
}

export async function fetchSectionAssignments(sectionId: string) {
  const { data, error } = await supabase
    .from('handbook_approval_requirements')
    .select('required_position')
    .eq('handbook_section_id', sectionId)
  return {
    data: (data ?? []).map((r: { required_position: string }) => r.required_position as ApproverPosition),
    error: error?.message ?? null,
  }
}

export async function submitSectionToDeptReview(sectionId: string) {
  const { data: reqs } = await supabase
    .from('handbook_approval_requirements')
    .select('required_position')
    .eq('handbook_section_id', sectionId)

  const deptAssigned = (reqs ?? []).filter((r: { required_position: string }) =>
    L2_POSITIONS.includes(r.required_position as ApproverPosition)
  )
  if (deptAssigned.length === 0) {
    return { error: 'Assign at least one department before submitting.' }
  }

  const { data: stage } = await supabase
    .from('workflow_stages')
    .select('id')
    .eq('workflow_name', 'handbook_approval')
    .eq('stage_order', 2)
    .single()

  const { error } = await supabase
    .from('handbook_sections')
    .update({ workflow_stage_id: stage?.id, status: 'dept_review', current_level: 2 })
    .eq('id', sectionId)
  if (error) return { error: error.message }

  await notifyAssignedL2(sectionId, 'A handbook section has been assigned to your department for review.', '/staff/handbook-approvals')

  return { error: null }
}

/** @deprecated Use submitSectionToDeptReview */
export const submitSectionToL2 = submitSectionToDeptReview

export async function submitAllSectionsToL2(handbookId: string) {
  const { data: sections, error: secErr } = await supabase
    .from('handbook_sections')
    .select('id')
    .eq('handbook_id', handbookId)
    .eq('current_level', 1)
  if (secErr) return { error: secErr.message }
  if (!sections || sections.length === 0) return { error: 'No sections at L1 to submit.' }

  const errors: string[] = []
  for (const s of sections) {
    const res = await submitSectionToDeptReview(s.id)
    if (res.error) errors.push(`${s.id}: ${res.error}`)
  }
  if (errors.length > 0) return { error: errors.join('; ') }

  await supabase
    .from('handbooks')
    .update({ status: 'pending_approval' })
    .eq('id', handbookId)

  return { error: null }
}

// ── L2 Department Actions ─────────────────────────────────────────────────

export async function saveSectionEdit(sectionId: string, content: string, changeReason: string) {
  if (!changeReason.trim()) return { error: 'Change reason is required.' }
  const { error } = await supabase
    .from('handbook_sections')
    .update({ content, change_reason: changeReason.trim() })
    .eq('id', sectionId)
  return { error: error?.message ?? null }
}

export async function approveSectionAtLevel(
  sectionId: string,
  position: ApproverPosition,
  level: number,
  comment?: string
) {
  const userId = await getCurrentUserId()
  if (!userId) return { error: 'Not authenticated.' }

  // Get the section's workflow_stage_id
  const { data: section } = await supabase
    .from('handbook_sections')
    .select('workflow_stage_id, title')
    .eq('id', sectionId)
    .single()

  if (!section?.workflow_stage_id) {
    return { error: 'Section workflow stage not found.' }
  }

  const { error } = await supabase
    .from('handbook_approvals')
    .upsert({
      handbook_section_id: sectionId,
      approver_user_id: userId,
      position,
      workflow_stage_id: section.workflow_stage_id,
      decision: 'approved',
      comment: comment?.trim() || null,
      decided_at: new Date().toISOString(),
    }, { onConflict: 'handbook_section_id,approver_user_id,position,workflow_stage_id' })

  if (error) return { error: error.message }

  await logForensicActivity('INSERT', 'handbook_approvals', sectionId, null, {
    position,
    decision: 'approved',
    section_title: section?.title || 'a section'
  })

  const sectionTitle = section?.title ?? 'a section'

  if (level === 2) {
    await notifyAdmins(`Update: ${approverLabel(position)} approved "${sectionTitle}".`, '/admin/cms')

    // Check if the whole handbook is now ready for final sign-off (all sections approved at L2)
    const { data: sectionData } = await supabase
      .from('handbook_sections')
      .select('handbook_id')
      .eq('id', sectionId)
      .single()

    if (sectionData?.handbook_id) {
      const { data: sections } = await supabase
        .from('handbook_sections')
        .select('id, status')
        .eq('handbook_id', sectionData.handbook_id)

      const allL2Approved = sections?.every(s => s.status === 'approved' || s.status === 'published')
      if (allL2Approved) {
        await notifyPosition('president', 'Handbook Update: All sections have been approved by departments and are ready for final executive sign-off.', '/staff/handbook-approvals')
        await notifyPosition('vp_academic', 'Handbook Update: All sections have been approved by departments and are ready for final executive sign-off.', '/staff/handbook-approvals')
      }
    }
  }

  return { error: null }
}

export async function rejectSectionAtLevel(
  sectionId: string,
  position: ApproverPosition,
  level: number,
  comment: string
) {
  const userId = await getCurrentUserId()
  if (!userId) return { error: 'Not authenticated.' }
  if (!comment.trim()) return { error: 'A comment is required when rejecting.' }

  // Get the section's workflow_stage_id
  const { data: section } = await supabase
    .from('handbook_sections')
    .select('workflow_stage_id, title')
    .eq('id', sectionId)
    .single()

  if (!section?.workflow_stage_id) {
    return { error: 'Section workflow stage not found.' }
  }

  const { error } = await supabase
    .from('handbook_approvals')
    .upsert({
      handbook_section_id: sectionId,
      approver_user_id: userId,
      position,
      workflow_stage_id: section.workflow_stage_id,
      decision: 'rejected',
      comment: comment.trim(),
      decided_at: new Date().toISOString(),
    }, { onConflict: 'handbook_section_id,approver_user_id,position,workflow_stage_id' })

  if (error) return { error: error.message }

  await logForensicActivity('INSERT', 'handbook_approvals', sectionId, null, {
    position,
    decision: 'rejected',
    section_title: section?.title || 'a section'
  })

  const sectionTitle = section?.title ?? 'a section'

  if (level === 2) {
    await notifyAdmins(`Alert: "${sectionTitle}" returned by department reviewer.`, '/admin/cms')
  } else if (level === 3) {
    await notifyAssignedL2(sectionId, `Final Reviewer rejected "${sectionTitle}". Please re-review.`, '/staff/handbook-approvals')
  }

  return { error: null }
}

// ── Level 3 Final Sign-off ────────────────────────────────────────────────

export async function approveEntireHandbook(handbookId: string) {
  const { error } = await supabase.rpc('approve_entire_handbook', { handbook_uuid: handbookId })
  if (error) return { error: error.message }

  await notifyAdmins('The handbook has been fully approved and published.', '/admin/cms')
  return { error: null }
}

// ── Approval Queue (for approver pages) ───────────────────────────────────

export async function fetchApproverQueue(position: ApproverPosition) {
  const { data, error } = await supabase
    .from('handbook_approval_requirements')
    .select(`
      handbook_section_id,
      required_position,
      handbook_sections!inner(
        id, title, content, legacy_content, status, is_locked, 
        handbook_id, sort_order, change_reason, current_level,
        handbook_keywords(keyword)
      )
    `)
    .eq('required_position', position)
  return { data: data ?? null, error: error?.message ?? null }
}

// ── Audit Trail ───────────────────────────────────────────────────────────

export async function fetchSectionAuditTrail(sectionId: string): Promise<{ data: AuditTrailEntry[] | null; error: string | null }> {
  const { data: approvals, error } = await supabase
    .from('handbook_approvals')
    .select('id, position, workflow_stage_id, decision, comment, decided_at, approver_user_id')
    .eq('handbook_section_id', sectionId)
    .order('decided_at', { ascending: true })

  if (error) return { data: null, error: error.message }
  if (!approvals || approvals.length === 0) return { data: [], error: null }

  const userIds = Array.from(new Set(approvals.map((a: any) => a.approver_user_id)))
  const { data: profiles } = userIds.length > 0
    ? await supabase.from('profiles').select('id, email, first_name, last_name').in('id', userIds)
    : { data: [] }

  const profileMap = new Map<string, { name: string; email: string }>()
  for (const p of profiles ?? []) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Unknown'
    profileMap.set(p.id, { name, email: p.email ?? '' })
  }

  const entries: AuditTrailEntry[] = approvals.map((a: any) => {
    const profile = profileMap.get(a.approver_user_id)
    return {
      id: a.id,
      position: a.position,
      workflow_stage_id: a.workflow_stage_id,
      decision: a.decision,
      comment: a.comment,
      decided_at: a.decided_at,
      approver_name: profile?.name ?? 'Unknown',
      approver_email: profile?.email ?? '',
    }
  })

  return { data: entries, error: null }
}

// ── Diff Data ─────────────────────────────────────────────────────────────

export async function fetchSectionDiff(sectionId: string) {
  const { data, error } = await supabase
    .from('handbook_sections')
    .select('legacy_content, content, change_reason')
    .eq('id', sectionId)
    .single()
  if (error) return { data: null, error: error.message }
  return { data: data as { legacy_content: string | null; content: string; change_reason: string | null }, error: null }
}

// ── Approval Monitor (admin) ──────────────────────────────────────────────

export async function fetchHandbookApprovalMonitor(handbookId: string) {
  const { data: sections, error: secErr } = await supabase
    .from('handbook_sections')
    .select('id, title, status, sort_order, current_level')
    .eq('handbook_id', handbookId)
    .order('sort_order', { ascending: true })
  if (secErr) return { data: null, error: secErr.message }

  const list = sections ?? []
  if (list.length === 0) return { data: [] as HandbookApprovalMonitorRow[], error: null }

  const sectionIds = list.map((s: any) => s.id)

  const { data: reqs } = await supabase
    .from('handbook_approval_requirements')
    .select('handbook_section_id, required_position')
    .in('handbook_section_id', sectionIds)

  const { data: approvals } = await supabase
    .from('handbook_approvals')
    .select('handbook_section_id, position, workflow_stage_id, decision, comment, decided_at, approver_user_id')
    .in('handbook_section_id', sectionIds)

  const userIds = Array.from(new Set((approvals ?? []).map((a: any) => a.approver_user_id)))
  const { data: profiles } = userIds.length > 0
    ? await supabase.from('profiles').select('id, email, first_name, last_name').in('id', userIds)
    : { data: [] }

  const profileMap = new Map<string, { name: string; email: string }>()
  for (const p of profiles ?? []) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Unknown'
    profileMap.set(p.id, { name, email: p.email ?? '' })
  }

  const { data: keywordsData } = await supabase
    .from('handbook_keywords')
    .select('section_id, keyword')
    .in('section_id', sectionIds)

  const keywordMap = new Map<string, string[]>()
  for (const k of keywordsData ?? []) {
    if (!keywordMap.has(k.section_id)) keywordMap.set(k.section_id, [])
    keywordMap.get(k.section_id)!.push(k.keyword)
  }

  const rows: HandbookApprovalMonitorRow[] = list.map((section: any) => {
    const sectionKeywords = keywordMap.get(section.id) || []
    const sectionReqs = (reqs ?? [])
      .filter((r: any) => r.handbook_section_id === section.id)
      .map((r: any) => r.required_position as ApproverPosition)
    const sectionApprovals = (approvals ?? [])
      .filter((a: any) => a.handbook_section_id === section.id)
      .map((a: any) => {
        const profile = profileMap.get(a.approver_user_id)
        return {
          handbook_section_id: a.handbook_section_id,
          position: a.position as ApproverPosition,
          workflow_stage_id: a.workflow_stage_id as string,
          decision: a.decision as 'approved' | 'rejected',
          comment: a.comment,
          decided_at: a.decided_at,
          approver_user_id: a.approver_user_id,
          approver_name: profile?.name ?? 'Unknown',
          approver_email: profile?.email ?? '',
        }
      })
    return {
      section_id: section.id,
      section_title: section.title,
      section_status: section.status,
      sort_order: section.sort_order,
      current_level: section.current_level,
      required_positions: sectionReqs,
      keywords: sectionKeywords,
      approvals: sectionApprovals,
    }
  })

  return { data: rows, error: null }
}

// ── Handbook-Level Approvals (L3 Executive) ───────────────────────────────

export async function fetchHandbookApprovals(handbookId: string): Promise<{ data: any[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('handbook_l3_approvals')
    .select('*')
    .eq('handbook_id', handbookId)
    .order('approved_at', { ascending: false })

  return { data, error: error?.message ?? null }
}

export async function approveHandbookAtLevel(
  handbookId: string,
  position: ApproverPosition
): Promise<{ error: string | null; autoPublished?: boolean }> {
  const userId = await getCurrentUserId()
  if (!userId) return { error: 'Not authenticated.' }

  const { error } = await supabase
    .from('handbook_l3_approvals')
    .upsert({
      handbook_id: handbookId,
      approver_position: position,
      approver_user_id: userId,
      decision: 'approved',
      approved_at: new Date().toISOString(),
    }, {
      onConflict: 'handbook_id,approver_position'
    })

  if (error) return { error: error.message, autoPublished: false }

  await logForensicActivity('INSERT', 'handbook_l3_approvals', handbookId, null, {
    approver_position: position,
    decision: 'approved'
  })

  // Fetch handbook to check for scheduled publish date
  const { data: hb } = await supabase
    .from('handbooks')
    .select('publish_at')
    .eq('id', handbookId)
    .single()

  const now = new Date()
  const publishAt = hb?.publish_at ? new Date(hb.publish_at) : null
  const isWithinScheduleRange = !!publishAt && now <= publishAt

  // Update handbook status to indicate L3 approval
  await supabase
    .from('handbooks')
    .update({
      status: 'approved_by_executive',
      l3_approved_at: now.toISOString()
    })
    .eq('id', handbookId)

  await notifyAdmins(`Final Approval: The handbook has been approved by ${approverLabel(position)}.`, '/admin/cms')

  // Auto-publish if within schedule range
  let autoPublished = false
  if (isWithinScheduleRange) {
    const { error: pubErr } = await publishHandbookNow(handbookId)
    if (!pubErr) autoPublished = true
  }

  return { error: null, autoPublished }
}

// ── Schedule / Publish ────────────────────────────────────────────────────

export async function scheduleHandbookPublish(handbookId: string, publishAtIso: string) {
  const { error } = await supabase
    .from('handbooks')
    .update({ publish_at: publishAtIso, status: 'pending_approval' })
    .eq('id', handbookId)
  return { error: error?.message ?? null }
}

export async function publishHandbookNow(handbookId: string) {
  // Check if handbook has been approved by an executive (L3)
  const { data: l3Approvals, error: l3Error } = await supabase
    .from('handbook_l3_approvals')
    .select('*')
    .eq('handbook_id', handbookId)
    .eq('decision', 'approved')

  if (l3Error) return { error: l3Error.message, waitingForDate: false }
  if (!l3Approvals || l3Approvals.length === 0) {
    return { error: 'This handbook must be approved by an Executive (President or VP) before publishing.', waitingForDate: false }
  }

  const { data: sections, error: sectionErr } = await supabase
    .from('handbook_sections')
    .select('status')
    .eq('handbook_id', handbookId)
  if (sectionErr) return { error: sectionErr.message, waitingForDate: false }
  if (!sections || sections.length === 0) return { error: 'No sections found.', waitingForDate: false }
  if (sections.some((s: { status: string }) => s.status === 'dept_review' || s.status === 'rejected')) {
    return { error: 'Some sections are still under review or have been rejected. Please resolve them before publishing.', waitingForDate: false }
  }

  const { data: hb } = await supabase.from('handbooks').select('publish_at, academic_year_id').eq('id', handbookId).single()
  const now = new Date()
  const publishAt = hb?.publish_at ? new Date(hb.publish_at) : null
  const waitingForDate = !!publishAt && publishAt.getTime() > now.getTime()

  const { error } = await supabase
    .from('handbooks')
    .update(waitingForDate
      ? { status: 'pending_approval' }
      : { published_at: now.toISOString(), status: 'published' }
    )
    .eq('id', handbookId)

  if (!waitingForDate && !error) {
    await logForensicActivity('UPDATE', 'handbooks', handbookId, null, {
      status: 'published'
    })
    await notifyAllVerifiedUsers('New Handbook Published', 'The official DYCI Student Handbook for the current academic year has been published. Please review the updated policies.', '/staff/handbook')
  }

  // If published successfully and not waiting for future date, set academic year as current
  if (!error && !waitingForDate && hb?.academic_year_id) {
    // Set this academic year as current
    await supabase.from('academic_years').update({ is_current: false }).neq('id', hb.academic_year_id)
    await supabase.from('academic_years').update({ is_current: true }).eq('id', hb.academic_year_id)
    // Update school settings
    await supabase.from('school_settings').update({ current_academic_year_id: hb.academic_year_id }).eq('id', 1)
  }

  return { error: error?.message ?? null, waitingForDate }
}

export async function cloneHandbook(
  sourceHandbookId: string,
  title: string,
  academicYearId: string
) {
  const { data, error } = await supabase.rpc('clone_handbook', {
    source_hb_id: sourceHandbookId,
    new_title: title,
    new_ay_id: academicYearId
  })
  return { data: data as string | null, error: error?.message ?? null }
}

