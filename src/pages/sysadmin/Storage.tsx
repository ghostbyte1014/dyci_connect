import React, { useState, useEffect, useMemo } from 'react';
import {
  FaChevronLeft,
  FaChevronRight,
  FaSearch,
  FaHdd,
  FaFileAlt,
  FaDatabase,
  FaArchive,
  FaVideo,
  FaFileImage,
  FaFileVideo,
  FaFileArchive,
  FaExternalLinkAlt,
  FaTrash,
  FaUsers,
  FaSort,
  FaSortUp,
  FaSortDown,
} from 'react-icons/fa';
import { Skeleton } from '../../components/ui/Skeleton';
import { supabase } from '../../lib/supabaseClient';

// ─── Utilities ───────────────────────────────────────────────────────
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const timeAgo = (dateStr: string): string => {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
};

const getFileIcon = (type: string | null) => {
  if (!type) return FaFileAlt;
  if (type.startsWith('image/')) return FaFileImage;
  if (type.startsWith('video/')) return FaFileVideo;
  if (type.includes('zip') || type.includes('rar') || type.includes('tar'))
    return FaFileArchive;
  return FaFileAlt;
};

// ─── Constants ───────────────────────────────────────────────────────
const PAGE_SIZE = 20;
const INSTITUTIONAL_LIMIT = 10 * 1024 * 1024 * 1024; // 10 GB R2 Limit
const SUPABASE_LIMIT = 1 * 1024 * 1024 * 1024; // 1 GB Supabase Limit
const PER_USER_LIMIT = 500 * 1024 * 1024; // 500 MB

// ─── Types ───────────────────────────────────────────────────────────
interface FileRecord {
  id: string;
  name: string;
  size: number;
  type: string | null;
  uploaded_at: string;
  deleted_at: string | null;
  is_archived: boolean;
  object_key: string | null;
  user_id: string;
  owner?: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  };
}

interface TopConsumer {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  total_size: number;
  file_count: number;
}

type SortField = 'name' | 'size' | 'uploaded_at';
type SortDir = 'asc' | 'desc';
type FilterTab = 'all' | 'active' | 'archived' | 'deleted';

