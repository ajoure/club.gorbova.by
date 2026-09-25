import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseAudioPlaylist,gapRange,longAudioRanges,createGapMedia,captureGaps} from './lib/gap-media.mjs';
import {openLongAudio} from './lib/long-course-stt.mjs';
const box=(type,payload)=>{const h=Buffer.alloc(8);h.writeUInt32BE(payload.length+8);h.write(type,4);return Buffer.concat([h,payload]);};
// Kinescope AAC uses a 2048-sample edit, absent from a plain ffmpeg HLS fixture.
function withAacEdit(buf){
 const el=Buffer.alloc(20);el.writeUInt32BE(1,4);el.writeInt32BE(2048,12);el.writeInt16BE(1,16);
 const edts=box('edts',box('elst',el)),out=[];
 for(let i=0;i<buf.length;){const n=buf.readUInt32BE(i),type=buf.toString('ascii',i+4,i+8);let body=buf.subarray(i+8,i+n);
  if(type==='moov')body=withAacEdit(body);if(type==='trak')body=Buffer.concat([body,edts]);out.push(box(type,body));i+=n;}
 return Buffer.concat(out);
}
test('AAC edit-list range ends retain real samples and original timeline',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cb21-aac-test-'));
 try {
  execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i',
   'aevalsrc=0.1*sin(2*PI*(300*t+3*t*t)):s=32000:d=248.416','-c:a','aac','-b:a','128k',
   '-f','hls','-hls_time','4','-hls_playlist_type','vod','-hls_segment_type','fmp4','-hls_flags','single_file',
   '-hls_segment_filename',join(dir,'audio.m4s'),join(dir,'audio.m3u8')]);
  const b=await readFile(join(dir,'audio.m4s')),raw=await readFile(join(dir,'audio.m3u8'),'utf8');
  const p=parseAudioPlaylist(raw,'https://kinescope.io/audio.m3u8',248384);
  const init=withAacEdit(b.subarray(p.init.offset,p.init.offset+p.init.bytes)),media=createGapMedia();
  const fragment=r=>Buffer.concat([init,b.subarray(r.offset,r.offset+r.bytes)]);
  const full=await media.decode(fragment(gapRange(p,{start_ms:0,end_ms:248384})),0,248384);
  const middle={start_ms:90000,end_ms:180000},old=gapRange(p,middle);
  await assert.rejects(media.decode(fragment(old),old.trim_ms,90000),/gap_decode_failed/);
  for(const w of [{start_ms:0,end_ms:90000},middle,{start_ms:180000,end_ms:248384}]){
   const r=gapRange(p,w,{decoderTail:true}),pcm=await media.decode(fragment(r),r.trim_ms,w.end_ms-w.start_ms);
   assert.equal(pcm.length,(w.end_ms-w.start_ms)*32);
   const expected=full.subarray(w.start_ms*32,w.end_ms*32);
   let error=0,count=0;for(let i=3200;i<pcm.length-3200;i+=2){error+=Math.abs(pcm.readInt16LE(i)-expected.readInt16LE(i));count++;}
   assert.ok(error/count<2,`timeline error ${error/count}`);
   if(w.end_ms===248384)assert.equal(r.offset+r.bytes,b.length);
  }
  // Split the same fMP4 at two segment boundaries; preserve global tfdt values.
  const cuts=[0,30,50,p.segments.length],files=new Map([['init.bin',init]]),segments=[];
  for(let group=0;group<3;group++){
   const first=p.segments[cuts[group]],last=p.segments[cuts[group+1]-1],name=`part${group}.m4s`;
   files.set(name,b.subarray(first.offset,last.offset+last.bytes));
   for(const seg of p.segments.slice(cuts[group],cuts[group+1]))segments.push({...seg,url:`https://kinescope.io/${name}`,offset:seg.offset-first.offset});
  }
  const splitPlaylist='#EXTM3U\n#EXT-X-MAP:URI="init.bin",BYTERANGE="'+init.length+'@0"\n'+segments.map(seg=>
   `#EXTINF:${(seg.end_ms-seg.start_ms)/1000},\n#EXT-X-BYTERANGE:${seg.bytes}@${seg.offset}\n${seg.url}`).join('\n')+'\n#EXT-X-ENDLIST';
  const publicIo={caption:async url=>url.endsWith('master.m3u8')?'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n':splitPlaylist};
  const splitMedia={decode:media.decode,range:async(url,offset,bytes)=>files.get(new URL(url).pathname.slice(1)).subarray(offset,offset+bytes)};
  const capture=await openLongAudio(publicIo,splitMedia,{hlsUrl:'https://kinescope.io/master.m3u8',identity:{duration_ms:248384}});
  for(const w of [middle,{start_ms:180000,end_ms:248384}]){
   assert.throws(()=>gapRange({segments},w,{decoderTail:true}),/not_contiguous/);
   const result=await capture(w),pcm=result.wav.subarray(44),expected=full.subarray(w.start_ms*32,w.end_ms*32);
   assert.equal(pcm.length,expected.length);
   let error=0,count=0;for(let i=3200;i<pcm.length-3200;i+=2){error+=Math.abs(pcm.readInt16LE(i)-expected.readInt16LE(i));count++;}
   assert.ok(error/count<2,`split-file timeline error ${error/count}`);
  }
  const gapCapture=await captureGaps(publicIo,splitMedia,'https://kinescope.io/master.m3u8',
   [{gap_index:0,start_ms:90000,end_ms:220000}],248384,{decoderTail:true});
  assert.equal(gapCapture.parts.length,2);
  const gapPcm=Buffer.concat(gapCapture.parts.map(part=>part.wav.subarray(44))),expectedGap=full.subarray(90000*32,220000*32);
  assert.equal(gapPcm.length,expectedGap.length);
  let gapError=0,gapSamples=0;for(let i=3200;i<gapPcm.length-3200;i+=2){gapError+=Math.abs(gapPcm.readInt16LE(i)-expectedGap.readInt16LE(i));gapSamples++;}
  assert.ok(gapError/gapSamples<2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('decoder tail preserves continuity and size guards and stops at EOF',()=>{
 const p={segments:[0,1,2].map(i=>({url:'same',offset:i*4,bytes:4,start_ms:i*4000,end_ms:(i+1)*4000}))};
 const w={start_ms:0,end_ms:8000};
 assert.equal(gapRange(p,w).bytes,8);assert.equal(gapRange(p,w,{decoderTail:true}).bytes,12);
 assert.equal(gapRange(p,{start_ms:8000,end_ms:12000},{decoderTail:true}).bytes,4);
 for(const mutation of [x=>x.url='other',x=>x.offset++,x=>x.bytes=10000000]){
  const copy=structuredClone(p);mutation(copy.segments[2]);assert.throws(()=>gapRange(copy,w,{decoderTail:true}),/not_contiguous|size_limit/);
 }
});

test('multi-file windows reject byte/time gaps, reused files and oversized aggregate ranges',()=>{
 const p={segments:[
  {url:'a',offset:100,bytes:4,start_ms:0,end_ms:4000},
  {url:'b',offset:0,bytes:4,start_ms:4000,end_ms:8000},
  {url:'b',offset:4,bytes:4,start_ms:8000,end_ms:12000},
 ]},w={start_ms:1000,end_ms:7000};
 assert.deepEqual(longAudioRanges(p,w),{ranges:[{url:'a',offset:100,bytes:4},{url:'b',offset:0,bytes:8}],trim_ms:1000});
 for(const mutate of [x=>x[1].offset=1,x=>x[2].offset=5,x=>x[1].start_ms=4001,
  x=>{x[2].url='a';x[2].offset=0;},x=>x[2].bytes=10000000]){
  const copy=structuredClone(p);mutate(copy.segments);assert.throws(()=>longAudioRanges(copy,w),/hls_/);
 }
});
