# DYCI Connect | Institutional Hub

DYCI Connect is a premium, centralized ecosystem designed for **Dr. Yanga's Colleges Inc.** It serves as the digital backbone for student governance, institutional resource management, and secure media broadcasting. Built with strict security and a role-based architecture, it ensures a safe and tailored experience for every member of the institution.

## 🚀 Key Modules

### 🛡️ Institutional Security & Onboarding Gauntlet
A mandatory, state-managed sequence ensuring identity integrity and security:
1. **Security Update:** Forced password rotation for provisioned accounts.
2. **Legal Compliance:** Integrated split-pane Conforme (Institutional Agreement) module tied to the current academic year.
3. **Identity Audit:** Granular profile completion and verification system.
4. **Strict Route Guards:** Multi-layered security checks (`ProfileGuard`, `MaintenanceGuard`, `AuthOverrideGuard`, `ReadOnlyGuard`) that silently enforce access rules based on exact role definitions.

### 👥 Role-Based Modular Architecture
The system employs strict role isolation and custom workspaces:
- **Student (L10):** Access to digital handbooks, academic calendars, notifications, and personalized tools.
- **Staff / Faculty (L50):** Departmental resource management and student guidance.
- **Academic Admin (L80):** High-level operations, handbook content management (CMS), activity reporting, and institutional announcements.
- **System Admin / SysAdmin (L90):** The hardened control plane for institutional oversight, user provisioning, active session forensics, system-wide alerts, and maintenance mode toggles.

### 📺 Video Broadcast Network
A high-performance media pipeline leveraging **Cloudflare R2**:
- Direct-to-R2 authenticated upload streams.
- Presigned URL governance for secure institutional content.
- L90-exclusive broadcast management.

## 🔒 Security Roadmap
Advanced authentication features currently in development to harden institutional access:
- **HWID (Hardware ID) Authentication:** Binding accounts to specific authorized devices.
- **OTP (One-Time Password) Verification:** Multi-factor authentication pipelines.
- **Institutional Email Recovery:** Autonomous Google SMTP relay for robust `@dyci.edu.ph` password recovery.

## 💻 Tech Stack

- **Frontend:** React 19 + Vite 7 (TypeScript 5.9)
- **Styling:** Tailwind CSS 4 + Modern CSS Glassmorphism
- **Authentication:** Supabase Auth (Strict JWT & RLS Enforcement)
- **Database:** Supabase PostgreSQL with custom RPCs and Triggers
- **Media Storage:** Cloudflare R2 (S3-Compatible) via Presigned Pipelines
- **State Management:** React Context + Persistent Auth Guards

## 🛠️ Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ghostbyte1014/dyci_connect.git
   cd dyci_connect
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   Create a `.env.local` file with the following keys:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   VITE_STORAGE_API_URL=your_r2_worker_url
   ```

4. **Launch Development:**
   ```bash
   npm run dev
   ```

---
© 2026 Dr. Yanga's Colleges Inc. | Developed for Institutional Excellence.
