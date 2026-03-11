import { useEffect, useState } from "react";

/**
 * Shows loading only after a delay, to avoid spinner flicker on fast responses.
 */
export function useDelayedLoading(isLoading: boolean, delayMs = 1200): boolean {
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowLoading(false);
      return;
    }

    const timeout = setTimeout(() => setShowLoading(true), delayMs);
    return () => clearTimeout(timeout);
  }, [isLoading, delayMs]);

  return showLoading;
}
