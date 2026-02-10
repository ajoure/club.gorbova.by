import { useState, useEffect, useRef } from 'react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Search, 
  FileText, 
  Star, 
  Settings, 
  Wifi, 
  WifiOff, 
  Loader2, 
  Download,
  FileDown,
  Trash2,
  ExternalLink,
  RefreshCw,
  BookOpen,
  Eye,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Filter,
  Home
} from 'lucide-react';
import { useIlexApi, IlexSearchResult, IlexDocument, AdvancedSearchParams } from '@/hooks/useIlexApi';
import { exportToDocx, exportToPdf } from '@/utils/exportDocument';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import DOMPurify from 'dompurify';

const DOCUMENT_TYPES = [
  { value: 'all', label: 'Все типы' },
  { value: 'law', label: 'Закон' },
  { value: 'decree', label: 'Указ' },
  { value: 'resolution', label: 'Постановление' },
  { value: 'decision', label: 'Решение' },
  { value: 'order', label: 'Приказ' },
  { value: 'instruction', label: 'Инструкция' },
  { value: 'regulation', label: 'Положение' },
];

const DOCUMENT_STATUSES = [
  { value: 'all', label: 'Все статусы' },
  { value: 'active', label: 'Действующий' },
  { value: 'inactive', label: 'Утратил силу' },
];

