import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth, Session, TwoFactorChallenge } from '@/hooks/useAuth';
import { AuthenticatorModal } from '@/components/AuthenticatorModal';
import { ArrowLeft, LogIn, UserPlus, Scale, Users, User, ShieldCheck, Gavel } from 'lucide-react';
import logo from '@/assets/logo.png';
import { z } from 'zod';
import { HUMAN_CONTROLLED_ROLES, ROLE_LABELS, CourtPartyRole } from '@/types/court';

const authSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  displayName: z.string().optional(),
});

// Dummy credentials for each role
const DUMMY_USERS: Record<CourtPartyRole, { email: string; password: string; name: string }> = {
  audience: { email: 'audience@test.com', password: 'Audience@123', name: 'Court Audience' },
  accused: { email: 'accused@test.com', password: 'Accused@123', name: 'Accused Person' },
  victim: { email: 'victim@test.com', password: 'Victim@123', name: 'Victim Person' },
  victim_family: { email: 'victim_family@test.com', password: 'VictimFamily@123', name: 'Victim Family Member' },
  accused_family: { email: 'accused_family@test.com', password: 'AccusedFamily@123', name: 'Accused Family Member' },
  police_staff: { email: 'police@test.com', password: 'Police@123', name: 'Police Officer' },
  // AI roles (not selectable but included for completeness)
  judge: { email: 'judge@test.com', password: 'Judge@123', name: 'Judge Sharma' },
  steno: { email: 'steno@test.com', password: 'Steno@123', name: 'Court Stenographer' },
  public_prosecutor: { email: 'prosecutor@test.com', password: 'Prosecutor@123', name: 'Public Prosecutor Singh' },
  defence_lawyer: { email: 'defence@test.com', password: 'Defence@123', name: 'Defence Lawyer Verma' },
  pp_assistant: { email: 'pp_assistant@test.com', password: 'PPAssistant@123', name: 'PP Assistant' },
  defence_assistant: { email: 'defence_assistant@test.com', password: 'DefenceAssistant@123', name: 'Defence Assistant' },
};

// Superadmin credentials
const SUPERADMIN = { email: 'admin@test.com', password: 'Admin@123', name: 'Super Admin' };

