import { useState, useRef, useCallback } from 'react';

export interface CapturedImage {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  timestamp: number;
}

export interface PerspectiveCorrectionResult {
  correctedBlob: Blob;
  correctedDataUrl: string;
  originalBlob: Blob;
  corners: { x: number; y: number }[];
}

export interface GlareDetectionResult {
  hasGlare: boolean;
  glareRegions: { x: number; y: number; width: number; height: number }[];
  severity: 'none' | 'low' | 'medium' | 'high';
}

export interface CameraState {
  hasPermission: boolean;
  isActive: boolean;
  error: string | null;
  facingMode: 'environment' | 'user';
}

export function useCamera(): {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  state: CameraState;
  requestPermission: (facingMode?: 'environment' | 'user') => Promise<boolean>;
  stopCamera: () => void;
  switchCamera: () => Promise<void>;
  capturePhoto: () => Promise<CapturedImage | null>;
} {
  const [state, setState] = useState<CameraState>({
    hasPermission: false,
    isActive: false,
    error: null,
    facingMode: 'environment',
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const requestPermission = useCallback(async (facingMode: 'environment' | 'user' = 'environment') => {
    try {
      setState(prev => ({ ...prev, error: null }));
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setState(prev => ({ 
        ...prev, 
        hasPermission: true, 
        isActive: true, 
        facingMode 
      }));
      
      return true;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Camera access denied';
      setState(prev => ({ ...prev, error, hasPermission: false, isActive: false }));
      return false;
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setState(prev => ({ ...prev, isActive: false }));
  }, []);

  const switchCamera = useCallback(async () => {
    const newFacingMode = state.facingMode === 'environment' ? 'user' : 'environment';
    stopCamera();
    await new Promise(resolve => setTimeout(resolve, 100));
    await requestPermission(newFacingMode);
  }, [state.facingMode, stopCamera, requestPermission]);

  const capturePhoto = useCallback(async (): Promise<CapturedImage | null> => {
    if (!videoRef.current || !streamRef.current) return null;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>(resolve => 
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    );
    
    if (!blob) return null;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    
    return {
      blob,
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      timestamp: Date.now(),
    };
  }, []);

  return {
    videoRef,
    state,
    requestPermission,
    stopCamera,
    switchCamera,
    capturePhoto,
  };
}

// OpenCV perspective correction
let cv: any = null;
let cvReady = false;

async function loadOpenCV(): Promise<void> {
  if (cvReady) return;
  
  await new Promise<void>((resolve, reject) => {
    if ((window as any).cv) {
      cv = (window as any).cv;
      cvReady = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    script.onload = () => {
      const checkCV = setInterval(() => {
        if ((window as any).cv) {
          clearInterval(checkCV);
          cv = (window as any).cv;
          cvReady = true;
          resolve();
        }
      }, 100);
    };
    script.onerror = () => reject(new Error('Failed to load OpenCV.js'));
    document.head.appendChild(script);
  });
}

function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => 
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create blob'));
    }, 'image/jpeg', 0.9)
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.9);
}

function orderCorners(contour: any): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    pts.push([contour.data32F[i * 2], contour.data32F[i * 2 + 1]]);
  }
  
  pts.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  const tl = pts[0];
  const br = pts[3];
  
  const remaining = [pts[1], pts[2]];
  remaining.sort((a, b) => (a[0] - a[1]) - (b[0] - b[1]));
  const tr = remaining[0];
  const bl = remaining[1];
  
  return [tl, tr, br, bl];
}