export default function AdminIlex() {
  const { 
    isLoading, 
    connectionStatus, 
    authStatus,
    checkConnection, 
    refreshSession,
    search,
    advancedSearch,
    fetchDocument,
    browseUrl,
    saveDocument,
    getSavedDocuments,
    deleteDocument 
  } = useIlexApi();
  
  const [activeTab, setActiveTab] = useState('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<IlexSearchResult[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<{ url: string; content: string; title: string; cleanText: string } | null>(null);
  const [savedDocuments, setSavedDocuments] = useState<IlexDocument[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isFetchingDocument, setIsFetchingDocument] = useState(false);
  const [lastSearchQuery, setLastSearchQuery] = useState('');
  
  // Advanced search state
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [advancedParams, setAdvancedParams] = useState<AdvancedSearchParams>({
    docType: 'all',
    docNumber: '',
    organ: '',
    dateFrom: '',
    dateTo: '',
    status: 'all',
  });
  
  // Browser state
  const [browserUrl, setBrowserUrl] = useState('https://ilex-private.ilex.by');
  const [browserHistory, setBrowserHistory] = useState<string[]>(['https://ilex-private.ilex.by']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [browserHtml, setBrowserHtml] = useState('');
  const [browserTitle, setBrowserTitle] = useState('');
  const [isBrowsing, setIsBrowsing] = useState(false);
  const browserContentRef = useRef<HTMLDivElement>(null);

  // Load saved documents on mount
  useEffect(() => {
    loadSavedDocuments();
  }, []);

  const loadSavedDocuments = async () => {
    const docs = await getSavedDocuments();
    setSavedDocuments(docs);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    setLastSearchQuery(searchQuery);
    
    let results: IlexSearchResult[];
    
    if (showAdvancedSearch) {
      results = await advancedSearch({
        query: searchQuery,
        ...advancedParams,
      });
    } else {
      results = await search(searchQuery);
    }
    
    setSearchResults(results);
    setIsSearching(false);
  };

  const handleViewDocument = async (url: string) => {
    setIsFetchingDocument(true);
    const doc = await fetchDocument(url);
    if (doc) {
      setSelectedDocument({ url, ...doc });
      setActiveTab('document');
    }
    setIsFetchingDocument(false);
  };

  const handleSaveDocument = async () => {
    if (!selectedDocument) return;
    
    const success = await saveDocument({
      ilex_id: selectedDocument.url,
      title: selectedDocument.title,
      content: selectedDocument.cleanText,
      source_url: selectedDocument.url,
      search_query: lastSearchQuery,
    });
    
    if (success) {
      loadSavedDocuments();
    }
  };

  const handleDeleteDocument = async (id: string) => {
    const success = await deleteDocument(id);
    if (success) {
      loadSavedDocuments();
    }
  };

  const handleExportDocx = () => {
    if (!selectedDocument) return;
    const filename = `${selectedDocument.title.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}.docx`;
    exportToDocx(selectedDocument.cleanText, filename);
  };

  const handleExportPdf = () => {
    if (!selectedDocument) return;
    const filename = `${selectedDocument.title.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}.pdf`;
    exportToPdf(selectedDocument.cleanText, filename);
  };

  // Browser navigation
  const navigateTo = async (url: string) => {
    setIsBrowsing(true);
    setBrowserUrl(url);
    
    const result = await browseUrl(url);
    if (result) {
      setBrowserHtml(result.html);
      setBrowserTitle(result.title);
      
      // Update history
      const newHistory = browserHistory.slice(0, historyIndex + 1);
      newHistory.push(url);
      setBrowserHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
    
    setIsBrowsing(false);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const url = browserHistory[newIndex];
      setBrowserUrl(url);
      navigateWithoutHistory(url);
    }
  };

  const goForward = () => {
    if (historyIndex < browserHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const url = browserHistory[newIndex];
      setBrowserUrl(url);
      navigateWithoutHistory(url);
    }
  };

  const navigateWithoutHistory = async (url: string) => {
    setIsBrowsing(true);
    const result = await browseUrl(url);
    if (result) {
      setBrowserHtml(result.html);
      setBrowserTitle(result.title);
    }
    setIsBrowsing(false);
  };

  const goHome = () => {
    navigateTo('https://ilex-private.ilex.by');
  };

  // Handle link clicks in browser content
  const handleBrowserClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a');
    
    if (link) {
      e.preventDefault();
      let href = link.getAttribute('href');
      
      if (href) {
        // Convert relative URLs to absolute
        if (href.startsWith('/')) {
          href = `https://ilex-private.ilex.by${href}`;
        } else if (!href.startsWith('http')) {
          href = `https://ilex-private.ilex.by/${href}`;
        }
        
        // Only navigate to ilex-private.ilex.by URLs
        if (href.includes('ilex-private.ilex.by')) {
          navigateTo(href);
        } else {
          window.open(href, '_blank');
        }
      }
    }
  };

  // Save document from browser
  const handleSaveFromBrowser = async () => {
    if (!browserHtml || !browserTitle) return;
    
    // Extract clean text from HTML (sanitize first to prevent XSS during parsing)
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = DOMPurify.sanitize(browserHtml, {
      FORBID_TAGS: ['script', 'iframe', 'form'],
      FORBID_ATTR: ['onclick', 'onload', 'onerror'],
    });
    const cleanText = tempDiv.textContent || tempDiv.innerText || '';
    
    const success = await saveDocument({
      ilex_id: browserUrl,
      title: browserTitle,
      content: cleanText,
      source_url: browserUrl,
    });
    
    if (success) {
      loadSavedDocuments();
    }
  };

  const getConnectionStatusBadge = () => {
    if (authStatus) {
      if (authStatus.authenticated) {
        return <Badge variant="default" className="bg-green-500"><Wifi className="h-3 w-3 mr-1" />Авторизован</Badge>;
      } else if (!authStatus.hasCredentials) {
        return <Badge variant="outline" className="text-amber-600 border-amber-600"><WifiOff className="h-3 w-3 mr-1" />Нет учётных данных</Badge>;
      } else {
        return <Badge variant="destructive"><WifiOff className="h-3 w-3 mr-1" />Не авторизован</Badge>;
      }
    }
    
    switch (connectionStatus) {
      case 'online':
        return <Badge variant="default" className="bg-green-500"><Wifi className="h-3 w-3 mr-1" />Онлайн</Badge>;
      case 'offline':
        return <Badge variant="destructive"><WifiOff className="h-3 w-3 mr-1" />Офлайн</Badge>;
      case 'checking':
        return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Проверка...</Badge>;
      default:
        return <Badge variant="outline">Неизвестно</Badge>;
    }
  };

  // Sanitize HTML for browser display
  const sanitizedHtml = DOMPurify.sanitize(browserHtml, {
    ADD_TAGS: ['style'],
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['script', 'iframe', 'form'],
    FORBID_ATTR: ['onclick', 'onload', 'onerror'],
  });

  return (
    <AdminLayout>
      <div className="container mx-auto py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="h-6 w-6" />
              iLex Private
            </h1>
            <p className="text-muted-foreground">
              Работа с законодательством Республики Беларусь
            </p>
          </div>
          <div className="flex items-center gap-3">
            {getConnectionStatusBadge()}
            {authStatus && !authStatus.authenticated && authStatus.hasCredentials && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={refreshSession}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Переавторизоваться
              </Button>
            )}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={checkConnection}
              disabled={connectionStatus === 'checking'}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${connectionStatus === 'checking' ? 'animate-spin' : ''}`} />
              Проверить
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="search" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Поиск
            </TabsTrigger>
            <TabsTrigger value="browser" className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Браузер
            </TabsTrigger>
            <TabsTrigger value="document" className="flex items-center gap-2" disabled={!selectedDocument}>
              <FileText className="h-4 w-4" />
              Документ
            </TabsTrigger>
            <TabsTrigger value="favorites" className="flex items-center gap-2">
              <Star className="h-4 w-4" />
              Избранное
              {savedDocuments.length > 0 && (
                <Badge variant="secondary" className="ml-1">{savedDocuments.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Настройки
            </TabsTrigger>
          </TabsList>

          {/* Search Tab */}
          <TabsContent value="search" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Поиск НПА</CardTitle>
                <CardDescription>
                  Введите запрос для поиска нормативных правовых актов
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form onSubmit={handleSearch} className="flex gap-2">
                  <Input
                    placeholder="Например: закон о предпринимательстве"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1"
                  />
                  <Button type="submit" disabled={isSearching || !searchQuery.trim()}>
                    {isSearching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    <span className="ml-2">Найти</span>
                  </Button>
                </form>

                {/* Advanced Search */}
                <Collapsible open={showAdvancedSearch} onOpenChange={setShowAdvancedSearch}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="flex items-center gap-2 text-muted-foreground">
                      <Filter className="h-4 w-4" />
                      Расширенный поиск
                      <ChevronDown className={`h-4 w-4 transition-transform ${showAdvancedSearch ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
                      <div className="space-y-2">
                        <Label>Тип документа</Label>
                        <Select 
                          value={advancedParams.docType} 
                          onValueChange={(value) => setAdvancedParams(prev => ({ ...prev, docType: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите тип" />
                          </SelectTrigger>
                          <SelectContent>
                            {DOCUMENT_TYPES.map(type => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Номер документа</Label>
                        <Input
                          placeholder="№ документа"
                          value={advancedParams.docNumber}
                          onChange={(e) => setAdvancedParams(prev => ({ ...prev, docNumber: e.target.value }))}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Принявший орган</Label>
                        <Input
                          placeholder="Например: Совет Министров"
                          value={advancedParams.organ}
                          onChange={(e) => setAdvancedParams(prev => ({ ...prev, organ: e.target.value }))}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Дата от</Label>
                        <Input
                          type="date"
                          value={advancedParams.dateFrom}
                          onChange={(e) => setAdvancedParams(prev => ({ ...prev, dateFrom: e.target.value }))}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Дата до</Label>
                        <Input
                          type="date"
                          value={advancedParams.dateTo}
                          onChange={(e) => setAdvancedParams(prev => ({ ...prev, dateTo: e.target.value }))}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Статус</Label>
                        <Select 
                          value={advancedParams.status} 
                          onValueChange={(value) => setAdvancedParams(prev => ({ ...prev, status: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите статус" />
                          </SelectTrigger>
                          <SelectContent>
                            {DOCUMENT_STATUSES.map(status => (
                              <SelectItem key={status.value} value={status.value}>
                                {status.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Результаты ({searchResults.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-3">
                      {searchResults.map((result, index) => (
                        <div 
                          key={index}
                          className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-sm line-clamp-2">
                                {result.title}
                              </h4>
                              {result.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {result.description}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground mt-1 truncate">
                                {result.url}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleViewDocument(result.url)}
                                disabled={isFetchingDocument}
                              >
                                {isFetchingDocument ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                asChild
                              >
                                <a href={result.url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Browser Tab */}
          <TabsContent value="browser" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="outline" onClick={goBack} disabled={historyIndex <= 0 || isBrowsing}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="outline" onClick={goForward} disabled={historyIndex >= browserHistory.length - 1 || isBrowsing}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => navigateTo(browserUrl)} disabled={isBrowsing}>
                    {isBrowsing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                  <Button size="icon" variant="outline" onClick={goHome} disabled={isBrowsing}>
                    <Home className="h-4 w-4" />
                  </Button>
                  <Input
                    className="flex-1"
                    value={browserUrl}
                    onChange={(e) => setBrowserUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        navigateTo(browserUrl);
                      }
                    }}
                    placeholder="URL..."
                  />
                  <Button variant="outline" onClick={handleSaveFromBrowser} disabled={!browserHtml || isBrowsing}>
                    <Star className="h-4 w-4 mr-2" />
                    Сохранить
                  </Button>
                </div>
                {browserTitle && (
                  <CardDescription className="mt-2 truncate">
                    {browserTitle}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[600px] border rounded-lg">
                  {isBrowsing ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : browserHtml ? (
                    <div 
                      ref={browserContentRef}
                      className="p-4 prose prose-sm max-w-none dark:prose-invert"
                      onClick={handleBrowserClick}
                      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                      <Globe className="h-12 w-12 mb-4 opacity-50" />
                      <p className="text-center">
                        Нажмите кнопку обновления или введите URL для начала просмотра
                      </p>
                      <Button className="mt-4" onClick={goHome}>
                        Открыть iLex Private
                      </Button>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Document Tab */}
          <TabsContent value="document" className="space-y-4">
            {selectedDocument ? (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{selectedDocument.title}</CardTitle>
                      <CardDescription className="truncate max-w-xl">
                        {selectedDocument.url}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={handleSaveDocument}>
                        <Star className="h-4 w-4 mr-2" />
                        В избранное
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleExportDocx}>
                        <FileText className="h-4 w-4 mr-2" />
                        DOCX
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleExportPdf}>
                        <FileDown className="h-4 w-4 mr-2" />
                        PDF
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px] border rounded-lg p-4">
                    <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">
                      {selectedDocument.cleanText || selectedDocument.content}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Выберите документ из результатов поиска
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Favorites Tab */}
          <TabsContent value="favorites" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Сохранённые документы</CardTitle>
                <CardDescription>
                  Документы, добавленные в избранное
                </CardDescription>
              </CardHeader>
              <CardContent>
                {savedDocuments.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    Нет сохранённых документов
                  </div>
                ) : (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-3">
                      {savedDocuments.map((doc) => (
                        <div 
                          key={doc.id}
                          className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-sm line-clamp-2">
                                {doc.title}
                              </h4>
                              <p className="text-xs text-muted-foreground mt-1">
                                Сохранено: {format(new Date(doc.created_at), 'dd MMM yyyy, HH:mm', { locale: ru })}
                              </p>
                              {doc.search_query && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Поиск: "{doc.search_query}"
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedDocument({
                                    url: doc.ilex_id,
                                    title: doc.title,
                                    content: doc.content || '',
                                    cleanText: doc.content || '',
                                  });
                                  setActiveTab('document');
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (doc.content) {
                                    exportToDocx(doc.content, `${doc.title.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}.docx`);
                                  }
                                }}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleDeleteDocument(doc.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Статус подключения</CardTitle>
                <CardDescription>
                  Проверка доступности iLex Private
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {connectionStatus === 'online' ? (
                      <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
                    ) : connectionStatus === 'offline' ? (
                      <div className="h-3 w-3 rounded-full bg-red-500" />
                    ) : (
                      <div className="h-3 w-3 rounded-full bg-gray-400" />
                    )}
                    <div>
                      <p className="font-medium">iLex Private</p>
                      <p className="text-sm text-muted-foreground">ilex-private.ilex.by</p>
                    </div>
                  </div>
                  {getConnectionStatusBadge()}
                </div>
                <Button 
                  className="w-full" 
                  onClick={checkConnection}
                  disabled={connectionStatus === 'checking'}
                >
                  {connectionStatus === 'checking' ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Проверка...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Проверить подключение
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>О модуле</CardTitle>
              </CardHeader>
              <CardContent className="prose prose-sm max-w-none dark:prose-invert">
                <p>
                  Модуль iLex Private предоставляет доступ к правовой информационной системе
                  для работы с законодательством Республики Беларусь.
                </p>
                <h4>Возможности:</h4>
                <ul>
                  <li>Поиск нормативных правовых актов</li>
                  <li>Расширенный поиск с фильтрами по типу, органу, дате</li>
                  <li>Встроенный браузер для навигации по iLex</li>
                  <li>Просмотр текста документов</li>
                  <li>Сохранение документов в избранное</li>
                  <li>Экспорт в DOCX и PDF</li>
                  <li>API для автоматического поиска текстов НПА</li>
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
