import { jsPDF } from "jspdf";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

// Transliteration map for Cyrillic to Latin
const cyrillicToLatin: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo',
  'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M',
  'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
  'Ф': 'F', 'Х': 'H', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Sch',
  'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
};

// Convert text - use English labels for PDF since jsPDF doesn't support Cyrillic well
const labels = {
  title: "PAYMENT RECEIPT",
  orderInfo: "ORDER INFORMATION",
  orderNumber: "Order number:",
  transactionId: "Transaction ID:",
  dateTime: "Date and time:",
  orderDetails: "ORDER DETAILS",
  product: "Product:",
  type: "Type:",
  trialPeriod: "Trial period",
  subscription: "Subscription",
  paymentInfo: "PAYMENT INFORMATION",
  paymentMethod: "Payment method:",
  status: "Status:",
  paid: "Paid",
  trial: "Trial",
  customerEmail: "Customer email:",
  total: "TOTAL:",
  executor: "Executor: ZAO AJOURE incam",
  taxId: "TIN: 193405000",
  address: "Address: 220035, Minsk, Panfilova str., 2, office 49L",
  email: "Email: info@ajoure.by",
  disclaimer: "This document is generated automatically and confirms the payment.",
  bankCard: "Bank card",
};

interface OrderData {
  order_number: string;
  final_price: number;
  currency: string;
  is_trial: boolean;
  created_at: string;
  customer_email?: string | null;
  products_v2?: { name?: string; code?: string } | null;
  tariffs?: { name?: string; code?: string } | null;
  payments_v2?: Array<{
    provider_payment_id?: string | null;
    card_brand?: string | null;
    card_last4?: string | null;
  }>;
}

interface SubscriptionData {
  is_trial: boolean;
  products_v2?: { name?: string; code?: string } | null;
  tariffs?: { name?: string; code?: string } | null;
  orders_v2?: {
    order_number: string;
    final_price: number;
    currency: string;
    created_at: string;
    payments_v2?: Array<{
      provider_payment_id?: string | null;
      card_brand?: string | null;
      card_last4?: string | null;
    }>;
  } | null;
}

export function generateOrderReceipt(order: OrderData): void {
  const priceFormatted = `${order.final_price.toFixed(2)} ${order.currency}`;
  const dateFormatted = format(new Date(order.created_at), "d MMMM yyyy, HH:mm", { locale: ru });
  const payment = order.payments_v2?.[0];
  
  const doc = new jsPDF();
  
  // Header background
  doc.setFillColor(102, 126, 234);
  doc.rect(0, 0, 210, 45, "F");
  
  // Logo text
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("Gorbova Club", 105, 22, { align: "center" });
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(labels.title, 105, 35, { align: "center" });
  
  // Reset text color
  doc.setTextColor(51, 51, 51);
  
  // Order info section
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(labels.orderInfo, 20, 60);
  doc.setDrawColor(102, 126, 234);
  doc.line(20, 63, 190, 63);
  
  doc.setFont("helvetica", "normal");
  let y = 73;
  
  doc.text(labels.orderNumber, 20, y);
  doc.text(order.order_number, 80, y);
  y += 8;
  
  doc.text(labels.transactionId, 20, y);
  doc.text(payment?.provider_payment_id || "—", 80, y);
  y += 8;
  
  doc.text(labels.dateTime, 20, y);
  doc.text(dateFormatted, 80, y);
  y += 15;
  
  // Product section
  doc.setFont("helvetica", "bold");
  doc.text(labels.orderDetails, 20, y);
  doc.line(20, y + 3, 190, y + 3);
  y += 13;
  
  const productName = order.products_v2?.name || order.products_v2?.code || "Gorbova Club";
  const tariffName = order.tariffs?.name || order.tariffs?.code || "";
  const fullProductName = tariffName ? `${productName} — ${tariffName}` : productName;
  
  doc.setFont("helvetica", "normal");
  doc.text(labels.product, 20, y);
  doc.text(fullProductName, 80, y);
  y += 8;
  
  doc.text(labels.type, 20, y);
  doc.text(order.is_trial ? labels.trialPeriod : labels.subscription, 80, y);
  y += 15;
  
  // Payment section
  doc.setFont("helvetica", "bold");
  doc.text(labels.paymentInfo, 20, y);
  doc.line(20, y + 3, 190, y + 3);
  y += 13;
  
  doc.setFont("helvetica", "normal");
  const paymentMethod = payment?.card_brand && payment?.card_last4
    ? `${payment.card_brand} **** ${payment.card_last4}`
    : order.is_trial && order.final_price === 0
      ? labels.trialPeriod
      : labels.bankCard;
  
  doc.text(labels.paymentMethod, 20, y);
  doc.text(paymentMethod, 80, y);
  y += 8;
  
  doc.text(labels.status, 20, y);
  if (order.is_trial && order.final_price === 0) {
    doc.setTextColor(59, 130, 246); // blue for trial
    doc.text(labels.trial, 80, y);
  } else {
    doc.setTextColor(16, 185, 129); // green for paid
    doc.text(labels.paid, 80, y);
  }
  doc.setTextColor(51, 51, 51);
  y += 8;
  
  if (order.customer_email) {
    doc.text(labels.customerEmail, 20, y);
    doc.text(order.customer_email, 80, y);
    y += 12;
  } else {
    y += 4;
  }
  
  y += 8;
  
  // Total section
  doc.setFillColor(245, 247, 250);
  doc.roundedRect(20, y - 5, 170, 25, 3, 3, "F");
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(labels.total, 30, y + 10);
  doc.setTextColor(102, 126, 234);
  doc.text(priceFormatted, 180, y + 10, { align: "right" });
  doc.setTextColor(51, 51, 51);
  y += 35;
  
  // Footer
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(107, 114, 128);
  doc.text(labels.executor, 105, y, { align: "center" });
  doc.text(labels.taxId, 105, y + 5, { align: "center" });
  doc.text(labels.address, 105, y + 10, { align: "center" });
  doc.text(labels.email, 105, y + 15, { align: "center" });
  y += 25;
  
  doc.setFontSize(8);
  doc.text(labels.disclaimer, 105, y, { align: "center" });
  
  // Save the PDF
  doc.save(`receipt_${order.order_number}_${format(new Date(order.created_at), "yyyyMMdd")}.pdf`);
  
  toast.success("PDF receipt downloaded");
}

