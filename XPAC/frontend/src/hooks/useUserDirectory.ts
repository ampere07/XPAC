import { useEffect, useState } from 'react';
import { UserDirectory, loadUserDirectory } from '../utils/userDisplay';

/**
 * Provides the shared `email -> full name` directory to a view.
 *
 * Backed by `requestCache`, so mounting this in several components still results in a
 * single `/users` request rather than one per component or per row.
 */
export const useUserDirectory = (enabled: boolean = true): UserDirectory => {
  const [directory, setDirectory] = useState<UserDirectory>({});

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    loadUserDirectory().then(result => {
      if (active) setDirectory(result);
    });

    return () => {
      active = false;
    };
  }, [enabled]);

  return directory;
};

export default useUserDirectory;
