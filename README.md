# Saatvikei Attendance

A free attendance system for a small store:

- The manager's phone is the punch station.
- Each punch takes a photo and checks GPS at the store, and only works during store hours. Matching the photo against an enrolled face is optional and **off** by default (owner app → Setup → Face check).
- Every punch and every rejected attempt is sent to the owner on Telegram with its photo.
- Records live in a Google Sheet in the owner's account.

| Part | What it is | Where |
|---|---|---|
| `web/index.html` | **Punch app** for the manager's phone (Android/iPhone) | GitHub Pages |
| `web/admin.html` | **Owner app** for owners and the developer (iPhone, Android, laptop) | GitHub Pages |
| `backend/` | Google Apps Script API, Sheet, Drive and Telegram | The owner's Google account |
| `PLAN.md` | The full plan and owner questionnaire (kept private, not in this repo) | — |

## Try it with demo data (no setup)

```bash
node tools/serve.js
```

Then open http://localhost:8765 (punch app) and http://localhost:8765/admin.html (owner app).

- `web/js/config.js` ships with `API_URL: 'mock'`, so everything runs on fake data stored in the browser.
- Any 6 digits pair the phone.
- Where there is no camera, the face check is simulated.

## Tests

```bash
node --test tests/
```

---

## Going live (test setup in your own Google account)

There are 6 one-time steps, about 30–40 minutes in total.

### 1. Create the Telegram bot (5 min, on your phone)
1. In Telegram, search **@BotFather**, send `/newbot`, and pick a name such as *Saatvikei Attendance*.
2. Pick a username ending in `bot`.
3. Copy the **token** it gives you. You'll paste it into the owner app in step 6. Don't share it anywhere else.

### 2. Push the backend to Google Apps Script
1. Turn on the Apps Script API: https://script.google.com/home/usersettings → **On**.
2. In this folder, run each command:

```bash
cd backend
```

```bash
npx @google/clasp@3.4.1 login
```

```bash
npx @google/clasp@3.4.1 create-script --type standalone --title "Saatvikei Attendance" --rootDir .
```

```bash
npx @google/clasp@3.4.1 push --force
```

3. Open the project (`npx @google/clasp@3.4.1 open-script`), choose the **setup** function, and press **Run**.
4. Approve the permissions. Google warns that the app is "unverified" because it's your own script: click **Advanced → Go to Saatvikei Attendance**.
5. The log prints links to the new **Sheet** and **Drive folder**.

### 3. Deploy the backend as a web app
In the Apps Script editor:

1. Go to **Deploy → New deployment → Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**.
3. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

When you change the backend later: `clasp push`, then **Deploy → Manage deployments → edit → New version**. This keeps the same URL.

### 4. Create the Google sign-in client (for the owner app)
1. Go to https://console.cloud.google.com and create a project, for example *saatvikei-attendance*.
2. Go to **APIs & Services → OAuth consent screen**.
   - Choose **External**.
   - App name: *Saatvikei Owner*.
   - Add your email.
   - Scopes: none extra.
   - Add yourself and the owner as **test users**.
3. Go to **Credentials → Create credentials → OAuth client ID → Web application**.
   - Under **Authorized JavaScript origins**, add `https://<your-github-username>.github.io` and `http://localhost:8765`.
4. Copy the **Client ID**. In the Apps Script editor, go to **Project Settings → Script properties** and add `GOOGLE_CLIENT_ID` = that ID.

### 5. Put the web apps on GitHub Pages
1. Edit `web/js/config.js`: set `API_URL` to the `/exec` URL from step 3, and `GOOGLE_CLIENT_ID` to the ID from step 4.
2. Push this folder to a GitHub repo.
3. In the repo, go to **Settings → Pages → Source: GitHub Actions**. The included workflow publishes `web/`.
4. Your links will be:
   - Punch app: `https://<user>.github.io/<repo>/`
   - Owner app: `https://<user>.github.io/<repo>/admin.html`

The code holds no secrets, so the repo can be public, which free GitHub Pages needs. The API is protected by phone pairing tokens and Google sign-in.

### 6. First run in the owner app (`…/admin.html`)
Sign in with Google. The account that ran `setup()` is already an admin. Then:

1. **Setup → Telegram alerts**: paste the bot token, then **Connect my Telegram** and press Start in the bot.
2. **Setup → Store, hours & rules**: stand inside the store and press **Use my location**. Set the opening and closing times and the weekly off (Tuesday), then **Save**.
3. **Setup → Admins**: add the owner's Gmail.
4. **Staff → ＋ Add**: add each person. **Enrol face** is only needed if you turn Face check on later.
5. **Setup → Punch phones**: name the phone (for example *Rahul's phone*) and **Get code**. On the manager's phone:
   - Open the punch app link.
   - **Add to Home Screen**: on iPhone use Safari → Share → Add to Home Screen; on Android use Chrome → ⋮ → Install app.
   - Open it from the home screen and type the code.
   - Allow **camera** and **location** when asked.

---

## How the protections work

| Risk | Protection (enforced on the server, so the phone can't skip it) |
|---|---|
| Punching for someone else | A photo is taken at every punch and sent to the owner instantly. Optional: face match against an enrolled face. |
| Manager covering for someone | After 3 failed face checks a punch can only be **sent for approval**. It doesn't count until the owner approves it. |
| Punching from home | Only phones the owner has paired can punch, and each punch must be within the set distance of the store by GPS |
| Punching after hours | The server rejects any punch outside the opening hours or on the weekly off |
| Changing the phone clock | Google's server clock is used |
| Double or out-of-order punches | Order must be IN → (break out → break in)… → OUT, once a day; 2-minute minimum gap |
| Editing records | Raw log tabs are protected and **hash-chained**: any edit or deletion is detected by **Setup → Check records**. Owner fixes go to a separate *Corrections* tab with the reason and who made them, and are sent on Telegram. |

**Sheet tabs:**
- `RawLog`: every accepted punch.
- `Attempts`: every rejected punch.
- `Corrections`: owner fixes.
- `AdminLog`: who changed what.
- `Daily`: a readable day summary.
- `Employees`, `Devices`, `Settings`.
- `Faces`: hidden.

## Handing over to the owner's Google account

Repeat steps 2–4 while logged in as the owner, or copy the Apps Script project into their account. Then:

1. Add your email under **Setup → Admins** so you keep developer access.
2. Point `config.js` at the new `/exec` URL.

Data from testing stays in your account. Start the owner's Sheet fresh.
