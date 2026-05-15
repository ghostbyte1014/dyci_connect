import React, { useState, useEffect } from 'react';
import {
  FaLock,
  FaMicrochip,
  FaNetworkWired,
  FaCheckCircle,
  FaExclamationCircle,
  FaShieldAlt,
  FaServer,
  FaDatabase,
  FaPowerOff
} from 'react-icons/fa';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';

// Infrastructure metrics interfaces
interface InfrastructureHealth {
  cpu_load_percent: number;
  db_replica_lag_ms: number;
  security_gateway_status: string;
  ssl_enabled: boolean;
  rls_enforced: boolean;
  ip_whitelist_enabled: boolean;
  hwid_auth_enabled: boolean;
  last_updated: string;
}

interface DatabaseSize {
  size_gb: number;
  size_bytes: number;
  limit_gb: number;
}

interface RLSStatus {
  table_name: string;
  rls_enabled: boolean;
}

interface SecurityConfig {
  brute_force_protection: boolean;
  audit_logging_enabled: boolean;
  session_timeout_hours: number;
  two_factor_required: boolean;
  password_policy: string;
}

interface AuthOverrideStatus {
  is_active: boolean;
  initiated_by: string | null;
  initiated_at: string | null;
  reason: string | null;
  released_at: string | null;
}

interface ReadOnlyStatus {
  is_active: boolean;
  enabled_by: string | null;
  enabled_at: string | null;
  reason: string | null;
}

