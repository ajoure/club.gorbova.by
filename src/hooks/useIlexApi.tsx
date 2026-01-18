import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface IlexSearchResult {
  url: string;
  title: string;
  description: string;
  date?: string;
  type?: string;
}

export interface IlexDocument {
  id: string;
  ilex_id: string;
  title: string;
  doc_type: string | null;
  doc_date: string | null;
  doc_number: string | null;
  content: string | null;
  metadata: Record<string, any>;
  saved_by: string;
  created_at: string;
  updated_at: string;
  source_url?: string | null;
  search_query?: string | null;
}

export interface AdvancedSearchParams {
  query?: string;
  docType?: string;
  docNumber?: string;
  organ?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
}

export interface BrowseResult {
  html: string;
  title: string;
  links: Array<{ url: string; text: string }>;
  requiresAuth?: boolean;
}

export interface LegalTextResult {
  text: string;
  title: string;
  source: string;
  url: string;
}

export interface AuthStatus {
  authenticated: boolean;
  message: string;
  hasCredentials: boolean;
}

export function useIlexApi() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'online' | 'offline' | 'checking' | 'unknown'>('unknown');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  const checkConnection = useCallback(async () => {
    setConnectionStatus('checking');
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('ilex-api', {
        body: { action: 'check_auth' },
      });
      
      if (error) {
        console.error('Connection check error:', error);
        setConnectionStatus('offline');
        setAuthStatus({ authenticated: false, message: error.message, hasCredentials: false });
        return false;
      }
      
      const isAuthenticated = data?.authenticated === true;
      setConnectionStatus(isAuthenticated ? 'online' : 'offline');
      setAuthStatus({
        authenticated: isAuthenticated,
        message: data?.message || '',
        hasCredentials: data?.hasCredentials ?? false,
      });
      
      // Update settings in database
      await supabase
        .from('ilex_settings')
        .update({
          last_connection_check: new Date().toISOString(),
          connection_status: isAuthenticated ? 'online' : 'offline',
          updated_at: new Date().toISOString(),
        })
        .eq('id', '00000000-0000-0000-0000-000000000001');
      
      return isAuthenticated;
    } catch (error) {
      console.error('Connection check failed:', error);
      setConnectionStatus('offline');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('ilex-api', {
        body: { action: 'refresh_session' },
      });
      
      if (error || !data?.success) {
        toast({
          title: 'Ошибка авторизации',
          description: data?.error || error?.message || 'Не удалось обновить сессию',
          variant: 'destructive',
        });
        setAuthStatus({ authenticated: false, message: data?.error || 'Ошибка', hasCredentials: true });
        return false;
      }
      
      toast({
        title: 'Сессия обновлена',
        description: 'Авторизация в iLex успешна',
      });
      
      setAuthStatus({ authenticated: true, message: 'Авторизован', hasCredentials: true });
      setConnectionStatus('online');
      return true;
    } catch (error) {
      console.error('Refresh session failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const search = useCallback(async (query: string): Promise<IlexSearchResult[]> => {
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('ilex-api', {
        body: { action: 'search', query },
      });
      
      if (error) {
        console.error('Search error:', error);
        toast({
          title: 'Ошибка поиска',
          description: error.message,
          variant: 'destructive',
        });
        return [];
      }
      
      if (!data?.success) {
        toast({
          title: 'Поиск не удался',
          description: data?.error || 'Неизвестная ошибка',
          variant: 'destructive',
        });
        return [];
      }
      
      return data.results || [];
    } catch (error) {
      console.error('Search failed:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось выполнить поиск',
        variant: 'destructive',
      });
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const advancedSearch = useCallback(async (params: AdvancedSearchParams): Promise<IlexSearchResult[]> => {
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('ilex-api', {
        body: { action: 'advanced_search', ...params },
      });
      
      if (error) {
        console.error('Advanced search error:', error);
        toast({
          title: 'Ошибка поиска',
          description: error.message,
          variant: 'destructive',
        });
        return [];
      }
      
      if (!data?.success) {
        toast({
          title: 'Поиск не удался',
          description: data?.error || 'Неизвестная ошибка',
          variant: 'destructive',
        });
        return [];
      }
      
      return data.results || [];
    } catch (error) {
      console.error('Advanced search failed:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось выполнить поиск',
        variant: 'destructive',
      });
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const fetchDocument = useCallback(async (url: string): Promise<{ content: string; title: string; cleanText: string } | null> => {
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('ilex-api', {
        body: { action: 'fetch_document', url },
      });
      
      if (error) {
        console.error('Fetch document error:', error);
        toast({
          title: 'Ошибка загрузки',
          description: error.message,
          variant: 'destructive',
        });
        return null;
      }
      
      if (!data?.success) {
        toast({
          title: 'Не удалось загрузить документ',
          description: data?.error || 'Неизвестная ошибка',
          variant: 'destructive',
        });
        return null;
      }
      
      return {
        content: data.content || '',
        title: data.title || 'Документ',
        cleanText: data.cleanText || data.content || '',
      };
    } catch (error) {
      console.error('Fetch document failed:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить документ',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const browseUrl = useCallback(async (url: string): Promise<BrowseResult | null> => {
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('ilex-api', {
        body: { action: 'browse', url },
      });
      
      if (error) {
        console.error('Browse error:', error);
        toast({
          title: 'Ошибка загрузки',
          description: error.message,
          variant: 'destructive',
        });
        return null;
      }
      
      if (!data?.success) {
        toast({
          title: 'Не удалось загрузить страницу',
          description: data?.error || 'Неизвестная ошибка',
          variant: 'destructive',
        });
        return null;
      }
      
      return {
        html: data.html || '',
        title: data.title || 'Страница',
        links: data.links || [],
      };
    } catch (error) {
      console.error('Browse failed:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить страницу',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const findLegalText = useCallback(async (query: string): Promise<LegalTextResult | null> => {
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('ilex-api', {
        body: { action: 'find_legal_text', query },
      });
      
      if (error) {
        console.error('Find legal text error:', error);
        toast({
          title: 'Ошибка поиска',
          description: error.message,
          variant: 'destructive',
        });
        return null;
      }
      
      if (!data?.success) {
        toast({
          title: 'Документ не найден',
          description: data?.error || 'Неизвестная ошибка',
          variant: 'destructive',
        });
        return null;
      }
      
      return {
        text: data.text || '',
        title: data.title || 'Документ',
        source: data.source || 'iLex Private',
        url: data.url || '',
      };
    } catch (error) {
      console.error('Find legal text failed:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось найти текст',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const saveDocument = useCallback(async (doc: {
    ilex_id: string;
    title: string;
    content: string;
    doc_type?: string;
    doc_date?: string;
    doc_number?: string;
    metadata?: Record<string, any>;
    source_url?: string;
    search_query?: string;
  }): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: 'Ошибка',
          description: 'Необходима авторизация',
          variant: 'destructive',
        });
        return false;
      }
      
      const { error } = await supabase
        .from('ilex_documents')
        .insert({
          ilex_id: doc.ilex_id,
          title: doc.title,
          content: doc.content,
          doc_type: doc.doc_type || null,
          doc_date: doc.doc_date || null,
          doc_number: doc.doc_number || null,
          metadata: doc.metadata || {},
          saved_by: user.id,
          source_url: doc.source_url || null,
          search_query: doc.search_query || null,
        });
      
      if (error) {
        console.error('Save document error:', error);
        toast({
          title: 'Ошибка сохранения',
          description: error.message,
          variant: 'destructive',
        });
        return false;
      }
      
      toast({
        title: 'Документ сохранён',
        description: 'Документ добавлен в избранное',
      });
      
      return true;
    } catch (error) {
      console.error('Save document failed:', error);
      return false;
    }
  }, [toast]);

  const getSavedDocuments = useCallback(async (): Promise<IlexDocument[]> => {
    try {
      const { data, error } = await supabase
        .from('ilex_documents')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Get saved documents error:', error);
        return [];
      }
      
      return (data || []) as IlexDocument[];
    } catch (error) {
      console.error('Get saved documents failed:', error);
      return [];
    }
  }, []);

  const deleteDocument = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('ilex_documents')
        .delete()
        .eq('id', id);
      
      if (error) {
        console.error('Delete document error:', error);
        toast({
          title: 'Ошибка удаления',
          description: error.message,
          variant: 'destructive',
        });
        return false;
      }
      
      toast({
        title: 'Документ удалён',
      });
      
      return true;
    } catch (error) {
      console.error('Delete document failed:', error);
      return false;
    }
  }, [toast]);

  return {
    isLoading,
    connectionStatus,
    authStatus,
    checkConnection,
    refreshSession,
    search,
    advancedSearch,
    fetchDocument,
    browseUrl,
    findLegalText,
    saveDocument,
    getSavedDocuments,
    deleteDocument,
  };
}
