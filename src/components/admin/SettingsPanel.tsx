import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { IntegrationSettings } from './IntegrationSettings';
import {
  Settings,
  Mail,
  Key,
  Save,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  ExternalLink,
} from 'lucide-react';

export const SettingsPanel: React.FC = () => {
  const [resendApiKey, setResendApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    checkEmailConfiguration();
  }, []);

  const checkEmailConfiguration = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('send-verification-email', {
        body: { action: 'check-config' },
      });
      
      if (!error && data?.configured) {
        setIsConfigured(true);
      }
    } catch (err) {
      console.log('Email not configured yet');
    }
  };

  const handleSaveApiKey = async () => {
    if (!resendApiKey.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a valid API key.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      // Test the API key by calling the edge function
      const { data, error } = await supabase.functions.invoke('send-verification-email', {
        body: { 
          action: 'save-config',
          apiKey: resendApiKey.trim(),
        },
      });

      if (error) throw error;

      toast({
        title: 'API Key Saved',
        description: 'Resend API key has been configured successfully.',
      });
      
      setIsConfigured(true);
      setResendApiKey('');
    } catch (error: any) {
      console.error('Error saving API key:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save API key.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setIsTesting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      
      const { data, error } = await supabase.functions.invoke('send-verification-email', {
        body: { 
          action: 'test',
          email: userData.user?.email,
        },
      });

      if (error) throw error;

      toast({
        title: 'Test Email Sent',
        description: `A test email has been sent to ${userData.user?.email}`,
      });
    } catch (error: any) {
      console.error('Error sending test email:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to send test email.',
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-bold">System Settings</h2>
      </div>

      {/* Email Configuration */}
      <div className="border-2 border-foreground rounded-xl bg-card p-6 shadow-[4px_4px_0_hsl(var(--foreground))]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Mail className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold">Email Notifications</h3>
            <p className="text-sm text-muted-foreground">
              Configure Resend API for sending email notifications
            </p>
          </div>
          {isConfigured ? (
            <Badge className="ml-auto bg-green-500">
              <Check className="w-3 h-3 mr-1" />
              Configured
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto">
              <AlertCircle className="w-3 h-3 mr-1" />
              Not Configured
            </Badge>
          )}
        </div>

        <div className="space-y-4">
          {/* Instructions */}
          <div className="bg-muted/50 rounded-lg p-4 text-sm">
            <p className="font-medium mb-2">Setup Instructions:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>
                Sign up at{' '}
                <a 
                  href="https://resend.com" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  resend.com <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                Verify your domain at{' '}
                <a 
                  href="https://resend.com/domains" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  resend.com/domains <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                Create an API key at{' '}
                <a 
                  href="https://resend.com/api-keys" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  resend.com/api-keys <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>Paste your API key below and save</li>
            </ol>
          </div>

          {/* API Key Input */}
          <div className="space-y-2">
            <Label htmlFor="resend-api-key" className="flex items-center gap-2">
              <Key className="w-4 h-4" />
              Resend API Key
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="resend-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  value={resendApiKey}
                  onChange={(e) => setResendApiKey(e.target.value)}
                  placeholder={isConfigured ? '••••••••••••••••' : 'Enter your Resend API key'}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <Button 
                onClick={handleSaveApiKey} 
                disabled={isSaving || !resendApiKey.trim()}
              >
                <Save className="w-4 h-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>

          {/* Test Email Button */}
          {isConfigured && (
            <div className="pt-2">
              <Button 
                variant="outline" 
                onClick={handleTestEmail}
                disabled={isTesting}
              >
                <Mail className="w-4 h-4 mr-2" />
                {isTesting ? 'Sending...' : 'Send Test Email'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <IntegrationSettings />
    </div>
  );
};
