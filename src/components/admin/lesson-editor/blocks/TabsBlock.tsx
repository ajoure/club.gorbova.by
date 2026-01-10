import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2 } from "lucide-react";

export interface TabItem {
  id: string;
  title: string;
  content: string;
}

export interface TabsContentData {
  tabs: TabItem[];
}

interface TabsBlockProps {
  content: TabsContentData;
  onChange: (content: TabsContentData) => void;
  isEditing?: boolean;
}

export function TabsBlock({ content, onChange, isEditing = true }: TabsBlockProps) {
  const tabs = content.tabs || [];
  const [activeTab, setActiveTab] = useState<string>(tabs[0]?.id || "");

  const addTab = () => {
    const newTab: TabItem = {
      id: crypto.randomUUID(),
      title: `Вкладка ${tabs.length + 1}`,
      content: "",
    };
    const newTabs = [...tabs, newTab];
    onChange({ ...content, tabs: newTabs });
    setActiveTab(newTab.id);
  };

  const updateTab = (id: string, field: "title" | "content", value: string) => {
    onChange({
      ...content,
      tabs: tabs.map((tab) =>
        tab.id === id ? { ...tab, [field]: value } : tab
      ),
    });
  };

  const removeTab = (id: string) => {
    const newTabs = tabs.filter((tab) => tab.id !== id);
    onChange({ ...content, tabs: newTabs });
    if (activeTab === id && newTabs.length > 0) {
      setActiveTab(newTabs[0].id);
    }
  };

  if (!isEditing) {
    if (tabs.length === 0) return null;
    
    return (
      <Tabs defaultValue={tabs[0]?.id} className="w-full">
        <TabsList className="w-full justify-start bg-muted/50 backdrop-blur-sm rounded-xl p-1 h-auto flex-wrap">
          {tabs.map((tab) => (
            <TabsTrigger 
              key={tab.id} 
              value={tab.id}
              className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-4">
            <div 
              className="prose prose-sm max-w-none dark:prose-invert p-4 rounded-xl bg-card/30 backdrop-blur-sm"
              dangerouslySetInnerHTML={{ __html: tab.content }}
            />
          </TabsContent>
        ))}
      </Tabs>
    );
  }

  return (
    <div className="space-y-3">
      {tabs.length > 0 && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full justify-start bg-muted/50 rounded-xl p-1 h-auto flex-wrap gap-1">
            {tabs.map((tab) => (
              <TabsTrigger 
                key={tab.id} 
                value={tab.id}
                className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {tab.title || "Без названия"}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={tab.title}
                  onChange={(e) => updateTab(tab.id, "title", e.target.value)}
                  placeholder="Название вкладки..."
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeTab(tab.id)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  disabled={tabs.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                value={tab.content}
                onChange={(e) => updateTab(tab.id, "content", e.target.value)}
                placeholder="Содержимое вкладки (HTML)..."
                className="min-h-[120px] font-mono text-sm"
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
      <Button
        variant="outline"
        onClick={addTab}
        className="w-full border-dashed"
      >
        <Plus className="h-4 w-4 mr-2" />
        Добавить вкладку
      </Button>
    </div>
  );
}
