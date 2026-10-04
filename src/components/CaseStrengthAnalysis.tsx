import { getApiUrl } from '@/utils/apiUrl';
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TrendingUp, FileText, Lightbulb, IndianRupee, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { CheckoutModal } from './CheckoutModal';

interface CaseStrengthAnalysisProps {
  caseId: string;
  userId: string;
}

interface Analysis {
  strength_percentage: number;
  analysis_data: {
    documentCount: number;
    categories: string[];
    analyzedAt: string;
  };
  analyzed_documents: Array<{
    id: string;
    fileName: string;
    category: string;
    weight: number;
  }>;
}

interface Suggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  impactPercentage: number;
  priority: 'high' | 'medium' | 'low';
  documentCategory?: string;
  estimatedStrengthAfter: number;
}

const API_URL = getApiUrl();

export const CaseStrengthAnalysis: React.FC<CaseStrengthAnalysisProps> = ({ caseId, userId }) => {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedAddon, setSelectedAddon] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadAnalysis();
  }, [caseId]);

  const loadAnalysis = async () => {
    setLoading(true);
    try {
      // Get access token from auth_session
      const authSession = localStorage.getItem('auth_session');
      let token = null;
      if (authSession) {
        try {
          const sessionData = JSON.parse(authSession);
          token = sessionData?.access_token || sessionData?.session?.access_token;
        } catch (e) {
          console.error('Error parsing auth session:', e);
        }
      }

      const response = await fetch(`${API_URL}/api/case-strength/${caseId}`, {
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
      });

      if (response.ok) {
        const data = await response.json();
        setAnalysis(data);
      } else if (response.status === 404) {
        // No analysis yet, trigger one
        await analyzeCase();
      }
    } catch (error) {
      console.error('Error loading analysis:', error);
    } finally {
      setLoading(false);
    }
  };

  const analyzeCase = async () => {
    setLoading(true);
    try {
      // Get access token from auth_session
      const authSession = localStorage.getItem('auth_session');
      let token = null;
      if (authSession) {
        try {
          const sessionData = JSON.parse(authSession);
          token = sessionData?.access_token || sessionData?.session?.access_token;
        } catch (e) {
          console.error('Error parsing auth session:', e);
        }
      }

      const response = await fetch(`${API_URL}/api/case-strength/analyze/${caseId}`, {
        method: 'POST',
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
      });

      if (response.ok) {
        const data = await response.json();
        setAnalysis(data);
        toast({
          title: 'Analysis Complete',
          description: `Your case strength is ${data.strength_percentage}%`,
        });
      } else {
        throw new Error('Failed to analyze case');
      }
    } catch (error) {
      toast({
        title: 'Analysis Failed',
        description: error instanceof Error ? error.message : 'Could not analyze case',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSuggestions = async () => {
    setSuggestionsLoading(true);
    try {
      // Get access token from auth_session
      const authSession = localStorage.getItem('auth_session');
      let token = null;
      if (authSession) {
        try {
          const sessionData = JSON.parse(authSession);
          token = sessionData?.access_token || sessionData?.session?.access_token;
        } catch (e) {
          console.error('Error parsing auth session:', e);
        }
      }

      const response = await fetch(`${API_URL}/api/case-strength/suggestions/${caseId}`, {
        method: 'POST',
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
      });

      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.suggestions || []);
      } else if (response.status === 402) {
        // Payment required
        const data = await response.json();
        setSelectedAddon(data.addon_slug);
        setShowCheckout(true);
        toast({
          title: 'Payment Required',
          description: data.message,
        });
      } else {
        throw new Error('Failed to load suggestions');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Could not load suggestions',
        variant: 'destructive',
      });
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const getStrengthColor = (percentage: number) => {
    if (percentage >= 75) return 'text-green-600';
    if (percentage >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getPriorityColor = (priority: string) => {
    if (priority === 'high') return 'bg-red-100 text-red-800';
    if (priority === 'medium') return 'bg-yellow-100 text-yellow-800';
    return 'bg-blue-100 text-blue-800';
  };

  if (loading && !analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Case Strength Analysis</CardTitle>
          <CardDescription>Analyzing your case documents...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Case Strength Analysis</CardTitle>
          <CardDescription>Get an AI-powered analysis of your case strength based on uploaded documents</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={analyzeCase} className="w-full">
            <TrendingUp className="w-4 h-4 mr-2" />
            Analyze Case Strength
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Case Strength Analysis
          </CardTitle>
          <CardDescription>Based on {analysis.analysis_data.documentCount} document(s) analyzed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Strength Percentage */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Case Strength</span>
              <span className={`text-2xl font-bold ${getStrengthColor(analysis.strength_percentage)}`}>
                {analysis.strength_percentage}%
              </span>
            </div>
            <Progress value={analysis.strength_percentage} className="h-3" />
          </div>

          {/* Document Categories */}
          <div>
            <h4 className="text-sm font-medium mb-2">Document Categories Found:</h4>
            <div className="flex flex-wrap gap-2">
              {analysis.analysis_data.categories.map((cat) => (
                <Badge key={cat} variant="outline" className="capitalize">
                  {cat.replace('_', ' ')}
                </Badge>
              ))}
            </div>
          </div>

          {/* Analyzed Documents */}
          <div>
            <h4 className="text-sm font-medium mb-2">Analyzed Documents:</h4>
            <div className="space-y-2">
              {analysis.analyzed_documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-2 bg-muted rounded">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{doc.fileName}</span>
                  </div>
                  <Badge variant="secondary">{doc.weight} pts</Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Improvement Suggestions */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-yellow-600" />
                  Improvement Suggestions
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Get personalized suggestions to strengthen your case
                </p>
              </div>
              <Badge className="bg-yellow-100 text-yellow-800">
                <IndianRupee className="w-3 h-3 mr-1" />
                200
              </Badge>
            </div>

            {suggestions.length === 0 ? (
              <Button
                onClick={loadSuggestions}
                disabled={suggestionsLoading}
                variant="outline"
                className="w-full"
              >
                {suggestionsLoading ? 'Loading...' : 'Get Improvement Suggestions'}
              </Button>
            ) : (
              <div className="space-y-3">
                {suggestions.map((suggestion) => (
                  <Alert key={suggestion.id}>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{suggestion.title}</span>
                            <Badge className={getPriorityColor(suggestion.priority)}>
                              {suggestion.priority}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">
                            {suggestion.description}
                          </p>
                          <div className="flex items-center gap-4 text-xs">
                            <span className="text-green-600 flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" />
                              +{suggestion.impactPercentage}% impact
                            </span>
                            <span className="text-muted-foreground">
                              Estimated strength: {suggestion.estimatedStrengthAfter}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {showCheckout && selectedAddon && (
        <CheckoutModal
          addonSlug={selectedAddon}
          onClose={() => {
            setShowCheckout(false);
            setSelectedAddon(null);
          }}
          onSuccess={() => {
            setShowCheckout(false);
            setSelectedAddon(null);
            loadSuggestions();
          }}
        />
      )}
    </>
  );
};
