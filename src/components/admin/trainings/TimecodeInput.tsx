import React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TimecodeInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

/**
 * Masked timecode input for HH:MM:SS format
 * Validates: hours 0-99, minutes 0-59, seconds 0-59
 * Only accepts digits, auto-formats with colons
 */
export function TimecodeInput({ 
  value, 
  onChange, 
  className,
  placeholder = "00:00:00" 
}: TimecodeInputProps) {
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Extract only digits
    const raw = e.target.value.replace(/\D/g, "");
    
    // Limit to 6 digits (HHMMSS)
    const digits = raw.slice(0, 6);
    
    if (digits.length === 0) {
      onChange("");
      return;
    }
    
    // Format as HH:MM:SS
    let formatted = "";
    
    // Hours (first 2 digits, max 99)
    const hoursStr = digits.slice(0, 2);
    let hours = parseInt(hoursStr) || 0;
    if (hours > 99) hours = 99;
    formatted = hoursStr.length === 2 
      ? hours.toString().padStart(2, "0") 
      : hoursStr;
    
    if (digits.length > 2) {
      // Minutes (next 2 digits, max 59)
      const minsStr = digits.slice(2, 4);
      let mins = parseInt(minsStr) || 0;
      if (mins > 59) mins = 59;
      formatted += ":" + (minsStr.length === 2 
        ? mins.toString().padStart(2, "0") 
        : minsStr);
      
      if (digits.length > 4) {
        // Seconds (last 2 digits, max 59)
        const secsStr = digits.slice(4, 6);
        let secs = parseInt(secsStr) || 0;
        if (secs > 59) secs = 59;
        formatted += ":" + (secsStr.length === 2 
          ? secs.toString().padStart(2, "0") 
          : secsStr);
      }
    }
    
    onChange(formatted);
  };

  // Handle paste - clean and format
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    const digits = pasted.replace(/\D/g, "").slice(0, 6);
    
    if (digits.length === 0) return;
    
    // Format pasted digits
    let formatted = "";
    const hours = digits.slice(0, 2);
    formatted = hours;
    
    if (digits.length > 2) {
      let mins = parseInt(digits.slice(2, 4)) || 0;
      if (mins > 59) mins = 59;
      formatted += ":" + mins.toString().padStart(2, "0");
      
      if (digits.length > 4) {
        let secs = parseInt(digits.slice(4, 6)) || 0;
        if (secs > 59) secs = 59;
        formatted += ":" + secs.toString().padStart(2, "0");
      }
    }
    
    onChange(formatted);
  };
  
  return (
    <Input
      value={value || ""}
      onChange={handleChange}
      onPaste={handlePaste}
      placeholder={placeholder}
      className={cn("font-mono tabular-nums", className)}
      maxLength={8}
      inputMode="numeric"
    />
  );
}
