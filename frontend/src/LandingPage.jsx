import React from "react";
import {
  ArrowUpRight,
  ArrowRight,
  FileText,
  Search,
  Sparkles,
  ShieldCheck,
  Database,
  Workflow,
  Check,
  Command,
  Upload,
  MessageSquareText,
  Layers3,
} from "lucide-react";
import "./LandingPage.css";

const features = [
  {
    number: "01",
    icon: FileText,
    title: "Bring your knowledge",
    description: "Upload PDFs, DOCX, and text files. Keep your team's information in one searchable workspace.",
    tag: "DOCUMENT INGESTION",
  },
  {
    number: "02",
    icon: Search,
    title: "Find the right context",
    description: "Retrieve relevant passages with semantic search instead of guessing which file contains the answer.",
    tag: "VECTOR RETRIEVAL",
  },
  {
    number: "03",
    icon: MessageSquareText,
    title: "Ask. Verify. Move on.",
    description: "Get answers grounded in your documents, with source context you can inspect.",
    tag: "GROUNDED AI",
  },
];

const steps = [
  ["01", "Add documents", "Drop in the files your team already uses."],
  ["02", "Build your index", "Turn content into searchable chunks and vectors."],
  ["03", "Ask better questions", "Get focused answers backed by retrieved context."],
];

export default function LandingPage({ onEnter = () => {} }) {
  return (
    <main className="lp-page">
      <div className="lp-grain" aria-hidden="true" />
      <header className="lp-nav">
        <a className="lp-brand" href="#top" aria-label="RAG Studio home">
          <span className="lp-brand-mark"><Layers3 size={19} strokeWidth={2.4} /></span>
          <span>rag<span className="lp-brand-light">studio</span><sup> BETA</sup></span>
        </a>
        <nav className="lp-nav-links" aria-label="Main navigation">
          <a href="#platform">Platform</a>
          <a href="#workflow">How it works</a>
        </nav>
        <button className="lp-nav-cta" onClick={onEnter}>
          Open workspace <ArrowUpRight size={16} />
        </button>
      </header>

      <section className="lp-hero" id="top">
        <div className="lp-hero-copy">
          <div className="lp-kicker"><span className="lp-kicker-dot" /> YOUR KNOWLEDGE, IN CONTEXT</div>
          <h1>Make your documents<br /> <span>answer back.</span></h1>
          <p className="lp-hero-description">
            A focused workspace for turning scattered documents into useful, searchable knowledge.
            Ask questions and get answers grounded in your own data.
          </p>
          <div className="lp-hero-actions">
            <button className="lp-button-primary" onClick={onEnter}>
              Enter RAG Studio <ArrowRight size={17} />
            </button>
            <a className="lp-text-link" href="#platform">Explore the platform <ArrowUpRight size={15} /></a>
          </div>
          <div className="lp-hero-footnote">
            <span><Check size={13} /> Your documents stay your source of truth</span>
            <span className="lp-footnote-divider" />
            <span>Built for practical RAG workflows</span>
          </div>
        </div>

        <div className="lp-visual-wrap" aria-label="Illustration of a document question and grounded AI answer">
          <div className="lp-visual-label"><span className="lp-live-dot" /> LIVE WORKSPACE PREVIEW</div>
          <div className="lp-window">
            <div className="lp-window-top">
              <div className="lp-window-dots"><i /><i /><i /></div>
              <span>workspace / knowledge assistant</span>
              <Command size={14} />
            </div>
            <div className="lp-window-body">
              <aside className="lp-mini-sidebar">
                <div className="lp-mini-logo"><Layers3 size={16} /></div>
                <div className="lp-mini-active"><Database size={16} /></div>
                <div><FileText size={16} /></div>
                <div><Search size={16} /></div>
                <div><Workflow size={16} /></div>
              </aside>
              <div className="lp-chat-preview">
                <div className="lp-preview-heading">
                  <div><small>KNOWLEDGE ASSISTANT</small><strong>Ask your workspace</strong></div>
                  <span className="lp-status-pill"><i /> Indexed</span>
                </div>
                <div className="lp-question">
                  <span className="lp-avatar lp-avatar-user">Y</span>
                  <p>What does our employee training policy say?</p>
                </div>
                <div className="lp-answer">
                  <div className="lp-answer-heading"><span className="lp-avatar lp-avatar-ai"><Sparkles size={13} /></span><strong>RAG Studio</strong><span>ANSWER</span></div>
                  <p>Employees receive <mark>15 days of training annually</mark>. Technical training is provided by the learning department.</p>
                  <div className="lp-source">
                    <div className="lp-source-icon"><FileText size={14} /></div>
                    <div><strong>Employee Training Policy.pdf</strong><small>Source · Retrieved passage 01</small></div>
                    <ShieldCheck size={15} />
                  </div>
                </div>
                <div className="lp-input-preview"><span>Ask a question about your documents...</span><span className="lp-send"><ArrowUpRight size={15} /></span></div>
                <div className="lp-preview-caption">Illustrative preview · sample content</div>
              </div>
            </div>
          </div>
          <div className="lp-float-card lp-float-top"><span className="lp-float-icon"><Upload size={15} /></span><span><b>Documents indexed</b><small>Ready for retrieval</small></span><strong>↗</strong></div>
          <div className="lp-float-card lp-float-bottom"><span className="lp-float-check"><Check size={14} /></span><span><b>Answer grounded</b><small>Source attached</small></span></div>
        </div>
      </section>

      <section className="lp-proof">
        <span>ONE WORKSPACE</span><i />
        <span>YOUR DOCUMENTS</span><i />
        <span>SEMANTIC SEARCH</span><i />
        <span>GROUNDED ANSWERS</span>
      </section>

      <section className="lp-platform" id="platform">
        <div className="lp-section-intro">
          <div className="lp-kicker">THE PLATFORM</div>
          <h2>Less hunting.<br /><span>More understanding.</span></h2>
          <p>Everything you need for a practical retrieval-augmented generation workflow, without the clutter.</p>
        </div>
        <div className="lp-feature-grid">
          {features.map(({ number, icon: Icon, title, description, tag }) => (
            <article className="lp-feature" key={number}>
              <div className="lp-feature-top"><span>{number} / 03</span><Icon size={20} strokeWidth={1.8} /></div>
              <div className="lp-feature-tag">{tag}</div>
              <h3>{title}</h3>
              <p>{description}</p>
              <div className="lp-feature-line" />
            </article>
          ))}
        </div>
      </section>

      <section className="lp-workflow" id="workflow">
        <div className="lp-workflow-heading">
          <div className="lp-kicker">A CLEAR WORKFLOW</div>
          <h2>From files to <span>answers.</span></h2>
        </div>
        <div className="lp-steps">
          {steps.map(([number, title, description], index) => (
            <div className="lp-step" key={number}>
              <span className="lp-step-number">{number}</span>
              <div className="lp-step-rule"><i style={{ width: index === 2 ? "100%" : "58%" }} /></div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-bottom-cta">
        <div>
          <div className="lp-kicker">READY WHEN YOU ARE</div>
          <h2>Your knowledge has<br />a better place to live.</h2>
        </div>
        <button className="lp-button-primary" onClick={onEnter}>Open your workspace <ArrowRight size={17} /></button>
      </section>

      <footer className="lp-footer">
        <a className="lp-brand" href="#top"><span className="lp-brand-mark"><Layers3 size={17} /></span><span>rag<span className="lp-brand-light">studio</span></span></a>
        <span>Built to make knowledge useful.</span>
        <span>© 2026 RAG Studio</span>
      </footer>
    </main>
  );
}
