import React, { useState, useEffect } from 'react';
import {
  FaUserPlus,
  FaSearch,
  FaFilter,
  FaClock,
  FaCircleNotch,
  FaTimes,
  FaUpload,
  FaExclamationTriangle,
  FaShieldAlt,
  FaEllipsisV,
  FaKey,
  FaUserTag,
  FaUserSlash,
  FaUserCheck,
  FaEye,
  FaQuestionCircle
} from 'react-icons/fa';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import { Skeleton } from '../../components/ui/Skeleton';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

interface LocalProfile {
  id: string;
  email: string;
  student_employee_id: string;
  first_name: string;
  last_name: string;
  role: string;
  verified: boolean;
  last_login: string | null;
  level: number;
  disabled_at: string | null;
}

const SysAdminUsers: React.FC = () => {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<LocalProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [provisionTab, setProvisionTab] = useState<'manual' | 'batch'>('manual');
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, success: 0, failed: 0 });
  const [showBatchConfirmModal, setShowBatchConfirmModal] = useState(false);
  const [batchRowsToProcess, setBatchRowsToProcess] = useState<any[]>([]);

  // Password Reset State
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetTarget, setResetTarget] = useState<LocalProfile | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetForm, setResetForm] = useState({
    useExcelPassword: false,
    useAutoGenerate: true,
    customPassword: '',
    requireChange: true,
  });
  const [generatedPreview, setGeneratedPreview] = useState('');

  // Action Menu State
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);
  const [viewingUser, setViewingUser] = useState<LocalProfile | null>(null);

  // Confirmation State
  const [confirmConfig, setConfirmConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: '',
    confirmColor: '',
    onConfirm: () => {}
  });

  // Manual Form State
  const [formData, setFormData] = useState({
    role: 'student' as 'student' | 'staff' | 'academic_admin' | 'system_admin',
    email: '',
    idNumber: '',
    firstName: '',
    middleName: '',
    lastName: '',
    nickname: '',
    // Student specific
    programId: '',
    departmentId: '',
    yearLevelId: '',
    sectionId: '',
    streetAddress: '',
    regionId: '',
    provinceId: '',
    cityId: '',
    barangayId: '',
    // Staff specific
    approverPosition: '',
    staffType: 'administrative',
    office: '',
    employmentStatus: 'regular'
  });

  // Auto-generated password preview
  const [generatedPassword, setGeneratedPassword] = useState('');

  // Metadata for dropdowns
  const [meta, setMeta] = useState<{
    departments: any[];
    programs: any[];
    yearLevels: any[];
    sections: any[];
    regions: any[];
    provinces: any[];
    cities: any[];
    barangays: any[];
  }>({
    departments: [],
    programs: [],
    yearLevels: [],
    sections: [],
    regions: [],
    provinces: [],
    cities: [],
    barangays: []
  });

  useEffect(() => {
    fetchUsers();
    fetchInitialMeta();
  }, []);

  // Auto-generate password when email and ID are entered
  useEffect(() => {
    if (formData.email && formData.idNumber) {
      generatePasswordPreview(formData.email, formData.idNumber);
    } else {
      setGeneratedPassword('');
    }
  }, [formData.email, formData.idNumber]);

  // Cascaded Metadata Loading
  useEffect(() => {
    if (formData.regionId) fetchProvinces(parseInt(formData.regionId));
    else setMeta(prev => ({ ...prev, provinces: [], cities: [], barangays: [] }));
  }, [formData.regionId]);

  useEffect(() => {
    if (formData.provinceId) fetchCities(parseInt(formData.provinceId));
    else setMeta(prev => ({ ...prev, cities: [], barangays: [] }));
  }, [formData.provinceId]);

  useEffect(() => {
    if (formData.cityId) fetchBarangays(parseInt(formData.cityId));
    else setMeta(prev => ({ ...prev, barangays: [] }));
  }, [formData.cityId]);

  useEffect(() => {
    if (formData.programId && formData.yearLevelId) {
      fetchSections(formData.programId, parseInt(formData.yearLevelId));
    } else {
      setMeta(prev => ({ ...prev, sections: [] }));
    }
  }, [formData.programId, formData.yearLevelId]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, student_employee_id, first_name, last_name, verified, last_login, disabled_at')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch user_roles separately
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (rolesError) throw rolesError;

      // Create role lookup map
      const roleMap = new Map(roles?.map(r => [r.user_id, r.role]) || []);

      const formatted = (profiles || []).map((p: any) => {
        const role = roleMap.get(p.id) || 'student';
        return {
          id: p.id,
          email: p.email,
          student_employee_id: p.student_employee_id || '-',
          first_name: p.first_name,
          last_name: p.last_name,
          role: role.toUpperCase(),
          verified: p.verified,
          last_login: p.last_login ? new Date(p.last_login).toLocaleDateString() : 'Never',
          level: role === 'system_admin' ? 90 : role === 'academic_admin' ? 80 : role === 'staff' ? 50 : 10,
          disabled_at: p.disabled_at
        };
      });
      setUsers(formatted);
    } catch (err: any) {
      console.error('Fetch users error:', err);
      toast.error('Failed to sync institutional registry. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const fetchInitialMeta = async () => {
    const [depts, progs, yls, regs] = await Promise.all([
      supabase.from('departments').select('id, name').order('name'),
      supabase.from('programs').select('id, name, department_id').order('name'),
      supabase.from('year_levels').select('id, label').order('sort_order'),
      supabase.from('regions').select('id, name').order('name')
    ]);
    setMeta(prev => ({
      ...prev,
      departments: depts.data || [],
      programs: progs.data || [],
      yearLevels: yls.data || [],
      regions: regs.data || []
    }));
  };

  const fetchProvinces = async (regionId: number) => {
    const { data } = await supabase.from('provinces').select('id, name').eq('region_id', regionId).order('name');
    setMeta(prev => ({ ...prev, provinces: data || [] }));
  };

  const fetchCities = async (provinceId: number) => {
    const { data } = await supabase.from('cities').select('id, name').eq('province_id', provinceId).order('name');
    setMeta(prev => ({ ...prev, cities: data || [] }));
  };

  const fetchBarangays = async (cityId: number) => {
    const { data } = await supabase.from('barangays').select('id, name').eq('city_id', cityId).order('name');
    setMeta(prev => ({ ...prev, barangays: data || [] }));
  };

  const fetchSections = async (programId: string, yearLevelId: number) => {
    const { data } = await supabase.from('sections').select('id, name').eq('program_id', programId).eq('year_level_id', yearLevelId).order('name');
    setMeta(prev => ({ ...prev, sections: data || [] }));
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate minimal requirements
    if (!formData.email || !formData.idNumber) {
      return toast.error('Email and ID Number are required for provisioning.');
    }

    // Validate generated password
    if (!generatedPassword) {
      return toast.error('Failed to generate password. Ensure Email & ID are provided.');
    }

    setIsProvisioning(true);

    try {
      const { error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          ...formData,
          password: generatedPassword,
          // Ensure optional fields are handled correctly
          firstName: formData.firstName || '',
          lastName: formData.lastName || '',
          middleName: formData.middleName || '',
          yearLevelId: formData.yearLevelId ? parseInt(formData.yearLevelId) : undefined,
          barangayId: formData.barangayId ? parseInt(formData.barangayId) : undefined,
        }
      });

      if (error) throw error;
      toast.success(`Identity Provisioned Successfully. Password: ${generatedPassword}`);
      setShowProvisionModal(false);
      setGeneratedPassword('');
      // Reset form
      setFormData({
        ...formData,
        email: '', idNumber: '', firstName: '', middleName: '', lastName: '', nickname: '',
        programId: '', departmentId: '', yearLevelId: '', sectionId: '',
        streetAddress: '', regionId: '', provinceId: '', cityId: '', barangayId: ''
      });
      fetchUsers();
    } catch (err: any) {
      toast.error('Provisioning sequence failed. Please check inputs and try again.');
    } finally {
      setIsProvisioning(false);
    }
  };

  const handleBatchFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => processBatch(results.data),
        error: () => toast.error('CSV Parsing Error')
      });
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        processBatch(data);
      };
      reader.readAsBinaryString(file);
    }
  };

  const normalizeKey = (key: string) => {
    const k = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (k === 'email') return 'email';
    if (k === 'studentid' || k === 'student_id' || k === 'idnumber' || k === 'id') return 'idNumber';
    if (k === 'firstname' || k === 'first' || k === 'first_name') return 'firstName';
    if (k === 'lastname' || k === 'last' || k === 'last_name') return 'lastName';
    if (k === 'password' || k === 'temppassword' || k === 'temp_password') return 'password';
    if (k === 'programid') return 'programId';
    if (k === 'departmentid') return 'departmentId';
    if (k === 'yearlevelid') return 'yearLevelId';
    if (k === 'sectionid') return 'sectionId';
    return key;
  };

  const processBatch = async (data: any[]) => {
    // 1. Normalize Headers
    console.log('Batch Raw Data:', data);
    const normalizedData = data.map(row => {
      const newRow: any = {};
      Object.keys(row).forEach(key => {
        const nKey = normalizeKey(key);
        newRow[nKey] = row[key];
      });
      return newRow;
    }).filter(row => row.email);

    console.log('Normalized Rows:', normalizedData);

    if (normalizedData.length === 0) {
      console.warn('Batch Warning: Zero valid rows after normalization.');
      return toast.error('No valid identities found (Check "Email" header)');
    }

    setBatchRowsToProcess(normalizedData);
    setShowBatchConfirmModal(true);
  };

  const executeBatchProvisioning = async () => {
    const data = batchRowsToProcess;
    setShowBatchConfirmModal(false);
    setIsProvisioning(true);
    setBatchProgress({ current: 0, total: data.length, success: 0, failed: 0 });
    let successCount = 0;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        console.log(`Provisioning row ${i + 1}/${data.length}:`, row.email);
        const { data: response, error } = await supabase.functions.invoke('admin-create-user', {
          body: {
            email: row.email,
            password: row.password || `${row.email.split('@')[0].substring(0,3)}${row.idNumber?.toString().slice(-4) || '2026'}@${new Date().getFullYear()}`,
            role: 'student',
            firstName: row.firstName || '',
            lastName: row.lastName || '',
            idNumber: row.idNumber,
            programId: row.programId,
            departmentId: row.departmentId,
            yearLevelId: row.yearLevelId ? parseInt(row.yearLevelId) : undefined,
            sectionId: row.sectionId
          }
        });

        if (error) {
          console.error(`Row ${i + 1} Invoke Error:`, error);
          let errorMessage = error.message;

          // Improved error parsing
          try {
            const ctx = (error as any).context;
            if (ctx && typeof ctx.json === 'function') {
              const errorData = await ctx.clone().json();
              if (errorData.error) errorMessage = errorData.error;
            }
          } catch (e) {
            console.warn('Failed to parse error context', e);
          }

          toast.error(`Error for ${row.email}: ${errorMessage}`);
          setBatchProgress(prev => ({ ...prev, failed: prev.failed + 1 }));
        } else {
          console.log(`Row ${i + 1} Success:`, response);
          successCount++;
          setBatchProgress(prev => ({ ...prev, success: prev.success + 1 }));
        }
      } catch (err: any) {
        console.error(`Row ${i + 1} Catch Error:`, err);
        toast.error(`Failed to process ${row.email}`);
      }
      setBatchProgress(prev => ({ ...prev, current: i + 1 }));
    }

    toast.success(`Batch Complete: ${successCount}/${data.length} identities provisioned.`);
    setIsProvisioning(false);
    setShowProvisionModal(false);
    setBatchProgress({ current: 0, total: 0, success: 0, failed: 0 });
    setBatchRowsToProcess([]);
    fetchUsers();
  };

  // Password Reset Functions
  const openResetModal = (user: LocalProfile) => {
    setResetTarget(user);
    setShowResetModal(true);
    setResetForm({
      useExcelPassword: false,
      useAutoGenerate: true,
      customPassword: '',
      requireChange: true,
    });
    // Generate preview
    generatePasswordPreview(user.email, user.student_employee_id);
  };

  const generatePasswordPreview = async (email: string, studentId: string) => {
    try {
      const { data, error } = await supabase.rpc('generate_temp_password', {
        p_email: email,
        p_student_employee_id: studentId,
      });
      if (!error && data) {
        setGeneratedPreview(data);
        setGeneratedPassword(data);
      }
    } catch (err) {
      console.error('Preview generation failed:', err);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;

    setResetLoading(true);
    try {
      let tempPassword = '';

      if (resetForm.useAutoGenerate) {
        // Use auto-generated password
        const { data, error } = await supabase.rpc('generate_temp_password', {
          p_email: resetTarget.email,
          p_student_employee_id: resetTarget.student_employee_id,
        });
        if (error) throw error;
        tempPassword = data;
      } else if (resetForm.customPassword) {
        // Use custom password
        tempPassword = resetForm.customPassword;
      } else {
        throw new Error('Please select a password option');
      }

      // Call admin API to update password
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        resetTarget.id,
        { password: tempPassword }
      );

      if (updateError) {
        // Fallback: Use edge function if admin API not available
        const { error: fnError } = await supabase.functions.invoke('admin-reset-password', {
          body: {
            userId: resetTarget.id,
            tempPassword,
            requireChange: resetForm.requireChange,
          }
        });
        if (fnError) throw fnError;
      }

      // Log the reset in our system
      await supabase.rpc('force_password_reset', {
        p_target_user_id: resetTarget.id,
        p_temp_password: tempPassword,
        p_require_change: resetForm.requireChange,
      });

      // Audit log
      await supabase.rpc('log_system_event', {
        p_action: 'PASSWORD_RESET',
        p_entity_type: 'USER',
        p_entity_id: resetTarget.id,
        p_metadata: { email: resetTarget.email, auto_gen: resetForm.useAutoGenerate }
      });

      toast.success(`Password reset for ${resetTarget.email}. Temp password: ${tempPassword}`);
      setShowResetModal(false);
      setResetTarget(null);
    } catch (err: any) {
      console.error('Password reset error:', err);
      toast.error('Failed to reset password. Please contact system administration.');
    } finally {
      setResetLoading(false);
    }
  };

  const toggleUserStatus = async (user: LocalProfile) => {
    const isCurrentlyDisabled = !!user.disabled_at;
    const actionLabel = isCurrentlyDisabled ? 'ACTIVATE' : 'DEACTIVATE';

    setConfirmConfig({
      isOpen: true,
      title: `${isCurrentlyDisabled ? 'Activate' : 'Deactivate'} User Account`,
      message: `Are you sure you want to ${isCurrentlyDisabled ? 'reactivate' : 'suspend'} access for ${user.first_name} ${user.last_name}?`,
      confirmLabel: isCurrentlyDisabled ? 'Activate' : 'Deactivate',
      confirmColor: isCurrentlyDisabled ? 'bg-emerald-600' : 'bg-rose-600',
      onConfirm: async () => {
        const newStatus = isCurrentlyDisabled ? null : new Date().toISOString();
        setIsUpdatingStatus(user.id);
        
        try {
          const { error } = await supabase
            .from('profiles')
            .update({ disabled_at: newStatus })
            .eq('id', user.id);

          if (error) throw error;

          // Manual log for audit
          await supabase.rpc('log_system_event', {
            p_action: actionLabel,
            p_entity_type: 'USER',
            p_entity_id: user.id,
            p_metadata: { email: user.email }
          });

          toast.success(`User ${isCurrentlyDisabled ? 'activated' : 'deactivated'} successfully`);
          fetchUsers();
        } catch (err: any) {
          toast.error('Failed to update user status. Please try again.');
        } finally {
          setIsUpdatingStatus(null);
        }
      }
    });
  };

  const filteredUsers = users.filter(u =>
    (u.first_name + ' ' + u.last_name).toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.student_employee_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      {/* Institutional Header */}
      <header className="unified-header">
        <div className="unified-header-content flex items-center justify-between">
          <div>
            <h1 className="unified-header-title">User Accounts</h1>
            <p className="unified-header-subtitle">Manage and provision system users and roles.</p>
          </div>

          <button
            onClick={() => setShowProvisionModal(true)}
            className="bg-white hover:bg-slate-100 text-dyci-blue text-[10px] font-bold px-4 py-2 rounded-full transition-all shadow-sm active:scale-95 flex items-center uppercase tracking-widest shrink-0 ml-4"
          >
            <FaUserPlus className="mr-2" />
            <span className="hidden sm:inline">Add New User</span>
            <span className="sm:hidden">Add User</span>
          </button>
        </div>
      </header>

      <main className="unified-main animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Telemetry */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-6">
          <div className="bg-white rounded-2xl border-y border-r border-y-slate-100 border-r-slate-100 border-l-[6px] border-l-slate-200 p-4 sm:p-5 lg:p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Users</p>
              <div className="relative group/tooltip inline-block">
                <FaQuestionCircle className="text-slate-300 hover:text-dyci-blue cursor-help text-[10px] transition-colors" />
                <div className="absolute bottom-full right-0 mb-2 hidden group-hover/tooltip:block z-50 w-48">
                  <div className="bg-blue-50 text-blue-900 border border-blue-100 text-[9px] p-2 rounded-lg shadow-xl font-medium leading-normal text-center whitespace-normal">
                    Total number of accounts registered in the system.
                  </div>
                  <div className="w-2 h-2 bg-blue-50 border-r border-b border-blue-100 rotate-45 ml-auto mr-1.5 -mt-1" />
                </div>
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-800 mt-2">{users.length}</p>
          </div>
          <div className="bg-white rounded-2xl border-y border-r border-y-slate-100 border-r-slate-100 border-l-[6px] border-l-emerald-500 p-4 sm:p-5 lg:p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Now</p>
              <div className="relative group/tooltip inline-block">
                <FaQuestionCircle className="text-slate-300 hover:text-dyci-blue cursor-help text-[10px] transition-colors" />
                <div className="absolute bottom-full right-0 mb-2 hidden group-hover/tooltip:block z-50 w-48">
                  <div className="bg-blue-50 text-blue-900 border border-blue-100 text-[9px] p-2 rounded-lg shadow-xl font-medium leading-normal text-center whitespace-normal">
                    Users who have successfully completed email verification.
                  </div>
                  <div className="w-2 h-2 bg-blue-50 border-r border-b border-blue-100 rotate-45 ml-auto mr-1.5 -mt-1" />
                </div>
              </div>
            </div>
            <p className="text-2xl font-bold text-emerald-600 mt-2">{users.filter(u => u.verified).length}</p>
          </div>
          <div className="bg-white rounded-2xl border-y border-r border-y-slate-100 border-r-slate-100 border-l-[6px] border-l-dyci-blue p-4 sm:p-5 lg:p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Admins</p>
              <div className="relative group/tooltip inline-block">
                <FaQuestionCircle className="text-slate-300 hover:text-dyci-blue cursor-help text-[10px] transition-colors" />
                <div className="absolute bottom-full right-0 mb-2 hidden group-hover/tooltip:block z-50 w-48">
                  <div className="bg-blue-50 text-blue-900 border border-blue-100 text-[9px] p-2 rounded-lg shadow-xl font-medium leading-normal text-center whitespace-normal">
                    Users with administrative privileges (System Admin or Academic Admin).
                  </div>
                  <div className="w-2 h-2 bg-blue-50 border-r border-b border-blue-100 rotate-45 ml-auto mr-1.5 -mt-1" />
                </div>
              </div>
            </div>
            <p className="text-2xl font-bold text-dyci-blue mt-2">{users.filter(u => u.level >= 80).length}</p>
          </div>
          <div className="bg-white rounded-2xl border-y border-r border-y-slate-100 border-r-slate-100 border-l-[6px] border-l-amber-500 p-4 sm:p-5 lg:p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Unverified Users</p>
              <div className="relative group/tooltip inline-block">
                <FaQuestionCircle className="text-slate-300 hover:text-dyci-blue cursor-help text-[10px] transition-colors" />
                <div className="absolute bottom-full right-0 mb-2 hidden group-hover/tooltip:block z-50 w-48">
                  <div className="bg-blue-50 text-blue-900 border border-blue-100 text-[9px] p-2 rounded-lg shadow-xl font-medium leading-normal text-center whitespace-normal">
                    Accounts that have been provisioned but have not yet verified their email.
                  </div>
                  <div className="w-2 h-2 bg-blue-50 border-r border-b border-blue-100 rotate-45 ml-auto mr-1.5 -mt-1" />
                </div>
              </div>
            </div>
            <p className="text-2xl font-bold text-amber-500 mt-2">{users.filter(u => !u.verified).length}</p>
          </div>
        </section>

        {/* Sync Controls */}
        <section className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-96">
            <FaSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
            <input
              type="text"
              placeholder="Search by ID, email, or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-2xl py-2.5 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#1434A4]/5 focus:border-[#1434A4] transition-all shadow-sm"
            />
          </div>
          <div className="flex items-center space-x-2 w-full md:w-auto text-xs">
            <button className="flex-1 md:flex-none flex items-center justify-center space-x-2 px-4 py-2.5 bg-white border border-slate-200 rounded-2xl font-bold text-gray-600 hover:bg-slate-50 transition-colors shadow-sm active:bg-slate-100">
              <FaFilter className="text-[10px]" />
              <span className="uppercase tracking-widest">Filter Roles</span>
            </button>
            <button
              onClick={() => fetchUsers()}
              disabled={loading}
              className="flex-1 md:flex-none flex items-center justify-center space-x-2 px-4 py-2.5 bg-white border border-slate-200 rounded-2xl font-bold text-gray-600 hover:bg-slate-50 transition-colors shadow-sm active:bg-slate-100"
            >
              <FaClock className={`text-[10px] ${loading ? 'animate-spin' : ''}`} />
              <span className="uppercase tracking-widest">Refresh Directory</span>
            </button>
          </div>
        </section>

        {/* Global Registry Table */}
        <section className="legacy-card overflow-hidden">
          <div className="overflow-x-auto min-h-[400px]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-50 bg-slate-50/50">
                  <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    <div className="flex items-center gap-1.5">
                      <span>User Details</span>
                      <div className="relative group/tooltip inline-block normal-case">
                        <FaQuestionCircle className="text-slate-300 hover:text-dyci-blue cursor-help text-[10px] transition-colors" />
                        <div className="absolute top-full left-0 mt-1.5 hidden group-hover/tooltip:block z-50 w-48">
                          <div className="w-1.5 h-1.5 bg-blue-50 border-l border-t border-blue-100 rotate-45 ml-2 -mb-1 relative z-10" />
                          <div className="bg-blue-50 text-blue-900 border border-blue-100 text-[9px] p-2 rounded-lg shadow-xl font-medium leading-normal text-left whitespace-normal relative z-0">
                            User's full name and registered email address.
                          </div>
                        </div>
                      </div>
                    </div>
                  </th>
                  <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    <div className="flex items-center gap-1.5">
                      <span>Identifier</span>
                      <div className="relative group/tooltip inline-block normal-case">
                        <FaQuestionCircle className="text-slate-300 hover:text-dyci-blue cursor-help text-[10px] transition-colors" />
                        <div className="absolute top-full left-0 mt-1.5 hidden group-hover/tooltip:block z-50 w-48">
                          <div className="w-1.5 h-1.5 bg-blue-50 border-l border-t border-blue-100 rotate-45 ml-2 -mb-1 relative z-10" />
                          <div className="bg-blue-50 text-blue-900 border border-blue-100 text-[9px] p-2 rounded-lg shadow-xl font-medium leading-normal text-left whitespace-normal relative z-0">
                            Unique ID assigned to the student or employee.
                          </div>
                        </div>
                      </div>
                    </div>
                  </th>
                  <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    <div className="flex items-center gap-1.5">
                      <span>Access Level</span>
                      <div className="relative group/tooltip inline-block normal-case">
                        <FaQuestionCircle className="text-slate-300 hover:text-dyci-blue cursor-help text-[10px] transition-colors" />
                        <div className="absolute top-full left-0 mt-1.5 hidden group-hover/tooltip:block z-50 w-48">
                          <div className="w-1.5 h-1.5 bg-blue-50 border-l border-t border-blue-100 rotate-45 ml-2 -mb-1 relative z-10" />
                          <div className="bg-blue-50 text-blue-900 border border-blue-100 text-[9px] p-2 rounded-lg shadow-xl font-medium leading-normal text-left whitespace-normal relative z-0">
                            Role category determining user access level and system privileges.
                          </div>
                        </div>
                      </div>
                    </div>
                  </th>
                  <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    <div className="flex items-center gap-1.5">
                      <span>State</span>
                      <div className="relative group/tooltip inline-block normal-case">
                        <FaQuestionCircle className="text-slate-300 hover:text-dyci-blue cursor-help text-[10px] transition-colors" />
                        <div className="absolute top-full left-0 mt-1.5 hidden group-hover/tooltip:block z-50 w-48">
                          <div className="w-1.5 h-1.5 bg-blue-50 border-l border-t border-blue-100 rotate-45 ml-2 -mb-1 relative z-10" />
                          <div className="bg-blue-50 text-blue-900 border border-blue-100 text-[9px] p-2 rounded-lg shadow-xl font-medium leading-normal text-left whitespace-normal relative z-0">
                            Indicates whether the account has been verified via email.
                          </div>
                        </div>
                      </div>
                    </div>
                  </th>
                  <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <Skeleton variant="circle" width={40} height={40} className="rounded-2xl" />
                          <div className="space-y-2">
                            <Skeleton variant="text" width={120} />
                            <Skeleton variant="text" width={180} height={12} />
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4"><Skeleton variant="text" width={80} /></td>
                      <td className="px-6 py-4"><Skeleton height={20} width={100} className="rounded-full" /></td>
                      <td className="px-6 py-4"><Skeleton height={20} width={80} className="rounded-full" /></td>
                      <td className="px-6 py-4 text-right"><Skeleton variant="circle" width={24} height={24} className="ml-auto" /></td>
                    </tr>
                  ))
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center">
                      <p className="text-sm font-medium text-gray-500">No user accounts found.</p>
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="h-10 w-10 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-400 shadow-inner uppercase">
                            {user.first_name?.[0] || '?'}{user.last_name?.[0] || '?'}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-900 leading-tight">
                              {user.first_name} {user.last_name}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-[11px] font-mono font-bold text-slate-500 uppercase tracking-tighter">
                        {user.student_employee_id}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded border ${user.role === 'SYSTEM_ADMIN' ? 'text-indigo-600 border-indigo-100 bg-indigo-50' :
                          user.role === 'ACADEMIC_ADMIN' ? 'text-blue-600 border-blue-100 bg-blue-50' :
                            user.role === 'STAFF' ? 'text-purple-600 border-purple-100 bg-purple-50' :
                              'text-gray-500 border-gray-100 bg-gray-50'
                          }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold ${user.verified ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                          }`}>
                          <div className={`h-1 w-1 rounded-full mr-2 ${user.verified ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                          {user.verified ? 'VERIFIED' : 'PENDING'}
                        </div>
                      </td>
                        <td className="px-6 py-4 text-right relative">
                          <div className="flex justify-end">
                            <div className="relative inline-block text-left">
                                  <button
                                    onClick={() => setActiveMenuId(activeMenuId === user.id ? null : user.id)}
                                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                                  >
                                    <FaEllipsisV className="w-3.5 h-3.5" />
                                  </button>

                              {activeMenuId === user.id && (
                                <>
                                  <div 
                                    className="fixed inset-0 z-10" 
                                    onClick={() => setActiveMenuId(null)} 
                                  />
                                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-slate-100 py-2 z-20 animate-in fade-in zoom-in duration-150">
                                    <div className="px-4 py-2 border-b border-slate-50 mb-1">
                                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Account Actions</p>
                                    </div>
                                    <button
                                      onClick={() => { openResetModal(user); setActiveMenuId(null); }}
                                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                      <FaKey className="w-3 h-3 text-slate-400" />
                                      Reset Password
                                    </button>
                                    <button
                                      onClick={() => { setViewingUser(user); setActiveMenuId(null); }}
                                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                      <FaEye className="w-3 h-3 text-slate-400" />
                                      View Profile
                                    </button>
                                    <div className="h-px bg-slate-50 my-1" />
                                    <button
                                      onClick={() => toggleUserStatus(user)}
                                      disabled={isUpdatingStatus === user.id}
                                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-[11px] font-bold transition-colors ${
                                        user.disabled_at 
                                          ? 'text-emerald-600 hover:bg-emerald-50' 
                                          : 'text-rose-600 hover:bg-rose-50'
                                      }`}
                                    >
                                      {isUpdatingStatus === user.id ? (
                                        <FaCircleNotch className="w-3 h-3 animate-spin" />
                                      ) : user.disabled_at ? (
                                        <FaUserCheck className="w-3 h-3" />
                                      ) : (
                                        <FaUserSlash className="w-3 h-3" />
                                      )}
                                      {user.disabled_at ? 'Activate Account' : 'Deactivate Account'}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Provisioning Modal (System Admin AUTHORITATIVE) */}
      {showProvisionModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <header className="bg-dyci-blue text-white p-6 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <FaUserPlus className="text-xl" />
                <div>
                  <h2 className="text-lg font-bold leading-none tracking-tight">Create New User</h2>
                  <p className="text-[10px] text-blue-50 uppercase tracking-widest font-bold opacity-80 mt-1">User Account Creation</p>
                </div>
              </div>
              <button onClick={() => !isProvisioning && setShowProvisionModal(false)} className="p-2 hover:bg-white/10 rounded-2xl transition-colors">
                <FaTimes />
              </button>
            </header>

            <nav className="flex border-b border-slate-100 bg-slate-50/50 px-6 pt-2">
              {['manual', 'batch'].map((tab: any) => (
                <button
                  key={tab}
                  onClick={() => setProvisionTab(tab)}
                  className={`px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all border-b-2 ${provisionTab === tab ? 'border-dyci-blue text-dyci-blue' : 'border-transparent text-gray-400'
                    }`}
                >
                  {tab === 'manual' ? 'Manual' : 'Batch Upload'}
                </button>
              ))}
            </nav>

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
              {provisionTab === 'manual' ? (
                <form onSubmit={handleManualSubmit} className="space-y-8 pb-4">

                  {/* Role & Core Identity */}
                  <section className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">User Role</label>
                        <select
                          value={formData.role}
                          onChange={(e) => setFormData({ ...formData, role: e.target.value as any, approverPosition: '' })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-bold focus:ring-1 focus:ring-[#1434A4] outline-none transition-all"
                        >
                          <option value="student">Student</option>
                          <option value="staff">Staff / Faculty</option>
                          <option value="academic_admin">Academic Administrator</option>
                          <option value="system_admin">System Administrator</option>
                        </select>
                      </div>
                      {formData.role === 'staff' && (
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[#1434A4] uppercase tracking-widest ml-1">System Access Level</label>
                          <select
                            value={formData.approverPosition}
                            onChange={(e) => setFormData({ ...formData, approverPosition: e.target.value })}
                            className="w-full bg-blue-50 border border-blue-200 rounded-2xl px-4 py-2.5 text-sm font-bold text-blue-900 outline-none"
                          >
                            <option value="">No Approval Role</option>
                            <optgroup label="Departmental Approval">
                              <option value="scholarship">Scholarship Dept</option>
                              <option value="finance">Finance Dept</option>
                              <option value="registrar">Office of the Registrar</option>
                              <option value="guidance">Guidance & Counseling</option>
                              <option value="property_security">Property & Security</option>
                              <option value="academic_council">Academic Council</option>
                            </optgroup>
                            <optgroup label="Executive Approval">
                              <option value="vice_president">Vice President</option>
                              <option value="president">Office of the President</option>
                            </optgroup>
                          </select>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* NAMES */}
                  <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">First name (Optional)</label>
                      <input type="text" placeholder="John Christian" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-bold outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Middle name</label>
                      <input type="text" placeholder="Santos" value={formData.middleName} onChange={e => setFormData({ ...formData, middleName: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Last name (Optional)</label>
                      <input type="text" placeholder="Gabriel" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-bold outline-none" />
                    </div>
                  </section>

                  {/* IDENTIFIER & NICKNAME */}
                  <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">{formData.role === 'student' ? 'Student ID' : 'Employee ID'}</label>
                      <input required type="text" placeholder="e.g. 2022-23514" value={formData.idNumber} onChange={e => setFormData({ ...formData, idNumber: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-bold outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Nickname</label>
                      <input type="text" placeholder="e.g. SU" value={formData.nickname} onChange={e => setFormData({ ...formData, nickname: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm outline-none" />
                    </div>
                  </section>

                  {/* ACADEMIC (STUDENT) */}
                  {formData.role === 'student' && (
                    <section className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Department</label>
                          <select value={formData.departmentId} onChange={e => setFormData({ ...formData, departmentId: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2 text-sm outline-none">
                            <option value="">Select Dept</option>
                            {meta.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Program</label>
                          <select value={formData.programId} onChange={e => setFormData({ ...formData, programId: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2 text-sm outline-none">
                            <option value="">Select Program</option>
                            {meta.programs.filter(p => p.department_id === formData.departmentId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Year Level</label>
                          <select value={formData.yearLevelId} onChange={e => setFormData({ ...formData, yearLevelId: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2 text-sm outline-none">
                            <option value="">Select Year</option>
                            {meta.yearLevels.map(y => <option key={y.id} value={y.id}>{y.label}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Section</label>
                          <select value={formData.sectionId} onChange={e => setFormData({ ...formData, sectionId: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2 text-sm outline-none">
                            <option value="">Select Section</option>
                            {meta.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* ADDRESS (STUDENT) */}
                  {formData.role === 'student' && (
                    <section className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Address</label>
                        <textarea rows={2} placeholder="Building, Street Name, Floor" value={formData.streetAddress} onChange={e => setFormData({ ...formData, streetAddress: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2 text-sm outline-none resize-none" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Region</label>
                          <select value={formData.regionId} onChange={e => setFormData({ ...formData, regionId: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-3 py-2 text-xs outline-none">
                            <option value="">Select region</option>
                            {meta.regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Province</label>
                          <select value={formData.provinceId} onChange={e => setFormData({ ...formData, provinceId: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-3 py-2 text-xs outline-none disabled:opacity-50" disabled={!formData.regionId}>
                            <option value="">Select province</option>
                            {meta.provinces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">City / Municipality</label>
                          <select value={formData.cityId} onChange={e => setFormData({ ...formData, cityId: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-3 py-2 text-xs outline-none disabled:opacity-50" disabled={!formData.provinceId}>
                            <option value="">Select city</option>
                            {meta.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Barangay</label>
                          <select value={formData.barangayId} onChange={e => setFormData({ ...formData, barangayId: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-3 py-2 text-xs outline-none disabled:opacity-50" disabled={!formData.cityId}>
                            <option value="">Select barangay</option>
                            {meta.barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* AUTH (Common) */}
                  <section className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex flex-col md:flex-row items-center gap-4">
                    <div className="flex-1 w-full space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Account Email</label>
                      <input required type="email" placeholder="user@dyci.edu" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-bold outline-none" />
                    </div>
                    <div className="flex-1 w-full space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Auto-Generated Password</label>
                      <div className="w-full bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-dashed border-blue-200 rounded-2xl px-4 py-2.5 text-sm font-mono font-bold text-blue-700 flex items-center justify-center">
                        {generatedPassword || 'Enter email & ID to generate'}
                      </div>
                      <p className="text-[9px] text-gray-500 mt-1">Pattern: first 3 chars of email + last 4 ID digits + @ + year</p>
                    </div>
                  </section>

                  <footer className="pt-4 flex items-center justify-end space-x-3 border-t border-slate-50 sticky bottom-0 bg-white py-2">
                    <button type="button" onClick={() => setShowProvisionModal(false)} className="px-6 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-widest hover:text-gray-600 transition-colors">Cancel</button>
                    <button disabled={isProvisioning} type="submit" className="bg-[#1434A4] hover:bg-[#102a82] text-white text-xs font-bold px-8 py-3 rounded-2xl transition-all shadow-lg active:scale-95 flex items-center">
                      {isProvisioning ? <FaCircleNotch className="animate-spin mr-2" /> : <FaUserPlus className="mr-2" />}
                      CREATE USER ACCOUNT
                    </button>
                  </footer>
                </form>
              ) : (
                isProvisioning ? (
                  <div className="py-20 flex flex-col items-center justify-center space-y-6">
                    <div className="relative h-24 w-24">
                      <svg className="h-full w-full transform -rotate-90">
                        <circle
                          cx="48" cy="48" r="40"
                          stroke="currentColor" strokeWidth="8" fill="transparent"
                          className="text-slate-100"
                        />
                        <circle
                          cx="48" cy="48" r="40"
                          stroke="currentColor" strokeWidth="8" fill="transparent"
                          strokeDasharray={251.2}
                          strokeDashoffset={251.2 - (251.2 * (batchProgress.current || 0)) / (batchProgress.total || 1)}
                          className="text-dyci-blue transition-all duration-500 ease-out"
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-dyci-blue">
                        {Math.round(((batchProgress.current || 0) / (batchProgress.total || 1)) * 100)}%
                      </div>
                    </div>
                    <div className="text-center">
                      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest">Setting up accounts...</h3>
                      <p className="text-[10px] text-slate-400 mt-1 font-bold">Processed {batchProgress.current} of {batchProgress.total} students</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="max-w-xs mx-auto">
                      <h3 className="text-base font-bold text-slate-800 uppercase tracking-tight">Bulk Account Creation</h3>
                      <p className="text-xs text-slate-500 mt-2 leading-relaxed font-medium">
                        Upload a standard **CSV** or **Excel** file to create multiple accounts simultaneously.
                      </p>
                    </div>

                    <div className="flex flex-col items-center space-y-4">
                      <input type="file" id="batchFile" accept=".csv, .xlsx, .xls" onChange={handleBatchFile} className="hidden" />
                      <label htmlFor="batchFile" className="bg-white border-2 border-dashed border-slate-200 hover:border-[#1434A4] rounded-2xl p-12 cursor-pointer group transition-all w-full max-w-sm flex flex-col items-center">
                        <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest transition-all group-hover:tracking-[0.2em]">Select Excel/CSV File</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => {
                          const data = [
                            ["email", "student_id", "temp_password"],
                            ["sample@dyci.edu.ph", "2024-00001", "P@ssword123"]
                          ];
                          const ws = XLSX.utils.aoa_to_sheet(data);
                          const wb = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
                          XLSX.writeFile(wb, "DYCI_Student_Batch_Template.xlsx");
                        }}
                        className="text-[10px] font-bold text-slate-400 hover:text-dyci-blue transition-colors uppercase tracking-widest flex items-center"
                      >
                        Download Excel Template
                      </button>
                    </div>

                    <div className="bg-amber-50 rounded-2xl p-5 border border-amber-100 flex items-start space-x-4 text-left max-w-md mx-auto shadow-sm">
                      <FaExclamationTriangle className="text-amber-500 mt-1 text-sm flex-shrink-0" />
                      <p className="text-[10px] text-amber-800 font-bold uppercase tracking-widest leading-relaxed">
                        Notice: Ensure your file includes headers for email, student_id, and name.
                      </p>
                    </div>
                  </>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Batch Confirmation Modal */}
      {showBatchConfirmModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md px-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="bg-gradient-to-r from-[#1434A4] to-[#1e4ad4] px-8 py-6 text-white">
              <div className="flex items-center space-x-4">
                <div className="h-12 w-12 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                  <FaShieldAlt className="text-2xl" />
                </div>
                <div>
                  <h3 className="text-lg font-bold uppercase tracking-widest leading-none">Review Bulk Upload</h3>
                  <p className="text-blue-100 text-[10px] mt-1.5 font-bold uppercase tracking-widest opacity-80">Administrative Review</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-8">
              <div className="bg-blue-50/50 rounded-2xl p-6 border border-blue-100 flex items-center justify-between mb-6">
                <div>
                  <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Total Accounts Detected</p>
                  <p className="text-2xl font-bold text-[#1434A4] mt-1">{batchRowsToProcess.length} Students</p>
                </div>
                <div className="h-12 w-px bg-blue-100" />
                <div className="text-right">
                  <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Target Role</p>
                  <p className="text-sm font-bold text-slate-700 mt-1 uppercase">STUDENT ACCOUNT</p>
                </div>
              </div>

              <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Directory Preview (Top 5)</p>
                {batchRowsToProcess.slice(0, 5).map((row, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-blue-200 transition-colors">
                    <div className="flex items-center space-x-3">
                      <div className="h-8 w-8 bg-white rounded-lg flex items-center justify-center text-[10px] font-bold text-slate-400 border border-slate-200 shadow-sm uppercase">
                        {row.firstName?.[0] || '?'}{row.lastName?.[0] || '?'}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800">{row.firstName} {row.lastName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{row.email}</p>
                      </div>
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 font-mono">{row.idNumber}</p>
                  </div>
                ))}
                {batchRowsToProcess.length > 5 && (
                  <p className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-2">
                    + {batchRowsToProcess.length - 5} more accounts in queue
                  </p>
                )}
              </div>

              <div className="mt-8 flex items-center justify-end space-x-4">
                <button
                  onClick={() => setShowBatchConfirmModal(false)}
                  className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest hover:text-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={executeBatchProvisioning}
                  className="bg-[#1434A4] hover:bg-[#102a82] text-white text-xs font-bold px-8 py-3.5 rounded-2xl transition-all shadow-lg shadow-blue-500/20 flex items-center uppercase tracking-widest active:scale-95"
                >
                  <FaUserPlus className="mr-2" />
                  Confirm & Create Accounts
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {showResetModal && resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="bg-gradient-to-r from-rose-500 to-rose-600 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-bold text-sm uppercase tracking-widest">Force Password Reset</h3>
                  <p className="text-rose-100 text-[10px] mt-0.5">Administrative Override</p>
                </div>
                <button
                  onClick={() => setShowResetModal(false)}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <FaTimes className="text-white text-sm" />
                </button>
              </div>
            </div>

            {/* Content */}
            <form onSubmit={handlePasswordReset} className="p-6 space-y-4">
              {/* Target User Info */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Target Account</p>
                <p className="text-sm font-bold text-slate-800">{resetTarget.first_name} {resetTarget.last_name}</p>
                <p className="text-[11px] text-slate-500">{resetTarget.email}</p>
                <p className="text-[10px] font-mono text-slate-400 mt-1">{resetTarget.student_employee_id}</p>
              </div>

              {/* Password Options */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Password Method</p>

                {/* Auto-generate option */}
                <label className={`flex items-start p-3 rounded-2xl border-2 cursor-pointer transition-all ${resetForm.useAutoGenerate ? 'border-rose-500 bg-rose-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input
                    type="radio"
                    name="passwordMethod"
                    checked={resetForm.useAutoGenerate}
                    onChange={() => setResetForm({ ...resetForm, useAutoGenerate: true, customPassword: '' })}
                    className="mt-0.5 mr-3 text-rose-500"
                  />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-slate-700">Auto-Generate Standard Password</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Pattern: first 3 chars of email + last 4 ID digits + @ + year</p>
                    {generatedPreview && (
                      <p className="text-xs font-mono text-rose-600 mt-2 bg-white px-2 py-1 rounded border border-rose-200">
                        Preview: {generatedPreview}
                      </p>
                    )}
                  </div>
                </label>

                {/* Custom password option */}
                <label className={`flex items-start p-3 rounded-2xl border-2 cursor-pointer transition-all ${!resetForm.useAutoGenerate && resetForm.customPassword ? 'border-rose-500 bg-rose-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input
                    type="radio"
                    name="passwordMethod"
                    checked={!resetForm.useAutoGenerate}
                    onChange={() => setResetForm({ ...resetForm, useAutoGenerate: false })}
                    className="mt-0.5 mr-3 text-rose-500"
                  />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-slate-700">Custom Password</p>
                    <input
                      type="text"
                      value={resetForm.customPassword}
                      onChange={(e) => setResetForm({ ...resetForm, useAutoGenerate: false, customPassword: e.target.value })}
                      placeholder="Enter temporary password"
                      className="mt-2 w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-rose-500 focus:outline-none"
                    />
                  </div>
                </label>
              </div>

              {/* Options */}
              <div className="pt-2">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resetForm.requireChange}
                    onChange={(e) => setResetForm({ ...resetForm, requireChange: e.target.checked })}
                    className="w-4 h-4 text-rose-500 rounded border-slate-300 focus:ring-rose-500"
                  />
                  <span className="text-xs text-slate-700">Require password change on first login</span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowResetModal(false)} className="px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-widest hover:text-slate-700 transition-colors">Cancel</button>
                <button
                  type="submit"
                  disabled={resetLoading || (!resetForm.useAutoGenerate && !resetForm.customPassword)}
                  className="bg-rose-500 hover:bg-rose-600 disabled:bg-slate-300 text-white text-xs font-bold px-6 py-2.5 rounded-2xl transition-all shadow-lg shadow-rose-500/20 flex items-center"
                >
                  {resetLoading ? (
                    <><FaCircleNotch className="animate-spin mr-2" /> Resetting...</>
                  ) : (
                    <><FaUserPlus className="mr-2" /> Force Reset</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <footer className="max-w-6xl mx-auto px-6 py-10 opacity-40">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400 border-t border-slate-200 pt-6">
          <span>System Status: Secure</span>
          <span>DYCI CONNECT v7.0</span>
        </div>
      </footer>
      {/* User Profile Detail Modal */}
      {viewingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setViewingUser(null)} />
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between px-8 py-6 border-b border-slate-50 bg-slate-50/30">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-2xl bg-white border border-slate-100 shadow-sm flex items-center justify-center text-lg font-black text-slate-300">
                  {viewingUser.first_name[0]}{viewingUser.last_name[0]}
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 leading-none">{viewingUser.first_name} {viewingUser.last_name}</h3>
                  <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-widest">{viewingUser.role}</p>
                </div>
              </div>
              <button onClick={() => setViewingUser(null)} className="p-2 text-slate-300 hover:text-slate-600 transition-colors">
                <FaTimes className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8">
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Institutional Email</label>
                    <p className="text-sm font-bold text-slate-800">{viewingUser.email}</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">ID Number</label>
                    <p className="text-sm font-mono font-bold text-slate-800">{viewingUser.student_employee_id}</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Account Status</label>
                    <div className="flex items-center gap-2 mt-1">
                      <div className={`h-2 w-2 rounded-full ${viewingUser.disabled_at ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                      <span className={`text-[10px] font-black uppercase ${viewingUser.disabled_at ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {viewingUser.disabled_at ? 'Suspended' : 'Active'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Last Activity</label>
                    <p className="text-sm font-bold text-slate-800">{viewingUser.last_login}</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Security Level</label>
                    <p className="text-sm font-bold text-slate-800">Level {viewingUser.level}</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Verification</label>
                    <p className={`text-[10px] font-black uppercase ${viewingUser.verified ? 'text-blue-600' : 'text-amber-600'}`}>
                      {viewingUser.verified ? 'Institutional Verified' : 'Pending Verification'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-10 pt-6 border-t border-slate-50 flex gap-3">
                <button 
                  onClick={() => { openResetModal(viewingUser); setViewingUser(null); }}
                  className="flex-1 py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
                >
                  Force Password Reset
                </button>
                <button 
                  onClick={() => { toggleUserStatus(viewingUser); setViewingUser(null); }}
                  className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    viewingUser.disabled_at 
                      ? 'bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-100' 
                      : 'bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100'
                  }`}
                >
                  {viewingUser.disabled_at ? 'Reactivate Access' : 'Suspend Access'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmConfig.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300" />
          <div className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in slide-in-from-bottom-8 duration-500">
            <div className="p-10 text-center">
              <div className="w-20 h-20 bg-rose-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 animate-bounce duration-[2000ms]">
                <FaExclamationTriangle className="w-8 h-8 text-rose-500" />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-4">{confirmConfig.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-10 font-medium">
                {confirmConfig.message}
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    confirmConfig.onConfirm();
                    setConfirmConfig({ ...confirmConfig, isOpen: false });
                  }}
                  className={`w-full py-4 ${confirmConfig.confirmColor} text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg hover:brightness-110 active:scale-[0.98] transition-all`}
                >
                  {confirmConfig.confirmLabel}
                </button>
                <button
                  onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })}
                  className="w-full py-4 bg-slate-50 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-100 transition-all"
                >
                  Cancel Operation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SysAdminUsers;
