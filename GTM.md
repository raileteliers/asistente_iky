# Asistente IKY — Go-to-Market Strategy

> Product: Chrome extension + backend that helps **older adults use Google Search safely** on desktop.
> Highlights the search bar, guides searches, explains results, and performs simple actions —
> **always with confirmation, and never touching Gmail, banks, passwords, or payments.**
> Spanish-language, Chile-first (`google.cl`). Stage: MVP.

---

## ⚠️ Prerequisite: productization (blocks all GTM)

The MVP today requires loading an **unpacked** extension in developer mode and running a **local
Node backend** with a Groq API key. The target customer cannot do this. Before any sales motion:

1. **Publish the extension to the Chrome Web Store** → one-click install.
2. **Host the backend** (not localhost) → works without a terminal.
3. Keep the local heuristic fallback so it degrades gracefully.

---

## 1. Core insight: the buyer ≠ the user

Older adults rarely discover or pay for software themselves. Two buyers, neither is the user:

- **The adult child (40–60)** — the "digital caregiver." Has the money, the motivation
  (fear of scams), and device access to install it.
- **Institutions** — municipalidades, clubes de adulto mayor, telcos, bank senior programs,
  SENAMA, libraries, ISAPREs.

**The user is the senior. The customer is one of the above. Message to the buyer.**

## 2. Target segments

| Priority | Segment | Why |
|---|---|---|
| **Primary** | Adult children of seniors (Chile, 40–60) | Money + motivation + device access |
| **Secondary** | 1–2 institutional pilots (municipalidad / club de adulto mayor) | Concentrated users, built-in trust, faster revenue |
| Later | Telco / bank senior-program bundle | Scale distribution once proven |

## 3. Positioning & messaging

The safety rules *are* the marketing. Lead with **peace of mind**, not features.

- **One-liner (to the child):** *"Tu papá o mamá navega tranquilo, y tú también. IKY los acompaña
  en Google — sin tocar nunca claves, bancos ni pagos."*
- **Value prop:** Independencia para ellos, tranquilidad para ti.
- **Proof points:**
  1. Nunca pide ni toca contraseñas, bancos ni pagos.
  2. Siempre pide confirmación antes de cualquier acción.
  3. Explica los resultados en lenguaje simple.

## 4. Channels (ranked by fit)

1. **Meta ads (Facebook/Instagram), target adults 45–60** — messaging about keeping aging parents
   safe online. This audience is on Facebook and emotionally primed.
2. **Institutional partnerships** — pitch one municipality / club de adulto mayor for a free pilot
   → testimonials + case study.
3. **PR / earned media** — Chilean outlets favor "tecnología con propósito social." Founder story
   is highly pitchable.
4. **Content/SEO** — guides like *"Cómo proteger a tus padres de estafas en internet"* funneling to IKY.

## 5. Monetization

- **Freemium + family subscription.** Free basic tier removes install friction; paid tier
  (AI explanations, multiple seniors, family dashboard) at ~**CLP 3.000–5.000/month** (US$3–6).
  The *child* pays; peace of mind justifies the price.
- **Institutional licensing** in parallel (per-seat or flat) — likely bigger revenue, lower CAC.
- The **senior never hits a paywall mid-task** — that breaks trust.

## 6. Success metrics

- **Activation:** % of installs where the senior completes ≥1 guided search (not just the child installing).
- **Real usage:** weekly active *seniors*.
- **Retention:** month-2 retention — truest signal for this demographic.
- **CAC vs. willingness-to-pay** per channel.

## 7. Phased launch

- **Phase 0 (now):** Chrome Web Store + hosted backend. Recruit 5–10 families for free beta.
- **Phase 1:** Land 1 institutional pilot → testimonials + case study.
- **Phase 2:** Turn on Meta ads + PR. Introduce paid tier.
- **Phase 3:** Pursue telco/bank bundle for scale.

---

## Open decisions

- [ ] B2C vs. B2B vs. both as the first path
- [ ] Final pricing / tiers
- [ ] Which institution to approach for the first pilot

_Generated as a starting point — edit freely._
