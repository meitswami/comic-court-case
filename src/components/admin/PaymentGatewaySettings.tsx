import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  RefreshCw,
  Settings,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Copy,
  PlugZap,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface GatewaySetting {
  id: string;
  gateway: string;
  is_active: boolean;
  api_key: string | null;
  api_secret: string | null;
  merchant_id: string | null;
  salt_key: string | null;
  salt_index: string | null;
  test_mode: boolean;
  updated_at: string;
}

type FieldKey = 'api_key' | 'api_secret' | 'merchant_id' | 'salt_key' | 'salt_index';

interface GatewayField {
  key: FieldKey;
  label: string;
  placeholder: string;
  secret?: boolean;
}

interface GatewayDefinition {
  id: 'cashfree' | 'razorpay' | 'phonepe';
  name: string;
  description: string;
  // Checkout is built and payments can be taken.
  connected: boolean;
  fields: GatewayField[];
}

const GATEWAYS: GatewayDefinition[] = [
  {
    id: 'cashfree',
    name: 'Cashfree',
    description: 'Cards, UPI, net banking and wallets through Cashfree Payments',
    connected: true,
    fields: [
      { key: 'api_key', label: 'App ID', placeholder: 'Your Cashfree App ID (x-client-id)' },
      { key: 'api_secret', label: 'Secret Key', placeholder: 'Your Cashfree Secret Key', secret: true },
    ],
  },
  {
    id: 'razorpay',
    name: 'Razorpay',
    description: 'Keys can be stored, but checkout is not connected yet',
    connected: false,
    fields: [
      { key: 'api_key', label: 'API Key', placeholder: 'rzp_test_...' },
      { key: 'api_secret', label: 'API Secret', placeholder: 'Your Razorpay key secret', secret: true },
    ],
  },
  {
    id: 'phonepe',
    name: 'PhonePe',
    description: 'Keys can be stored, but checkout is not connected yet',
    connected: false,
    fields: [
      { key: 'merchant_id', label: 'Merchant ID', placeholder: 'MERCHANTUAT' },
      { key: 'salt_key', label: 'Salt Key', placeholder: 'Your PhonePe salt key', secret: true },
      { key: 'salt_index', label: 'Salt Index', placeholder: '1' },
    ],
  },
];

const emptyForm = { api_key: '', api_secret: '', merchant_id: '', salt_key: '', salt_index: '' };

