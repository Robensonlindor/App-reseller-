import React from 'react';
import { safeStorage } from '../../lib/safeStorage';

interface PlayUpSiteLogoProps {
  className?: string;
}

/**
 * Renders the exact PlayUp Reseller square rounded-icon logo
 * at the top of the site and mobile application without any modification.
 */
export const PlayUpSiteLogo: React.FC<PlayUpSiteLogoProps> = ({ className = 'w-11 h-11' }) => {
  const customExactSiteLogo = safeStorage.getItem('playup_exact_site_logo_data_url');

  return (
    <img
      src={customExactSiteLogo || '/playup-site-logo.svg'}
      alt="PlayUp Reseller"
      className={`${className} object-contain select-none shrink-0`}
      draggable={false}
      referrerPolicy="no-referrer"
    />
  );
};
