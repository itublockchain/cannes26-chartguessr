import React, { useRef, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import gsap from 'gsap';

interface PageTransitionProps {
  children: (location: ReturnType<typeof useLocation>) => React.ReactNode;
}

export const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [transitioning, setTransitioning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingLocationRef = useRef(location);

  useEffect(() => {
    if (location.pathname === displayLocation.pathname) return;

    pendingLocationRef.current = location;

    if (transitioning) return;

    const el = containerRef.current;
    if (!el) return;

    queueMicrotask(() => setTransitioning(true));

    // Exit animation — no filter/scale to preserve child backdrop-filter
    gsap.to(el, {
      opacity: 0,
      duration: 0.35,
      ease: 'power2.inOut',
      onComplete: () => {
        setDisplayLocation(pendingLocationRef.current);
        gsap.fromTo(
          el,
          { opacity: 0 },
          {
            opacity: 1,
            duration: 0.4,
            ease: 'power2.inOut',
            delay: 0.05,
            onComplete: () => {
              gsap.set(el, { clearProps: 'all' });
              setTransitioning(false);
            },
          }
        );
      },
    });
  }, [location, displayLocation.pathname, transitioning]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
    >
      {children(displayLocation)}
    </div>
  );
};
