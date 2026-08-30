import LegalDocument, { LegalSection } from './LegalDocument'

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy" updated="31 August 2026">
      <LegalSection title="1. Who we are">
        <p>
          This Privacy Policy explains how Accelute (“we”, “us”) collects and
          uses information when you visit accelute.co or use the AI whiteboard
          tutor. It should be read with our{' '}
          <a href="/terms">Terms of Service</a>.
        </p>
        <p>
          Questions or requests:{' '}
          <a href="mailto:hi@accelute.co">hi@accelute.co</a>.
        </p>
      </LegalSection>

      <LegalSection title="2. What we collect">
        <p>Depending on how you use the Service, we may process:</p>
        <ul>
          <li>
            <strong className="font-medium text-frost">Anonymous session id.</strong>{' '}
            A browser cookie (for example <code className="text-ice">htutor_uid</code>)
            maps you to a user row so boards and notes can persist. There is no
            required login or password.
          </li>
          <li>
            <strong className="font-medium text-frost">Lesson content.</strong>{' '}
            Questions you type, photos or files you upload, follow-ups, and
            notes or chat on a board.
          </li>
          <li>
            <strong className="font-medium text-frost">Technical data.</strong>{' '}
            IP address, browser type, device information, and basic usage
            logs needed to run and secure the site.
          </li>
          <li>
            <strong className="font-medium text-frost">Email.</strong> Only if
            you subscribe in the footer or write to us. We use it to reply or
            send the updates you asked for.
          </li>
        </ul>
        <p>
          We do not ask for your real name, school, or payment card on the
          free tutor today. If that changes, we will update this policy.
        </p>
      </LegalSection>

      <LegalSection title="3. How we use it">
        <p>We use this information to:</p>
        <ul>
          <li>run lessons — plan a scene, draw on the board, and speak</li>
          <li>save and restore your boards, notes, and replays</li>
          <li>keep the Service reliable, debug failures, and prevent abuse</li>
          <li>answer you if you email us or subscribe</li>
        </ul>
        <p>
          We do not sell your personal information. We do not use lesson
          photos or questions to advertise to you.
        </p>
      </LegalSection>

      <LegalSection title="4. Models and other processors">
        <p>
          To teach and speak, questions and related lesson text are sent to
          language-model and text-to-speech providers we contract with. Hosting
          and storage may sit with our cloud providers. Those parties process
          data only to provide their service to us, under their terms and
          ours.
        </p>
        <p>
          If you do not want a question processed by those systems, do not
          submit it.
        </p>
      </LegalSection>

      <LegalSection title="5. Cookies">
        <p>
          We use a small essential cookie so the tutor can recognise the same
          browser across visits. The marketing site may use similar technical
          cookies to load the page. We do not run third-party advertising
          cookies on Accelute.
        </p>
      </LegalSection>

      <LegalSection title="6. How long we keep it">
        <p>
          Boards and notes stay until you delete them or we remove inactive
          data as part of ordinary operations. Server logs are kept only as
          long as needed for security and debugging. Email from a subscribe
          form is kept until you ask us to remove it.
        </p>
      </LegalSection>

      <LegalSection title="7. Children">
        <p>
          Accelute is a learning tool. It is not directed at children under 13,
          and we do not knowingly collect personal information from them. If
          you believe a child under 13 has used the Service, email{' '}
          <a href="mailto:hi@accelute.co">hi@accelute.co</a> and we will delete
          the associated data we can identify.
        </p>
      </LegalSection>

      <LegalSection title="8. Your choices">
        <p>You can:</p>
        <ul>
          <li>clear site cookies in your browser to drop the anonymous id</li>
          <li>delete boards from the tutor when that control is available</li>
          <li>
            email <a href="mailto:hi@accelute.co">hi@accelute.co</a> to ask
            what we hold, to correct it, or to delete it
          </li>
        </ul>
        <p>
          If you are in a region with additional privacy rights (for example
          access, erasure, or a complaint to a regulator), contact us and we
          will handle the request as the law requires.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes">
        <p>
          We may update this policy. The date at the top will change when we
          do. Material changes will be reflected on this page.
        </p>
        <p>
          Related:{' '}
          <a href="/terms">Terms of Service</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  )
}
