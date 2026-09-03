import { Link, Navigate } from 'react-router-dom';
import ScrollStack, { ScrollStackItem } from '../components/ScrollStack';
import { defaultRouteForRole } from '../config/navigation';
import { useAuthStore } from '../store/authStore';

type Benefit = {
  label: string;
  title: string;
  description: string;
};

const benefits: Benefit[] = [
  {
    label: 'Control',
    title: 'Keep every budget within reach.',
    description:
      'Set real limits, see current spend, and stop runaway AI agent costs before they become a surprise.',
  },
  {
    label: 'Understand',
    title: 'See every AI decision clearly.',
    description:
      'Follow spend by provider, model, agent, and team in one focused workspace built for fast answers.',
  },
  {
    label: 'Optimize',
    title: 'Make every request work harder.',
    description:
      'Use semantic caching and prompt optimization to reduce repeat work without changing what your agents do.',
  },
];

export function Landing() {
  const user = useAuthStore((state) => state.user);

  if (user) {
    return <Navigate to={defaultRouteForRole(user.role)} replace />;
  }

  return (
    <main className="landing-page">
      <header className="landing-nav">
        <Link to="/" aria-label="Cost Flow home">
          <img className="landing-logo" src="/images/costflow_logo-Photoroom.png" alt="Cost Flow" />
        </Link>
        <div className="landing-nav-actions">
          <Link to="/login" className="landing-login">
            Log in
          </Link>
          <Link to="/signup" className="landing-button landing-button-small">
            Get started
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <h1 className="landing-reveal landing-reveal-two">Give every AI request a smarter path.</h1>
        <p className="landing-lede landing-reveal landing-reveal-three">
          Cost Flow gives your organization the visibility and control to run AI agents with confidence—from
          the first request to every dollar spent.
        </p>
        <div className="landing-hero-actions landing-reveal landing-reveal-four">
          <Link to="/signup" className="landing-button">
            Get started free
          </Link>
          <Link to="/login" className="landing-text-link">
            I already have an account <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <section className="landing-benefits">
        <div className="landing-benefits-intro landing-scroll-reveal">
          <h2>Less uncertainty. Better AI operations.</h2>
          <p>Designed for practical control</p>
        </div>

        <ScrollStack className="landing-feature-stack">
          {benefits.map((benefit, index) => (
            <ScrollStackItem key={benefit.label}>
              <article className={`landing-feature-card landing-scroll-reveal landing-delay-${index + 1}`}>
                <div className="landing-feature-copy">
                  <p className="landing-feature-label">{benefit.label}</p>
                  <h3>{benefit.title}</h3>
                  <p>{benefit.description}</p>
                </div>
              </article>
            </ScrollStackItem>
          ))}
        </ScrollStack>
      </section>

      <section className="landing-workflow">
        <div className="landing-workflow-copy">
          <p className="landing-eyebrow">One reliable workflow</p>
          <h2>Make AI spend visible before it gets complicated.</h2>
          <p>
            Connect your organization’s provider key, register your agents, and let Cost Flow measure,
            protect, and optimize each request.
          </p>
          <Link to="/signup" className="landing-text-link">
            Create your workspace <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="landing-flow-card" aria-label="Cost Flow workflow illustration">
          <div>
            <b>1</b>
            <span>Connect provider keys</span>
          </div>
          <i />
          <div>
            <b>2</b>
            <span>Route agent traffic</span>
          </div>
          <i />
          <div>
            <b>3</b>
            <span>Track and optimize</span>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <img className="landing-logo" src="/images/costflow_logo-Photoroom.png" alt="Cost Flow" />
        <p>AI cost control for teams that build with intelligence.</p>
        <Link to="/login">Log in</Link>
      </footer>
    </main>
  );
}
