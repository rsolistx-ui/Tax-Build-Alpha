import React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { useCamera, CapturedImage, correctPerspective, detectGlare, GlareDetectionResult, PerspectiveCorrectionResult } from '../lib/camera';
import { Camera, RotateCcw, Check, X, RotateCw, Zap, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

interface ReceiptCameraProps {
  onCapture: (image: { 
    original: CapturedImage; 
    corrected?: PerspectiveCorrectionResult; 
    glare?: GlareDetectionResult;
  }) => void;
  onCancel: () => void;
  autoCorrect?: boolean;
  autoDetectGlare?: boolean;
}

export function ReceiptCamera({ 
  onCapture, 
  onCancel, 
  autoCorrect = true, 
  autoDetectGlare = true 
}: ReceiptCameraProps) {
  const [capturedImage, setCapturedImage] = useState<{
    original: CapturedImage;
    corrected?: PerspectiveCorrectionResult;
    glare?: GlareDetectionResult;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<'correcting' | 'glare' | null>(null);
  const [glareWarning, setGlareWarning] = useState<{ hasGlare: boolean; severity: string } | null>(null);
  
  const {
    videoRef,
    state,
    requestPermission,
    stopCamera,
    switchCamera,
    capturePhoto,
  } = useCamera();

  useEffect(() => {
    let mounted = true;
    requestPermission('environment').then((_success: boolean) => {
      if (!mounted) return;
    });
    return () => { mounted = false; };
  }, [requestPermission]);

  const _handleCapture = useCallback(async () => {
    const photo = await capturePhoto();
    if (!photo) return;

    setCapturedImage({ original: photo });
    stopCamera();

    if (autoCorrect || autoDetectGlare) {
      setIsProcessing(true);
      
      try {
        let corrected: PerspectiveCorrectionResult | null = null;
        let glare: GlareDetectionResult | null = null;

        if (autoCorrect) {
          setProcessingStep('correcting');
          corrected = await correctPerspective(photo.blob);
        }

        if (autoDetectGlare) {
          setProcessingStep('glare');
          const glareResult = await detectGlare(photo.blob);
          glare = glareResult;
          
          if (glareResult.hasGlare) {
            setGlareWarning({ hasGlare: true, severity: glareResult.severity });
          }
        }

        setCapturedImage(prev => prev ? { 
          ...prev, 
          corrected: corrected ?? undefined,
          glare: glare ?? undefined,
        } : null);
        
      } catch (err) {
        console.error('Processing failed:', err);
      } finally {
        setIsProcessing(false);
        setProcessingStep(null);
      }
    }
  }, [capturePhoto, autoCorrect, autoDetectGlare]);

  const handleRetake = useCallback(() => {
    setCapturedImage(null);
    setGlareWarning(null);
    setProcessingStep(null);
    requestPermission('environment');
  }, [requestPermission]);

  const handleConfirm = useCallback(() => {
    if (capturedImage) {
      onCapture(capturedImage);
    }
  }, [capturedImage, onCapture]);

  const handleRotate = useCallback(async () => {
    if (!capturedImage) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.src = capturedImage.original.dataUrl;
    await new Promise(resolve => { img.onload = resolve; });
    
    canvas.width = img.height;
    canvas.height = img.width;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    
    const blob = await new Promise<Blob>((resolve, reject) => 
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create blob'));
      }, 'image/jpeg', 0.9)
    );
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    
    setCapturedImage(prev => prev ? {
      ...prev,
      original: {
        ...prev.original,
        blob,
        dataUrl,
        width: prev.original.height,
        height: prev.original.width,
      },
    } : null);
  }, [capturedImage]);

  if (!state.hasPermission && !state.isActive) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 bg-slate-50">
        <Camera className="w-16 h-16 text-slate-300 mb-4" />
        <h2 className="text-xl font-semibold text-slate-700 mb-2">Camera Access Required</h2>
        <p className="text-slate-500 text-center mb-6 max-w-xs">
          Please allow camera access to scan receipts. You can change this in your browser settings.
        </p>
        <button
          onClick={() => requestPermission('environment')}
          className="px-6 py-3 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-700 transition-colors"
        >
          Grant Camera Access
        </button>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 bg-slate-50">
        <AlertTriangle className="w-16 h-16 text-amber-500 mb-4" />
        <h2 className="text-xl font-semibold text-slate-700 mb-2">Camera Error</h2>
        <p className="text-slate-500 text-center mb-6 max-w-xs">
          {state.error}
        </p>
        <button
          onClick={() => requestPermission('environment')}
          className="px-6 py-3 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full bg-black flex flex-col">
      <div className="flex-1 relative overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          autoPlay
          playsInline
          muted
        />
        
        {!capturedImage && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-3/4 h-3/4 max-w-md">
              <div className="absolute inset-0 border-2 border-white/50 rounded-lg" />
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-black px-2 text-white text-xs font-medium">
                Align receipt within frame
              </div>
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
                <div className="w-2 h-2 bg-white/50 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-white/50 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-white/50 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {glareWarning && !capturedImage && (
          <div className="absolute bottom-20 left-4 right-4 z-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto max-w-md bg-amber-900/95 border border-amber-700 rounded-lg p-4 flex items-start gap-3"
            >
              <Zap className="w-5 h-5 text-amber-300 mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-sm text-amber-100">
                <p className="font-medium">Glare Detected</p>
                <p className="text-amber-200/90 mt-1">
                  Strong reflections detected. Try adjusting angle or moving to shade.
                </p>
              </div>
            </motion.div>
          </div>
        )}

        {isProcessing && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-900 rounded-xl p-8 flex flex-col items-center gap-4 max-w-sm mx-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 border-4 border-slate-700 border-t-slate-300 rounded-full animate-spin" />
                <span className="text-white font-medium">{processingStep === 'correcting' ? 'Correcting perspective...' : 'Detecting glare...'}</span>
              </div>
              <p className="text-slate-400 text-sm">Please wait...</p>
            </motion.div>
          </div>
        )}

        {/* Controls when not captured */}
        {!capturedImage && !isProcessing && (
          <div className="absolute bottom-0 left-0 right-0 p-6 pb-safe flex flex-col items-center gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={switchCamera}
                className="p-3 bg-white/10 backdrop-blur-sm rounded-full text-white hover:bg-white/20 transition-colors"
                aria-label="Switch camera"
              >
                <RotateCw className="w-6 h-6" />
              </button>
              
              <button
                onClick={_handleCapture}
                disabled={isProcessing || !state.isActive}
                className="w-16 h-16 bg-white rounded-full border-4 border-white/20 flex items-center justify-center shadow-2xl transition-all hover:scale-105 active:scale-95"
                aria-label="Capture photo"
              >
                <div className="w-10 h-10 bg-white rounded-full shadow-inner" />
              </button>
              
              <button
                onClick={onCancel}
                className="p-3 bg-white/10 backdrop-blur-sm rounded-full text-white hover:bg-white/20 transition-colors"
                aria-label="Cancel"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <p className="text-white/60 text-sm text-center">
              Tap the white button to capture
            </p>
          </div>
        )}

        {capturedImage && (
          <div className="absolute inset-0 bg-black/95 flex flex-col z-10">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h3 className="text-white font-medium">Review Capture</h3>
              <div className="flex gap-2">
                {glareWarning && (
                  <span className="px-2 py-1 bg-amber-900/90 text-amber-200 text-xs rounded-full flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Glare: {glareWarning.severity}
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
              <img 
                src={capturedImage.corrected?.correctedDataUrl || capturedImage.original.dataUrl} 
                alt="Captured receipt"
                className="max-w-full max-h-[70vh] rounded-lg shadow-2xl"
              />
            </div>
            
            <div className="p-4 border-t border-slate-800 flex gap-3">
              <button
                onClick={handleRetake}
                className="flex-1 py-3 px-4 bg-slate-800 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-slate-700 transition-colors"
              >
                <RotateCcw className="w-5 h-5" />
                Retake
              </button>
              <button
                onClick={handleRotate}
                className="py-3 px-4 bg-slate-800 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-slate-700 transition-colors"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 py-3 px-4 bg-slate-900 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-slate-700 transition-colors"
                disabled={isProcessing}
              >
                <Check className="w-5 h-5" />
                Use Photo
              </button>
            </div>
          </div>
        )}

        {capturedImage && glareWarning && (
          <React.Fragment>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute bottom-28 left-4 right-4 mx-auto max-w-md z-10"
            >
              <div className="bg-amber-900/95 border border-amber-700 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-300 mt-0.5 flex-shrink-0" />
                <div className="flex-1 text-sm text-amber-100">
                  <p className="font-medium">Glare Detected ({glareWarning.severity})</p>
                  <p className="text-amber-200/90 mt-1">
                    Consider retaking in better lighting for best OCR results.
                  </p>
                </div>
              </div>
            </motion.div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

export default ReceiptCamera;