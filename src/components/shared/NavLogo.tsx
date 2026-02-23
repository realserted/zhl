'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import Image from 'next/image';

export default function NavLogo() {
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="w-48 h-16" />;
  }

  const logoSrc = theme === 'dark' ? '/zhl-logo-light.png' : '/zhl-logo-dark.png';

  return (
    <div className="flex items-center gap-4 border-r border-border pr-6 mr-6">
      <Image
        src={logoSrc}
        alt="Zero Hassle Landlord"
        width={200}
        height={60}
        priority
        className="h-16 w-auto"
      />
    </div>
  );
}
