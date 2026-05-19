import type { ReactNode } from 'react';

export default function AssetsLayout({ children }: { children: ReactNode }) {
  return <div className="shell" style={{ gridTemplateColumns: '280px 1fr' }}>{children}</div>;
}
