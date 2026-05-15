import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  FaUpload, FaFolderPlus, FaEllipsisV, FaFileAlt, FaFolder,
  FaTrash, FaTimes, FaDownload, FaSpinner,
  FaFilePdf, FaFileImage, FaFileVideo, FaFileAudio, FaSearch,
  FaSortAmountDown, FaSortAmountUp, FaThLarge, FaList,
  FaArchive, FaArrowLeft, FaHome, FaChevronRight, FaFileUpload, FaEdit,
  FaFileWord, FaFileExcel, FaFilePowerpoint
} from 'react-icons/fa'
import { supabase } from '../../lib/supabaseClient'
import { toast } from 'react-hot-toast'
import { FileSkeleton } from '../../components/ui/Skeleton'

interface StoredItem {
  id: string
  name: string
  sizeMb?: number
  date: string
  type: 'file' | 'folder'
  originalId: string
  contentType?: string
  isArchived: boolean
}

type PreviewType = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'office' | 'other'
type ViewMode = 'list' | 'grid'
type SortBy = 'name' | 'date' | 'size'

const getPreviewType = (contentType: string): PreviewType => {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType === 'application/pdf') return 'pdf'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  if (contentType.startsWith('text/') || contentType === 'application/json') return 'text'
  if (
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    contentType === 'application/msword' ||
    contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    contentType === 'application/vnd.ms-excel' ||
    contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    contentType === 'application/vnd.ms-powerpoint'
  ) return 'office'
  return 'other'
}

const getFileIcon = (contentType?: string) => {
  if (!contentType) return FaFileAlt
  if (contentType.startsWith('image/')) return FaFileImage
  if (contentType === 'application/pdf') return FaFilePdf
  if (contentType.startsWith('video/')) return FaFileVideo
  if (contentType.startsWith('audio/')) return FaFileAudio
  if (contentType.includes('word') || contentType.includes('officedocument.word')) return FaFileWord
  if (contentType.includes('excel') || contentType.includes('officedocument.spreadsheet')) return FaFileExcel
  if (contentType.includes('powerpoint') || contentType.includes('officedocument.presentation')) return FaFilePowerpoint
  return FaFileAlt
}

