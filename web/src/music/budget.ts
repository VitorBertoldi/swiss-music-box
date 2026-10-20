/**
 * Keeps the number of notes per real second under a budget.
 *
 * Credit accrues with elapsed timetable minutes (a fractional rate, e.g. 0.6 notes/minute)
 * and is spent on the best candidates. Credit is capped, so a quiet stretch cannot be
 * banked into a burst. The result is deterministic: no randomness involved.
 */
export class NoteBudget {
	private readonly maxCredit: number;
	/** Starts full, so the first event of a sparse layer is heard. */
	private credit: number;
	private lastMinute: number | undefined;

	constructor(private readonly notesPerMinute: number) {
		this.maxCredit = Math.max(1, notesPerMinute);
		this.credit = this.maxCredit;
	}

	/** Picks the best candidates at `minute`; `better(a, b) < 0` means a wins. Minutes must not decrease. */
	take<T>(minute: number, candidates: readonly T[], better: (a: T, b: T) => number): T[] {
		const elapsed = minute - (this.lastMinute ?? minute);
		if (elapsed < 0) throw new RangeError(`minutes must not decrease: ${this.lastMinute} -> ${minute}`);
		this.lastMinute = minute;
		this.credit = Math.min(this.maxCredit, this.credit + elapsed * this.notesPerMinute);

		const allowed = Math.min(candidates.length, Math.floor(this.credit));
		this.credit -= allowed;
		if (allowed === candidates.length) return [...candidates];
		return [...candidates].sort(better).slice(0, allowed);
	}
}

/** Notes one layer may play per timetable minute. */
export function notesPerMinute(
	notesPerSecond: number,
	share: number,
	durationS: number,
	minutesPerDay: number,
): number {
	return (notesPerSecond * share * durationS) / minutesPerDay;
}
