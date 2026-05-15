import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { FaLock } from 'react-icons/fa';
import { useAuth } from '../../contexts/AuthContext';

interface ReadOnlyGuardProps {
  children: React.ReactNode;
}

const ReadOnlyGuard: React.FC<ReadOnlyGuardProps> = ({ children }) => {
  const { authoritativeRole } = useAuth();
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [readOnlyInfo, setReadOnlyInfo] = useState<{ enabled_at: string | null, reason: string | null } | null>(null);

  useEffect(() => {
    // L90 (system_admin) bypasses read-only banner
    if (authoritativeRole === 'system_admin' || authoritativeRole === 'sysadmin' || window.location.pathname.startsWith('/sysadmin')) {
      setIsReadOnly(false);
      return;
    }

    checkReadOnlyStatus();

    // Subscribe to real-time changes
    const subscription = supabase
      .channel('read_only_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'read_only_mode',
          filter: 'id=eq.1',
        },
        (payload) => {
          const newData = payload.new as any;
          setIsReadOnly(newData.is_active);
          if (newData.is_active) {
            setReadOnlyInfo({
              enabled_at: newData.enabled_at,
              reason: newData.reason
            });
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [authoritativeRole]);

  const checkReadOnlyStatus = async () => {
    try {
      const { data, error } = await supabase.rpc('get_read_only_status');

      if (!error && data && data.length > 0) {
        const status = data[0];
        setIsReadOnly(status.is_active);
        if (status.is_active) {
          setReadOnlyInfo({
            enabled_at: status.enabled_at,
            reason: status.reason
          });
        }
      }
    } catch (err) {
      console.error('Error checking read-only status:', err);
    }
  };

  return (
    <>
      {isReadOnly && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white px-4 py-2 shadow-lg">
          <div className="max-w-6xl mx-auto flex items-center justify-center space-x-2">
            <FaLock className="text-xs" />
            <span className="text-xs font-bold uppercase tracking-widest">
              DATABASE READ-ONLY MODE ACTIVE
            </span>
            {readOnlyInfo?.enabled_at && (
              <span className="text-[10px] opacity-80">
                (Since {new Date(readOnlyInfo.enabled_at).toLocaleTimeString()})
              </span>
            )}
            {readOnlyInfo?.reason && (
              <span className="text-[10px] opacity-80 hidden md:inline">
                - {readOnlyInfo.reason}
              </span>
            )}
          </div>
        </div>
      )}
      <div className={isReadOnly ? 'pt-10' : ''}>
        {children}
      </div>
    </>
  );
};

export default ReadOnlyGuard;
