interface StatusCardProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function StatusCard({ eyebrow, title, description }: StatusCardProps) {
  return (
    <div className="rounded-3xl border border-stone-800 bg-stone-900 p-5 shadow-2xl shadow-stone-950/20">
      <p className="text-xs uppercase tracking-[0.3em] text-stone-500">{eyebrow}</p>
      <h2 className="mt-3 text-xl font-semibold text-stone-100">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-stone-400">{description}</p>
    </div>
  );
}
