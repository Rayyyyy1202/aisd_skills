import type { ReactNode } from 'react';

export default function IntegrationsLayout({ children }: { children: ReactNode }) {
  return <div className="shell">{children}</div>;
}
