# Roster Goals

Roster goals are short operational tasks attached to one Monday-based roster week. They use a separate `roster_goals` table because Performance goals are longer-lived objectives tied to review cycles, weighting, target values, and performance history. Keeping the records separate avoids changing Performance scoring or review semantics while preserving a clear relationship in the product language.

## Visibility policy

- The selected week shows goals whose `roster_week_start` matches that week.
- Earlier incomplete goals (`pending` or `in_progress`) appear in a separate Overdue section.
- Completed and cancelled goals from earlier weeks are not carried forward.
- A response is bounded to 200 records, and goals are not inserted into individual shift cells.

## Authority

The API uses the shared scoped-permission evaluator for `roster.goals.view_self`, `roster.goals.view_scoped`, `roster.goals.manage`, and `roster.goals.complete_self`. It does not infer authority from role names. Active custom-role assignments and active, unexpired delegations are therefore supported at company, location, department, team, direct-report, or self scope as permitted by the fixed registry.

Supervisors may assign, edit, reassign, or cancel only for an employee inside their effective scope. Employees may view their own goals and move an eligible goal from Pending to In Progress or Completed; they cannot change assignment metadata. Every mutation runs inside the existing tenant transaction/RLS context and records metadata-only audit events without copying goal descriptions or completion notes.
