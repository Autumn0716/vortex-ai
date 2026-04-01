import React, { useEffect, useRef } from 'react';

export const FlowingPixels: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = window.innerWidth;
    let height = window.innerHeight;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };

    window.addEventListener('resize', resize);
    resize();

    // Static stars for the background
    const staticStars: { x: number; y: number; size: number; alpha: number; twinkleSpeed: number }[] = [];
    for (let i = 0; i < 400; i++) {
      staticStars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 1.5,
        alpha: Math.random(),
        twinkleSpeed: Math.random() * 0.01 + 0.005
      });
    }

    // Swirling particles for the vortex
    const numParticles = 3000; // Increased for more density
    const particles: { x: number; y: number; vx: number; vy: number; size: number; life: number; maxLife: number; colorIndex: number }[] = [];

    for (let i = 0; i < numParticles; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: 0,
        vy: 0,
        size: Math.random() * 1.5 + 0.5, // Slightly smaller for elegance
        life: Math.random() * 1000,
        maxLife: Math.random() * 1000 + 500,
        colorIndex: Math.floor(Math.random() * 3)
      });
    }

    const mouse = { x: width / 2, y: height / 2, isActive: false };
    let cx = width / 2;
    let cy = height / 2;

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.isActive = true;
    };

    const handleMouseLeave = () => {
      mouse.isActive = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    // Star colors: Bright White, Light Blue, Light Violet
    const colors = ['255, 255, 255', '147, 197, 253', '196, 181, 253'];

    const render = () => {
      // Motion blur / trail effect matching deep space
      ctx.fillStyle = 'rgba(3, 3, 8, 0.3)';
      ctx.fillRect(0, 0, width, height);

      // Draw static stars
      staticStars.forEach(star => {
        star.alpha += star.twinkleSpeed;
        if (star.alpha > 1 || star.alpha < 0) {
          star.twinkleSpeed *= -1;
        }
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.abs(star.alpha) * 0.6})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Determine vortex center
      const targetCx = mouse.isActive ? mouse.x : width / 2;
      const targetCy = mouse.isActive ? mouse.y : height / 2;

      // Smoothly move center
      cx += (targetCx - cx) * 0.05;
      cy += (targetCy - cy) * 0.05;

      particles.forEach((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        // Tangent vector for swirling (vortex)
        const dirX = -dy / dist;
        const dirY = dx / dist;

        // Swirl speed
        const swirlStrength = 2000 / (dist + 50);

        // Inward pull to keep them in the vortex
        const pullX = -dx / dist;
        const pullY = -dy / dist;
        // Added distance multiplier to pull far particles in faster, making the vortex more compact
        const pullStrength = 600 / (dist + 50) + (dist * 0.003);

        // Add some noise/wobble for organic feel
        const noiseX = Math.sin(p.y * 0.02) * 0.2;
        const noiseY = Math.cos(p.x * 0.02) * 0.2;

        // Update velocity
        p.vx += (dirX * swirlStrength + pullX * pullStrength + noiseX - p.vx) * 0.05;
        p.vy += (dirY * swirlStrength + pullY * pullStrength + noiseY - p.vy) * 0.05;

        // Apply velocity
        p.x += p.vx;
        p.y += p.vy;

        p.life++;

        // Respawn particles
        if (
          p.life > p.maxLife ||
          p.x < -100 ||
          p.x > width + 100 ||
          p.y < -100 ||
          p.y > height + 100 ||
          dist < 20
        ) {
          // Respawn at edges to flow inwards, tighter radius
          const angle = Math.random() * Math.PI * 2;
          const spawnRadius = Math.min(width, height) * 0.5 + Math.random() * (Math.min(width, height) * 0.2);
          p.x = cx + Math.cos(angle) * spawnRadius;
          p.y = cy + Math.sin(angle) * spawnRadius;
          p.vx = 0;
          p.vy = 0;
          p.life = 0;
        }

        // Twinkling effect
        const twinkle = Math.abs(Math.sin(p.life * 0.05));
        const alpha = 0.3 + twinkle * 0.7; // Bright stars

        // Draw particle
        ctx.fillStyle = `rgba(${colors[p.colorIndex]}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0 opacity-80 mix-blend-screen"
    />
  );
};