const Files: React.FC = () => {
  // Navigation & View State
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string | null, name: string }>>([{ id: null, name: 'Root' }])
  const [items, setItems] = useState<StoredItem[]>([])
  const [loading, setLoading] = useState(true)
  const [usedBytes, setUsedBytes] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  // Action State
  const [isUploading, setIsUploading] = useState(false)
  const [actionMenuOpenId, setActionMenuOpenId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Modal state
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Rename state
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [itemToRename, setItemToRename] = useState<StoredItem | null>(null)
  const [newName, setNewName] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewFileName, setPreviewFileName] = useState('')
  const [previewContentType, setPreviewContentType] = useState('')
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const quotaBytes = 500 * 1024 * 1024 // 500 MB limit
  const usedPercent = Math.min((usedBytes / quotaBytes) * 100, 100)

  // Fetch logic aligned with Master Schema V5
  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Fetch Folders
      let folderQuery = supabase
        .from('folders')
        .select('*')
        .eq('user_id', user.id)
        .is('deleted_at', null)

      if (!showArchived) {
        folderQuery = folderQuery.eq('is_archived', false)
      }

      if (currentFolderId) {
        folderQuery = folderQuery.eq('parent_id', currentFolderId)
      } else {
        folderQuery = folderQuery.is('parent_id', null)
      }

      const { data: foldersData, error: foldersError } = await folderQuery

      if (foldersError) throw foldersError

      // Fetch Files
      let fileQuery = supabase
        .from('files')
        .select('*')
        .eq('user_id', user.id)
        .is('deleted_at', null)

      if (!showArchived) {
        fileQuery = fileQuery.eq('is_archived', false)
      }

      if (currentFolderId) {
        fileQuery = fileQuery.eq('folder_id', currentFolderId)
      } else {
        fileQuery = fileQuery.is('folder_id', null)
      }

      const { data: filesData, error: filesError } = await fileQuery

      if (filesError) throw filesError

      // Calculate total storage usage
      const { data: allFilesData, error: allFilesError } = await supabase
        .from('files')
        .select('size')
        .eq('user_id', user.id)
        .is('deleted_at', null)

      if (allFilesError) throw allFilesError
      const total = allFilesData.reduce((acc: number, curr: { size: number | null }) => acc + (Number(curr.size) || 0), 0)
      setUsedBytes(total)

      // Transform into display items
      const combined: StoredItem[] = [
        ...(foldersData || []).map((f: any) => ({
          id: `folder-${f.id}`,
          originalId: f.id,
          name: f.name,
          date: f.created_at,
          type: 'folder' as const,
          isArchived: f.is_archived || false
        })),
        ...(filesData || []).map((f: any) => ({
          id: `file-${f.id}`,
          originalId: f.id,
          name: f.name,
          sizeMb: Number(f.size) / (1024 * 1024),
          date: f.created_at,
          type: 'file' as const,
          contentType: f.type || 'application/octet-stream',
          isArchived: f.is_archived || false
        }))
      ]
      setItems(combined)

    } catch (err: any) {
      console.error('Fetch error:', err)
      toast.error('Failed to load items. Please refresh and try again.')
    } finally {
      setLoading(false)
    }
  }, [currentFolderId, showArchived])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const filteredAndSortedItems = useMemo(() => {
    let result = [...items]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(item => item.name.toLowerCase().includes(q))
    }
    result.sort((a, b) => {
      let comparison = 0
      if (sortBy === 'name') comparison = a.name.localeCompare(b.name)
      else if (sortBy === 'date') comparison = new Date(a.date).getTime() - new Date(b.date).getTime()
      else if (sortBy === 'size') comparison = (a.sizeMb || 0) - (b.sizeMb || 0)
      return sortOrder === 'asc' ? comparison : -comparison
    })
    return result
  }, [items, searchQuery, sortBy, sortOrder])

  const handleUploadClick = () => fileInputRef.current?.click()

  const openFolderModal = () => {
    setNewFolderName('')
    setShowFolderModal(true)
    setTimeout(() => folderInputRef.current?.focus(), 100)
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File size exceeds 25MB limit")
      return
    }
    if (usedBytes + file.size > quotaBytes) {
      toast.error("Storage quota exceeded. Please delete some files to free up space.")
      return
    }
    const toastId = toast.loading('Preparing upload...')
    try {
      setIsUploading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const { data: uploadData, error: uploadFuncError } = await supabase.functions.invoke('files-upload-url', {
        body: { fileName: file.name, contentType: file.type || 'application/octet-stream', fileSize: file.size, folderId: currentFolderId }
      })
      if (uploadFuncError || uploadData?.error) throw new Error(uploadData?.error || uploadFuncError?.message || 'Upload preparation failed')
      const uploadResponse = await fetch(uploadData.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
      if (!uploadResponse.ok) throw new Error(`Storage server error: ${uploadResponse.status}`)
      const { error: dbError } = await supabase.from('files').insert({ user_id: user.id, name: file.name, size: file.size, type: file.type || 'application/octet-stream', path: currentFolderId ? `${currentFolderId}/${file.name}` : file.name, object_key: uploadData.objectKey, folder_id: currentFolderId })
      if (dbError) throw dbError
      toast.success('File uploaded!', { id: toastId })
      await fetchItems()
    } catch (err: any) {
      toast.error(`Upload Failed: ${err.message}`, { id: toastId })
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    const toastId = toast.loading('Creating folder...')
    try {
      setIsCreatingFolder(true)
      const { data, error: invokeError } = await supabase.functions.invoke('folders-create', { body: { name: newFolderName.trim(), parentId: currentFolderId } })
      if (invokeError || data?.error) throw new Error(data?.error || invokeError?.message || 'Folder creation failed')
      setShowFolderModal(false)
      setNewFolderName('')
      toast.success('Folder created!', { id: toastId })
      await fetchItems()
    } catch (err: any) {
      toast.error(err.message, { id: toastId })
    } finally {
      setIsCreatingFolder(false)
    }
  }

  const openRenameModal = (item: StoredItem, e: React.MouseEvent) => {
    e.stopPropagation()
    setItemToRename(item)
    setNewName(item.name)
    setShowRenameModal(true)
    setActionMenuOpenId(null)
    setTimeout(() => renameInputRef.current?.focus(), 100)
  }

  const handleRenameSubmit = async () => {
    if (!itemToRename || !newName.trim() || newName.trim() === itemToRename.name) {
      setShowRenameModal(false)
      return
    }
    const toastId = toast.loading('Renaming...')
    try {
      setIsRenaming(true)
      const table = itemToRename.type === 'folder' ? 'folders' : 'files'
      const { error } = await supabase
        .from(table)
        .update({ name: newName.trim() })
        .eq('id', itemToRename.originalId)

      if (error) throw error

      toast.success('Renamed successfully', { id: toastId })
      setShowRenameModal(false)
      await fetchItems()
    } catch (err: any) {
      toast.error(err.message || 'Failed to rename', { id: toastId })
    } finally {
      setIsRenaming(false)
    }
  }

  const handleDeleteItem = async (item: StoredItem, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`Move this to trash?`)) return
    const toastId = toast.loading(`Moving to trash...`)
    try {
      const table = item.type === 'folder' ? 'folders' : 'files'
      const { error } = await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', item.originalId)
      if (error) throw error
      toast.success('Moved to trash', { id: toastId })
      await fetchItems()
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`, { id: toastId })
    } finally {
      setActionMenuOpenId(null)
    }
  }

  const handleArchiveToggle = async (item: StoredItem, e: React.MouseEvent) => {
    e.stopPropagation()
    const table = item.type === 'folder' ? 'folders' : 'files'
    const newStatus = !item.isArchived
    const toastId = toast.loading(`${newStatus ? 'Archiving' : 'Unarchiving'}...`)
    try {
      const { error } = await supabase.from(table).update({ is_archived: newStatus }).eq('id', item.originalId)
      if (error) throw error
      toast.success(`Item ${newStatus ? 'archived' : 'unarchived'}`, { id: toastId })
      await fetchItems()
    } catch (err: any) {
      toast.error('Operation failed', { id: toastId })
    } finally {
      setActionMenuOpenId(null)
    }
  }

  const toggleActionMenu = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setActionMenuOpenId(actionMenuOpenId === id ? null : id)
  }

  const navigateToFolder = (folderId: string | null, folderName?: string) => {
    if (folderId === currentFolderId) return
    if (folderId === null) setBreadcrumbs([{ id: null, name: 'Home' }])
    else {
      const index = breadcrumbs.findIndex(b => b.id === folderId)
      if (index !== -1) setBreadcrumbs(breadcrumbs.slice(0, index + 1))
      else setBreadcrumbs([...breadcrumbs, { id: folderId, name: folderName || 'Folder' }])
    }
    setCurrentFolderId(folderId)
  }

  const handleFileClick = async (item: StoredItem) => {
    if (item.type === 'folder') return
    try {
      setIsLoadingPreview(true)
      setShowPreview(true)
      setPreviewFileName(item.name)
      setPreviewContentType(item.contentType || 'application/octet-stream')
      setPreviewUrl(null)
      const { data, error: invokeError } = await supabase.functions.invoke('files-view-url', { body: { fileId: item.originalId } })
      if (invokeError || data?.error) throw new Error(data?.error || invokeError?.message || 'Failed to generate view URL')
      setPreviewUrl(data.viewUrl)
    } catch (err: any) {
      toast.error(err.message)
      setShowPreview(false)
    } finally {
      setIsLoadingPreview(false)
    }
  }

  return (
    <>
      <header className="unified-header">
        <div className="unified-header-content">
          <h1 className="unified-header-title">Cloud Storage</h1>
          <p className="unified-header-subtitle">Securely manage your academic documents</p>
        </div>
      </header>

      <main className="unified-main">
        {/* Storage Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Unified Stats Card */}
          <div className="md:col-span-1 bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Used Storage</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">{(usedBytes / (1024 * 1024)).toFixed(1)} / 500 MB</p>
            </div>
            <div className={`p-3 rounded-2xl bg-blue-50`}>
              <FaFileUpload className="text-xl text-blue-600" />
            </div>
          </div>

          {/* Progress Card */}
          <div className="md:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-4 flex flex-col justify-center">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-semibold text-slate-600">Allocation Status</span>
              <span className="text-xs font-bold text-blue-600">{usedPercent.toFixed(2)}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${usedPercent > 90 ? 'bg-red-500' : 'bg-blue-600'}`}
                style={{ width: `${usedPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleUploadClick}
              disabled={isUploading || loading}
              className="inline-flex items-center rounded-2xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 shadow-sm disabled:opacity-50"
            >
              {isUploading ? <FaSpinner className="animate-spin mr-2" /> : <FaUpload className="mr-2" />}
              Upload
            </button>
            <button
              onClick={openFolderModal}
              className="inline-flex items-center rounded-2xl bg-white border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              <FaFolderPlus className="mr-2 text-blue-600" />
              New Folder
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex bg-white rounded-2xl border border-slate-200 p-1 shadow-sm">
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-50'}`}
              >
                <FaList className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-50'}`}
              >
                <FaThLarge className="h-3.5 w-3.5" />
              </button>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              Show Archived
            </label>
          </div>
        </div>

        {/* Main Explorer Container */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-[400px]">
          {/* Sub-header for Explorer */}
          <div className="px-6 py-3 border-b border-slate-50 bg-slate-50/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Breadcrumbs */}
            <nav className="flex items-center space-x-1 overflow-x-auto text-xs font-medium text-slate-500">
              {breadcrumbs.map((crumb, idx) => (
                <span key={crumb.id || 'root'} className="flex items-center">
                  {idx > 0 && <FaChevronRight className="mx-2 h-2 w-2 text-slate-300" />}
                  <button
                    onClick={() => navigateToFolder(crumb.id)}
                    className={`hover:text-blue-600 transition-colors ${idx === breadcrumbs.length - 1 ? 'font-bold text-slate-900' : ''}`}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>

            {/* Search & Sort Area */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 h-3 w-3" />
                <input
                  type="text"
                  placeholder="Filter items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-full sm:w-40"
                />
              </div>
              <button
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                title="Toggle direction"
              >
                {sortOrder === 'asc' ? <FaSortAmountDown className="h-3 w-3" /> : <FaSortAmountUp className="h-3 w-3" />}
              </button>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
              >
                <option value="name">Name</option>
                <option value="date">Date</option>
                <option value="size">Size</option>
              </select>
            </div>
          </div>

          {/* List/Grid Area */}
          <div className="flex-1 p-4">
            {loading ? (
              <FileSkeleton />
            ) : filteredAndSortedItems.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-center gap-2">
                <FaFileAlt className="h-10 w-10 opacity-10" />
                <p className="text-sm font-medium">No results found</p>
                <p className="text-xs opacity-60">Upload files to populate this folder</p>
              </div>
            ) : viewMode === 'list' ? (
              <div className="divide-y divide-slate-50">
                {filteredAndSortedItems.map((item) => {
                  const isFolder = item.type === 'folder'
                  const Icon = isFolder ? FaFolder : getFileIcon(item.contentType)
                  return (
                    <div
                      key={item.id}
                      onClick={() => isFolder ? navigateToFolder(item.originalId, item.name) : handleFileClick(item)}
                      className="group flex items-center justify-between p-3 rounded-2xl hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${isFolder ? 'bg-amber-50 text-amber-500' : 'bg-blue-50 text-blue-500'}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-slate-800 truncate flex items-center gap-2">
                            {item.name}
                            {item.isArchived && <FaArchive className="h-2.5 w-2.5 text-slate-300" />}
                          </h4>
                          <p className="text-[10px] text-slate-400 font-medium">
                            {isFolder ? 'Directory' : `${item.sizeMb?.toFixed(2)} MB`} • {new Date(item.date).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => toggleActionMenu(item.id, e)}
                            className="p-1.5 text-slate-300 hover:text-slate-600 rounded-lg hover:bg-white"
                          >
                            <FaEllipsisV className="h-3 w-3" />
                          </button>

                          {actionMenuOpenId === item.id && (
                            <div className="absolute right-0 mt-1 w-40 bg-white rounded-2xl shadow-xl border border-slate-100 z-20 py-1.5 text-[11px] font-semibold text-slate-600">
                              <button onClick={(e) => openRenameModal(item, e)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2">
                                <FaEdit className="h-3 w-3" /> Rename
                              </button>
                              <button onClick={(e) => handleArchiveToggle(item, e)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2">
                                <FaArchive className="h-3 w-3" /> {item.isArchived ? 'Restore' : 'Archive'}
                              </button>
                              <div className="my-1 border-t border-slate-50"></div>
                              <button onClick={(e) => handleDeleteItem(item, e)} className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-500 flex items-center gap-2">
                                <FaTrash className="h-3 w-3" /> Trash
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                {filteredAndSortedItems.map((item) => {
                  const isFolder = item.type === 'folder'
                  const Icon = isFolder ? FaFolder : getFileIcon(item.contentType)
                  return (
                    <div
                      key={item.id}
                      onClick={() => isFolder ? navigateToFolder(item.originalId, item.name) : handleFileClick(item)}
                      className="group p-4 rounded-2xl bg-slate-50/30 hover:bg-white border border-transparent hover:border-slate-100 transition-all cursor-pointer relative flex flex-col items-center"
                    >
                      <Icon className={`h-10 w-10 mb-3 ${isFolder ? 'text-amber-500' : 'text-blue-500'}`} />
                      <h4 className="text-[11px] font-bold text-slate-800 text-center line-clamp-2">{item.name}</h4>
                      <p className="text-[9px] text-slate-400 font-bold mt-1 uppercase">{isFolder ? 'Dir' : `${item.sizeMb?.toFixed(1)} MB`}</p>

                        <button
                          onClick={(e) => toggleActionMenu(item.id, e)}
                          className="absolute top-2 right-2 p-1 text-slate-200 hover:text-slate-500 opacity-0 group-hover:opacity-100"
                        >
                          <FaEllipsisV className="h-2.5 w-2.5" />
                        </button>

                      {actionMenuOpenId === item.id && (
                        <div className="absolute top-8 right-2 w-32 bg-white rounded-lg shadow-xl border border-slate-100 z-20 py-1 text-[10px] font-bold">
                          <button onClick={(e) => openRenameModal(item, e)} className="w-full text-left px-2.5 py-1.5 hover:bg-slate-50 flex items-center gap-2">
                            <FaEdit className="h-2.5 w-2.5" /> Rename
                          </button>
                          <button onClick={(e) => handleArchiveToggle(item, e)} className="w-full text-left px-2.5 py-1.5 hover:bg-slate-50 flex items-center gap-2">
                            <FaArchive className="h-2.5 w-2.5" /> {item.isArchived ? 'Restore' : 'Archive'}
                          </button>
                          <button onClick={(e) => handleDeleteItem(item, e)} className="w-full text-left px-2.5 py-1.5 hover:bg-red-50 text-red-500 flex items-center gap-2">
                            <FaTrash className="h-2.5 w-2.5" /> Trash
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Standard Dialogs */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={() => !isCreatingFolder && setShowFolderModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden border border-slate-100">
            <div className="p-6 border-b border-slate-50">
              <h2 className="text-lg font-bold text-slate-900">New Folder</h2>
              <p className="text-xs text-slate-400 mt-1">Provide a name for your directory</p>
            </div>
            <div className="p-6">
              <input
                ref={folderInputRef}
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Enter name..."
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 bg-slate-50/50"
                disabled={isCreatingFolder}
              />
            </div>
            <div className="px-6 py-4 bg-slate-50 flex gap-2">
              <button onClick={() => setShowFolderModal(false)} className="flex-1 py-2 text-xs font-bold text-slate-500 hover:text-slate-700">Cancel</button>
              <button
                onClick={handleCreateFolder}
                className="flex-1 py-2 rounded-lg bg-blue-700 text-white text-xs font-bold hover:bg-blue-800 disabled:opacity-50"
                disabled={!newFolderName.trim() || isCreatingFolder}
              >
                {isCreatingFolder ? 'Creating...' : 'Create Folder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={() => !isRenaming && setShowRenameModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden border border-slate-100">
            <div className="p-6 border-b border-slate-50">
              <h2 className="text-lg font-bold text-slate-900">Rename {itemToRename?.type === 'folder' ? 'Folder' : 'File'}</h2>
              <p className="text-xs text-slate-400 mt-1">Enter a new name for your {itemToRename?.type === 'folder' ? 'directory' : 'document'}</p>
            </div>
            <div className="p-6">
              <input
                ref={renameInputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter new name..."
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 bg-slate-50/50"
                disabled={isRenaming}
                onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
              />
            </div>
            <div className="px-6 py-4 bg-slate-50 flex gap-2">
              <button
                onClick={() => setShowRenameModal(false)}
                className="flex-1 py-2 text-xs font-bold text-slate-500 hover:text-slate-700"
                disabled={isRenaming}
              >
                Cancel
              </button>
              <button
                onClick={handleRenameSubmit}
                className="flex-1 py-2 rounded-lg bg-blue-700 text-white text-xs font-bold hover:bg-blue-800 disabled:opacity-50"
                disabled={!newName.trim() || isRenaming || newName.trim() === itemToRename?.name}
              >
                {isRenaming ? 'Renaming...' : 'Save Name'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Standard Preview */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowPreview(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 flex items-center justify-between border-b border-slate-50 bg-white shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0">
                  {React.createElement(getFileIcon(previewContentType), { className: 'h-5 w-5 text-blue-600' })}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-slate-900 truncate">{previewFileName}</h2>
                  <p className="text-[10px] font-bold text-slate-300 uppercase leading-none mt-1">{previewContentType}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {previewUrl && <a href={previewUrl} download className="p-2.5 rounded-lg bg-slate-50 text-slate-500 hover:text-blue-600"><FaDownload className="h-4 w-4" /></a>}
                <button onClick={() => setShowPreview(false)} className="p-2.5 rounded-lg bg-slate-50 text-slate-300 hover:text-red-500"><FaTimes className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="flex-1 bg-slate-50 p-6 flex items-center justify-center overflow-auto relative">
              {isLoadingPreview ? <FaSpinner className="h-8 w-8 animate-spin text-blue-500/20" /> : previewUrl ? (
                <div className="w-full h-full flex items-center justify-center">
                  {(() => {
                    const pType = getPreviewType(previewContentType)
                    switch (pType) {
                      case 'image': return <img src={previewUrl} alt={previewFileName} className="max-w-full max-h-full object-contain rounded-2xl shadow-lg border-4 border-white" />
                      case 'pdf': return <iframe src={previewUrl} className="w-full h-full rounded-2xl border border-slate-200 bg-white" title={previewFileName} />
                      case 'video': return <video controls className="max-w-full max-h-full rounded-2xl shadow-lg"><source src={previewUrl} type={previewContentType} /></video>
                      case 'audio': return (
                        <div className="bg-white p-10 rounded-2xl shadow-xl flex flex-col items-center gap-6 w-full max-w-sm border border-slate-100">
                          <FaFileAudio className="h-12 w-12 text-blue-500" />
                          <audio controls className="w-full"><source src={previewUrl} type={previewContentType} /></audio>
                          <p className="text-[11px] font-bold text-slate-500 px-4 text-center">{previewFileName}</p>
                        </div>
                      )
                      case 'office': return (
                        <iframe 
                          src={`https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(previewUrl)}`} 
                          className="w-full h-full rounded-2xl border border-slate-200 bg-white" 
                          title={previewFileName}
                        />
                      )
                      case 'text': return (
                        <div className="w-full h-full bg-white rounded-2xl border border-slate-200 p-6 overflow-auto">
                          <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap">{previewUrl}</pre>
                        </div>
                      )
                      default: return (
                        <div className="bg-white p-10 rounded-2xl shadow-xl flex flex-col items-center gap-6 text-center max-w-xs border border-slate-100">
                          <FaFileAlt className="h-12 w-12 text-slate-100" />
                          <div>
                            <p className="text-sm font-bold text-slate-800">Preview Unavailable</p>
                            <p className="text-xs text-slate-400 mt-2 line-clamp-2">This file can only be downloaded to your local device for viewing.</p>
                          </div>
                          <a href={previewUrl} download className="w-full py-3 rounded-2xl bg-blue-700 text-white text-xs font-bold hover:bg-blue-800">Download File</a>
                        </div>
                      )
                    }
                  })()}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default Files
