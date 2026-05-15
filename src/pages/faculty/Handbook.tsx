import React, { useState, useMemo, useEffect } from 'react'
import {
  FaBookOpen,
  FaChevronLeft,
  FaChevronRight,
} from 'react-icons/fa'
import { fetchHandbookTree, buildTree, type HandbookNode } from '../../lib/api/handbook'
import { fetchPublishedHandbook } from '../../lib/api/handbookWorkflow'
import { searchHandbook, findPathToNode, type HandbookSearchHit } from '../../lib/handbookSearch'
import HandbookSearchToolbar from '../../components/handbook/HandbookSearchToolbar'
import HandbookSearchResults from '../../components/handbook/HandbookSearchResults'
import { handbookData } from '../../data/handbookData'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'

// Fallback: build tree from static data
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

// Flatten all leaf nodes for prev/next navigation
function flattenLeaves(nodes: HandbookNode[]): HandbookNode[] {
  const result: HandbookNode[] = []
  const traverse = (list: HandbookNode[]) => {
    for (const n of list) {
      if (n.children.length === 0) result.push(n)
      else traverse(n.children)
    }
  }
  traverse(nodes)
  return result
}

const FacultyHandbook: React.FC = () => {
  const { user } = useAuth()
  const [tree, setTree] = useState<HandbookNode[]>([])
  const [loading, setLoading] = useState(true)
  const [navStack, setNavStack] = useState<HandbookNode[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  const currentLevel: HandbookNode[] = navStack.length === 0 ? tree : navStack[navStack.length - 1].children
  const activeNode = navStack[navStack.length - 1] ?? null
  const isReading = activeNode !== null && activeNode.children.length === 0

  // Log a view whenever a section is opened, recording the duration stayed
  useEffect(() => {
    if (!isReading || !activeNode || !isSupabaseConfigured || !user?.id) return;

    const startTime = Date.now();
    const nodeId = activeNode.id;

    return () => {
      const endTime = Date.now();
      const durationSeconds = Math.round((endTime - startTime) / 1000);

      // Only log if they stayed for more than 1 second to filter out quick clicks
      if (durationSeconds >= 1) {
        supabase
          .from('handbook_views')
          .insert({
            user_id: user.id,
            section_id: nodeId,
            duration_seconds: durationSeconds
          })
          .then(({ error }) => {
            if (error) console.error('[handbook_views insert]', error.message, error.details);
          });
      }
    };
  }, [isReading, activeNode?.id, user?.id]);

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      // Fetch only the published handbook
      const { data: handbook, error: handbookError } = await fetchPublishedHandbook()
      
      if (handbookError || !handbook) {
        // No published handbook available, use fallback
        if (!cancelled) {
          setTree(buildFallback())
          setLoading(false)
        }
        return
      }

      const { data, error } = await fetchHandbookTree(handbook.id)
      
      if (!cancelled) {
        if (error || !data || data.length === 0) {
          setTree(buildFallback())
        } else {
          setTree(data)
        }
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const handleNodeClick = (node: HandbookNode) => {
    setNavStack((prev) => [...prev, node])
    setSearchQuery('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleBack = () => {
    setNavStack((prev) => prev.slice(0, -1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Prev / Next across all leaves
  const allLeaves = useMemo(() => flattenLeaves(tree), [tree])
  const leafIndex = isReading ? allLeaves.findIndex((l) => l.id === activeNode.id) : -1
  const prevLeaf = leafIndex > 0 ? allLeaves[leafIndex - 1] : null
  const nextLeaf = leafIndex >= 0 && leafIndex < allLeaves.length - 1 ? allLeaves[leafIndex + 1] : null

  const navigateToLeaf = (leaf: HandbookNode) => {
    const stack = findPathToNode(tree, leaf.id)
    if (stack) {
      setNavStack(stack)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const isSearchActive = searchQuery.trim().length > 0
  const searchHits = useMemo(
    () => (isSearchActive ? searchHandbook(tree, searchQuery) : []),
    [tree, searchQuery, isSearchActive]
  )

  const handleSearchHitSelect = (hit: HandbookSearchHit) => {
    const stack = findPathToNode(tree, hit.node.id)
    if (stack) {
      setNavStack(stack)
      setSearchQuery('')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const breadcrumbs = navStack.map((n) => n.title).join(' / ')

  return (
    <>
      <header className="unified-header">
        <div className="unified-header-content">
          <h1 className="unified-header-title">Handbook</h1>
          <p className="unified-header-subtitle">Academic Year 2025–2026</p>
        </div>
      </header>

      <HandbookSearchToolbar
        showBack={navStack.length > 0}
        onBack={handleBack}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        breadcrumbText={navStack.length > 0 ? breadcrumbs : null}
      />

      <main className="unified-main">
        {loading && (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <svg className="animate-spin h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading handbook…
          </div>
        )}

        {!loading && isSearchActive && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
            <HandbookSearchResults
              hits={searchHits}
              query={searchQuery}
              onSelect={handleSearchHitSelect}
            />
          </div>
        )}

        {/* Chapter list */}
        {!loading && !isSearchActive && navStack.length === 0 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 text-center mb-6">
              <div className="h-16 w-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3">
                <FaBookOpen className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Welcome to the Student Handbook</h2>
              <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
                Your guide to academic policies, student conduct, and campus life at Dr. Yanga's Colleges, Inc.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {currentLevel.map((node) => (
                <button
                  key={node.id}
                  onClick={() => handleNodeClick(node)}
                  className="group bg-white rounded-2xl shadow-sm border border-slate-200 p-4 hover:shadow-md hover:border-blue-300 transition-all text-left flex items-start gap-4"
                >
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <FaBookOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">{node.title}</h3>
                    <p className="text-xs text-slate-500 mt-1">{node.children.length} sections</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Drill-down list */}
        {!loading && !isSearchActive && navStack.length > 0 && !isReading && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-900">{activeNode.title}</h2>
            </div>
            <div className="space-y-2">
              {currentLevel.map((node) => (
                <button
                  key={node.id}
                  onClick={() => handleNodeClick(node)}
                  className="w-full bg-white rounded-2xl border border-slate-200 p-4 text-left hover:border-blue-400 hover:shadow-md transition-all flex items-center justify-between group"
                >
                  <span className="font-medium text-slate-700 group-hover:text-blue-700">
                    {node.title}
                  </span>
                  <FaChevronRight className="text-slate-300 group-hover:text-blue-500 text-xs" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Content reader */}
        {!loading && !isSearchActive && isReading && (
          <div className="animate-in zoom-in-95 duration-300 max-w-4xl mx-auto">
            <div className="bg-white rounded-t-2xl border-x border-t border-slate-200 p-6 pb-4">
              <h2 className="text-xl font-bold text-slate-900">{activeNode.title}</h2>
            </div>
            <div className="bg-white rounded-b-2xl border border-slate-200 p-6 pt-2 shadow-sm min-h-[300px]">
              <div
                className="prose prose-sm prose-slate max-w-none prose-headings:text-slate-800 prose-p:text-slate-600 prose-li:text-slate-600"
                dangerouslySetInnerHTML={{ __html: activeNode.content ?? '' }}
              />
            </div>
            <div className="mt-6 flex items-center justify-between gap-4">
              <button
                onClick={() => prevLeaf ? navigateToLeaf(prevLeaf) : handleBack()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-medium text-sm transition-colors"
              >
                <FaChevronLeft className="text-xs" />
                {prevLeaf ? prevLeaf.title : 'Back'}
              </button>
              {nextLeaf && (
                <button
                  onClick={() => navigateToLeaf(nextLeaf)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 shadow-sm transition-colors"
                >
                  {nextLeaf.title}
                  <FaChevronRight className="text-xs" />
                </button>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  )
}

export default FacultyHandbook
