import { describe, it, expect } from 'vitest';

/**
 * Test data: Windows-1251 encoded Russian text
 * "Дата ответа" in Windows-1251 = bytes [196, 224, 242, 224, 32, 238, 242, 226, 229, 242, 224]
 */

describe('Windows-1251 encoding detection', () => {
  it('should detect Windows-1251 when UTF-8 produces replacement characters', () => {
    // Simulate Windows-1251 bytes for "Дата ответа"
    const win1251Bytes = new Uint8Array([196, 224, 242, 224, 32, 238, 242, 226, 229, 242, 224]);
    
    // UTF-8 decoding will produce replacement characters
    const utf8Result = new TextDecoder('utf-8').decode(win1251Bytes);
    console.log('UTF-8 result:', utf8Result);
    
    // Check for Cyrillic
    const hasCyrillic = /[а-яА-ЯёЁ]/.test(utf8Result);
    const hasReplacement = utf8Result.includes('\uFFFD');
    
    console.log('Has Cyrillic:', hasCyrillic);
    console.log('Has replacement:', hasReplacement);
    
    // Windows-1251 decoding should produce correct text
    const win1251Result = new TextDecoder('windows-1251').decode(win1251Bytes);
    console.log('Windows-1251 result:', win1251Result);
    
    expect(win1251Result).toBe('Дата ответа');
    expect(!hasCyrillic || hasReplacement).toBe(true); // Should trigger fallback
  });
  
  it('should keep UTF-8 when text has valid Cyrillic', () => {
    // UTF-8 encoded "Дата ответа"
    const utf8Text = 'Дата ответа';
    const encoder = new TextEncoder();
    const utf8Bytes = encoder.encode(utf8Text);
    
    const decoded = new TextDecoder('utf-8').decode(utf8Bytes);
    const hasCyrillic = /[а-яА-ЯёЁ]/.test(decoded);
    const hasReplacement = decoded.includes('\uFFFD');
    
    expect(hasCyrillic).toBe(true);
    expect(hasReplacement).toBe(false);
    expect(decoded).toBe('Дата ответа');
  });
});
