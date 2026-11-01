import { motion } from 'framer-motion';
import type { HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';

type WobblyCardProps = {
  children: ReactNode;
  variant?: 'card' | 'header' | 'input' | 'pill';
  hideOutline?: boolean;
} & HTMLMotionProps<'div'>;

export function WobblyCard({
  children,
  className = '',
  variant = 'card',
  hideOutline = false,
  ...props
}: WobblyCardProps) {
  let shapeClass = 'loose-shape-card';
  if (variant === 'header') shapeClass = 'loose-shape-header';
  if (variant === 'input') shapeClass = 'loose-shape-input';
  if (variant === 'pill') shapeClass = 'loose-shape-pill';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={[
        'line-boil',
        hideOutline ? '' : 'rough-outline',
        'rough-shadow',
        shapeClass,
        'bg-[var(--card)]',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </motion.div>
  );
}
