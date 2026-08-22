# ADR-0015 · Farmer-controlled labour records and documents

**Status:** Accepted | **Date:** 2026-08-22 | **Decider:** JP van Vuuren (product owner)
**Extends:** [ADR-0013](ADR-0013-farmer-controlled-logbook.md) and
[ADR-0014](ADR-0014-advisory-payroll.md) across Phase 5.

## Context

The first Phase 5 plan was organised around statutes, regulatory rates and review gates. Those
concerns matter to the correctness of Werf's calculations, but they are not the farmer's workflow.
The product risk is building a small compliance-enforcement system instead of a useful labour
logbook: too many mandatory fields, hard age or payroll gates, and statutory exports without the
ordinary Word, Excel and printable records a farmer shares with a worker, bookkeeper or accountant.

Comparable payroll products expose a small employee record, repeatable pay inputs, familiar reports
and downloadable payslips. Werf needs the useful core of that pattern without copying a full HR
suite or claiming to be a payroll bureau.

## Decision

Phase 5 is a farmer-controlled **people, work and pay tool**.

- Every operational form can be saved with the facts the farmer has. Missing or unusual details are
  shown as an incomplete status or an advisory warning; they are not a compliance rejection.
- A form may prevent corrupt or structurally impossible data (for example an end before a start),
  unauthorised access, a cross-farm reference or an invalid money representation. Those are software
  integrity and security boundaries, not legal policing.
- Employee age, hours, deductions, reference-rate gaps and similar concerns are explained plainly.
  Werf never presents itself as granting or refusing permission to employ, record work or prepare a
  pay run.
- The application uses a small set of standard forms: employer details, employee details and work
  terms, attendance, piece work, pay inputs, leave, and a pay-run review. Repeated farm or employee
  facts prefill documents rather than being typed again.
- Incomplete records remain editable. A generated draft marks missing facts as **Not recorded** and
  lists them once; it does not invent values. Final statutory documents state which facts were
  farmer-entered and carry the existing employer-responsibility notice.
- Exports are farmer-initiated and audience-oriented:
  - **PDF** for payslips, employment particulars, attendance/piece-work/leave registers, payroll
    summaries and the employment record that must print cleanly;
  - **Word (`.docx`)** for editable employment particulars and employee record summaries;
  - **Excel (`.xlsx`)** for employee, attendance, piece-work, leave and payroll detail, including a
    simple accountant pack;
  - purpose-specific UIF, SARS and EFT files remain available where their formats are verified.
- Export asks only for the period, people and format. It never emails, files or reports anything to
  an authority or third party automatically.
- Phase 5 does not include performance management, recruitment, disciplinary workflows, biometric
  attendance, live worker tracking, a report designer or a general HR document-management system.

## Consequences

- The phase plan is organised around farmer tasks and outputs; legal verification remains an
  internal deployment gate, not an in-product permission gate.
- Standard Word, Excel and PDF outputs are Phase 5 work, not deferred to the general Phase 7 data
  portability feature.
- The database and forms must distinguish **not recorded** from a guessed default. Fields needed
  only by a particular document can stay empty until that document is prepared.
- Existing hard-block wording for payroll and age verification is superseded. Tests prove warnings,
  saved records and usable exports instead of refusal paths.
- Sensitive exports are role-gated, generated on explicit request, audit-logged and protected by
  short-lived download links. This does not turn ordinary employee records into a broad sync payload.

## Revisit if

A qualified labour-law reviewer identifies a legal duty imposed directly on Werf rather than the
employer · farmer testing shows a missing standard field or output · a customer explicitly buys a
separate managed-compliance service with different behaviour.
