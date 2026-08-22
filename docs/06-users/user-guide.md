# Werf — User Guide

*This document is also the source for in-app help. Written in the product's voice ([ux-design-system.md §5](../02-design/ux-design-system.md)): plain, direct, no apology, no cheer. Ships in English and Afrikaans.*

> **⚠️ For the team, not for farmers — delete this block when the product ships.**
> **As at 2026-08-04, "Getting started", "Working without signal", "Animals", "Rainfall" and the
> stock-theft parts of "Compliance" describe what is BUILT (end of Phase 2).**
> **"Lands and crops" (sprays, harvest, pre-harvest intervals), "People and wages", "Money", the
> GlobalGAP/SIZA checklist and the analytical reports are PLANNED — Phases 3–6 — and no screen for
> them exists yet.** Camps and fence-walking under "Lands" ARE built; everything else in that
> section is not. **"Your data is yours" and "When something goes wrong" were classified by
> NEITHER list until the ninth pass, and each was found to name a Settings screen that does not
> exist** — Settings has four children (appearance, language, farms, security) and has never had
> more. An unclassified section is where a false claim hides, so classify every one.
> A guide with no "as at today" line is a claim about the present, which is how this
> file came to promise farmers a withholding override the product has never had. The product does
> not implement a withdrawal override.

---

## Getting started

### What Werf is

Werf keeps your farm's records — animals, lands, people, money, and the paperwork you have to produce when someone official arrives. It works on your phone in the veld with no signal, and on your computer in the office.

### Install it on your phone

1. Open **app.werf.co.za** in Chrome (Android) or Safari (iPhone).
2. Tap the menu → **Add to Home Screen** / **Install**.
3. Open it from your home screen like any other app.

**Install it.** Not because it looks nicer — because installed, it works with no signal. In a browser tab it mostly does, but "mostly" is not what you want at 5am at the crush.

### Light or dark

**Settings → Appearance.** Light, dark, or match your phone.

It starts on light and stays there until you change it — including if your phone is set to dark. That is deliberate: a dark screen in the sun becomes a mirror, and you would be standing at the crush wondering why you can suddenly only see your own face. If you want it to follow your phone, choose "Match my phone".

Dark works everywhere. Use it in the office at night.

### Set up your farm

Werf asks **what you farm**. Everything after that is shaped by your answer.

- Cattle only → you get herds and camps. No spray records. Ever.
- Vineyards only → you get blocks and sprays. No calving book.
- Cattle and maize → you get both, and profit split between them.

You can add or remove a type any time. Nothing is lost when you do. If you buy sheep in August, add "Sheep" in August.

---

## Locking your account

If you can see wages or bank details — owners and bookkeepers — Werf asks you to add a second lock. A stolen password should not be enough to open your farm's payroll.

Two ways, and **both work with no signal**:

- **Your phone's fingerprint.** The one you already use forty times a day. Your fingerprint never leaves your phone and we never see it.
- **An authenticator app.** Google Authenticator, Microsoft Authenticator, Authy — any of them. It makes a code from the clock, so it works in a camp with no bars.

**We do not send codes by SMS.** SIM swap is too common in South Africa, and an SMS is useless when you have no signal anyway.

**Your recovery codes.** You get ten, once. **Print them and put them in the safe.** If your phone goes into the dam and you have no codes, getting back in takes us 48 hours and a lot of questions — because if it were faster, someone could talk their way into your farm by pretending to be you.

**Settings → Security** lists every phone you have added as a key, and lets you add another or remove one. (Your authenticator app is set up separately, when you first turn on the second step — it is not managed from this list.) **Add your second phone before you need it.** Removing a lost phone from a working one takes seconds; doing it with nothing left takes 48 hours.

If you are opening Werf on a borrowed tablet with no fingerprint reader, it offers the authenticator app instead. It will not ask you for a lock the device in your hand cannot provide.

⚠️ **Fingerprints are for your own account only.** Werf never takes a worker's fingerprint. Consent between an employer and a farm worker is not the same thing as consent between you and your own phone, and the law treats it that way (POPIA s26).

## Working without signal

**This is the part that matters, so read it once properly.**

Werf does not need signal. Record a calving in a camp with no bars, close the app, drive home, and it is there. Your phone can go flat and it is still there. You can be offline for a month.

