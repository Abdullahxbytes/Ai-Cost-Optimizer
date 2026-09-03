import { Link } from 'react-router-dom';
export function Unauthorized() {
  return (
    <section className="rounded-2xl border border-red-900/60 bg-red-950/30 p-8">
      <h1 className="text-3xl font-semibold">Sorry! Access denied</h1>
      <p className="mt-3 text-red-200">Due to your current role, you cannot access that route.</p>
      <Link to="/" className="mt-5 inline-block rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">
        Return to your workspace
      </Link>
    </section>
  );
}
