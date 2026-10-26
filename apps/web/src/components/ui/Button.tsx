import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

function classes(variant: ButtonVariant, size: ButtonSize, className = "") {
  return `btn btn-${variant} ${size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : ""} ${className}`;
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
};

/** Button with hover, pressed, focus, disabled and loading states. */
export function Button({ variant = "primary", size = "md", loading = false, icon, trailingIcon, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={classes(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
      {!loading ? trailingIcon : null}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
};

export function ButtonLink({ variant = "primary", size = "md", icon, trailingIcon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={classes(variant, size, className)} {...rest}>
      {icon}
      {children}
      {trailingIcon}
    </Link>
  );
}