At the top of the screen there is a strip:

| It says | It means |
|---|---|
| **Offline — your work is saved** | No signal. Everything you enter is safe on your phone. |
| **3 to send** | You have signal, and three records are going up now. |
| **Synced** | Everything is on the server. Your manager can see it. |
| **2 not sent — needs your attention** | Two records need you to look at them. Tap **See what** beside it — the sentence itself is not a button. |

**"Offline — your work is saved" means exactly that.** Do not write it on paper as well. That is the whole point of this.

### When two people record the same thing

**Werf never quietly throws one away.**

What you recorded and what your herdsman recorded are both facts, and both are kept — a calving he wrote down in a camp with no signal is still there when your phone and his finally meet. Records of things that *happened* are never merged or overwritten; they are added to the history, each with the day it happened and who recorded it.

Where two people edit the same *detail* — a camp's name, an animal's breed — the last edit made wins. That is fine for a name and it is why counts do not work that way: see **Herd → Count** above.

⚠️ **The strip at the top says what has reached the server, not what your herdsman has recorded.** If his phone has been in a dead zone for a week, his week is on his phone, and it arrives when he does.

---

## Animals

### Adding one

**Herd → Add animal.** Tag number, sex, breed, date of birth, and the marks it carries.

> **⚠️ Team note, delete before ship — photos are NOT built.** This line used to say *"take a photo — it is what you will hand the police."* There is no object storage behind `photo_key` (STATUS.md §4 B2, §2.8: a Phase 3 infrastructure slice), so no photo can be taken or shown. The evidence pack correctly prints the photo reference and says the image is not attached rather than claiming "Yes" — restore this sentence when the upload path exists, and not before.

### Tags and marks

**Animal → Add tag.** An animal can carry more than one identifier — an ear tag, a tattoo, a brand, a microchip — and it keeps them all. Replace a lost tag and the old number is kept, not overwritten: a tag reissued after a theft is exactly the number the animal was wearing when it went, and that is the number the police will be given.

### Groups instead of individuals

Three hundred sheep and you do not want three hundred records? Make a **flock** with a head count. Treat them, move them, and count them as a group. You can start recording individuals later without redoing anything.

**Herd → Count.** This is how a flock of 300 becomes 297, and says why.

You tell Werf **what changed and why** — died, sold, slaughtered, stolen, moved to another group, born, bought, or counted — and it does the arithmetic. You never type the new total.

**That is deliberate, and it is the whole design.** If you and your herdsman are both out of signal and you each record three deaths, the changes add up to 294, which is the truth. If you had each typed a new head count instead, the last phone to reach signal would win, the flock would sit at 297, and three dead sheep would stay in the count with nothing to show what was lost.

**Counted the whole camp yourself? Use "I counted them".** That is the one entry that replaces the total instead of adjusting it — because "I walked the camp and there are 297" is a stronger fact than arithmetic on a number you have just proved wrong. Use it when the count has drifted, not for everyday changes.

**Moving head between two groups is one action.** Pick "moved to another group" and choose where they went; Werf writes both halves — out of one, into the other — so the two can never disagree. A withholding period follows them across. It is still one flock's worth of head; nothing was sold and nothing died.

**Bought-in head.** If the seller tells you the stock is inside a withholding period, record it. If they tell you nothing, leave it blank — Werf will say "history unknown" rather than inventing a date or quietly treating the animals as clear. Both of those would be a lie in a residue traceback, and one of them is the dangerous kind.

### Weighing

**Herd → Weigh session.** One animal per screen. Type the weight, tap **Save & next**. No scrolling, no hunting.

If a weight looks wrong, Werf says so on the spot — *"2180kg looks unusual for this mob"* — while the animal is still in front of you. You can accept it or fix it.

Get interrupted? It picks up where you stopped.

### Treatments and withholding periods

**Animal → Treat**, or **Flock → Treat** for a whole mob at once — a plunge dip is one entry, not three hundred. Pick the product and the day it was given. Werf works out the withholding period and remembers it.

**Record the day it actually happened.** If you dipped on Monday and are writing it up on Thursday, say Monday. Werf works the withholding period from the day you give it, not from today.

**If you try to sell or slaughter an animal inside its withholding period, Werf stops you** and tells you the date it is clear. It works with no signal, on the phone in your hand, while the animal is still in front of you — not days later when the truck has already gone.

