// Synthetic conversations only. Never replay a real inbound to test dialogue quality.
const NEW_CLIENT = [
    ['Хочу программу курса ЦБ','experience'],
    ['Рассматриваю впервые.','goals'],
    ['Работаю бухгалтером, хочу лучше разобраться в НДС.','format'],
    ['Да, смогу выделить время на обучение.','interest'],
    ['Да, хочу рассмотреть вариант участия.','payment'],
    ['Хочу оформить рассрочку, пришлите ссылку.','checkout'],
  ];
export const SEQUENCE_FIXTURES = {
  new_client: NEW_CLIENT,
  club_consultation: [...NEW_CLIENT.slice(0,5),['Что входит в тариф FULL клуба?','none']],
  graduate: [
    ['Хочу программу курса ЦБ','experience'],
    ['Уже училась у вас.','feedback'],
    ['Да, курс очень помог мне в работе.','year'],
    ['Училась в 2023 году, на старой версии.','goals'],
    ['Сейчас хочу углубить знания по НДС.','format'],
  ],
};
