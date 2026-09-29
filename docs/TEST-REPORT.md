# TuitionBook — Test report

**Date:** 29 Sep 2026 · **Build:** Expo SDK 57 / React Native 0.86 · **Result:** 50/50 data tests, 35/35 UI flows passing

## How it was tested

| Layer | What | How | Result |
|---|---|---|---|
| Data | 50 tests: dues, payments, attendance, students, settings, backup | `npm test`: the app's real SQL on real SQLite, with a fake clock for month and year boundaries | 50 pass |
| UI | 35 end-to-end flows from a fresh install | `tests/e2e/flows.mjs`: Playwright driving the web build at phone size (390×844) | 35 pass, 0 JavaScript errors |
| Static | Types and lint | `tsc --noEmit`, `expo lint` | Clean |
| CI | All of the above, plus the Android build | GitHub Actions on every push to `main` | Checks pass |

To make sure the tests actually catch problems, two fixes were deliberately undone. Three tests failed as expected, then passed again once the fixes were restored.

## Bugs found and fixed

| # | Bug | Fix |
|---|---|---|
| 1 | Restoring an archived student charged fees for the months they were away | New `fees_resume` column (migration v2): fees restart in the restore month |
| 2 | Moving the joining date later left old unpaid dues behind; moving it earlier didn't add the missing months | Editing a student now removes unpaid dues before the new date and fills any gaps. Paid months are always kept |
| 3 | Changing a ₹0 (free) student to a paid fee charged every past month | Fees start from the month of the change |
| 4 | A payment could be larger than the balance | Blocked, with the message "That's more than the balance of ₹X" (checked in both the screen and the database layer) |
| 5 | Payments could be dated in the future | Blocked |
| 6 | Searching for `%` or `_` matched everyone | Wildcards are escaped |
| 7 | Backup dates could show the previous day in IST (UTC date cut) | Dates are converted to local time before display |
| 8 | Archiving a batch hid it everywhere, so it could never be restored | Archived batches are listed under More ("tap to restore") |
| 9 | Saving attendance while sample data was still loading crashed the preview | Web transactions are queued; sample data appears in one refresh |
| 10 | Any failed save showed a raw crash screen | Every save shows a "Could not save" message instead |
| 11 | A past day's roll said "No students in this batch" when students had simply joined later | Now says "No students on this date" and explains why |
| 12 | Setting a month's amount below what was already paid gave no warning | A confirmation is shown |
| 13 | On Android, the keyboard could cover form buttons (keyboard avoidance was switched off there) | Enabled on both platforms |

## Edge cases covered by tests

**Dates:** year rollover (Dec→Jan), leap years (29 Feb 2028 valid, 29 Feb 2026 rejected), invalid dates (2026-02-30, month 13), 12-hour times (00:05 → 12:05 AM), Monday-first weekdays including Sunday, just after midnight IST.

**Fees:**
- Dues are created from the joining month, including across a year boundary.
- A future joining date creates nothing until that month arrives.
- Missed months are filled in after the app hasn't been opened for a while; running the fill twice adds nothing.
- ₹0 students never get dues.
- A fee change applies from this month; months with a payment are locked.
- Setting the fee to ₹0 keeps past arrears.
- Status goes from pending to partial to paid.
- Overdue starts the day *after* the due day; earlier months are always overdue.
- Deleting a payment re-opens the month.
- A ₹0 amount due counts as waived.
- Summary and arrears totals add up.

**Attendance:**
- Saving the same day twice updates rather than duplicates.
- Students who joined later are hidden from past rolls.
- Archived students stay in the history of days they were marked.
- A student in two batches is marked separately in each.
- Holidays and leave don't count against attendance %.
- Clearing a day affects only that batch and day.
- Batches are scheduled by weekday (Sunday included); batches with no fixed days go under "Other batches"; archived batches are hidden from Today.

**Students:**
- Search is case-insensitive and matches phone numbers.
- The batch filter combines with search.
- Hindi names, apostrophes and SQL-injection-style text are stored safely.
- Deleting a student removes their dues, payments and attendance.
- Deleting a batch keeps its students and their fees.

**Backup:**
- Exact round-trip of every table onto a phone that already has other data; IDs continue correctly afterwards.
- Device-only settings (last backup time) are not overwritten by a restore.
- Older v1 backups restore into the new schema.
- Refused with a clear message: invalid JSON, non-TuitionBook files, damaged tables, backups from a newer app version.
- **A restore that fails half-way leaves existing data untouched.**
- An empty backup restores to an empty app.
- 300 students × 24 months (7,200 dues) back up and restore in under a second.

**Formatting:** Indian number grouping (₹1,50,000), phone numbers (`98765 43210`, `+91 …`, `0…`, other country codes), special characters (₹, &, —) in WhatsApp links.

## UI flows (end-to-end)

1. A fresh install shows the setup screen.
2. The batch form rejects an empty name, 25:00 and a non-numeric fee.
3. Create a daily batch; create a batch with no fixed days (shows under Other batches).
4. The student form rejects a missing name, a short phone number, no batch, and 30 Feb.
5. The fee pre-fills from the batch and the student is saved.
6. Add a future joiner (no fees yet) and a ₹0 student.
7. Students list: search by name and phone, no-match message, "Fee pending" filter.
8. Editing a student's fee updates this month's due.
9. The roll call hides students who haven't joined yet.
10. All absent, Holiday on and off, Leave and single marks update the counts.
11. Saving opens the "Tell parents?" WhatsApp sheet, and Today shows 0/2 present.
12. Re-opening a saved day keeps the marks and offers Update.
13. Clear attendance.
14. Mark yesterday; the next-day button stops at today.
15. Save a day as a holiday.
16. Fees: pending list, totals and the WhatsApp remind button.
17. Payment: overpayment and future date are rejected.
18. Partial payment: confirmation sheet and "₹1,500 still due".
19. Paying the rest moves the student to the Paid tab.
20. Deleting a payment re-opens the fee.
21. Setting the amount due to ₹0 warns when it's below what was paid, then marks the month paid.
22. Months can be browsed backwards but never into the future.
23. Archive a student, find them under Archived, restore them.
24. Delete a student permanently (only possible once archived).
25. Batch detail history; archive a batch (hidden from Today) and restore it.
26. Delete a batch.
27. Settings reject due day 0 and 31; the name appears in the greeting.
28. Exported backup file is valid JSON with correct counts.
29. Erase all data, then restore from the file (with a confirmation first).
30. A non-backup file is refused with a clear message.
31. The Google Drive section explains it's phone-only in the preview.
32. Missing student, payment or batch links show friendly "not found" screens.
33. Sample data loads on an empty install (18 students).
34. The back button works on deep links.
35. No JavaScript errors during the whole run.

## Not covered here (needs a real phone)

- **Google Drive sign-in, upload and restore.** Needs your Google Cloud OAuth client (see README) and a phone with Google Play Services. The Drive code handles an expired token (refresh and retry once), a missing folder (creates it), a cancelled sign-in, and a "not set up" error.
- **Behaviour only visible on a device:** haptics, the Android back gesture, the keyboard over forms, the share sheet, and opening WhatsApp or the phone dialler. These use standard Expo modules, but only a device can confirm them.

A 5-minute checklist to run on the phone:
1. Load sample data.
2. Mark attendance.
3. Record a payment and send the receipt on WhatsApp.
4. Export a backup file and re-import it.
5. After the OAuth setup, connect Google and back up to Drive.
6. Reinstall the app and restore from Drive.
