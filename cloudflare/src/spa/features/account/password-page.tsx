import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Info, Loader2 } from "lucide-react";
import { changePasswordMutation } from "@spa/api";
import { Button } from "@spa/components/ui/button";
import { ConsolePage, PageHeader } from "@spa/components/console/page";
import { Panel } from "@spa/components/console/panel";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@spa/components/ui/form";
import { PasswordInput } from "@spa/components/ui/password-input";
import { PasswordStrength } from "@spa/features/auth/password-strength";
import { getErrorMessage } from "@spa/lib/error-message";
import { useT } from "@spa/lib/i18n";
import { useSession } from "@spa/stores/session";

/**
 * The current password is asked for exactly when the account has one; a
 * Google/Facebook account that never set one is setting its first.
 */
const makeSchema = (t: ReturnType<typeof useT>, hasPassword: boolean) =>
  z
    .object({
      currentPassword: hasPassword
        ? z.string().min(1, t("accountPage.currentPasswordRequired"))
        : z.string(),
      newPassword: z
        .string()
        .min(1, t("accountPage.newPasswordRequired"))
        .min(8, t("validation.passwordMin"))
        .max(128, t("validation.passwordMax")),
      confirm: z.string().min(1, t("accountPage.confirmPasswordRequired")),
    })
    .refine((v) => !v.confirm || v.newPassword === v.confirm, {
      message: t("validation.passwordMatch"),
      path: ["confirm"],
    })
    .refine((v) => !hasPassword || v.newPassword !== v.currentPassword, {
      message: t("accountPage.passwordUnchanged"),
      path: ["newPassword"],
    });

type Values = z.infer<ReturnType<typeof makeSchema>>;

const EMPTY: Values = { currentPassword: "", newPassword: "", confirm: "" };

/** The server's answer to a wrong current password (a 400, so the session survives). */
const WRONG_CURRENT = /current password/i;

function Required() {
  return (
    <span className="text-destructive" aria-hidden="true">
      *
    </span>
  );
}

/** Change the account password (or set a first one); other devices are signed out. */
export function AccountPasswordPage() {
  const t = useT();
  const setUser = useSession((s) => s.setUser);
  // Older sessions carry no flag: ask for the current password, as the server will.
  const hasPassword = useSession((s) => s.user?.hasPassword !== false);
  const schema = useMemo(() => makeSchema(t, hasPassword), [t, hasPassword]);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
    // Errors appear on submit, then follow each change (see the search form).
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const newPassword = form.watch("newPassword");

  const change = useMutation({
    ...changePasswordMutation(),
    onSuccess: ({ user }) => {
      setUser(user);
      form.reset(EMPTY);
      toast.success(t("accountPage.passwordChanged"), {
        description: t("accountPage.passwordChangedDesc"),
      });
    },
    onError: (e) => {
      const message = getErrorMessage(e, t("accountPage.passwordChangeFailed"));
      if (WRONG_CURRENT.test(message)) {
        form.setError("currentPassword", { message: t("accountPage.currentPasswordWrong") });
        form.setFocus("currentPassword");
      } else {
        toast.error(message);
      }
    },
  });

  return (
    <ConsolePage width="narrow">
      <PageHeader
        title={hasPassword ? t("accountPage.passwordTitle") : t("accountPage.setPasswordTitle")}
        description={t("accountPage.passwordDesc")}
      />
      <Panel>
        <Form {...form}>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit((v) =>
              change.mutate({
                body: {
                  currentPassword: hasPassword ? v.currentPassword : undefined,
                  newPassword: v.newPassword,
                },
              }),
            )}
          >
            {hasPassword ? (
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>
                      {t("accountPage.currentPassword")} <Required />
                    </FormLabel>
                    <FormControl>
                      <PasswordInput {...field} autoComplete="current-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <p className="flex gap-2 rounded-lg bg-primary/5 p-3 text-sm text-slate-700">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                {t("accountPage.setPasswordHint")}
              </p>
            )}

            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    {t("accountPage.newPassword")} <Required />
                  </FormLabel>
                  <FormControl>
                    <PasswordInput {...field} autoComplete="new-password" />
                  </FormControl>
                  <PasswordStrength password={newPassword} />
                  <FormDescription className="text-xs">
                    {t("authPage.passwordMinHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    {t("accountPage.confirmNewPassword")} <Required />
                  </FormLabel>
                  <FormControl>
                    <PasswordInput {...field} autoComplete="new-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={change.isPending}
              className="h-11 w-full sm:h-9 sm:w-auto sm:justify-self-end"
            >
              {change.isPending && <Loader2 className="size-4 animate-spin" />}
              {hasPassword ? t("accountPage.updatePassword") : t("accountPage.setPassword")}
            </Button>
          </form>
        </Form>
      </Panel>
    </ConsolePage>
  );
}
