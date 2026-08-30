import LegalDocument, { LegalSection } from './LegalDocument'

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Service" updated="31 August 2026">
      <LegalSection title="1. Agreement">
        <p>
          These Terms of Service (“Terms”) govern your use of Accelute, the
          website at accelute.co, and the AI whiteboard tutor (together, the
          “Service”). By using the Service, you agree to these Terms. If you
          do not agree, do not use the Service.
        </p>
        <p>
          The Service is operated by Accelute. Questions:{' '}
          <a href="mailto:hi@accelute.co">hi@accelute.co</a>.
        </p>
      </LegalSection>

      <LegalSection title="2. The Service">
        <p>
          Accelute is an AI tutor that teaches on a live whiteboard: it draws
          diagrams, writes notes, and speaks through a lesson. You can type a
          question, upload a photo of a problem, follow up mid-lesson, and keep
          notes from a session.
        </p>
        <p>
          The Service is provided for learning and practice. It is not a
          substitute for a qualified teacher, examiner, or professional advice.
          AI output can be incomplete or wrong. Check important results yourself.
        </p>
      </LegalSection>

      <LegalSection title="3. Who may use it">
        <p>
          You must be able to form a binding contract in your country. If you
          are under 18, you may use the Service only with a parent or
          guardian’s permission. We do not knowingly offer accounts aimed at
          children under 13. See the{' '}
          <a href="/privacy">Privacy Policy</a> for how we handle data.
        </p>
      </LegalSection>

      <LegalSection title="4. Your use">
        <p>You agree not to:</p>
        <ul>
          <li>use the Service to break the law or harm others</li>
          <li>upload content you do not have the right to share</li>
          <li>
            try to disrupt, scrape, or reverse engineer the Service beyond
            ordinary use
          </li>
          <li>
            use Accelute to cheat on an exam or violate a school’s academic
            rules
          </li>
          <li>
            resell or wrap the Service as your own product without our written
            consent
          </li>
        </ul>
        <p>
          We may suspend or limit access if we reasonably believe these Terms
          have been broken.
        </p>
      </LegalSection>

      <LegalSection title="5. Your content">
        <p>
          You keep whatever rights you already have in questions, photos, and
          notes you submit. You grant Accelute a licence to use that material
          solely to run the Service for you — for example to plan a lesson,
          draw on the board, speak the explanation, and store a board you can
          reopen.
        </p>
        <p>
          Do not upload sensitive personal data about other people, or
          anything you would not want processed by our infrastructure and
          model providers.
        </p>
      </LegalSection>

      <LegalSection title="6. Our rights">
        <p>
          Accelute, the site, the tutor interface, and related branding are
          ours or our licensors’. These Terms do not give you ownership of the
          Service. You may not copy, modify, or redistribute our software or
          marks except as the Service itself allows.
        </p>
        <p>
          Lesson diagrams and spoken explanations are generated for your
          session. They are not guaranteed to be unique, exam-accurate, or
          fit for publication as your own work.
        </p>
      </LegalSection>

      <LegalSection title="7. Third-party services">
        <p>
          Teaching and voice depend on third-party model and speech providers,
          and the site is hosted on infrastructure we do not control. Their
          outages or limits can affect the Service. We are not responsible for
          those providers’ sites or policies.
        </p>
      </LegalSection>

      <LegalSection title="8. Disclaimer">
        <p>
          The Service is provided “as is” and “as available.” To the fullest
          extent allowed by law, we disclaim warranties of merchantability,
          fitness for a particular purpose, and non-infringement. We do not
          warrant that lessons will be uninterrupted, error-free, or suitable
          for any exam or course.
        </p>
      </LegalSection>

      <LegalSection title="9. Liability">
        <p>
          To the fullest extent allowed by law, Accelute and its operators
          will not be liable for indirect, incidental, special, consequential,
          or punitive damages, or for lost marks, lost data, or lost profits,
          arising from your use of the Service. Our total liability for any
          claim relating to the Service will not exceed the amount you paid us
          in the three months before the claim, or US$50 if you paid nothing.
        </p>
        <p>
          Some places do not allow certain limits. In those places, our
          liability is limited to the maximum extent permitted.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes and contact">
        <p>
          We may update these Terms. The “Last updated” date at the top will
          change when we do. Continued use after an update means you accept
          the new Terms.
        </p>
        <p>
          Contact:{' '}
          <a href="mailto:hi@accelute.co">hi@accelute.co</a>
          . Related:{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  )
}
