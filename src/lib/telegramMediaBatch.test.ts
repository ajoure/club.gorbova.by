import { describe, expect, it, vi } from 'vitest';
import { collectTelegramMediaUrls } from './telegramMediaBatch';
const urls=(ids:string[])=>Object.fromEntries(ids.map(id=>[id,`https://example.invalid/${id}`]));
describe('ready Telegram media batches',()=>{
  for(const count of [21,200]) it(`retrieves all ${count} files in batches of 20`,async()=>{
    const ids=Array.from({length:count},(_,i)=>`file-${i}`);const fetch=vi.fn(async(batch:string[])=>urls(batch));
    const result=await collectTelegramMediaUrls(ids,fetch);
    expect(Object.keys(result.urls)).toHaveLength(count);expect(result.pending).toEqual([]);
    expect(fetch.mock.calls.every(([batch])=>batch.length<=20)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(Math.ceil(count/20));
  });
  it('retries only missing URLs after partial results and errors',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(urls(['one'])).mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(urls(['two']));
    const result=await collectTelegramMediaUrls(['one','two'],fetch);
    expect(fetch.mock.calls.map(([batch])=>batch)).toEqual([['one','two'],['two'],['two']]);
    expect(result.pending).toEqual([]);
  });
  it('retains failures for explicit retry without an infinite request loop',async()=>{
    const fetch=vi.fn(async()=>({}));const result=await collectTelegramMediaUrls(['one'],fetch);
    expect(result.pending).toEqual(['one']);expect(fetch).toHaveBeenCalledTimes(3);
  });
});
