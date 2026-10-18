import { useState, type ComponentProps } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

import { Input } from "@spa/components/ui/input";
import { useT } from "@spa/lib/i18n";
import { cn } from "@spa/lib/utils";

/**
 * A password field with a show/hide button inside it. Props go to the
 * `<input>` (so `FormControl` wires its id and error state as usual).
 * `withIcon` adds the lock icon the sign-in forms lead with.
 */
export function PasswordInput({
  className,
  withIcon = false,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { withIcon?: boolean }) {
  const t = useT();
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      {withIcon && (
        <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      )}
      <Input
        {...props}
        type={shown ? "text" : "password"}
        // Browsers' own reveal buttons would sit next to ours.
        className={cn("pr-10 [&::-ms-reveal]:hidden", withIcon && "pl-10", className)}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        disabled={props.disabled}
        aria-label={shown ? t("authPage.hidePassword") : t("authPage.showPassword")}
        aria-pressed={shown}
        className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
