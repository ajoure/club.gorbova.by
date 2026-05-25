import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

/**
 * /document-generation — пользовательский домен «Генерация документов».
 * Содержит только секцию «Реквизиты» (Юрлица/ИП + Физлица).
 * Логика, хуки и таблицы реквизитов не меняются — переиспользуется AiPageContent.
 */
const DocumentGeneration = () => {
  return (
    <DashboardLayout>
      <AiPageContent
        mode="user"
        initialSection="requisites"
        hiddenSections={["ai", "documents"]}
      />
    </DashboardLayout>
  );
};

export default DocumentGeneration;
