import Image from "next/image";

interface BrandMarkProps {
  className?: string;
  priority?: boolean;
}

export function BrandMark({ className, priority = false }: BrandMarkProps) {
  return (
    <Image
      src="/brand/brand-mark.png"
      alt="Open-Inspect brand mark"
      width={48}
      height={48}
      priority={priority}
      className={className}
    />
  );
}
