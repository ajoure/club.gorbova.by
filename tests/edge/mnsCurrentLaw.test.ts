import { describe, expect, it } from 'vitest';
import { hasCurrentMnsCorpus, mnsCorpusFingerprint, mnsCurrentLawInstruction, mnsOutputIsCurrent, mnsNumberedDecreeSources, mnsNumberedSourceInstruction, mnsCheckDecreeCitations } from '../../supabase/functions/gorbova-ai-chat/mns-current-law';

const corpus = [{ id: 'decree', file_name: 'Указ N 227 от 06.06.2025', extracted_text: 'Указ Президента Республики Беларусь №227', extraction_status: 'ready' }];
const unnumbered = mnsNumberedDecreeSources([{ ...corpus[0], extracted_text: 'Указ №227\nПОЛОЖЕНИЕ\nо порядке организации и проведения проверок\nГлава 4\nПроверка проводится на основании предписания.\nВ порядке, установленном частью девятой пункта 31 настоящего Положения.' }]);
const numbered = mnsNumberedDecreeSources([{ ...corpus[0], extracted_text: 'Указ №227\n1. Установить порядок.\nПОЛОЖЕНИЕ\nо порядке организации и проведения проверок\n11. Требовать документы по вопросам проверки.\n12. Продолжение нормы.\n13. Другая норма.\n31. Проверка проводится на основании предписания.' }]);
describe('MNS source paragraph citations', () => {
  it('does not treat dates, chapters or cross-references as source labels', () => {
    expect(unnumbered.decree.size + unnumbered.inspections.size).toBe(0);
    expect(mnsNumberedSourceInstruction(unnumbered)).toContain('БЕЗ номеров пунктов');
  });
  it.each([
    'Согласно пункту 11 Положения, утвержденного Указом №227, сообщаем...',
    'Проверка по пункту 31 Положения.',
    'По части девятой пункта 31 настоящего Положения.',
    'Положения (пункт 31).',
    'Пункты 11 и 31 Положения.',
    'Пп. 11, 31 Положения.',
    'Пункты 11–13 Положения.',
    'Пункт **31** Положения.',
    'П.\u00a031 Положения.',
    'Пункт\u200b 31 Положения.',
    'Указ №227 (пункт 31).',
    'Пп.1.1 п.1 ст.107 НК, а согласно пункту 31 Положения проверка...',
    'Согласно Положению. Пунктом 31 предусмотрено предписание.',
    'Согласно Указу №227 сообщаем. В соответствии с п.31 необходимо предписание.',
    'Пункт 31 Положения требует предписания, постановление суда отсутствует.',
  ])('rejects an unverified decree/provision reference: %s', content => {
    expect(mnsCheckDecreeCitations(content, unnumbered).status).toBe('rejected');
  });
  it.each([
    'О рассмотрении запроса. Согласно Указу №227 сообщаем...',
    'Пп.1.1 п.1 ст.107 НК РБ.',
    'По подпункту 1.1 пункта 1 статьи 107 НК РБ. Согласно Указу №227 сообщаем...',
    'Запрос №31 от 07.10.2026. Сумма 31 рубль.',
    'Указ №227. Глава 31.',
    'Пункт 31 Положения, утверждённого Указом №550.',
    'Пункт 31 запроса налогового органа.',
    'Согласно ст.107 НК. Пунктом 1 предусмотрено право. Указ №227.',
    'Пункт 31 Положения, утверждённого постановлением Совета Министров №123.',
  ])('keeps unrelated references and author documents usable: %s', content => {
    expect(mnsCheckDecreeCitations(content, unnumbered).status).toBe('passed');
  });
  it('distinguishes the decree from its inspections provision and validates ranges', () => {
    expect(mnsCheckDecreeCitations('Пункт 31 Положения.', numbered).status).toBe('passed');
    expect(mnsCheckDecreeCitations('Пункт 31 Указа №227.', numbered).status).toBe('rejected');
    expect(mnsCheckDecreeCitations('Пункты 11–13 Положения.', numbered).status).toBe('passed');
    expect(mnsCheckDecreeCitations('Пункты 11–31 Положения.', numbered).status).toBe('rejected');
    expect(mnsCheckDecreeCitations('Пункт 31 Положения о мониторингах.', numbered).status).toBe('rejected');
    const ambiguous = { ...numbered, provisionsCount: 2 };
    expect(mnsCheckDecreeCitations('Пункт 31 Положения.', ambiguous).status).toBe('rejected');
    expect(mnsCheckDecreeCitations('Пункт 31 Положения о порядке организации и проведения проверок.', ambiguous).status).toBe('passed');
  });
});
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
  it.each([
    ['Указ_Президента_Республики_Беларусь_от_06_06_2025_N_227_ред_от_17.docx', true],
    ['Указ_N_227.docx', true],
    ['Указ_N_2270.docx', false],
    ['Указ_N_1227.docx', false],
  ])('recognizes the decree filename without accepting a different number: %s', (file_name, expected) => {
    expect(hasCurrentMnsCorpus('Применять Указ №227', [{ ...corpus[0], file_name }], false)).toBe(expected);
  });
});
