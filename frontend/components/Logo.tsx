import Image from "next/image";

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
}

export function Logo({ width = 96, height = 96, className = "" }: LogoProps) {
  return (
    <div className="relative" style={{ backgroundColor: 'transparent' }}>
      <Image
        src="/logo.png"
        alt="VidVerse Logo"
        width={width}
        height={height}
        className={`object-contain ${className}`}
        style={{ 
          mixBlendMode: 'normal',
          backgroundColor: 'transparent',
          imageRendering: 'auto'
        }}
        priority
        unoptimized={false}
      />
    </div>
  );
}
