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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Wallet, CreditCard, IndianRupee, Loader2, Info } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import {
  fetchActiveGateway,
  isValidIndianMobile,
  redirectToCashfree,
  rememberedPhone,
  rememberPhone,
} from '@/lib/cashfree';

interface WalletTopUpProps {
  open: boolean;
  onClose: () => void;
  currentBalance: number;
  onBalanceUpdate?: (newBalance: number) => void;
}

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

export const WalletTopUp: React.FC<WalletTopUpProps> = ({
  open,
  onClose,
  currentBalance,
  onBalanceUpdate,
}) => {
  const [amount, setAmount] = useState<string>('');
  const [gateway, setGateway] = useState<'cashfree' | null>(null);
  const [gatewayChecked, setGatewayChecked] = useState(false);
  const [phone, setPhone] = useState(rememberedPhone());
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { session } = useAuth();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchActiveGateway().then((active) => {
      if (cancelled) return;
      setGateway(active.gateway);
      setGatewayChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleQuickAmount = (value: number) => {
    setAmount(value.toString());
  };

  const handleTopUp = async () => {
    const topUpAmount = parseFloat(amount);

    if (isNaN(topUpAmount) || topUpAmount <= 0) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a valid amount greater than 0.',
        variant: 'destructive',
      });
      return;
    }

    if (topUpAmount < 100) {
      toast({
        title: 'Minimum Amount',
        description: 'Minimum top-up amount is ₹100.',
        variant: 'destructive',
      });
      return;
    }

    if (!gateway) {
      toast({
        title: 'Online Payment Not Available',
        description: 'Wallet top-ups are not switched on yet. Please contact support.',
        variant: 'destructive',
      });
      return;
    }

    if (!isValidIndianMobile(phone)) {
      toast({
        title: 'Mobile Number Required',
        description: 'Enter a valid 10-digit mobile number. The payment gateway needs it.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      if (!session?.access_token) {
        throw new Error('Please log in to top up your wallet');
      }

      const payment = await apiFetch('/payments/create', {
        body: {
          amount: topUpAmount,
          gateway,
          type: 'wallet_topup',
          customer_phone: phone,
        },
      });

      rememberPhone(phone);
      // Continues on Cashfree's page. The wallet is credited once Cashfree
      // confirms the payment, and the customer lands on /payment/return.
      await redirectToCashfree(payment);
    } catch (error: any) {
      console.error('Error initiating payment:', error);
      toast({
        title: 'Payment Failed',
        description: error.message || 'Failed to initiate payment. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Top Up Wallet
          </DialogTitle>
          <DialogDescription>
            Add money to your wallet for seamless payments
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Current Balance */}
          <div className="bg-muted/50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Current Balance</span>
              <span className="text-2xl font-bold flex items-center gap-1">
                <IndianRupee className="w-5 h-5" />
                {currentBalance.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="amount">Enter Amount (₹)</Label>
            <Input
              id="amount"
              type="number"
              placeholder="Enter amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="100"
              step="1"
              className="text-lg"
            />
            <p className="text-xs text-muted-foreground">Minimum: ₹100</p>
          </div>

          {/* Quick Amount Buttons */}
          <div className="space-y-2">
            <Label>Quick Amounts</Label>
            <div className="flex gap-2 flex-wrap">
              {QUICK_AMOUNTS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={amount === value.toString() ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleQuickAmount(value)}
                >
                  ₹{value}
                </Button>
              ))}
            </div>
          </div>

          {/* Payment Method */}
          {gateway ? (
            <div className="space-y-3">
              <Label>Payment Method</Label>
              <div className="flex items-center gap-2 p-3 border rounded-lg">
                <CreditCard className="w-4 h-4" />
                <span>Card / UPI / Net Banking (Cashfree)</span>
              </div>
              <div className="space-y-1">
                <Label htmlFor="topup_phone">Mobile number for payment</Label>
                <Input
                  id="topup_phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
          ) : (
            gatewayChecked && (
              <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg text-sm">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Online top-ups are not switched on yet. Please contact support to add money to your wallet.</span>
              </div>
            )
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleTopUp} disabled={loading || !amount || !gateway}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Wallet className="w-4 h-4 mr-2" />
                Top Up ₹{amount || '0'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

