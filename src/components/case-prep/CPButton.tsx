import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Compact buttons for the case-prep workspace. The app's comic buttons are
// built for single calls to action; review screens repeat actions on every row
// and need something quieter.
const cpButton = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-transparent hover:bg-muted',
        quiet: 'hover:bg-muted',
        accept: 'border border-[hsl(var(--cp-verified)/0.6)] text-[hsl(var(--cp-verified))] hover:bg-[hsl(var(--cp-verified)/0.12)]',
        danger: 'border border-destructive/60 text-destructive hover:bg-destructive/10',
        selected: 'bg-muted text-foreground',
      },
      size: {
        sm: 'h-8 px-2.5 text-[0.8125rem]',
        md: 'h-9 px-3.5',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  }
);

export interface CPButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof cpButton> {}

export const CPButton = React.forwardRef<HTMLButtonElement, CPButtonProps>(({ className, variant, size, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(cpButton({ variant, size }), className)} {...props} />
));
CPButton.displayName = 'CPButton';
