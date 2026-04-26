import { toast } from "sonner";

export async function copyToClipboard(text: string, successMessage = "Ссылка скопирована") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
    return true;
  } catch (err) {
    // Fallback для старых браузеров
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand("copy");
      toast.success(successMessage);
      return true;
    } catch {
      toast.error("Не удалось скопировать");
      return false;
    } finally {
      document.body.removeChild(textArea);
    }
  }
}

export function getContactUrl(contactId: string) {
  return `${window.location.origin}/admin/contacts?contact=${contactId}`;
}

export function getDealUrl(dealId: string) {
  return `${window.location.origin}/admin/deals?deal=${dealId}`;
}

export function getProductPayUrl(productId: string) {
  // Канонический host — НЕ window.location.origin, чтобы из preview Lovable
  // не уехала ссылка на lovable.dev (Access denied у клиента).
  return buildProductPayUrl(productId);
}