**It follows the animal.** Dip a flock, move forty head into another camp, and the withholding goes with them. Treat one cow on her own and put her in a mob, and that mob cannot go to the abattoir while she is still inside her period.

**There is no override, and that is deliberate.** Meat inside a withholding period is a residue traceback and a rejected consignment, and no reason box makes that untrue. What you can always do is **record what actually happened** — a death is never refused, whatever the withholding says, because refusing to record a fact is worse than recording it.

**If something did slip through, Werf tells you.** See *Needs your attention* below.

---

### Births, weaning, moving, losses

**Animal → Calving/lambing.** The dam, the sire if you know him, birth weight, and how the calving went. **Twins are two lambs**, not one entry with a note — record the number born and Werf makes a record for each.

**Animal → Wean.** Weaning weight and the day.

**Herd → Move.** Which camp they went to, and when. Werf keeps the whole movement history, because "where was this animal in March" is a question an auditor and a police officer both ask.

**Animal → Loss.** Died, stolen, or missing. Say what day it happened — not the day you are writing it up. If it went into the food chain, say so; that is a different record from an animal that died in the veld.

### Breeding

**Animal → Mating.** Two ways to record it, and you pick the honest one:

- **A date**, if you know it — an AI technician knows the hour.
- **A period**, if a bull ran with the cows. Give the day he went in and the day he came out. "He is still with them" is a normal answer in October; leave the out date blank.

Werf will not make you name a day the service did not happen on. A calving date worked out from a date you invented is worse than no date at all.

**Animal → Pregnancy test.** The result and how it was tested. If she is pregnant, Werf works out roughly when she is due, from the day she was served.

**Some species have no due date, and Werf says so plainly.** Poultry incubate rather than gestate, and "game" covers everything from a springbok to a kudu — there is no honest average. The test result is still recorded; only the date is missing, and the screen tells you why. A date guessed off a nearby species is not a kindness.

---

## When Werf needs you

### Needs your attention

Some things can only be worked out after the fact, and this screen is where they surface. It appears on the home screen **only when there is something on it**.

The main one is a residue problem nobody could have seen coming. You dip a flock on Monday, out of signal. Your herdsman, on his own phone that has never seen that dip, sends five head to the abattoir on Wednesday. Both of you did the right thing with what you knew, and neither phone could have stopped it.

**Werf does not refuse the record days later — it happened, and losing the record helps nobody.** It flags it, tells you what the withholding period was, and leaves the entry standing so you have an answer when the abattoir asks.

The screen separates two things that look alike and are not:

- **You were warned and went ahead anyway.**
- **No phone could have known.**

The second is not blame. It is the one you show someone.

### Not sent

**When the strip at the top says “needs your attention”, tap _See what_ beside it.** That is the link; the sentence itself is not tappable. It tells you which record the server refused and why, in plain language.

**Nothing is ever thrown away.** A refused record is kept, not deleted — sixty tags captured in a crush with one duplicate digit means fifty-nine go up and one waits for you.

**Some records wait for another one.** Two halves of the same move, or anything recorded against a group the server has not accepted yet, go up only once the record they depend on does. Those are listed separately, under **Waiting on one of the above**, and they need nothing from you: sort out the refusal above them and they follow on their own. Sometimes a record waits with nothing above it — the server has not yet counted head that the record spends — and then the list is headed **Waiting to go up** and says so. The strip counts these too, so “1 not sent — needs your attention · 3 to send” means one needs you and three are simply still on their way.

⚠️ **If it tells you to record something again, read what it says first.** Recording a count again is not free: "I counted them" replaces the total.

---

## Lands and crops

### Blocks

**Blocks → Add.** Draw the boundary on the map or type the hectares.

### Walking a fence

**Camp → Walk the fence.** Put the phone in your pocket, drive or walk the boundary, and mark a corner at each corner post. Werf works out the hectares from the shape you walked.

**It is saved from the first corner, not from the end.** A 200 ha camp takes the better part of an hour; phones lock and browsers close backgrounded tabs. Stop halfway, come back, carry on.

It checks the shape while you are still standing there — too few corners, a fence that crosses itself, corners that enclose nothing — because a problem you hear about days later is one you cannot walk back to.

