export function isSupportWorkspaceRoute(pathname: string, search: string): boolean {
  return pathname === '/admin/communication' && new URLSearchParams(search).get('support_mode') === '1';
}
