import { cn } from '@/lib/utils'
import { scorePassword } from './_shared'

/** Four bars and a word for how strong a new password is; nothing until one is typed. */
export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null
  const { score, label } = scorePassword(password)
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            'h-1 flex-1 rounded-full transition-colors',
            i < score ? (score <= 2 ? 'bg-amber-400' : 'bg-blue-500') : 'bg-slate-200',
          )}
        />
      ))}
      <span className="ml-2 w-16 text-right text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}
