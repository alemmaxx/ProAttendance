# ProAttendance

A worker attendance system sold as a subscription (SaaS) to many companies. Each company sees its own name and logo. The name "ProAttendance" only appears in the website name.

- **Workers:** https://proattendancemy.web.app (log in with staff ID + PIN)
- **Company admin:** https://proattendancemy.web.app/admin.html
- **Super Admin:** https://proattendancemy.web.app/superadmin.html
- **QR kiosk:** opened from the admin's **Lokasi** page (`/qr.html?l=…`)

## Folder structure
```
public/            → website (deployed to Firebase Hosting)
  index.html       → worker page
  admin.html       → company admin page
  superadmin.html  → super admin page
  qr.html          → dynamic QR display (changes every 30 seconds)
  js/config.js     → ⚠️ fill in firebaseConfig here
functions/         → Cloud Functions (reset PIN, enable/disable worker, ToyyibPay)
firestore.rules    → security rules for the "proattendance" database
.github/workflows/deploy.yml → automatic deploy to Firebase on every push
```

## One-time setup

### 1. Fill in the Firebase config
Open `public/js/config.js` and copy the `firebaseConfig` of the **kukusanmy** project. It is the same config ProSewa uses.

### 2. Firestore database
Firebase Console → Firestore → **Create database**
- Database ID: `proattendance`
- Location: `asia-southeast1`

### 3. Hosting site
Firebase Console → Hosting → **Add another site**, then enter `proattendancemy`.

### 4. Authentication
- Sign-in method: turn on **Email/Password** and **Google** (if not already on).
- Settings → Authorized domains: add `proattendancemy.web.app`.

### 5. GitHub secret (automatic deploy)
1. Firebase Console → Project settings → Service accounts → **Generate new private key**
2. GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT_KUKUSANMY`
   - Value: the full contents of the JSON file
3. Delete the JSON file from your computer.

From then on, every push to the `main` branch deploys automatically.

### 6. Rules & Cloud Functions (from CMD, once and whenever they change)
```
cd ProAttendance
firebase deploy --only firestore:proattendance
cd functions && npm install && cd ..
firebase deploy --only functions:proattendance
```
> ⚠️ Always use `--only`, so that KUKUSAN and ProSewa are not touched.
> The functions reuse the `TOYYIBPAY_SECRET_KEY` secret that already exists in kukusanmy.

### 7. Claim Super Admin
Open `/superadmin.html`, log in with your email, then press **"Ya, jadikan Super Admin"**. Do this **straight after the first deploy**, because only the first account to claim it becomes Super Admin.

Then go to **Pakej & Harga** and set the trial length and the prices.

## Phase 1 (F1) — done
- Worker login with ID + 6-digit PIN (PIN must be changed on first login)
- White-label: company name, logo and colour on every page
- Three clock-in modes per location: plain button / GPS + geofence / dynamic QR
- Selfie on punch (on/off) and one phone per worker (on/off)
- Admin: live dashboard, worker list with allowances (+) and deductions (+), allowance templates, locations, reports (Excel/PDF), announcements, settings, subscription
- Super Admin: companies, editable plans and prices, editable trial length, payments, statistics (the ToyyibPay category is fixed in `functions/index.js`)
- ToyyibPay payments, with payment status checked directly with ToyyibPay

## Phase 2 (F2) — done
- Shift templates (+) and a weekly roster for each worker (copy last week, clear)
- Default shift and work days for each worker (night shifts that cross midnight are supported)
- Leave / MC with an attachment, half days, yearly entitlement plus carry forward, and leave balances
- Public holidays (+), fixed national holidays, and copy from last year
- OT requests, with OT rates for normal days, rest days and public holidays
- Punch corrections (forgotten punches): once approved, the punch is added automatically
- An Approvals page (pending / history), plus a pending badge on the dashboard
- Reports: leave, absences based on roster/shifts/holidays, and OT by category
- WhatsApp: worker → employer, and admin → worker

## Phase 3 (F3) — done
- Payroll: generate each month's draft automatically (basic pay, allowances, approved OT, leave, absences, lateness, claims, advances, contributions)
- Every line is editable with (+), with a "Recalculate contributions" button
- Contribution rates (EPF, SOCSO, EIS) are entered manually as percentages in Payroll Settings, or as fixed amounts per worker (PCB included)
- Lock & Publish: payslips reach workers, claims and advances are marked paid, and "one-time" items are removed
- Payslips as PDF (print) with the company logo, a bulk print of all slips, Excel export, and a bank file (CSV)
- Workers: claims (with receipt photo), salary advances, and their payslips in the Profil tab

## Phase 4 (F4) — done
- **Kiosk mode** (`/kiosk.html`): one tablet at the entrance; workers punch with ID + PIN or by scanning their QR staff card
- **Offline**: punches are kept on the phone and sent automatically once the internet is back (using the phone's time)
- **Extra admins**: Manager / Supervisor (Settings → Admins & Supervisors)
- **Change log** for every important admin action, plus **backup** (download all data as JSON)
- **Promo codes** (add days / % discount, single-use) and a **promo kit** in Super Admin
- **Landing page** (`/landing.html`) for TikTok/FB, with pricing pulled from Super Admin and a WhatsApp sales button
- WhatsApp sharing of the daily attendance summary from the dashboard
- **Support mode**: Super Admin → Companies → **Open** goes into any company

## Phase 5 (F5) — done
- **HR file** per worker: documents (with expiry reminders), warnings, performance reviews, assets, loans (instalments deducted automatically from pay), onboarding checklist, resignation
- **Daily tasks** (admin assigns, worker marks done with a photo)
- **Site visits** for field workers (GPS + photo; switch it on in Settings)
- **Shift swaps** between workers (admin approval, roster updated automatically)
- **Polls** in announcements
- Dashboard: 14-day chart, best attendance of the month, 14-day staffing forecast, birthdays, work anniversaries, documents about to expire
- Payroll: perfect-attendance bonus, labour cost by location, **yearly summary to help fill in the EA form**
- Printable digital staff cards with QR codes
- **Multiple companies** under one owner (switch from the sidebar)

## Phase 6 (F6) — done
- **Agents / resellers**: each agent gets a link `landing.html?ref=CODE`; sign-ups and sales are tracked per agent, with commission
- **Push notifications** (optional): new requests → admin; approve/reject, announcements, tasks → worker
  - To turn them on: Firebase Console → Project settings → Cloud Messaging → Web Push certificates → **Generate key pair**, then paste the key into `VAPID_KEY` in `public/js/config.js`
- **APK for Google Play**: PNG icons and the manifest are ready. Easiest path: go to https://www.pwabuilder.com, enter `https://proattendancemy.web.app`, choose **Android → Generate**, then upload the `.aab` to Play Console. PWABuilder gives you an `assetlinks.json` file — put it in `public/.well-known/assetlinks.json` and deploy.

## Notes for the first deploy after F4–F6
- The first deploy of the new functions (notification triggers) can sometimes fail with a "permission propagating" error. Wait 2–3 minutes, then press deploy.bat again.
- From F4 onwards, selfies are stored separately (`selfies`) so that reports stay light. Old punches still show their selfies as before.

## Demo Data
Admin → Settings → **Demo Data** → "Isi Data Demo". It fills the company with 8 workers, 30 days of attendance, shifts, leave, OT, claims, advances, tasks, announcements with a poll, and HR files. Two workers get real logins (the IDs shown on screen, PIN `123456`). "Padam Data Demo" removes only the demo data.
