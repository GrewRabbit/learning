// app/solve/components/image-uploader.tsx
// 多途径图片上传组件（文件选择 / 剪贴板粘贴 / 摄像头拍照）
// 统一格式验证、大小限制、预览，响应式布局

'use client';

import * as React from 'react';
import { Upload, ClipboardPaste, Camera, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** 图片大小上限 5MB（与 Zod schema 一致，架构 §5.3） */
const IMAGE_MAX_SIZE = 5 * 1024 * 1024;
/** 允许的图片类型 */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];
const ACCEPTED_TYPES_STR = 'image/jpeg,image/png';

export interface ImageUploaderProps {
  /** 当前 base64 内容（不含 data URL 前缀） */
  value: string;
  /** base64 内容变更回调 */
  onChange: (base64: string) => void;
  /** 错误回调 */
  onError: (message: string) => void;
}

/**
 * 统一文件验证：格式 + 大小
 * 返回 null 表示通过，否则返回错误信息
 * 导出供单元测试（P1-2）
 */
export function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return '仅支持 JPG / PNG 格式';
  }
  if (file.size > IMAGE_MAX_SIZE) {
    return '图片大小不能超过 5MB';
  }
  return null;
}

/**
 * File 转 base64（不含 data URL 前缀）
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

export function ImageUploader({
  value,
  onChange,
  onError,
}: ImageUploaderProps): React.JSX.Element {
  const [previewUrl, setPreviewUrl] = React.useState('');
  const [cameraActive, setCameraActive] = React.useState(false);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream>(null);

  // 外部 value 变化时同步预览（清除时 value='' → 预览也清除）
  React.useEffect(() => {
    if (value) {
      // 从 base64 反推 data URL 需要知道类型，这里用 png 兜底（jpeg/png 均可预览）
      setPreviewUrl(`data:image/png;base64,${value}`);
    } else {
      setPreviewUrl('');
    }
  }, [value]);

  // 统一处理文件
  const handleFile = (file: File): void => {
    const error = validateFile(file);
    if (error) {
      onError(error);
      return;
    }
    fileToBase64(file)
      .then((base64) => onChange(base64))
      .catch(() => onError('图片读取失败'));
  };

  // 用 ref 持有最新的 handleFile，让 effect 只注册一次 document paste 监听器
  const handleFileRef = React.useRef(handleFile);
  handleFileRef.current = handleFile;

  // 1. 文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // 重置 input 允许重复选同一文件
    e.target.value = '';
  };

  // 2. 剪贴板粘贴（document 全局监听，避免普通 div 不触发 paste 事件）
  //    仅在粘贴内容为图片时接管，文本粘贴不干预
  React.useEffect(() => {
    const handleDocumentPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFileRef.current(file);
          }
          return;
        }
      }
      // 非图片粘贴不干预，让默认行为发生（如文本框粘贴文本）
    };
    document.addEventListener('paste', handleDocumentPaste);
    return () => document.removeEventListener('paste', handleDocumentPaste);
  }, []);

  // 3. 摄像头拍照
  const openCamera = async (): Promise<void> => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);
      // 等待 video 元素渲染后绑定 stream
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      });
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? '摄像头权限被拒绝，请在浏览器设置中允许访问'
          : '无法访问摄像头，请确认设备已连接摄像头';
      setCameraError(message);
    }
  };

  const closeCamera = (): void => {
    streamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  const capturePhoto = (): void => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
          handleFile(file);
        }
        closeCamera();
      },
      'image/jpeg',
      0.9,
    );
  };

  // 清除图片
  const clearImage = (): void => {
    onChange('');
    setPreviewUrl('');
  };

  // 组件卸载时关闭摄像头
  React.useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    };
  }, []);

  return (
    <div className="space-y-3">
      {/* 三种上传方式按钮（响应式：移动端纵向，桌面端横向） */}
      {!cameraActive && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onError('请按 Ctrl+V / Cmd+V 粘贴图片')}
            className="w-full"
          >
            <ClipboardPaste className="h-4 w-4" />
            粘贴图片
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="w-full"
          >
            <Upload className="h-4 w-4" />
            选择文件
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={openCamera}
            className="w-full"
          >
            <Camera className="h-4 w-4" />
            拍照上传
          </Button>
        </div>
      )}

      {/* 隐藏的文件 input（保留 id 供 E2E setInputFiles 定位） */}
      <input
        ref={fileInputRef}
        id="image-input"
        type="file"
        accept={ACCEPTED_TYPES_STR}
        onChange={handleFileChange}
        className="hidden"
      />

      {/* 摄像头区域 */}
      {cameraActive && (
        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-md"
          />
          {cameraError && (
            <p className="text-sm text-destructive">{cameraError}</p>
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={capturePhoto} className="flex-1">
              <Check className="h-4 w-4" />
              拍照
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={closeCamera}
              className="flex-1"
            >
              <X className="h-4 w-4" />
              取消
            </Button>
          </div>
        </div>
      )}

      {/* 操作指引 */}
      {!cameraActive && !previewUrl && (
        <p className="text-xs text-muted-foreground">
          支持 JPG / PNG 格式，单张不超过 5MB。可选择本地文件、粘贴剪贴板截图或直接拍照。
        </p>
      )}

      {/* 预览 */}
      {previewUrl && !cameraActive && (
        <div className="relative inline-block">
          {/* 本地预览用 img，next/image 对 data URL 无优化意义 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="题目预览"
            className="max-h-64 rounded border border-border"
          />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            onClick={clearImage}
            className="absolute right-1 top-1 h-7 w-7"
            aria-label="清除图片"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
