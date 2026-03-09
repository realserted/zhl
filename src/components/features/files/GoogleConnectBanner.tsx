'use client';

import { useState } from 'react';
import { Button } from '@/components/shared/Button';
import { CloudOff, ExternalLink, LogOut } from 'lucide-react';
import { initiateGoogleAuth, disconnectGoogle } from '@/lib/db/google-auth';

interface GoogleConnectBannerProps {
  connected: boolean;
  googleEmail: string | null;
  onStatusChange: () => void;
}

export default function GoogleConnectBanner({ connected, googleEmail, onStatusChange }: GoogleConnectBannerProps) {
  const [disconnecting, setDisconnecting] = useState(false);

  const handleConnect = () => {
    initiateGoogleAuth(window.location.pathname);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    const ok = await disconnectGoogle();
    setDisconnecting(false);
    if (ok) {
      onStatusChange();
    }
  };

  if (connected) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-green-500/10 border border-green-500/20 text-sm">
        <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-green-300">
          Google Drive connected{googleEmail ? ` as ${googleEmail}` : ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDisconnect}
          isLoading={disconnecting}
          className="ml-auto text-muted-foreground hover:text-red-400"
        >
          <LogOut className="h-3.5 w-3.5 mr-1" />
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 px-4 py-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
      <CloudOff className="h-5 w-5 text-amber-400 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium text-amber-300">Google Drive not connected</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect your Google account to access and manage project files.
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={handleConnect}>
        <ExternalLink className="h-3.5 w-3.5 mr-1" />
        Connect Google Drive
      </Button>
    </div>
  );
}
