# ContractScan — Launch & Distribution Pack

Ready-to-paste copy for selling ContractScan. Positioning: **don't sell "contract review" to
everyone — sell one sentence to one niche.** "Upload a client contract, get the 3 things
that'll screw you, $20."

> Keep the **not-legal-advice** framing in all copy. You're informational, not practicing law.

---

## One-liner (use everywhere)

> Upload a client contract, get the 3 things that'll screw you — $20.

Variants:
- Freelance: "Upload a client contract, get the 3 clauses that'll bite you — $20."
- SaaS/SMB: "Before you sign that vendor agreement, get the gotchas in 60 seconds — $20."

---

## Reddit — r/freelance

**Title:** Built a tool that flags the 3 things in a client contract that'll screw you — $20, no signup

Freelancers keep signing contracts they haven't really read. Upload the PDF (or paste it),
pick "freelancer/agency," and you get a risk score + the specific clauses that hurt you —
unlimited liability, IP grabs beyond the work, net-90, kill-the-final-payment terms,
non-competes — each with a plain-English fix to ask for.

First scan is free. Not legal advice, just the red flags. [link]

---

## Reddit — r/smallbusiness

**Title:** Before you sign that SaaS/vendor agreement — get the gotchas in 60 seconds ($20)

Auto-renewal traps, silent price hikes, $50 liability caps, "we own your data" clauses.
Paste the agreement, pick "SaaS/vendor," and get the risky clauses with what to push back on.

First one's free. Informational, not legal advice. [link]

---

## Indie / founder communities (Indie Hackers, X/Twitter)

Shipped ContractScan: paste a contract → get a risk score + the clauses that'll screw you,
with plain-English fixes. Built as one HTML file calling Claude + a tiny Worker backend.
$20/scan, first one free. The niche is the whole pitch — "the 3 things in this contract that
will bite you." [link]

---

## Cold DM — agency owners

Hey [name] — I built a quick tool for agencies: upload a client contract, get the 3 clauses
most likely to bite you (liability, IP, payment, non-compete) with fixes to ask for, in under
a minute. First scan's free if you want to try it on your current MSA: [link]

---

## Cold email — SMB / ops

**Subject:** the 3 clauses in your next vendor contract that'll cost you

Hi [name],

Most SaaS and vendor agreements bury a few clauses that quietly cost you — auto-renewals you
can't get out of, uncapped price increases, liability caps as low as $50, data you don't own.

ContractScan reads the agreement and gives you those red flags in plain English, with what to
ask the vendor to change. First scan free, $20 after. It's informational (not legal advice),
but it tells you what to look at before you sign.

Try it: [link]

— [you]

---

## Pricing / product setup (LemonSqueezy)

Create 3 products and note each **variant ID**:

| Product | Price | Credits |
|---|---|---|
| Single | $20 | 1 |
| Pack | $79 | 5 |
| Unlimited (sub) | $49/mo | large block (e.g. 100/mo) |

Then:
- Worker var `VARIANT_CREDITS = {"<single_id>":1,"<pack_id>":5,"<sub_id>":100}`
- Webhook → `https://<your-worker>/v1/webhook/lemonsqueezy`, event `order_created`
- Paste the signing secret as the `LEMONSQUEEZY_SIGNING_SECRET` Worker secret
- Buyers receive a single-use unlock code (auto-emailed if `RESEND_API_KEY` is set)

---

## Launch sequence (suggested)

1. Soft launch: post to r/freelance with the free-first-scan hook; reply to every comment.
2. Same week: r/smallbusiness variant; cross-post to a relevant niche subreddit.
3. DM 20 agency owners with the MSA hook.
4. Watch `backend/stats.html` (the admin funnel) to see which niche/plan converts; double down
   on the winner in the landing headline and ad copy.

## Reality checks before posting

- Run the calibration gate on 5–10 real contracts first (`npm run calibrate`).
- Keep the "not legal advice" disclaimer visible.
- Lock `ALLOWED_ORIGIN` to your domain; swap the placeholder domain in the landing tags.
