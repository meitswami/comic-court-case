import { getApiUrl } from '@/utils/apiUrl';
import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBrowserSTT } from '@/hooks/useBrowserSTT';
import { useBrowserTTS, TTSLanguage } from '@/hooks/useBrowserTTS';
import { Mic, Send, Volume2, Loader2, X, MessageCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const API_URL = getApiUrl();

interface RTIChatAgentProps {
  open: boolean;
  onClose: () => void;
  sectionId: string;
  sectionContent: {
    id: string;
    title: string;
    content: string;
    keyPoints?: string[];
    steps?: Array<{ step: number; title: string; description: string }>;
  };
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  isVoice?: boolean;
}

export const RTIChatAgent: React.FC<RTIChatAgentProps> = ({
  open,
  onClose,
  sectionId,
  sectionContent,
}) => {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initialize welcome message based on language
  useEffect(() => {
    if (open && messages.length === 0) {
      const welcomeMessage = language === 'hi' 
        ? `नमस्ते! मैं आपका RTI (सूचना का अधिकार) सहायक हूं। आप ${sectionContent.title} के बारे में क्या जानना चाहते हैं?`
        : `Hello! I'm your RTI (Right to Information) assistant. What would you like to know about ${sectionContent.title}?`;
      setMessages([{ role: 'assistant', content: welcomeMessage }]);
    }
  }, [open, language, sectionContent.title]);

  // Browser STT for voice input
  const { isListening, startListening, stopListening, transcript: sttTranscript } = useBrowserSTT({
    language: language as 'en' | 'hi' | 'hinglish',
    continuous: false,
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        setInput(text);
        stopListening();
      }
    },
  });

  // Browser TTS for voice output
  const { speak, isSpeaking, stopSpeaking } = useBrowserTTS();

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Update input with STT transcript
  useEffect(() => {
    if (sttTranscript && !isListening) {
      setInput(sttTranscript);
    }
  }, [sttTranscript, isListening]);

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      role: 'user',
      content: text,
      isVoice: isListening,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Get access token
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

      // Call RTI chat API
      const response = await fetch(`${API_URL}/api/rti/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        body: JSON.stringify({
          question: text,
          sectionId,
          sectionContent,
          language,
          conversationHistory: messages.slice(-5), // Last 5 messages for context
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.response || data.message || 'I apologize, but I could not generate a response.',
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Speak the response using TTS
      if (assistantMessage.content) {
        try {
          await speak(
            assistantMessage.content,
            'judge', // Default speaker role
            language as TTSLanguage
          );
        } catch (err) {
          console.warn('TTS error:', err);
        }
      }
    } catch (error) {
      console.error('Error getting AI response:', error);
      toast({
        title: 'Error',
        description: 'Failed to get response. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleMicClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-blue-600" />
            RTI Assistant - {sectionContent.title}
          </DialogTitle>
          <DialogDescription>
            Ask me anything about RTI or this section. Use voice or type your question.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
          <div className="space-y-4 pb-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {message.isVoice && message.role === 'user' && (
                      <Mic className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    )}
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg p-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <form onSubmit={handleSubmit} className="flex gap-2 pt-4 border-t">
          <Button
            type="button"
            variant={isListening ? 'destructive' : 'outline'}
            size="icon"
            onClick={handleMicClick}
          >
            {isListening ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </Button>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={language === 'hi' ? 'सवाल पूछें...' : 'Ask a question...'}
            disabled={isLoading || isListening}
            className="flex-1"
          />
          <Button type="submit" disabled={isLoading || isListening || !input.trim()}>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
