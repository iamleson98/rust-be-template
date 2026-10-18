import { LegalPage } from './legal-page'
import { privacyPolicy } from './privacy-policy'
import { termsOfUse } from './terms-of-use'

export const PrivacyPage = () => <LegalPage doc={privacyPolicy} />
export const TermsPage = () => <LegalPage doc={termsOfUse} />
