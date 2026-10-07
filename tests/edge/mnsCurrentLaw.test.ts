import { describe, expect, it } from 'vitest';
import { hasCurrentMnsCorpus, mnsCorpusFingerprint, mnsCurrentLawInstruction, mnsOutputIsCurrent } from '../../supabase/functions/gorbova-ai-chat/mns-current-law';

const corpus = [{ id: 'decree', file_name: 'Указ N 227 от 06.06.2025', extracted_text: 'Указ Президента Республики Беларусь №227', extraction_status: 'ready' }];
describe('MNS law guard before persistence', () => {
  it.each([
    'В соответствии с Указом №510 проверка проводится...',
    'Указ Президента Республики Беларусь от 16.10.2009 № 510 применяется.',
    'Указ №510 утратил силу, но согласно Указу №510 необходима запись.',
    'Указ **№ 510** утратил силу.',
    'Указ N510', 'Указ №\u200b510',
    'Проверка возможна только при наличии записи в книге учёта проверок.',
    'Книга учёта проверок не требуется, но книга учёта проверок должна быть заполнена.',
  ])('never releases a retired decree/book draft: %s', text => expect(mnsOutputIsCurrent(text)).toBe(false));
  it.each([
    'Согласно Указу №227 от 06.06.2025 ...',
    'Книга учёта проверок не требуется.',
    'Указ №550', 'Сумма составляет 510 рублей.', 'Согласно Указу №227 сумма составляет 510 рублей.', 'В ответ на запрос №510 от 01.10.2026 сообщаем...', 'В ответ на запрос 510 от 01.10.2026 сообщаем...',
    'Уточните, какой орган направил запрос?',
  ])('allows current text and unrelated numbers: %s', text => expect(mnsOutputIsCurrent(text)).toBe(true));
  it.each([null, '', '  ', {}, ['Указ №227']])('rejects empty/non-text model outcomes', text => expect(mnsOutputIsCurrent(text)).toBe(false));
  it('fails closed on unavailable, incomplete, or truncated author knowledge', () => {
    expect(hasCurrentMnsCorpus('Применять Указ №227', corpus, false)).toBe(true);
    expect(hasCurrentMnsCorpus('Применять Указ №510', corpus, false)).toBe(false);
    expect(hasCurrentMnsCorpus('Указ №227', [], false)).toBe(false);
    expect(hasCurrentMnsCorpus('Указ №227', corpus, true)).toBe(false);
    for (const extraction_status of ['pending', 'truncated', 'failed']) {
      expect(hasCurrentMnsCorpus('Указ №227', [{ ...corpus[0], extraction_status }], false)).toBe(false);
    }
    expect(hasCurrentMnsCorpus('Указ №227', [...corpus, { ...corpus[0], extracted_text: '' }], false)).toBe(false);
  });
  it('records a content fingerprint that changes with edited author sources', async () => {
    const hash = await mnsCorpusFingerprint('Указ №227', null, corpus);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await mnsCorpusFingerprint('Указ №227', null, corpus)).toBe(hash);
    expect(await mnsCorpusFingerprint('Указ №227', null, [{ ...corpus[0], extracted_text: 'Изменённая редакция №227' }])).not.toBe(hash);
    expect(mnsCurrentLawInstruction(new Date('2026-10-07'))).toContain('2026-10-07');
  });
});
