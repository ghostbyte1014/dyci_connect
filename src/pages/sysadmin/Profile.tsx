import React, { useState, useEffect } from 'react';
import {
  FaFingerprint,
  FaUserCircle,
  FaEye,
  FaEyeSlash,
  FaLaptopCode,
  FaTrash
} from 'react-icons/fa';
import { DashboardSkeleton } from '../../components/ui/Skeleton';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import PasswordStrengthIndicator from '../../components/auth/PasswordStrengthIndicator';

const SysAdminProfile: React.FC = () => {
  const { user, updatePassword } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    nickname: '',
    employeeId: ''
  });

  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordValid, setPasswordValid] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  useEffect(() => {
    if (user) {
      fetchProfile();
      fetchDevices();
    }
  }, [user]);

  const fetchDevices = async () => {
    try {
      const { data, error } = await supabase
        .from('trusted_devices')
        .select('*')
        .eq('user_id', user?.id)
        .order('is_active', { ascending: false })
        .order('last_used_at', { ascending: false });
      if (error) throw error;
      setDevices(data || []);
    } catch (err) {
      console.error('Failed to fetch trusted devices', err);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    try {
      const { error } = await supabase
        .from('trusted_devices')
        .update({ is_active: false })
        .eq('id', deviceId);
      
      if (error) throw error;
      toast.success('Device revoked successfully');
      fetchDevices();
    } catch (err) {
      toast.error('Failed to revoke device');
    }
  };

  const handleRestoreDevice = async (deviceId: string) => {
    try {
      const { error } = await supabase
        .from('trusted_devices')
        .update({ is_active: true })
        .eq('id', deviceId);
      
      if (error) throw error;
      toast.success('Device restored successfully');
      fetchDevices();
    } catch (err) {
      toast.error('Failed to restore device');
    }
  };

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id, email, student_employee_id, first_name, last_name, verified, last_login,
          role, nickname, avatar_url
        `)
        .eq('id', user?.id)
        .single();

      if (error) throw error;
      setProfile(data);
      setEditForm({
        firstName: data.first_name || '',
        lastName: data.last_name || '',
        nickname: data.nickname || '',
        employeeId: data.student_employee_id || ''
      });
    } catch (err) {
      toast.error('Failed to sync profile node');
    } finally {
      setLoading(false);
    }
  };

  // Logic Handlers
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: editForm.firstName,
          last_name: editForm.lastName,
          nickname: editForm.nickname,
          student_employee_id: editForm.employeeId,
          updated_at: new Date().toISOString()
        })
        .eq('id', user?.id);

      if (error) throw error;
      toast.success('Identity updated locally');
      fetchProfile();
      setEditOpen(false);
    } catch (err) {
      toast.error('Sync failed');
    } finally {
      setEditSaving(false);
    }
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleAvatarSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!avatarFile || !user?.id) return;
    setAvatarSaving(true);
    try {
      const fileExt = avatarFile.name.split('.').pop() || 'jpg';
      const filePath = `avatars/${user.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await (supabase as any).storage
        .from('user-docs')
        .upload(filePath, avatarFile, {
          upsert: true,
          contentType: avatarFile.type || undefined,
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = (supabase as any).storage
        .from('user-docs')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      toast.success('Visual identity synchronized');
      fetchProfile();
      setAvatarOpen(false);
    } catch (err) {
      toast.error('Media pool sync failed');
    } finally {
      setAvatarSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      return toast.error('New passwords do not match');
    }

    if (!passwordValid) {
      return toast.error('Password does not meet institutional security standards');
    }

    setPasswordSaving(true);
    try {
      // Use updatePassword from useAuth which handles current password verification
      const { error } = await updatePassword(passwordForm.currentPassword, passwordForm.newPassword);

      if (error) throw error;

      // Log password change to audit
      await supabase.rpc('log_password_change');

      toast.success('Password updated successfully');
      setPasswordOpen(false);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      console.error('Password change error:', err);
      toast.error(err.message || 'Failed to update password');
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <FaFingerprint className="animate-pulse text-4xl text-[#1434A4] mx-auto mb-4" />
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Synchronizing Identity Plane...</p>
        </div>
      </div>
    );
  }

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans tracking-tight">
      <header className="unified-header">
        <div className="unified-header-content">
          <h1 className="unified-header-title">My Profile</h1>
          <p className="unified-header-subtitle">
            This is your DYCI Connect digital ID and account information.
          </p>
        </div>
      </header>

      <main className="unified-main animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex justify-end space-x-3 mb-6">
          <span className="px-3 py-1 bg-red-50 text-dyci-red border border-red-100 rounded-lg text-[10px] font-bold uppercase tracking-widest">
            Admin
          </span>
          <span className="px-3 py-1 bg-emerald-50 text-dyci-green border border-emerald-100 rounded-lg text-[10px] font-bold uppercase tracking-widest">
            Verified
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-stretch">

          {/* Main profile Card */}
          <section className="h-full">
            <div className="legacy-card p-6 sm:p-8 lg:p-10 flex flex-col justify-between h-full">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-800 overflow-hidden">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    <FaUserCircle className="text-5xl text-slate-300" />
                  )}
                </div>

                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {profile?.first_name} {profile?.last_name}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {profile?.email}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-600 mt-2">
                <div>
                  <p className="font-medium text-slate-500">Employee ID</p>
                  <p className="mt-0.5 text-slate-800">
                    {profile?.student_employee_id || '2019-22587'}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-slate-500">Nickname</p>
                  <p className="mt-0.5 text-slate-800">
                    {profile?.nickname || 'Acad'}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="font-medium text-slate-500">Joined</p>
                  <p className="mt-0.5 text-slate-800">
                    {profile?.last_login ? new Date(profile.last_login).toLocaleDateString() : '4/15/2026'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Action Card */}
          <section className="h-full">
            <div className="legacy-card p-8 h-full">
              <h3 className="text-sm font-bold text-slate-800 mb-6 font-sans">Account actions</h3>
              <div className="space-y-3">
                <button
                  onClick={() => setEditOpen(true)}
                  className="legacy-button-pill shadow-sm"
                >
                  Edit profile
                </button>
                <button
                  onClick={() => setAvatarOpen(true)}
                  className="legacy-button-pill shadow-sm"
                >
                  Change profile picture
                </button>
                <button
                  onClick={() => setPasswordOpen(true)}
                  className="legacy-button-pill shadow-sm"
                >
                  Change password
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Security & Trusted Devices Section */}
        <section className="mt-6 lg:mt-8">
          <div className="legacy-card p-6 sm:p-8">
            <h3 className="text-sm font-bold text-slate-800 mb-2 font-sans flex items-center">
              <FaFingerprint className="mr-2 text-blue-600" /> Security & Trusted Devices
            </h3>
            <p className="text-xs text-slate-500 mb-6">
              Manage the devices that have access to your account without needing an email verification code.
            </p>
            
            {devices.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400">
                No trusted devices found.
              </div>
            ) : (
              <div className="space-y-3">
                {devices.map((device) => (
                  <div key={device.id} className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                    <div className="flex items-center space-x-4">
                      <div className={`p-3 rounded-full ${device.is_active ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                        <FaLaptopCode className="h-4 w-4" />
                      </div>
                      <div>
                        <p className={`text-xs font-semibold ${device.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                          {device.device_name || 'Unknown Device'}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Last used: {new Date(device.last_used_at).toLocaleDateString()} {new Date(device.last_used_at).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    {device.is_active ? (
                      <button
                        onClick={() => handleRevokeDevice(device.id)}
                        className="text-xs text-red-600 hover:text-red-700 font-medium px-3 py-1.5 bg-red-50 hover:bg-red-100 rounded-lg transition-colors flex items-center"
                      >
                        <FaTrash className="mr-1.5 h-3 w-3" /> Revoke
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRestoreDevice(device.id)}
                        className="text-xs text-emerald-600 hover:text-emerald-700 font-medium px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors flex items-center"
                      >
                        Undo / Restore
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Edit profile modal */}
        {editOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl p-6 space-y-4 text-[11px]">
              <h2 className="text-sm font-semibold text-slate-900">Edit profile</h2>
              <p className="text-slate-500">
                Update your basic information. These details are visible to administrators and may be
                used for verification.
              </p>
              <form className="space-y-3" onSubmit={handleEditSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1 md:col-span-1">
                    <label className="block font-medium text-slate-700">First name</label>
                    <input
                      type="text"
                      value={editForm.firstName}
                      onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div className="space-y-1 md:col-span-1">
                    <label className="block font-medium text-slate-700">Middle name</label>
                    <input
                      type="text"
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-1">
                    <label className="block font-medium text-slate-700">Last name</label>
                    <input
                      type="text"
                      value={editForm.lastName}
                      onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700">Employee ID</label>
                    <input
                      type="text"
                      value={editForm.employeeId}
                      onChange={(e) => setEditForm({ ...editForm, employeeId: e.target.value })}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700">Nickname</label>
                    <input
                      type="text"
                      value={editForm.nickname}
                      onChange={(e) => setEditForm({ ...editForm, nickname: e.target.value })}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditOpen(false)}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="rounded-full bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 transition-colors"
                  >
                    {editSaving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Change profile picture modal */}
        {avatarOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6 space-y-4 text-[11px]">
              <h2 className="text-sm font-semibold text-slate-900">Change profile picture</h2>
              <form onSubmit={handleAvatarSubmit} className="space-y-4">
                <p className="text-slate-500">
                  Upload a clear photo where your face is visible. This may be used by
                  administrators to help verify your account.
                </p>
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 overflow-hidden rounded-full bg-blue-100 flex-shrink-0 flex items-center justify-center">
                    {avatarPreview || profile?.avatar_url ? (
                      <img
                        src={avatarPreview || profile?.avatar_url}
                        alt="Preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <FaUserCircle className="text-4xl text-slate-300" />
                    )}
                  </div>
                  <div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarFileChange}
                      className="hidden"
                      id="avatar-upload"
                    />
                    <label
                      htmlFor="avatar-upload"
                      className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      Choose photo
                    </label>
                    <p className="mt-1.5 text-[10px] text-slate-400">
                      JPG or PNG, up to ~5MB. Square photos work best.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarOpen(false);
                      setAvatarFile(null);
                      setAvatarPreview(null);
                    }}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!avatarFile || avatarSaving}
                    className="rounded-full bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {avatarSaving ? 'Saving...' : 'Save picture'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Change password modal */}
        {passwordOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6 space-y-4 text-[11px]">
              <h2 className="text-sm font-semibold text-slate-900">Change password</h2>
              <form onSubmit={handlePasswordSubmit} className="space-y-3">
                <div className="space-y-1">
                  <label className="block font-medium text-slate-700">Current Password</label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? "text" : "password"}
                      value={passwordForm.currentPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 pr-10"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showCurrentPassword ? <FaEyeSlash className="w-3.5 h-3.5" /> : <FaEye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="block font-medium text-slate-700">New Password</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 pr-10"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showNewPassword ? <FaEyeSlash className="w-3.5 h-3.5" /> : <FaEye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <PasswordStrengthIndicator
                  password={passwordForm.newPassword}
                  onValidationChange={setPasswordValid}
                />

                <div className="space-y-1">
                  <label className="block font-medium text-slate-700">Confirm New Password</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                      className="mt-1 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 pr-10"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showConfirmPassword ? <FaEyeSlash className="w-3.5 h-3.5" /> : <FaEye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordOpen(false);
                      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                    }}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={passwordSaving || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordValid || passwordForm.newPassword !== passwordForm.confirmPassword}
                    className="rounded-full bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {passwordSaving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-10 opacity-40">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400 border-t border-slate-200 pt-6">
          <span>Identity Node: System Admin Core</span>
          <span>DYCI CONSTITUTIONAL COVENANT</span>
        </div>
      </footer>
    </div>
  );
};

export default SysAdminProfile;
