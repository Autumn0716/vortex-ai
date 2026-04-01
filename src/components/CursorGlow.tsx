import React, { useEffect, useRef } from 'react';

export const CursorGlow: React.FC = () => {
  const glowRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const current = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMouseMove);

    let rafId: number;
    const render = () => {
      // Lerp for smooth "jelly" follow effect
      current.current.x += (mouse.current.x - current.current.x) * 0.1;
      current.current.y += (mouse.current.y - current.current.y) * 0.1;

      if (glowRef.current) {
        glowRef.current.style.setProperty('--x', `${current.current.x}px`);
        glowRef.current.style.setProperty('--y', `${current.current.y}px`);
      }
      rafId = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={glowRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{
        background: 'radial-gradient(circle at var(--x, 50%) var(--y, 50%), rgba(124, 58, 237, 0.08), transparent 40%)'
      }}
    />
  );
};
