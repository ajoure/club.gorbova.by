import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

/**
 * /document-generation — пользовательский домен «Генерация документов».
 * Содержит секцию «Документы» (пакеты документов, начиная с «Идеология»)
 * и секцию «Реквизиты» (Юрлица/ИП + Физлица).
 * Админская секция Gorbova AI и старая плоская «Документы» скрыты.
 */
const DocumentGeneration = () => {
  return (
    <DashboardLayout>
      <AiPageContent
        mode="user"
        initialSection="doc-packages"
        hiddenSections={["ai", "documents"]}
      />
    </DashboardLayout>
  );
};


export default DocumentGeneration;
