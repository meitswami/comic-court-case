import { getApiUrl } from '@/utils/apiUrl';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Search,
  FileText,
  Eye,
  RefreshCw,
  Scale,
  Plus,
  Home,
  Play,
  Loader2,
  Download,
  IndianRupee,
  Receipt,
  FolderOpen,
} from 'lucide-react';
import logo from '@/assets/logo.png';
import { CaseDetailModal } from '@/components/admin/CaseDetailModal';
import { NotificationBell } from '@/components/NotificationBell';
import { DraftCasesSection } from '@/components/DraftCasesSection';
import { WalletBalance } from '@/components/WalletBalance';
import { generateCasePDF } from '@/utils/generateCasePDF';
import { CheckoutModal } from '@/components/CheckoutModal';
import { StartHearingVerification } from '@/components/StartHearingVerification';
import { UserTransactions } from '@/components/UserTransactions';
import { toast } from 'sonner';

interface CaseRecord {
  id: string;
  case_number: string;
  title: string;
  plaintiff: string;
  defendant: string;
  category: string;
  status: string;
  user_role: string;
  created_at: string;
  callback_number?: string;
  ai_processing_status?: string;
  uploaded_by_relation?: string;
  involved_person_status?: string;
  description?: string;
}

const Dashboard = () => {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [filteredCases, setFilteredCases] = useState<CaseRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCase, setSelectedCase] = useState<CaseRecord | null>(null);
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [startingSession, setStartingSession] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [caseForCheckout, setCaseForCheckout] = useState<CaseRecord | null>(null);
  const [showVerification, setShowVerification] = useState(false);
  const [sessionForVerification, setSessionForVerification] = useState<string | null>(null);
  const [showTransactions, setShowTransactions] = useState(false);

  const { user, isAuthenticated, loading } = useAuth();
  const { toast: showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate('/auth');
    }
  }, [loading, isAuthenticated, navigate]);

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchMyCases();
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const filtered = cases.filter(
        (c) =>
          c.case_number.toLowerCase().includes(query) ||
          c.title.toLowerCase().includes(query) ||
          c.plaintiff.toLowerCase().includes(query) ||
          c.defendant.toLowerCase().includes(query) ||
          c.category?.toLowerCase().includes(query) ||
          c.status?.toLowerCase().includes(query)
      );
      setFilteredCases(filtered);
    } else {
      setFilteredCases(cases);
    }
  }, [searchQuery, cases]);

  const fetchMyCases = async () => {
    setIsLoading(true);
    try {
      const API_URL = getApiUrl(true);
      
      // Get access token from auth_session
      let token = null;
      const authSession = localStorage.getItem('auth_session');
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
      
      const response = await fetch(`${API_URL}/cases`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch cases');
      }
      
      const data = await response.json();
      // Filter out draft cases
      const nonDraftCases = data.filter((c: any) => c.ai_processing_status !== 'draft');
      setCases(nonDraftCases || []);
      setFilteredCases(nonDraftCases || []);
    } catch (error: any) {
      console.error('Error fetching cases:', error);
      showToast({
        title: 'Error',
        description: 'Failed to fetch your cases.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const startHearing = async (caseRecord: CaseRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    
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
        showToast({
          title: 'Error',
          description: 'Please log in to start a hearing.',
          variant: 'destructive',
        });
        return;
      }

      // Check if session already exists with payment
      const API_URL = getApiUrl(true);
      const sessionsResponse = await fetch(`${API_URL}/court/sessions?case_id=${caseRecord.id}&payment_status=completed`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (sessionsResponse.ok) {
        const sessions = await sessionsResponse.json();
        const existingSession = Array.isArray(sessions) && sessions.length > 0 ? sessions[0] : null;

        if (existingSession) {
          // Session exists with payment, show verification
          setSessionForVerification(existingSession.id);
          setShowVerification(true);
          return;
        }
      }

      // No paid session, show checkout
      setCaseForCheckout(caseRecord);
      setShowCheckout(true);
    } catch (error: any) {
      console.error('Error checking session:', error);
      // On error, show checkout anyway
      setCaseForCheckout(caseRecord);
      setShowCheckout(true);
    }
  };

  const handlePaymentComplete = (sessionId: string) => {
    setShowCheckout(false);
    setCaseForCheckout(null);
    // Show verification after payment
    setSessionForVerification(sessionId);
    setShowVerification(true);
  };

  const handleVerificationComplete = () => {
    if (sessionForVerification) {
      navigate(`/court/${sessionForVerification}`);
    }
    setShowVerification(false);
    setSessionForVerification(null);
  };

  const handleCaseClick = (caseRecord: CaseRecord) => {
    setSelectedCase(caseRecord);
    setShowCaseModal(true);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      pending: 'outline',
      in_progress: 'default',
      adjourned: 'secondary',
      verdict_delivered: 'default',
      closed: 'secondary',
    };
    
    const labels: Record<string, string> = {
      pending: '⏳ Pending',
      in_progress: '🔄 In Progress',
      adjourned: '📅 Adjourned',
      verdict_delivered: '⚖️ Verdict Delivered',
      closed: '✅ Closed',
    };
    
    return <Badge variant={variants[status] || 'outline'}>{labels[status] || status}</Badge>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b-2 border-foreground bg-card px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              <Home className="w-4 h-4" />
            </Button>
            <img src={logo} alt="eNyayaSetu" className="w-10 h-10" />
            <div>
              <h1 className="font-bangers text-2xl flex items-center gap-2">
                <Scale className="w-5 h-5 text-primary" />
                <span className="text-primary">My</span>
                <span className="text-secondary">Cases</span>
              </h1>
              <p className="text-xs text-muted-foreground">Your Case Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <WalletBalance />
            <Button variant="ghost" size="sm" onClick={() => setShowTransactions(true)}>
              <Receipt className="w-4 h-4 mr-2" />
              Transactions
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/workspaces')}>
              <FolderOpen className="w-4 h-4 mr-2" />
              Case prep
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/pricing')}>
              <IndianRupee className="w-4 h-4 mr-2" />
              Pricing
            </Button>
            <NotificationBell />
            <Badge variant="outline" className="bg-primary/10 hidden sm:flex">
              {user?.email}
            </Badge>
            <Button variant="comic" size="sm" onClick={() => navigate('/')}>
              <Plus className="w-4 h-4 mr-2" />
              File New Case
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="space-y-6">
          {/* Draft Cases Section */}
          {user && (
            <DraftCasesSection 
              userId={user.id} 
              onResume={(caseId) => {
                // Navigate to home with draft case ID to resume
                navigate('/', { state: { resumeDraftId: caseId } });
              }} 
            />
          )}

          {/* Search and Stats */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by case number, title, parties, status..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-4">
              <Badge variant="secondary" className="px-3 py-1">
                <FileText className="w-4 h-4 mr-1" />
                {cases.length} Case(s)
              </Badge>
              <Button variant="outline" size="sm" onClick={fetchMyCases}>
                <RefreshCw className="w-4 h-4 mr-1" />
                Refresh
              </Button>
            </div>
          </div>

          {/* Empty State */}
          {!isLoading && cases.length === 0 && (
            <div className="border-2 border-dashed border-muted-foreground/30 rounded-xl p-12 text-center">
              <Scale className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-xl font-semibold mb-2">No Cases Filed Yet</h3>
              <p className="text-muted-foreground mb-6">
                You haven't filed any cases yet. Start your journey to justice.
              </p>
              <Button variant="comic" onClick={() => navigate('/')}>
                <Plus className="w-4 h-4 mr-2" />
                File Your First Case
              </Button>
            </div>
          )}

          {/* Cases Table */}
          {(isLoading || cases.length > 0) && (
            <div className="border-2 border-foreground rounded-xl overflow-hidden bg-card shadow-[4px_4px_0_hsl(var(--foreground))]">
              <ScrollArea className="h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Case Number</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Plaintiff</TableHead>
                      <TableHead>Defendant</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Filed On</TableHead>
                      <TableHead>Actions</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8">
                          <div className="flex items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            Loading your cases...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : filteredCases.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          No cases found matching your search.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredCases.map((caseRecord) => (
                        <TableRow
                          key={caseRecord.id}
                          className="cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => handleCaseClick(caseRecord)}
                        >
                          <TableCell className="font-mono text-sm">
                            {caseRecord.case_number}
                          </TableCell>
                          <TableCell className="font-medium max-w-[200px] truncate">
                            {caseRecord.title}
                          </TableCell>
                          <TableCell>{caseRecord.plaintiff}</TableCell>
                          <TableCell>{caseRecord.defendant}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{caseRecord.category}</Badge>
                          </TableCell>
                          <TableCell>{getStatusBadge(caseRecord.status)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(caseRecord.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="comic"
                              size="sm"
                              onClick={(e) => startHearing(caseRecord, e)}
                              disabled={startingSession === caseRecord.id}
                            >
                              {startingSession === caseRecord.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  <Play className="w-3 h-3 mr-1" />
                                  Hearing
                                </>
                              )}
                            </Button>
                          </TableCell>
                          <TableCell>
                            <Eye className="w-4 h-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </div>
      </div>

      {/* Case Detail Modal */}
      <CaseDetailModal
        open={showCaseModal}
        onClose={() => setShowCaseModal(false)}
        caseRecord={selectedCase}
      />

      {/* Checkout Modal */}
      {caseForCheckout && (
        <CheckoutModal
          open={showCheckout}
          onClose={() => {
            setShowCheckout(false);
            setCaseForCheckout(null);
          }}
          caseId={caseForCheckout.id}
          onPaymentComplete={handlePaymentComplete}
        />
      )}

      {/* Start Hearing Verification Modal */}
      {sessionForVerification && (
        <StartHearingVerification
          open={showVerification}
          onClose={() => {
            setShowVerification(false);
            setSessionForVerification(null);
          }}
          sessionId={sessionForVerification}
          onVerified={handleVerificationComplete}
        />
      )}

      {/* User Transactions Modal */}
      <UserTransactions
        open={showTransactions}
        onClose={() => setShowTransactions(false)}
      />
    </div>
  );
};

export default Dashboard;
