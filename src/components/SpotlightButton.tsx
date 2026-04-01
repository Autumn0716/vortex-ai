import React, { useRef, useState } from 'react';
import { cn } from '../lib/utils';

interface SpotlightButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export const SpotlightButton: React.FC<SpotlightButtonProps> = ({ children, className, ...props }) => {
  const divRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <button
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity,
          background: `radial-gradient(80px circle at ${position.x}px ${position.y}px, hsla(0,0%,100%,0.3), transparent 100%)`,
        }}
      />
      <span className="relative z-10 flex items-center justify-center">{children}</span>
    </button>
  );
};