export const PaymentGatewaySettings: React.FC = () => {
  const [gateways, setGateways] = useState<GatewaySetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GatewayDefinition | null>(null);
  const [form, setForm] = useState<Record<FieldKey, string>>(emptyForm);
  const [testMode, setTestMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const { toast } = useToast();

  const webhookUrl = `${window.location.origin}/api/payments/cashfree/webhook`;

  useEffect(() => {
    fetchGateways();
  }, []);

  const fetchGateways = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('payment_gateway_settings')
        .select('*')
        .order('gateway');

      if (error) throw error;
      setGateways(data || []);
    } catch (error: any) {
      console.error('Error fetching gateway settings:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch payment gateway settings.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const settingFor = (id: string) => gateways.find((g) => g.gateway === id);

  const isConfigured = (definition: GatewayDefinition) => {
    const setting = settingFor(definition.id);
    return !!setting && definition.fields.every((field) => !!setting[field.key]);
  };

  const openEditor = (definition: GatewayDefinition) => {
    const setting = settingFor(definition.id);
    const next = { ...emptyForm };
    definition.fields.forEach((field) => {
      // Saved secrets are never sent back to the browser, so their inputs start empty.
      next[field.key] = field.secret ? '' : setting?.[field.key] || '';
    });
    setForm(next);
    setTestMode(setting?.test_mode ?? true);
    setEditing(definition);
  };

  const handleToggle = async (definition: GatewayDefinition) => {
    const setting = settingFor(definition.id);
    if (!setting) return;
    try {
      const { error } = await supabase
        .from('payment_gateway_settings')
        .update({ is_active: !setting.is_active })
        .eq('id', setting.id);

      if (error) throw error;
      toast({
        title: setting.is_active ? 'Gateway Deactivated' : 'Gateway Activated',
        description: setting.is_active
          ? `${definition.name} is no longer offered at checkout.`
          : `${definition.name} is now offered at checkout. Any other gateway was deactivated.`,
      });
      fetchGateways();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to change the gateway status.',
        variant: 'destructive',
      });
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    const setting = settingFor(editing.id);

    const missing = editing.fields.filter((field) => {
      const alreadySaved = field.secret && !!setting?.[field.key];
      return !form[field.key].trim() && !alreadySaved;
    });
    if (missing.length > 0) {
      toast({
        title: 'Validation Error',
        description: `${missing.map((f) => f.label).join(' and ')} ${missing.length > 1 ? 'are' : 'is'} required.`,
        variant: 'destructive',
      });
      return;
    }

    const values: Record<string, any> = { test_mode: testMode };
    editing.fields.forEach((field) => {
      const value = form[field.key].trim();
      // A blank secret means "keep the saved one".
      if (value || !field.secret) values[field.key] = value;
    });

    setSaving(true);
    try {
      if (setting) {
        const { error } = await supabase
          .from('payment_gateway_settings')
          .update(values)
          .eq('id', setting.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('payment_gateway_settings')
          .insert({ gateway: editing.id, is_active: false, ...values });
        if (error) throw error;
      }

      toast({
        title: 'Saved',
        description: `${editing.name} settings saved.`,
      });
      setEditing(null);
      fetchGateways();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || `Failed to save ${editing.name} settings.`,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestCashfree = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-settings', {
        body: { action: 'test-cashfree' },
      });
      if (error) throw error;
      toast({
        title: data?.ok ? 'Connection Successful' : 'Connection Failed',
        description: data?.message,
        variant: data?.ok ? 'default' : 'destructive',
      });
    } catch (error: any) {
      toast({
        title: 'Connection Failed',
        description: error.message || 'Could not test the Cashfree connection.',
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast({ title: 'Copied', description: 'Webhook URL copied.' });
    } catch {
      toast({ title: 'Copy failed', description: webhookUrl });
    }
  };

  const activeGateway = gateways.find((g) => g.is_active);
  const activeDefinition = GATEWAYS.find((g) => g.id === activeGateway?.gateway);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Payment Gateway Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure payment gateways. Only one gateway can be active at a time.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchGateways}>
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      {activeGateway ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Active Gateway</AlertTitle>
          <AlertDescription>
            <strong>{activeDefinition?.name || activeGateway.gateway}</strong> is currently active
            {activeGateway.test_mode ? ' in test mode - no real money is collected.' : ' in live mode.'}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No gateway is active</AlertTitle>
          <AlertDescription>
            Customers can only pay from their wallet until a gateway is configured and activated.
          </AlertDescription>
        </Alert>
      )}

      {/* Gateways */}
      <div className="grid md:grid-cols-2 gap-6">
        {GATEWAYS.map((definition) => {
          const setting = settingFor(definition.id);
          const configured = isConfigured(definition);
          return (
            <div key={definition.id} className="border-2 border-foreground rounded-xl p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{definition.name}</h3>
                  <p className="text-sm text-muted-foreground">{definition.description}</p>
                </div>
                {definition.connected ? (
                  <Badge variant={setting?.is_active ? 'default' : 'secondary'}>
                    {setting?.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                ) : (
                  <Badge variant="outline">Not connected</Badge>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Status</span>
                  <Switch
                    checked={setting?.is_active || false}
                    onCheckedChange={() => handleToggle(definition)}
                    disabled={!setting?.is_active && (!definition.connected || !configured)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Keys</span>
                  <Badge variant="outline">{configured ? 'Saved' : 'Not set'}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Test Mode</span>
                  <Badge variant="outline">{setting?.test_mode ?? true ? 'Yes' : 'No'}</Badge>
                </div>
              </div>

              {definition.id === 'cashfree' && (
                <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                  <Label className="text-xs">Webhook URL (add this in your Cashfree dashboard)</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                    <Button variant="outline" size="icon" onClick={copyWebhook} aria-label="Copy webhook URL">
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => openEditor(definition)}>
                  <Settings className="w-4 h-4 mr-2" />
                  Configure
                </Button>
                {definition.id === 'cashfree' && (
                  <Button variant="outline" onClick={handleTestCashfree} disabled={!configured || testing}>
                    {testing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <PlugZap className="w-4 h-4 mr-2" />
                    )}
                    Test
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Configuration Modal */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure {editing?.name}</DialogTitle>
            <DialogDescription>
              {editing?.id === 'cashfree'
                ? 'Enter the App ID and Secret Key from Cashfree Dashboard > Developers > API Keys. Use test keys with Test Mode on, and production keys with it off.'
                : `Enter your ${editing?.name} credentials.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {editing?.fields.map((field) => {
              const saved = field.secret && !!settingFor(editing.id)?.[field.key];
              return (
                <div className="space-y-2" key={field.key}>
                  <Label htmlFor={`${editing.id}_${field.key}`}>{field.label} *</Label>
                  <Input
                    id={`${editing.id}_${field.key}`}
                    type={field.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={form[field.key]}
                    onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                    placeholder={saved ? 'Saved - leave blank to keep the current one' : field.placeholder}
                  />
                </div>
              );
            })}
            <div className="flex items-center space-x-2">
              <Switch checked={testMode} onCheckedChange={setTestMode} />
              <Label>Test Mode (sandbox - no real money)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
