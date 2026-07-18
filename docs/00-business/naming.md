# Naming & Trademark Assessment

**Candidate:** OX OS · **Assessed:** July 2026 · **Status:** ⚠️ Recommend against — see §6

---

## 0. Two corrections before the findings

**1. Names are not copyright. Names are trademarks.** Copyright protects creative expression — your source code, your documentation, your logo *artwork*. It does not protect a name, and it never has. What you are asking about is trademark law, and the two work completely differently. The distinction matters here: copyright is automatic and free; a trademark must be registered, per country, per class, and costs money.

**2. There is no such thing as worldwide trademark clearance.** Trademarks are **territorial**. A mark registered in the US grants nothing in South Africa, and vice versa. There is no global register and no global search. What exists is:

- **CIPC** (South Africa) — the only body that can grant you trademark rights in the Republic
- **USPTO** (US), **EUIPO** (EU), etc. — each independent
- **WIPO Madrid Protocol** — a filing mechanism that lets one application designate multiple countries; still resolves to national rights, still examined nationally

So "check availability worldwide" resolves to: *check the places you will actually trade, plus the places whose owners could hurt you.* That is what follows.

**What this document is:** a preliminary scan of public records. **What it is not:** a clearance opinion. A real clearance search catches phonetic similarities, device marks, and pending applications that a public search misses, and it is done by a trademark attorney. Do not file on the strength of this document.

---

## 1. What the scan found

Two live conflicts, both in software classes, both independent of each other.

### Conflict A · Open-Xchange GmbH owns "OX" — and it covers operating systems

| | |
|---|---|
| Owner | Open-Xchange GmbH (Cologne, Germany) |
| Mark | **OX** |
| US serial | 79023048 |
| Goods | *"Computer software for controlling and managing access server applications; communications servers;* **computer operating system***…"* |
| Their own EULA says | *"OX is the sole owner of the OX trademark in the United States, the European Union and certain other countries."* |
| Scale | ~270 employees, software used by 200M+ people, products branded OX App Suite, OX Cloud, OX Guard, OX Documents, OX Dovecot, OX PowerDNS |

**This is the sharper of the two.** Their registration literally enumerates *computer operating system* in its goods description. Your proposed name is "OX" followed by "OS". You would be adopting their registered mark and appending the exact category their registration already covers. That is not a near miss.

### Conflict B · OXOS is registered, by a funded company, for a software platform

| | |
|---|---|
| Owner | Micro C, LLC — trading as **OXOS Medical** (Atlanta, US) |
| Mark | **OXOS** |
| US serial | 88698149 (4 marks registered in total) |
| Domain | **oxos.com — theirs** |
| Product | Micro C handheld X-ray + *"the cloud-based* **OXOS® Platform**" — image management, telehealth, AI diagnostics |
| Scale | $45M raised across 8 rounds (Intel Capital, Parkway VC), ~70–115 staff, **57 patents filed** |

They use ® in running text. They have a patent portfolio. Companies that file 57 patents have IP counsel, and IP counsel exists to send letters.

**On the space:** "OX OS" and "OXOS" are phonetically identical. Trademark similarity is assessed on the impression left on the ordinary consumer — visual, phonetic, and conceptual. A space does not create distance. This is the single most common misconception in naming and it has never once worked.

---

## 2. The territorial defence — real, but not a plan

Neither mark may be on the CIPC register. You could quite possibly register OX OS in South Africa in classes 9 and 42 and trade lawfully here for years.

That defence collapses on contact with your own requirements:

| Your requirement | What it does to the territorial defence |
|---|---|
| **"Open for different countries in the future"** (this update, §4) | The moment you add a second country, you are in someone's territory. Namibia is CIPC-adjacent, but the EU is Open-Xchange's home register. |
| Your stated goal of emigrating and working abroad | A portfolio project named after two live foreign marks is a conversation you do not want in an interview. |
| `.com` is gone | oxos.com belongs to OXOS Medical. You would launch on `.co.za` and never own the `.com`. |
| GitHub, npm, app identity | All resolve to the same collision. |

A name that works only inside one country, only until someone with 57 patents notices, is not a saving. It is a deferred cost with interest.

---

## 3. The problems that have nothing to do with lawyers

These are worse than the trademark issues, and they would matter even if both registers were empty.

### "OS" is a claim the product cannot support

It is not an operating system. It is a farm management application. Naming it an OS invites exactly one question — *"an operating system for what?"* — and the honest answer ("it's a web app for records") makes the name sound like a startup that overclaims. That is the opposite of the impression this product needs in a market where trust is the entire sale.

### 🚨 "OX" excludes the majority of your market

**This is the strongest argument in this document and it is not a legal one.**

An ox is a castrated draught bovine. Your product's central promise — [BR-1](BRD.md), [FR-002](../01-requirements/functional-requirements.md), [SRS-1–4](../01-requirements/SRS.md), and the entire reason the white space exists — is that **one farmer with cattle, maize, and a vineyard uses one app.** That is the differentiator. It is the thing no competitor has.

A vineyard owner who sees "OX OS" on a stand at Nampo concludes it is cattle software and walks past. A table-grape exporter in the Hex River Valley — precisely the GlobalGAP/SIZA customer your compliance moat is built for — never clicks.

**The name contradicts the product.** You would spend your entire marketing budget explaining that the cattle-named product is not cattle software.

