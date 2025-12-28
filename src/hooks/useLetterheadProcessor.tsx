import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import mammoth from "mammoth";

export interface CompanyRequisites {
  companyName: string;
  legalForm: string;
  unp: string;
  legalAddress: string;
  postalAddress: string;
  phone: string;
  fax: string;
  email: string;
  website: string;
  bankName: string;
  bankAccount: string;
  bankCode: string;
}

export interface ProcessedLetterhead {
  requisites: CompanyRequisites;
  headerImageBase64?: string;
  footerImageBase64?: string;
  rawText: string;
  originalBase64: string;
  originalFilename: string;
  originalMimeType: string;
  type: "image" | "word" | "pdf" | "other";
}

const DEFAULT_REQUISITES: CompanyRequisites = {
  companyName: "",
  legalForm: "",
  unp: "",
  legalAddress: "",
  postalAddress: "",
  phone: "",
  fax: "",
  email: "",
  website: "",
  bankName: "",
  bankAccount: "",
  bankCode: "",
};

const LETTERHEAD_PROCESSED_KEY = "mns_letterhead_processed";

async function base64ToArrayBuffer(base64: string): Promise<ArrayBuffer> {
  const base64Data = base64.includes(",") ? base64.split(",")[1] : base64;
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function extractWordText(base64: string): Promise<string> {
  try {
    const arrayBuffer = await base64ToArrayBuffer(base64);
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } catch (error) {
    console.error("Failed to extract Word content:", error);
    return "";
  }
}

export function useLetterheadProcessor() {
  const [processedLetterhead, setProcessedLetterhead] = useState<ProcessedLetterhead | null>(() => {
    const stored = localStorage.getItem(LETTERHEAD_PROCESSED_KEY);
    return stored ? JSON.parse(stored) : null;
  });
  const [isProcessing, setIsProcessing] = useState(false);

  const saveProcessedLetterhead = useCallback((data: ProcessedLetterhead | null) => {
    if (data) {
      localStorage.setItem(LETTERHEAD_PROCESSED_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(LETTERHEAD_PROCESSED_KEY);
    }
    setProcessedLetterhead(data);
  }, []);

  const processLetterhead = useCallback(async (
    base64: string,
    filename: string,
    mimeType: string,
    type: "image" | "word" | "pdf" | "other"
  ): Promise<ProcessedLetterhead> => {
    setIsProcessing(true);
    
    try {
      let rawText = "";
      
      // Extract text from Word documents
      if (type === "word") {
        rawText = await extractWordText(base64);
      }
      
      // Use AI to classify and extract requisites
      const { data, error } = await supabase.functions.invoke("letterhead-processor", {
        body: {
          rawText,
          imageBase64: type === "image" ? base64 : undefined,
          fileType: type,
        },
      });

      if (error) {
        console.error("Letterhead processing error:", error);
        throw error;
      }

      const processed: ProcessedLetterhead = {
        requisites: data?.requisites || DEFAULT_REQUISITES,
        headerImageBase64: type === "image" ? base64 : undefined,
        rawText: data?.cleanedText || rawText,
        originalBase64: base64,
        originalFilename: filename,
        originalMimeType: mimeType,
        type,
      };

      saveProcessedLetterhead(processed);
      return processed;
    } finally {
      setIsProcessing(false);
    }
  }, [saveProcessedLetterhead]);

  const updateRequisites = useCallback((updates: Partial<CompanyRequisites>) => {
    if (!processedLetterhead) return;
    
    const updated: ProcessedLetterhead = {
      ...processedLetterhead,
      requisites: {
        ...processedLetterhead.requisites,
        ...updates,
      },
    };
    
    saveProcessedLetterhead(updated);
  }, [processedLetterhead, saveProcessedLetterhead]);

  const clearLetterhead = useCallback(() => {
    saveProcessedLetterhead(null);
  }, [saveProcessedLetterhead]);

  return {
    processedLetterhead,
    isProcessing,
    processLetterhead,
    updateRequisites,
    clearLetterhead,
    saveProcessedLetterhead,
  };
}
