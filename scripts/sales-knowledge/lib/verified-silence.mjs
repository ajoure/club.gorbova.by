import {pcmParts,sha} from './course-stt.mjs';

/** Exact digital zero only. Quiet audio and model classifications are not evidence. */
export function verifyDigitalSilence(expected,captured){
 const duration=expected?.end_ms-expected?.start_ms;
 if(!Number.isSafeInteger(expected?.part_index)||expected.part_index<0||expected.part_index>239
   ||expected.start_ms!==expected.part_index*90000||!Number.isSafeInteger(duration)
   ||duration<1||duration>90000||expected.digital_silence!==true
   ||expected.bytes!==44+duration*32||!/^[a-f0-9]{64}$/.test(expected.audio_sha256??''))
   throw Error('silence_manifest_invalid');
 if(!Buffer.isBuffer(captured?.wav)||captured.wav.length!==expected.bytes
   ||['part_index','start_ms','end_ms','bytes','audio_sha256','digital_silence'].some(k=>captured[k]!==expected[k])
   ||sha(captured.wav)!==expected.audio_sha256)throw Error('silence_capture_changed');
 const canonical=pcmParts(Buffer.alloc(duration*32),duration).parts[0].wav;
 if(!captured.wav.equals(canonical))throw Error('digital_zero_not_proven');
 return {schema_version:1,method:'pcm_s16le_16000_mono_all_zero_v1',
   part_index:expected.part_index,start_ms:expected.start_ms,end_ms:expected.end_ms,
   audio_sha256:expected.audio_sha256,pcm_bytes:duration*32,zero_samples:duration*16,stt_calls:0};
}
