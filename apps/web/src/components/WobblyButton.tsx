import { motion } from 'framer-motion';
import type { HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';

type WobblyButtonProps = {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
} & HTMLMotionProps<'button'>;

export function WobblyButton({
  children,
  className = '',
  variant = 'primary',
  size = 'md',
  type = 'button',
  ...props
}: WobblyButtonProps) {
  let variantStyles = 'bg-[var(--accent)] text-[#fffaf1] hover:brightness-105';
  if (variant === 'secondary') {
    variantStyles = 'bg-[var(--card)] text-[var(--foreground)] hover:bg-[#eae3d6]';
  } else if (variant === 'outline') {
    variantStyles = 'bg-transparent text-[var(--foreground)] hover:bg-[var(--card)]';
  } else if (variant === 'danger') {
    variantStyles = 'bg-[var(--warm-error)] text-white hover:brightness-110';
  } else if (variant === 'ghost') {
    variantStyles = 'bg-transparent text-[var(--foreground)] border-none shadow-none hover:bg-black/5';
  }

  let sizeStyles = 'px-4 py-2 text-sm';
  if (size === 'sm') sizeStyles = 'px-2.5 py-1 text-xs';
  if (size === 'lg') sizeStyles = 'px-6 py-3 text-base';

  const outlineAndShadow = variant === 'ghost' ? '' : 'line-boil rough-outline rough-shadow loose-shape-pill';

  return (
    <motion.button
      type={type}
      whileHover={{ scale: 1.02, rotate: -0.3 }}
      whileTap={{ scale: 0.97, rotate: 0.2 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      className={[
        outlineAndShadow,
        variantStyles,
        sizeStyles,
        'font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </motion.button>
  );
}
