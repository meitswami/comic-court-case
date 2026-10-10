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
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle, XCircle, Shield, Mail } from 'lucide-react';

interface StartHearingVerificationProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  onVerified: () => void;
}

export const StartHearingVerification: React.FC<StartHearingVerificationProps> = ({
  open,
  onClose,
  sessionId,
  onVerified,
}) => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [lawyerId, setLawyerId] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open && sessionId) {
      fetchSession();
    }
  }, [open, sessionId]);

  const fetchSession = async () => {
    try {
      const { data, error } = await supabase
        .from('court_sessions')
        .select('*, cases(*)')
        .eq('id', sessionId)
        .single();

      if (error) throw error;
      setSession(data);
      
      // An unexpired OTP has already been emailed to the lawyer
      if (
        data?.actual_lawyer_otp_expires_at &&
        new Date(data.actual_lawyer_otp_expires_at) > new Date()
      ) {
        setOtpSent(true);
      }
    } catch (error: any) {
      console.error('Error fetching session:', error);
      toast({
        title: 'Error',
        description: 'Failed to load session details.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSendOTP = async () => {
    if (!lawyerId.trim()) {
      toast({
        title: 'Lawyer ID Required',
        description: 'Please enter the lawyer ID number.',
        variant: 'destructive',
      });
      return;
    }

    setVerifying(true);
    try {
      // Get user email for lawyer
      const { data: { user } } = await supabase.auth.getUser();
      const lawyerEmail = user?.email || session?.actual_lawyer_email;

      const { data, error } = await supabase.functions.invoke('send-lawyer-otp', {
        body: { 
          session_id: sessionId, 
          lawyer_id: lawyerId,
          lawyer_email: lawyerEmail,
        },
      });

      if (error) throw error;

      setOtpSent(true);
      // Refresh session to get updated OTP
      await fetchSession();
      
      toast({
        title: 'OTP Sent',
        description: 'OTP has been sent to the lawyer\'s email address.',
      });
    } catch (error: any) {
      console.error('Error sending OTP:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to send OTP.',
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp.trim() || otp.length !== 6) {
      toast({
        title: 'Invalid OTP',
        description: 'Please enter a valid 6-digit OTP.',
        variant: 'destructive',
      });
      return;
    }

    setVerifying(true);
    try {
      // The server checks the code; it is never sent to the browser.
      const { error } = await supabase.functions.invoke('verify-lawyer-otp', {
        body: { session_id: sessionId, otp: otp.trim() },
      });
      if (error) throw error;

      toast({
        title: 'Verification Successful!',
        description: 'Hearing can now begin.',
      });

      onVerified();
      onClose();
    } catch (error: any) {
      console.error('Error verifying OTP:', error);
      toast({
        title: 'Verification Failed',
        description: error.message || 'Invalid OTP. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!session) {
    return null;
  }

  const isAILawyer = session.lawyer_type === 'ai_lawyer';
  const isActualLawyer = session.lawyer_type === 'actual_lawyer';
  const paymentCompleted = session.payment_status === 'completed';

  // Pre-check: Payment must be completed
  if (!paymentCompleted) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-destructive" />
              Payment Required
            </DialogTitle>
            <DialogDescription>
              Payment must be completed before starting the hearing.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Badge variant="destructive">Payment Status: {session.payment_status}</Badge>
          </div>
          <DialogFooter>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // AI Lawyer: Check if fees paid, then good to go
  if (isAILawyer) {
    const aiLawyerFeesPaid = session.ai_lawyer_fee > 0 && paymentCompleted;
    
    if (!aiLawyerFeesPaid) {
      return (
        <Dialog open={open} onOpenChange={onClose}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-destructive" />
                AI Lawyer Fees Not Paid
              </DialogTitle>
              <DialogDescription>
                AI Lawyer fees must be paid before starting the hearing.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }

    // All checks passed for AI Lawyer
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              Ready to Start Hearing
            </DialogTitle>
            <DialogDescription>
              All requirements are met. You can proceed with the hearing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 rounded-lg">
              <span>AI Lawyer Fees</span>
              <Badge variant="outline" className="bg-green-100">Paid (₹{session.ai_lawyer_fee})</Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 rounded-lg">
              <span>Court Hearing Fees</span>
              <Badge variant="outline" className="bg-green-100">Paid (₹{session.court_hearing_fee})</Badge>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-semibold mb-1">Case Hearing ID:</p>
              <p className="text-lg font-mono">{session.cases?.case_number || sessionId}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => {
              onVerified();
              onClose();
            }}>
              Start Hearing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Actual Lawyer: Need lawyer ID and OTP verification
  if (isActualLawyer) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Verify Actual Lawyer Access
            </DialogTitle>
            <DialogDescription>
              Enter lawyer details to start the hearing session.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Case Hearing ID */}
            <div className="p-3 bg-muted rounded-lg">
              <Label className="text-sm font-semibold mb-1 block">Case Hearing ID:</Label>
              <p className="text-lg font-mono">{session.cases?.case_number || sessionId}</p>
            </div>

            {/* Lawyer ID */}
            <div className="space-y-2">
              <Label htmlFor="lawyer_id">Lawyer ID Number</Label>
              <Input
                id="lawyer_id"
                placeholder="Enter lawyer ID"
                value={lawyerId}
                onChange={(e) => setLawyerId(e.target.value)}
                disabled={otpSent}
              />
            </div>

            {/* Send OTP Button */}
            {!otpSent && (
              <Button
                onClick={handleSendOTP}
                disabled={verifying || !lawyerId.trim()}
                className="w-full"
              >
                {verifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending OTP...
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4 mr-2" />
                    Send OTP to Lawyer Email
                  </>
                )}
              </Button>
            )}

            {/* OTP Input */}
            {otpSent && (
              <>
                <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                  <p className="text-sm text-blue-900 dark:text-blue-100">
                    ✓ OTP has been sent to the lawyer's email address. Please check your email and enter the OTP below.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="otp">Enter OTP (6 digits)</Label>
                  <Input
                    id="otp"
                    placeholder="000000"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                    className="text-center text-2xl tracking-widest font-mono"
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={verifying}>
              Cancel
            </Button>
            {otpSent && (
              <Button onClick={handleVerifyOTP} disabled={verifying || otp.length !== 6}>
                {verifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify & Start Hearing'
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
};