**Your title-deed hectares are not overwritten.** Werf shows both: the figure you typed and the figure the fence actually encloses. They are different claims and both are worth having.

**Walk it again whenever the fence moves.** The newest walk becomes the camp's shape, and the old one is kept — it is a true record of where the fence used to run.

---

## Rainfall

**Rainfall → Record.** The gauge reading and the day. Rainfall belongs to the farm, not to the cattle or the vineyard, so both sides of a mixed farm see it.

### Sprays

**Block → Spray.** Product, rate, water, who sprayed, what equipment, the weather. Werf records the active ingredients and the pre-harvest interval automatically.

This is the record a GlobalGAP auditor asks for. Capture it properly once and audit day is an afternoon instead of a fortnight.

### Harvest and the pre-harvest interval

**If you try to harvest inside the pre-harvest interval, Werf stops you.** It names the product, the spray date, and the earliest date you can safely harvest.

Override it if you must — reason required, recorded, and it shows up on your GlobalGAP checklist as a non-conformance.

**This is not us being difficult.** A rejected export container costs more than a delayed harvest, and it is a lot harder to explain.

---

## People and wages 🇿🇦

### Employees

**People → Add person.** Start with the name and add the details you have. Missing contract or pay
details show as **Incomplete**; you can still save the person and record their work.

Werf generates the written employment contract the law requires — **in the language the employee reads**. Not the language you read. That is the requirement.

ID numbers are encrypted and shown as `•••••••••1234`. They never go onto a phone.

### Attendance

**People → Hours.** Enter start/end or a total number of hours. PIN and location are optional. It
works with no signal, and a weekly grid makes paper timesheets quick to capture at a desk.

**Werf does not use fingerprints.** Fingerprints are special personal information under POPIA, and consent given by a worker to their employer is not really free consent. PIN and location do the job without the legal exposure.

### Piece work

**People → Piece work.** Person, date, activity, block/camp, units and rate. Repeat the last entry or
capture several people together.

If piece earnings are below the reference floor for the hours recorded, Werf calculates and shows a
top-up as its own line. It warns clearly and leaves the decision with you.

This is a common wage mistake; Werf makes the calculation and its source easy to see.

### Running payroll

**Labour → Run payroll.** Pick the period.

**Payroll needs signal.** It is the one thing that does. Werf checks the current wage rates with the server, because a payslip worked out on last year's rate is a legal document that is wrong, and that is worse than one that is a day late. Your attendance records are safe either way.

**Before you approve, Werf shows you the problems:**

> ⚠ **Thabo M · piece rate topped up**
> R160 earned → R241.84 minimum. +R81.84
>
> ⚠ **Maria S · overtime over the limit**
> 14h worked, 10h is the weekly cap. Paid in full. Fix the roster.
>
> ⚠ **Sipho N · deductions may be too high**
> Net would fall below the reference floor. Review the deduction or continue.

Read these. They are the reason you are using Werf instead of a spreadsheet.

**Why is over-limit overtime still paid?** Because Maria worked those hours. The limit is a rule about your roster, not about her pay. Fix the roster; pay her.

**When a pay period crosses 1 March**, Werf uses February's rate for February's days and March's rate for March's days, on the same payslip. It does this every year without being asked.

### Download and share your records

**People → Downloads.** Choose the period, people and file:

- PDF for printing payslips, employment particulars and registers;
- Word for editable employment particulars;
- Excel for attendance, piece work, leave, payroll detail or the accountant pack.

Werf downloads the file to you. It never sends or files it on your behalf.

### When the inspector arrives

**Labour → Reports → Employment records.**

One button. A printable PDF, with an Excel option, containing each employee's recorded name,
occupation, hours and pay for the selected period.

Inspectors do not make appointments. This is why you use this.

---

## Compliance 🇿🇦

### Your brand

**Compliance → Branding register.** Your registered mark, your certificate.

Werf flags animals you have bought but not yet marked. The law gives you a window. Werf watches the clock.

### If stock is stolen

**Herd → select the animals → Mark missing.**

Werf captures the **GPS and the exact time automatically**. That is evidence. Do it in the camp, at the gate, immediately — not back at the house two hours later.

Then: **Compliance → Stock theft → Generate evidence pack.**

A PDF with every animal's photo, tag, brand, and distinguishing marks; your brand certificate; the ownership trail; where and when they were last recorded; twelve months of movements; and treatment history proving they were yours all along. With a space for the SAPS case number.

