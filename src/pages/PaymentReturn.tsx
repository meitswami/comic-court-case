import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { confirmCashfreePayment, takeReturnContext, PaymentOutcome } from '@/lib/cashfree';

type View = 'checking' | 'completed' | 'pending' | 'failed' | 'error';

// Cashfree sends the customer here after the payment page. The payment is
// confirmed with the server before we say it succeeded.
const PaymentReturn = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [view, setView] = useState<View>('checking');
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  const [message, setMessage] = useState('');
  const context = useRef(takeReturnContext());
  const started = useRef(false);

  const orderId = params.get('order_id') || undefined;

  const check = async () => {
    setView('checking');
    try {
      const reference = orderId ? { order_id: orderId } : { payment_id: context.current.payment_id };
      if (!reference.order_id && !reference.payment_id) {
        setMessage('We could not tell which payment this page is for.');
        setView('error');
        return;
      }
      const result = await confirmCashfreePayment(reference);
      setOutcome(result);
      if (result.status === 'completed') setView('completed');
      else if (result.status === 'pending' || result.status === 'processing') setView('pending');
      else setView('failed');
    } catch (error: any) {
      setMessage(error.message || 'We could not confirm this payment.');
      setView('error');
    }
  };

  useEffect(() => {
    if (authLoading || started.current) return;
    if (!isAuthenticated) {
      setMessage('Please sign in again to see the result of your payment.');
      setView('error');
      return;
    }
    started.current = true;
    check();
  }, [authLoading, isAuthenticated]);

  const backPath = context.current.path && context.current.path !== '/payment/return'
    ? context.current.path
    : '/dashboard';

  const headline: Record<View, string> = {
    checking: 'Confirming your payment...',
    completed: 'Payment successful',
    pending: 'Payment not confirmed yet',
    failed: 'Payment was not completed',
    error: 'Something went wrong',
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border-2 border-foreground rounded-xl p-8 text-center space-y-5 shadow-[4px_4px_0_hsl(var(--foreground))]">
        <div className="flex justify-center">
          {view === 'checking' && <Loader2 className="w-14 h-14 animate-spin text-primary" />}
          {view === 'completed' && <CheckCircle2 className="w-14 h-14 text-green-600" />}
          {view === 'pending' && <Clock className="w-14 h-14 text-yellow-600" />}
          {(view === 'failed' || view === 'error') && <XCircle className="w-14 h-14 text-destructive" />}
        </div>

        <h1 className="text-2xl font-bold">{headline[view]}</h1>

        {view === 'checking' && (
          <p className="text-muted-foreground">Please keep this page open. This takes a few seconds.</p>
        )}

        {view === 'completed' && outcome && (
          <div className="space-y-2 text-muted-foreground">
            <p>
              ₹{Number(outcome.amount).toFixed(2)} received
              {outcome.invoice_number ? ` - invoice ${outcome.invoice_number}` : ''}.
            </p>
            {outcome.type === 'wallet_topup' && <p>The amount has been added to your wallet.</p>}
            {outcome.type === 'addon_payment' && <p>Your add-on is now unlocked.</p>}
            {outcome.session && (
              <p>
                Your court session is ready. Court code:{' '}
                <span className="font-mono font-bold text-foreground">{outcome.session.court_code}</span>
              </p>
            )}
          </div>
        )}

        {view === 'pending' && (
          <p className="text-muted-foreground">
            Your bank has not confirmed the payment yet. If money was deducted, it will be applied
            automatically once confirmed - you do not need to pay again.
          </p>
        )}

        {view === 'failed' && (
          <p className="text-muted-foreground">
            No money was collected for this order. You can go back and try again.
          </p>
        )}

        {view === 'error' && <p className="text-muted-foreground">{message}</p>}

        <div className="flex flex-col gap-2 pt-2">
          {view === 'completed' && outcome?.session && (
            <Button onClick={() => navigate(`/court/${outcome.session!.id}`)}>Enter Courtroom</Button>
          )}
          {(view === 'pending' || (view === 'error' && isAuthenticated)) && (
            <Button onClick={check}>Check Again</Button>
          )}
          {view === 'error' && !isAuthenticated && (
            <Button onClick={() => navigate('/auth')}>Sign In</Button>
          )}
          {view !== 'checking' && (
            <Button variant="outline" onClick={() => navigate(backPath)}>
              {view === 'completed' ? 'Continue' : 'Go Back'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PaymentReturn;
