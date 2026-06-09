interface StatusCardProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function StatusCard({ eyebrow, title, description }: StatusCardProps) {
  return (
    <div className="host-card rounded-3xl border p-5">
      <p className="host-page-eyebrow text-xs uppercase tracking-[0.3em]">{eyebrow}</p>
      <h2 className="host-page-title mt-3 text-xl font-semibold">{title}</h2>
      <p className="host-page-description mt-2 text-sm leading-6">{description}</p>
    </div>
  );
}
