# Werf — User Guide

*This document is also the source for in-app help. Written in the product's voice ([ux-design-system.md §5](../02-design/ux-design-system.md)): plain, direct, no apology, no cheer. Ships in English and Afrikaans.*

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

## Working without signal

**This is the part that matters, so read it once properly.**

Werf does not need signal. Record a calving in a camp with no bars, close the app, drive home, and it is there. Your phone can go flat and it is still there. You can be offline for a month.

At the top of the screen there is a strip:

| It says | It means |
|---|---|
| **Offline — your work is saved** | No signal. Everything you enter is safe on your phone. |
| **3 to send** | You have signal, and three records are going up now. |
| **Synced** | Everything is on the server. Your manager can see it. |
| **2 need attention** | Two records need you to look at them. Tap it. |

**"Offline — your work is saved" means exactly that.** Do not write it on paper as well. That is the whole point of this.

### When two people record the same thing

If you and your herdsman both record the same calving on different phones, Werf keeps both and asks you which is right. It will not quietly delete one. You decide.

---

## Animals

### Adding one

**Herd → Add animal.** Tag number, sex, breed, date of birth. Take a photo — it takes three seconds and it is what you will hand the police if the animal is stolen.

### Groups instead of individuals

Three hundred sheep and you do not want three hundred records? Make a **flock** with a head count. Treat them, move them, and count them as a group. You can start recording individuals later without redoing anything.

### Weighing

**Herd → Weigh session.** One animal per screen. Type the weight, tap **Save & next**. No scrolling, no hunting.

If a weight looks wrong, Werf says so on the spot — *"2180kg looks unusual for this mob"* — while the animal is still in front of you. You can accept it or fix it.

Get interrupted? It picks up where you stopped.

### Treatments and withholding periods

**Animal → Treat.** Pick the product. Werf works out the withholding period and remembers it.

**If you try to sell an animal inside its withholding period, Werf stops you** and tells you the date it is clear. This works with no signal.

You can override it. You will have to give a reason, and it is recorded. That is deliberate — the reason exists so that if the abattoir asks, you have an answer.

---

## Lands and crops

### Blocks

**Blocks → Add.** Draw the boundary on the map or type the hectares.

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

**Labour → Employees → Add.** Name, ID number, job, start date, wage rate.

Werf generates the written employment contract the law requires — **in the language the employee reads**. Not the language you read. That is the requirement.

ID numbers are encrypted and shown as `•••••••••1234`. They never go onto a phone.

### Attendance

**Labour → Attendance.** The worker enters their PIN. Works with no signal.

**Werf does not use fingerprints.** Fingerprints are special personal information under POPIA, and consent given by a worker to their employer is not really free consent. PIN and location do the job without the legal exposure.

### Piece work

**Labour → Piece work.** Worker, block, units, rate.

**Werf will not let you pay below the minimum wage on piece rates.** If someone picks 40 crates at R4 and that comes to less than the minimum for the hours they worked, Werf tops it up and shows you the top-up as its own line.

This is the most common wage mistake on South African farms. Now it cannot happen on yours.

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
> ⛔ **Sipho N · deductions too high**
> Net would fall below the minimum. You cannot approve until this is fixed.

Read these. They are the reason you are using Werf instead of a spreadsheet.

**Why is over-limit overtime still paid?** Because Maria worked those hours. The limit is a rule about your roster, not about her pay. Fix the roster; pay her.

**When a pay period crosses 1 March**, Werf uses February's rate for February's days and March's rate for March's days, on the same payslip. It does this every year without being asked.

### When the inspector arrives

**Labour → Reports → Employment records.**

One button. A PDF with every employee's name, occupation, hours worked, and pay, for three years back. Which is exactly what the law says you must keep and exactly what the inspector will ask for.

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

**Settings → Export data.** Everything, as CSV and JSON, no phone call, no notice period.

We keep it in South Africa. It does not leave.

Werf is built for South African law — the wages, the animal marking, the stock theft paperwork, the audits. That is the point of it. If you farm across the border, tell us; we are built to add countries, but we will not pretend to know a country's law until we have actually read it.

**One exception, and you should know about it:** if you delete your account, employment records are kept for three years. The BCEA requires you to hold them and the law does not care that you have switched software. Werf will not delete something you are legally required to have.

---

## When something goes wrong

| | |
|---|---|
| **"Offline — your work is saved" for days** | Normal if you have no signal. If you *do* have signal and it stays like that, contact support — do not keep working and hope. |
| **"2 need attention"** | Tap it. Usually two people recorded the same thing. Pick the right one. |
| **"Payroll needs a connection"** | Correct. Find signal. Your attendance is safe. |
| **Blocked from harvesting or selling** | Read the message. It names the product and the date you are clear. It is protecting you. |
| **Phone is full** | Settings → Storage → shorten the history kept on the phone. **Your unsent work is never removed.** |

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
