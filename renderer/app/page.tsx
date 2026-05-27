'use client';

import { useEffect, useState } from 'react';

export default function HomePage() {
  const [version, setVersion] = useState<string>('—');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.agentDashboard) {
      setVersion(window.agentDashboard.version);
    }
  }, []);

  return (
    <main className="container">
      <h1>Agent Dashboard</h1>
      <p className="subtitle">Scaffold ready · preload version: {version}</p>
      <p className="hint">M0 complete when you can see this with the version filled in.</p>
    </main>
  );
}

declare global {
  interface Window {
    agentDashboard?: { version: string };
  }
}
