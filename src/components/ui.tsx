import { useEffect, useRef, type ReactNode } from 'react'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}) {
  const styles = {
    primary: 'bg-slate-900 text-white active:bg-slate-700',
    secondary: 'bg-white text-slate-900 border border-slate-300 active:bg-slate-100',
    ghost: 'text-slate-600 active:bg-slate-200',
    danger: 'bg-red-600 text-white active:bg-red-700',
  }[variant]
  return (
    <button
      {...props}
      className={`rounded-xl px-5 py-3 font-medium transition-colors disabled:opacity-40 ${styles} ${className}`}
    />
  )
}

export function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <input
        {...props}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-slate-900"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Dialog({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose?: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        // Without onClose the dialog is a required decision — don't let Esc or the
        // Android back gesture dismiss it into a half-finished state.
        if (!onClose) e.preventDefault()
        else onClose()
      }}
      className="m-auto w-[min(28rem,92vw)] rounded-2xl p-0 backdrop:bg-black/50"
    >
      <div className="p-5">
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </dialog>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Smazat',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <p className="mb-5 text-slate-600">{message}</p>
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          Zrušit
        </Button>
        <Button variant="danger" className="flex-1" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <p className="mt-2 text-sm text-slate-500">{children}</p>}
    </div>
  )
}
