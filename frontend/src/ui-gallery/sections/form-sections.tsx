import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, MailIcon } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { Mirror, Row, Section } from '../section'

const profileSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters.'),
  email: z.string().email('Please enter a valid email address.'),
})

type ProfileForm = z.infer<typeof profileSchema>

/**
 * Form-control base components: Button, Input, Label, Textarea,
 * Checkbox, Switch, RadioGroup, InputOTP, Slider, and the
 * react-hook-form Form integration.
 */
export function FormSections() {
  const [count, setCount] = useState(0)
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')
  const [terms, setTerms] = useState(false)
  const [emailAlerts, setEmailAlerts] = useState(true)
  const [payment, setPayment] = useState('momo')
  const [otp, setOtp] = useState('')
  const [comfort, setComfort] = useState([40])
  const [submitted, setSubmitted] = useState('')

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { username: '', email: '' },
  })

  return (
    <>
      <Section
        id="button"
        title="Button"
        description="6 variants, 4 sizes, icon + loading + disabled states."
      >
        <Row label="Variants">
          <Button data-testid="btn-default">Default</Button>
          <Button variant="secondary" data-testid="btn-secondary">
            Secondary
          </Button>
          <Button variant="destructive" data-testid="btn-destructive">
            Destructive
          </Button>
          <Button variant="outline" data-testid="btn-outline">
            Outline
          </Button>
          <Button variant="ghost" data-testid="btn-ghost">
            Ghost
          </Button>
          <Button variant="link" data-testid="btn-link">
            Link
          </Button>
        </Row>
        <Row label="Sizes">
          <Button size="sm" data-testid="btn-sm">
            Small
          </Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Search" data-testid="btn-icon">
            <MailIcon />
          </Button>
        </Row>
        <Row label="States">
          <Button disabled data-testid="btn-disabled">
            Disabled
          </Button>
          <Button disabled data-testid="btn-loading">
            <Loader2Icon className="animate-spin" />
            Loading…
          </Button>
          <Button
            data-testid="btn-counter"
            onClick={() => setCount((c) => c + 1)}
          >
            Clicked: <Mirror testId="btn-counter-value">{count}</Mirror>
          </Button>
        </Row>
      </Section>

      <Section
        id="input"
        title="Input + Label"
        description="Text inputs with label association, disabled + error states."
      >
        <div className="grid max-w-md gap-4">
          <div className="grid gap-2">
            <Label htmlFor="gallery-input">Full name</Label>
            <Input
              id="gallery-input"
              placeholder="Nguyễn Văn A"
              data-testid="input-demo"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <p className="text-sm">
              Mirror: <Mirror testId="input-mirror">{typed || '—'}</Mirror>
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="gallery-input-disabled">Locked field</Label>
            <Input
              id="gallery-input-disabled"
              disabled
              value="read-only value"
              data-testid="input-disabled"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="gallery-input-error">Error state</Label>
            <Input
              id="gallery-input-error"
              aria-invalid
              placeholder="not-a-valid-email"
              defaultValue="bad@"
              data-testid="input-error"
            />
          </div>
        </div>
      </Section>

      <Section id="textarea" title="Textarea" description="Multi-line input with live counter.">
        <div className="grid max-w-md gap-2">
          <Label htmlFor="gallery-textarea">Special requests</Label>
          <Textarea
            id="gallery-textarea"
            maxLength={100}
            placeholder="e.g. luggage, motion sickness…"
            data-testid="textarea-demo"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-sm">
            <Mirror testId="textarea-count">{note.length}</Mirror> / 100
            characters
          </p>
        </div>
      </Section>

      <Section id="checkbox" title="Checkbox" description="Selection toggles.">
        <div className="max-w-md space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="gallery-checkbox-1"
              defaultChecked
              data-testid="checkbox-1"
            />
            <Label htmlFor="gallery-checkbox-1">Email notifications</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="gallery-checkbox-terms"
              checked={terms}
              onCheckedChange={(v) => setTerms(v === true)}
              data-testid="checkbox-terms"
            />
            <Label htmlFor="gallery-checkbox-terms">
              I accept the terms and conditions
            </Label>
          </div>
          <p className="text-sm">
            Terms accepted:{' '}
            <Mirror testId="checkbox-mirror">{terms ? 'yes' : 'no'}</Mirror>
          </p>
        </div>
      </Section>

      <Section id="switch" title="Switch" description="Binary on/off controls.">
        <div className="max-w-md space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="gallery-switch">Price-drop alerts</Label>
            <Switch
              id="gallery-switch"
              checked={emailAlerts}
              onCheckedChange={(v) => setEmailAlerts(v === true)}
              data-testid="switch-demo"
            />
          </div>
          <p className="text-sm">
            Alerts enabled:{' '}
            <Mirror testId="switch-mirror">{emailAlerts ? 'on' : 'off'}</Mirror>
          </p>
        </div>
      </Section>

      <Section id="radio-group" title="RadioGroup" description="Single-choice option lists.">
        <RadioGroup
          value={payment}
          onValueChange={(v) => setPayment(String(v))}
          className="max-w-md gap-3"
          data-testid="radio-group-demo"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="momo" id="gallery-radio-momo" />
            <Label htmlFor="gallery-radio-momo">MoMo wallet</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="vnpay" id="gallery-radio-vnpay" />
            <Label htmlFor="gallery-radio-vnpay">VNPay QR</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="cod" id="gallery-radio-cod" />
            <Label htmlFor="gallery-radio-cod">Cash on delivery</Label>
          </div>
        </RadioGroup>
        <p className="text-sm">
          Selected method: <Mirror testId="radio-mirror">{payment}</Mirror>
        </p>
      </Section>

      <Section id="input-otp" title="InputOTP" description="One-time code entry.">
        <div className="max-w-md space-y-3">
          <InputOTP
            maxLength={6}
            value={otp}
            onChange={setOtp}
            data-testid="otp-demo"
          >
            <InputOTPGroup data-testid="otp-group">
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
          <p className="text-sm">
            Code: <Mirror testId="otp-mirror">{otp || '—'}</Mirror>
          </p>
        </div>
      </Section>

      <Section id="slider" title="Slider" description="Continuous value selection.">
        <div className="max-w-md space-y-4">
          <Slider
            defaultValue={[40]}
            max={100}
            step={1}
            onValueChange={(v) => setComfort(v)}
            aria-label="Comfort level"
            data-testid="slider-demo"
          />
          <p className="text-sm">
            Value: <Mirror testId="slider-mirror">{comfort[0]}</Mirror>
          </p>
        </div>
      </Section>

      <Section
        id="form"
        title="Form (react-hook-form + zod)"
        description="Labelled fields with validation messages via the Form primitives."
      >
        <Form {...form}>
          <form
            className="grid max-w-md gap-4"
            onSubmit={form.handleSubmit((values) =>
              setSubmitted(`ok:${values.username}`),
            )}
            data-testid="rhf-form"
          >
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="leson"
                      data-testid="form-username"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage data-testid="form-username-error" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      data-testid="form-email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage data-testid="form-email-error" />
                </FormItem>
              )}
            />
            <Button type="submit" data-testid="form-submit">
              Save profile
            </Button>
            <p className="text-sm">
              Status: <Mirror testId="form-status">{submitted || 'idle'}</Mirror>
            </p>
          </form>
        </Form>
      </Section>
    </>
  )
}
