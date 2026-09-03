export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
      <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
      <p className="mt-3 text-slate-400">
        This route is ready. Its operational content will be added in a later module.
      </p>
    </section>
  );
}
