import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { X } from "lucide-react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group z-[9999]"
      position="bottom-center"
      expand={true}
      richColors
      closeButton
      duration={10000}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:max-w-md",
          description: "group-[.toast]:text-muted-foreground group-[.toast]:whitespace-pre-wrap",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton: "group-[.toast]:bg-background group-[.toast]:border-border",
          error: "group-[.toaster]:bg-destructive group-[.toaster]:text-destructive-foreground group-[.toaster]:border-destructive",
          success: "group-[.toaster]:bg-green-50 group-[.toaster]:text-green-900 group-[.toaster]:border-green-200 dark:group-[.toaster]:bg-green-900/20 dark:group-[.toaster]:text-green-100 dark:group-[.toaster]:border-green-800",
          warning: "group-[.toaster]:bg-amber-50 group-[.toaster]:text-amber-900 group-[.toaster]:border-amber-200 dark:group-[.toaster]:bg-amber-900/20 dark:group-[.toaster]:text-amber-100 dark:group-[.toaster]:border-amber-800",
          info: "group-[.toaster]:bg-blue-50 group-[.toaster]:text-blue-900 group-[.toaster]:border-blue-200 dark:group-[.toaster]:bg-blue-900/20 dark:group-[.toaster]:text-blue-100 dark:group-[.toaster]:border-blue-800",
        },
      }}
      {...props}
    />
  );
};

// Helper для критических ошибок — не закрываются автоматически
const criticalToast = {
  error: (message: string, options?: Parameters<typeof toast.error>[1]) => 
    toast.error(message, { duration: Infinity, ...options }),
  paymentError: (message: string, details?: string) =>
    toast.error(message, {
      duration: Infinity,
      description: details,
    }),
  subscriptionError: (message: string, details?: string) =>
    toast.error(message, {
      duration: Infinity,
      description: details,
    }),
};

export { Toaster, toast, criticalToast };
