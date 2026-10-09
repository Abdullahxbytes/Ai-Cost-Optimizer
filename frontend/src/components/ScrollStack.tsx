import { type ReactNode, useEffect, useRef } from 'react';

export function ScrollStackItem({ children }: { children: ReactNode }) {
  return <div className="scroll-stack-card">{children}</div>;
}

export default function ScrollStack({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.scroll-stack-card'));
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('scroll-stack-visible');
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.16 },
    );
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className={`scroll-stack ${className}`.trim()}>
      {children}
    </div>
  );
}
