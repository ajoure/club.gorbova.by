import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublicTariff } from "@/hooks/usePublicProduct";
import { FaqSection } from "../sections/FaqSection";
import { PostTariffSection } from "../sections/PostTariffSection";

const tariff = (name: string, days: number, extra = {}) => ({ name, access_days: days, ...extra }) as PublicTariff;
const accessQuestion = (container: HTMLElement) => Array.from(container.querySelectorAll("details"))
  .find(item => item.querySelector("summary")?.textContent?.includes("На какое время выдается доступ к курсу?"));

describe("future-sales FAQ", () => {
  it("changes with the same live access configuration as the tariff cards", () => {
    const { container, rerender } = render(<FaqSection tariffs={[
      tariff("Бухгалтер", 180), tariff("Главный бухгалтер", 240), tariff("Бизнес-леди", 300),
    ]} />);
    const question = accessQuestion(container);
    expect(question).toHaveTextContent("«Бухгалтер»: доступ 180 дней с момента покупки");
    expect(question).toHaveTextContent("«Главный бухгалтер»: доступ 240 дней с момента покупки");
    expect(question).toHaveTextContent("«Бизнес-леди»: доступ 300 дней с момента покупки");
    expect(question).toHaveTextContent("Для ранее оплаченных покупок сохраняются условия");
    rerender(<FaqSection tariffs={[tariff("Новый тариф", 100, {meta:{course_access:{kind:"course_end_calendar_months",months:7}}})]} />);
    expect(accessQuestion(container)).toHaveTextContent("«Новый тариф»: доступ 7 месяцев после окончания курса");
    expect(accessQuestion(container)).not.toHaveTextContent("180 дней");
  });
  it("does not fabricate durations or unconditional club access when data is unavailable", () => {
    const { container } = render(<><FaqSection /><PostTariffSection /></>);
    expect(accessQuestion(container)).toHaveTextContent("Срок доступа указан в карточке");
    expect(container).not.toHaveTextContent("вы получаете доступ на 1 месяц");
    expect(container).not.toHaveTextContent("не ограничиваем по времени");
  });
  it("uses current bonus rules and removes a withdrawn bonus in both sections", () => {
    const tariffs = [tariff("Бухгалтер",180,{access_summary:{modules:[],benefits:[]}}),
      tariff("Главный бухгалтер",240,{access_summary:{modules:[],benefits:[{title:"Клуб — Full",days:30,conditional:false}]}})];
    const { container, rerender } = render(<><FaqSection tariffs={tariffs}/><PostTariffSection tariffs={tariffs}/></>);
    expect(container.querySelector('[data-cb-native-section="post-tariff"]')).toHaveTextContent("«Главный бухгалтер»: Клуб — Full — 30 дней");
    expect(container.querySelector('[data-cb-native-section="post-tariff"]')).not.toHaveTextContent("«Бухгалтер»:");
    rerender(<><FaqSection tariffs={[tariffs[0]]}/><PostTariffSection tariffs={[tariffs[0]]}/></>);
    expect(container).not.toHaveTextContent("Клуб — Full");
  });
});
