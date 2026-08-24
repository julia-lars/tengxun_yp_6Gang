import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-(--color-background) group-[.toaster]:text-(--color-foreground) group-[.toaster]:border-(--color-border) group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-(--color-muted-foreground)",
          actionButton:
            "group-[.toast]:bg-(--color-primary) group-[.toast]:text-(--color-primary-foreground)",
          cancelButton:
            "group-[.toast]:bg-(--color-muted) group-[.toast]:text-(--color-muted-foreground)",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
