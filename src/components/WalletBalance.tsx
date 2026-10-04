import { getApiUrl } from '@/utils/apiUrl';
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { IndianRupee, Wallet } from 'lucide-react';
import { WalletTopUp } from './WalletTopUp';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

const API_URL = getApiUrl();

interface WalletBalanceProps {
  className?: string;
}

export const WalletBalance: React.FC<WalletBalanceProps> = ({ className = '' }) => {
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [showTopUp, setShowTopUp] = useState(false);
  const { session, user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (user && session) {
      fetchBalance();
    }
  }, [user, session]);

  const fetchBalance = async () => {
    try {
      setLoading(true);
      
      // Get access token - prefer session from useAuth hook, fallback to localStorage
      let token = null;
      
      if (session?.access_token) {
        token = session.access_token;
        console.log('[WalletBalance] Using token from session hook');
      } else {
        // Fallback to localStorage
        const authSession = localStorage.getItem('auth_session');
        if (authSession) {
          try {
            const sessionData = JSON.parse(authSession);
            // Session is stored directly, not nested
            token = sessionData?.access_token;
            console.log('[WalletBalance] Using token from localStorage');
          } catch (e) {
            console.error('[WalletBalance] Error parsing auth session:', e);
          }
        }
      }

      if (!token) {
        console.warn('[WalletBalance] No token available, cannot fetch balance');
        setBalance(0);
        setLoading(false);
        return;
      }

      console.log('[WalletBalance] Fetching balance with token:', token.substring(0, 20) + '...');

      const response = await fetch(`${API_URL}/api/payments/wallet/balance`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[WalletBalance] Received balance data:', data);
        const balanceValue = data.balance !== undefined && data.balance !== null ? parseFloat(data.balance) : 0;
        console.log('[WalletBalance] Setting balance to:', balanceValue);
        setBalance(balanceValue);
      } else {
        // Handle error response
        let errorText = '';
        try {
          errorText = await response.text();
          const errorData = JSON.parse(errorText);
          console.error('[WalletBalance] Error fetching balance:', response.status, errorData);
          
          // If token is invalid, clear session
          if (response.status === 401) {
            console.warn('[WalletBalance] Token invalid, clearing session');
            localStorage.removeItem('auth_session');
          }
        } catch (e) {
          console.error('[WalletBalance] Error parsing error response:', e);
        }
        setBalance(0);
      }
    } catch (error) {
      console.error('[WalletBalance] Error fetching wallet balance:', error);
      setBalance(0);
    } finally {
      setLoading(false);
    }
  };

  const handleBalanceUpdate = (newBalance: number) => {
    // Refresh balance after top-up
    fetchBalance();
  };

  if (!user || !session) {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowTopUp(true)}
        className={`flex items-center gap-2 ${className}`}
        disabled={loading}
      >
        <Wallet className="w-4 h-4" />
        <IndianRupee className="w-4 h-4" />
        <span className="font-semibold">{loading ? '...' : balance.toFixed(2)}</span>
      </Button>

      <WalletTopUp
        open={showTopUp}
        onClose={() => {
          setShowTopUp(false);
          fetchBalance();
        }}
        currentBalance={balance}
        onBalanceUpdate={handleBalanceUpdate}
      />
    </>
  );
};
