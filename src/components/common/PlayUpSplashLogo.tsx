import React from 'react';
import { safeStorage } from '../../lib/safeStorage';

interface PlayUpSplashLogoProps {
  className?: string;
}

/**
 * Renders the exact PlayUp Reseller logo at the center of the splash screen
 * without modifying its colors, shape, text, proportions, or design.
 */
export const PlayUpSplashLogo: React.FC<PlayUpSplashLogoProps> = ({ className = 'w-[78%] max-w-[300px] h-auto' }) => {
  const customExactLogoDataUrl = safeStorage.getItem('playup_exact_splash_logo_data_url');

  return (
    <img
      src={customExactLogoDataUrl || '/playup-splash-logo.svg'}
      alt="PlayUp Reseller"
      className={`${className} object-contain select-none pointer-events-none`}
      draggable={false}
      referrerPolicy="no-referrer"
    />
  );
};
