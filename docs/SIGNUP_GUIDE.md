# Signing up — a step-by-step guide

How a company gets from "never heard of us" to a working, staffed workspace in an
EvoPlatform-connected app. Written for end users; nothing here needs a platform
administrator. (Whether public signup is open, invite-link only, or closed is the
platform operator's `SIGNUP_MODE` setting — the flows below describe what happens
when signup is available to you.)

## 1. Create your workspace

1. Open the app's **signup page** (for example, "Create your company workspace" on
   the login screen).
2. Enter your **company name**, your **email**, and a **password**
   (at least 8 characters, including 2 numbers and 2 special characters).
3. If you were given an **invite link** by the platform operator, use that link —
   it carries the token that authorizes your signup.
4. Submit. You'll see: *"Workspace created — check your inbox."*

What just happened behind the scenes: your workspace (named after your company)
now exists, you are its **first member and workspace admin**, and a
**14-day trial** of the app you signed up through has started. No card required.

## 2. Verify your email

1. Check your inbox for **"Verify your email address"** (look in spam if it's not
   there — and the signup page has a **re-send** button if you need a fresh one).
2. Click the link. You'll land on a page confirming **"Email verified."**
3. The link is valid for 24 hours; re-sending issues a new one.

> You cannot sign in until this step is done — an unverified account holds
> nothing usable. If you try to sign in early, the app tells you
> **"Email not verified"** and offers to re-send the email.

## 3. Sign in

1. Back on the app's **login page**, enter your workspace name (if asked), email,
   and password.
2. You're in — and because you created the workspace, you have the
   **workspace admin** role automatically.
3. Optional but recommended: add a **passkey** (Windows Hello, Touch ID, or a
   security key) from your account page, and sign in without a password next time.

## 4. Invite your team

1. Open **Members** (in the app header).
2. Confirm your password — member management sits behind a short security
   window, like GitHub's sudo mode. It stays unlocked for 15 minutes.
3. Click **+ Invite member**, enter their email, and choose whether they should
   also be a workspace admin. Send.
4. They get an email: *"&lt;you&gt; invited you to join &lt;workspace&gt;."* The link is
   valid for **24 hours** and works **once**.
5. They click it, choose their own name and password, and they're in —
   already verified (clicking the emailed link proved their mailbox). No
   temporary passwords ever change hands.
6. From the same page you can **re-send** an invite (the old link stops working)
   or **revoke** it, and set each member's **per-app roles** from the dropdowns.

Guard rails you'll notice: you can't demote or deactivate **yourself** (no
locking yourself out), invites to someone who's already a member are refused,
and deactivated members can be restored later.

## 5. Trial, subscription, and billing

- Your signup started a **14-day trial** of the app you arrived through. Other
  apps on the same platform are separate — each has its own access and its own
  subscription.
- To subscribe (or when the trial ends), open **Members → Billing** and click
  **Subscribe / upgrade**. Payment is handled by **Stripe** on Stripe's own
  pages — the app never sees your card.
- **Manage billing** opens Stripe's portal: change the card, download invoices,
  or cancel.
- If a payment fails, access continues through a **7-day grace period** while
  you fix the card; paying the open invoice restores everything automatically.
- One app's billing never affects another: if your subscription to one app
  lapses, your team keeps working in the others.

## 6. If you forget your password

1. Use **Forgot password** on the login page and enter your email.
2. Click the link in the email (valid 30 minutes, single use) and choose a new
   password on the page it opens.
3. Every signed-in session is signed out when the password changes — sign back
   in with the new one.

## Quick reference

| I want to… | Where |
|---|---|
| Create a company workspace | The app's signup page (or your invite link) |
| Re-send my verification email | Signup confirmation or the login error message |
| Add or remove teammates | **Members** in the app header (workspace admins) |
| Change someone's app role | Members → the role dropdowns |
| Subscribe / manage payment | Members → Billing |
| Reset a password | **Forgot password** on the login page |
| Add a passkey | Your account page → Passkeys |
