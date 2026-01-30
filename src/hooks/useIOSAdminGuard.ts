import { useEffect, ReactNode, createElement, Fragment } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
 * Global guard: on iOS Safari in iframe (lovable.dev preview)
 * immediately redirect from /admin/* to /dashboard
 * 
 * This prevents:
 * - Auto-loading heavy admin pages causing memory crash
 * - lovable.dev editor crashes due to iOS memory limits
 * 
 * Must be called INSIDE BrowserRouter but BEFORE Routes
 */
export function useIOSAdminGuard(): void {
  const location = useLocation();
  const navigate = useNavigate();
  
  useEffect(() => {
    // Guard conditions:
    // 1. iOS Safari
    // 2. Page is in iframe (lovable.dev preview) OR has preview flag
    // 3. Current route is /admin/*
    
    if (!isIOSSafari()) return;
    
    const inPreviewContext = isInIframe() || hasLovablePreviewFlag();
    if (!inPreviewContext) return;
    
    if (!location.pathname.startsWith('/admin')) return;
    
    console.info('[iOS Admin Guard] Detected iOS Safari in lovable.dev preview at admin route:', location.pathname);
    console.info('[iOS Admin Guard] Redirecting to /dashboard to prevent memory crash');
    
    // Overwrite lastRoute so we don't keep trying to restore admin
    overwriteLastRoute('/dashboard');
    
    // Immediate redirect to lighter page
    navigate('/dashboard', { replace: true });
  }, [location.pathname, navigate]);
}

interface IOSAdminGuardProps {
  children: ReactNode;
}

/**
 * Component wrapper for the guard
 * Use this at the top level inside BrowserRouter
 */
export function IOSAdminGuard({ children }: IOSAdminGuardProps): JSX.Element {
  useIOSAdminGuard();
  return createElement(Fragment, null, children);
}
