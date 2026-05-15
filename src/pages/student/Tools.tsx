import React, { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import toast from 'react-hot-toast'
import { Skeleton, TableSkeleton, KanbanSkeleton } from '../../components/ui/Skeleton'
import { 
  FaPlus, FaTrash, FaCalculator, FaListCheck, FaStar, FaPen, FaCheck, 
  FaArrowRight, FaClock, FaCircle, FaXmark, FaBoxArchive, FaTriangleExclamation 
} from 'react-icons/fa6'
import type { Grade, Todo } from '../../types'

type ToolsTab = 'gwa' | 'todo'
type TodoPriority = 'high' | 'standard' | 'low'
type TodoStatus = 0 | 1 | 2 | 3 // 0: Pending, 1: Active, 2: In-Progress, 3: Done

interface GradeInput {
  subject: string;
  grade: string;
  units: string;
}

interface GwaResult {
  gwa: number;
  totalUnits: number;
  isEligible: boolean;
  classification: 'SAPIENTIA' | 'EXCELLENTIA' | 'VIRTUS' | null;
  remarks: string;
}

interface ConfirmConfig {
  isOpen: boolean;
  type: 'save' | 'switch' | 'archive' | 'trash';
  title: string;
  message: string;
  onConfirm: () => void;
  loading?: boolean;
}

const TOOLS_COLUMNS = [
  { id: 0, label: 'Pending' },
  { id: 1, label: 'Active' },
  { id: 2, label: 'In-Progress' },
  { id: 3, label: 'Done' }
]

const Tools: React.FC = () => {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<ToolsTab>('todo')

  // GWA calculator state
  const [grades, setGrades] = useState<GradeInput[]>([{ subject: '', grade: '', units: '' }])
  const [gwaData, setGwaData] = useState<GwaResult | null>(null)
  const [curriculumType, setCurriculumType] = useState<'new' | 'old'>('new')
  const [collegeType, setCollegeType] = useState<'general' | 'cme'>('general')
  const [semesterName, setSemesterName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [loading, setLoading] = useState<boolean>(false)

  // Kanban Todo State
  const [todos, setTodos] = useState<Todo[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  const [fetchLoading, setFetchLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  
  // Confirmation Modal State
  const [confirmConfig, setConfirmConfig] = useState<ConfirmConfig>({
    isOpen: false,
    type: 'save',
    title: '',
    message: '',
    onConfirm: () => {},
  })

  // Modal Form State
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'standard' as TodoPriority,
    status: 0 as TodoStatus,
    progress: 0,
    due_date: new Date().toISOString().split('T')[0]
  })

  useEffect(() => {
    if (!user) return

    if (activeTab === 'todo') {
      fetchTodos()
    } else {
      fetchGrades()
    }
  }, [activeTab, user, showArchived])

  const fetchTodos = async () => {
    setFetchLoading(true)
    try {
      let query = supabase
        .from('todos')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (!showArchived) {
        query = query.eq('is_archived', false)
      }

      const { data, error } = await query

      if (error) throw error
      setTodos(data || [])
    } catch (error: any) {
      toast.error('Error fetching tasks')
      console.error(error)
    } finally {
      setFetchLoading(false)
    }
  }

  const fetchGrades = async () => {
    if (!user) return
    setLoading(true)
    try {
  const fetchGrades = async () => {
    if (!user) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('student_gwa_results')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) throw error
      
      if (data) {
        setGrades(data.calculation_data || [{ subject: '', grade: '', units: '' }])
        setSemesterName(data.semester_name || '')
        setCurriculumType(data.curriculum_type || 'new')
        setCollegeType(data.college_type || 'general')
      } else {
        setGrades([{ subject: '', grade: '', units: '' }])
        setSemesterName('')
      }
    } catch (error: any) {
      console.error('Error fetching grades:', error)
    } finally {
      setLoading(false)
    }
  }
    } catch (error: any) {
      console.error('Error fetching grades:', error)
    } finally {
      setLoading(false)
    }
  }

  // History load functions removed for simplicity

  // Start new semester removed for simplicity

  // Calculate GWA and PL eligibility whenever grades or curriculum change
  useEffect(() => {
    calculateGwa()
  }, [grades, curriculumType])

  const calculateGwa = () => {
    const validGrades = grades.filter((g) => g.grade && g.units && !isNaN(parseFloat(g.grade)) && !isNaN(parseFloat(g.units)))
    
    if (validGrades.length === 0) {
      setGwaData(null)
      return
    }

    const totalUnits = validGrades.reduce((sum, g) => sum + parseFloat(g.units), 0)
    const weightedSum = validGrades.reduce((sum, g) => sum + (parseFloat(g.grade) * parseFloat(g.units)), 0)
    const computedGwa = weightedSum / totalUnits

    // Eligibility Rules
    const hasLowGrade = validGrades.some(g => {
      const grade = parseFloat(g.grade)
      return curriculumType === 'new' ? grade > 2.00 : grade > 2.25
    })
    
    const isEligibleUnits = totalUnits >= 18
    const isEligibleGwa = computedGwa >= 1.00 && computedGwa <= 1.75
    
    const isEligible = !hasLowGrade && isEligibleUnits && isEligibleGwa

    // Classification
    let classification: GwaResult['classification'] = null
    if (isEligible) {
      if (computedGwa >= 1.00 && computedGwa <= 1.25) classification = 'SAPIENTIA'
      else if (computedGwa > 1.25 && computedGwa <= 1.50) classification = 'EXCELLENTIA'
      else if (computedGwa > 1.50 && computedGwa <= 1.75) classification = 'VIRTUS'
    }

    // Remarks
    let remarks = ''
    if (!isEligible) {
      const reasons = []
      if (!isEligibleUnits) reasons.push(`Total units (${totalUnits.toFixed(1)}) < 18`)
      if (hasLowGrade) reasons.push(`Has grade > ${curriculumType === 'new' ? '2.00' : '2.25'}`)
      if (!isEligibleGwa && computedGwa > 1.75) reasons.push(`GWA (${computedGwa.toFixed(2)}) > 1.75`)
      remarks = reasons.length > 0 ? `Disqualified: ${reasons.join(', ')}` : ''
    }

    setGwaData({
      gwa: parseFloat(computedGwa.toFixed(2)),
      totalUnits,
      isEligible,
      classification,
      remarks
    })
  }

  const handleUpdateGrade = (index: number, field: keyof GradeInput, value: string) => {
    const updated = [...grades]
    updated[index] = { ...updated[index], [field]: value }
    setGrades(updated)
  }

  const addGradeRow = () => {
    setGrades([...grades, { subject: '', grade: '', units: '' }])
  }

  const removeGradeRow = (index: number) => {
    if (grades.length <= 1) {
      setGrades([{ subject: '', grade: '', units: '' }])
      return
    }
    const updated = grades.filter((_, i) => i !== index)
    setGrades(updated)
  }

  const saveGwa = async () => {
    if (!user || !gwaData || !semesterName.trim()) {
      if (!semesterName.trim()) toast.error('Please enter a semester name')
      return
    }
    setIsSaving(true)
    try {
      const payload: any = {
        user_id: user.id,
        semester_name: semesterName,
        gwa: gwaData.gwa,
        total_units: gwaData.totalUnits,
        curriculum_type: curriculumType,
        college_type: collegeType,
        classification: gwaData.classification,
        is_eligible: gwaData.isEligible,
        remarks: gwaData.remarks,
        calculation_data: grades,
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('student_gwa_results')
        .upsert(payload)

      if (error) throw error
      
      toast.success('Academic standing updated!')
      fetchGrades()
    } catch (error: any) {
      toast.error('Failed to save data')
      console.error(error)
    } finally {
      setIsSaving(false)
    }
  }

  // Delete Semester removed for simplicity

  // Kanban Actions
  const openAddModal = () => {
    setEditingTodo(null)
    setFormData({
      title: '',
      description: '',
      priority: 'standard',
      status: 0,
      progress: 0,
      due_date: new Date().toISOString().split('T')[0]
    })
    setIsModalOpen(true)
  }

  const getStatusFromProgress = (progress: number): TodoStatus => {
    if (progress < 10) return 0
    if (progress < 80) return 1
    if (progress < 100) return 2
    return 3
  }

  const openEditModal = (todo: Todo) => {
    setEditingTodo(todo)
    setFormData({
      title: todo.title,
      description: todo.description || '',
      priority: todo.priority || 'standard',
      status: (todo.status as TodoStatus) || 0,
      progress: todo.progress || 0,
      due_date: todo.due_date ? todo.due_date.split('T')[0] : new Date().toISOString().split('T')[0]
    })
    setIsModalOpen(true)
  }

  const handleSaveTodoConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title.trim()) return
    
    setConfirmConfig({
      isOpen: true,
      type: 'save',
      title: editingTodo ? 'Confirm Update' : 'Confirm New Task',
      message: `Are you sure you want to ${editingTodo ? 'update' : 'create'} "${formData.title}"?`,
      onConfirm: async () => {
        try {
          const payload = {
            user_id: user?.id,
            title: formData.title,
            description: formData.description,
            priority: formData.priority,
            status: formData.status,
            progress: formData.progress,
            due_date: formData.due_date,
            updated_at: new Date().toISOString()
          }

          if (editingTodo) {
            const { error } = await supabase
              .from('todos')
              .update(payload)
              .eq('id', editingTodo.id)
            if (error) throw error
            toast.success('Task updated')
          } else {
            const { error } = await supabase
              .from('todos')
              .insert([payload])
            if (error) throw error
            toast.success('Task created')
          }
          setIsModalOpen(false)
          fetchTodos()
        } catch (error: any) {
          toast.error('Operation failed')
        }
      }
    })
  }

  const moveNextConfirm = (todo: Todo) => {
    if (todo.status >= 3) return
    const nextStatus = (todo.status + 1) as TodoStatus
    const nextLabel = nextStatus === 1 ? 'Active' : nextStatus === 2 ? 'In-Progress' : 'Done'
    
    setConfirmConfig({
      isOpen: true,
      type: 'switch',
      title: 'Move Task',
      message: `Are you sure you want to move "${todo.title}" to ${nextLabel}?`,
      onConfirm: async () => {
        let nextProgress = todo.progress
        if (nextStatus === 1 && todo.progress < 10) nextProgress = 10 
        if (nextStatus === 2 && todo.progress < 80) nextProgress = 80  
        if (nextStatus === 3) nextProgress = 100                      
        
        try {
          const { error } = await supabase
            .from('todos')
            .update({ 
              status: nextStatus,
              progress: nextProgress,
              updated_at: new Date().toISOString()
            })
            .eq('id', todo.id)

          if (error) throw error
          fetchTodos()
        } catch (error: any) {
          toast.error('Update failed')
        }
      }
    })
  }

  const toggleArchiveConfirm = (todo: Todo) => {
    setConfirmConfig({
      isOpen: true,
      type: 'archive',
      title: todo.is_archived ? 'Restore Task' : 'Archive Task',
      message: `Are you sure you want to ${todo.is_archived ? 'restore' : 'archive'} "${todo.title}"?`,
      onConfirm: async () => {
        try {
          const { error } = await supabase
            .from('todos')
            .update({ is_archived: !todo.is_archived })
            .eq('id', todo.id)
          if (error) throw error
          toast.success(todo.is_archived ? 'Task restored' : 'Task archived')
          fetchTodos()
        } catch (error: any) {
          toast.error('Operation failed')
        }
      }
    })
  }

  const archiveAllDoneConfirm = () => {
    const doneTasks = todos.filter(t => t.status === 3 && !t.is_archived)
    if (doneTasks.length === 0) return

    setConfirmConfig({
      isOpen: true,
      type: 'archive',
      title: 'Archive All Completed',
      message: `Move all ${doneTasks.length} completed tasks to archive?`,
      onConfirm: async () => {
        try {
          const { error } = await supabase
            .from('todos')
            .update({ is_archived: true })
            .eq('status', 3)
            .eq('user_id', user?.id)
          if (error) throw error
          toast.success('Completed tasks archived')
          fetchTodos()
        } catch (error: any) {
          toast.error('Batch archive failed')
        }
      }
    })
  }

  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null)

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('todoId', id)
    setDraggingTodoId(id)
  };

  const handleDragEnd = () => {
    setDraggingTodoId(null)
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  };

  const handleDrop = async (e: React.DragEvent, newStatus: TodoStatus) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('todoId')
    setDraggingTodoId(null)
    
    const todoToUpdate = todos.find(t => t.id === id)
    if (!todoToUpdate || todoToUpdate.status === newStatus) return

    let nextProgress = todoToUpdate.progress
    if (newStatus === 0) nextProgress = 0
    else if (newStatus === 1) nextProgress = todoToUpdate.progress < 10 || todoToUpdate.progress === 100 ? 10 : todoToUpdate.progress
    else if (newStatus === 2) nextProgress = todoToUpdate.progress < 80 || todoToUpdate.progress === 100 ? 80 : todoToUpdate.progress
    else if (newStatus === 3) nextProgress = 100

    try {
      // Optimistic update
      setTodos(prev => prev.map(t => t.id === id ? { ...t, status: newStatus, progress: nextProgress } : t))
      
      const { error } = await supabase
        .from('todos')
        .update({ 
          status: newStatus,
          progress: nextProgress,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      if (error) throw error
      toast.success(`Task moved to ${TOOLS_COLUMNS.find(c => c.id === newStatus)?.label}`)
    } catch (err) {
      // Revert on error
      fetchTodos()
      toast.error('Failed to move task')
    }
  };

  const trashTodoConfirm = (todo: Todo) => {
    setConfirmConfig({
      isOpen: true,
      type: 'trash',
      title: 'Move to Trash',
      message: `Are you sure you want to move "${todo.title}" to trash?`,
      onConfirm: async () => {
        try {
          const { error } = await supabase
            .from('todos')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', todo.id)
          if (error) throw error
          toast.success('Task moved to trash')
          fetchTodos()
          setIsModalOpen(false)
        } catch (error: any) {
          toast.error('Trash failed')
        }
      }
    })
  }

  const filteredTodos = todos.filter(t => 
    t.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalTasks = todos.length
  const completedCount = todos.filter(t => t.status === 3).length
  const pendingCount = todos.filter(t => t.status === 1).length
  const completionRate = totalTasks === 0 ? 0 : Math.round((completedCount / totalTasks) * 100)

  // Card Component
  const TaskCard = ({ todo }: { todo: Todo }) => {
    const isUrgent = todo.due_date && new Date(todo.due_date).getTime() - Date.now() < 24 * 60 * 60 * 1000 && todo.status !== 3
    
    // Priority specific styles
    const priorityConfig = {
      high: { dot: 'bg-rose-500', label: 'text-rose-600 bg-rose-50 border-rose-100', shadow: 'shadow-rose-100/20' },
      standard: { dot: 'bg-blue-500', label: 'text-blue-600 bg-blue-50 border-blue-100', shadow: 'shadow-blue-100/20' },
      low: { dot: 'bg-emerald-500', label: 'text-emerald-600 bg-emerald-50 border-emerald-100', shadow: 'shadow-emerald-100/20' }
    }[todo.priority as TodoPriority] || { dot: 'bg-slate-300', label: 'text-slate-400 bg-slate-50 border-slate-50', shadow: '' }

    return (
      <div 
        draggable={!todo.is_archived}
        onDragStart={(e) => handleDragStart(e, todo.id)}
        onDragEnd={handleDragEnd}
        className={`group bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-blue-200 transition-all relative overflow-hidden cursor-grab active:cursor-grabbing ${todo.is_archived ? 'opacity-60 grayscale' : ''} ${draggingTodoId === todo.id ? 'opacity-20 scale-95' : ''}`}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className={`px-2 py-0.5 rounded-lg border text-[8px] font-black uppercase tracking-widest ${priorityConfig.label}`}>
            {todo.priority} PRIORITY
          </div>
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => toggleArchiveConfirm(todo)} className="p-1.5 text-slate-300 hover:text-blue-600 transition-colors">
               <FaBoxArchive className="w-3 h-3" />
            </button>
            <button onClick={() => openEditModal(todo)} className="p-1.5 text-slate-300 hover:text-blue-600 transition-colors">
              <FaPen className="w-3 h-3" />
            </button>
          </div>
        </div>
        
        <h4 className="text-sm font-bold text-slate-800 mb-3 leading-snug">{todo.title}</h4>
        
        <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-50">
          <div className="flex items-center gap-1.5">
            <FaClock className={`w-3 h-3 ${isUrgent ? 'text-rose-500' : 'text-slate-300'}`} />
            <span className={`text-[10px] font-bold ${isUrgent ? 'text-rose-500' : 'text-slate-400'}`}>
              {todo.due_date ? new Date(todo.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No date'}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-slate-300 tabular-nums">{todo.progress}%</span>
            {todo.status < 3 && !todo.is_archived && (
              <button 
                onClick={(e) => { e.stopPropagation(); moveNextConfirm(todo); }}
                className="h-7 w-7 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center hover:bg-dyci-blue hover:text-white transition-all shadow-sm"
              >
                <FaArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Indicator Line */}
        <div className={`absolute top-0 left-0 w-1 h-full ${priorityConfig.dot} opacity-20`} />
      </div>
    )
  }

  return (
    <>
      <header className="unified-header">
        <div className="unified-header-content flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="unified-header-title">Academic Tools</h1>
            <p className="unified-header-subtitle">Manage your progress and performance seamlessly.</p>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setActiveTab('todo')} 
              className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border ${activeTab === 'todo' ? 'bg-white text-dyci-blue border-white' : 'bg-white/10 text-white border-white/20 hover:bg-white/20'}`}
            >
              To-Do Board
            </button>
            <button 
              onClick={() => setActiveTab('gwa')} 
              className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border ${activeTab === 'gwa' ? 'bg-white text-dyci-blue border-white' : 'bg-white/10 text-white border-white/20 hover:bg-white/20'}`}
            >
              GWA Tracker
            </button>
          </div>
        </div>
      </header>

      <main className="unified-main">
        {activeTab === 'gwa' && (
          loading ? (
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 space-y-6">
                <Skeleton height={200} className="rounded-3xl" />
                <TableSkeleton rows={8} />
              </div>
              <aside className="w-full lg:w-72 space-y-4">
                <Skeleton height={300} className="rounded-3xl" />
              </aside>
            </div>
          ) : (
          <div className="flex flex-col lg:flex-row gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Main Calculator */}
            <div className="flex-1 bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-8">
              {/* GWA Summary Header */}
              <div className="mb-8 flex flex-col sm:flex-row items-center justify-between gap-6 rounded-3xl bg-slate-50/50 border border-slate-100 px-8 py-6">
                <div className="text-center sm:text-left">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">My Current Average</p>
                  <div className="flex items-center gap-4 mt-1">
                    <p className={`text-5xl font-black text-slate-900 tabular-nums transition-all ${isSaving ? 'opacity-50' : 'opacity-100'}`}>
                      {gwaData ? gwaData.gwa.toFixed(2) : '0.00'}
                    </p>
                    {gwaData?.classification && (
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-dyci-blue uppercase tracking-tighter">Current Award</span>
                        <span className="text-sm font-black text-blue-700 uppercase italic tracking-widest -mt-1">
                          {gwaData.classification}
                          <span className="text-[8px] ml-1 lowercase font-medium text-slate-400 not-italic">
                            ({gwaData.classification === 'SAPIENTIA' ? 'Highest' : gwaData.classification === 'EXCELLENTIA' ? 'High' : 'With'} Honors)
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-center sm:items-end gap-3">
                  <div className={`px-5 py-2 rounded-2xl text-[10px] font-black border uppercase tracking-widest shadow-sm ${
                    !gwaData ? 'bg-slate-100 text-slate-400 border-slate-200' : 
                    gwaData.isEligible ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                    'bg-rose-50 text-rose-600 border-rose-100'
                  }`}>
                    {!gwaData ? 'NO DATA' : gwaData.isEligible ? 'PL ELIGIBLE' : 'NOT ELIGIBLE'}
                  </div>
                  {gwaData?.remarks && (
                    <p className="text-[10px] text-slate-400 font-medium text-center sm:text-right max-w-[200px]">
                      {gwaData.remarks}
                    </p>
                  )}
                </div>
              </div>

              {/* Semester Info & Actions */}
              <div className="space-y-6 mb-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Semester Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g., 1st Semester 2023-2024"
                      value={semesterName}
                      onChange={(e) => setSemesterName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2.5 text-sm font-bold text-slate-700 focus:bg-white focus:ring-1 focus:ring-dyci-blue transition-all"
                    />
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Curriculum</label>
                      <div className="flex bg-slate-100 p-1 rounded-2xl">
                        <button 
                          onClick={() => setCurriculumType('new')}
                          className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-all ${curriculumType === 'new' ? 'bg-white text-dyci-blue shadow-sm' : 'text-slate-400'}`}
                        >
                          NEW
                        </button>
                        <button 
                          onClick={() => setCurriculumType('old')}
                          className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-all ${curriculumType === 'old' ? 'bg-white text-dyci-blue shadow-sm' : 'text-slate-400'}`}
                        >
                          OLD
                        </button>
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">College</label>
                      <div className="flex bg-slate-100 p-1 rounded-2xl">
                        <button 
                          onClick={() => setCollegeType('general')}
                          className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-all ${collegeType === 'general' ? 'bg-white text-dyci-blue shadow-sm' : 'text-slate-400'}`}
                        >
                          GEN
                        </button>
                        <button 
                          onClick={() => setCollegeType('cme')}
                          className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-all ${collegeType === 'cme' ? 'bg-white text-dyci-blue shadow-sm' : 'text-slate-400'}`}
                        >
                          CME
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end pt-2">
                  <button 
                    onClick={saveGwa}
                    disabled={isSaving || !gwaData || !semesterName}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-dyci-blue text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-800 transition-all shadow-md disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save GWA'}
                  </button>
                </div>
              </div>

              {/* Subject Entry Table */}
              <div className="space-y-4">
                <div className="grid grid-cols-12 px-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <div className="col-span-6">Subject Name</div>
                  <div className="col-span-3 text-center">Units</div>
                  <div className="col-span-3 text-center">Grade</div>
                </div>

                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {grades.map((g, idx) => (
                    <div key={idx} className="group grid grid-cols-12 gap-3 items-center bg-white border border-slate-100 shadow-sm rounded-2xl p-2 pl-4 transition-all hover:border-blue-200">
                      <div className="col-span-6">
                        <input 
                          type="text" 
                          placeholder="Enter subject..." 
                          value={g.subject}
                          onChange={(e) => handleUpdateGrade(idx, 'subject', e.target.value)}
                          className="w-full bg-transparent border-none text-sm font-semibold text-slate-700 placeholder:text-slate-300 focus:ring-0"
                        />
                      </div>
                      <div className="col-span-3 flex items-center justify-center">
                        <input 
                          type="number" 
                          step="0.5" 
                          placeholder="0.0" 
                          value={g.units}
                          onChange={(e) => handleUpdateGrade(idx, 'units', e.target.value)}
                          className="w-20 bg-slate-50 border border-slate-100 rounded-xl px-2 py-1.5 text-center text-sm font-bold text-slate-600 focus:bg-white focus:border-blue-400 transition-all"
                        />
                      </div>
                      <div className="col-span-3 flex items-center justify-center gap-2">
                        <input 
                          type="number" 
                          step="0.01" 
                          placeholder="1.0" 
                          value={g.grade}
                          onChange={(e) => handleUpdateGrade(idx, 'grade', e.target.value)}
                          className="w-20 bg-slate-50 border border-slate-100 rounded-xl px-2 py-1.5 text-center text-sm font-black text-blue-700 focus:bg-white focus:border-blue-400 transition-all"
                        />
                        <button 
                          onClick={() => removeGradeRow(idx)}
                          className="p-2 text-slate-200 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <FaTrash className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button 
                  onClick={addGradeRow}
                  className="flex items-center gap-2 px-6 py-3 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-dyci-blue hover:text-dyci-blue hover:bg-blue-50/30 transition-all w-full justify-center group"
                >
                  <FaPlus className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Add Subject Grade</span>
                </button>
              </div>
            </div>

            {/* Sidebar: Guidelines & Reference */}
            <aside className="w-full lg:w-72 space-y-4">
              {/* Main GWA Card */}
              <div className="bg-dyci-blue rounded-3xl p-6 text-white shadow-xl shadow-blue-100/20">
                <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">My Overall Grade</p>
                <p className="text-4xl font-black mt-1 tabular-nums">
                  {gwaData ? gwaData.gwa.toFixed(2) : '0.00'}
                </p>
                <p className="text-[10px] text-blue-200 mt-2 font-medium">
                  This shows on your dashboard.
                </p>
              </div>

              {/* Eligibility Checklist */}
              <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Lister Checklist</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 border transition-colors ${gwaData?.isEligible ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-slate-50 border-slate-200 text-slate-300'}`}>
                      <FaCheck className="w-2.5 h-2.5" />
                    </div>
                    <div>
                      <p className={`text-[10px] font-bold ${gwaData?.isEligible ? 'text-slate-700' : 'text-slate-400'}`}>GWA (1.00 - 1.75)</p>
                      <p className="text-[9px] text-slate-400">Current: {gwaData?.gwa.toFixed(2) || '0.00'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 border transition-colors ${(gwaData?.totalUnits || 0) >= 18 ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-slate-50 border-slate-200 text-slate-300'}`}>
                      <FaCheck className="w-2.5 h-2.5" />
                    </div>
                    <div>
                      <p className={`text-[10px] font-bold ${(gwaData?.totalUnits || 0) >= 18 ? 'text-slate-700' : 'text-slate-400'}`}>Full Load (18+ Units)</p>
                      <p className="text-[9px] text-slate-400">Current: {gwaData?.totalUnits.toFixed(1) || '0.0'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 border transition-colors ${gwaData && !gwaData.remarks.includes('grade >') ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-slate-50 border-slate-200 text-slate-300'}`}>
                      <FaCheck className="w-2.5 h-2.5" />
                    </div>
                    <div>
                      <p className={`text-[10px] font-bold ${gwaData && !gwaData.remarks.includes('grade >') ? 'text-slate-700' : 'text-slate-400'}`}>No Grade Below {curriculumType === 'new' ? '2.00' : '2.25'}</p>
                      <p className="text-[9px] text-slate-400">{curriculumType === 'new' ? 'New' : 'Old'} Curriculum rule</p>
                    </div>
                  </div>
                </div>
              </div>



              {/* Grading System Table Card */}
              <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm relative overflow-hidden">
                <div className="relative z-10">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">{collegeType === 'cme' ? 'CME' : 'General'} Grade Guide</h4>
                  <div className="space-y-2">
                    {(collegeType === 'cme' ? [
                      { g: '1.00', l: 'A+', p: '98-100', d: 'Excellent' },
                      { g: '1.25', l: 'A', p: '95-97', d: 'Excellent' },
                      { g: '1.50', l: 'B+', p: '92-94', d: 'Very Good' },
                      { g: '1.75', l: 'B', p: '89-91', d: 'Very Good' },
                      { g: '2.00', l: 'C+', p: '86-88', d: 'Good' },
                      { g: '3.00', l: 'E', p: '75-76', d: 'Pass' },
                      { g: '5.00', l: 'F', p: '0-74', d: 'Fail' },
                    ] : [
                      { g: '1.00', l: '', p: '98-100', d: 'Excellent' },
                      { g: '1.25', l: '', p: '95-97', d: 'Excellent' },
                      { g: '1.50', l: '', p: '92-94', d: 'Very Good' },
                      { g: '1.75', l: '', p: '89-91', d: 'Very Good' },
                      { g: '2.00', l: '', p: '86-88', d: 'Good' },
                      { g: '3.00', l: '', p: '75-76', d: 'Passed' },
                      { g: '5.00', l: '', p: 'Below 75', d: 'Failed' },
                    ]).map((row, i) => (
                      <div key={i} className="flex items-center justify-between text-[10px] border-b border-slate-50 pb-1.5 last:border-0 last:pb-0">
                        <div className="flex items-center gap-2 w-16">
                          <span className="font-black text-dyci-blue">{row.g}</span>
                          {row.l && <span className="text-[8px] font-black bg-blue-50 text-blue-600 px-1 rounded">{row.l}</span>}
                        </div>
                        <span className="text-slate-400 font-medium">{row.p}</span>
                        <span className="text-slate-600 font-bold ml-auto">{row.d}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )
      )}

        {activeTab === 'todo' && (
          <div className="flex flex-col lg:flex-row gap-6 items-start animate-in fade-in duration-500">
            <div className="flex-1 w-full min-w-0">
              {/* Kanban Toolbar - Professional Style */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-3 flex-1 max-w-lg">
                  <div className="relative flex-1">
                    <input 
                      type="text" 
                      placeholder="Search tasks..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl pl-10 pr-4 py-2 text-xs font-semibold text-slate-600 focus:bg-white focus:ring-1 focus:ring-dyci-blue transition-all"
                    />
                    <FaListCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 w-3.5 h-3.5" />
                  </div>
                  <button 
                    onClick={() => setShowArchived(!showArchived)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-2xl border text-[10px] font-black uppercase tracking-widest transition-all ${showArchived ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}
                  >
                    <FaBoxArchive className="w-3 h-3" />
                    {showArchived ? 'Hide Archived' : 'Show Archived'}
                  </button>
                </div>
                <button 
                  onClick={openAddModal}
                  className="bg-dyci-blue text-white rounded-2xl px-6 py-2.5 text-[10px] font-black uppercase tracking-widest hover:bg-blue-800 transition-all shadow-md flex items-center justify-center gap-2"
                >
                  <FaPlus className="w-3 h-3" /> New Task
                </button>
              </div>

              {/* Kanban Grid - Unified System Style (4 Columns) */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                {fetchLoading ? (
                  <KanbanSkeleton />
                ) : (
                  TOOLS_COLUMNS.map(col => {
                    const colTodos = filteredTodos
                      .filter(t => t.status === col.id)
                      .sort((a, b) => {
                        const priorityWeights: Record<string, number> = { high: 3, standard: 2, medium: 2, low: 1 }
                        const wA = priorityWeights[a.priority as string] || 2
                        const wB = priorityWeights[b.priority as string] || 2
                        if (wA !== wB) return wB - wA
                        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
                      })
                    return (
                      <div key={col.id} className="flex flex-col min-h-[500px]">
                        <div className="flex items-center justify-between mb-4 px-2">
                          <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              col.id === 0 ? 'bg-slate-300' : 
                              col.id === 1 ? 'bg-blue-500' : 
                              col.id === 2 ? 'bg-amber-500' : 
                              'bg-emerald-500'
                            }`} />
                            {col.label}
                          </h3>
                          <span className="bg-white border border-slate-100 text-slate-400 text-[9px] font-black px-2 py-0.5 rounded-lg shadow-sm">{colTodos.length}</span>
                        </div>
                        
                        <div 
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, col.id as TodoStatus)}
                          className={`flex-1 bg-slate-50/50 rounded-3xl p-3 border border-slate-100/50 transition-colors ${draggingTodoId ? 'bg-blue-50/50 border-blue-200 ring-2 ring-blue-100 ring-offset-2' : ''}`}
                        >
                          {colTodos.length === 0 ? (
                            <div className="h-full min-h-[150px] border-2 border-dashed border-slate-200/50 rounded-3xl flex flex-col items-center justify-center p-6 bg-white/30">
                              <FaListCheck className="w-6 h-6 text-slate-200 mb-2" />
                              <span className="text-[9px] text-slate-300 uppercase font-black tracking-widest text-center">No {col.label}</span>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {colTodos.map(todo => <TaskCard key={todo.id} todo={todo} />)}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Kanban Stats Sidebar (Simplified) */}
            <aside className="w-full lg:w-72 space-y-4 shrink-0">
              <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Board Intelligence</h3>
                <div className="space-y-6">
                  <div>
                    <div className="flex justify-between items-end mb-2">
                      <span className="text-[10px] font-black text-slate-500 uppercase">Completion Rate</span>
                      <span className="text-sm font-black text-slate-900 tabular-nums">{completionRate}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-50">
                      <div className="h-full bg-emerald-500 rounded-full transition-all duration-1000 shadow-sm" style={{ width: `${completionRate}%` }} />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 group hover:border-blue-200 transition-colors">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Total Tasks</p>
                      <p className="text-2xl font-black text-slate-900 mt-1">{totalTasks}</p>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 group hover:border-blue-200 transition-colors">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Active Priority</p>
                      <p className="text-2xl font-black text-blue-600 mt-1">{pendingCount}</p>
                    </div>
                  </div>

                  <button 
                    onClick={archiveAllDoneConfirm}
                    disabled={todos.filter(t => t.status === 3 && !t.is_archived).length === 0}
                    className="w-full bg-slate-900 text-white rounded-2xl py-3 text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-20"
                  >
                    Archive Completed
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl shadow-slate-200">
                <FaStar className="w-6 h-6 text-yellow-400 mb-4" />
                <h4 className="text-xs font-black uppercase tracking-widest mb-1">Efficiency Pro</h4>
                <p className="text-[10px] text-slate-400 font-medium leading-relaxed">Systematic tracking improves academic outcome by 40% based on institutional audits.</p>
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* Task Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-50">
              <h3 className="text-base font-bold text-slate-800">{editingTodo ? 'Edit Task' : 'New Task'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><FaXmark className="w-4 h-4" /></button>
            </div>
            
            <form onSubmit={handleSaveTodoConfirm} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Task Title</label>
                <input 
                  autoFocus
                  maxLength={30}
                  type="text" 
                  value={formData.title} 
                  onChange={e => setFormData({...formData, title: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all font-medium"
                  placeholder="e.g., Module 1 Exam"
                />
                <div className="flex justify-end mt-1"><span className="text-[9px] text-slate-300">{formData.title.length}/30</span></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Priority</label>
                  <select 
                    value={formData.priority} 
                    onChange={e => setFormData({...formData, priority: e.target.value as TodoPriority})}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all font-bold"
                  >
                    <option value="low">Low</option>
                    <option value="standard">Standard</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Description (Optional)</label>
                <textarea 
                  maxLength={100}
                  rows={2}
                  value={formData.description} 
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all resize-none font-medium"
                  placeholder="Additional details..."
                />
                <div className="flex justify-end mt-1"><span className="text-[9px] text-slate-300">{formData.description.length}/100</span></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Status</label>
                  <select 
                    value={formData.status} 
                    onChange={e => setFormData({...formData, status: parseInt(e.target.value) as TodoStatus})}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all font-bold"
                  >
                    <option value={0}>Pending</option>
                    <option value={1}>Active</option>
                    <option value={2}>In-Progress</option>
                    <option value={3}>Done</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Due Date</label>
                  <input 
                    type="date" 
                    value={formData.due_date} 
                    onChange={e => setFormData({...formData, due_date: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all font-bold"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Progress</label>
                  <span className="text-xs font-bold text-blue-600">{formData.progress}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={formData.progress} 
                  onChange={e => {
                    const prog = parseInt(e.target.value)
                    setFormData({
                      ...formData, 
                      progress: prog,
                      status: getStatusFromProgress(prog)
                    })
                  }}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <div className="flex items-center gap-3 pt-4 border-t border-slate-50">
                {editingTodo && (
                  <button 
                    type="button"
                    onClick={() => trashTodoConfirm(editingTodo)}
                    className="flex-1 bg-rose-50 text-rose-500 rounded-2xl px-4 py-2.5 text-xs font-bold hover:bg-rose-100 transition-colors"
                  >
                    Trash Task
                  </button>
                )}
                <button 
                  type="submit"
                  disabled={loading}
                  className="flex-[2] bg-blue-700 text-white rounded-2xl px-4 py-2.5 text-xs font-bold hover:bg-blue-800 transition-colors shadow-sm disabled:opacity-50"
                >
                  {loading ? 'Processing...' : editingTodo ? 'Update Task' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unified Confirmation Modal */}
      {confirmConfig.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setConfirmConfig({...confirmConfig, isOpen: false})} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${confirmConfig.type === 'trash' ? 'bg-rose-50 text-rose-500' : 'bg-blue-50 text-blue-500'}`}>
                {confirmConfig.type === 'trash' ? <FaTrash className="w-5 h-5" /> : confirmConfig.type === 'archive' ? <FaBoxArchive className="w-5 h-5" /> : <FaTriangleExclamation className="w-5 h-5" />}
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">{confirmConfig.title}</h3>
              <p className="text-xs font-medium text-slate-500 leading-relaxed mb-6">{confirmConfig.message}</p>
              
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setConfirmConfig({...confirmConfig, isOpen: false})}
                  disabled={loading}
                  className="flex-1 py-2.5 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                    setLoading(true)
                    await confirmConfig.onConfirm()
                    setLoading(false)
                    setConfirmConfig({...confirmConfig, isOpen: false})
                  }}
                  disabled={loading}
                  className={`flex-1 py-2.5 rounded-2xl text-xs font-bold text-white transition-all shadow-sm ${confirmConfig.type === 'trash' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-blue-700 hover:bg-blue-800'}`}
                >
                  {loading ? 'Wait...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default Tools
