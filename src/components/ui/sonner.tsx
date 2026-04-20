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
      closeButton
      duration={3000}
      gap={8}
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            "group toast !text-sm !py-2 !px-3 !min-h-0 !rounded-lg !backdrop-blur-md group-[.toaster]:bg-background/80 group-[.toaster]:text-foreground group-[.toaster]:border-border/50 group-[.toaster]:shadow-md group-[.toaster]:max-w-xs",
          title: "!text-sm !font-medium",
          description: "group-[.toast]:text-muted-foreground !text-xs group-[.toast]:whitespace-pre-wrap",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground !h-7 !text-xs",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground !h-7 !text-xs",
          closeButton: "group-[.toast]:bg-background/80 group-[.toast]:border-border/50",
          error: "group-[.toaster]:bg-destructive/85 group-[.toaster]:text-destructive-foreground group-[.toaster]:border-destructive/50",
          success: "group-[.toaster]:bg-emerald-500/85 group-[.toaster]:text-white group-[.toaster]:border-emerald-400/50 dark:group-[.toaster]:bg-emerald-600/85",
          warning: "group-[.toaster]:bg-amber-500/85 group-[.toaster]:text-white group-[.toaster]:border-amber-400/50",
          info: "group-[.toaster]:bg-blue-500/85 group-[.toaster]:text-white group-[.toaster]:border-blue-400/50",
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
