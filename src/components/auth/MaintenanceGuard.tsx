import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { DashboardSkeleton } from '../ui/Skeleton';

interface MaintenanceGuardProps {
  children: React.ReactNode;
}

const MaintenanceGuard: React.FC<MaintenanceGuardProps> = ({ children }) => {
  const navigate = useNavigate();
  const { authoritativeRole, user } = useAuth();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!user) {
      setChecking(false);
      return;
    }

    checkMaintenanceMode();

    // Subscribe to real-time changes on school_settings
    const subscription = supabase
      .channel('maintenance_mode_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'school_settings',
          filter: 'id=eq.1',
        },
        (payload) => {
          const newData = payload.new as any;
          handleMaintenanceChange(newData.maintenance_mode);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [authoritativeRole, navigate, user]);

  const checkMaintenanceMode = async () => {
    try {
      const { data, error } = await supabase
        .from('school_settings')
        .select('maintenance_mode')
        .eq('id', 1)
        .single();

      if (error) {
        console.error('Error checking maintenance mode:', error);
        setChecking(false);
        return;
      }

      handleMaintenanceChange(data?.maintenance_mode);
    } catch (err) {
      console.error('Maintenance check error:', err);
    } finally {
      setChecking(false);
    }
  };

  const handleMaintenanceChange = (isMaintenance: boolean) => {
    // 1. Check if we're on a sysadmin path (bypass intent)
    const isSysAdminPath = window.location.pathname.startsWith('/sysadmin');

    // 2. Resolve role logic
    const isL90 = authoritativeRole === 'system_admin' || authoritativeRole === 'sysadmin';
    const isRoleLoading = user && !authoritativeRole;

    // 3. Redirection logic
    // We only redirect if:
    // - Maintenance is ON
    // - User is NOT L90
    // - Role is NOT still loading (to avoid race conditions on refresh)
    // - We are NOT already on a sysadmin path (extra safety)
    if (isMaintenance && !isL90 && !isRoleLoading && !isSysAdminPath) {
      // Redirect to maintenance page
      navigate('/maintenance', { replace: true });
    }
  };

  if (checking) {
    return <DashboardSkeleton />;
  }

  return <>{children}</>;
};

export default MaintenanceGuard;
