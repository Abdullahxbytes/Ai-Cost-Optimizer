import { Link } from 'react-router-dom';

export function Legal({ title }: { title: 'Privacy' | 'Terms' }) {
  return (
    <main className="landing-page">
      <section className="mx-auto w-[min(100%-3rem,46rem)] py-24">
        <Link to="/" className="marketing-text-action">
          Back to CostFlow
        </Link>
        <h1 className="mt-8 text-5xl font-semibold">{title}</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-[#706a61]">
          {title === 'Privacy'
            ? 'CostFlow is committed to handling organization data responsibly. This policy will describe how account, usage, and provider data are processed when the service is publicly available.'
            : 'These terms will describe the conditions for using CostFlow when the service is publicly available.'}
        </p>
      </section>
    </main>
  );
}
