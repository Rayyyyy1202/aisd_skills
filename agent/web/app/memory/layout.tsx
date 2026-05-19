import type { ReactNode } from 'react';

export default function MemoryLayout({ children }: { children: ReactNode }) {
  return <div className="shell">{children}</div>;
}