### "OX" is weakly distinctive in this market

Trademark strength runs from generic (unprotectable) through descriptive (weak) to arbitrary and fanciful (strong). An animal name, in a market that manages that animal, sits near the descriptive end. That means: harder to register, harder to defend, easier for the next person to work around. You would be buying a weak asset at the price of a strong one.

### SEO is unwinnable

Query "OX OS" and you will fight Open-Xchange's 200M-user product and every operating-system result on the internet. Forever.

---

## 4. Where "Werf" sits

The current codename, assessed against the same criteria — not to defend my own choice, but because it is the incumbent and deserves the same scrutiny.

| Criterion | OX OS | Werf |
|---|---|---|
| Enterprise-neutral | ❌ **livestock-only read** | ✅ a *werf* is the working heart of any farm — cattle, maize, or vines |
| Distinctive in class 9/42 | ⚠️ weak (animal in animal market) | ✅ arbitrary in software |
| Known conflicts | ❌ **two, both in software** | ✅ none found in software classes |
| Claims something true | ❌ not an OS | ✅ the yard is where the work is |
| SA-rooted | ⚠️ generic | ✅ unmistakably |
| Short, hard consonants | ✅ | ✅ |
| `.com` | ❌ gone | ⚠️ check |
| Travels internationally | ⚠️ | ⚠️ Afrikaans; pronounceable but needs explaining abroad |

Werf's genuine weakness is the last row: it needs a sentence of explanation outside South Africa. That is a real cost against your multi-country ambition, and it is smaller than any single row in the OX OS column.

### If you want alternatives

Keeping what you liked about OX OS — short, hard, a bit irreverent, sounds like infrastructure:

| Name | For | Against |
|---|---|---|
| **Werf** | Incumbent, zero cost, enterprise-neutral, distinctive | Needs explaining abroad |
| **Erf** | SA land-parcel term. Shorter, harder, very close to OX OS's energy. Enterprise-neutral. | Three letters is hard to register; generic in SA property |
| **Baken** | Afrikaans/Dutch *beacon*. Distinctive, travels better | Less concrete |
| **Koppie** | The hill you check the herd from. Warm, SA, neutral | Softer than you want |

**Avoid:** Kraal (taken — Kraal.farm, KraalID, and livestock-only), Spoor (that's a major SA IP law firm), Veld/Landbou/Plaas (descriptive → weak marks).

---

## 5. If you use OX OS anyway

Your product, your call. What it would require, honestly:

```
□ Pay for a CIPC similarity search — not the free portal search, which
  misses phonetic conflicts, which is exactly your problem
□ Get a written attorney opinion on Open-Xchange and OXOS Medical,
  specifically on classes 9 and 42
□ Accept that oxos.com is permanently unavailable
□ Accept the livestock-only read, and budget marketing to fight it
□ Accept that international expansion re-opens the whole question
□ Decide now whether you would rebrand under a letter, or fight
```

The cost of being wrong is not a lawsuit. It is a rebrand at year three, after the name is in every payslip PDF, every farmer's home screen, and every reference customer's mouth.

---

## 6. Recommendation

**Do not use OX OS.**

Not primarily because of Open-Xchange or OXOS Medical — though either alone is enough reason to think twice. **Because the name says "cattle" and the product's entire competitive advantage is that it is not cattle software.**

You found a white space that exists precisely because nobody serves the mixed farmer. Then you would name the product after an ox.

**Keep Werf** until something clearly better appears, and **file it properly** before launch (§7). It is enterprise-neutral, distinctive in software, unmistakably South African, and it costs nothing to keep because it is already threaded through this pack.

---

## 7. The actual clearance process, when you decide 🇿🇦

**South Africa — CIPC**

| | |
|---|---|
| Body | Companies and Intellectual Property Commission — the only body that can grant SA trademark rights |
| Form | **TM1** |
| Fee | **R590 per class** |
| System | **Single-class** — each class is a *separate* application |
| Classes you need | **9** (downloadable software) and **42** (SaaS). Consider **35** (business management services). |
| Classification | Nice, **13th Edition**, adopted by CIPC on **1 January 2026** |
| Term | 10 years, renewable |
| Process | Free basic search → professional similarity search → TM1 → CIPC examination → published in the Patent Journal for **3 months** for opposition → registration |
| Note | Company name registration ≠ trademark. Registering "Werf (Pty) Ltd" at CIPC gives you **no trademark rights.** |

Budget ~R1,200–1,800 in CIPC fees for two classes, plus attorney fees for the search and filing. Do the search before you write the name into a payslip template.

**Later, if you expand:** WIPO's Madrid Protocol lets one application designate multiple countries from your SA base. That is the cheap path to Namibia, Botswana, and beyond — and it is another reason not to build on a name with EU and US conflicts already sitting on the register.

---

## 8. Renaming, mechanically

The codename is deliberately isolated so this stays a ten-second job. Nothing in the pack depends on the name.

```bash
# Whole pack, one command
grep -rl 'werf\|Werf' . --exclude-dir=.git | xargs sed -i 's/Werf/NewName/g; s/werf/newname/g'
```

Do this **once**, when the decision is final and the CIPC search is clean. Not before — a name burned into 36 documents and a payslip template is a decision you have made whether you meant to or not.
