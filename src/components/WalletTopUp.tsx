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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Wallet, CreditCard, IndianRupee, Loader2 } from 'lucide-react';

const API_URL = getApiUrl();

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
  const [paymentMethod, setPaymentMethod] = useState<'razorpay' | 'phonepe'>('razorpay');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { session } = useAuth();

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

    setLoading(true);
    try {
      // Get access token
      const token = session?.access_token;
      if (!token) {
        throw new Error('Please log in to top up your wallet');
      }

      // Create payment via API
      const response = await fetch(`${API_URL}/api/payments/create`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: topUpAmount,
          gateway: paymentMethod,
          metadata: { type: 'wallet_topup' },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create payment');
      }

      if (data?.id) {
        // Payment created successfully
        // For Razorpay/PhonePe, redirect to payment page
        // This will be handled by the payment gateway integration
        toast({
          title: 'Payment Initiated',
          description: `Payment of ₹${topUpAmount} has been initiated. You will be redirected to complete the payment.`,
        });

        // TODO: Integrate actual payment gateway redirect here
        // For now, we'll just close the modal and refresh balance
        // In production, redirect to gateway payment page
        
        // Close dialog and reset
        onClose();
        setAmount('');
        
        // Refresh balance if callback provided
        if (onBalanceUpdate) {
          // Balance will be updated via webhook after payment completes
          // For now, show a message
          setTimeout(() => {
            onBalanceUpdate(currentBalance); // Trigger refresh
          }, 1000);
        }
      }
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
          <div className="space-y-3">
            <Label>Payment Method</Label>
            <RadioGroup value={paymentMethod} onValueChange={(value: any) => setPaymentMethod(value)}>
              <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="razorpay" id="razorpay" />
                <Label htmlFor="razorpay" className="flex-1 cursor-pointer flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4" />
                    <span>Razorpay</span>
                  </div>
                  <Badge variant="outline">Recommended</Badge>
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="phonepe" id="phonepe" />
                <Label htmlFor="phonepe" className="flex-1 cursor-pointer flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  <span>PhonePe</span>
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleTopUp} disabled={loading || !amount}>
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