// ─── Component ───────────────────────────────────────────────────────
const SysAdminStorage: React.FC = () => {
  // Stats
  const [totalFiles, setTotalFiles] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [archivedCount, setArchivedCount] = useState(0);
  const [archivedBytes, setArchivedBytes] = useState(0);
  const [deletedCount, setDeletedCount] = useState(0);
  const [deletedBytes, setDeletedBytes] = useState(0);
  const [r2Bytes, setR2Bytes] = useState(0);
  const [supabaseBytes, setSupabaseBytes] = useState(0);

  // File browser
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('uploaded_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Top consumers
  const [topConsumers, setTopConsumers] = useState<TopConsumer[]>([]);

  // ─── Data Loading ──────────────────────────────────────────────────
  useEffect(() => {
    fetchStats();
    fetchTopConsumers();
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [sortField, sortDir, filterTab, page, search]);

  const fetchStats = async () => {
    try {
      // Active files
      const { data: active, error: activeErr } = await supabase
        .from('files')
        .select('size, object_key, deleted_at, is_archived');

      if (activeErr) {
        console.error('Error fetching file stats:', activeErr);
        console.error('Error details:', activeErr.message, activeErr.details, activeErr.hint);
        return;
      }

      // Fetch Video Network (Institutional R2) stats
      const { data: vNet, error: vNetErr } = await supabase
        .from('platform_videos')
        .select('video_size, thumbnail_size');

      let vNetBytes = 0;
      let vNetCount = 0;
      if (!vNetErr && vNet) {
        vNetCount = vNet.length;
        vNetBytes = vNet.reduce((s: number, v: any) => s + (v.video_size || 0) + (v.thumbnail_size || 0), 0);
      }

      const allFiles = active || [];
      const activeFiles = allFiles.filter((f: any) => !f.deleted_at && !f.is_archived);
      const archivedFiles = allFiles.filter((f: any) => !f.deleted_at && f.is_archived);
      const deletedFiles = allFiles.filter((f: any) => f.deleted_at);

      setTotalFiles(activeFiles.length + vNetCount);
      setArchivedCount(archivedFiles.length);
      setArchivedBytes(archivedFiles.reduce((s: number, f: any) => s + (f.size || 0), 0));
      setDeletedCount(deletedFiles.length);
      setDeletedBytes(deletedFiles.reduce((s: number, f: any) => s + (f.size || 0), 0));

      // Segment by storage backend
      // Include archived and deleted in R2 calculation if they are in the R2 students bucket
      // PLUS all Video Network bytes
      const r2 = allFiles.filter((f: any) => f.object_key && f.object_key.startsWith('students/'));
      const r2Val = r2.reduce((s: number, f: any) => s + (f.size || 0), 0) + vNetBytes;
      setR2Bytes(r2Val);

      // Fetch physical Supabase storage for the green bar
      const { data: physicalStorage, error: physError } = await supabase.rpc('get_physical_storage_size');
      let sbBytes = 0;
      if (!physError && typeof physicalStorage === 'number') {
        sbBytes = physicalStorage;
        setSupabaseBytes(sbBytes);
      } else {
        const sb = allFiles.filter((f: any) => !f.object_key || !f.object_key.startsWith('students/'));
        sbBytes = sb.reduce((s: number, f: any) => s + (f.size || 0), 0);
        setSupabaseBytes(sbBytes);
      }

      // Update total combined storage
      setTotalBytes(r2Val + sbBytes);
    } catch (err) {
      console.error('Stats fetch error:', err);
    }
  };

  const fetchFiles = async () => {
    setFilesLoading(true);
    try {
      let query = supabase
        .from('files')
        .select(`
          id, name, size, type, uploaded_at, deleted_at, is_archived, object_key, user_id,
          owner:profiles!user_id(first_name, last_name, email)
        `, { count: 'exact' });

      // Filter
      if (filterTab === 'active') {
        query = query.is('deleted_at', null).eq('is_archived', false);
      } else if (filterTab === 'archived') {
        query = query.is('deleted_at', null).eq('is_archived', true);
      } else if (filterTab === 'deleted') {
        query = query.not('deleted_at', 'is', null);
      }

      // Search
      if (search.trim()) {
        query = query.ilike('name', `%${search.trim()}%`);
      }

      // Sort
      query = query.order(sortField, { ascending: sortDir === 'asc' });

      // Pagination
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.range(from, to);

      const { data: fileData, error: fileErr, count: fileCount } = await query;

      // Secondary Fetch: Video Network Assets (if on active/all tabs)
      let vNetData: any[] = [];
      if (filterTab === 'active' || filterTab === 'all') {
        let vQuery = supabase
          .from('platform_videos')
          .select(`
                id, title, video_size, updated_at, r2_url, uploaded_by,
                owner:profiles!uploaded_by(first_name, last_name, email)
            `);

        if (search.trim()) {
          vQuery = vQuery.ilike('title', `%${search.trim()}%`);
        }

        const { data: vData } = await vQuery;
        if (vData) {
          vNetData = vData.map(v => ({
            id: v.id,
            name: `[Video Network] ${v.title}`,
            size: v.video_size || 0,
            type: 'video/mp4',
            uploaded_at: v.updated_at,
            deleted_at: null,
            is_archived: false,
            object_key: v.r2_url,
            user_id: v.uploaded_by,
            owner: v.owner
          }));
        }
      }

      if (fileErr) {
        console.error('Error fetching files:', fileErr);
        setFiles([]);
        return;
      }

      // Merge and Sort
      const combined = [...(fileData || []), ...vNetData];
      combined.sort((a, b) => {
        const valA = a[sortField];
        const valB = b[sortField];
        if (sortDir === 'asc') return valA > valB ? 1 : -1;
        return valA < valB ? 1 : -1;
      });

      setFiles(combined);
      setTotalCount((fileCount || 0) + vNetData.length);
    } catch (err) {
      console.error('Files fetch error:', err);
    } finally {
      setFilesLoading(false);
    }
  };

  const fetchTopConsumers = async () => {
    try {
      // Fetch all active files with owner info
      const { data, error } = await supabase
        .from('files')
        .select(`
          user_id, size,
          owner:profiles!user_id(first_name, last_name, email)
        `)
        .is('deleted_at', null);

      if (error || !data) {
        console.error('Error fetching consumers:', error);
        if (error) {
          console.error('Error details:', error.message, error.details, error.hint, error.code);
        }
        return;
      }

      // Aggregate by user
      const userMap = new Map<string, TopConsumer>();
      for (const file of data as any[]) {
        const uid = file.user_id;
        if (!userMap.has(uid)) {
          userMap.set(uid, {
            user_id: uid,
            first_name: file.owner?.first_name || '',
            last_name: file.owner?.last_name || '',
            email: file.owner?.email || '',
            total_size: 0,
            file_count: 0,
          });
        }
        const entry = userMap.get(uid)!;
        entry.total_size += file.size || 0;
        entry.file_count += 1;
      }

      const sorted = Array.from(userMap.values())
        .sort((a, b) => b.total_size - a.total_size)
        .slice(0, 10);

      setTopConsumers(sorted);
    } catch (err) {
      console.error('Consumers fetch error:', err);
    }
  };

  // ─── Computed ──────────────────────────────────────────────────────
  const usagePercent = useMemo(
    () => Math.min((totalBytes / INSTITUTIONAL_LIMIT) * 100, 100),
    [totalBytes]
  );
  // usagePercent might be used in future for a global gauge, keeping for logic but suppressing lint
  void usagePercent;

  const r2Percent = useMemo(
    () => INSTITUTIONAL_LIMIT > 0 ? (r2Bytes / INSTITUTIONAL_LIMIT) * 100 : 0,
    [r2Bytes]
  );
  const sbPercent = useMemo(
    () => INSTITUTIONAL_LIMIT > 0 ? (supabaseBytes / INSTITUTIONAL_LIMIT) * 100 : 0,
    [supabaseBytes]
  );
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(0);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <FaSort className="text-slate-300 ml-1" />;
    return sortDir === 'asc' ? (
      <FaSortUp className="text-blue-600 ml-1" />
    ) : (
      <FaSortDown className="text-blue-600 ml-1" />
    );
  };

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <>
      <header className="unified-header">
        <div className="unified-header-content">
          <h1 className="unified-header-title">Data Storage</h1>
          <p className="unified-header-subtitle">
            Institutional file repository and infrastructure capacity.
          </p>
        </div>
      </header>

      <main className="unified-main">
        {/* ── Section 1: Statistics Cards ──────────────────────────── */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border-l-[6px] border-l-blue-600 border-y border-r border-y-slate-100 border-r-slate-100 bg-white p-4 sm:p-5 shadow-sm">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              Active Files
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {totalFiles.toLocaleString()}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">
              Institutional records in the system
            </p>
          </div>

          <div className="rounded-2xl border-l-[6px] border-l-slate-200 border-y border-r border-y-slate-100 border-r-slate-100 bg-white p-4 sm:p-5 shadow-sm">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              Storage Used
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {formatBytes(totalBytes)}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">
              Total usage across all storage providers
            </p>
          </div>

          <div className="rounded-2xl border-l-[6px] border-l-amber-500 border-y border-r border-y-slate-100 border-r-slate-100 bg-white p-4 sm:p-5 shadow-sm">
            <div className="flex items-center gap-1.5">
              <FaArchive className="text-amber-500 text-[10px]" />
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                Archived
              </p>
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {archivedCount.toLocaleString()}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">
              {formatBytes(archivedBytes)} flagged as archived
            </p>
          </div>

          <div className="rounded-2xl border-l-[6px] border-l-rose-500 border-y border-r border-y-slate-100 border-r-slate-100 bg-white p-4 sm:p-5 shadow-sm">
            <div className="flex items-center gap-1.5">
              <FaArchive className="text-rose-500 text-[10px]" />
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                Deleted
              </p>
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {deletedCount.toLocaleString()}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">
              {formatBytes(deletedBytes)} soft-deleted files
            </p>
          </div>
        </section>

        {/* ── Section 4: Capacity Overview ─────────────────────────── */}
        <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-medium text-slate-500">
              {formatBytes(totalBytes)} utilized
            </span>
            <span className="text-[10px] font-medium text-slate-400">
              of {formatBytes(INSTITUTIONAL_LIMIT + SUPABASE_LIMIT)} total capacity
            </span>
          </div>

          {/* Segmented bar — both segments relative to combined capacity (11 GB) */}
          {(() => {
            const totalCap = INSTITUTIONAL_LIMIT + SUPABASE_LIMIT;
            const r2Pct = Math.max((r2Bytes / totalCap) * 100, r2Bytes > 0 ? 0.3 : 0);
            const sbPct = Math.max((supabaseBytes / totalCap) * 100, supabaseBytes > 0 ? 0.3 : 0);
            return (
              <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden flex">
                {r2Bytes > 0 && (
                  <div
                    className="h-full bg-orange-500 transition-all duration-500"
                    style={{ width: `${r2Pct}%`, minWidth: '4px' }}
                  />
                )}
                {supabaseBytes > 0 && (
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${sbPct}%`, minWidth: '4px' }}
                  />
                )}
              </div>
            );
          })()}

          <div className="flex flex-wrap gap-5 mt-3 text-[10px] text-slate-500">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-orange-500" />
              Cloudflare R2 — {formatBytes(r2Bytes)} (of 10 GB)
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
              Supabase — {formatBytes(supabaseBytes)} (of 1 GB)
            </div>
          </div>
        </section>

        {/* ── Section 2: File Browser ──────────────────────────────── */}
        <section className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
          {/* Toolbar */}
          <div className="px-5 pt-5 pb-3 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-800">
                File Directory
              </h2>
              <span className="text-[10px] text-slate-400">
                {totalCount.toLocaleString()} records
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Search by file name..."
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-8 pr-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Filter tabs */}
              <div className="flex rounded-2xl border border-slate-200 overflow-hidden text-[10px] font-medium">
                {(['all', 'active', 'archived', 'deleted'] as FilterTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => {
                      setFilterTab(tab);
                      setPage(0);
                    }}
                    className={`px-3 py-2 capitalize transition-colors ${filterTab === tab
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-t border-b border-slate-100 bg-slate-50/50 text-left text-slate-500">
                  <th
                    className="px-5 py-2.5 font-medium cursor-pointer select-none"
                    onClick={() => handleSort('name')}
                  >
                    <span className="inline-flex items-center">
                      File Name <SortIcon field="name" />
                    </span>
                  </th>
                  <th className="px-5 py-2.5 font-medium">Owner</th>
                  <th
                    className="px-5 py-2.5 font-medium cursor-pointer select-none"
                    onClick={() => handleSort('size')}
                  >
                    <span className="inline-flex items-center">
                      Size <SortIcon field="size" />
                    </span>
                  </th>
                  <th className="px-5 py-2.5 font-medium">Type</th>
                  <th
                    className="px-5 py-2.5 font-medium cursor-pointer select-none"
                    onClick={() => handleSort('uploaded_at')}
                  >
                    <span className="inline-flex items-center">
                      Uploaded <SortIcon field="uploaded_at" />
                    </span>
                  </th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filesLoading ? (
                  [...Array(10)].map((_, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="px-5 py-3"><Skeleton variant="text" width={180} /></td>
                      <td className="px-5 py-3"><Skeleton variant="text" width={120} /></td>
                      <td className="px-5 py-3"><Skeleton variant="text" width={60} /></td>
                      <td className="px-5 py-3"><Skeleton variant="text" width={80} /></td>
                      <td className="px-5 py-3"><Skeleton variant="text" width={100} /></td>
                      <td className="px-5 py-3"><Skeleton height={20} width={60} className="rounded-full" /></td>
                    </tr>
                  ))
                ) : files.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                      {search
                        ? `No files matching "${search}"`
                        : 'No files found in the system.'}
                    </td>
                  </tr>
                ) : (
                  files.map((file) => {
                    const Icon = getFileIcon(file.type);
                    const ownerName =
                      file.owner
                        ? `${file.owner.first_name || ''} ${file.owner.last_name || ''}`.trim() ||
                        file.owner.email ||
                        '—'
                        : '—';

                    return (
                      <tr
                        key={file.id}
                        className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <Icon className="text-slate-400 flex-shrink-0" />
                            <span className="text-slate-800 truncate max-w-[200px]">
                              {file.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-slate-600 truncate max-w-[140px]">
                          {ownerName}
                        </td>
                        <td className="px-5 py-3 text-slate-600 tabular-nums">
                          {formatBytes(file.size)}
                        </td>
                        <td className="px-5 py-3 text-slate-400 truncate max-w-[100px]">
                          {file.type || '—'}
                        </td>
                        <td className="px-5 py-3 text-slate-500">
                          {timeAgo(file.uploaded_at)}
                        </td>
                        <td className="px-5 py-3">
                          {file.deleted_at ? (
                            <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-medium text-rose-700">
                              Deleted
                            </span>
                          ) : file.is_archived ? (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-medium text-amber-700">
                              Archived
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-medium text-emerald-700">
                              Active
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-[10px] text-slate-500">
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <FaChevronLeft />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <FaChevronRight />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── Section 3: Top Storage Consumers ─────────────────────── */}
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <FaUsers className="text-slate-400 text-xs" />
            <h2 className="text-xs font-semibold text-slate-800">
              Top Storage Consumers
            </h2>
          </div>

          {topConsumers.length === 0 ? (
            <p className="text-[11px] text-slate-400 py-4 text-center">
              No file upload data yet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {topConsumers.map((user, idx) => {
                const quotaPercent = Math.min(
                  (user.total_size / PER_USER_LIMIT) * 100,
                  100
                );
                const isHigh = quotaPercent > 80;

                return (
                  <div
                    key={user.user_id}
                    className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0"
                  >
                    {/* Rank */}
                    <span className="text-[10px] font-bold text-slate-300 w-5 text-right tabular-nums">
                      {idx + 1}
                    </span>

                    {/* User info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-slate-800 truncate">
                        {user.first_name} {user.last_name}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {user.email}
                      </p>
                    </div>

                    {/* Stats */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-[11px] font-semibold text-slate-700 tabular-nums">
                        {formatBytes(user.total_size)}
                      </p>
                      <p className="text-[9px] text-slate-400">
                        {user.file_count} file{user.file_count !== 1 ? 's' : ''}
                      </p>
                    </div>

                    {/* Quota bar */}
                    <div className="w-20 flex-shrink-0">
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${isHigh ? 'bg-rose-500' : 'bg-blue-500'
                            }`}
                          style={{ width: `${quotaPercent}%` }}
                        />
                      </div>
                      <p className="text-[9px] text-slate-400 mt-0.5 text-right tabular-nums">
                        {quotaPercent.toFixed(0)}%
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Section 5: Soft Deleted Files Panel ──────────────────────── */}
        {deletedCount > 0 && (
          <section className="rounded-2xl border border-rose-100 bg-rose-50/30 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <FaArchive className="text-rose-500 text-xs" />
              <h2 className="text-xs font-semibold text-rose-800">
                Soft Deleted Files
              </h2>
            </div>
            <p className="text-[11px] text-rose-700/70 mb-0">
              {deletedCount} file{deletedCount !== 1 ? 's' : ''} ({formatBytes(deletedBytes)}) have been soft-deleted by users.
              These records are retained in the database for audit purposes.
            </p>
          </section>
        )}
      </main>

      {/* Legacy Footer */}
      <footer className="max-w-6xl mx-auto px-10 py-10 opacity-40">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400 border-t border-slate-200 pt-6">
          <span>Storage Management</span>
          <span>DYCI CONNECT v7.0</span>
        </div>
      </footer>
    </>
  );
};

export default SysAdminStorage;
