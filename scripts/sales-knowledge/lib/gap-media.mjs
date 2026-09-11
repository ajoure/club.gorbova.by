import {mkdtemp,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {safeSubtitleUrl} from './course-provider-import.mjs';
import {inspectSubtitles} from './subtitles.mjs';
import {pcmParts,sha} from './course-stt.mjs';
const run=promisify(execFile);

/** Union coverage, including leading/trailing gaps. Strict parser validates first. */
export function captionGaps(raw,duration){
  const parsed=inspectSubtitles(raw,duration,'ru');
  if(parsed.quality_flags.some(x=>x!=='long_gap'))throw Error('other_caption_quality_flags');
  const stamp=s=>{const n=s.replace(',','.').split(':').map(Number);return Math.round(n.reduce((a,b)=>a*60+b,0)*1000);};
  let until=0;const gaps=[];
  const add=end=>{if(end-until>120000)gaps.push({gap_index:gaps.length,start_ms:until,end_ms:end});};
  for(let block of raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split(/\n[ \t]*\n/)){
    if(/^(NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block))continue;
    const line=block.split('\n').find(x=>x.includes('-->'));if(!line)continue;
    const m=line.match(/^(\S+)\s+-->\s+(\S+)/);const start=stamp(m[1]),end=stamp(m[2]);
    add(start);until=Math.max(until,end);
  }
  add(duration);
  if(!gaps.length||gaps.length>3||gaps.reduce((n,g)=>n+g.end_ms-g.start_ms,0)>600000
    ||gaps.reduce((n,g)=>n+Math.ceil((g.end_ms-g.start_ms)/90000),0)>7)throw Error('gap_budget');
  return {gaps,caption_sha256:sha(raw),content_sha256:parsed.content_sha256,chars:parsed.chars,quality_flags:parsed.quality_flags};
}

function attrs(line){
  const out={};let rest=line.slice(line.indexOf(':')+1);
  while(rest){const m=rest.match(/^([A-Z0-9-]+)=(?:"([^"]*)"|([^,]+))(?:,|$)/);
    if(!m||Object.hasOwn(out,m[1]))throw Error('hls_attributes_invalid');out[m[1]]=m[2]??m[3];rest=rest.slice(m[0].length);}
  return out;
}
const resolve=(s,base)=>safeSubtitleUrl(new URL(s,base).href).href;
export function audioPlaylist(master,url){
  if(!master.startsWith('#EXTM3U')||master.length>1000000)throw Error('hls_master_invalid');
  const tracks=master.split(/\r?\n/).filter(s=>s.startsWith('#EXT-X-MEDIA:')).map(attrs).filter(a=>a.TYPE==='AUDIO');
  if(tracks.length!==1||!tracks[0].URI)throw Error('hls_audio_ambiguous');return resolve(tracks[0].URI,url);
}
function byteRange(s){
  const m=s?.match(/^(\d+)@(\d+)$/);if(!m)throw Error('hls_explicit_range_required');
  const bytes=Number(m[1]),offset=Number(m[2]);
  if(!Number.isSafeInteger(bytes)||!Number.isSafeInteger(offset)||bytes<1||bytes>10000000||!Number.isSafeInteger(offset+bytes))throw Error('hls_range_invalid');
  return {offset,bytes};
}
export function parseAudioPlaylist(text,url,duration){
  if(!text.startsWith('#EXTM3U')||text.length>2000000||!text.includes('#EXT-X-ENDLIST')
    ||/#EXT-X-(?:KEY|DISCONTINUITY|GAP|PART|SKIP)(?::|\r?\n)/.test(text))throw Error('hls_playlist_unsupported');
  let init=null,seconds=null,range=null,at=0;const segments=[];
  for(const line of text.split(/\r?\n/)){
    if(line.startsWith('#EXT-X-MAP:')){if(init)throw Error('hls_map_ambiguous');const a=attrs(line);init={url:resolve(a.URI,url),...byteRange(a.BYTERANGE)};}
    else if(line.startsWith('#EXTINF:')){if(seconds!==null)throw Error('hls_duration_duplicate');seconds=Number(line.slice(8).split(',')[0]);if(!Number.isFinite(seconds)||seconds<=0||seconds>30)throw Error('hls_segment_duration_invalid');}
    else if(line.startsWith('#EXT-X-BYTERANGE:')){if(range)throw Error('hls_range_duplicate');range=byteRange(line.slice(17));}
    else if(line&&!line.startsWith('#')){
      if(seconds===null||!range)throw Error('hls_segment_incomplete');
      segments.push({url:resolve(line,url),start_ms:at,end_ms:at+seconds*1000,...range});at+=seconds*1000;seconds=null;range=null;
    }
  }
  if(!init||!segments.length||segments.length>10000||seconds!==null||range||Math.abs(at-duration)>1000)throw Error('hls_duration_mismatch');
  return {init,segments,duration_ms:at};
}
export function gapRange(playlist,gap){
  const selected=playlist.segments.filter(s=>s.end_ms>gap.start_ms&&s.start_ms<gap.end_ms);
  if(!selected.length||selected[0].start_ms>gap.start_ms||selected.at(-1).end_ms<gap.end_ms)throw Error('hls_gap_uncovered');
  for(let i=1;i<selected.length;i++)if(selected[i].url!==selected[0].url||selected[i].offset!==selected[i-1].offset+selected[i-1].bytes)throw Error('hls_range_not_contiguous');
  const first=selected[0],last=selected.at(-1),bytes=last.offset+last.bytes-first.offset;
  if(bytes>10000000)throw Error('hls_gap_size_limit');
  return {url:first.url,offset:first.offset,bytes,trim_ms:gap.start_ms-first.start_ms};
}

export function createGapMedia(fetchImpl=fetch){
  return {
    async range(url,offset,bytes){
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(bytes)||bytes<1||bytes>10000000)throw Error('range_budget');
      let target=safeSubtitleUrl(url);const end=offset+bytes-1,seen=new Set();
      for(let hop=0;hop<4;hop++){
        if(seen.has(target.href))throw Error('range_redirect_loop');seen.add(target.href);
        const r=await fetchImpl(target,{headers:{Range:`bytes=${offset}-${end}`},redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(60000)});
        if([301,302,303,307,308].includes(r.status)){
          const location=r.headers.get('location');if(!location)throw Error('range_redirect_missing');target=safeSubtitleUrl(new URL(location,target).href);continue;
        }
        if(r.status!==206||r.headers.get('content-range')?.split('/')[0]!==`bytes ${offset}-${end}`)throw Error('range_unverified');
        const reader=r.body?.getReader();if(!reader)throw Error('range_body_missing');let size=0;const chunks=[];
        try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>bytes)throw Error('range_size_mismatch');chunks.push(Buffer.from(p.value));}}
        finally{await reader.cancel().catch(()=>{});}
        if(size!==bytes)throw Error('range_size_mismatch');return Buffer.concat(chunks,size);
      }throw Error('range_redirect_limit');
    },
    async decode(bytes,trimMs,durationMs){
      if(!Buffer.isBuffer(bytes)||bytes.length>20000000||!Number.isFinite(trimMs)||trimMs<0||trimMs>30000
        ||!Number.isSafeInteger(durationMs)||durationMs<=0||durationMs>600000)throw Error('gap_decode_budget');
      const dir=await mkdtemp(join(tmpdir(),'caption-gap-'));await chmod(dir,0o700);
      try{
        const input=join(dir,'fragment.m4a'),output=join(dir,'decoded.pcm');await writeFile(input,bytes,{flag:'wx',mode:0o600});
        await run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file','-i',input,
          '-map','0:a:0','-vn','-af',`atrim=start=${trimMs/1000}:duration=${durationMs/1000},asetpts=PTS-STARTPTS`,
          '-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le','-t','601','-n',output],{timeout:120000,maxBuffer:65536});
        await chmod(output,0o600);const pcm=await readFile(output);
        if(Math.abs(pcm.length/32-durationMs)>1)throw Error('gap_decoded_duration_mismatch');return pcm;
      }catch{throw Error('gap_decode_failed');}finally{await rm(dir,{recursive:true,force:true});}
    },
  };
}

