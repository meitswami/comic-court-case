import { getApiUrl } from '@/utils/apiUrl';
import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { 
  BookOpen, 
  IndianRupee, 
  CheckCircle2, 
  Circle, 
  ArrowRight, 
  FileText, 
  AlertCircle,
  CheckCircle,
  MessageCircle,
  Mic,
  Volume2
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage, Language } from '@/contexts/LanguageContext';
import { AddonPurchaseModal } from './AddonPurchaseModal';
import { LanguageModal } from './LanguageModal';
import { RTIChatAgent } from './RTIChatAgent';
import { WalletBalance } from './WalletBalance';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Languages } from 'lucide-react';

const API_URL = getApiUrl();

interface TutorialSection {
  id: string;
  title: string;
  content: string;
  keyPoints?: string[];
  steps?: Array<{
    step: number;
    title: string;
    description: string;
  }>;
}

interface TutorialContent {
  sections: TutorialSection[];
  progress: string[];
}

export const RTITutorial: React.FC = () => {
  const { language, setLanguage, t } = useLanguage();
  const [tutorial, setTutorial] = useState<TutorialContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [showApplication, setShowApplication] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showChatAgent, setShowChatAgent] = useState(false);
  const [languageSelected, setLanguageSelected] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const [formData, setFormData] = useState({
    public_authority: '',
    subject: '',
    information_requested: '',
    applicant_name: '',
    applicant_address: '',
    applicant_phone: '',
    applicant_email: '',
    applicant_pincode: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  // Show language modal on mount if not selected
  useEffect(() => {
    const savedLanguageSelected = localStorage.getItem('rti-language-selected');
    if (!savedLanguageSelected && !showLanguageModal) {
      setShowLanguageModal(true);
    } else {
      setLanguageSelected(true);
    }
  }, []);

  // Load tutorial when language is selected
  useEffect(() => {
    const savedLanguageSelected = localStorage.getItem('rti-language-selected');
    if (savedLanguageSelected && !tutorial && !loading) {
      loadTutorial();
    }
  }, [languageSelected, tutorial, loading]);

  // Reload tutorial when language changes (but not on initial mount)
  const prevLanguageRef = useRef(language);
  useEffect(() => {
    if (prevLanguageRef.current !== language && languageSelected && tutorial && !loading) {
      prevLanguageRef.current = language;
      loadTutorial();
    } else {
      prevLanguageRef.current = language;
    }
  }, [language]);

  const loadTutorial = async () => {
    setLoading(true);
    try {
      // Get access token from auth_session
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

      // Include language in query parameter
      const languageParam = language || 'en';
      const response = await fetch(`${API_URL}/api/rti/tutorial?language=${languageParam}`, {
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
      });

      if (response.ok) {
        const data = await response.json();
        setTutorial(data);
        // Set active section to first incomplete section
        const firstIncomplete = data.sections.findIndex(
          (s: TutorialSection) => !data.progress.includes(s.id)
        );
        if (firstIncomplete >= 0) {
          setActiveSection(firstIncomplete);
        }
      } else if (response.status === 402) {
        // Payment required - show checkout modal
        setShowCheckout(true);
        toast({
          title: 'Payment Required',
          description: 'Access to RTI Tutorial requires ₹50. Please purchase to continue.',
        });
      } else if (response.status === 401) {
        // Authentication required
        toast({
          title: 'Authentication Required',
          description: 'Please log in to access the RTI Tutorial.',
          variant: 'destructive',
        });
      } else {
        // Try to get error message from response
        let errorMessage = 'Failed to load tutorial';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('RTI Tutorial load error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Could not load tutorial',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const markSectionComplete = async (sectionId: string) => {
    try {
      // Get access token from auth_session
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

      const response = await fetch(`${API_URL}/api/rti/tutorial/complete`, {
        method: 'POST',
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ section: sectionId }),
      });

      if (response.ok) {
        // Update local progress
        if (tutorial && !tutorial.progress.includes(sectionId)) {
          setTutorial({
            ...tutorial,
            progress: [...tutorial.progress, sectionId],
          });
        }
      }
    } catch (error) {
      console.error('Error marking section complete:', error);
    }
  };

  const handleSectionComplete = (sectionId: string) => {
    markSectionComplete(sectionId);
    if (activeSection < (tutorial?.sections.length || 0) - 1) {
      setActiveSection(activeSection + 1);
    }
  };

  const handleSubmitApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      // Get access token from auth_session
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

      const response = await fetch(`${API_URL}/api/rti/application`, {
        method: 'POST',
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        const data = await response.json();
        toast({
          title: 'Application Created',
          description: `Your RTI application ${data.application_number} has been created successfully!`,
        });
        setShowApplication(false);
        // Reset form
        setFormData({
          public_authority: '',
          subject: '',
          information_requested: '',
          applicant_name: '',
          applicant_address: '',
          applicant_phone: '',
          applicant_email: '',
          applicant_pincode: '',
        });
      } else {
        throw new Error('Failed to create application');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Could not create application',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>RTI Tutorial</CardTitle>
          <CardDescription>Loading tutorial content...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!tutorial) {
    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle>RTI Tutorial</CardTitle>
            <CardDescription>Complete guided tutorial on Right to Information Act</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t('rti.tutorial.paymentRequired')}
              </AlertDescription>
            </Alert>
            <Button onClick={() => setShowCheckout(true)} className="w-full mt-4">
              <IndianRupee className="w-4 h-4 mr-2" />
              Purchase Access (₹50)
            </Button>
          </CardContent>
        </Card>
        {showCheckout && (
          <AddonPurchaseModal
            open={showCheckout}
            addonSlug="rti-tutorial"
            addonName="RTI Tutorial"
            addonPrice={50}
            onClose={() => setShowCheckout(false)}
            onSuccess={() => {
              setShowCheckout(false);
              loadTutorial();
            }}
          />
        )}
      </>
    );
  }

  const currentSection = tutorial.sections[activeSection];
  const progressPercentage = (tutorial.progress.length / tutorial.sections.length) * 100;

  return (
    <>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-blue-600" />
                  {t('rti.tutorial.title')}
                </CardTitle>
                <CardDescription>{t('rti.tutorial.subtitle')}</CardDescription>
              </div>
              <div className="flex items-center gap-3">
                {/* Language Selector */}
                <Select value={language} onValueChange={(val) => {
                  setLanguage(val as Language);
                  // Reload tutorial with new language
                  if (tutorial) {
                    loadTutorial();
                  }
                }}>
                  <SelectTrigger className="w-[140px] border-2">
                    <Languages className="w-4 h-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">
                      <span className="flex items-center gap-2">
                        <span>🇬🇧</span>
                        <span>English</span>
                      </span>
                    </SelectItem>
                    <SelectItem value="hi">
                      <span className="flex items-center gap-2">
                        <span>🇮🇳</span>
                        <span>हिंदी</span>
                      </span>
                    </SelectItem>
                    <SelectItem value="hinglish">
                      <span className="flex items-center gap-2">
                        <span>🌐</span>
                        <span>Hinglish</span>
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                
                {/* Wallet Balance */}
                <WalletBalance />
                
                {/* Price Badge */}
                <Badge className="bg-green-100 text-green-800">
                  <IndianRupee className="w-3 h-3 mr-1" />
                  50
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Progress */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{t('rti.tutorial.progress')}</span>
                <span className="text-sm text-muted-foreground">
                  {tutorial.progress.length} / {tutorial.sections.length} {t('rti.tutorial.sections')}
                </span>
              </div>
              <Progress value={progressPercentage} className="h-2" />
            </div>

            {/* Section Navigation */}
            <div className="flex flex-wrap gap-2 mb-6">
              {tutorial.sections.map((section, index) => (
                <Button
                  key={section.id}
                  variant={index === activeSection ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveSection(index)}
                  className="flex items-center gap-2"
                >
                  {tutorial.progress.includes(section.id) ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    <Circle className="w-4 h-4" />
                  )}
                  {index + 1}
                </Button>
              ))}
            </div>

            {/* Current Section Content */}
            {currentSection && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold mb-2">{currentSection.title}</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowChatAgent(true)}
                    className="flex items-center gap-2"
                  >
                    <MessageCircle className="w-4 h-4" />
                    {t('rti.tutorial.askAssistant')}
                  </Button>
                </div>
                <p className="text-muted-foreground whitespace-pre-line">{currentSection.content}</p>

                {currentSection.keyPoints && (
                  <div>
                    <h4 className="font-semibold mb-2">{t('rti.tutorial.keyPoints')}</h4>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      {currentSection.keyPoints.map((point, idx) => (
                        <li key={idx}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {currentSection.steps && (
                  <div>
                    <h4 className="font-semibold mb-2">{t('rti.tutorial.steps')}</h4>
                    <div className="space-y-3">
                      {currentSection.steps.map((step) => (
                        <div key={step.step} className="flex gap-3">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                            {step.step}
                          </div>
                          <div>
                            <h5 className="font-medium">{step.title}</h5>
                            <p className="text-sm text-muted-foreground">{step.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-4">
                  {activeSection > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => setActiveSection(activeSection - 1)}
                    >
                      {t('rti.tutorial.previous')}
                    </Button>
                  )}
                  <Button
                    onClick={() => handleSectionComplete(currentSection.id)}
                    disabled={tutorial.progress.includes(currentSection.id)}
                    className="flex-1"
                  >
                    {tutorial.progress.includes(currentSection.id) ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        {t('rti.tutorial.completed')}
                      </>
                    ) : (
                      <>
                        {t('rti.tutorial.markComplete')}
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                  {activeSection < tutorial.sections.length - 1 && (
                    <Button
                      variant="outline"
                      onClick={() => setActiveSection(activeSection + 1)}
                    >
                      {t('rti.tutorial.next')}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Apply for RTI Button */}
            {progressPercentage === 100 && (
              <div className="mt-6 pt-6 border-t">
                <Button
                  onClick={() => setShowApplication(true)}
                  className="w-full"
                  size="lg"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Apply for RTI Now
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* RTI Application Form */}
        {showApplication && (
          <Card>
            <CardHeader>
              <CardTitle>RTI Application Form</CardTitle>
              <CardDescription>Fill out the form to apply for Right to Information</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmitApplication} className="space-y-4">
                <div>
                  <Label htmlFor="public_authority">Public Authority *</Label>
                  <Input
                    id="public_authority"
                    value={formData.public_authority}
                    onChange={(e) => setFormData({ ...formData, public_authority: e.target.value })}
                    placeholder="e.g., Ministry of Home Affairs"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="subject">Subject *</Label>
                  <Input
                    id="subject"
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    placeholder="Brief subject of your RTI application"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="information_requested">Information Requested *</Label>
                  <Textarea
                    id="information_requested"
                    value={formData.information_requested}
                    onChange={(e) => setFormData({ ...formData, information_requested: e.target.value })}
                    placeholder="Describe in detail the information you are seeking..."
                    rows={5}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="applicant_name">Applicant Name *</Label>
                  <Input
                    id="applicant_name"
                    value={formData.applicant_name}
                    onChange={(e) => setFormData({ ...formData, applicant_name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="applicant_address">Address *</Label>
                  <Textarea
                    id="applicant_address"
                    value={formData.applicant_address}
                    onChange={(e) => setFormData({ ...formData, applicant_address: e.target.value })}
                    rows={3}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="applicant_phone">Phone</Label>
                    <Input
                      id="applicant_phone"
                      value={formData.applicant_phone}
                      onChange={(e) => setFormData({ ...formData, applicant_phone: e.target.value })}
                      type="tel"
                    />
                  </div>
                  <div>
                    <Label htmlFor="applicant_email">Email</Label>
                    <Input
                      id="applicant_email"
                      value={formData.applicant_email}
                      onChange={(e) => setFormData({ ...formData, applicant_email: e.target.value })}
                      type="email"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="applicant_pincode">Pincode</Label>
                  <Input
                    id="applicant_pincode"
                    value={formData.applicant_pincode}
                    onChange={(e) => setFormData({ ...formData, applicant_pincode: e.target.value })}
                    maxLength={6}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowApplication(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting} className="flex-1">
                    {submitting ? 'Submitting...' : 'Submit Application'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      {showCheckout && (
        <AddonPurchaseModal
          open={showCheckout}
          addonSlug="rti-tutorial"
          addonName="RTI Tutorial"
          addonPrice={50}
          onClose={() => setShowCheckout(false)}
          onSuccess={() => {
            setShowCheckout(false);
            loadTutorial();
          }}
        />
      )}

      {showLanguageModal && (
        <LanguageModal
          open={showLanguageModal}
          onOpenChange={(open) => {
            setShowLanguageModal(open);
            if (!open) {
              setLanguageSelected(true);
              localStorage.setItem('rti-language-selected', 'true');
            }
          }}
        />
      )}

      {showChatAgent && currentSection && (
        <RTIChatAgent
          open={showChatAgent}
          onClose={() => setShowChatAgent(false)}
          sectionId={currentSection.id}
          sectionContent={currentSection}
        />
      )}
    </>
  );
};
