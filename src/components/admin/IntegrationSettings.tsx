import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Bot, Mic, Check, AlertCircle, Save, Loader2, PlugZap, Mail } from 'lucide-react';

// Keys for the AI judge / intake chat / OCR and for voice. They are saved on
// the server and never sent back to the browser - only "configured or not".

interface SettingInfo {
  label: string;
  secret: boolean;
  configured: boolean;
  source: 'admin' | 'env' | null;
  value: string | null;
  hint: string | null;
}

type SettingsMap = Record<string, SettingInfo>;

const StatusBadge: React.FC<{ info?: SettingInfo }> = ({ info }) =>
  info?.configured ? (
    <Badge className="ml-auto bg-green-500">
      <Check className="w-3 h-3 mr-1" />
      Configured{info.source === 'env' ? ' (.env)' : ''}
    </Badge>
  ) : (
    <Badge variant="outline" className="ml-auto">
      <AlertCircle className="w-3 h-3 mr-1" />
      Not Configured
    </Badge>
  );

export const IntegrationSettings: React.FC = () => {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [aiKey, setAiKey] = useState('');
  const [aiUrl, setAiUrl] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [voiceKey, setVoiceKey] = useState('');
  const [emailFrom, setEmailFrom] = useState('');
  const { toast } = useToast();

  const apply = (next: SettingsMap) => {
    setSettings(next);
    setAiUrl(next.AI_API_URL?.value || '');
    setAiModel(next.AI_MODEL?.value || '');
    setEmailFrom(next.EMAIL_FROM?.value || '');
  };

  const call = async (body: Record<string, any>) => {
    const { data, error } = await supabase.functions.invoke('admin-settings', { body });
    if (error) throw error;
    return data;
  };

  useEffect(() => {
    call({ action: 'get' })
      .then((data) => apply(data?.settings || {}))
      .catch((error) => console.error('Error loading settings:', error))
      .finally(() => setLoading(false));
  }, []);

  const save = async (section: string, values: Record<string, string>, done: () => void) => {
    setSaving(section);
    try {
      const data = await call({ action: 'save', values });
      apply(data?.settings || {});
      done();
      toast({ title: 'Saved', description: 'Settings updated.' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save settings.',
        variant: 'destructive',
      });
    } finally {
      setSaving(null);
    }
  };

  const testAi = async () => {
    setTesting(true);
    try {
      await call({ action: 'test-ai' });
      toast({ title: 'AI Connected', description: 'The AI service answered correctly.' });
    } catch (error: any) {
      toast({
        title: 'AI Test Failed',
        description: error.message || 'The AI service did not answer.',
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const card = 'border-2 border-foreground rounded-xl bg-card p-6 shadow-[4px_4px_0_hsl(var(--foreground))]';

  return (
    <>
      {/* AI */}
      <div className={card}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold">AI (Judge, Intake Chat, OCR)</h3>
            <p className="text-sm text-muted-foreground">
              A Google Gemini key (starts with AIza) or an OpenAI key (starts with sk-)
            </p>
          </div>
          <StatusBadge info={settings.AI_API_KEY} />
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ai-key">API Key</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
              placeholder={
                settings.AI_API_KEY?.configured
                  ? `Saved ${settings.AI_API_KEY.hint || ''} - leave blank to keep`
                  : 'Paste your AI API key'
              }
            />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ai-model">Model (optional)</Label>
              <Input
                id="ai-model"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="Default: gemini-2.5-flash / gpt-4o-mini"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-url">API URL (optional)</Label>
              <Input
                id="ai-url"
                value={aiUrl}
                onChange={(e) => setAiUrl(e.target.value)}
                placeholder="Only for another OpenAI-compatible provider"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                save('ai', { AI_API_KEY: aiKey, AI_MODEL: aiModel, AI_API_URL: aiUrl }, () => setAiKey(''))
              }
              disabled={saving === 'ai'}
            >
              <Save className="w-4 h-4 mr-2" />
              {saving === 'ai' ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="outline" onClick={testAi} disabled={testing || !settings.AI_API_KEY?.configured}>
              {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlugZap className="w-4 h-4 mr-2" />}
              Test
            </Button>
          </div>
        </div>
      </div>

      {/* Voice */}
      <div className={card}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Mic className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold">Voice (ElevenLabs)</h3>
            <p className="text-sm text-muted-foreground">
              Live transcription and spoken replies in the courtroom
            </p>
          </div>
          <StatusBadge info={settings.ELEVENLABS_API_KEY} />
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            value={voiceKey}
            onChange={(e) => setVoiceKey(e.target.value)}
            placeholder={
              settings.ELEVENLABS_API_KEY?.configured
                ? `Saved ${settings.ELEVENLABS_API_KEY.hint || ''} - leave blank to keep`
                : 'Paste your ElevenLabs API key'
            }
          />
          <Button
            onClick={() => save('voice', { ELEVENLABS_API_KEY: voiceKey }, () => setVoiceKey(''))}
            disabled={saving === 'voice' || !voiceKey.trim()}
          >
            <Save className="w-4 h-4 mr-2" />
            {saving === 'voice' ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Email sender */}
      <div className={card}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Mail className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold">Email Sender</h3>
            <p className="text-sm text-muted-foreground">
              The "from" address on emails. It must be on a domain you verified in Resend.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder="eNyayaSetu <no-reply@yourdomain.com>"
          />
          <Button onClick={() => save('email', { EMAIL_FROM: emailFrom }, () => undefined)} disabled={saving === 'email'}>
            <Save className="w-4 h-4 mr-2" />
            {saving === 'email' ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </>
  );
};
