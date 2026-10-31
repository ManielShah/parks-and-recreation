import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

interface Props extends HTMLAttributes<HTMLElement> {
  padding?: 'pad' | 'padWide' | 'flush';
  as?: 'div' | 'section' | 'aside' | 'article';
}

export function Card({ padding = 'pad', as: Tag = 'div', className, ...rest }: Props) {
  return <Tag className={[styles.card, styles[padding], className].filter(Boolean).join(' ')} {...rest} />;
}

export function CardTitle({ children, large }: { children: React.ReactNode; large?: boolean }) {
  return <h2 className={large ? styles.titleLarge : styles.title}>{children}</h2>;
}
