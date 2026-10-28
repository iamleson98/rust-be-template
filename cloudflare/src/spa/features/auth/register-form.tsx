import { useSession } from "@spa/stores/session";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useT } from "@spa/lib/i18n";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { authRegisterMutation } from "@spa/api";
import { Button } from "@spa/components/ui/button";
import { Input } from "@spa/components/ui/input";
import { PasswordInput } from "@spa/components/ui/password-input";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@spa/components/ui/form";
import { toast } from "sonner";
import { Loader2, ChevronRight, Check, Mail, User, UserPlus, Phone } from "lucide-react";
import { SocialAuthButtons } from "./social-buttons";
import { makeRegisterSchema, type RegisterFormValues } from "./_shared";
import { PasswordStrength } from "./password-strength";

export function RegisterForm() {
  const setUser = useSession((s) => s.setUser);
  const navigate = useNavigate();
  const t = useT();
  const [success, setSuccess] = useState(false);
  const registerSchema = useMemo(() => makeRegisterSchema(t), [t]);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    // Errors appear on submit, then follow each change: an error popping up
    // on blur shifts the layout under the pointer and swallows the click.
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      password: "",
      confirm: "",
    },
  });
  const { control, handleSubmit } = form;
  const password = useWatch({ control, name: "password" });
  const confirm = useWatch({ control, name: "confirm" });
  const email = useWatch({ control, name: "email" });

  const registerMut = useMutation({
    ...authRegisterMutation(),
    onSuccess: ({ user }) => {
      setUser(user);
      setSuccess(true);
      toast.success(t("authPage.accountCreated"));
    },
    onError: () => toast.error(t("authPage.registerFailedEmail")),
  });

  const onSubmit = (values: RegisterFormValues) => {
    registerMut.mutate({
      body: {
        fullName: values.fullName,
        email: values.email || undefined,
        phone: values.phone || undefined,
        password: values.password,
      },
    });
  };

  if (success) {
    return (
      <div className="text-center py-4">
        <div className="inline-flex h-16 w-16 rounded-full bg-linear-to-br from-blue-400 to-blue-500 items-center justify-center mb-4">
          <Check className="h-8 w-8 text-white" strokeWidth={3} />
        </div>
        <h3 className="font-bold text-lg mb-1">{t("auth.registerSuccess")}</h3>
        <p className="text-sm text-muted-foreground mb-5">{t("authPage.registerReady")}</p>
        <Button onClick={() => navigate({ to: "/" })} className="w-full gap-2">
          {t("authPage.startSearch")}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5" noValidate>
        {/* The quick way in first: one tap instead of the whole form. */}
        <SocialAuthButtons dividerAt="after" />

        <FormField
          control={control}
          name="fullName"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("auth.fullName")} <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t("authPage.fullNamePh")}
                    autoFocus
                    className="pl-10 h-11"
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="email"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("auth.email")}{" "}
                <span className="text-muted-foreground/60 normal-case font-normal">
                  {t("authPage.orPhone")}
                </span>{" "}
                <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder="email@example.com"
                    type="email"
                    className="pl-10 h-11"
                  />
                </FormControl>
              </div>
              <FormMessage />
              {!email && (
                <FormField
                  control={control}
                  name="phone"
                  render={({ field: phoneField }) => (
                    <FormItem className="space-y-1.5">
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                        <FormControl>
                          <Input
                            {...phoneField}
                            placeholder="0912345678"
                            inputMode="tel"
                            className="pl-10 h-11"
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="password"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("auth.password")} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <PasswordInput
                  {...field}
                  placeholder={t("authPage.passwordMinHint")}
                  autoComplete="new-password"
                  withIcon
                  className="h-11"
                />
              </FormControl>
              <PasswordStrength password={password} />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="confirm"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("auth.confirmPassword")} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <PasswordInput
                  {...field}
                  placeholder={t("authPage.confirmPasswordPh")}
                  autoComplete="new-password"
                  withIcon
                  className="h-11"
                />
              </FormControl>
              {confirm && password !== confirm && (
                <p className="text-[11px] text-red-500">{t("validation.passwordMatch")}</p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={registerMut.isPending} className="h-11 w-full gap-2">
          {registerMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {t("authPage.createAccount")}
          <ChevronRight className="h-4 w-4" />
        </Button>

        <p className="text-[11px] text-muted-foreground text-center">
          {t("authPage.agreeBefore")}{" "}
          <Link to="/terms" className="text-primary hover:underline">
            {t("layout.footer.termsOfUse")}
          </Link>{" "}
          {t("authPage.agreeAnd")}{" "}
          <Link to="/privacy" className="text-primary hover:underline">
            {t("layout.footer.privacyPolicy")}
          </Link>
          {/* Carries its own leading space where the language needs one. */}
          {t("authPage.agreeAfter")}
        </p>
      </form>
    </Form>
  );
}
