# EzVisa — Preliminary Business Plan

**Version:** 0.2 (draft for discussion) · **Date:** 2026-10-01 · **Prepared for:** Namtarn
**Status:** Every figure tagged *(assumption)* must be validated with Namtarn. See [03-open-questions.md](03-open-questions.md).

---

## 1. Summary

Namtarn runs a solo visa-agent practice in Chiang Mai, Thailand: visas, extensions, work permits, bank accounts and general "settle in" help for foreigners. Revenue is about 30,000 THB/month, almost all inbound from a Facebook page plus occasional ads.

There are two constraints, one visible and one coming:

1. **Today:** not enough clients.
2. **As soon as lead generation works:** not enough hours. Every case is re-assembled by hand, "what is still missing" lives in her head and in LINE threads, and a single wrong document costs half a day at immigration plus a second trip.

The plan is to turn the practice into an **AI-native visa concierge**: software carries the paperwork load, humans do validation, relationships and the physical steps.

- **Platform (EzVisa):** intake and qualification, document vault, AI extraction and pre-checks, template-based form filling, per-client case status, deadline tracking, and a knowledge base of what worked and what failed, per immigration office.
- **People:** Namtarn as owner and senior agent (playbooks, escalations, sign-off, officer relationships) paid a commission-style draw on every case; junior validators and runners who work from pre-filled packs; the platform built and run under contract, with all intellectual property assigned to Namtarn.
- **Revenue:** per-case fees (roughly 4,000 to 30,000 THB), a recurring "Resident Care" membership for ongoing compliance (90-day reports, TM.30, extensions, re-entry permits), and B2B accounts (employers, schools, coworking spaces, real-estate and relocation partners).

Target trajectory *(assumption-driven, section 8)*: from 3 to 4 cases/month today to 15 to 25 cases/month by month 6, and 40 to 60 cases/month by month 12, while Namtarn's hands-on time per case drops from 6 to 8 hours to about 1 hour.

The full operating design (pipeline, roles, human-in-the-loop rules, architecture) is in [02-orchestration.md](02-orchestration.md).

---

## 2. The problem

**For the client**

- Requirements are opaque, differ by immigration office, and change with little notice. Example: from 31 August 2026 the DTV must be applied for in the applicant's country of nationality or permanent residence and requires a criminal record certificate, which ended the "fly to Laos and apply" pattern overnight.
- A rejected application costs a lost half-day, rework, and another visit. Nobody tells you in advance what will fail.
- Agents are a trust problem. In August 2026 immigration police raided a Bangkok visa agency over forged bank statements linked to more than 400 clients. Clients who knowingly submit false financial documents can be charged as co-conspirators and blacklisted. Many foreigners now fear agents as much as they fear immigration.

**For the agent (Namtarn today)**

- 80% of forms and supporting documents repeat between clients of the same case type, yet each pack is rebuilt from scratch.
- No system of record: status, missing items and deadlines are in her head, her phone, and chat history.
- The immigration trip is the single most expensive step, and it is wasted whenever one document is off.
- A solo agent tops out around 15 to 20 cases/month even with unlimited leads *(assumption, to confirm with her hours per case)*.

---

## 3. What we are building

One sentence: **a "case operating system" where every client has cases, every case type has a versioned playbook, the system drives each case through stages, AI prepares, and humans validate and execute.**

How the five ideas from the brief map onto it:

| Idea from the brief | What it becomes |
|---|---|
| Lead generation workflow | Deferred to a separate discussion, but intake, qualification and quoting are part of the platform and are needed regardless of channel. |
| AI paperwork filler from templates, plugged into the client base | Client profile (extracted from uploaded documents) + playbook + form templates → a submission pack, in the order the office wants it. |
| Report status list per client and folder | Checklist per case with item status, stage, blockers and next deadline. Same view for staff and, in a simplified form, for the client. |
| Namtarn's wording, past successes and failures | Knowledge base: wording library, per-office quirks, anonymised outcomes and rejection reasons, dated regulatory changelog. Retrieved by the AI when drafting and checking. |
| Extra people for validation and human steps | Defined roles (validator, runner, senior agent) with clear hand-offs, sign-off gates, and piece-rate or commission pay. |

