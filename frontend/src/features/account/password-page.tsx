import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { changePasswordMutation } from '@/api'
import { Button } from '@/components/ui/button'
import { ConsolePage, PageHeader } from '@/components/console/page'
import { Panel } from '@/components/console/panel'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'
import { useSession } from '@/stores/session'

const makeSchema = (t: ReturnType<typeof useT>) =>
  z
    .object({
      currentPassword: z.string(),
      newPassword: z
        .string()
        .min(8, t('validation.passwordMin'))
        .max(128, t('validation.passwordMax')),
      confirm: z.string(),
    })
    .refine((v) => v.newPassword === v.confirm, {
      message: t('validation.passwordMatch'),
      path: ['confirm'],
    })
    .refine((v) => v.newPassword !== v.currentPassword, {
      message: t('accountPage.passwordUnchanged'),
      path: ['newPassword'],
    })

type Values = z.infer<ReturnType<typeof makeSchema>>

const EMPTY: Values = { currentPassword: '', newPassword: '', confirm: '' }

/** Change the account password; other devices are signed out. */
export function AccountPasswordPage() {
  const t = useT()
  const setUser = useSession((s) => s.setUser)
  const schema = useMemo(() => makeSchema(t), [t])
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY })
  const change = useMutation({
    ...changePasswordMutation(),
    onSuccess: ({ user }) => {
      setUser(user)
      form.reset(EMPTY)
      toast.success(t('accountPage.passwordChanged'), {
        description: t('accountPage.passwordChangedDesc'),
      })
    },
    onError: (e) => toast.error(getErrorMessage(e, t('accountPage.passwordChangeFailed'))),
  })

  const field = (name: keyof Values, label: string, hint?: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="grid gap-1.5">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              type="password"
              autoComplete={name === 'currentPassword' ? 'current-password' : 'new-password'}
            />
          </FormControl>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
          <FormMessage />
        </FormItem>
      )}
    />
  )

  return (
    <ConsolePage width="narrow">
      <PageHeader
        title={t('accountPage.passwordTitle')}
        description={t('accountPage.passwordDesc')}
      />
      <Panel>
        <Form {...form}>
          <form
            className="grid gap-4"
            onSubmit={form.handleSubmit((v) =>
              change.mutate({
                body: {
                  currentPassword: v.currentPassword || undefined,
                  newPassword: v.newPassword,
                },
              }),
            )}
          >
            {field(
              'currentPassword',
              t('accountPage.currentPassword'),
              t('accountPage.currentPasswordHint'),
            )}
            {field('newPassword', t('accountPage.newPassword'))}
            {field('confirm', t('accountPage.confirmNewPassword'))}
            <Button
              type="submit"
              disabled={change.isPending}
              className="h-11 w-full sm:h-9 sm:w-auto sm:justify-self-end"
            >
              {change.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('accountPage.updatePassword')}
            </Button>
          </form>
        </Form>
      </Panel>
    </ConsolePage>
  )
}