export async function correctPerspective(
  imageBlob: Blob,
  options?: { maxDimension?: number }
): Promise<PerspectiveCorrectionResult> {
  await loadOpenCV();
  
  const maxDimension = options?.maxDimension || 1920;
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = async () => {
      try {
        const src = cv.imread(imageToCanvas(img));
        
        let processedSrc = src;
        if (src.cols > maxDimension || src.rows > maxDimension) {
          const scale = maxDimension / Math.max(src.cols, src.rows);
          const newSize = new cv.Size(
            Math.round(src.cols * scale),
            Math.round(src.rows * scale)
          );
          const processed = new cv.Mat();
          cv.resize(src, processed, newSize, 0, 0, cv.INTER_AREA);
          src.delete();
          processedSrc = processed;
        }
        
        const gray = new cv.Mat();
        cv.cvtColor(processedSrc, gray, cv.COLOR_RGBA2GRAY);
        
        const blurred = new cv.Mat();
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        
        const edges = new cv.Mat();
        cv.Canny(blurred, edges, 50, 150);
        
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        
        let bestContour: any = null;
        let maxArea = 0;
        
        for (let i = 0; i < contours.size(); i++) {
          const contour = contours.get(i);
          const area = cv.contourArea(contour);
          if (area > maxArea) {
            const peri = cv.arcLength(contour, true);
            const approx = new cv.Mat();
            cv.approxPolyDP(contour, approx, 0.02 * peri, true);
            
            if (approx.rows === 4 && area > maxArea) {
              maxArea = area;
              bestContour = approx;
            }
            approx.delete();
          }
          contour.delete();
        }
        
        if (!bestContour) {
          const blob = await canvasToBlob(processedSrc);
          resolve({
            correctedBlob: blob,
            correctedDataUrl: await blobToDataUrl(blob),
            originalBlob: imageBlob,
            corners: [
              { x: 0, y: 0 },
              { x: processedSrc.cols, y: 0 },
              { x: processedSrc.cols, y: processedSrc.rows },
              { x: 0, y: processedSrc.rows },
            ],
          });
          return;
        }
        
        const corners = orderCorners(bestContour);
        
        const dst = new cv.Mat();
        const dstSize = new cv.Size(processedSrc.cols, processedSrc.rows);
        const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat());
        const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
          0, 0,
          processedSrc.cols, 0,
          processedSrc.cols, processedSrc.rows,
          0, processedSrc.rows,
        ]);
        
        const transform = cv.getPerspectiveTransform(srcPoints, dstPoints);
        cv.warpPerspective(processedSrc, dst, transform, dstSize);
        
        const resultCanvas = document.createElement('canvas');
        cv.imshow(resultCanvas, dst);
        const correctedBlob = await new Promise<Blob>((resolve, reject) => 
          resultCanvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to create blob'));
          }, 'image/jpeg', 0.9)
        );
        
        resolve({
          correctedBlob,
          correctedDataUrl: canvasToDataUrl(resultCanvas),
          originalBlob: imageBlob,
          corners: corners.map(([x, y]) => ({ x, y })),
        });
        
      } catch (err) {
        reject(err);
      }
    };
    
    img.src = URL.createObjectURL(imageBlob);
  });
}

// Simple glare detection using brightness analysis
export async function detectGlare(imageBlob: Blob): Promise<GlareDetectionResult> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      const glareRegions: { x: number; y: number; width: number; height: number }[] = [];
      const blockSize = 32;
      const threshold = 240;
      let glarePixels = 0;
      let totalPixels = 0;
      
      for (let y = 0; y < canvas.height; y += blockSize) {
        for (let x = 0; x < canvas.width; x += blockSize) {
          let brightPixels = 0;
          let blockPixels = 0;
          
          for (let by = 0; by < blockSize && y + by < canvas.height; by++) {
            for (let bx = 0; bx < blockSize && x + bx < canvas.width; bx++) {
              const idx = ((y + by) * canvas.width + (x + bx)) * 4;
              const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
              if (brightness > threshold) brightPixels++;
              blockPixels++;
            }
          }
          
          const ratio = brightPixels / blockPixels;
          if (ratio > 0.3) {
            glareRegions.push({ x, y, width: blockSize, height: blockSize });
          }
          
          glarePixels += brightPixels;
          totalPixels += blockPixels;
        }
      }
      
      const glareRatio = glarePixels / totalPixels;
      let severity: GlareDetectionResult['severity'] = 'none';
      if (glareRatio > 0.15) severity = 'high';
      else if (glareRatio > 0.08) severity = 'medium';
      else if (glareRatio > 0.03) severity = 'low';
      
      resolve({
        hasGlare: glareRegions.length > 0,
        glareRegions,
        severity,
      });
    };
    img.src = URL.createObjectURL(imageBlob);
  });
}