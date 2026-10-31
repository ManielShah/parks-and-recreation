import type { Category } from '@parks/shared';

type P = { size?: number };
const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const CartIcon = ({ size = 18 }: P) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...stroke}>
    <circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" />
    <path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" />
  </svg>
);

export const BellIcon = ({ size = 20 }: P) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...stroke}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export const CloseIcon = ({ size = 18 }: P) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...stroke}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const ChevronLeftIcon = ({ size = 18 }: P) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...stroke}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const ChevronDownIcon = ({ size = 16 }: P) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" strokeWidth={2.2} {...stroke}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const CheckIcon = ({ size = 28 }: P) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" strokeWidth={2.4} {...stroke}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const CardIcon = ({ size = 22 }: P) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" strokeWidth={1.8} {...stroke}>
    <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" />
  </svg>
);

export const CalendarIcon = ({ size = 22 }: P) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...stroke}>
    <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
  </svg>
);

export const LogoMark = () => (
  <svg aria-hidden="true" width="36" height="36" viewBox="0 0 36 36" fill="none">
    <circle cx="18" cy="18" r="18" fill="var(--color-forest)" />
    <path d="M7 22c3 0 3-2.5 5.5-2.5S15 22 18 22s3-2.5 5.5-2.5S26 22 29 22" stroke="var(--color-ground)" strokeWidth="2" strokeLinecap="round" />
    <path d="M18 8v8M13.5 12.5L18 16l4.5-3.5" stroke="var(--color-forest-soft)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const categoryPaths: Record<Category, JSX.Element> = {
  Aquatics: (
    <>
      <path d="M2 13c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
      <path d="M2 18c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
      <circle cx="15" cy="5.5" r="2" /><path d="M9 9l3-2.5 2 1.5" />
    </>
  ),
  Arts: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 21 9.7C21 5.9 17 3 12 3z" />
      <circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7" r="1" />
    </>
  ),
  Sports: (
    <>
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18" />
      <path d="M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9" /><path d="M12 3c-2.5 2.4-3.8 5.4-3.8 9s1.3 6.6 3.8 9" />
    </>
  ),
  Gymnastics: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
};

export const CategoryIcon = ({ category, size = 56 }: P & { category: Category }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" strokeWidth={size > 60 ? 1.4 : 1.6} {...stroke}>
    {categoryPaths[category]}
  </svg>
);
