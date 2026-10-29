# Known Issues, Environmental Prerequisites & Operational Notes

**Project**: D-Arrow Business / DROO  
**Category**: Operational & Environmental Documentation  
**Status**: ACTIVE  

---

## 1. Environmental Prerequisites & Boundaries

### 1.1 Local Firebase Emulators
- **Port Allocation**:
  - Firebase Authentication Emulator: `http://127.0.0.1:9099`
  - Cloud Firestore Emulator: `http://127.0.0.1:8080` (WebSocket on port `9150`)
  - Cloud Storage Emulator: `http://127.0.0.1:9199`
- **Advisory Message**:
  During test suite startup, the Firebase CLI may emit:
  `! emulators: You are not currently authenticated so some features may not work correctly. Please run firebase login to authenticate the CLI.`
  *Operational Status*: Harmless advisory. Local emulator execution for Firestore, Auth, and Storage does not require active cloud authentication and proceeds with complete local isolation.

### 1.2 Windows PowerShell Command Execution
- In standard Windows PowerShell sessions, bash-style `&&` chaining may trigger `ParserError: The token '&&' is not a valid statement separator`.
- *Remedy*: Execute commands sequentially or use `;` as the statement separator in automated scripts.

### 1.3 Headless Browser Path
- Browser E2E automation scripts (`scripts/test-*-browser.mjs`) target Microsoft Edge at:
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- When running in non-Windows environments (e.g., Linux CI/CD), the browser binary path should be parameterized via the `CHROME_BIN` or `EDGE_BIN` environment variables.

---

## 2. External Integration Boundaries

### 2.1 Zoe AI Assistant Live LLM Stream
- In offline and local test environments, Zoe AI operates in self-contained deterministic mode with pre-configured tool-calling simulations (`test:assistant`).
- *Production Requirement*: To stream real conversational responses in production, the backend requires a valid Gemini API Key (`VITE_GEMINI_API_KEY`) or OpenAI compatible endpoint. If unconfigured, the assistant gracefully falls back to structured local guidance without crashing the UI.

### 2.2 ZATCA E-Invoicing Phase 2 Integration
- The Invoicing & Billing module generates compliant XML structures, cryptographic hashes, and QR code payloads (`test:invoice-prefill`).
- *Production Boundary*: Direct clearance with the ZATCA portal requires an authorized Cryptographic Stamp Identifier (CSID) issued by the tax authority. In local development and staging environments, the module operates in preview mode with local QR code generation.

### 2.3 EmailJS / SMTP Delivery
- The invitation delivery service (`src/features/auth/services/invite-service.ts`) includes automated email delivery.
- In test environments, `VITE_DISABLE_EMAIL_DELIVERY="true"` is automatically set to prevent external outbound network calls while returning verifiable invitation tokens (`test:invite-delivery`).

---

## 3. Self-Healing & Architecture Stabilizations Applied

| Subject | Identified Issue | Self-Healing Resolution |
| :--- | :--- | :--- |
| **Lucide Icon Types** | Over 5,800 icon components lacked explicit TypeScript declaration files in strict compilation mode. | Implemented `scripts/generate-lucide-types.cjs` in the `npm run prebuild` hook to dynamically emit typed definitions. |
| **Projects Core Route** | Initial route guard logic restricted `/projects` for tenants outside the generic `PROJECTS` vertical. | Promoted `/projects` to `CORE_ROUTE_PREFIXES` in `src/lib/activity-routes.ts`, allowing all business activities to access project operations with custom terminology. |
| **Settings Activity Card** | Duplicate activity selection widgets on the home landing could cause tenant configuration ambiguity. | Removed all activity controls from the Home Page and main Dashboard; encapsulated the authoritative setting card inside `/settings/company` guarded by `can("company.manage")`. |
| **RTL Directional Layout** | Arabic locale changes required consistent layout flipping and translation string alignment. | Integrated bidirectional layout listeners (`dir="rtl"`) on the root document element with automated validation in browser tests. |

