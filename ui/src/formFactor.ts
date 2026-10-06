import { useSyncExternalStore } from 'react';

export type FormFactor = 'standard' | 'mobile' | 'kiosk';

const FORM_FACTOR_KEY = 'shellb.formFactor';
const listeners = new Set<() => void>();

function detectAuto(): FormFactor {
  if (typeof window === 'undefined') return 'standard';
  // Check URL query parameters
  const params = new URLSearchParams(window.location.search);
  const q = params.get('ui') || params.get('formFactor') || params.get('mode');
  if (q === 'mobile' || q === 'standard' || q === 'kiosk') return q;

  // Check URL hash
  if (window.location.hash.startsWith('#/mobile') || window.location.hash === '#mobile') return 'mobile';
  if (window.location.hash.startsWith('#/kiosk') || window.location.hash === '#kiosk') return 'kiosk';

  // Check stored preference
  try {
    const saved = localStorage.getItem(FORM_FACTOR_KEY);
    if (saved === 'mobile' || saved === 'standard' || saved === 'kiosk') return saved;
  } catch {
    /* private mode / access error */
  }

  // Auto-detect based on screen dimensions and touch capabilities
  const isMobileScreen = window.innerWidth <= 768;
  const isTouchHandheld = window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth <= 1024;
  return isMobileScreen || isTouchHandheld ? 'mobile' : 'standard';
}

let currentFormFactor: FormFactor = detectAuto();

function notify() {
  currentFormFactor = detectAuto();
  listeners.forEach(l => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === FORM_FACTOR_KEY) notify();
  });
  window.addEventListener('resize', () => {
    // Only auto-switch on resize if user has not explicitly pinned a preference in localStorage
    try {
      if (!localStorage.getItem(FORM_FACTOR_KEY)) notify();
    } catch {}
  });
  window.addEventListener('hashchange', () => {
    if (window.location.hash.startsWith('#/mobile') || window.location.hash.startsWith('#/kiosk')) notify();
  });
}

export function getFormFactor(): FormFactor {
  return currentFormFactor;
}

export function isFormFactorExplicit(): boolean {
  try {
    return !!localStorage.getItem(FORM_FACTOR_KEY);
  } catch {
    return false;
  }
}

export function setFormFactor(next: FormFactor | 'auto') {
  try {
    if (next === 'auto') {
      localStorage.removeItem(FORM_FACTOR_KEY);
      // clean hash if it was #/mobile
      if (window.location.hash === '#mobile' || window.location.hash === '#/mobile') {
        history.replaceState(null, '', '#/');
      }
    } else {
      localStorage.setItem(FORM_FACTOR_KEY, next);
    }
  } catch {}
  notify();
}

export function useFormFactor(): FormFactor {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => currentFormFactor,
    () => 'standard'
  );
}