const ROLE_ICONS: Partial<Record<CourtPartyRole, React.ReactNode>> = {
  audience: <Users className="w-4 h-4" />,
  accused: <User className="w-4 h-4" />,
  victim: <User className="w-4 h-4" />,
  victim_family: <Users className="w-4 h-4" />,
  accused_family: <Users className="w-4 h-4" />,
  police_staff: <ShieldCheck className="w-4 h-4" />,
};

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [autoLoginRole, setAutoLoginRole] = useState<CourtPartyRole | null>(null);
  // Set only when an admin account signs in: the authenticator dialog opens
  // and the session is created after the code is verified.
  const [twoFactor, setTwoFactor] = useState<(TwoFactorChallenge & { redirectTo: string }) | null>(null);
  
  const { signIn, signUp, isAuthenticated, completeTwoFactor } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  // Auto-login effect
  useEffect(() => {
    if (autoLoginRole && email && password) {
      handleSubmit(new Event('submit') as any);
    }
  }, [autoLoginRole, email, password]);

  const validateForm = () => {
    try {
      authSchema.parse({ email, password, displayName: isLogin ? undefined : displayName });
      setErrors({});
      return true;
    } catch (err) {
      if (err instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        err.errors.forEach((e) => {
          if (e.path[0]) {
            fieldErrors[e.path[0] as string] = e.message;
          }
        });
        setErrors(fieldErrors);
      }
      return false;
    }
  };

  const handleQuickLogin = async (role: CourtPartyRole) => {
    const dummyUser = DUMMY_USERS[role];
    setEmail(dummyUser.email);
    setPassword(dummyUser.password);
    setDisplayName(dummyUser.name);
    setIsLogin(true);
    setAutoLoginRole(role);
    
    // Try to login, if fails, create account first
    setIsSubmitting(true);
    
    try {
      const { error: loginError, twoFactor: challenge } = await signIn(dummyUser.email, dummyUser.password);

      if (challenge) {
        setTwoFactor({ ...challenge, redirectTo: '/' });
        return;
      }
      
      if (loginError) {
        // User doesn't exist, create account
        toast({
          title: 'Creating Test Account',
          description: `Setting up ${ROLE_LABELS[role].en} account...`,
        });
        
        const { error: signUpError } = await signUp(dummyUser.email, dummyUser.password, dummyUser.name);
        
        if (signUpError && !signUpError.message.includes('already registered')) {
          throw signUpError;
        }
        
        // Now login
        const { error: retryError } = await signIn(dummyUser.email, dummyUser.password);
        if (retryError) throw retryError;
      }
      
      toast({
        title: `Welcome, ${dummyUser.name}!`,
        description: `Logged in as ${ROLE_LABELS[role].en}`,
      });
      navigate('/');
      
    } catch (err: any) {
      toast({
        title: 'Login Failed',
        description: err.message || 'Could not login with test account.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
      setAutoLoginRole(null);
    }
  };

  const handleSuperAdminLogin = async () => {
    setIsSubmitting(true);
    try {
      const { error: loginError, twoFactor: challenge } = await signIn(SUPERADMIN.email, SUPERADMIN.password);

      if (challenge) {
        // Password accepted - the authenticator code is asked next
        setTwoFactor({ ...challenge, redirectTo: '/admin' });
        return;
      }
      
      if (loginError) {
        toast({
          title: 'Creating Admin Account',
          description: 'Setting up Super Admin...',
        });
        
        const { error: signUpError } = await signUp(SUPERADMIN.email, SUPERADMIN.password, SUPERADMIN.name);
        if (signUpError && !signUpError.message.includes('already registered')) {
          throw signUpError;
        }
        
        const { error: retryError } = await signIn(SUPERADMIN.email, SUPERADMIN.password);
        if (retryError) throw retryError;
      }
      
      toast({
        title: 'Welcome, Super Admin!',
        description: 'Redirecting to admin dashboard...',
      });
      navigate('/admin');
      
    } catch (err: any) {
      toast({
        title: 'Login Failed',
        description: err.message || 'Could not login as admin.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTwoFactorVerified = (session: Session) => {
    const redirectTo = twoFactor?.redirectTo || '/';
    completeTwoFactor(session);
    setTwoFactor(null);
    toast({
      title: 'Welcome, Admin!',
      description: 'Authenticator verified.',
    });
    navigate(redirectTo);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setIsSubmitting(true);

    try {
      if (isLogin) {
        const { error, twoFactor: challenge } = await signIn(email, password);
        if (challenge) {
          // Admin account: ask for the authenticator code before signing in
          setTwoFactor({ ...challenge, redirectTo: '/admin' });
          return;
        }
        if (error) {
          const errorMsg = error?.message || 'Login failed';
          if (errorMsg.includes('Invalid') || errorMsg.includes('email') || errorMsg.includes('password')) {
            toast({
              title: 'Login Failed',
              description: 'Invalid email or password. Please try again.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Login Failed',
              description: errorMsg,
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: 'Welcome Back!',
            description: 'You have successfully logged in.',
          });
          navigate('/');
        }
      } else {
        const { error } = await signUp(email, password, displayName);
        if (error) {
          if (error.message && error.message.includes('already registered')) {
            toast({
              title: 'Registration Failed',
              description: 'This email is already registered. Please login instead.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Registration Failed',
              description: error?.message || 'Failed to create account. Please try again.',
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: 'Account Created!',
            description: 'You can now login to your account.',
          });
          navigate('/');
        }
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-card to-background flex flex-col items-center justify-center px-4 py-8">
      {/* Back button */}
      <Button
        variant="ghost"
        className="absolute top-4 left-4"
        onClick={() => navigate('/')}
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back
      </Button>

      {/* Logo and branding */}
      <div className="text-center mb-6">
        <img src={logo} alt="eNyayaSetu" className="w-20 h-20 mx-auto mb-3" />
        <h1 className="font-bangers text-3xl text-foreground">
          <span className="text-primary">eNyaya</span>
          <span className="text-secondary">Setu</span>
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Digital Bridge of Justice</p>
      </div>

      {/* Quick Login Section */}
      <div className="w-full max-w-md mb-6">
        <div className="bg-muted/50 border-2 border-dashed border-muted-foreground/30 rounded-xl p-4">
          <h3 className="text-sm font-bold text-center mb-3 flex items-center justify-center gap-2">
            <Gavel className="w-4 h-4 text-primary" />
            Quick Login as Test User
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {HUMAN_CONTROLLED_ROLES.map((role) => (
              <Button
                key={role}
                variant="outline"
                size="sm"
                onClick={() => handleQuickLogin(role)}
                disabled={isSubmitting}
                className="justify-start text-xs h-auto py-2"
              >
                {ROLE_ICONS[role]}
                <span className="ml-1 truncate">{ROLE_LABELS[role].en}</span>
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-3">
            Click any role to auto-login with test credentials
          </p>
        </div>

        {/* Superadmin Login */}
        <div className="mt-3 bg-primary/10 border-2 border-primary/30 rounded-xl p-4">
          <h3 className="text-sm font-bold text-center mb-3 flex items-center justify-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Administrator Access
          </h3>
          <Button
            variant="default"
            size="sm"
            onClick={handleSuperAdminLogin}
            disabled={isSubmitting}
            className="w-full"
          >
            <ShieldCheck className="w-4 h-4 mr-2" />
            Login as Super Admin
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Access dashboard, cases, logs & usage stats
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="w-full max-w-md flex items-center gap-4 mb-6">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">OR</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Auth form */}
      <div className="w-full max-w-md">
        <div className="bg-card border-2 border-foreground rounded-xl p-6 shadow-[4px_4px_0_hsl(var(--foreground))]">
          <div className="flex items-center justify-center gap-2 mb-6">
            <Scale className="w-5 h-5 text-primary" />
            <h2 className="font-bangers text-xl text-foreground">
              {isLogin ? 'Login to Continue' : 'Create Account'}
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input
                  id="displayName"
                  type="text"
                  placeholder="Your name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="border-2 border-foreground"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`border-2 ${errors.email ? 'border-destructive' : 'border-foreground'}`}
                required
              />
              {errors.email && (
                <p className="text-destructive text-sm">{errors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`border-2 ${errors.password ? 'border-destructive' : 'border-foreground'}`}
                required
              />
              {errors.password && (
                <p className="text-destructive text-sm">{errors.password}</p>
              )}
            </div>

            <Button
              type="submit"
              variant="comic"
              size="lg"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                'Processing...'
              ) : isLogin ? (
                <>
                  <LogIn className="w-4 h-4 mr-2" />
                  Login
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Sign Up
                </>
              )}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setErrors({});
              }}
              className="text-primary hover:underline text-sm font-medium"
            >
              {isLogin
                ? "Don't have an account? Sign up"
                : 'Already have an account? Login'}
            </button>
          </div>
        </div>
      </div>

      {/* Authenticator code - admin accounts only */}
      <AuthenticatorModal
        open={!!twoFactor}
        challengeToken={twoFactor?.challengeToken || ''}
        setupRequired={twoFactor?.setupRequired || false}
        onVerified={handleTwoFactorVerified}
        onCancel={() => setTwoFactor(null)}
      />
    </div>
  );
};

export default Auth;
