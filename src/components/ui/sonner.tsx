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
      position="bottom-right"
      expand={false}
      visibleToasts={3}
      duration={3000}
      gap={8}
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            "group toast !text-sm !py-2 !px-3 !min-h-0 !rounded-xl !backdrop-blur-xl group-[.toaster]:bg-background/40 group-[.toaster]:text-foreground group-[.toaster]:border-border/30 group-[.toaster]:shadow-sm group-[.toaster]:max-w-xs",
          title: "!text-sm !font-medium",
          description: "group-[.toast]:text-muted-foreground !text-xs group-[.toast]:whitespace-pre-wrap",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground !h-7 !text-xs",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground !h-7 !text-xs",
          error: "group-[.toaster]:!bg-destructive/40 group-[.toaster]:!text-destructive-foreground group-[.toaster]:!border-destructive/30",
          success: "group-[.toaster]:!bg-emerald-500/25 group-[.toaster]:!text-emerald-950 group-[.toaster]:!border-emerald-400/30 dark:group-[.toaster]:!bg-emerald-500/20 dark:group-[.toaster]:!text-emerald-50",
          warning: "group-[.toaster]:!bg-amber-500/30 group-[.toaster]:!text-amber-950 group-[.toaster]:!border-amber-400/30 dark:group-[.toaster]:!text-amber-50",
          info: "group-[.toaster]:!bg-blue-500/25 group-[.toaster]:!text-blue-950 group-[.toaster]:!border-blue-400/30 dark:group-[.toaster]:!text-blue-50",
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
