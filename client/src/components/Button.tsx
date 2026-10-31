import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'dark' | 'secondary' | 'success' | 'successOutline' | 'link';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'compact' | 'default' | 'large';
  underline?: boolean;
}

export function Button({ variant = 'primary', size = 'default', underline, className, type = 'button', ...rest }: Props) {
  const cls = [
    styles.button,
    styles[variant],
    size !== 'default' && styles[size],
    underline && styles.underline,
    className,
  ].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest} />;
}
