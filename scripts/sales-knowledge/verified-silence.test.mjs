import test from 'node:test';
import assert from 'node:assert/strict';
import {pcmParts,sha} from './lib/course-stt.mjs';
import {verifyDigitalSilence} from './lib/verified-silence.mjs';
const fixture=(duration=90000,index=0)=>{
 const wav=pcmParts(Buffer.alloc(duration*32),duration).parts[0].wav;
 const expected={part_index:index,start_ms:index*90000,end_ms:index*90000+duration,
  bytes:wav.length,audio_sha256:sha(wav),digital_silence:true};
 return {expected,captured:{...expected,wav}};
};
test('full and final partial windows prove exact zero without STT',()=>{
 for(const [duration,index] of [[90000,0],[68416,138]]){
  const {expected,captured}=fixture(duration,index),proof=verifyDigitalSilence(expected,captured);
  assert.equal(proof.zero_samples,duration*16);assert.equal(proof.stt_calls,0);
  assert.equal(proof.audio_sha256,expected.audio_sha256);
 }
});
test('even a single nonzero PCM sample is not silence, including with updated hashes',()=>{
 const {expected,captured}=fixture();captured.wav[100]=1;
 expected.audio_sha256=captured.audio_sha256=sha(captured.wav);
 assert.throws(()=>verifyDigitalSilence(expected,captured),/digital_zero_not_proven/);
});
test('noncanonical WAV headers cannot hide incorrect format behind all-zero payload',()=>{
 const {expected,captured}=fixture();captured.wav.writeUInt32LE(8000,24);
 expected.audio_sha256=captured.audio_sha256=sha(captured.wav);
 assert.throws(()=>verifyDigitalSilence(expected,captured),/digital_zero_not_proven/);
});
test('changed content, bounds, or capture metadata fail closed',()=>{
 for(const key of ['audio_sha256','start_ms','end_ms','bytes','digital_silence']){
  const {expected,captured}=fixture();captured[key]=null;
  assert.throws(()=>verifyDigitalSilence(expected,captured),/silence_capture_changed/);
 }
 const {expected,captured}=fixture();captured.wav[100]=1;
 assert.throws(()=>verifyDigitalSilence(expected,captured),/silence_capture_changed/);
});
test('only bounded explicitly silent windows are eligible',()=>{
 for(const change of [{digital_silence:false},{part_index:-1},{start_ms:1},{end_ms:90001},{bytes:42}]){
  const {expected,captured}=fixture();Object.assign(expected,change);
  assert.throws(()=>verifyDigitalSilence(expected,captured),/silence_manifest_invalid/);
 }
});
