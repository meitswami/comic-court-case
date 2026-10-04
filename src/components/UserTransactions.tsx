import { getApiUrl } from '@/utils/apiUrl';
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  Receipt,
  Wallet,
  CreditCard,
  Copy,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const API_URL = getApiUrl();

interface Payment {
  id: string;
  amount: number | string; // MySQL DECIMAL can be string
  currency: string;
  gateway: string;
  status: string;
  gateway_transaction_id: string | null;
  gateway_order_id: string | null;
  metadata: string | null;
  created_at: string;
  completed_at: string | null;
  failure_reason: string | null;
}

interface Transaction {
  id: string;
  transaction_type: string;
  amount: number | string; // MySQL DECIMAL can be string
  balance_before: number | string;
  balance_after: number | string;
  description: string | null;
  reference_id: string | null;
  reference_type: string | null;
  created_at: string;
}

interface UserTransactionsProps {
  open: boolean;
  onClose: () => void;
}

export const UserTransactions: React.FC<UserTransactionsProps> = ({
  open,
  onClose,
}) => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const { session, user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (open && user) {
      fetchPayments();
      fetchTransactions();
    }
  }, [open, user]);

  const fetchPayments = async () => {
    setLoading(true);
    try {
      let token = session?.access_token;
      if (!token) {
        const authSession = localStorage.getItem('auth_session');
        if (authSession) {
          try {
            const sessionData = JSON.parse(authSession);
            token = sessionData?.access_token || sessionData?.session?.access_token;
          } catch (e) {
            console.error('Error parsing auth session:', e);
          }
        }
      }

      if (!token) {
        throw new Error('Please log in to view transactions');
      }

      const response = await fetch(`${API_URL}/api/payments`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPayments(data || []);
      } else {
        throw new Error('Failed to fetch payments');
      }
    } catch (error: any) {
      console.error('Error fetching payments:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load payment history.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    try {
      let token = session?.access_token;
      if (!token) {
        const authSession = localStorage.getItem('auth_session');
        if (authSession) {
          try {
            const sessionData = JSON.parse(authSession);
            token = sessionData?.access_token || sessionData?.session?.access_token;
          } catch (e) {
            console.error('Error parsing auth session:', e);
          }
        }
      }

      if (!token) return;

      const response = await fetch(`${API_URL}/api/payments/transactions`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setTransactions(data || []);
      }
    } catch (error: any) {
      console.error('Error fetching transactions:', error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied!',
      description: 'Transaction ID copied to clipboard',
    });
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      completed: { variant: 'default', icon: CheckCircle2, label: 'Completed' },
      pending: { variant: 'secondary', icon: Clock, label: 'Pending' },
      failed: { variant: 'destructive', icon: XCircle, label: 'Failed' },
      processing: { variant: 'secondary', icon: Clock, label: 'Processing' },
    };

    const config = variants[status] || { variant: 'outline', icon: Clock, label: status };
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1 w-fit">
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };

  const getGatewayBadge = (gateway: string) => {
    if (gateway === 'wallet') {
      return (
        <Badge variant="outline" className="flex items-center gap-1 w-fit">
          <Wallet className="w-3 h-3" />
          Wallet
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="flex items-center gap-1 w-fit">
        <CreditCard className="w-3 h-3" />
        {gateway === 'razorpay' ? 'Razorpay' : gateway === 'phonepe' ? 'PhonePe' : gateway}
      </Badge>
    );
  };

  const getTypeBadge = (type: string) => {
    const labels: Record<string, string> = {
      wallet_topup: 'Wallet Top-up',
      hearing_payment: 'Hearing Payment',
      addon_payment: 'Addon Purchase',
      refund: 'Refund',
      admin_adjustment: 'Admin Adjustment',
    };

    return (
      <Badge variant="outline">
        {labels[type] || type}
      </Badge>
    );
  };

  const parseMetadata = (metadata: string | null) => {
    if (!metadata) return null;
    try {
      return typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    } catch {
      return null;
    }
  };

  const getPaymentPurpose = (payment: Payment): string => {
    const metadata = parseMetadata(payment.metadata);
    
    if (metadata) {
      // Check for addon purchases
      if (metadata.type === 'addon_payment' && metadata.addon_code) {
        const addonNames: Record<string, string> = {
          'rti-tutorial': 'RTI Tutorial',
          'case-strength-suggestions': 'Case Strength Analysis',
          'ai_lawyer_assistant': 'AI Lawyer Assistant',
        };
        return addonNames[metadata.addon_code] || `Addon: ${metadata.addon_code}`;
      }
      
      // Check for wallet top-ups
      if (metadata.type === 'wallet_topup') {
        return 'Wallet Top-up';
      }
      
      // Check for hearing payments
      if (metadata.type === 'hearing_payment') {
        return 'Court Hearing Payment';
      }
      
      // Generic type-based description
      if (metadata.type) {
        const typeLabels: Record<string, string> = {
          'addon_payment': 'Addon Purchase',
          'wallet_topup': 'Wallet Top-up',
          'hearing_payment': 'Court Hearing',
          'refund': 'Refund',
        };
        return typeLabels[metadata.type] || metadata.type;
      }
    }
    
    // Fallback based on gateway
    if (payment.gateway === 'wallet') {
      return 'Wallet Payment';
    }
    
    return 'Payment';
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            My Transactions & Payments
          </DialogTitle>
          <DialogDescription>
            View your payment history and wallet transaction details
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="payments" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="transactions">Wallet Transactions</TabsTrigger>
          </TabsList>

          <TabsContent value="payments" className="space-y-4">
            <ScrollArea className="h-[500px]">
              {loading ? (
                <div className="text-center py-8">Loading payments...</div>
              ) : payments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No payments found.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment ID</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead>Gateway</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Transaction ID</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => {
                      const metadata = parseMetadata(payment.metadata);
                      const transactionId = payment.gateway_transaction_id || payment.gateway_order_id || payment.id;
                      const purpose = getPaymentPurpose(payment);
                      
                      return (
                        <TableRow key={payment.id}>
                          <TableCell className="font-mono text-xs">
                            {payment.id.substring(0, 8)}...
                          </TableCell>
                          <TableCell className="font-semibold">
                            ₹{(typeof payment.amount === 'string' ? parseFloat(payment.amount) : payment.amount).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-normal">
                              {purpose}
                            </Badge>
                          </TableCell>
                          <TableCell>{getGatewayBadge(payment.gateway)}</TableCell>
                          <TableCell>{getStatusBadge(payment.status)}</TableCell>
                          <TableCell className="font-mono text-xs">
                            <div className="flex items-center gap-2">
                              {transactionId.substring(0, 12)}...
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => copyToClipboard(transactionId)}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(payment.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedPayment(payment)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="transactions" className="space-y-4">
            <ScrollArea className="h-[500px]">
              {transactions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No wallet transactions found.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction ID</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Balance Before</TableHead>
                      <TableHead>Balance After</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((transaction) => {
                      const amountNum = typeof transaction.amount === 'string' ? parseFloat(transaction.amount) : transaction.amount;
                      const balanceBeforeNum = typeof transaction.balance_before === 'string' ? parseFloat(transaction.balance_before) : transaction.balance_before;
                      const balanceAfterNum = typeof transaction.balance_after === 'string' ? parseFloat(transaction.balance_after) : transaction.balance_after;
                      const isPositive = amountNum > 0;
                      
                      return (
                        <TableRow key={transaction.id}>
                          <TableCell className="font-mono text-xs">
                            <div className="flex items-center gap-2">
                              {transaction.id.substring(0, 8)}...
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => copyToClipboard(transaction.id)}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>{getTypeBadge(transaction.transaction_type)}</TableCell>
                          <TableCell className={isPositive ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                            {isPositive ? '+' : ''}₹{amountNum.toFixed(2)}
                          </TableCell>
                          <TableCell>₹{balanceBeforeNum.toFixed(2)}</TableCell>
                          <TableCell>₹{balanceAfterNum.toFixed(2)}</TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {transaction.description || 'N/A'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(transaction.created_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>

      {/* Payment Detail Modal */}
      {selectedPayment && (
        <Dialog open={!!selectedPayment} onOpenChange={() => setSelectedPayment(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Payment Details</DialogTitle>
              <DialogDescription>Complete payment information</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Payment ID</p>
                  <p className="font-mono text-sm font-semibold">{selectedPayment.id}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Amount</p>
                  <p className="font-semibold text-lg">₹{(typeof selectedPayment.amount === 'string' ? parseFloat(selectedPayment.amount) : selectedPayment.amount).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Purpose</p>
                  <div>
                    <Badge variant="outline" className="font-normal">
                      {getPaymentPurpose(selectedPayment)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Gateway</p>
                  <div>{getGatewayBadge(selectedPayment.gateway)}</div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <div>{getStatusBadge(selectedPayment.status)}</div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Transaction ID</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm">
                      {selectedPayment.gateway_transaction_id || selectedPayment.gateway_order_id || selectedPayment.id}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => copyToClipboard(
                        selectedPayment.gateway_transaction_id || selectedPayment.gateway_order_id || selectedPayment.id
                      )}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Order ID</p>
                  <p className="font-mono text-sm">
                    {selectedPayment.gateway_order_id || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created At</p>
                  <p className="text-sm">
                    {new Date(selectedPayment.created_at).toLocaleString()}
                  </p>
                </div>
                {selectedPayment.completed_at && (
                  <div>
                    <p className="text-sm text-muted-foreground">Completed At</p>
                    <p className="text-sm">
                      {new Date(selectedPayment.completed_at).toLocaleString()}
                    </p>
                  </div>
                )}
                {selectedPayment.failure_reason && (
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">Failure Reason</p>
                    <p className="text-sm text-red-600">{selectedPayment.failure_reason}</p>
                  </div>
                )}
                {selectedPayment.metadata && (
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">Metadata</p>
                    <pre className="text-xs bg-muted p-2 rounded overflow-auto">
                      {JSON.stringify(parseMetadata(selectedPayment.metadata), null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
};
