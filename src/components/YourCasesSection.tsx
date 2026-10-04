import { getApiUrl } from '@/utils/apiUrl';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Gavel, Play, Users, Calendar, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface UserCase {
  id: string;
  case_number: string;
  title: string;
  plaintiff: string;
  defendant: string;
  status: string;
  category: string;
  created_at: string;
}

interface YourCasesSectionProps {
  userId: string;
}

export const YourCasesSection: React.FC<YourCasesSectionProps> = ({ userId }) => {
  const [cases, setCases] = useState<UserCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingSession, setStartingSession] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCases = async () => {
      try {
        const API_URL = getApiUrl(true);
        const token = localStorage.getItem('auth_token');
        
        if (!token) {
          setLoading(false);
          return;
        }
        
        const response = await fetch(`${API_URL}/cases?limit=6`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          setCases(data.slice(0, 6) || []);
        }
      } catch (error) {
        console.error('Error fetching cases:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCases();
  }, [userId]);

  const startHearing = async (caseItem: UserCase) => {
    setStartingSession(caseItem.id);
    
    try {
      // Generate court code
      const courtCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      
      // Create court session
      const { data: session, error } = await supabase
        .from('court_sessions')
        .insert({
          case_id: caseItem.id,
          court_code: courtCode,
          status: 'scheduled',
          created_by: userId,
        })
        .select()
        .single();

      if (error) throw error;

      toast.success(`Court session created! Code: ${courtCode}`);
      navigate(`/court/${session.id}`);
    } catch (err) {
      toast.error('Failed to create court session');
      console.error(err);
    } finally {
      setStartingSession(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (cases.length === 0) {
    return null;
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-500',
    in_progress: 'bg-blue-500',
    adjourned: 'bg-purple-500',
    verdict_delivered: 'bg-green-500',
    closed: 'bg-muted',
  };

  return (
    <section className="py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h2 className="font-bangers text-3xl md:text-4xl text-foreground flex items-center gap-3">
            <Gavel className="w-8 h-8 text-primary" />
            Your Cases
          </h2>
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            View All <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cases.map((caseItem) => (
            <div
              key={caseItem.id}
              className="p-6 rounded-xl border-4 border-foreground bg-card shadow-[4px_4px_0_hsl(var(--foreground))] hover:shadow-[6px_6px_0_hsl(var(--foreground))] transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <Badge className={statusColors[caseItem.status] || 'bg-muted'}>
                  {caseItem.status?.replace('_', ' ')}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {caseItem.case_number}
                </span>
              </div>

              <h3 className="font-bangers text-xl text-foreground mb-2 line-clamp-2">
                {caseItem.title}
              </h3>

              <div className="space-y-1 mb-4 text-sm text-muted-foreground">
                <p><span className="text-foreground">vs</span> {caseItem.defendant}</p>
                {caseItem.category && (
                  <p className="text-xs">{caseItem.category}</p>
                )}
              </div>

              <Button
                variant="comic"
                size="sm"
                className="w-full"
                onClick={() => startHearing(caseItem)}
                disabled={startingSession === caseItem.id}
              >
                {startingSession === caseItem.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Start Hearing
                  </>
                )}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
