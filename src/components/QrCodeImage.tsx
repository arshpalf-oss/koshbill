import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeImageProps {
  value: string;
  size?: number;
  className?: string;
}

export const QrCodeImage: React.FC<QrCodeImageProps> = ({
  value,
  size = 240,
  className = '',
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    if (!value) {
      setDataUrl('');
      return;
    }
    QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400 animate-pulse ${className}`}
      >
        Generating QR...
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt="UPI Payment QR Code"
      width={size}
      height={size}
      className={`select-none rounded-xl bg-white ${className}`}
    />
  );
};