That is what you take to the Stock Theft Unit. The difference between *"some cattle went missing last week"* and this document is the difference between a docket that gets investigated and one that does not.

**There is no place to name a suspect.** That is on purpose. Naming someone in your records who turns out to be innocent is a defamation problem for you. Record what you saw. Let the police investigate.

If you have no signal, mark them missing anyway. The pack generates when you get signal.

### GlobalGAP and SIZA audits

**Compliance → GlobalGAP.**

Werf shows the checklist with your evidence already attached — because you recorded the sprays as you did them. Green means done. Amber and red are your work list, and each one links straight to the screen where you fix it.

Then generate the pack.

**SIZA works the same and mostly fills itself in**, because SIZA asks about contracts, hours, wages, and deductions — which is exactly what the labour module already holds.

---

## Money

**Finance → Add income / Add expense.** Attach the expense to an enterprise, a camp, or a block. Photograph the receipt.

**Finance → Enterprise P&L** tells you what the cattle made and what the maize made, separately.

**Only owners and bookkeepers see money.** Managers and workers cannot, from any screen, by any URL. It is not on their phone at all.

---

## Who sees what

| | Sees |
|---|---|
| **Owner** | Everything |
| **Manager** | Animals, lands, people, tasks. **Not money.** |
| **Worker** | Their tasks, their hours, their payslips. Nothing else. |
| **Bookkeeper** | Money and payroll. Not the herd book. |
| **Vet / Auditor** | Only what you grant, only for as long as you grant it |

Giving your vet access to one herd's treatment history for thirty days gives them that and nothing else, and it stops on day thirty-one by itself.

---

## Your data is yours

**Export: everything, as CSV and JSON, no phone call, no notice period.** _(Planned — no export screen exists yet. Ask us and we will send you your data.)_

We keep it in South Africa. It does not leave.

Werf is built for South African law — the wages, the animal marking, the stock theft paperwork, the audits. That is the point of it. If you farm across the border, tell us; we are built to add countries, but we will not pretend to know a country's law until we have actually read it.

**One exception, and you should know about it:** if you delete your account, employment records are kept for three years. The BCEA requires you to hold them and the law does not care that you have switched software. Werf will not delete something you are legally required to have.

---

## When something goes wrong

| | |
|---|---|
| **"Offline — your work is saved" for days** | Normal if you have no signal. If you *do* have signal and it stays like that, contact support — do not keep working and hope. |
| **"2 not sent — needs your attention"** | Tap **See what** beside it. It lists each record the server refused and why, in plain language. Nothing is lost, and there is no button to press to retry — fixing what it names is what sends it. |
| **"Payroll needs a connection"** | Correct. Find signal. Your attendance is safe. |
| **Blocked from selling or sending for slaughter** | Read the message. If the animal or group was treated, it gives the date from which it may go. If it asks you what day something happened, tell it — it cannot check a withholding period without the day. It is protecting you. |
| **Phone is full** | **Your unsent work is never removed** — it is the last thing we would drop. Shortening the history kept on the phone is planned; there is no setting for it yet. |

**support@werf.co.za** · **status.werf.co.za**

---

## Getting the most out of it

- **Photograph every animal.** Three seconds each. It is the single most valuable thing in a theft pack.
- **Record it where it happens.** The camp, the crush, the block. Not from memory at the kitchen table — that is where the mistakes come from.
- **Do not keep a paper backup.** If you feel you need one, tell us why. That is a problem with the product, not with you.
- **Read the payroll warnings.** They are what you are paying for.
- **Attach expenses to enterprises.** It is the only way the P&L means anything.
- **Look at the GlobalGAP checklist in month one**, not audit week.

---

## What Werf does not do

Straight answers, so you know where the edges are.

- **It does not file your tax or UIF returns.** It produces the files. You or your bookkeeper submit them.
- **It is not your accountant.** It exports to accounting software.
- **It does not sell your cattle.** Use SwiftVEE.
- **It is not a lawyer.** It helps you get wages right and keep the records. *The employer remains responsible for compliance with the BCEA, the National Minimum Wage Act, and all applicable sectoral determinations.*
- **It does not replace your vet.**
- **It does not know your animal is sick.** You do. It remembers what you did about it.
