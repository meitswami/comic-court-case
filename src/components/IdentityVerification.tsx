import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useFaceDetection } from '@/hooks/useFaceDetection';
import {
  Camera,
  Upload,
  CheckCircle,
  AlertCircle,
  Video,
  IdCard,
  Loader2,
  RefreshCw,
  User,
  Scan,
  Phone,
  Mail,
  Users,
} from 'lucide-react';

interface IdentityVerificationProps {
  caseId: string;
  userId: string;
  intent?: 'know_more' | 'add_info';
  relationToCase?: string;
  onComplete: () => void;
  onCancel: () => void;
}

type VerificationStep = 'personal_info' | 'id_upload' | 'selfie' | 'video' | 'complete';
type IdType = 'aadhar' | 'driving_license' | 'passport';

export const IdentityVerification: React.FC<IdentityVerificationProps> = ({
  caseId,
  userId,
  intent = 'add_info',
  relationToCase = 'Unknown',
  onComplete,
  onCancel,
}) => {
  const [step, setStep] = useState<VerificationStep>('personal_info');
  
  // Personal info
  const [fullName, setFullName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [relation, setRelation] = useState(relationToCase);
  
  // ID upload
  const [selectedIdType, setSelectedIdType] = useState<IdType | null>(null);
  const [idFile, setIdFile] = useState<File | null>(null);
  
  // Selfie & video
  const [selfieBlob, setSelfieBlob] = useState<Blob | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [faceConfidence, setFaceConfidence] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);

  const { toast } = useToast();
  const {
    modelsLoaded,
    isLoadingModels,
    faceResult,
    loadModels,
    startContinuousDetection,
    stopContinuousDetection,
    drawFaceOverlay,
  } = useFaceDetection();

  const ID_TYPES: { type: IdType; label: string; icon: React.ReactNode }[] = [
    { type: 'aadhar', label: 'Aadhar Card', icon: <IdCard className="w-5 h-5" /> },
    { type: 'driving_license', label: 'Driving License', icon: <IdCard className="w-5 h-5" /> },
    { type: 'passport', label: 'Passport', icon: <IdCard className="w-5 h-5" /> },
  ];

  const RELATION_OPTIONS = [
    'Victim',
    'Accused',
    'Family Member',
    'Legal Representative',
    'Witness',
    'Other',
  ];

  // Load face detection models when entering selfie step
  useEffect(() => {
    if (step === 'selfie' && !modelsLoaded && !isLoadingModels) {
      loadModels();
    }
  }, [step, modelsLoaded, isLoadingModels, loadModels]);

  // Draw face overlay when face is detected
  useEffect(() => {
    if (overlayCanvasRef.current && videoRef.current && isCapturing) {
      drawFaceOverlay(overlayCanvasRef.current, videoRef.current, faceResult.box);
      setFaceConfidence(faceResult.confidence);
    }
  }, [faceResult, isCapturing, drawFaceOverlay]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: step === 'video',
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        videoRef.current.onloadeddata = () => {
          if (step === 'selfie' && modelsLoaded && videoRef.current) {
            startContinuousDetection(videoRef.current);
          }
        };
      }
      setIsCapturing(true);
    } catch (error) {
      console.error('Camera error:', error);
      toast({
        title: 'Camera Error',
        description: 'Could not access camera. Please check permissions.',
        variant: 'destructive',
      });
    }
  }, [step, toast, modelsLoaded, startContinuousDetection]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    stopContinuousDetection();
    setIsCapturing(false);
  }, [stopContinuousDetection]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const captureSelfie = () => {
    if (!videoRef.current || !canvasRef.current || !faceResult.detected) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        setSelfieBlob(blob);
        stopCamera();
        toast({
          title: 'Selfie Captured',
          description: `Face detected with ${Math.round(faceConfidence * 100)}% confidence.`,
        });
      }
    }, 'image/jpeg', 0.9);
  };

  const startVideoRecording = () => {
    if (!streamRef.current) return;

    recordingChunksRef.current = [];
    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: 'video/webm',
    });
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordingChunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, { type: 'video/webm' });
      setVideoBlob(blob);
      stopCamera();
      toast({
        title: 'Video Recorded',
        description: 'Your verification video has been captured.',
      });
    };

    mediaRecorder.start();
    setIsRecording(true);
    setRecordingTime(0);

    const recordingInterval = setInterval(() => {
      setRecordingTime(prev => {
        if (prev >= 5) {
          clearInterval(recordingInterval);
          mediaRecorder.stop();
          setIsRecording(false);
          return 5;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const handleIdUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedIdType) {
      setIdFile(file);
      toast({
        title: 'ID Uploaded',
        description: `Your ${ID_TYPES.find(t => t.type === selectedIdType)?.label} has been uploaded.`,
      });
    }
  };

  const validatePersonalInfo = () => {
    if (!fullName.trim()) {
      toast({ title: 'Error', description: 'Please enter your full name.', variant: 'destructive' });
      return false;
    }
    if (!fatherName.trim()) {
      toast({ title: 'Error', description: "Please enter your father's name.", variant: 'destructive' });
      return false;
    }
    if (!phoneNumber.trim() || !/^\d{10}$/.test(phoneNumber)) {
      toast({ title: 'Error', description: 'Please enter a valid 10-digit phone number.', variant: 'destructive' });
      return false;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: 'Error', description: 'Please enter a valid email address.', variant: 'destructive' });
      return false;
    }
    return true;
  };

  const handleSubmitVerification = async () => {
    if (!idFile || !selfieBlob) return;

    setIsUploading(true);
    try {
      const timestamp = Date.now();
      
      // Upload ID document
      const idFileName = `verifications/${userId}/${caseId}/id_${selectedIdType}_${timestamp}.${idFile.name.split('.').pop()}`;
      const { error: idError } = await supabase.storage
        .from('evidence')
        .upload(idFileName, idFile);
      if (idError) throw idError;

      // Upload selfie
      const selfieFileName = `verifications/${userId}/${caseId}/selfie_${timestamp}.jpg`;
      const { error: selfieError } = await supabase.storage
        .from('evidence')
        .upload(selfieFileName, selfieBlob);
      if (selfieError) throw selfieError;

      // Store paths in database (signed URLs will be generated on access)
      const { error: dbError } = await supabase
        .from('identity_verifications')
        .insert({
          user_id: userId,
          case_id: caseId,
          full_name: fullName.trim(),
          father_name: fatherName.trim(),
          phone_number: phoneNumber.trim(),
          email: email.trim().toLowerCase(),
          relation_to_case: relation,
          id_document_type: selectedIdType,
          id_document_url: idFileName, // Store path, not URL
          selfie_url: selfieFileName, // Store path, not URL
          intent: intent,
          face_match_percentage: faceConfidence * 100,
          verification_status: 'pending',
        });

      if (dbError) throw dbError;

      // Admins are notified by the server when the request is saved.

      toast({
        title: 'Verification Submitted',
        description: 'Your identity verification has been submitted. You will be notified once approved by Super Admin.',
      });

      onComplete();
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload Failed',
        description: 'Could not submit verification. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const stepIndex = ['personal_info', 'id_upload', 'selfie', 'video'].indexOf(step);

  return (
    <div className="p-4 space-y-4">
      <Card className="border-2 border-primary">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="w-5 h-5 text-primary" />
            Identity Verification
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Complete this verification to {intent === 'know_more' ? 'view case details' : 'add information to the case'}.
          </p>
        </CardHeader>
        <CardContent>
          {/* Progress Steps */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {['personal_info', 'id_upload', 'selfie', 'video'].map((s, i) => (
              <React.Fragment key={s}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  step === s ? 'bg-primary text-primary-foreground' : 
                  stepIndex > i ? 'bg-green-500 text-white' : 
                  'bg-muted text-muted-foreground'
                }`}>
                  {stepIndex > i ? '✓' : i + 1}
                </div>
                {i < 3 && <div className="w-6 h-0.5 bg-muted" />}
              </React.Fragment>
            ))}
          </div>

          {/* Step 1: Personal Information */}
          {step === 'personal_info' && (
            <div className="space-y-4">
              <h3 className="font-semibold">Step 1: Personal Information</h3>
              <p className="text-sm text-muted-foreground">
                Please provide your personal details for verification.
              </p>
              
              <div className="space-y-3">
                <div>
                  <Label htmlFor="fullName" className="flex items-center gap-2">
                    <User className="w-4 h-4" /> Full Name *
                  </Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    className="mt-1"
                  />
                </div>
                
                <div>
                  <Label htmlFor="fatherName" className="flex items-center gap-2">
                    <Users className="w-4 h-4" /> Father's Name *
                  </Label>
                  <Input
                    id="fatherName"
                    value={fatherName}
                    onChange={(e) => setFatherName(e.target.value)}
                    placeholder="Enter your father's name"
                    className="mt-1"
                  />
                </div>
                
                <div>
                  <Label htmlFor="phone" className="flex items-center gap-2">
                    <Phone className="w-4 h-4" /> Phone Number *
                  </Label>
                  <Input
                    id="phone"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile number"
                    className="mt-1"
                  />
                </div>
                
                <div>
                  <Label htmlFor="email" className="flex items-center gap-2">
                    <Mail className="w-4 h-4" /> Email Address *
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    className="mt-1"
                  />
                </div>
                
                <div>
                  <Label className="flex items-center gap-2">
                    <Users className="w-4 h-4" /> Relation to Case
                  </Label>
                  <Select value={relation} onValueChange={setRelation}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select relation" />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATION_OPTIONS.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <Button 
                onClick={() => validatePersonalInfo() && setStep('id_upload')} 
                className="w-full"
              >
                Continue to ID Upload
              </Button>
            </div>
          )}

          {/* Step 2: ID Upload */}
          {step === 'id_upload' && (
            <div className="space-y-4">
              <h3 className="font-semibold">Step 2: Upload ID Document</h3>
              <p className="text-sm text-muted-foreground">
                Please select and upload one of the following ID documents:
              </p>
              <div className="grid grid-cols-3 gap-2">
                {ID_TYPES.map(({ type, label, icon }) => (
                  <Button
                    key={type}
                    variant={selectedIdType === type ? 'default' : 'outline'}
                    onClick={() => setSelectedIdType(type)}
                    className="flex flex-col h-auto py-3"
                  >
                    {icon}
                    <span className="text-xs mt-1">{label}</span>
                  </Button>
                ))}
              </div>
              {selectedIdType && (
                <div className="mt-4">
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={handleIdUpload}
                    className="hidden"
                    id="id-upload"
                  />
                  <label htmlFor="id-upload">
                    <Button variant="outline" className="w-full" asChild>
                      <span>
                        <Upload className="w-4 h-4 mr-2" />
                        {idFile ? idFile.name : 'Upload ID Document'}
                      </span>
                    </Button>
                  </label>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('personal_info')}>
                  Back
                </Button>
                {idFile && (
                  <Button onClick={() => setStep('selfie')} className="flex-1">
                    Continue to Selfie
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Selfie */}
          {step === 'selfie' && (
            <div className="space-y-4">
              <h3 className="font-semibold">Step 3: Take a Live Selfie</h3>
              <p className="text-sm text-muted-foreground">
                Position your face in the frame. AI will detect and verify your face.
              </p>

              {isLoadingModels && (
                <div className="flex items-center gap-2 p-3 bg-blue-500/10 rounded-lg">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  <span className="text-sm text-blue-500">Loading face detection AI...</span>
                </div>
              )}
              
              <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                {isCapturing ? (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    <canvas
                      ref={overlayCanvasRef}
                      className="absolute inset-0 w-full h-full pointer-events-none"
                    />
                    <div className="absolute top-2 right-2 flex flex-col gap-1">
                      <Badge className={faceResult.detected ? 'bg-green-500' : 'bg-amber-500'}>
                        {faceResult.detected ? (
                          <><CheckCircle className="w-3 h-3 mr-1" /> Face Detected</>
                        ) : (
                          <><Scan className="w-3 h-3 mr-1" /> Scanning...</>
                        )}
                      </Badge>
                      {faceResult.detected && (
                        <Badge className="bg-blue-500">
                          {Math.round(faceResult.confidence * 100)}% Match
                        </Badge>
                      )}
                    </div>
                    {!faceResult.detected && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-48 h-48 border-4 border-dashed border-primary/50 rounded-full animate-pulse" />
                      </div>
                    )}
                  </>
                ) : selfieBlob ? (
                  <img
                    src={URL.createObjectURL(selfieBlob)}
                    alt="Selfie"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2">
                    <Camera className="w-12 h-12 text-muted-foreground" />
                  </div>
                )}
              </div>
              <canvas ref={canvasRef} className="hidden" />

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { stopCamera(); setStep('id_upload'); }}>
                  Back
                </Button>
                {!isCapturing && !selfieBlob && (
                  <Button onClick={startCamera} className="flex-1" disabled={isLoadingModels}>
                    {isLoadingModels ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Camera className="w-4 h-4 mr-2" />
                    )}
                    {isLoadingModels ? 'Loading AI...' : 'Start Camera'}
                  </Button>
                )}
                {isCapturing && (
                  <Button
                    onClick={captureSelfie}
                    disabled={!faceResult.detected || faceResult.confidence < 0.7}
                    className="flex-1"
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    {faceResult.detected && faceResult.confidence < 0.7 ? 'Move Closer' : 'Capture Selfie'}
                  </Button>
                )}
                {selfieBlob && (
                  <>
                    <Button variant="outline" onClick={() => { setSelfieBlob(null); startCamera(); }}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Retake
                    </Button>
                    <Button onClick={handleSubmitVerification} disabled={isUploading} className="flex-1">
                      {isUploading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4 mr-2" />
                      )}
                      Submit Verification
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          <Button variant="ghost" onClick={onCancel} className="w-full mt-4">
            Cancel
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
