# Welcome to your Lovable project

TODO: Document your project here
# Easterseals Volunteer Scheduler 🗓️

### The Problem
Coordinating hundreds of volunteers across multiple departments (Camp Sunnyside, Adult Day Services, etc.) at Easterseals Iowa was a manual, fragmented process prone to scheduling conflicts and reporting delays.

### The Solution
A centralized, automated web application designed to streamline the volunteer lifecycle. This tool empowers coordinators to manage shift demands while providing volunteers with a transparent, self-service booking experience.

### Key Product Features
* **Admin Dashboard:** Real-time visibility into total shifts, bookings, and volunteer capacity.
* **Automated Notifications:** Integration with Resend to handle shift confirmations and cancellations.
* **Dynamic Filtering:** Search and filter shifts by department, date range, and status.
* **Data Export:** One-click CSV generation for reporting volunteer hours and impact.
* **Security First:** Implemented Row Level Security (RLS) and secure secret management for all API integrations.

### Tech Stack
* **Frontend:** React, Vite, Tailwind CSS, Shadcn/UI
* **Backend/DB:** Supabase (PostgreSQL)
* **Auth & Security:** Supabase Auth with environment-variable-based secret management.
* **Deployment:** Vercel with a custom GitHub Actions CI/CD pipeline.