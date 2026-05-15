import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import toast from 'react-hot-toast';
import { FaPlus, FaEdit, FaTimes, FaCheck, FaBan } from 'react-icons/fa';
import { Skeleton } from '../../ui/Skeleton';

interface CollegeOffice {
  id: string;
  name: string;
  slug: string;
  level: number;
  is_active: boolean;
}

const AdministrativeManager: React.FC = () => {
  const [offices, setOffices] = useState<CollegeOffice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', slug: '', level: 2, is_active: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchOffices(); }, []);

  const fetchOffices = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('college_offices')
        .select('*');
      console.log('--- DIAGNOSIS: Fetching offices ---', { data, error });

      // If sort_order or level sorting fails because of missing columns, we can see it here
      const sortedData = data ? [...data].sort((a, b) => (a.level || 0) - (b.level || 0) || (a.name || '').localeCompare(b.name || '')) : [];

      if (!error && (!data || data.length === 0)) {
        const defaults = [
          { name: 'Scholarship', slug: 'scholarship', level: 2, is_active: true },
          { name: 'Department of Finance', slug: 'finance', level: 2, is_active: true },
          { name: 'Office of the Registrar', slug: 'registrar', level: 2, is_active: true },
          { name: 'Guidance Office', slug: 'guidance', level: 2, is_active: true },
          { name: 'Property/Security Office', slug: 'property_security', level: 2, is_active: true },
          { name: 'Academic Council', slug: 'academic_council', level: 3, is_active: true },
          { name: 'Office of the President', slug: 'president', level: 3, is_active: true },
          { name: 'Office of the Vice President', slug: 'vice_president', level: 3, is_active: true },
        ];
        await supabase.from('college_offices').insert(defaults);
        const { data: refetched } = await supabase
          .from('college_offices')
          .select('*')
          .order('level', { ascending: true })
          .order('name', { ascending: true });
        setOffices(refetched || []);
      } else {
        setOffices(data || []);
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to load administrative office registry.');
    } finally {
      setLoading(false);
    }
  };

  const generateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setFormData({ ...formData, name, slug: editingId ? formData.slug : generateSlug(name) });
  };

  const openModal = (office?: CollegeOffice) => {
    if (office) {
      setEditingId(office.id);
      setFormData({ name: office.name, slug: office.slug, level: office.level, is_active: office.is_active });
    } else {
      setEditingId(null);
      setFormData({ name: '', slug: '', level: 2, is_active: true });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase.from('college_offices').update(formData).eq('id', editingId);
        if (error) throw error;
        toast.success('Office updated');
      } else {
        const { error } = await supabase.from('college_offices').insert([formData]);
        if (error) throw error;
        toast.success('Office created');
      }
      setShowModal(false);
      setEditingId(null);
      fetchOffices();
    } catch (error: any) {
      toast.error('Failed to save office configuration. Please verify your permissions.')
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase.from('college_offices').update({ is_active: !currentStatus }).eq('id', id);
      if (error) throw error;
      toast.success(`Office ${!currentStatus ? 'activated' : 'deactivated'}`);
      fetchOffices();
    } catch (error) {
      console.error('Error toggling status:', error);
      toast.error('Status transition failed. Please try again.')
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{offices.length} Office{offices.length !== 1 ? 's' : ''} Registered</p>
        <button onClick={() => openModal()} className="bg-white hover:bg-slate-100 text-dyci-blue text-[10px] font-bold px-4 py-2 rounded-full transition-all shadow-sm active:scale-95 flex items-center uppercase tracking-widest border border-slate-200">
          <FaPlus className="mr-2 text-[8px]" /> Add Office
        </button>
      </div>

      {/* Table */}
      <section className="legacy-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-50 bg-slate-50/50">
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Office Name</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Identifier</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Approval Level</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4"><Skeleton variant="text" width="70%" /></td>
                    <td className="px-6 py-4"><Skeleton variant="text" width="40%" /></td>
                    <td className="px-6 py-4"><Skeleton height={20} width={80} className="rounded-full" /></td>
                    <td className="px-6 py-4"><Skeleton height={20} width={60} className="rounded-full" /></td>
                    <td className="px-6 py-4 text-right"><Skeleton variant="circle" width={24} height={24} className="ml-auto" /></td>
                  </tr>
                ))
              ) : offices.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-20 text-center"><p className="text-sm font-medium text-gray-500">No offices found.</p></td></tr>
              ) : offices.map((office) => (
                <tr key={office.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4 text-sm font-bold text-gray-900">{office.name}</td>
                  <td className="px-6 py-4 text-[11px] font-mono font-bold text-slate-400 uppercase tracking-tighter">{office.slug}</td>
                  <td className="px-6 py-4">
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded border ${office.level === 3 ? 'text-purple-600 border-purple-100 bg-purple-50' : 'text-blue-600 border-blue-100 bg-blue-50'}`}>
                      {office.level === 3 ? 'Executive' : 'Departmental'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded border ${office.is_active ? 'text-emerald-600 border-emerald-100 bg-emerald-50' : 'text-gray-500 border-gray-100 bg-gray-50'}`}>
                      {office.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => openModal(office)} className="text-slate-400 hover:text-dyci-blue transition-colors p-1.5" title="Edit"><FaEdit className="text-xs" /></button>
                    <button onClick={() => toggleStatus(office.id, office.is_active)} className="text-slate-400 hover:text-amber-600 transition-colors p-1.5 ml-1" title="Toggle Status">
                      {office.is_active ? <FaBan className="text-xs" /> : <FaCheck className="text-xs" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-sm font-bold text-slate-800">{editingId ? 'Edit Office' : 'Add New Office'}</h3>
              <button onClick={() => { setShowModal(false); setEditingId(null); }} className="text-slate-400 hover:text-slate-600"><FaTimes /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Office Name</label>
                <input type="text" required value={formData.name} onChange={handleNameChange}
                  className="w-full bg-white border border-slate-200 rounded-2xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-dyci-blue/5 focus:border-dyci-blue transition-all shadow-sm"
                  placeholder="e.g. Office of the Registrar" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Identifier (Slug)</label>
                <input type="text" required value={formData.slug}
                  onChange={(e) => setFormData({...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-2.5 px-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-dyci-blue/5 focus:border-dyci-blue transition-all shadow-sm"
                  placeholder="e.g. registrar" />
                <p className="text-[10px] text-gray-400 mt-1">Unique identifier. Lowercase letters, numbers, and underscores only.</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Approval Level</label>
                <select value={formData.level} onChange={(e) => setFormData({...formData, level: parseInt(e.target.value)})}
                  className="w-full bg-white border border-slate-200 rounded-2xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-dyci-blue/5 focus:border-dyci-blue transition-all shadow-sm">
                  <option value={2}>Departmental</option>
                  <option value={3}>Executive</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setEditingId(null); }} className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors uppercase tracking-widest">Cancel</button>
                <button type="submit" disabled={saving} className="bg-dyci-blue hover:bg-dyci-blue/90 text-white px-5 py-2 rounded-full text-xs font-bold shadow-sm disabled:opacity-50 transition-all uppercase tracking-widest active:scale-95">
                  {saving ? 'Saving...' : 'Save Office'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdministrativeManager;
