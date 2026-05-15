import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { DashboardSkeleton } from '../ui/Skeleton';

interface AuthOverrideGuardProps {
  children: React.ReactNode;
}

const AuthOverrideGuard: React.FC<AuthOverrideGuardProps> = ({ children }) => {
  const navigate = useNavigate();
  const { authoritativeRole, user } = useAuth();
  const [checking, setChecking] = useState(true);
  const [isBlocked, setIsBlocked] = useState(false);

  const checkOverrideStatus = async () => {
    // L90 (system_admin) bypasses auth overrides
    if (authoritativeRole === 'system_admin' || authoritativeRole === 'sysadmin' || window.location.pathname.startsWith('/sysadmin')) {
      setChecking(false);
      return;
    }

    checkAuthOverride();
  };

  useEffect(() => {
    if (!user) {
      setChecking(false);
      return;
    }

    checkOverrideStatus();

    // Subscribe to real-time changes
    const subscription = supabase
      .channel('auth_override_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'auth_override',
          filter: 'id=eq.1',
        },
        (payload) => {
          const newData = payload.new as any;
          handleOverrideChange(newData.is_active);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [authoritativeRole, navigate, user]);

  const checkAuthOverride = async () => {
    try {
      const { data, error } = await supabase.rpc('is_user_blocked_by_override', {
        p_user_id: (await supabase.auth.getUser()).data.user?.id
      });

      if (error) {
        console.error('Error checking auth override:', error);
        setChecking(false);
        return;
      }

      handleOverrideChange(data);
    } catch (err) {
      console.error('Auth override check error:', err);
      setChecking(false);
    }
  };

  const handleOverrideChange = (isBlockedByOverride: boolean) => {
    setIsBlocked(isBlockedByOverride);
    setChecking(false);

    if (isBlockedByOverride) {
      navigate('/session-suspended', { replace: true });
    }
  };

  if (checking) {
    return <DashboardSkeleton />;
  }

  if (isBlocked) {
    return null; // Will redirect
  }

  return <>{children}</>;
};

export default AuthOverrideGuard;
