import { getApiUrl } from '@/utils/apiUrl';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
const API_URL = getApiUrl();
import { 
  FileEdit, 
  Clock, 
  ArrowRight, 
  Trash2, 
  MessageSquare,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface DraftCase {
  id: string;
  case_number: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface DraftCasesSectionProps {
  userId: string;
  onResume: (caseId: string) => void;
}

export const DraftCasesSection: React.FC<DraftCasesSectionProps> = ({ userId, onResume }) => {
  const [draftCases, setDraftCases] = useState<DraftCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchDraftCases();
  }, [userId]);

  const fetchDraftCases = async () => {
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

      if (!token) {
        console.error('No authentication token for draft cases');
        setIsLoading(false);
        return;
      }

      // Fetch all cases and filter for drafts
      const response = await fetch(`${API_URL}/api/cases`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch cases');
      }

      const allCases = await response.json();
      // Filter for draft cases
      const drafts = (allCases || []).filter((c: any) => c.ai_processing_status === 'draft');

      // Get message counts for each draft
      const draftsWithCounts = await Promise.all(
        drafts.map(async (draft: any) => {
          try {
            const messagesResponse = await fetch(`${API_URL}/api/case-intake/${draft.id}/messages`, {
              headers: {
                'Authorization': `Bearer ${token}`,
              },
            });
            
            let messageCount = 0;
            if (messagesResponse.ok) {
              const messages = await messagesResponse.json();
              messageCount = Array.isArray(messages) ? messages.length : 0;
            }
            
            return {
              ...draft,
              message_count: messageCount,
            };
          } catch (e) {
            return {
              ...draft,
              message_count: 0,
            };
          }
        })
      );

      setDraftCases(draftsWithCounts);
    } catch (error) {
      console.error('Error fetching draft cases:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteDraft = async (draftId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(draftId);
    
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

      if (!token) {
        throw new Error('No authentication token');
      }

      // Delete the case (API should handle cascade or messages deletion)
      const response = await fetch(`${API_URL}/api/cases/${draftId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to delete draft' }));
        throw new Error(errorData.error || 'Failed to delete draft');
      }

      toast.success('Draft deleted');
      setDraftCases(prev => prev.filter(d => d.id !== draftId));
    } catch (error) {
      console.error('Error deleting draft:', error);
      toast.error('Failed to delete draft');
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (draftCases.length === 0) {
    return null; // Don't show section if no drafts
  }

  return (
    <Card className="border-2 border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20 shadow-[4px_4px_0_hsl(var(--foreground)/0.1)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileEdit className="w-5 h-5 text-amber-600" />
          Resume Draft Cases
          <Badge variant="secondary" className="ml-auto">
            {draftCases.length} draft{draftCases.length !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Continue where you left off - your conversations are auto-saved
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {draftCases.map((draft) => (
          <div
            key={draft.id}
            className="flex items-center justify-between p-3 bg-background rounded-lg border hover:border-primary transition-colors cursor-pointer group"
            onClick={() => onResume(draft.id)}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <FileEdit className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">
                  {draft.title || 'Untitled Draft'}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {format(new Date(draft.updated_at), 'MMM d, h:mm a')}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    {draft.message_count} messages
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                onClick={(e) => deleteDraft(draft.id, e)}
                disabled={deletingId === draft.id}
              >
                {deletingId === draft.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
              <Button variant="ghost" size="sm" className="group-hover:text-primary">
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
