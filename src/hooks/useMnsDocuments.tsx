import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface MnsDocument {
  id: string;
  user_id: string;
  request_type: string;
  original_request: string;
  response_text: string;
  tax_authority: string | null;
  request_number: string | null;
  request_date: string | null;
  organization_name: string | null;
  created_at: string;
  updated_at: string;
}

interface GenerateResponseParams {
  requestText?: string;
  imageBase64?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export function useMnsDocuments() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["mns-documents", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mns_response_documents")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as MnsDocument[];
    },
    enabled: !!user,
  });

  const generateResponse = useCallback(
    async ({ requestText, imageBase64, conversationHistory }: GenerateResponseParams) => {
      if (!user) {
        toast({
          title: "Ошибка",
          description: "Необходимо войти в систему",
          variant: "destructive",
        });
        return null;
      }

      setIsGenerating(true);
      try {
        const payload = {
          requestText: typeof requestText === "string" && requestText.trim() ? requestText.trim() : undefined,
          imageBase64: typeof imageBase64 === "string" && imageBase64.trim() ? imageBase64.trim() : undefined,
          conversationHistory,
        };

        const { data, error } = await supabase.functions.invoke("mns-response-generator", {
          body: payload,
        });

        if (error) throw error;

        if (data.error) {
          toast({
            title: "Ошибка генерации",
            description: data.error,
            variant: "destructive",
          });
          return null;
        }

        return {
          responseText: data.responseText as string,
          needsClarification: data.needsClarification as boolean,
          requestType: data.requestType as string,
        };
      } catch (err) {
        console.error("Generate response error:", err);
        toast({
          title: "Ошибка",
          description: "Не удалось сгенерировать ответ",
          variant: "destructive",
        });
        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    [user, toast]
  );

  const saveDocument = useMutation({
    mutationFn: async (params: {
      originalRequest: string;
      responseText: string;
      requestType: string;
      taxAuthority?: string;
      requestNumber?: string;
      requestDate?: string;
      organizationName?: string;
    }) => {
      if (!user) throw new Error("User not authenticated");

      const { data, error } = await supabase
        .from("mns_response_documents")
        .insert({
          user_id: user.id,
          original_request: params.originalRequest,
          response_text: params.responseText,
          request_type: params.requestType,
          tax_authority: params.taxAuthority || null,
          request_number: params.requestNumber || null,
          request_date: params.requestDate || null,
          organization_name: params.organizationName || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mns-documents"] });
      toast({
        title: "Сохранено",
        description: "Документ добавлен в историю",
      });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось сохранить документ",
        variant: "destructive",
      });
    },
  });

  const deleteDocument = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("mns_response_documents")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mns-documents"] });
      toast({
        title: "Удалено",
        description: "Документ удален из истории",
      });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось удалить документ",
        variant: "destructive",
      });
    },
  });

  return {
    documents,
    isLoading,
    isGenerating,
    generateResponse,
    saveDocument,
    deleteDocument,
  };
}
