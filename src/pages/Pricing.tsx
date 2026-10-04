import { getApiUrl } from '@/utils/apiUrl';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { 
  Check, 
  X, 
  Wallet, 
  CreditCard, 
  IndianRupee,
  Sparkles,
  FileText,
  Video,
  FileCheck,
  Zap,
  ArrowRight
} from 'lucide-react';
import logo from '@/assets/logo.png';

interface Addon {
  id: string;
  code: string;
  name: string;
  description: string;
  price: number;
  features: string[];
}

const Pricing = () => {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [addons, setAddons] = useState<Addon[]>([]);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAddons();
    if (isAuthenticated && user) {
      fetchWalletBalance();
    }
  }, [isAuthenticated, user]);

  const fetchAddons = async () => {
    try {
      const API_URL = getApiUrl(true);
      const response = await fetch(`${API_URL}/addons?status=active`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch addons' }));
        throw new Error(errorData.error || 'Failed to fetch addons');
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      const formattedAddons = (data || []).map((addon: any) => {
        let features = [];
        if (addon.features) {
          if (typeof addon.features === 'string') {
            try {
              const parsed = JSON.parse(addon.features);
              features = parsed?.features || parsed || [];
            } catch {
              features = [];
            }
          } else if (Array.isArray(addon.features)) {
            features = addon.features;
          } else if (addon.features.features) {
            features = addon.features.features;
          }
        }
        
        return {
          id: addon.id,
          code: addon.code,
          name: addon.name,
          description: addon.description,
          price: parseFloat(addon.price) || 0,
          features: features
        };
      }).sort((a, b) => a.price - b.price);
      
      setAddons(formattedAddons);
    } catch (error: any) {
      console.error('Error fetching addons:', error);
      toast({
        title: 'Error',
        description: 'Failed to load add-ons.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchWalletBalance = async () => {
    if (!user?.id) return;
    
    try {
      const API_URL = getApiUrl(true);
      const session = localStorage.getItem('auth_session');
      const token = session ? JSON.parse(session).access_token : null;
      
      const response = await fetch(`${API_URL}/wallet/balance`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch wallet balance');
      }
      
      const data = await response.json();
      setWalletBalance(data.balance || 0);
    } catch (error: any) {
      console.error('Error fetching wallet balance:', error);
    }
  };

  const handleTopUp = () => {
    if (!isAuthenticated) {
      toast({
        title: 'Login Required',
        description: 'Please login to add money to your wallet.',
      });
      navigate('/auth');
      return;
    }
    navigate('/dashboard?action=topup');
  };

  const pricingStructure = {
    caseFiling: {
      price: 0,
      label: 'FREE',
      description: 'File your case at no cost'
    },
    courtHearing: {
      price: 1200,
      description: 'Court hearing fee (required for all hearings)'
    },
    aiLawyer: {
      price: 500,
      description: 'AI Lawyer assistance (optional, immediate payment)'
    },
    actualLawyer: {
      price: null,
      description: 'Actual Lawyer (variable fees, consultation required)'
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b-2 border-foreground bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
                ← Back
              </Button>
              <img src={logo} alt="eNyayaSetu" className="w-10 h-10" />
              <div>
                <h1 className="font-bangers text-2xl text-primary">Pricing</h1>
                <p className="text-xs text-muted-foreground">Transparent & Affordable Legal Services</p>
              </div>
            </div>
            {isAuthenticated && (
              <div className="flex items-center gap-4">
                <Badge variant="outline" className="px-3 py-1">
                  <Wallet className="w-4 h-4 mr-1" />
                  Balance: ₹{walletBalance.toFixed(2)}
                </Badge>
                <Button onClick={handleTopUp} size="sm">
                  Top Up Wallet
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Main Pricing Structure */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {/* Case Filing - FREE */}
          <Card className="border-2 border-foreground shadow-[4px_4px_0_hsl(var(--foreground))]">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-2xl heading-clear">Case Filing</CardTitle>
                <Badge className="bg-green-500 text-white px-3 py-1 text-lg">
                  FREE
                </Badge>
              </div>
              <CardDescription>
                File your legal case without any charges
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500" />
                  <span>AI-powered case intake</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500" />
                  <span>Document upload & OCR</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500" />
                  <span>Identity verification</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500" />
                  <span>Case registration</span>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full" 
                onClick={() => navigate('/')}
                size="lg"
              >
                File Your Case Now
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardFooter>
          </Card>

          {/* Court Hearing Fee - Required */}
          <Card className="border-2 border-primary shadow-[4px_4px_0_hsl(var(--primary))]">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-2xl heading-clear">Court Hearing Fee</CardTitle>
                <Badge className="bg-primary text-primary-foreground px-3 py-1 text-lg">
                  ₹{pricingStructure.courtHearing.price}
                </Badge>
              </div>
              <CardDescription>
                Required for all court hearings (per session)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="bg-muted/50 p-4 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Court Hearing Fee</span>
                    <span className="text-primary font-bold text-xl">₹{pricingStructure.courtHearing.price}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Pay from wallet or payment gateway
                  </p>
                </div>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-primary" />
                    <span>Virtual court session access</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-primary" />
                    <span>Real-time transcription</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-primary" />
                    <span>Evidence presentation</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-primary" />
                    <span>Full day access</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Lawyer Options */}
        <div className="mb-12">
          <div className="text-center mb-6">
            <h2 className="font-bangers text-3xl text-primary mb-2">Choose Your Lawyer</h2>
            <p className="text-muted-foreground">
              Select one option (only one can be selected)
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {/* AI Lawyer Option */}
            <Card className="border-2 border-foreground hover:border-primary transition-colors">
              <CardHeader>
                <div className="flex items-start justify-between mb-2">
                  <CardTitle className="text-xl heading-clear">AI Lawyer</CardTitle>
                  <Badge variant="secondary" className="text-lg">
                    ₹{pricingStructure.aiLawyer.price}
                  </Badge>
                </div>
                <CardDescription>{pricingStructure.aiLawyer.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    <span>Immediate availability</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    <span>AI-powered legal assistance</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    <span>24/7 availability</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    <span>Pay immediately</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Actual Lawyer Option */}
            <Card className="border-2 border-foreground hover:border-primary transition-colors">
              <CardHeader>
                <div className="flex items-start justify-between mb-2">
                  <CardTitle className="text-xl heading-clear">Actual Lawyer</CardTitle>
                  <Badge variant="outline" className="text-lg">
                    Variable
                  </Badge>
                </div>
                <CardDescription>{pricingStructure.actualLawyer.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    <span>Human lawyer consultation</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    <span>Team will call you with quote</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    <span>Personalized legal advice</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    <span>Payment after consultation</span>
                  </div>
                  <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                    <p className="text-sm text-blue-900 dark:text-blue-100">
                      📞 Our team will contact you within few hours with pricing details
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Total Cost Summary */}
        <Card className="border-2 border-foreground mb-12">
          <CardHeader>
            <CardTitle className="heading-clear">Pricing Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>Case Filing</span>
                <span className="font-bold text-green-600">FREE</span>
              </div>
              <div className="flex justify-between">
                <span>Court Hearing Fee (Required)</span>
                <span className="font-bold">₹1,200</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>+ AI Lawyer (Optional)</span>
                <span>₹500</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>+ Actual Lawyer (Optional)</span>
                <span>Variable (consultation required)</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Minimum Cost (Court Hearing Only)</span>
                <span>₹1,200</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-primary">
                <span>With AI Lawyer</span>
                <span>₹1,700</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Add-ons Section */}
        <div className="mb-8">
          <div className="text-center mb-6">
            <h2 className="text-3xl text-primary mb-2 heading-clear">Add-ons & Extras</h2>
            <p className="text-muted-foreground">
              Enhance your legal experience with these optional add-ons
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              <Badge variant="outline">Note: Maximum 1 add-on allowed per hearing</Badge>
            </p>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {addons.map((addon) => (
                <Card 
                  key={addon.id} 
                  className="border-2 border-foreground hover:border-primary transition-colors"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between mb-2">
                      <CardTitle className="text-xl">{addon.name}</CardTitle>
                      <Badge variant="secondary" className="text-lg">
                        ₹{addon.price}
                      </Badge>
                    </div>
                    <CardDescription>{addon.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {addon.features && addon.features.length > 0 && (
                      <ul className="space-y-2">
                        {addon.features.map((feature: string, idx: number) => (
                          <li key={idx} className="flex items-start gap-2 text-sm">
                            <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Payment Methods */}
        <Card className="border-2 border-foreground mt-12">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 heading-clear">
              <CreditCard className="w-5 h-5" />
              Payment Methods
            </CardTitle>
            <CardDescription>
              Secure payment options for your convenience
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2 heading-clear">
                  <Wallet className="w-4 h-4" />
                  Wallet
                </h3>
                <p className="text-sm text-muted-foreground">
                  Pre-load money into your wallet and use it for seamless payments. Top up anytime!
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2 heading-clear">
                  <CreditCard className="w-4 h-4" />
                  Payment Gateways
                </h3>
                <p className="text-sm text-muted-foreground">
                  Pay directly via Razorpay or PhonePe for instant processing.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* FAQ Section */}
        <Card className="border-2 border-foreground mt-6">
          <CardHeader>
            <CardTitle className="heading-clear">Frequently Asked Questions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-1 heading-clear">Is case filing really free?</h3>
              <p className="text-sm text-muted-foreground">
                Yes! Filing a case is completely free. You only pay for court hearings and optional add-ons.
              </p>
            </div>
            <Separator />
            <div>
              <h3 className="font-semibold mb-1 heading-clear">How does the wallet work?</h3>
              <p className="text-sm text-muted-foreground">
                You can pre-load money into your wallet and use it to pay for hearings and add-ons. 
                Wallet balance never expires and can be topped up anytime.
              </p>
            </div>
            <Separator />
            <div>
              <h3 className="font-semibold mb-1 heading-clear">Can I use multiple add-ons?</h3>
              <p className="text-sm text-muted-foreground">
                Currently, only 1 add-on can be selected per hearing session. Choose the add-on that best suits your needs.
              </p>
            </div>
            <Separator />
            <div>
              <h3 className="font-semibold mb-1 heading-clear">What payment methods are accepted?</h3>
              <p className="text-sm text-muted-foreground">
                We accept payments via Razorpay and PhonePe. You can also use wallet balance for instant payments.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Pricing;