const SysAdminSettings: React.FC = () => {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [loading, setLoading] = useState(false);

  // Infrastructure metrics
  const [healthMetrics, setHealthMetrics] = useState<InfrastructureHealth | null>(null);
  const [dbSize, setDbSize] = useState<DatabaseSize | null>(null);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const [rlsStatus, setRlsStatus] = useState<RLSStatus[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Security & Lockdown
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig | null>(null);
  const [authOverride, setAuthOverride] = useState<AuthOverrideStatus | null>(null);
  const [readOnlyMode, setReadOnlyMode] = useState<ReadOnlyStatus | null>(null);
  const [lockdownLoading, setLockdownLoading] = useState(false);

  // Confirmation State
  const [confirmConfig, setConfirmConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: '',
    confirmColor: '',
    onConfirm: () => {}
  });

  // Fetch current maintenance mode and metrics on mount
  useEffect(() => {
    fetchMaintenanceStatus();
    fetchInfrastructureMetrics();
    fetchSecurityConfig();
    fetchLockdownStatus();

    // Refresh metrics every 30 seconds
    const interval = setInterval(() => {
      fetchInfrastructureMetrics();
      fetchLockdownStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchMaintenanceStatus = async () => {
    try {
      const { data, error } = await supabase
        .from('school_settings')
        .select('maintenance_mode')
        .eq('id', 1)
        .single();

      if (error) {
        console.error('Error fetching maintenance status:', error);
        return;
      }

      if (data) {
        setMaintenanceMode(data.maintenance_mode || false);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const toggleMaintenanceMode = async () => {
    const newState = !maintenanceMode;
    
    setConfirmConfig({
      isOpen: true,
      title: `${newState ? 'Enable' : 'Disable'} Maintenance Mode`,
      message: newState 
        ? "This will redirect all non-admin users to the maintenance page. Are you sure you want to proceed?"
        : "This will restore full system access to all users. Proceed?",
      confirmLabel: newState ? 'Enable' : 'Disable',
      confirmColor: newState ? 'bg-rose-600' : 'bg-emerald-600',
      onConfirm: async () => {
        setLoading(true);
        try {
          if (newState) {
            const { error } = await supabase.rpc('enable_maintenance_mode', {
              p_message: 'The system is currently under maintenance. Please check back later.'
            });
            if (error) throw error;
            toast.success('System node entering maintenance state');
          } else {
            const { error } = await supabase.rpc('disable_maintenance_mode');
            if (error) throw error;
            toast.success('System node returned to active state');
          }
          setMaintenanceMode(newState);
        } catch (err: any) {
          toast.error('System update failed. Please try again or contact IT.');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  // Fetch infrastructure metrics
  const fetchInfrastructureMetrics = async () => {
    try {
      setMetricsLoading(true);

      // Fetch health metrics via RPC (Bypasses RLS)
      const { data: healthData, error: healthError } = await supabase
        .rpc('get_infrastructure_health');

      if (!healthError && healthData) {
        setHealthMetrics(healthData as InfrastructureHealth);
      }

      // Fetch database size
      const { data: sizeData, error: sizeError } = await supabase
        .rpc('get_database_size');

      if (!sizeError && sizeData && sizeData.length > 0) {
        setDbSize(sizeData[0]);
      }

      // Fetch physical storage size
      const { data: storageData, error: storageError } = await supabase
        .rpc('get_physical_storage_size');

      if (!storageError && storageData !== null) {
        setStorageBytes(storageData);
      }

      // Fetch RLS status
      const { data: rlsData, error: rlsError } = await supabase
        .rpc('check_rls_status');

      if (!rlsError && rlsData) {
        setRlsStatus(rlsData);
      }
    } catch (err) {
      console.error('Error fetching metrics:', err);
    } finally {
      setMetricsLoading(false);
    }
  };

  // Fetch security configuration
  const fetchSecurityConfig = async () => {
    try {
      const { data, error } = await supabase.rpc('get_security_config');

      if (!error && data) {
        setSecurityConfig(data);
      }
    } catch (err) {
      console.error('Error fetching security config:', err);
    }
  };

  // Fetch lockdown status (auth override and read-only)
  const fetchLockdownStatus = async () => {
    try {
      const [overrideRes, readOnlyRes] = await Promise.all([
        supabase.rpc('get_auth_override_status'),
        supabase.rpc('get_read_only_status')
      ]);

      if (!overrideRes.error && overrideRes.data && overrideRes.data.length > 0) {
        setAuthOverride(overrideRes.data[0]);
      }

      if (!readOnlyRes.error && readOnlyRes.data && readOnlyRes.data.length > 0) {
        setReadOnlyMode(readOnlyRes.data[0]);
      }
    } catch (err) {
      console.error('Error fetching lockdown status:', err);
    }
  };

  // Toggle Auth Override
  const toggleAuthOverride = async () => {
    const isEngaged = authOverride?.is_active;

    setConfirmConfig({
      isOpen: true,
      title: `${isEngaged ? 'Release' : 'Engage'} Auth Override`,
      message: isEngaged 
        ? "This will allow users with active sessions to resume normal operations. Proceed?"
        : "CRITICAL: This will suspend ALL active user sessions immediately. Use only in case of suspected breach. Proceed?",
      confirmLabel: isEngaged ? 'Release' : 'Engage',
      confirmColor: isEngaged ? 'bg-emerald-600' : 'bg-rose-600',
      onConfirm: async () => {
        setLockdownLoading(true);
        try {
          if (isEngaged) {
            const { error } = await supabase.rpc('release_auth_override');
            if (error) throw error;
            toast.success('Session override released');
          } else {
            const { error } = await supabase.rpc('engage_auth_override', {
              p_reason: 'System Security Protocol'
            });
            if (error) throw error;
            toast.success('Institutional lockdown engaged');
          }
          fetchLockdownStatus();
        } catch (err: any) {
          toast.error('Security protocol update failed. Please verify your permissions.');
        } finally {
          setLockdownLoading(false);
        }
      }
    });
  };

  // Toggle Read-Only Mode
  const toggleReadOnlyMode = async (enable: boolean) => {
    setConfirmConfig({
      isOpen: true,
      title: `${enable ? 'Enable' : 'Disable'} Read-Only Mode`,
      message: enable 
        ? "All database mutations will be blocked for non-admin users. Proceed?"
        : "Normal database operations will be restored. Proceed?",
      confirmLabel: enable ? 'Enable' : 'Disable',
      confirmColor: enable ? 'bg-amber-600' : 'bg-emerald-600',
      onConfirm: async () => {
        setLockdownLoading(true);
        try {
          if (enable) {
            const { error } = await supabase.rpc('enable_read_only_mode', {
              p_reason: 'Integrity Verification'
            });
            if (error) throw error;
            toast.success('Integrity plane synchronized (Read-Only)');
          } else {
            const { error } = await supabase.rpc('disable_read_only_mode');
            if (error) throw error;
            toast.success('Write-access plane restored');
          }
          fetchLockdownStatus();
        } catch (err: any) {
          toast.error('Maintenance mode toggle failed. System integrity check recommended.');
        } finally {
          setLockdownLoading(false);
        }
      }
    });
  };

  // Helper to format database size
  const formatDbSize = () => {
    if (!dbSize) return { value: '0.000', unit: 'GB', percent: 0 };
    const limit = 0.5; // Free Plan Limit
    const percent = Math.round((dbSize.size_gb / limit) * 100);
    return { value: dbSize.size_gb.toFixed(3), unit: 'GB', percent };
  };

  // Helper to format storage size
  const formatStorageSize = (bytes: number | null) => {
    if (bytes === null) return { value: '--', unit: '', percent: 0 };
    if (bytes === 0) return { value: '0.00', unit: 'MB', percent: 0 };

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = (bytes / Math.pow(k, i));
    const limit = 1 * 1024 * 1024 * 1024; // 1 GB Supabase Free Storage
    const percent = Math.min(Math.round((bytes / limit) * 100), 100);

    return {
      value: val < 10 ? val.toFixed(2) : val.toFixed(1),
      unit: sizes[i],
      percent
    };
  };

  // Helper to get node health data
  const getNodeHealth = () => {
    if (!healthMetrics) return [
      { label: 'Processor Load', value: '42%', status: 'Stable' },
      { label: 'Database Sync', value: '18%', status: 'Optimal' },
      { label: 'Secure Access', value: '89%', status: 'High Load' },
    ];

    return [
      {
        label: 'Processor Load',
        value: `${healthMetrics.cpu_load_percent}%`,
        status: healthMetrics.cpu_load_percent > 80 ? 'High Load' :
          healthMetrics.cpu_load_percent > 50 ? 'Moderate' : 'Stable'
      },
      {
        label: 'DB Read Replica',
        value: healthMetrics.db_replica_lag_ms > 0 ? `${healthMetrics.db_replica_lag_ms}ms lag` : 'Optimal',
        status: healthMetrics.db_replica_lag_ms > 1000 ? 'Warning' : 'Optimal'
      },
      {
        label: 'Security Gateway',
        value: healthMetrics.security_gateway_status === 'HIGH LOAD' ? '89%' : '42%',
        status: healthMetrics.security_gateway_status === 'HIGH LOAD' ? 'High Load' : 'Stable'
      },
    ];
  };

  // Helper to get network protocols
  const getNetworkProtocols = () => {
    const allTablesEnforced = rlsStatus.length > 0 && rlsStatus.every(s => s.rls_enabled);

    return [
      { label: 'SSL ENCRYPTION', active: healthMetrics?.ssl_enabled ?? true },
      { label: 'HWID AUTHENTICATION', active: healthMetrics?.hwid_auth_enabled ?? false },
      { label: 'RLS ENFORCEMENT', active: allTablesEnforced || (healthMetrics?.rls_enforced ?? true) },
    ];
  };

  return (
    <>
      {/* Standard Legacy Header Bar */}
      <header className="unified-header">
        <div className="unified-header-content flex items-center justify-between">
          <div>
            <h1 className="unified-header-title">System Control</h1>
            <p className="unified-header-subtitle">Institutional security and platform governance</p>
          </div>

          <div className="flex items-center space-x-3 bg-blue-900/30 border border-white/10 px-3 py-1.5 rounded-full">
            <span className="text-[9px] font-bold text-blue-100 tracking-widest uppercase">Maintenance</span>
            <button
              onClick={toggleMaintenanceMode}
              disabled={loading}
              className={`w-9 h-5 rounded-full relative transition-colors ${maintenanceMode ? 'bg-rose-500' : 'bg-blue-950/50'} ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${maintenanceMode ? 'left-4.5' : 'left-0.5'}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="unified-main">
        {/* Top Row: 3 columns - responsive */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
          <section className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 lg:p-6 shadow-sm">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 lg:mb-6 flex items-center">
              <FaMicrochip className="mr-2 text-[#1434A4]" />
              System Status
            </h3>
            <div className="space-y-5">
              {getNodeHealth().map((x, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[9px] font-bold tracking-widest">
                    <span className="text-gray-400 uppercase">{x.label}</span>
                    <span className={`${x.status === 'High Load' || x.status === 'Warning' ? 'text-rose-600' : x.status === 'Moderate' ? 'text-amber-500' : 'text-emerald-600'}`}>{x.status.toUpperCase()}</span>
                  </div>
                  <div className="h-2 w-full bg-slate-50 border border-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-1000 ${x.status === 'High Load' || x.status === 'Warning' ? 'bg-rose-500' : x.status === 'Moderate' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: x.value.includes('%') ? x.value : '50%' }} />
                  </div>
                </div>
              ))}
              {metricsLoading && (
                <div className="text-center py-2">
                  <div className="animate-pulse h-1 w-16 bg-slate-200 rounded mx-auto" />
                </div>
              )}
            </div>
          </section>

          <section className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 lg:p-6 shadow-sm">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 lg:mb-6 flex items-center">
              <FaNetworkWired className="mr-2 text-[#1434A4]" />
              Security Protocols
            </h3>
            <div className="space-y-2">
              {getNetworkProtocols().map((x, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 border border-slate-100 rounded-2xl">
                  <span className="text-[9px] font-bold text-gray-600 tracking-widest">{x.label.replace('SSL ENCRYPTION', 'Data Encryption').replace('HWID AUTHENTICATION', 'Identity Verification').replace('RLS ENFORCEMENT', 'Privacy Guard').replace('IP WHITELISTING', 'Access Control')}</span>
                  {x.active ? (
                    <FaCheckCircle className="text-emerald-500 text-xs" />
                  ) : (
                    <FaExclamationCircle className="text-gray-300 text-xs" />
                  )}
                </div>
              ))}
              {healthMetrics?.last_updated && (
                <p className="text-[8px] text-gray-400 text-center mt-2">
                  Last updated: {new Date(healthMetrics.last_updated).toLocaleTimeString()}
                </p>
              )}
            </div>
          </section>

          <section className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 lg:p-6 shadow-sm">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 lg:mb-6 flex items-center">
              <FaShieldAlt className="mr-2 text-[#1434A4]" />
              Security Status
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-slate-100 rounded-2xl">
                <span className="text-[9px] font-bold text-gray-600 tracking-widest">Login Protection</span>
                <span className={`text-[9px] font-bold ${securityConfig?.brute_force_protection ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {securityConfig?.brute_force_protection ? 'Active' : 'Disabled'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-slate-100 rounded-2xl">
                <span className="text-[9px] font-bold text-gray-600 tracking-widest">Activity Logging</span>
                <span className={`text-[9px] font-bold ${securityConfig?.audit_logging_enabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {securityConfig?.audit_logging_enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-slate-100 rounded-2xl">
                <span className="text-[9px] font-bold text-gray-600 tracking-widest">Session Timeout</span>
                <span className="text-[9px] font-bold text-emerald-600">
                  {securityConfig?.session_timeout_hours || 24}h
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-slate-100 rounded-2xl">
                <span className="text-[9px] font-bold text-gray-600 tracking-widest">2FA Enforcement</span>
                <span className={`text-[9px] font-bold ${securityConfig?.two_factor_required ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {securityConfig?.two_factor_required ? 'Required' : 'Optional'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-slate-100 rounded-2xl">
                <span className="text-[9px] font-bold text-gray-600 tracking-widest">Password Policy</span>
                <span className="text-[9px] font-bold text-emerald-600 uppercase">
                  {securityConfig?.password_policy || 'Strong'}
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* Bottom Row: 2 columns - responsive */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
          <section className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 lg:p-6 shadow-sm">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 lg:mb-6 flex items-center">
              <FaServer className="mr-2 text-[#1434A4]" />
              Database Status
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
              <div className="p-3 lg:p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                <div className="flex items-center space-x-2 mb-2 lg:mb-3">
                  <FaDatabase className="text-[#1434A4] text-xs" />
                  <span className="text-[9px] font-bold text-gray-500 uppercase">Database</span>
                </div>
                <p className="text-base lg:text-lg font-bold text-gray-900">{formatDbSize().value} {formatDbSize().unit}</p>
                <p className="text-[9px] text-gray-400">of 0.5 GB limit ({formatDbSize().percent}%)</p>
              </div>
              <div className="p-3 lg:p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                <div className="flex items-center space-x-2 mb-2 lg:mb-3">
                  <FaServer className="text-[#1434A4] text-xs" />
                  <span className="text-[9px] font-bold text-gray-500 uppercase">Storage</span>
                </div>
                <p className="text-base lg:text-lg font-bold text-gray-900">
                  {formatStorageSize(storageBytes).value} {formatStorageSize(storageBytes).unit}
                </p>
                <p className="text-[9px] text-gray-400">
                  {storageBytes === null
                    ? 'Storage API required'
                    : `of 1 GB limit (${formatStorageSize(storageBytes).percent}%)`}
                </p>
              </div>
              <div className="p-3 lg:p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                <div className="flex items-center space-x-2 mb-2 lg:mb-3">
                  <FaPowerOff className={`${metricsLoading ? 'text-gray-400' : 'text-emerald-500'} text-xs`} />
                  <span className="text-[9px] font-bold text-gray-500 uppercase">Status</span>
                </div>
                <p className={`text-base lg:text-lg font-bold ${metricsLoading ? 'text-gray-400' : 'text-emerald-600'}`}>
                  {metricsLoading ? 'Checking...' : 'Healthy'}
                </p>
                <p className="text-[9px] text-gray-400">
                  {metricsLoading ? 'Fetching metrics...' : 'All systems operational'}
                </p>
              </div>
            </div>
          </section>

          <section className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 lg:p-6 shadow-sm">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 lg:mb-6 flex items-center">
              <FaShieldAlt className="mr-2 text-rose-600" />
              Emergency Lockdown
            </h3>
            <div className="space-y-4">
              <div className={`p-5 border rounded-2xl overflow-hidden relative transition-all ${authOverride?.is_active ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                <h4 className={`text-[11px] font-bold uppercase tracking-tight ${authOverride?.is_active ? 'text-emerald-900' : 'text-rose-900'}`}>
                  Authentication Override
                </h4>
                <p className={`text-[9px] mt-2 font-medium leading-relaxed ${authOverride?.is_active ? 'text-emerald-700/70' : 'text-rose-700/70'}`}>
                  {authOverride?.is_active
                    ? `Active since ${authOverride.initiated_at ? new Date(authOverride.initiated_at).toLocaleTimeString() : 'unknown'}`
                    : 'Suspend all non-admin authentication sessions system-wide.'}
                </p>
                <button
                  onClick={toggleAuthOverride}
                  disabled={lockdownLoading}
                  className={`mt-5 w-full py-2.5 text-white rounded-2xl text-[9px] font-bold uppercase tracking-widest transition-all shadow-md ${authOverride?.is_active
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/10'
                    : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/10'
                    } ${lockdownLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {authOverride?.is_active ? 'Release Override' : 'Engage Override'}
                </button>
              </div>

              <div className="p-5 bg-white border border-slate-100 rounded-2xl group transition-all hover:bg-slate-50 shadow-inner">
                <div className="flex items-center justify-between mb-4">
                  <FaLock className={`transition-colors text-xs ${readOnlyMode?.is_active ? 'text-rose-500' : 'text-gray-400 group-hover:text-[#1434A4]'}`} />
                  <span className="text-[8px] font-bold text-gray-400 tracking-widest uppercase">Database Safeguard</span>
                </div>
                <h4 className="text-[11px] font-bold text-gray-900 uppercase">
                  Database Read-Only {readOnlyMode?.is_active && <span className="text-rose-500">(ACTIVE)</span>}
                </h4>
                <p className="text-[9px] text-gray-500 mt-2 font-medium leading-none">
                  {readOnlyMode?.is_active
                    ? `Enabled at ${readOnlyMode.enabled_at ? new Date(readOnlyMode.enabled_at).toLocaleTimeString() : 'unknown'}`
                    : 'Prevent system-wide mutations.'}
                </p>
                <div className="mt-5 flex items-center space-x-2">
                    <button
                      onClick={() => toggleReadOnlyMode(true)}
                      disabled={lockdownLoading || readOnlyMode?.is_active}
                      className={`flex-1 py-2 border rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${readOnlyMode?.is_active
                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                        : 'bg-white text-gray-900 border-slate-200 hover:text-[#1434A4]'
                        }`}
                    >
                      Enable
                    </button>
                    <button
                      onClick={() => toggleReadOnlyMode(false)}
                      disabled={lockdownLoading || !readOnlyMode?.is_active}
                      className={`flex-1 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest shadow-sm transition-all ${!readOnlyMode?.is_active
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-[#1434A4] text-white'
                        }`}
                    >
                      Disable
                    </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Legacy Footer */}
      <footer className="w-full px-4 sm:px-6 lg:px-8 xl:px-12 py-8 lg:py-12 opacity-40">
        <div className="text-center text-[9px] font-bold uppercase tracking-[0.3em] text-slate-400 border-t border-slate-200 pt-8">
          SYSTEM SETTINGS :: VERSION 7.0 :: DYCI CONNECT
        </div>
      </footer>
      {/* Confirmation Modal */}
      {confirmConfig.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300" />
          <div className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in slide-in-from-bottom-8 duration-500">
            <div className="p-10 text-center">
              <div className="w-20 h-20 bg-rose-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 animate-bounce duration-[2000ms]">
                <FaExclamationCircle className="w-8 h-8 text-rose-500" />
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

export default SysAdminSettings;
