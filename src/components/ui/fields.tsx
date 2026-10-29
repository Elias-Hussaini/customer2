import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

interface FormFieldProps {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, error, hint, required, children, className = "" }: FormFieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="text-[13px] font-semibold text-ink-700 dark:text-ink-200">
          {label}
          {required && <span className="mr-1 text-[#ef4444]">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-[#ef4444]">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-5 text-ink-500 dark:text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className = "", invalid, ...rest }, ref) {
  return <input ref={ref} className={`field ${invalid ? "field-error" : ""} ${className}`} {...rest} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className = "", invalid, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={`field min-h-[84px] resize-y leading-6 ${invalid ? "field-error" : ""} ${className}`}
      {...rest}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className = "", invalid, children, ...rest }, ref) {
  return (
    <select ref={ref} className={`field ${invalid ? "field-error" : ""} ${className}`} {...rest}>
      {children}
    </select>
  );
});

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, onChange, label, disabled, className = "" }: CheckboxProps) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2.5 select-none ${
        disabled ? "opacity-50" : ""
      } ${className}`}
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-[7px] border transition-all duration-150 ${
          checked
            ? "border-brand-500 bg-brand-500 text-white shadow-[0_3px_10px_-2px_rgba(99,91,255,0.6)]"
            : "border-ink-300 bg-white/70 dark:border-ink-600 dark:bg-white/5"
        }`}
        aria-hidden
      >
        {checked && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 6.5 4.8 9 10 3.5"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label && <span className="text-[13px] font-medium">{label}</span>}
    </label>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  /** Optional one-line hint under the label. */
  hint?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, hint, disabled }: ToggleProps) {
  return (
    <label className={`inline-flex items-center gap-2.5 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <span
        role="switch"
        aria-checked={checked}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? "bg-brand-500" : "bg-ink-300 dark:bg-ink-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-200 ${
            checked ? "left-0.5" : "left-[calc(100%-1.375rem)]"
          }`}
        />
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label != null || hint != null ? (
        <span className="flex flex-col">
          {label != null ? <span className="text-[12.5px] font-bold">{label}</span> : null}
          {hint ? (
            <span className="text-[11px] font-normal leading-5 text-ink-500 dark:text-ink-400">{hint}</span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}
