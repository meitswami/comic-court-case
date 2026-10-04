import { getApiUrl } from '@/utils/apiUrl';
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Wallet, CreditCard, IndianRupee, Loader2 } from 'lucide-react';
import { WalletTopUp } from './WalletTopUp';

const API_URL = getApiUrl();

interface AddonPurchaseModalProps {
  open: boolean;
  onClose: () => void;
  addonSlug: string;
  addonName?: string;
  addonPrice?: number;
  onSuccess?: () => void;
}

export const AddonPurchaseModal: React.FC<AddonPurchaseModalProps> = ({
  open,
  onClose,
  addonSlug,
  addonName,
  addonPrice,
  onSuccess,
}) => {
  const [paymentMethod, setPaymentMethod] = useState<'wallet' | 'gateway'>('wallet');
  const [walletBalance, setWalletBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [addon, setAddon] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchAddon();
      fetchWalletBalance();
    }
  }, [open, addonSlug]);

  const fetchAddon = async () => {
    try {
      const response = await fetch(`${API_URL}/api/addons?status=active`);
      if (response.ok) {
        const addons = await response.json();
        const foundAddon = addons.find((a: any) => a.code === addonSlug);
        if (foundAddon) {
          setAddon(foundAddon);
        } else {
          // Log if addon not found for debugging
          console.log(`[AddonPurchaseModal] Addon with code "${addonSlug}" not found in database. Available addons:`, addons.map((a: any) => a.code));
        }
      }
    } catch (error) {
      console.error('Error fetching addon:', error);
    }
  };

  const fetchWalletBalance = async () => {
    try {
      const authSession = localStorage.getItem('auth_session');
      let token = null;
      if (authSession) {
        try {
          const session = JSON.parse(authSession);
          token = session?.access_token || session?.session?.access_token;
        } catch (e) {
          console.error('Error parsing auth session:', e);
        }
      }

      if (!token) return;

      const response = await fetch(`${API_URL}/api/payments/wallet/balance`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setWalletBalance(data.balance || 0);
      }
    } catch (error) {
      console.error('Error fetching wallet balance:', error);
    }
  };

  const handlePurchase = async () => {
    const price = addon?.price || addonPrice || 50;
    const name = addon?.name || addonName || 'Addon';

    // Check wallet balance if using wallet
    if (paymentMethod === 'wallet' && walletBalance < price) {
      toast({
        title: 'Insufficient Balance',
        description: `Your wallet balance is ₹${walletBalance.toFixed(2)}. Please top up first.`,
        variant: 'destructive',
      });
      setShowTopUp(true);
      return;
    }

    setLoading(true);
    try {
      const authSession = localStorage.getItem('auth_session');
      let token = null;
      if (authSession) {
        try {
          const session = JSON.parse(authSession);
          token = session?.access_token || session?.session?.access_token;
        } catch (e) {
          console.error('Error parsing auth session:', e);
        }
      }

      if (!token) {
        throw new Error('Please log in to purchase');
      }

      // Use addon ID if available, otherwise just use addonSlug
      const addonId = addon?.id || null;
      const metadata: any = {
        type: 'addon_payment',
        addon_code: addonSlug,
      };
      
      // Only include addon_id if we have it
      if (addonId) {
        metadata.addon_id = addonId;
      }

      // Create payment for addon
      const response = await fetch(`${API_URL}/api/payments/create`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: price,
          gateway: paymentMethod === 'wallet' ? 'wallet' : 'razorpay',
          metadata,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create payment');
      }

      // Check payment status
      if (data.status === 'completed' || (paymentMethod === 'wallet' && data.id)) {
        // Payment successful
        toast({
          title: 'Purchase Successful',
          description: `You have successfully purchased ${name}!`,
        });
        onClose();
        if (onSuccess) onSuccess();
      } else if (data.status === 'failed') {
        // Payment failed
        throw new Error(data.failure_reason || 'Payment failed');
      } else {
        // Payment gateway - show redirect message
        toast({
          title: 'Redirecting to Payment',
          description: 'You will be redirected to complete the payment.',
        });
        // TODO: Redirect to payment gateway URL when implemented
      }
    } catch (error: any) {
      console.error('Purchase error:', error);
      toast({
        title: 'Purchase Failed',
        description: error.message || 'Failed to process purchase. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const price = addon?.price || addonPrice || 50;
  const name = addon?.name || addonName || 'RTI Tutorial';

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IndianRupee className="w-5 h-5" />
              Purchase {name}
            </DialogTitle>
            <DialogDescription>
              Complete your purchase to access this feature
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Price Display */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Price</span>
                <span className="text-2xl font-bold flex items-center gap-1">
                  <IndianRupee className="w-5 h-5" />
                  {price.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Wallet Balance */}
            <div className="bg-muted/30 p-3 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Wallet Balance</span>
                <span className="font-semibold flex items-center gap-1">
                  <IndianRupee className="w-4 h-4" />
                  {walletBalance.toFixed(2)}
                </span>
              </div>
              {walletBalance < price && (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-2 p-0 h-auto"
                  onClick={() => setShowTopUp(true)}
                >
                  Top up wallet
                </Button>
              )}
            </div>

            {/* Payment Method */}
            <div className="space-y-3">
              <Label>Payment Method</Label>
              <RadioGroup value={paymentMethod} onValueChange={(value: any) => setPaymentMethod(value)}>
                <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="wallet" id="wallet" />
                  <Label htmlFor="wallet" className="flex-1 cursor-pointer flex items-center gap-2">
                    <Wallet className="w-4 h-4" />
                    <span>Wallet Balance</span>
                    {walletBalance >= price && (
                      <Badge variant="outline" className="ml-auto">Available</Badge>
                    )}
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="gateway" id="gateway" />
                  <Label htmlFor="gateway" className="flex-1 cursor-pointer flex items-center gap-2">
                    <CreditCard className="w-4 h-4" />
                    <span>Payment Gateway</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handlePurchase} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <IndianRupee className="w-4 h-4 mr-2" />
                  Pay ₹{price.toFixed(2)}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showTopUp && (
        <WalletTopUp
          open={showTopUp}
          onClose={() => {
            setShowTopUp(false);
            fetchWalletBalance();
          }}
          currentBalance={walletBalance}
          onBalanceUpdate={(newBalance) => {
            setWalletBalance(newBalance);
          }}
        />
      )}
    </>
  );
};
