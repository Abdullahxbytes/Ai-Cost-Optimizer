import {
  ArrowRight,
  ChartLineUp,
  Database,
  ShieldCheck,
  ShuffleSimple,
  Sparkle,
} from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import analyticsSavings from '../assets/analytics-savings.png';
import dashboardOverview from '../assets/dashboard-overview.jpg';
import heroArtwork from '../assets/hero.png';

const productStories = [
  {
    icon: ShuffleSimple,
    title: 'One path for every request.',
    description:
      'Send agent traffic through the CostFlow proxy before it reaches a provider. Keep providers, models, teams, and spend visible from one control point.',
    className: 'marketing-story-route',
  },
  {
    icon: Database,
    title: 'Return the answer before making the call.',
    description:
      'Semantic cache and prompt optimization reduce repeated work while preserving the operating context your agents need.',
    className: 'marketing-story-cache',
  },
  {
    icon: ShieldCheck,
    title: 'Set limits that hold.',
    description:
      'Define organization, team, or agent budgets. CostFlow checks spend at the proxy so a limit is enforced where the request happens.',
    className: 'marketing-story-budget',
  },
  {
    icon: ChartLineUp,
    title: 'Show where the savings came from.',
    description:
      'Track cost, tokens, cache performance, and optimization impact by provider, model, agent, and team.',
    className: 'marketing-story-analytics',
  },
] as const;

export function Landing() {
  return (
    <main className="landing-page marketing-page">
      <header className="marketing-nav">
        <Link to="/" aria-label="CostFlow home">
          <img className="marketing-logo" src="/images/costflow_logo-Photoroom.png" alt="CostFlow" />
        </Link>
        <nav aria-label="Landing page">
          <a href="#product">Product</a>
          <a href="#results">Results</a>
        </nav>
        <div className="marketing-nav-actions">
          <Link to="/login" className="marketing-login">
            Log in
          </Link>
          <Link to="/signup" className="marketing-button marketing-button-small">
            Get started
          </Link>
        </div>
      </header>

      <section className="marketing-hero" aria-labelledby="marketing-heading">
        <div className="marketing-hero-copy">
          <p className="marketing-kicker">AI cost intelligence at the request layer</p>
          <h1 id="marketing-heading">Route every AI request. Spend less on every one.</h1>
          <p>
            CostFlow sits between your agents and AI providers, turning each request into a chance to
            optimize, enforce budgets, and understand what your organization is really spending.
          </p>
          <div className="marketing-hero-actions">
            <Link to="/signup" className="marketing-button">
              Create your workspace <ArrowRight aria-hidden="true" size={18} weight="bold" />
            </Link>
            <a href="#product" className="marketing-text-action">
              See how CostFlow works
            </a>
          </div>
          <p className="marketing-fit">
            Built for AI-first SaaS teams and mid-market platforms with serious AI spend.
          </p>
        </div>
        <div className="marketing-hero-visual" aria-label="CostFlow request routing illustration">
          <div className="marketing-hero-glow" />
          <div className="marketing-route-node marketing-route-node-agent">Your agent</div>
          <div className="marketing-route-line marketing-route-line-in" />
          <div className="marketing-proxy-node">
            <img src={heroArtwork} alt="" />
            <strong>CostFlow proxy</strong>
            <span>Optimize · enforce · measure</span>
          </div>
          <div className="marketing-route-line marketing-route-line-out" />
          <div className="marketing-route-node marketing-route-node-provider">AI provider</div>
        </div>
      </section>

      <section className="marketing-evidence" aria-label="CostFlow dashboard preview">
        <div className="marketing-evidence-header">
          <p className="marketing-kicker">A real operating view</p>
          <p>Cost, calls, active agents, and budget utilization in one workspace.</p>
        </div>
        <figure className="marketing-dashboard-frame">
          <img src={dashboardOverview} alt="CostFlow dashboard showing cost trends and budget utilization" />
        </figure>
      </section>

      <section id="product" className="marketing-product" aria-labelledby="product-heading">
        <div className="marketing-section-heading">
          <p className="marketing-kicker">Built around the request</p>
          <h2 id="product-heading">
            Control cost without asking your team to watch another dashboard all day.
          </h2>
        </div>
        <div className="marketing-bento">
          {productStories.map(({ icon: Icon, title, description, className }, index) => (
            <article
              key={title}
              className={`marketing-story ${className} marketing-reveal marketing-reveal-${index + 1}`}
            >
              <div className="marketing-story-copy">
                <Icon className="marketing-story-icon" aria-hidden="true" size={27} weight="regular" />
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              {className === 'marketing-story-route' && (
                <div className="marketing-route-preview" aria-hidden="true">
                  <span>Agent request</span>
                  <i />
                  <b>CostFlow</b>
                  <i />
                  <span>Provider response</span>
                </div>
              )}
              {className === 'marketing-story-cache' && (
                <div className="marketing-analytics-crop" aria-hidden="true">
                  <img src={analyticsSavings} alt="" />
                </div>
              )}
              {className === 'marketing-story-budget' && (
                <div className="marketing-budget-preview" aria-hidden="true">
                  <div className="marketing-budget-preview-top">
                    <span>Team budget</span>
                    <strong>65%</strong>
                  </div>
                  <div className="marketing-budget-meter">
                    <i />
                  </div>
                  <p>$57.00 of $88.00 protected</p>
                </div>
              )}
              {className === 'marketing-story-analytics' && (
                <div className="marketing-analytics-preview">
                  <img
                    src={analyticsSavings}
                    alt="CostFlow analytics showing cache hit rate and optimization savings"
                  />
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section id="results" className="marketing-results" aria-labelledby="results-heading">
        <div>
          <p className="marketing-kicker">Cost decisions backed by request data</p>
          <h2 id="results-heading">Make each provider call accountable to a budget and a result.</h2>
        </div>
        <div className="marketing-results-list">
          <p>
            <Sparkle aria-hidden="true" size={20} weight="fill" /> Cache and prompt savings are measured, not
            guessed.
          </p>
          <p>
            <ShieldCheck aria-hidden="true" size={20} weight="fill" /> Limits are checked before a request
            reaches a provider.
          </p>
          <p>
            <ChartLineUp aria-hidden="true" size={20} weight="fill" /> Finance and engineering work from the
            same request data.
          </p>
        </div>
      </section>

      <section className="marketing-cta" aria-labelledby="cta-heading">
        <p className="marketing-kicker">A better control point for AI spend</p>
        <h2 id="cta-heading">Put CostFlow between your agents and your AI bill.</h2>
        <p>Start with the proxy. Keep the visibility, savings, and limits from the first request onward.</p>
        <Link to="/signup" className="marketing-button marketing-button-light">
          Create your workspace <ArrowRight aria-hidden="true" size={18} weight="bold" />
        </Link>
      </section>

      <footer className="marketing-footer">
        <img className="marketing-logo" src="/images/costflow_logo-Photoroom.png" alt="CostFlow" />
        <p>AI cost intelligence for teams that build with AI.</p>
        <div>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/login">Log in</Link>
        </div>
      </footer>
    </main>
  );
}