---

## 4. Market

**Size.** Thailand hosts an estimated 4.2 to 4.5 million foreigners. About 90% are regional migrant workers from Myanmar, Cambodia and Laos, which is not our segment. The remaining 400,000 to 450,000 are retirees, professionals, students and families, concentrated in Bangkok, Chonburi/Pattaya, Chiang Mai, Phuket and Hua Hin. Add DTV holders, remote workers and a steady flow of new arrivals.

**Frequency.** Each of these people has at least one immigration interaction per year (extension or new visa), up to four 90-day reports, and often a TM.30, re-entry permits, a work-permit renewal, a bank account, a driving licence or a tax ID. This is a recurring-need market, not a one-off one.

**Willingness to pay.** Agent fees run from about 5,000 to over 50,000 THB per case: DTV assistance 9,000 to 20,000 THB on top of the 10,000 THB embassy fee, Non-B plus work permit 15,000 to 35,000 THB, retirement extensions 14,000 to 36,000 THB depending on new versus renewal.

**Illustrative addressable market** *(assumption)*: 400,000 people × 30% who use an agent × 10,000 THB/year ≈ 1.2 billion THB/year. We do not need a large share of it.

**Chiang Mai, our launch market.** Namtarn is based in Chiang Mai and works with the Chiang Mai Immigration Office, which handles the large majority of the province's extensions, 90-day reports and re-entry permits. The city is one of the biggest retiree and remote-worker hubs outside Bangkok, with a dense ecosystem of language schools (ED visas), Muay Thai gyms, coworking spaces, international schools, universities and NGOs. Compared with Bangkok that means fewer corporate Non-B cases, more retirement, DTV, ED and marriage cases, one office whose habits we can learn thoroughly, and lower staff costs. Bangkok or Phuket is the natural second market once the playbooks are proven.

**Segments, in priority order**

| Segment | Why | Note |
|---|---|---|
| A. Retirees (Non-O retirement extension) | Chiang Mai's largest long-stay group; yearly renewal, 90-day reports, high sensitivity to trust → ideal for membership | Financial requirement must be genuine. We never "rent" deposits. |
| B. Remote workers (DTV) and long-stay nomads | Chiang Mai is a top nomad base; large and growing cohort | After 31 Aug 2026 the application must be filed from the home country, so the in-Thailand value shifts to remote document preparation, the 180-day extension, TM.30 and arrival services (bank, lease, SIM, licence). |
| C. Students (ED) and teachers (Non-B via schools) | Dense language-school and international-school ecosystem; schools are natural partners and referrers | ED through school partners; teacher Non-B plus work permit with school paperwork that repeats every year. |
| D. Employed foreigners and their employers (Non-B + work permit) | Highest ticket, employer pays, recurring renewals → B2B accounts | Fewer corporates than Bangkok, but NGOs, universities, startups and hospitality groups. Company documents repeat across employees: perfect for templates. |
| E. Marriage (Non-O), LTR, Privilege | Add as playbooks mature | LTR through BOI. |

**Competition**