export async function captureGaps(publicIo,media,hlsUrl,gaps,duration){
  const playlistUrl=audioPlaylist(await publicIo.caption(hlsUrl),hlsUrl);
  const playlist=parseAudioPlaylist(await publicIo.caption(playlistUrl),playlistUrl,duration);
  const init=await media.range(playlist.init.url,playlist.init.offset,playlist.init.bytes),parts=[],captures=[];
  for(const gap of gaps){
    const range=gapRange(playlist,gap),fragment=await media.range(range.url,range.offset,range.bytes),bytes=Buffer.concat([init,fragment]);
    const pcm=await media.decode(bytes,range.trim_ms,gap.end_ms-gap.start_ms);
    if(Math.abs(pcm.length/32-(gap.end_ms-gap.start_ms))>1)throw Error('gap_decoded_duration_mismatch');
    const windows=pcmParts(pcm,gap.end_ms-gap.start_ms);
    // Keep every decoded sample in the tail; declared boundaries use source ms.
    // Decoder rounding within one millisecond is recorded separately, never padded.
    const tail=windows.parts.at(-1),body=pcm.subarray(tail.start_ms*32),header=Buffer.from(tail.wav.subarray(0,44));
    header.writeUInt32LE(36+body.length,4);header.writeUInt32LE(body.length,40);
    tail.wav=Buffer.concat([header,body]);tail.bytes=tail.wav.length;tail.audio_sha256=sha(tail.wav);tail.end_ms=gap.end_ms-gap.start_ms;
    for(const p of windows.parts)parts.push({...p,part_index:parts.length,gap_index:gap.gap_index,start_ms:p.start_ms+gap.start_ms,end_ms:p.end_ms+gap.start_ms});
    captures.push({...gap,media_sha256:sha(bytes),pcm_sha256:sha(pcm),decoded_duration_ms:pcm.length/32});
  }
  if(parts.length>7)throw Error('gap_budget');
  return {parts,captures,playlist_duration_ms:Math.round(playlist.duration_ms)};
}
