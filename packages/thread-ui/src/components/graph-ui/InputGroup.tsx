import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { Button } from './Button';
import { cn } from './utils';

function InputGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        'group/input-group relative flex w-full min-w-0 items-center rounded-md border shadow-xs outline-none transition-[color,box-shadow]',
        'h-9 has-[>textarea]:h-auto',
        'has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col',
        'has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col',
        className,
      )}
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  'flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium select-none [&>svg:not([class*=size-])]:size-4',
  {
    variants: {
      align: {
        'inline-start': 'order-first pl-3 has-[>button]:ml-[-0.45rem]',
        'inline-end': 'order-last pr-3 has-[>button]:mr-[-0.45rem]',
        'block-start': 'order-first w-full justify-start px-3 pt-3',
        'block-end': 'order-last w-full justify-start px-3 pb-3',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
);

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) {
          return;
        }
        const control = event.currentTarget.parentElement?.querySelector<
          HTMLElement
        >(
          '[data-slot="input-group-control"] [contenteditable="true"], [data-slot="input-group-control"] textarea, [data-slot="input-group-control"] input, [data-slot="input-group-control"]',
        );
        control?.focus();
      }}
      {...props}
    />
  );
}

const inputGroupButtonVariants = cva('flex items-center gap-2 text-sm shadow-none', {
  variants: {
    size: {
      xs: 'h-6 gap-1 rounded-[calc(var(--radius)-5px)] px-2 has-[>svg]:px-2 [&>svg:not([class*=size-])]:size-3.5',
      sm: 'h-8 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2.5',
      'icon-xs': 'size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0',
      'icon-sm': 'size-8 p-0 has-[>svg]:p-0',
    },
  },
  defaultVariants: {
    size: 'xs',
  },
});

function InputGroupButton({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'xs',
  ...props
}: Omit<ComponentProps<typeof Button>, 'size'> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'flex items-center gap-2 text-sm [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    />
  );
}

function InputGroupInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input-group-control"
      className={cn(
        'flex-1 rounded-none border-0 bg-transparent shadow-none outline-none',
        className,
      )}
      {...props}
    />
  );
}

function InputGroupTextarea({
  className,
  ...props
}: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="input-group-control"
      className={cn(
        'flex-1 resize-none rounded-none border-0 bg-transparent py-3 shadow-none outline-none',
        className,
      )}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
};
