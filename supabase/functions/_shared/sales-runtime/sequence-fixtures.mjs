// Synthetic conversations only. Never replay a real inbound to test dialogue quality.
export const SEQUENCE_FIXTURES = {
  new_client: [
    ['Хочу программу курса ЦБ','experience'],
    ['Рассматриваю впервые.','goals'],
    ['Работаю бухгалтером, хочу лучше разобраться в НДС.','format'],
    ['Да, смогу выделить время на обучение.','interest'],
    ['Да, хочу рассмотреть вариант участия.','payment'],
    ['Хочу оформить рассрочку, пришлите ссылку.','checkout'],
  ],
  graduate: [
    ['Хочу программу курса ЦБ','experience'],
    ['Уже училась у вас.','feedback'],
    ['Да, курс очень помог мне в работе.','year'],
    ['Училась в 2023 году, на старой версии.','goals'],
    ['Сейчас хочу углубить знания по НДС.','format'],
  ],
};
