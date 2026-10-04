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
import { getApiUrl } from '@/utils/apiUrl';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Search,
  Shield,
  Database,
  FileText,
  Users,
  Activity,
  Clock,
  Eye,
  ChevronRight,
  Scale,
  RefreshCw,
  Brain,
  UserCheck,
  Settings,
  IndianRupee,
  CreditCard,
  Receipt,
  Wallet,
  Ticket,
  Package,
  FileCheck,
} from 'lucide-react';
import logo from '@/assets/logo.png';
import { CaseDetailModal } from '@/components/admin/CaseDetailModal';
import { UsageStats } from '@/components/admin/UsageStats';
import { LogsViewer } from '@/components/admin/LogsViewer';
import { AIUsageDashboard } from '@/components/admin/AIUsageDashboard';
import { IdentityVerificationsPanel } from '@/components/admin/IdentityVerificationsPanel';
import { SettingsPanel } from '@/components/admin/SettingsPanel';
import { HearingLogsViewer } from '@/components/admin/HearingLogsViewer';
import { NotificationBell } from '@/components/NotificationBell';
import { UsersManagement } from '@/components/admin/UsersManagement';
import { PaymentsManagement } from '@/components/admin/PaymentsManagement';
import { TransactionsManagement } from '@/components/admin/TransactionsManagement';
import { WalletManagement } from '@/components/admin/WalletManagement';
import { PromoCodeManagement } from '@/components/admin/PromoCodeManagement';
import { AddonsManagement } from '@/components/admin/AddonsManagement';
import { PaymentGatewaySettings } from '@/components/admin/PaymentGatewaySettings';
import { InvoicesManagement } from '@/components/admin/InvoicesManagement';

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

type AdminTab = 'cases' | 'usage' | 'logs' | 'hearing-logs' | 'ai' | 'verifications' | 'settings' | 'users' | 'payments' | 'transactions' | 'wallets' | 'promocodes' | 'addons' | 'gateways' | 'invoices';

const Admin = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('cases');
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [filteredCases, setFilteredCases] = useState<CaseRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCase, setSelectedCase] = useState<CaseRecord | null>(null);
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);

  const { user, session, isAuthenticated, loading, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Check if user has admin role using API
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!user) {
        setCheckingAdmin(false);
        return;
      }
      
      try {
        const token = session?.access_token;
        
        if (!token) {
          setCheckingAdmin(false);
          return;
        }
        
        // The server decides admin access: admin role + authenticator check.
        const response = await fetch(`${getApiUrl(true)}/auth/is-admin`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.requires2FA) {
            // Admin account signed in before the authenticator check existed:
            // sign in again so the code is asked.
            await signOut();
            toast({
              title: 'Authenticator Required',
              description: 'Please sign in again and enter your authenticator code.',
            });
            navigate('/auth');
            return;
          }
          setIsAdmin(data.isAdmin === true);
        }
      } catch (err) {
        console.error('Error checking admin status:', err);
      } finally {
        setCheckingAdmin(false);
      }
    };
    
    if (!loading && isAuthenticated) {
      checkAdminStatus();
    } else if (!loading) {
      setCheckingAdmin(false);
    }
  }, [user, loading, isAuthenticated]);

  useEffect(() => {
    if (!loading && !checkingAdmin && !isAuthenticated) {
      navigate('/auth');
    } else if (!loading && !checkingAdmin && isAuthenticated && !isAdmin) {
      toast({
        title: 'Access Denied',
        description: 'You do not have admin privileges.',
        variant: 'destructive',
      });
      navigate('/');
    }
  }, [loading, checkingAdmin, isAuthenticated, isAdmin, navigate, toast]);

  useEffect(() => {
    if (isAdmin) {
      fetchCases();
    }
  }, [isAdmin]);

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

  const fetchCases = async () => {
    setIsLoading(true);
    try {
      const API_URL = getApiUrl(true);
      const token = session?.access_token;
      
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
      setCases(data || []);
      setFilteredCases(data || []);
    } catch (error: any) {
      console.error('Error fetching cases:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch cases.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
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
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
  };

  if (loading || checkingAdmin || !isAdmin) {
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
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <img src={logo} alt="eNyayaSetu" className="w-10 h-10" />
            <div>
              <h1 className="font-bangers text-2xl flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                <span className="text-primary">Super</span>
                <span className="text-secondary">Admin</span>
              </h1>
              <p className="text-xs text-muted-foreground">System Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/pricing')}>
              <IndianRupee className="w-4 h-4 mr-2" />
              Pricing
            </Button>
            <NotificationBell />
            <Badge variant="outline" className="bg-primary/10">
              {user?.email}
            </Badge>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b-2 border-foreground bg-muted/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1">
            {[
              { id: 'cases' as AdminTab, label: 'Cases', icon: FileText },
              { id: 'users' as AdminTab, label: 'Users', icon: Users },
              { id: 'payments' as AdminTab, label: 'Payments', icon: CreditCard },
              { id: 'transactions' as AdminTab, label: 'Transactions', icon: Receipt },
              { id: 'wallets' as AdminTab, label: 'Wallets', icon: Wallet },
              { id: 'invoices' as AdminTab, label: 'Invoices', icon: FileCheck },
              { id: 'promocodes' as AdminTab, label: 'Promo Codes', icon: Ticket },
              { id: 'addons' as AdminTab, label: 'Add-ons', icon: Package },
              { id: 'gateways' as AdminTab, label: 'Gateways', icon: Settings },
              { id: 'verifications' as AdminTab, label: 'Verifications', icon: UserCheck },
              { id: 'ai' as AdminTab, label: 'AI Usage', icon: Brain },
              { id: 'usage' as AdminTab, label: 'Stats', icon: Activity },
              { id: 'logs' as AdminTab, label: 'Logs', icon: Database },
              { id: 'hearing-logs' as AdminTab, label: 'Hearing Logs', icon: Clock },
              { id: 'settings' as AdminTab, label: 'Settings', icon: Settings },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 font-medium text-sm border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary text-primary bg-background'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === 'cases' && (
          <div className="space-y-6">
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
                  <Users className="w-4 h-4 mr-1" />
                  {cases.length} Total Cases
                </Badge>
                <Button variant="outline" size="sm" onClick={fetchCases}>
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Refresh
                </Button>
              </div>
            </div>

            {/* Cases Table */}
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
                      <TableHead>Filed</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8">
                          <div className="flex items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            Loading cases...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : filteredCases.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          No cases found.
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
                            <Eye className="w-4 h-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </div>
        )}

        {activeTab === 'users' && <UsersManagement />}
        {activeTab === 'payments' && <PaymentsManagement />}
        {activeTab === 'transactions' && <TransactionsManagement />}
        {activeTab === 'wallets' && <WalletManagement />}
        {activeTab === 'invoices' && <InvoicesManagement />}
        {activeTab === 'promocodes' && <PromoCodeManagement />}
        {activeTab === 'addons' && <AddonsManagement />}
        {activeTab === 'gateways' && <PaymentGatewaySettings />}
        {activeTab === 'verifications' && <IdentityVerificationsPanel />}
        {activeTab === 'ai' && <AIUsageDashboard />}
        {activeTab === 'usage' && <UsageStats />}
        {activeTab === 'logs' && <LogsViewer />}
        {activeTab === 'hearing-logs' && <HearingLogsViewer />}
        {activeTab === 'settings' && <SettingsPanel />}
      </div>

      {/* Case Detail Modal */}
      <CaseDetailModal
        open={showCaseModal}
        onClose={() => setShowCaseModal(false)}
        caseRecord={selectedCase}
      />
    </div>
  );
};

export default Admin;
