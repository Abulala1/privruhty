import type { ReactNode } from 'react';
import type { RestoredPart } from './bank';
export function Shield() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2 21 6v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z" fill="currentColor" />
      <path
        d="m8 12 3 3 5-6"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function Shell({
  page,
  title,
  description,
  children,
}: {
  page: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <>
      <header className="topbar">
        <a className="logo" href="composer.html">
          <Shield />
          Pribruhty
        </a>
        <span className="local-badge">
          <i /> On your device
        </span>
      </header>
      <main className="workspace">
        <nav className="navigation" aria-label="Tools">
          {[
            ['composer', 'Composer'],
            ['documents', 'Documents'],
            ['wordbank', 'Word bank'],
            ['settings', 'Settings'],
          ].map(([id, name]) => (
            <a
              key={id}
              href={`${id}.html`}
              className={page === id ? 'active' : ''}
              aria-current={page === id ? 'page' : undefined}
            >
              {name}
            </a>
          ))}
        </nav>
        <div className="page-heading">
          <div className="eyebrow">YOUR PRIVATE WORKSPACE</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children}
        <footer className="page-footer">
          Local processing. Review before sharing. Detection can miss sensitive context.
        </footer>
      </main>
    </>
  );
}
export function RestoredText({ parts }: { parts: RestoredPart[] }) {
  return (
    <div className="text-preview">
      {parts.map((part, i) =>
        part.placeholder ? (
          <mark key={i} title={`Actual text: ${part.placeholder}`}>
            {part.text}
            <span className="sr-only"> (displayed in place of {part.placeholder})</span>
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <Shield />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
