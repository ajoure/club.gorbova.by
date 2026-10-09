import {describe,it,expect} from 'vitest';
import {questionnaireAttribution} from '../../supabase/functions/site-questionnaire-visit/attribution';
describe('questionnaire source metadata',()=>{
 it('preserves bounded UTM values including Cyrillic and keeps only source keys',()=>{
  expect(questionnaireAttribution({utm_source:' Stories ',utm_campaign:'ЦБ21',utm_content:'Ролик 3',email:'private',journey_key:'secret'}))
   .toEqual({utm_source:'Stories',utm_campaign:'ЦБ21',utm_content:'Ролик 3'});
 });
 it('rejects controls, arrays and oversized tracking fields',()=>{
  expect(questionnaireAttribution({src:'reels',utm_term:'x'.repeat(201),utm_source:'bad\nvalue',utm_medium:3})).toEqual({src:'reels'});
  expect(questionnaireAttribution(['a'])).toEqual({});
 });
});
