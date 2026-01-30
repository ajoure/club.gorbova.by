import { ReactNode, createElement, Fragment } from "react";
import { useLocation, Navigate } from "react-router-dom";
import { overwriteLastRoute } from "./useLastRoute";

/**
 * Detect iOS Safari (iPhone, iPad, iPod)
 */
function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iP(hone|ad|od)/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
  return isIOS && isSafari;
}

/**
 * Check if running inside an iframe (lovable.dev preview)
 */
function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // If access denied - likely in iframe with cross-origin restrictions
    return true;
  }
}

/**
 * Check for lovable.dev preview URL flag
 */
function hasLovablePreviewFlag(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.search.includes('forceHideBadge');
}

/**
 * SYNC check: returns true if we should block admin route on iOS
 * Call this in component body (not in useEffect) for immediate redirect
 */
export function shouldBlockIOSAdmin(pathname: string): boolean {
  if (typeof window === 'undefined') return false;
  if (!isIOSSafari()) return false;
  
  const inPreview = isInIframe() || hasLovablePreviewFlag();
  if (!inPreview) return false;
  
  return pathname.startsWith('/admin');
}

interface IOSAdminGuardProps {
  children: ReactNode;
}

/**
 * Component wrapper for the guard - SYNCHRONOUS version
 * Returns Navigate immediately if iOS + iframe + admin route
 * This prevents React Router from even starting to match/load admin routes
 */
export function IOSAdminGuard({ children }: IOSAdminGuardProps): JSX.Element {
  const location = useLocation();
  
  // SYNC check - runs BEFORE Routes are rendered
  if (shouldBlockIOSAdmin(location.pathname)) {
    console.info('[iOS Admin Guard] SYNC block at:', location.pathname);
    overwriteLastRoute('/dashboard');
    return createElement(Navigate, { to: '/dashboard', replace: true });
  }
  
  return createElement(Fragment, null, children);
}
