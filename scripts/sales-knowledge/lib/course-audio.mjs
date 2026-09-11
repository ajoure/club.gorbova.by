import {mkdtemp,writeFile,readFile,stat,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {safeSubtitleUrl} from './course-provider-import.mjs';
const run=promisify(execFile);

export function createCourseMedia(fetchImpl=fetch){
  return {
    async download(url,expectedBytes){
      if(!Number.isSafeInteger(expectedBytes)||expectedBytes<1||expectedBytes>60000000)throw Error('audio_size_invalid');
      let target=safeSubtitleUrl(url);const seen=new Set();
      for(let redirects=0;redirects<4;redirects++){
        if(seen.has(target.href))throw Error('audio_redirect_loop');seen.add(target.href);
        const r=await fetchImpl(target,{redirect:'manual',signal:AbortSignal.timeout(180000)});
        if([301,302,303,307,308].includes(r.status)){
          const location=r.headers.get('location');if(!location)throw Error('audio_redirect_missing');
          target=safeSubtitleUrl(new URL(location,target).href);continue;
        }
        if(r.status!==200)throw Error('audio_download_failed');
        const reader=r.body?.getReader();if(!reader)throw Error('audio_body_missing');
        let size=0;const chunks=[];
        try{while(true){const part=await reader.read();if(part.done)break;
          size+=part.value.length;if(size>expectedBytes)throw Error('audio_size_mismatch');chunks.push(Buffer.from(part.value));}
        }finally{await reader.cancel().catch(()=>{});}
        if(size!==expectedBytes)throw Error('audio_size_mismatch');return Buffer.concat(chunks,size);
      }
      throw Error('audio_redirect_limit');
    },
    async decode(bytes){
      const dir=await mkdtemp(join(tmpdir(),'course-stt-'));await chmod(dir,0o700);
      try{
        const input=join(dir,'source.m4a'),output=join(dir,'decoded.pcm');
        await writeFile(input,bytes,{flag:'wx',mode:0o600});
        // Local media only: decoding cannot fetch arbitrary referenced protocols.
        await run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file',
          '-i',input,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le',
          '-t','1801','-n',output],{timeout:180000,maxBuffer:65536});
        await chmod(output,0o600);const size=(await stat(output)).size;
        if(size<32000||size>57632000)throw Error('decoded_audio_size_invalid');return await readFile(output);
      }catch{throw Error('audio_decode_failed');}
      finally{await rm(dir,{recursive:true,force:true});}
    },
  };
}
