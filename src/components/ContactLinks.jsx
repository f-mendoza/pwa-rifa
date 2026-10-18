export function ContactLinks({ person }) {
  if (!person.phone && !person.email) {
    return <p className="muted">Sin datos de contacto</p>
  }
  return (
    <ul className="contact">
      {person.phone && (
        <li>
          <a href={`tel:${person.phone.replace(/[^\d+]/g, '')}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
            </svg>
            {person.phone}
          </a>
        </li>
      )}
      {person.email && (
        <li>
          <a href={`mailto:${person.email}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
            {person.email}
          </a>
        </li>
      )}
    </ul>
  )
}
