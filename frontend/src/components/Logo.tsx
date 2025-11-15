interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
}

export function Logo({ width = 144, height = 144, className = "" }: LogoProps) {
  return (
    <div className="relative" style={{ backgroundColor: 'transparent' }}>
      <img
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
      />
    </div>
  );
}