- **Solo agents on Facebook** (Namtarn's peers): cheap, opaque, variable quality, no status visibility. This is where the fraud cases come from.
- **Established agencies and law firms**: 15,000 to 40,000 THB per case, reputable, slow, impersonal.
- **Do it yourself** with forums: free, stressful, high failure rate at first attempt.

**Our wedge:** the transparency and first-time acceptance rate of a law firm, at freelance-agent prices, with a written no-fraud policy and a client portal that always shows what is missing.

---

## 5. Offer and pricing (indicative)

Fees below are starting points to test, not decisions. Government fees are passed through at cost and shown separately on every quote. *(Verify all government fees against current official schedules before publishing.)*

| Service | Gov. fee (THB, approx.) | Our service fee (THB) | Market agent range | Human hours: today → with platform *(assumption)* |
|---|---|---|---|---|
| Retirement extension (Non-O, in country) | 1,900 | 8,000 – 12,000 | 14,000 – 36,000 | 6h → 1.5h |
| Non-B visa + work permit, new | 2,000 visa + WP fees | 20,000 – 30,000 | 15,000 – 35,000 | 12h → 3h |
| Work permit renewal + Non-B extension | 1,900 + WP fee | 12,000 – 18,000 | 18,000 – 22,000 | 6h → 1.5h |
| DTV remote document pack (client files at home embassy) | 10,000 (embassy) | 6,000 – 9,000 | 9,000 – 20,000 | 4h → 1h |
| DTV 180-day extension, in country | 1,900 | 4,000 – 6,000 | — | 3h → 0.75h |
| Marriage extension (Non-O, Thai spouse) | 1,900 | 10,000 – 15,000 | — | 8h → 2h |
| ED visa via partner school | varies | 8,000 – 12,000 | — | 4h → 1h |
| 90-day report | 0 | 800 – 1,500 | 1,000 – 2,000 | 1h → 0.25h |
| TM.30 notification | 0 | 800 – 1,500 | — | 0.5h → 0.1h |
| Re-entry permit (single / multiple) | 1,000 / 3,800 | 1,500 – 2,500 | — | 2h → 0.5h |
| Bank account opening (prep + accompany) | 0 | 3,000 – 5,000 | — | 3h → 1.5h |
| Thai driving licence (prep + accompany) | ~200 – 500 | 3,000 – 5,000 | — | 3h → 1.5h |
| Tax ID, SIM, lease review, other setup | 0 | 1,500 – 3,000 | — | 1h → 0.25h |

**Resident Care membership** *(assumption)*: 990 THB/month or 9,900 THB/year. Includes deadline tracking, four 90-day reports, TM.30 updates, priority scheduling, and 10% off any case. This is the recurring-revenue layer and the main retention tool for segments A and B.

**Bundles for B2B:** "New hire" bundle (Non-B + WP + bank + TM.30 + 90-day tracking) at a fixed price per employee; volume tiers for schools and employers.

**Payment terms:** 50% deposit at case open, balance before submission, government fees prepaid by the client. We never hold client funds for deposits or "show money".

---

## 6. Operating model and team

Detailed pipeline in [02-orchestration.md](02-orchestration.md). The staffing summary:

| Role | Who | Does | Pay *(assumption, to negotiate)* | When |
|---|---|---|---|---|
| Owner and senior agent | Namtarn | Owns playbooks and wording; handles escalations and complex cases; officer relationships; final sign-off on risky or first-of-kind cases; weekly quality review | Owner. Draws 30% of net service-fee revenue as senior-agent pay while she is the only senior agent (her playbooks are in every case); the operating profit is hers as well. Optional small base to smooth cash flow. | Now |
| Validator | Thai, junior admin profile, good English | Checks AI pack against originals, confirms flagged fields, chases missing documents, answers client questions from templates | 17,000 – 22,000 THB/month (Chiang Mai junior office roles advertise around 18,000 – 28,000; entry level sits at the bottom) + 200 – 400 THB per accepted case | Hire #1 at ~15 cases/month (month 4) |
| Runner | Contractor first, then staff | Physical trips: immigration, labour office, bank and licence accompaniment; logs outcome and officer notes on mobile | 500 – 800 THB per trip + transport, batched 2 to 4 cases per trip | Month 4, may be the same person as validator #1 |
| Product and growth | External technical partner, contracted | Platform, lead generation, partnerships, ops tooling | Service contract; all work is work-for-hire with IP assigned to Namtarn | Now |
| Client success (bilingual) | Later | Chat coverage across time zones, onboarding calls | Part-time from month 8 | Month 8+ |
| Second senior agent | Later | Second city or B2B desk | Commission | Month 10 – 12 |

**Capacity math** *(assumption)*: today Namtarn spends 6 to 8 hours per case, so her solo ceiling is 15 to 20 cases/month. With the platform, a validator spends about 1.5 hours per case, a runner about 1.3 hours (batched), and Namtarn about 0.75 hours of review. One validator-plus-runner pair therefore handles 60 to 80 cases/month, and Namtarn can oversee 150 to 200.

**Why commission works here:** Namtarn's income scales with volume without her hours scaling with it. Junior staff do not need her expertise because the playbooks and the pre-filled pack carry it. Thai junior staff will expect a base salary, so validators are salaried with a per-case bonus rather than commission-only.

---

## 7. Go-to-market (placeholder ahead of the lead-generation discussion)

Whatever the acquisition workflow ends up being, the platform should ship with these, because they double as intake:

- **Website with a free eligibility and checklist tool**: "What do I need for X at office Y?" answered from the knowledge base, followed by email or LINE capture and an instant quote. Lead magnet and SEO asset in one.
- **Unified inbox**: LINE Official Account, Messenger and WhatsApp routed into the CRM; AI-drafted replies, human-approved.
- **Referral credit**: 500 to 1,000 THB per referred paid case.
- **Partnerships**: coworking spaces, language schools (ED), real-estate agents and condo juristic offices (TM.30 and arrivals), international schools, accountants and law firms (white-label back office), Muay Thai camps and hospitals (DTV soft-power and medical tracks).
- **B2B**: employers of foreign staff on bundles.
- **Content**: rule-change explainers (the DTV change is a live example). The knowledge base is also the content engine.

Targets *(assumption)*: customer acquisition cost under 2,000 THB per paid case, paid back on the first case.

---

## 8. Financial projection (illustrative)

**Assumptions**

| Item | Value |
|---|---|
| Blended service fee per case | 9,000 THB |
| Government fees | passed through at cost, excluded from revenue |
| Payment processing | 3% |
| AI cost per case | 50 – 150 THB (see orchestration doc, section 6) |
| Software and hosting | 8,000 THB/month |
| Acquisition cost per paid case | 1,500 – 2,500 THB |
| Namtarn commission | 30% of net service-fee revenue |

**Phases**

| Phase | Months | Cases/month | Service revenue/month | Members | Team | Notes |
|---|---|---|---|---|---|---|
| 0. Build and digitise | 1 – 2 | 4 – 6 | 40 – 55K | 0 | Namtarn + contracted platform build | Better follow-up alone lifts conversion. Playbooks for top 3 case types written. |
| 1. Launch | 3 – 6 | 10 → 25 | 90 → 225K | 20 → 50 | + validator/runner #1 at month 4 | Lead generation switched on. Membership launched. |
| 2. Scale in Chiang Mai | 7 – 12 | 30 → 60 | 270 → 540K | 100 → 200 | 2 validators, 1 runner, part-time client success | B2B bundles. Second senior agent recruited. |
| 3. Expand | Year 2 | — | — | — | — | Bangkok or Phuket as second city; licence the platform to other agents. |

**Monthly P&L at 40 cases/month (around month 9)**

| Line | THB/month |
|---|---|
| Service revenue (40 × 9,000) | 360,000 |
| Membership (120 × 990) | 118,800 |
| **Total revenue** | **478,800** |
| Namtarn commission (30% of service revenue) | 108,000 |
| Staff (2 validators, part-time runner, bonuses) | 65,000 |
| Acquisition (40 × ~1,500) | 60,000 |
| AI, software, hosting | 15,000 |
| Payment processing (3%) | 14,400 |
| Accounting, legal | 8,000 |
| Coworking / office | 10,000 |
| Misc. (printing, transport, phones) | 10,000 |
| **Total costs** | **290,400** |
| **Operating profit** | **≈ 188,000 (39%)** |

**Break-even** *(assumption)*: contribution per case ≈ 9,000 × (1 − 0.30 − 0.03) − 150 − 2,000 ≈ 3,900 THB. Fixed costs of about 105,000 THB/month mean roughly 27 cases/month to break even with no members, or about 12 cases/month with 60 members.

**Start-up cash**: company registration and legal 30,000 to 60,000 THB, accounting setup, domain and site, initial ad budget 30,000 THB, scanner and phones 10,000 THB. Roughly 100,000 to 150,000 THB before labour. The platform build is the main investment and sits outside this cash figure.

---

## 9. Legal, compliance and risk

| Topic | Position |
|---|---|
| **Company structure** | A single Thai entity owned by Namtarn: a registered sole proprietorship to start, or a Thai Co., Ltd. once volume and hiring justify it. A Thai limited company needs at least two shareholders, so a second Thai shareholder with a nominal stake (a family member) is required and Namtarn holds the rest. No foreign shareholder, director or employee, so the Foreign Business Act does not apply and no foreign work permit is involved. **All intellectual property, including the platform, playbooks, wording library, knowledge base and brand, belongs to Namtarn.** Any outside development is work-for-hire with a written IP assignment to her. Confirm the entity choice and the assignment wording with a Thai lawyer and accountant before launch. |
| **Scope of activity** | No specific licence exists for visa agents, but we stay within document preparation, coordination and accompaniment. No legal representation, no job placement (that needs an employment-agency licence), no holding of client funds for deposits. The applicant appears in person wherever the office requires it. |
| **PDPA** | Passports, financial statements and now criminal-record certificates (sensitive data under the Personal Data Protection Act, requiring explicit consent) flow through the platform. Needed: privacy notice, consent captured at intake, data processing agreements with any contractor who touches client data, encryption at rest and in transit, retention policy (for example delete originals 12 months after case close unless the client is a member), breach process, and a way to honour access and deletion requests. Host in Singapore or Thailand. |
| **Anti-fraud policy** | Written and public. We verify bank letters where possible, refuse edited documents, and log every approval. Given the August 2026 raids this is both a legal necessity and a marketing asset. |
| **AI accountability** | AI never submits anything. A named human approves every pack. The client confirms the accuracy of their data before submission. Every approval is in the audit log. |
| **Rule volatility** | Playbooks are versioned with effective dates. A weekly regulatory watch (Immigration Bureau, MFA e-Visa, Department of Employment, BOI) feeds a changelog and flags affected playbooks. |
| **Channel dependency** | The Facebook page is the only funnel today. Own the domain, the LINE Official Account and the email list. |
| **Key-person risk** | Namtarn's knowledge is the business. The playbooks and knowledge base are the mitigation; a second senior agent by month 10 to 12 is the insurance. |
| **Cash risk** | 50% deposit at case open, government fees prepaid by the client, balance before submission. |

---

## 10. KPIs

| Metric | Target |
|---|---|
| Quote → paid conversion (warm inbound) | ≥ 30% |
| Paid → submission-ready pack (client responsive) | ≤ 5 business days |
| First-time acceptance rate | ≥ 90% |
| Immigration trips per case | ≤ 1.2 |
| Namtarn hands-on hours per case | ≤ 1 |
| Client "I always knew what was missing" (NPS) | ≥ 60 |
| Members, monthly churn | growing, < 3% |
| Acquisition cost per paid case | < 2,000 THB |

---

## 11. Roadmap: first 90 days

| Weeks | Milestone |
|---|---|
| 1 – 2 | Discovery with Namtarn: case mix over the last 12 months, Chiang Mai Immigration Office habits, hours per case, rejection stories. Write the playbooks for her top 3 case types and collect every template and wording she uses. Legal consultation on entity structure. Open the LINE Official Account. |
| 3 – 6 | **MVP**: case board, client profile, checklist engine for 3 playbooks, document upload with AI extraction, pre-fill for 3 to 5 forms, pack export, client status page, reminders, audit log. Namtarn runs live cases on it. Measure hours per case and first-time acceptance. |
| 7 – 10 | Harden: validator and runner roles and views, structured outcome capture after every submission, knowledge base entries flowing from cases, payments (PromptPay, card), membership. |
| 11 – 13 | Lead-generation workflow (separate discussion), hire validator #1, launch the site and the free checklist tool. |

---

## 12. Decisions needed from Fabien and Namtarn

1. Launch market: Chiang Mai, confirmed. Still open: whether we accept remote clients from neighbouring provinces from day one.
2. The top 3 case types for the MVP playbooks.
3. Namtarn's pay: the 30% senior-agent draw, or a base plus a smaller draw.
4. Entity to start with: registered sole proprietorship or Thai Co., Ltd. (section 9). Ownership and IP are settled: everything is Namtarn's.
5. Pricing to test for the top 3 case types and for the membership.

The full list of questions to validate the assumptions is in [03-open-questions.md](03-open-questions.md).

---

## Sources

- [Thailand Visa Agent Fees in 2026 (Issa Compass)](https://www.issacompass.com/insights/thailand-visa-agent-fees-in-2026-what-youre-actually-paying-for-and-when-its-wor)
- [Complete Thailand Visa Costs 2026 (Thai Visa Services)](https://www.thai-visa-services.com/guides/thailand-visa-costs-2026)
- [DTV Visa Thailand Cost 2026 (Vera Visa)](https://vera-visa.com/dtv-visa-thailand-cost/)
- [Typical cost of hiring a visa agent in Thailand (Ask Thailand)](https://ask.in.th/question/what-is-the-typical-cost-for-hiring-an-agent-to-assist-with-obtaining-a-visa-in-thailand)
- [Thailand DTV Visa Changes From 31 August 2026 (Asia Lifestyle Magazine)](https://www.asialifestylemagazine.com/thailand-dtv-visa-changes-31-august-2026/)
- [DTV Visa New Rules 2026: Home Embassy + Police Check (DTVThaiVisa)](https://dtvthaivisa.com/blog/dtv-visa-new-rules-31-august-2026)
- [Thai immigration police raid visa agency over fake bank statements (Khaosod English, Aug 2026)](https://www.khaosodenglish.com/news/2026/08/17/thai-immigration-police-raid-visa-agency-over-fake-bank-statements/)
- [Immigration raids visa agency, 400+ clients (The Pattaya News, Aug 2026)](https://thepattayanews.com/2026/08/17/royal-thai-immigration-raids-visa-agency-in-bangkok-seizes-alleged-fake-stamps-and-alleged-fake-bank-documents-linked-to-over-400-clients-worth-16-million-baht/)
- [The "Rent-the-Money" Retirement Visa Scam (Siam Legal)](https://library.siam-legal.com/the-rent-the-money-retirement-visa-scam-in-thailand/)
- [Thailand Expat Population 2026 (Asia Lifestyle Magazine)](https://www.asialifestylemagazine.com/thailand-expat-population-2026-foreigners-living/)
- [Bangkok Minimum Wage Rises to 400 Baht (PKF Thailand)](https://pkfthailand.asia/bangkok-raises-minimum-wage-to-400-baht-what-employers-and-workers-should-know/)
- [Administrative Officer salary, Bangkok (Glassdoor)](https://www.glassdoor.com/Salaries/bangkok-thailand-administrative-officer-salary-SRCH_IL.0,16_IM1119_KO17,39.htm)
- [Officer salary in Chiang Mai (JobsDB)](https://th.jobsdb.com/career-advice/role/officer/salary/in-chiang-mai)
- [Can a Foreigner Own a Company in Thailand? 2026 Guide (Statrys)](https://statrys.com/blog/can-foreigner-own-company-in-thailand)
- [Thailand Foreign Business Act explained (Thai-Co)](https://www.thai-co.com/blog/thailands-foreign-business-act-explained-how-thai-majority-ownership-benefits-foreign-investors-and-entrepreneurs)
- [Thailand PDPA consent and notification guidelines (Tilleke & Gibbins)](https://www.tilleke.com/insights/thailand-issues-guidelines-on-pdpa-consent-and-notification-requirements/17/)
- [How to Comply with PDPA Thailand 2026 (Security Scientist)](https://www.securityscientist.net/blog/how-to-comply-with-pdpa-thailand-complete-guide-2026/)