export function generateSubscriptionReceipt(sub: SubscriptionData): void {
  const order = sub.orders_v2;
  if (!order) {
    toast.error("Order not found for this subscription");
    return;
  }
  
  const priceFormatted = `${order.final_price.toFixed(2)} ${order.currency}`;
  const dateFormatted = format(new Date(order.created_at), "d MMMM yyyy, HH:mm", { locale: ru });
  const payment = order.payments_v2?.[0];
  
  const doc = new jsPDF();
  
  // Header background
  doc.setFillColor(102, 126, 234);
  doc.rect(0, 0, 210, 45, "F");
  
  // Logo text
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("Gorbova Club", 105, 22, { align: "center" });
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(labels.title, 105, 35, { align: "center" });
  
  // Reset text color
  doc.setTextColor(51, 51, 51);
  
  // Order info section
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(labels.orderInfo, 20, 60);
  doc.setDrawColor(102, 126, 234);
  doc.line(20, 63, 190, 63);
  
  doc.setFont("helvetica", "normal");
  let y = 73;
  
  doc.text(labels.orderNumber, 20, y);
  doc.text(order.order_number, 80, y);
  y += 8;
  
  doc.text(labels.transactionId, 20, y);
  doc.text(payment?.provider_payment_id || "—", 80, y);
  y += 8;
  
  doc.text(labels.dateTime, 20, y);
  doc.text(dateFormatted, 80, y);
  y += 15;
  
  // Product section
  doc.setFont("helvetica", "bold");
  doc.text(labels.orderDetails, 20, y);
  doc.line(20, y + 3, 190, y + 3);
  y += 13;
  
  const productName = sub.products_v2?.name || sub.products_v2?.code || "Gorbova Club";
  const tariffName = sub.tariffs?.name || sub.tariffs?.code || "";
  const fullProductName = tariffName ? `${productName} — ${tariffName}` : productName;
  
  doc.setFont("helvetica", "normal");
  doc.text(labels.product, 20, y);
  doc.text(fullProductName, 80, y);
  y += 8;
  
  doc.text(labels.type, 20, y);
  doc.text(sub.is_trial ? labels.trialPeriod : labels.subscription, 80, y);
  y += 15;
  
  // Payment section
  doc.setFont("helvetica", "bold");
  doc.text(labels.paymentInfo, 20, y);
  doc.line(20, y + 3, 190, y + 3);
  y += 13;
  
  doc.setFont("helvetica", "normal");
  const paymentMethod = payment?.card_brand && payment?.card_last4
    ? `${payment.card_brand} **** ${payment.card_last4}`
    : sub.is_trial && order.final_price === 0
      ? labels.trialPeriod
      : labels.bankCard;
  
  doc.text(labels.paymentMethod, 20, y);
  doc.text(paymentMethod, 80, y);
  y += 8;
  
  doc.text(labels.status, 20, y);
  if (sub.is_trial && order.final_price === 0) {
    doc.setTextColor(59, 130, 246);
    doc.text(labels.trial, 80, y);
  } else {
    doc.setTextColor(16, 185, 129);
    doc.text(labels.paid, 80, y);
  }
  doc.setTextColor(51, 51, 51);
  y += 20;
  
  // Total section
  doc.setFillColor(245, 247, 250);
  doc.roundedRect(20, y - 5, 170, 25, 3, 3, "F");
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(labels.total, 30, y + 10);
  doc.setTextColor(102, 126, 234);
  doc.text(priceFormatted, 180, y + 10, { align: "right" });
  doc.setTextColor(51, 51, 51);
  y += 35;
  
  // Footer
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(107, 114, 128);
  doc.text(labels.executor, 105, y, { align: "center" });
  doc.text(labels.taxId, 105, y + 5, { align: "center" });
  doc.text(labels.address, 105, y + 10, { align: "center" });
  doc.text(labels.email, 105, y + 15, { align: "center" });
  y += 25;
  
  doc.setFontSize(8);
  doc.text(labels.disclaimer, 105, y, { align: "center" });
  
  // Save the PDF
  doc.save(`receipt_${order.order_number}_${format(new Date(order.created_at), "yyyyMMdd")}.pdf`);
  
  toast.success("PDF receipt downloaded");
}
