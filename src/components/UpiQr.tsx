import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders a UPI deep-link as a scannable QR — works offline, generated locally. */
export default function UpiQr({ uri, size = 280 }: { uri: string; size?: number }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setSrc("");
    QRCode.toDataURL(uri, {
      width: size * 2,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#123528", light: "#FFFFFF" },
    })
      .then((d) => alive && setSrc(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [uri, size]);

  if (failed) return <div className="qr-skeleton" style={{ width: size, height: size }} />;
  if (!src) return <div className="qr-skeleton qr-pulse" style={{ width: size, height: size }} />;
  return <img src={src} width={size} height={size} className="qr-img" alt="UPI payment QR code" />;
}
