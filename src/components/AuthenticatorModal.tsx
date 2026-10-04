import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Shield, CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/utils/apiUrl';
import type { Session } from '@/hooks/useAuth';

// Shown only when an ADMIN signs in. /api/auth/signin answers an admin's
// correct password with a short-lived challenge token instead of a session;
// this dialog exchanges that challenge plus an authenticator code for the
// session. Normal users never see it.
interface AuthenticatorModalProps {
  open: boolean;
  /** Challenge token returned by /api/auth/signin for an admin account. */
  challengeToken: string;
  /** True when no authenticator has been configured yet (first admin sign-in). */
  setupRequired: boolean;
  onVerified: (session: Session) => void;
  onCancel: () => void;
}

type ModalMode = 'setup' | 'setup-verify' | 'backup-codes' | 'login' | 'success';

export const AuthenticatorModal: React.FC<AuthenticatorModalProps> = ({
  open,
  challengeToken,
  setupRequired,
  onVerified,
  onCancel,
}) => {
  const [mode, setMode] = useState<ModalMode>('login');
  const [otp, setOtp] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [qrCode, setQrCode] = useState<string>('');
  const [manualEntryKey, setManualEntryKey] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [pendingSession, setPendingSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Reset every time the dialog opens
  useEffect(() => {
    if (open) {
      setOtp('');
      setBackupCode('');
      setUseBackupCode(false);
      setQrCode('');
      setManualEntryKey('');
      setBackupCodes([]);
      setPendingSession(null);
      setLoading(false);
      setMode(setupRequired ? 'setup' : 'login');
    }
  }, [open, setupRequired]);

  // Auto-verify when 6 digits are entered
  useEffect(() => {
    if (loading || otp.length !== 6) return;
    if (mode !== 'login' && mode !== 'setup-verify') return;

    // Small delay to ensure all digits are registered
    const timeoutId = setTimeout(() => {
      if (mode === 'login') {
        verifyLogin(otp);
      } else {
        verifySetup();
      }
    }, 300);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, mode, loading]);

  const post = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${getApiUrl()}/api/authenticator/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken, ...body }),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  };

  // The challenge is only valid for a few minutes after the password step.
  const handleExpired = (data: any) => {
    if (!data?.challengeExpired) return false;
    toast({
      title: 'Sign-in Expired',
      description: 'Please sign in again.',
      variant: 'destructive',
    });
    onCancel();
    return true;
  };

  const generateQRCode = async () => {
    try {
      setLoading(true);
      const { response, data } = await post('setup', {});

      if (response.ok) {
        setQrCode(data.qrCode);
        setManualEntryKey(data.manualEntryKey);
        setBackupCodes(data.backupCodes || []);
        setMode('setup-verify');
        return;
      }

      if (handleExpired(data)) return;

      if (data.secretExists) {
        // Someone finished setup in the meantime - just ask for the code
        setMode('login');
        return;
      }

      throw new Error(data.error || 'Failed to generate QR code');
    } catch (error: any) {
      console.error('Error generating QR code:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate QR code',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const verifySetup = async () => {
    if (otp.length !== 6) {
      toast({
        title: 'Invalid Code',
        description: 'Please enter a 6-digit code',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      const { response, data } = await post('verify-setup', { code: otp });

      if (response.ok && data.session) {
        toast({
          title: 'Success',
          description: 'Authenticator successfully set up!',
        });

        if (backupCodes.length > 0) {
          // Let the admin save the backup codes before continuing
          setPendingSession(data.session);
          setMode('backup-codes');
        } else {
          setMode('success');
          setTimeout(() => onVerified(data.session), 1000);
        }
        return;
      }

      if (handleExpired(data)) return;

      if (data.secretExists) {
        setOtp('');
        setMode('login');
        return;
      }

      throw new Error(data.error || 'Wrong passcode');
    } catch (error: any) {
      console.error('Error verifying setup:', error);
      toast({
        title: 'Wrong Passcode',
        description: error.message || 'Wrong passcode. Please try again.',
        variant: 'destructive',
      });
      setOtp('');
    } finally {
      setLoading(false);
    }
  };

  const verifyLogin = async (code: string) => {
    if (!code) {
      toast({
        title: 'Invalid Code',
        description: 'Please enter your code',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      const { response, data } = await post('verify', { code });

      if (response.ok && data.session) {
        setMode('success');
        toast({
          title: 'Success',
          description: 'Authentication successful!',
        });
        setTimeout(() => onVerified(data.session), 1000);
        return;
      }

      if (handleExpired(data)) return;

      if (data.setupRequired) {
        setOtp('');
        setMode('setup');
        return;
      }

      throw new Error(data.error || 'Wrong passcode');
    } catch (error: any) {
      console.error('Error verifying login:', error);
      toast({
        title: 'Wrong Passcode',
        description: error.message || 'Wrong passcode. Please try again.',
        variant: 'destructive',
      });
      setOtp('');
      setBackupCode('');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied',
      description: 'Copied to clipboard',
    });
  };

  const renderOtpInput = () => (
    <div className="bg-muted/30 rounded-lg p-4 mb-2">
      <p className="text-sm text-muted-foreground mb-3 text-center">
        Open Microsoft Authenticator app on your phone and enter the 6-digit code shown there
      </p>
      <InputOTP
        maxLength={6}
        value={otp}
        onChange={setOtp}
        containerClassName="justify-center"
      >
        <InputOTPGroup>
          {[...Array(6)].map((_, i) => (
            <InputOTPSlot key={i} index={i} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {otp.length > 0 && otp.length < 6 && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Enter {6 - otp.length} more digit{6 - otp.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );

  const renderContent = () => {
    if (mode === 'setup') {
      return (
        <div className="space-y-6">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">Initial Setup Required</h3>
            <p className="text-sm text-muted-foreground">
              Set up Microsoft Authenticator to secure admin access to eNyayaSetu
            </p>
          </div>

          <Button onClick={generateQRCode} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Shield className="mr-2 h-4 w-4" />
                Generate QR Code
              </>
            )}
          </Button>
        </div>
      );
    }

    if (mode === 'setup-verify') {
      return (
        <div className="space-y-6">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">Set Up Microsoft Authenticator</h3>
            <p className="text-sm text-muted-foreground">
              Scan this QR code with Microsoft Authenticator or enter the key manually
            </p>
          </div>

          <div className="flex flex-col items-center space-y-4">
            <div className="border-2 border-border rounded-lg p-4 bg-background">
              <img src={qrCode} alt="QR Code" className="w-64 h-64" />
            </div>

            <div className="w-full">
              <Label className="mb-2 block">Manual Entry Key</Label>
              <div className="flex items-center gap-2">
                <Input value={manualEntryKey} readOnly className="font-mono text-sm" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(manualEntryKey)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <div>
              <Label className="text-base font-semibold mb-3 block">
                6-Digit Code from Microsoft Authenticator *
              </Label>
              {renderOtpInput()}
            </div>

            <Button
              onClick={verifySetup}
              disabled={otp.length !== 6 || loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Verify & Complete Setup
                </>
              )}
            </Button>
          </div>
        </div>
      );
    }

    if (mode === 'backup-codes') {
      return (
        <div className="space-y-6">
          <div className="text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-2" />
            <h3 className="text-lg font-semibold mb-2">Save Your Backup Codes</h3>
            <p className="text-sm text-muted-foreground">
              Each code works once if you lose access to your authenticator app.
              They will not be shown again.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 bg-muted/30 rounded-lg p-4 font-mono text-sm text-center">
            {backupCodes.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => copyToClipboard(backupCodes.join('\n'))}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
            <Button
              className="flex-1"
              onClick={() => pendingSession && onVerified(pendingSession)}
            >
              I've Saved Them
            </Button>
          </div>
        </div>
      );
    }

    if (mode === 'login') {
      return (
        <div className="space-y-6">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">Authenticator Code Required</h3>
            <p className="text-sm text-muted-foreground">
              Admin accounts need a code from Microsoft Authenticator to sign in
            </p>
          </div>

          <div className="space-y-4">
            {useBackupCode ? (
              <div>
                <Label htmlFor="backup-code" className="text-base font-semibold mb-3 block">
                  Backup Code *
                </Label>
                <Input
                  id="backup-code"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value.trim())}
                  placeholder="Enter one of your backup codes"
                  className="font-mono"
                  autoComplete="off"
                />
              </div>
            ) : (
              <div>
                <Label className="text-base font-semibold mb-3 block">
                  6-Digit Code from Microsoft Authenticator *
                </Label>
                {renderOtpInput()}
              </div>
            )}

            <Button
              onClick={() => verifyLogin(useBackupCode ? backupCode : otp)}
              disabled={(useBackupCode ? !backupCode : otp.length !== 6) || loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" />
                  Verify & Access
                </>
              )}
            </Button>

            <button
              type="button"
              onClick={() => {
                setUseBackupCode(!useBackupCode);
                setOtp('');
                setBackupCode('');
              }}
              className="w-full text-center text-sm text-primary hover:underline"
            >
              {useBackupCode ? 'Use authenticator app instead' : 'Use a backup code instead'}
            </button>
          </div>
        </div>
      );
    }

    if (mode === 'success') {
      return (
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <CheckCircle2 className="h-16 w-16 text-green-500" />
          <h3 className="text-lg font-semibold">Authentication Successful!</h3>
          <p className="text-sm text-muted-foreground">Granting access...</p>
        </div>
      );
    }

    return null;
  };

  // Closing the dialog cancels the sign-in, except while the one-time backup
  // codes are on screen or the verified session is being handed over.
  const canClose = mode !== 'backup-codes' && mode !== 'success';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && canClose) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Two-Factor Authentication
          </DialogTitle>
          <DialogDescription>
            {mode === 'setup' || mode === 'setup-verify' || mode === 'backup-codes'
              ? 'Set up Microsoft Authenticator to secure admin access'
              : 'Enter your authenticator code to continue'}
          </DialogDescription>
        </DialogHeader>

        {renderContent()}
      </DialogContent>
    </Dialog>
  );
};
