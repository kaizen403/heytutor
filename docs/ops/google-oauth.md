# Google sign-in keys (Accelute tutor)

You need two values: **Client ID** and **Client Secret**. Paste them as
`AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. Do not commit them.

Auth.js callback path is `/api/auth/callback/google`. A mismatch of one
character makes Google reject the login.

## 1. Open the console

1. Go to [https://console.cloud.google.com/](https://console.cloud.google.com/).
2. Sign in with the Google account that should own Accelute.
3. Top bar project picker → **New project**.
4. Name it `Accelute`. Create. Make sure that project is selected.

## 2. OAuth consent / branding

Google now calls this **Google Auth Platform**.

1. Open [https://console.cloud.google.com/auth/overview](https://console.cloud.google.com/auth/overview)
   (or APIs & Services → **OAuth consent screen**).
2. If it asks you to register the app, do that first.
3. User type: **External** (any Gmail). **Internal** only works on a paid
   Workspace org.
4. App name: `Accelute`
5. User support email: your Gmail (or `hi@accelute.co` if that inbox exists).
6. App logo: optional.
7. App domain (optional until you publish): `accelute.co`
8. Developer contact: `hi@accelute.co`
9. Save.

Scopes: keep the defaults (**openid**, **email**, **profile**). Do not add
Gmail, Drive, or anything else.

**Publishing status:** leave it in **Testing** for now. Under test users, add
every Gmail that should be able to log in (including yours). Until the app is
**In production**, Google blocks everyone not on that list.

## 3. Create the Web client

1. Open [https://console.cloud.google.com/auth/clients](https://console.cloud.google.com/auth/clients)
   (or APIs & Services → **Credentials** → **Create credentials** → **OAuth client ID**).
2. Application type: **Web application**.
3. Name: `Accelute tutor`.
4. **Authorized JavaScript origins** — add each of these, no path, no trailing slash:

   ```text
   https://app.accelute.co
   https://16-113-107-216.sslip.io
   http://localhost:3000
   ```

5. **Authorized redirect URIs** — add each of these, exactly:

   ```text
   https://app.accelute.co/api/auth/callback/google
   https://16-113-107-216.sslip.io/api/auth/callback/google
   http://localhost:3000/api/auth/callback/google
   ```

6. Create.

## 4. Copy the two secrets

The popup shows:

- **Client ID** — looks like `….apps.googleusercontent.com`
- **Client Secret** — shown in full once. Copy it now.

If you lose the secret: Credentials → that client → **Reset secret**.

Send both values. They become:

```bash
AUTH_GOOGLE_ID=....apps.googleusercontent.com
AUTH_GOOGLE_SECRET=...
```

Login is on unless `AUTH_DISABLED=1` (ignored in production). After Google
is on the box, do not set `AUTH_DISABLED`. The device cookie is not a user
id while the login gate is on.

## 5. After `app.accelute.co` DNS

The sslip.io origin/redirect is only until Cloudflare A-record
`app.accelute.co` → `16.113.107.216` (grey cloud). You can leave sslip.io
on the client; it does not hurt.
